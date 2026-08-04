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
import { detectPlatform, storeUrl } from '../../common/attribution';
import { clientIp, ipHash, rateLimited } from '../../common/security';
import { scanSignals } from '../../common/signals';
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
    if (rateLimited(`scan:${ip}`, 30)) return end('rate_limited');

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
    // creation, but an admin can send it back to `pending` afterwards — and that has to stop
    // scans, or the suspension lever silently does nothing while claims keep paying out.
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

    // Straight to the store listing. No token, no code, no query the app can read and spend —
    // on Android the claim id travels only inside Play's install-referrer channel, which is
    // install attribution, not app content.
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
    if (rateLimited(`qr-image:${clientIp(req)}`, 120))
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
    if (rateLimited(`qr-image:${clientIp(req)}`, 120))
      throw new BadRequestException('too many image requests, try again shortly');
    const qr = await prisma.qrCode.findUnique({ where: { id }, select: { code: true } });
    if (!qr) throw new NotFoundException();
    const style = validateStyle(body?.style ?? {});
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(await renderSvg(`${BASE_URL}/r/${qr.code}`, style));
  }
}
