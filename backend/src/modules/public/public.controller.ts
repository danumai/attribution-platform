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
import { clientIp, rateLimited, sha256 } from '../../common/security';
import { balance } from '../../database/ledger';
import { prisma } from '../../database/prisma';
import { signScanToken } from '../auth/tokens';

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
            partnership: { select: { publisher: { select: { landing_url: true } } } },
          },
        },
      },
    });
    if (!qr) return end('invalid');
    if (qr.voided) return end('voided');
    const campaign = qr.campaign;
    if (campaign.status !== 'active')
      return end(campaign.status === 'paused' ? 'paused' : 'ended');
    if ((await balance(`campaign:${campaign.id}`)) <= 0) return end('budget');

    // Claim one use atomically — this is both the expiry check and the single/multi-use check,
    // so two simultaneous scans can never both take the last use of a code. Raw because
    // `uses < max_uses` compares two columns, which the query builder cannot express.
    const claimed = await prisma.$queryRaw<{ uses: number }[]>`
      UPDATE qr_codes SET uses = uses + 1
      WHERE id = ${qr.id}::uuid AND NOT voided
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR uses < max_uses)
      RETURNING uses`;
    if (!claimed.length)
      return end(qr.expires_at && qr.expires_at <= new Date() ? 'expired' : 'used_up');

    const scan = await prisma.scan.create({
      data: {
        qr_code_id: qr.id,
        campaign_id: campaign.id,
        ip: sha256(ip).slice(0, 16),
        user_agent: (req.headers['user-agent'] ?? '').slice(0, 300),
      },
      select: { id: true },
    });
    const token = signScanToken({ scan_id: scan.id, campaign_id: campaign.id });
    const landing =
      campaign.partnership.publisher.landing_url || `${FRONTEND_URL}/publisher-sim`;
    const sep = landing.includes('?') ? '&' : '?';
    res.redirect(`${landing}${sep}st=${token}`);
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
