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
  detectPlatform,
  normCores,
  normDark,
  normLang,
  normScreen,
  normTz,
  storeUrl,
} from '../../common/attribution';
import { clientIp, ipHash, rateLimited } from '../../common/security';
import { Store, interstitialHtml } from './interstitial';
import { randomBytes } from 'crypto';
import { clientSignals, scanSignals } from '../../common/signals';
import { balance } from '../../database/ledger';
import { prisma } from '../../database/prisma';
import { newClaimId } from '../auth/tokens';

@ApiTags('Public')
@Controller()
export class PublicController {
  // Liveness + readiness for the load balancer. Hits the DB on purpose: a process that
  // cannot reach Postgres serves nothing but 500s and should be pulled from rotation.
  @Get('healthz')
  async health(@Res() res: Response) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  }

  // the scan hot path
  @Get('r/:code')
  async scan(@Param('code') code: string, @Req() req: Request, @Res() res: Response) {
    const end = (reason: string) =>
      res.redirect(`${FRONTEND_URL}/campaign-ended?reason=${reason}`);

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
            partnership: {
              select: {
                status: true,
                publisher: {
                  select: {
                    // `name` is printed on the interstitial as the destination field — the
                    // scanner is told where they are being sent before they get sent there.
                    name: true,
                    landing_url: true,
                    android_package: true,
                    ios_app_id: true,
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
    // The partnership is the agreement the fee is paid under. It is checked at campaign
    // creation, but an admin can suspend it afterwards — and that has to stop scans, or the
    // suspension lever silently does nothing while claims keep paying out.
    if (campaign.partnership.status !== 'active') return end('partnership_inactive');
    if ((await balance(`campaign:${campaign.id}`)) <= 0) return end('budget');

    // Resolve the destination *before* burning a use: a publisher who has registered no app
    // and no web fallback would otherwise eat the print run's uses redirecting nobody.
    const platform = detectPlatform(req.headers['user-agent'] ?? '');
    const claim_id = newClaimId();
    const destination = storeUrl(platform, campaign.partnership.publisher, claim_id);
    if (!destination) return end('no_destination');

    // One transaction, because the two writes are one fact. A use claimed without the matching
    // scan row burns a use of a physical print run that can then never be attributed — the
    // scanner installs the app and the publisher is told `no_match`.
    const claimed = await prisma.$transaction(async (tx) => {
      // Claim one use atomically — this is both the expiry check and the single/multi-use check,
      // so two simultaneous scans can never both take the last use of a code. Raw because
      // `uses < max_uses` compares two columns, which the query builder cannot express.
      const rows = await tx.$queryRaw<{ uses: number }[]>`
        UPDATE qr_codes SET uses = uses + 1
        WHERE id = ${qr.id}::uuid AND NOT voided
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR uses < max_uses)
        RETURNING uses`;
      if (!rows.length) return false;

      // The pending attribution claim. It holds the fingerprint the app's first open will be
      // matched against; the phone is handed none of it. The signals ride along on the same
      // insert — they are reporting columns, so they must never cost the hot path a second write.
      await tx.scan.create({
        data: {
          qr_code_id: qr.id,
          campaign_id: campaign.id,
          claim_id,
          platform,
          ip: ipHash(ip),
          user_agent: (req.headers['user-agent'] ?? '').slice(0, 300),
          ...scanSignals(req),
        },
        select: { id: true },
      });
      return true;
    });
    if (!claimed)
      return end(qr.expires_at && qr.expires_at <= new Date() ? 'expired' : 'used_up');

    // iOS has no install-referrer channel, so this scan will have to be matched on device
    // signals — and the only moment we can read them is right now, in a browser, before the
    // App Store takes over. One interstitial hop buys the timezone, screen geometry and
    // locale that lift this match from "someone on this NAT" to "this handset".
    //
    // Android with a Play listing deliberately skips it: the referrer already names the exact
    // scan, so a hop would cost conversion and buy nothing. Desktop and app-less publishers
    // skip it too — there is no install to attribute either way.
    if (platform === 'ios' && campaign.partnership.publisher.ios_app_id)
      return this.interstitial(res, claim_id, campaign.partnership.publisher.name, 'ios');

    // Straight to the store listing. No token, no code, no query the app can read and spend —
    // on Android the claim id travels only inside Play's install-referrer channel, which is
    // install attribution, not app content.
    res.redirect(destination);
  }

  /**
   * The only page in this API that runs script, so it is also the only one with a relaxed CSP.
   *
   * Everything about it is a fallback around a fallback, because the failure mode is silent —
   * a scanner who never reaches the store is a scanner the publisher never hears about:
   *   - script runs             → signals collected, `location.replace` after a short hold
   *   - script blocked / errors → `<meta refresh>` at 3s, no signals, so the match falls back
   *                               to IP + platform and is then correctly refused as too weak
   *   - both fail               → the Continue key is a real anchor to a real URL
   *
   * `claim_id` is base64url out of `randomBytes`, so it cannot carry markup — but it is
   * interpolated into an href and a script literal, so the shape is asserted rather than
   * assumed. A change to the generator must fail here, not open an injection point.
   */
  private interstitial(res: Response, claim_id: string, destination: string, store: Store) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(claim_id)) throw new Error('malformed claim id');
    const nonce = randomBytes(16).toString('base64');
    // Overrides the global `default-src 'none'`, which would otherwise block the inline script
    // this page exists for. A nonce rather than 'unsafe-inline': the markup is ours, and the
    // nonce means any future injection still cannot execute. `data:` is for the fibre tile.
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
        `img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Never cached: every render carries a different claim id and a single-use nonce.
    res.setHeader('Cache-Control', 'no-store');
    res.send(
      interstitialHtml({ destination, go: `${BASE_URL}/go/${claim_id}`, nonce, store }),
    );
  }

  /**
   * Second half of the interstitial: record what the browser measured, then hand the scanner
   * on to the store. A GET so the no-script `<meta refresh>` and the visible link reach it too.
   *
   * The QR use was already burned at `/r/:code` — a scanner who bails here still scanned, and
   * re-checking campaign status two seconds later would only add a way for this to fail.
   */
  @Get('go/:claimId')
  async go(
    @Param('claimId') claimId: string,
    // The whole query rather than a parameter each: the page sends a dozen and a half signals
    // and every one of them is optional on some engine, so an argument list would be eighteen
    // strings that only `normX`/`clientSignals` are allowed to interpret anyway.
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
            partnership: {
              select: {
                publisher: {
                  select: { landing_url: true, android_package: true, ios_app_id: true },
                },
              },
            },
          },
        },
      },
    });
    if (!scan) return end('invalid');

    // Normalised here rather than at match time so the column only ever holds comparable
    // values — a scan and a first-open that spell the same screen differently never match.
    const signals = {
      tz: normTz(q.tz),
      screen: normScreen(q.sc),
      language: normLang(q.lang),
      cores: normCores(q.cores),
      dark: normDark(q.dark),
      // Reporting only, and stored whole rather than merged: the page writes this column once
      // and nothing else ever reads it back to score anything.
      client: clientSignals(q),
    };
    // `consumed` guard: once an install is bound to this scan the signals are evidence of what
    // that decision was made on, and a replayed link must not rewrite them after the fact.
    if (!scan.consumed && Object.values(signals).some((v) => v !== null))
      await prisma.scan.updateMany({
        where: { id: scan.id, consumed: false },
        // language already holds the Accept-Language value; navigator.language overwrites it
        // deliberately, because that is the string the native SDK will report at first open.
        data: Object.fromEntries(Object.entries(signals).filter(([, v]) => v !== null)),
      });

    const destination = storeUrl(
      scan.platform as ReturnType<typeof detectPlatform>,
      scan.campaign.partnership.publisher,
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
    const qr = await prisma.qrCode.findUnique({ where: { id } });
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
    const url = `${BASE_URL}/r/${qr.code}`;
    // The flat PNG encoder cannot express shapes, gradients, logos or frames — those
    // styles are SVG-only here, and the studio rasterises them in the browser instead.
    if (format === 'png' && !isAdvanced(style)) {
      res.setHeader('Content-Type', 'image/png');
      res.send(await renderPng(url, style));
    } else {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(await renderSvg(url, style));
    }
  }

  // Style preview. A logo data URL is far past what a query string can carry, so the
  // live editor posts the style instead of encoding it into the image URL.
  @Post('v1/qr-codes/:id/preview')
  async qrPreview(
    @Param('id') id: string,
    @Body() body: { style?: QrStyle },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (await rateLimited(`qr-image:${clientIp(req)}`, 120))
      throw new BadRequestException('too many image requests, try again shortly');
    const qr = await prisma.qrCode.findUnique({ where: { id }, select: { code: true } });
    if (!qr) throw new NotFoundException();
    const style = validateStyle(body?.style ?? {});
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(await renderSvg(`${BASE_URL}/r/${qr.code}`, style));
  }
}
