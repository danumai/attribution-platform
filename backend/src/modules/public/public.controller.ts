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
  // Liveness + readiness. Hits the DB on purpose: no Postgres means 500s only, so pull from rotation.
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
   * `/r/:code` at the App Clip invocation URL: camera matches the registered `/c/<slug>/` prefix
   * offline, then the clip calls with `?format=json` to store the claim id for its full app.
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
   * Every App Clip this domain vouches for, in one Apple-verified document. Cached 1h; ids are
   * CHECK-constrained since one malformed entry invalidates the file for all publishers.
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

  /** One handler because it is one event — only the QR's URL and whether an App Clip wants JSON differ. */
  private async handleScan(
    code: string,
    req: Request,
    res: Response,
    /** App Clip invocation slug, checked against the publisher that owns it */
    slug: string | null,
    /** App Clip collecting its claim id, rather than a browser being redirected */
    json: boolean,
  ) {
    // An App Clip is code, not a browser: reason as actionable data, not a human-readable page.
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
                    // Printed on the interstitial's destination field, before the redirect happens.
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
    // Re-checked here: an admin suspending a partnership after creation must stop scans, or claims
    // keep paying out.
    if (campaign.partnership.status !== 'active') return end('partnership_inactive');
    if ((await balance(`campaign:${campaign.id}`)) <= 0) return end('budget');

    // App Store Connect routes on the slug prefix; a mismatch is a hand-assembled URL that would
    // hand one publisher's scan to another's clip.
    if (slug !== null && slug !== campaign.partnership.publisher.slug) return end('invalid');

    // Resolve the destination *before* burning a use, or a publisher with no app and no web
    // fallback eats the print run's uses redirecting nobody.
    const platform = detectPlatform(req.headers['user-agent'] ?? '');
    const claim_id = newClaimId();
    const publisher = campaign.partnership.publisher;

    /**
     * Engagement scans use the App Link / Universal Link so an installed app opens, carrying
     * `qrm_code` (claimed server-side) and `qrm_fallback` (built here: holds the Play referrer, and
     * one assembled wrong is silent zero attribution). iOS fallback is the interstitial, not the
     * bare listing — an app-less scanner is an acquisition too.
     */
    const engagement = campaign.mode === 'engagement';
    // `campaign_token` only reaches an App Store campaign link: downloads per campaign, nothing per user.
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

    // One transaction: a use claimed without its scan row burns a printed use that can never be attributed.
    const claimed = await prisma.$transaction(async (tx) => {
      // Atomic expiry + max_uses check so two scans cannot both take the last use. Raw because
      // `uses < max_uses` compares two columns.
      const rows = await tx.$queryRaw<{ uses: number }[]>`
        UPDATE qr_codes SET uses = uses + 1
        WHERE id = ${qr.id}::uuid AND NOT voided
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR uses < max_uses)
        RETURNING uses`;
      if (!rows.length) return false;

      // Opaque id, nothing describing the handset. Reporting columns ride the same insert to keep
      // the hot path at one write.
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

    // The only response handing a claim id to a device — inert without the publisher's server-side API key.
    if (json)
      return res.json({
        ok: true,
        claim_id,
        campaign_id: campaign.id,
        publisher: publisher.name,
        /** Scoped to campaign mode — the raw column had the clip promising repeat-purchase offers
         *  to people with no app yet. */
        bonuses: campaignBonuses(publisher.bonuses, campaign.mode, campaign.bonus_types),
        /** full-app link, for clips that prefer a link to SKOverlay */
        store_url: destination,
      });

    // Hand-off screen, load-bearing on iOS: the pasteboard write needs the scanner's tap. Skipped
    // for Android/Play, desktop, app-less publishers, and deep-linked engagement (`/i/:claim_id`).
    if (iosHandoff && !(engagement && publisher.deeplink_url))
      return this.interstitial(res, claim_id, publisher.name, 'ios');

    // Straight to the listing, nothing spendable in the URL — on Android the claim id travels only
    // inside Play's install-referrer channel.
    res.redirect(destination);
  }

  /**
   * The only scripted page here, so the only relaxed CSP. Failures are silent, hence layers: tap
   * carries then hands off, a refused clipboard still hands off (organic install), blocked script
   * falls to `<meta refresh>`, and Continue is a real anchor. `claim_id`'s shape is asserted
   * because it lands in an href and a script literal.
   */
  private interstitial(res: Response, claim_id: string, destination: string, store: Store) {
    // Pasteboard carrier is the iOS-without-App-Clip fallback; elsewhere the claim already has a
    // carrier or there is no install to attribute.
    const carry = store === 'ios';
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(claim_id)) throw new Error('malformed claim id');
    const nonce = randomBytes(16).toString('base64');
    // Overrides the global `default-src 'none'`. Nonce, not 'unsafe-inline', so injected script
    // still cannot execute. `data:` is for the fibre tile.
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
   * The interstitial at its own URL, so a deep link's `qrm_fallback` can reach it when the OS finds
   * no app installed. Burns no use and creates no scan; unknown or already-bound claim ids are
   * rejected so a replayed link cannot re-open the signal window on a paid attribution.
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
   * Hands the scanner to the store. A GET so the no-script `<meta refresh>` and visible link reach
   * it too. Also the pasteboard payload the SDK reads at first open, so pasting it just yields the listing.
   */
  @Get('go/:claimId')
  async go(
    @Param('claimId') claimId: string,
    // About this page, not the device: how long it was held, and tap vs. bail-out.
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

    // Hand-off cost only, nothing about the handset. `consumed` guard stops a replayed link
    // rewriting the record after an install is bound.
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
    // The flat PNG encoder cannot express shapes, gradients, logos or frames — SVG-only here, and
    // the studio rasterises them in the browser.
    if (format === 'png' && !isAdvanced(style)) {
      res.setHeader('Content-Type', 'image/png');
      res.send(await renderPng(url, style));
    } else {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(await renderSvg(url, style));
    }
  }

  // Style preview via POST: a logo data URL is far past what a query string can carry.
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
    // Same URL the printed code will carry, or it is a preview of something else.
    res.send(
      await renderSvg(scanUrl(BASE_URL, qr.code, qr.campaign.partnership.publisher.slug), style),
    );
  }
}
