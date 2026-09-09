import { Injectable } from '@nestjs/common';
import { audit, balance, ledger } from '../../common/ledger';
import { PrismaService, Tx } from '../../config/prisma';

/**
 * Every read and write the funding path performs, and nothing else — no signature checking, no
 * shaping.
 *
 * Two things live here that look like policy and are not misplaced:
 *
 *  - `complete`, the transactional unit. Its idempotency gate is the `updateMany` that flips
 *    `pending` to `completed`: the same statement that tests the status sets it, so a redelivered
 *    webhook loses the race in the database rather than in a service branch. That gate and the two
 *    ledger entries have to commit or roll back together, so a transaction boundary is a
 *    data-access boundary and the service never handles a `tx`.
 *  - `audit` and `balance`, which are already data access shared with the other modules. Wrapped
 *    rather than duplicated.
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Ownership is inside the WHERE rather than compared afterwards, so another tenant's campaign
   * comes back `null` and the service answers 404 — a permission error would confirm the id exists.
   */
  ownedCampaign(campaignId: string, orgId: string) {
    return this.db.campaign.findFirst({
      where: { id: campaignId, partnership: { promoter_org_id: orgId } },
      select: { id: true, status: true },
    });
  }

  createPayment(campaignId: string, orgId: string, coins: number) {
    return this.db.payment.create({
      data: { campaign_id: campaignId, org_id: orgId, coins },
      select: { id: true, coins: true, status: true, created_at: true },
    });
  }

  listPayments(orgId: string, take: number) {
    return this.db.payment.findMany({
      where: { org_id: orgId },
      orderBy: { created_at: 'desc' },
      take,
    });
  }

  findPayment(paymentId: string) {
    return this.db.payment.findUnique({ where: { id: paymentId } });
  }

  /** Guarded on `pending` for the same reason `complete` is: a failure after a credit is not news. */
  async markFailed(paymentId: string, providerRef: string) {
    await this.db.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'failed', provider_ref: providerRef, completed_at: new Date() },
    });
  }

  /**
   * Take the payment and credit the budget, once. Returns false when this delivery lost the gate,
   * which is the normal answer to a PSP redelivering — not an error.
   *
   * The ledger ref `fund:{payment_id}` is a second, independent guard: UNIQUE (account, ref) means
   * even a gate that somehow passed twice cannot write the entries twice.
   */
  complete(
    paymentId: string,
    campaignId: string,
    coins: number,
    providerRef: string,
  ): Promise<boolean> {
    return this.db.$transaction(async (tx: Tx) => {
      // The idempotency gate: flipped by the same UPDATE that tests it, so ten redeliveries reach
      // the ledger once. The partial unique index on provider_ref additionally stops one PSP
      // charge completing a *different* payment row.
      const taken = await tx.payment.updateMany({
        where: { id: paymentId, status: 'pending' },
        data: { status: 'completed', provider_ref: providerRef, completed_at: new Date() },
      });
      if (!taken.count) return false;
      const ref = `fund:${paymentId}`;
      await ledger(tx, 'external:funding', -coins, ref);
      await ledger(tx, `campaign:${campaignId}`, coins, ref);
      return true;
    });
  }

  /**
   * Actor is the tenant whose money arrived, so it lands in the admin inbox — money entering the
   * system is always news. Written after the credit commits, so the budget it quotes is the one
   * the campaign now holds.
   */
  async auditFunding(
    orgId: string,
    campaignId: string,
    coins: number,
    paymentId: string,
    providerRef: string,
  ) {
    await audit(orgId, 'campaign.fund', `campaign:${campaignId}`, {
      coins,
      payment_id: paymentId,
      provider_ref: providerRef,
      budget: await balance(`campaign:${campaignId}`),
    });
  }
}
