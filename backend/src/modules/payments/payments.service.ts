import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { log } from '../../common/obs';
import { capped } from '../../common/paging';
import { str } from '../../common/security';
import { PAYMENT_WEBHOOK_SECRET } from '../../config';
import { CheckoutBody, WebhookBody } from './dto/bodies.dto';
import { PaymentsRepository } from './payments.repository';

/**
 * The funding policy: who may buy budget for which campaign, and what makes a PSP callback
 * believable. The repository holds the statements; the two guarantees those statements enforce —
 * one credit per webhook, one completed payment per charge — are documented there.
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly repo: PaymentsRepository) {}

  /**
   * Step one of funding: record what the promoter is buying before any money moves. The PSP
   * checkout is created against this row's id, so an unsolicited "payment succeeded" for an id we
   * never minted is a 404, not a credit.
   */
  async checkout(orgId: string, b: CheckoutBody) {
    const campaign_id = str(b.campaign_id, 'campaign_id', 36)!;
    if (!Number.isInteger(b.coins) || b.coins < 1 || b.coins > 10_000_000)
      throw new BadRequestException('coins must be 1–10000000');
    const campaign = await this.repo.ownedCampaign(campaign_id, orgId);
    if (!campaign) throw new NotFoundException('campaign not found');
    // Funding an ended campaign is a mistake worth catching before the card is charged; a paused
    // one is fine — topping up mid-pause is a normal way to prepare a relaunch.
    if (campaign.status === 'ended')
      throw new BadRequestException('campaign has ended — create a new one to fund');

    const payment = await this.repo.createPayment(campaign_id, orgId, b.coins);
    return {
      payment_id: payment.id,
      coins: payment.coins,
      status: payment.status,
      /** hand this id to the PSP as metadata; its webhook must POST it back to /v1/payments/webhook */
      created_at: payment.created_at,
    };
  }

  /** The promoter's own funding history — pending rows here are checkouts the PSP never confirmed. */
  list(orgId: string, limit?: string) {
    return this.repo.listPayments(orgId, capped(limit));
  }

  /**
   * The PSP's server calling back. Authentication is the HMAC signature over the raw body, and
   * with no secret configured the endpoint does not exist: an unsigned funding webhook is a mint
   * for whoever finds the URL.
   */
  async webhook(raw: Buffer | undefined, signature: string, b: WebhookBody) {
    if (!PAYMENT_WEBHOOK_SECRET) throw new NotFoundException();
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

    const payment = await this.repo.findPayment(payment_id);
    if (!payment) throw new NotFoundException('unknown payment_id');

    if (b.status === 'failed') {
      await this.repo.markFailed(payment_id, provider_ref);
      return { payment_id, status: 'failed' };
    }

    const credited = await this.repo.complete(
      payment_id,
      payment.campaign_id,
      payment.coins,
      provider_ref,
    );

    if (credited) {
      log.info('payment.completed', {
        payment_id,
        campaign_id: payment.campaign_id,
        coins: payment.coins,
        provider_ref,
      });
      await this.repo.auditFunding(
        payment.org_id,
        payment.campaign_id,
        payment.coins,
        payment_id,
        provider_ref,
      );
    }
    return {
      payment_id,
      status: 'completed',
      /** true when this delivery moved no money — the normal answer to a redelivered webhook */
      replay: !credited,
    };
  }
}
