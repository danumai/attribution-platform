import { budgetLow } from './alerts';
import { splitFee } from './rates';
import { SETTLEMENT_DELAY_DAYS } from '../config';
import { Tx, prisma } from '../config/prisma';

/** Credit/debit inside an open transaction. Seed-then-update, not `upsert`: Postgres checks the
 *  non-negative CHECK against the tuple `ON CONFLICT DO UPDATE` proposes, so -10 is rejected even
 *  when the account holds 100. */
export async function ledger(tx: Tx, account: string, amount: number, ref: string) {
  await tx.ledgerEntry.create({ data: { account, amount, ref } });
  await tx.$executeRaw`
    INSERT INTO account_balances (account, balance) VALUES (${account}, 0)
    ON CONFLICT (account) DO NOTHING`;
  await tx.$executeRaw`
    UPDATE account_balances SET balance = balance + ${amount} WHERE account = ${account}`;
}

/** Every privileged override is recorded, so rule changes are explainable after the fact. */
export async function audit(
  actor_org_id: string | null,
  action: string,
  target: string,
  detail: unknown = {},
) {
  await prisma.auditLog.create({
    data: { actor_org_id, action, target, detail: (detail ?? {}) as object },
  });
}

/** Sole payout path, so the fee split can't be forgotten. One ref, three entries summing to zero:
 *  campaign:{id} -gross, publisher:{org} +net, platform:fees +cut. Caller must already hold the
 *  campaign balance lock and have checked it covers `gross`. */
export async function payout(
  tx: Tx,
  campaignId: string,
  publisherId: string,
  gross: number,
  feeBps: number,
  ref: string,
): Promise<{ net: number; cut: number }> {
  const { net, cut } = splitFee(gross, feeBps);
  await ledger(tx, `campaign:${campaignId}`, -gross, ref);
  await ledger(tx, `publisher:${publisherId}`, net, ref);
  if (cut) await ledger(tx, 'platform:fees', cut, ref);
  // Row already locked by the caller's balance check, so this read is race-free; a budget about to
  // run dry is a live print run about to start bouncing.
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM account_balances WHERE account = ${'campaign:' + campaignId}`;
  const remaining = rows[0]?.balance ?? 0;
  if (remaining < gross * 10) budgetLow(campaignId, remaining, gross);
  return { net, cut };
}

/** Holds the row for the rest of the transaction, so two concurrent debits cannot both pass the
 *  same `>= 0` check. Raw because Prisma has no `FOR UPDATE` builder. */
export async function lockedBalance(tx: Tx, account: string): Promise<number> {
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM account_balances WHERE account = ${account} FOR UPDATE`;
  return rows[0]?.balance ?? 0;
}

/** Balance minus earnings still inside the settlement window minus queued requests; only credits
 *  are held, so an earlier withdrawal never extends the wait. `lock=false` when merely rendering:
 *  `FOR UPDATE` contends with every payout here, so a polled dashboard blocked the money path. */
export async function withdrawable(
  tx: Tx,
  publisherOrgId: string,
  lock = true,
): Promise<number> {
  const account = `publisher:${publisherOrgId}`;
  const bal = lock
    ? await lockedBalance(tx, account)
    : ((await tx.accountBalance.findUnique({ where: { account } }))?.balance ?? 0);
  const [held] = await tx.$queryRaw<{ recent: number; queued: number }[]>`
    SELECT
      (SELECT coalesce(sum(amount), 0)::int FROM ledger_entries
        WHERE account = ${account} AND amount > 0
          AND created_at > now() - make_interval(days => ${SETTLEMENT_DELAY_DAYS})) AS recent,
      (SELECT coalesce(sum(coins), 0)::int FROM withdrawals
        WHERE publisher_org_id = ${publisherOrgId}::uuid AND status = 'requested') AS queued`;
  return Math.max(0, bal - held.recent - held.queued);
}

export async function balance(account: string): Promise<number> {
  const r = await prisma.accountBalance.findUnique({ where: { account } });
  return r?.balance ?? 0;
}

/** Many accounts in one round trip; one `balance()` per row is a query per campaign per page load. */
export async function balances(accounts: string[]): Promise<Map<string, number>> {
  if (!accounts.length) return new Map();
  const rows = await prisma.accountBalance.findMany({
    where: { account: { in: accounts } },
  });
  return new Map(rows.map((r) => [r.account, r.balance]));
}
