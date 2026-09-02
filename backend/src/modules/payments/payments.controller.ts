/**
 * Money in — the production replacement for ALLOW_SELF_FUNDING.
 *
 * PSP-agnostic on purpose: `checkout` records what the promoter intends to buy and hands back a
 * `payment_id`; the PSP carries that id in its metadata and its webhook adapter POSTs the result
 * to `webhook`, signed. Swapping processors is an adapter, not a schema change.
 *
 * Two guarantees, both database-enforced:
 *   - a webhook redelivered N times credits once — `status` is flipped by the same UPDATE that
 *     tests it, and the ledger ref `fund:{payment_id}` collides on UNIQUE (account, ref)
 *   - one PSP charge completes at most one payment — partial unique index on `provider_ref`
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PAYMENT_WEBHOOK_SECRET } from '../../config';
import { capped } from '../../common/paging';
import { str } from '../../common/security';
import { audit, balance, ledger } from '../../database/ledger';
import { prisma } from '../../database/prisma';
import { log } from '../../common/obs';
import { AuthGuard, Session } from '../auth/auth.guard';
import { SessionClaims } from '../auth/tokens';

@ApiTags('Payments')
@Controller('v1/payments')
export class PaymentsController {
  /**
   * Step one of funding: record what the promoter is buying before any money moves. The PSP
   * checkout is created against this row's id, so an unsolicited "payment succeeded" for an id we
   * never minted is a 404, not a credit.
   */
  @Post('checkout')
  @ApiBearerAuth('session')
  @UseGuards(AuthGuard)
  async checkout(
    @Session() s: SessionClaims,
    @Body() b: { campaign_id: string; coins: number },
  ) {
    const campaign_id = str(b.campaign_id, 'campaign_id', 36)!;
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    // Ownership inside the WHERE — someone else's campaign is a 404, not a permission error.
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaign_id, partnership: { promoter_org_id: s.org_id } },
      select: { id: true, status: true },
    });
    if (!campaign) throw new NotFoundException('campaign not found');
    // Funding an ended campaign is a mistake worth catching before the card is charged; a paused
    // one is fine — topping up mid-pause is a normal way to prepare a relaunch.
    if (campaign.status === 'ended')
      throw new BadRequestException('campaign has ended — create a new one to fund');

    const payment = await prisma.payment.create({
      data: { campaign_id, org_id: s.org_id, coins: b.coins },
      select: { id: true, coins: true, status: true, created_at: true },
    });
    return {
      payment_id: payment.id,
      coins: payment.coins,
      status: payment.status,
      /** hand this id to the PSP as metadata; its webhook must POST it back to /v1/payments/webhook */
      created_at: payment.created_at,
    };
  }

  /** The promoter's own funding history — pending rows here are checkouts the PSP never confirmed. */
  @Get()
  @ApiBearerAuth('session')
  @UseGuards(AuthGuard)
  async list(@Session() s: SessionClaims, @Query('limit') limit?: string) {
    return prisma.payment.findMany({
      where: { org_id: s.org_id },
      orderBy: { created_at: 'desc' },
      take: capped(limit),
    });
  }

  /**
   * The PSP's server calling back. Authentication is the HMAC signature over the raw body, and
   * with no secret configured the endpoint does not exist: an unsigned funding webhook is a mint
   * for whoever finds the URL.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request,
    @Headers('x-payment-signature') signature: string,
    @Body() b: { payment_id?: string; provider_ref?: string; status?: string },
  ) {
    if (!PAYMENT_WEBHOOK_SECRET) throw new NotFoundException();
    const raw: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
    const expected = createHmac('sha256', PAYMENT_WEBHOOK_SECRET)
      .update(raw ?? Buffer.alloc(0))
      .digest('hex');
    const presented = (signature ?? '').trim().toLowerCase();
    // Constant-time, same reason as the metrics token: `!==` leaks the prefix to a prober.
    const ok =
      presented.length === expected.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
    if (!ok) throw new UnauthorizedException('bad signature');

    const payment_id = str(b.payment_id, 'payment_id', 36)!;
    const provider_ref = str(b.provider_ref, 'provider_ref', 200)!;
    if (!['succeeded', 'failed'].includes(b.status ?? ''))
      throw new BadRequestException('status must be succeeded|failed');

    const payment = await prisma.payment.findUnique({ where: { id: payment_id } });
    if (!payment) throw new NotFoundException('unknown payment_id');

    if (b.status === 'failed') {
      await prisma.payment.updateMany({
        where: { id: payment_id, status: 'pending' },
        data: { status: 'failed', provider_ref, completed_at: new Date() },
      });
      return { payment_id, status: 'failed' };
    }

    const credited = await prisma.$transaction(async (tx) => {
      // The idempotency gate: flipped by the same UPDATE that tests it, so ten redeliveries reach
      // the ledger once. The partial unique index on provider_ref additionally stops one PSP
      // charge completing a *different* payment row.
      const taken = await tx.payment.updateMany({
        where: { id: payment_id, status: 'pending' },
        data: { status: 'completed', provider_ref, completed_at: new Date() },
      });
      if (!taken.count) return false;
      const ref = `fund:${payment_id}`;
      await ledger(tx, 'external:funding', -payment.coins, ref);
      await ledger(tx, `campaign:${payment.campaign_id}`, payment.coins, ref);
      return true;
    });

    if (credited) {
      log.info('payment.completed', {
        payment_id,
        campaign_id: payment.campaign_id,
        coins: payment.coins,
        provider_ref,
      });
      // Actor is the tenant whose money arrived, so it lands in the admin inbox — money entering
      // the system is always news.
      await audit(payment.org_id, 'campaign.fund', `campaign:${payment.campaign_id}`, {
        coins: payment.coins,
        payment_id,
        provider_ref,
        budget: await balance(`campaign:${payment.campaign_id}`),
      });
    }
    return {
      payment_id,
      status: 'completed',
      /** true when this delivery moved no money — the normal answer to a redelivered webhook */
      replay: !credited,
    };
  }
}
