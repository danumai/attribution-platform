import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { BASE_URL, FRONTEND_URL } from '../../config';
import { QrStyle, isAdvanced, renderPng, renderSvg, validateStyle } from '../../common/qr';
import {
  aasa,
  campaignBonuses,
  campaignToken,
  detectPlatform,
  engagementUrl,
  scanUrl,
  storeUrl,
} from '../../common/attribution';
import { clientIp, rateLimited } from '../../common/security';
import { Store, interstitialHtml } from './interstitial';
import { randomBytes } from 'crypto';
import { clientSignals, scanSignals } from '../../common/signals';
import { balance } from '../../common/ledger';
import { prisma } from '../../config/prisma';
import { newClaimId } from '../auth/tokens';

@ApiTags('Public')
@Controller()
export class PublicController {
  // Liveness + readiness. Hits the DB on purpose: a process that cannot reach Postgres serves
  // nothing but 500s and should be pulled from rotation.
  @Get('healthz')
  async health(@Res() res: Response) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  }

  @Get('r/:code')
  async scan(@Param('code') code: string, @Req() req: Request, @Res() res: Response) {
    return this.handleScan(code, req, res, null, false);
  }

  /**
   * The same scan, at the URL an App Clip is invoked by. The camera recognises the registered
   * `/c/<slug>/` prefix offline and offers the clip card; the clip then calls this URL with
   * `?format=json` to collect the claim id and writes it to the App Group container its full app
   * reads after install. Everything else is identical to `/r/:code`.
   */
  @Get('c/:slug/:code')
  async appClipScan(
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Query('format') format: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.handleScan(code, req, res, slug, format === 'json');
  }

  /**
   * Which App Clips this domain vouches for. Apple verifies the association in both directions,
   * and one document lists every registered publisher. Cached for an hour; the ids are
   * CHECK-constrained because one malformed entry invalidates the file for everyone at once.
   */
  @Get('.well-known/apple-app-site-association')
  async appSiteAssociation(@Res() res: Response) {
    const orgs = await prisma.org.findMany({
      where: { ios_appclip_id: { not: null }, suspended: false, approved: true },
      select: { ios_appclip_id: true },
      orderBy: { ios_appclip_id: 'asc' },
    });
    // `application/json` and no `.json` suffix, as Apple requires.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(aasa(orgs.map((o) => o.ios_appclip_id!)));
  }

  /** One handler because it is one event — the only differences are which URL the QR encoded and
   *  whether an App Clip wants JSON. */
  private async handleScan(
    code: string,
    req: Request,
    res: Response,
    /** the slug from an App Clip invocation URL, checked against the publisher that owns it */
    slug: string | null,
    /** the App Clip collecting its claim id, rather than a browser being redirected */
    json: boolean,
  ) {
    // An App Clip is code, not a browser: it gets the reason as data it can act on, where a
    // browser gets the page a human can read.
    const end = (reason: string) =>
      json
        ? res.status(reason === 'rate_limited' ? 429 : 410).json({ ok: false, reason })
        : res.redirect(`${FRONTEND_URL}/campaign-ended?reason=${reason}`);

    const ip = clientIp(req);
    if (await rateLimited(`scan:${ip}`, 30)) return end('rate_limited');

    const qr = await prisma.qrCode.findUnique({
      where: { code },
      select: {
        id: true,
        voided: true,
        expires_at: true,
        campaign: {
          select: {
            id: true,
            status: true,
            mode: true,
            bonus_types: true,
            partnership: {
              select: {
                status: true,
                publisher: {
                  select: {
                    // Printed on the interstitial as the destination field — the scanner is
                    // told where they are being sent before they get sent there.
                    name: true,
                    landing_url: true,
                    android_package: true,
                    ios_app_id: true,
                    deeplink_url: true,
                    slug: true,
                    ios_appclip_id: true,
                    ios_provider_token: true,
                    bonuses: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!qr) return end('invalid');
    if (qr.voided) return end('voided');
    const campaign = qr.campaign;
    if (campaign.status !== 'active')
      return end(campaign.status === 'paused' ? 'paused' : 'ended');
    // Checked at campaign creation, but an admin can suspend a partnership afterwards, and that
    // has to stop scans or the lever does nothing while claims keep paying out.
    if (campaign.partnership.status !== 'active') return end('partnership_inactive');
    if ((await balance(`campaign:${campaign.id}`)) <= 0) return end('budget');

    // App Store Connect routes on the slug prefix, so a mismatch means the URL was assembled by
    // hand against the wrong QR. Honouring it would hand one publisher's scan to another's clip.
    if (slug !== null && slug !== campaign.partnership.publisher.slug) return end('invalid');

    // Resolve the destination *before* burning a use: a publisher with no app and no web
    // fallback would otherwise eat the print run's uses redirecting nobody.
    const platform = detectPlatform(req.headers['user-agent'] ?? '');
    const claim_id = newClaimId();
    const publisher = campaign.partnership.publisher;

    /**
     * An engagement scan goes to the publisher's App Link / Universal Link so the OS can open the
     * app when it is installed. Two things ride along, neither spendable alone: `qrm_code`, the
     * transaction code its backend claims with a server-side key, and `qrm_fallback`, built here
     * because it contains the Play referrer and one assembled wrong is silent zero attribution.
     *
     * On iOS the fallback is the interstitial, not the bare listing: a traveller without the app
     * is about to become an acquisition too.
     */
    const engagement = campaign.mode === 'engagement';
    // `campaign_token` only ever reaches an App Store campaign link, which reports a download
    // count per campaign and nothing per user.
    const targets = { ...publisher, campaign_token: campaignToken(campaign.id) };
    const iosHandoff = platform === 'ios' && publisher.ios_app_id;
    const destination = engagement
      ? engagementUrl(
          platform,
          targets,
          claim_id,
          code,
          iosHandoff ? `${BASE_URL}/i/${claim_id}` : null,
        )
      : storeUrl(platform, targets, claim_id);
    if (!destination) return end('no_destination');

    // One transaction, because the two writes are one fact. A use claimed without the matching
    // scan row burns a use of a physical print run that can then never be attributed.
    const claimed = await prisma.$transaction(async (tx) => {
      // Claim one use atomically — both the expiry and single/multi-use check, so two scans cannot
      // both take the last one. Raw because `uses < max_uses` compares two columns.
      const rows = await tx.$queryRaw<{ uses: number }[]>`
        UPDATE qr_codes SET uses = uses + 1
        WHERE id = ${qr.id}::uuid AND NOT voided
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR uses < max_uses)
        RETURNING uses`;
      if (!rows.length) return false;

      // An opaque id, and nothing that describes the handset. The reporting columns ride along on
      // the same insert, so the hot path never costs a second write.
      await tx.scan.create({
        data: {
          qr_code_id: qr.id,
          campaign_id: campaign.id,
          claim_id,
          platform,
          user_agent: (req.headers['user-agent'] ?? '').slice(0, 300),
          ...scanSignals(req),
        },
        select: { id: true },
      });
      return true;
    });
    if (!claimed)
      return end(qr.expires_at && qr.expires_at <= new Date() ? 'expired' : 'used_up');

    // The one response that hands a claim id to a device, and safe for the same reason Play's
    // referrer is: inert without the publisher's server-side API key.
    if (json)
      return res.json({
        ok: true,
        claim_id,
        campaign_id: campaign.id,
        publisher: publisher.name,
        /** What this campaign advertises, scoped to its mode. Previously the whole raw column,
         *  which had the clip promising a repeat-purchase offer to somebody with no app yet. */
        bonuses: campaignBonuses(publisher.bonuses, campaign.mode, campaign.bonus_types),
        /** where to send someone who wants the full app, if the clip prefers a link to SKOverlay */
        store_url: destination,
      });

    // The hand-off screen. On iOS it is load-bearing rather than decorative: the pasteboard
    // write needs a user gesture, so this page is where the scanner's tap happens. Skipped where
    // it buys nothing — Android with a Play listing, desktop and app-less publishers, and an
    // engagement scan with a deep link (whose `qrm_fallback` routes through `/i/:claim_id`).
    if (iosHandoff && !(engagement && publisher.deeplink_url))
      return this.interstitial(res, claim_id, publisher.name, 'ios');

    // Straight to the store listing. No token, no code, nothing the app can read and spend — on
    // Android the claim id travels only inside Play's install-referrer channel.
    res.redirect(destination);
  }

  /**
   * The only page in this API that runs script, so also the only one with a relaxed CSP.
   *
   * Fallbacks all the way down, because the failure mode is silent:
   *   - script runs             → the tap writes the claim to the clipboard, then hands off
   *   - clipboard write refused → the hand-off still happens; the install is simply organic
   *   - script blocked / errors → `<meta refresh>`, so the scanner still reaches the store
   *   - all of it fails         → the Continue key is a real anchor to a real URL
   *
   * `claim_id` is base64url and cannot carry markup, but it is interpolated into an href and a
   * script literal, so the shape is asserted rather than assumed.
   */
  private interstitial(res: Response, claim_id: string, destination: string, store: Store) {
    // The pasteboard carrier is the iOS fallback for publishers with no App Clip. Everywhere else
    // the claim already has a carrier or there is no install to attribute.
    const carry = store === 'ios';
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(claim_id)) throw new Error('malformed claim id');
    const nonce = randomBytes(16).toString('base64');
    // Overrides the global `default-src 'none'`. A nonce rather than 'unsafe-inline', so a future
    // injection still cannot execute. `data:` is for the fibre tile.
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
        `img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Never cached: every render carries a different claim id and a single-use nonce.
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      interstitialHtml({ destination, go: `${BASE_URL}/go/${claim_id}`, nonce, store, carry }),
    );
  }

  /**
   * The interstitial, reached from an engagement deep link that found no app installed. `/r/:code`
   * renders this inline, but the OS decides offline whether the app opens, so the hand-off screen
   * needs a URL of its own to be a deep link's `qrm_fallback`.
   *
   * No use is burned and no scan created. An unknown or already-bound claim id is turned away, so
   * a replayed link cannot re-open the signal window on a paid attribution.
   */
  @Get('i/:claimId')
  async handoff(@Param('claimId') claimId: string, @Req() req: Request, @Res() res: Response) {
    const end = (reason: string) =>
      res.redirect(`${FRONTEND_URL}/campaign-ended?reason=${reason}`);
    if (await rateLimited(`go:${clientIp(req)}`, 30)) return end('rate_limited');
    const scan = await prisma.scan.findUnique({
      where: { claim_id: claimId },
      select: {
        consumed: true,
        campaign: {
          select: { partnership: { select: { publisher: { select: { name: true } } } } },
        },
      },
    });
    if (!scan || scan.consumed) return end('invalid');
    return this.interstitial(res, claimId, scan.campaign.partnership.publisher.name, 'ios');
  }

  /**
   * Second half of the interstitial: hand the scanner on to the store. A GET so the no-script
   * `<meta refresh>` and the visible link reach it too.
   *
   * This URL is also the pasteboard payload — what the tap writes and the SDK reads back at first
   * open — so a scanner who pastes it somewhere gets the listing they were going to anyway.
   */
  @Get('go/:claimId')
  async go(
    @Param('claimId') claimId: string,
    // Two keys, both about this page rather than the device: how long it was held, and whether
    // the scanner tapped or the bail-out fired.
    @Query() q: Record<string, string>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const end = (reason: string) =>
      res.redirect(`${FRONTEND_URL}/campaign-ended?reason=${reason}`);
    if (await rateLimited(`go:${clientIp(req)}`, 30)) return end('rate_limited');

    const scan = await prisma.scan.findUnique({
      where: { claim_id: claimId },
      select: {
        id: true,
        platform: true,
        consumed: true,
        campaign: {
          select: {
            id: true,
            partnership: {
              select: {
                publisher: {
                  select: {
                    landing_url: true,
                    android_package: true,
                    ios_app_id: true,
                    ios_provider_token: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!scan) return end('invalid');

    // What the hand-off screen cost, and nothing about the handset. The `consumed` guard stops a
    // replayed link rewriting the record after an install is bound.
    const client = clientSignals(q);
    if (!scan.consumed && client)
      await prisma.scan.updateMany({
        where: { id: scan.id, consumed: false },
        data: { client },
      });

    const destination = storeUrl(
      scan.platform as ReturnType<typeof detectPlatform>,
      {
        ...scan.campaign.partnership.publisher,
        campaign_token: campaignToken(scan.campaign.id),
      },
      claimId,
    );
    if (!destination) return end('no_destination');
    res.redirect(destination);
  }

  // QR image render — public (the QR only encodes a public URL); supports live style preview
  @Get('v1/qr-codes/:id/image')
  async qrImage(
    @Param('id') id: string,
    @Query('format') format: string,
    @Query('style') styleJson: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // unauthenticated and CPU-bound (QR encode + SVG build), so it needs its own budget
    if (await rateLimited(`qr-image:${clientIp(req)}`, 120))
      throw new BadRequestException('too many image requests, try again shortly');
    const qr = await prisma.qrCode.findUnique({
      where: { id },
      include: {
        campaign: {
          select: { partnership: { select: { publisher: { select: { slug: true } } } } },
        },
      },
    });
    if (!qr) throw new NotFoundException();
    let style = qr.style as QrStyle;
    if (styleJson) {
      try {
        style = JSON.parse(styleJson);
      } catch {
        throw new BadRequestException('style must be valid JSON');
      }
      style = validateStyle(style);
    }
    const url = scanUrl(BASE_URL, qr.code, qr.campaign.partnership.publisher.slug);
    // The flat PNG encoder cannot express shapes, gradients, logos or frames — those styles are
    // SVG-only here, and the studio rasterises them in the browser instead.
    if (format === 'png' && !isAdvanced(style)) {
      res.setHeader('Content-Type', 'image/png');
      res.send(await renderPng(url, style));
    } else {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(await renderSvg(url, style));
    }
  }

  // Style preview. A logo data URL is far past what a query string can carry, so the live editor
  // posts the style instead of encoding it into the image URL.
  @Post('v1/qr-codes/:id/preview')
  async qrPreview(
    @Param('id') id: string,
    @Body() body: { style?: QrStyle },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (await rateLimited(`qr-image:${clientIp(req)}`, 120))
      throw new BadRequestException('too many image requests, try again shortly');
    const qr = await prisma.qrCode.findUnique({
      where: { id },
      select: {
        code: true,
        campaign: {
          select: { partnership: { select: { publisher: { select: { slug: true } } } } },
        },
      },
    });
    if (!qr) throw new NotFoundException();
    const style = validateStyle(body?.style ?? {});
    res.setHeader('Content-Type', 'image/svg+xml');
    // Same URL the printed code will carry — a preview that encodes a different one is a preview
    // of something else.
    res.send(
      await renderSvg(scanUrl(BASE_URL, qr.code, qr.campaign.partnership.publisher.slug), style),
    );
  }
}
