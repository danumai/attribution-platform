import { Injectable } from '@nestjs/common';
import { audit, balance, ledger } from '../../common/ledger';
import { PrismaService, Tx } from '../../config/prisma';

/**
 * All funding-path data access, no signature checking or shaping. `complete` is here because its
 * idempotency gate and its two ledger entries must commit together, so `tx` never leaves this
 * file; `audit`/`balance` are wrapped, not duplicated.
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: PrismaService) {}

  // Ownership in the WHERE, not compared after: another tenant's campaign comes back `null` for
  // a 404, since a permission error would confirm the id exists.
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

  // Guarded on `pending` like `complete`: a failure arriving after a credit must not undo it.
  async markFailed(paymentId: string, providerRef: string) {
    await this.db.payment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'failed', provider_ref: providerRef, completed_at: new Date() },
    });
  }

  /**
   * Take the payment and credit the budget once; false means this delivery lost the gate, the
   * normal answer to a redelivery. Ref `fund:{payment_id}` is a second guard via
   * UNIQUE (account, ref).
   */
  complete(
    paymentId: string,
    campaignId: string,
    coins: number,
    providerRef: string,
  ): Promise<boolean> {
    return this.db.$transaction(async (tx: Tx) => {
      // Idempotency gate: the same UPDATE tests and flips the status, so redeliveries reach the
      // ledger once. The partial unique index on provider_ref stops one charge completing two rows.
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

  // Tenant actor so it lands in the admin inbox; called after the credit commits so the quoted
  // budget is the one the campaign now holds.
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
