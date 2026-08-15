import { budgetLow } from '../common/alerts';
import { splitFee } from '../common/rates';
import { SETTLEMENT_DELAY_DAYS } from '../config';
import { Tx, prisma } from './prisma';

/**
 * Credit/debit an account inside an open transaction, keeping the balance in sync.
 *
 * Seed-then-update rather than the obvious `upsert`, and the reason is subtle enough to be
 * worth stating: Postgres evaluates a table's CHECK constraints against the tuple an
 * `INSERT ... ON CONFLICT DO UPDATE` *proposes*, before it detects the conflict and switches
 * to the update. So `upsert` with `create: { balance: -10 }` is tested as a standalone
 * `balance = -10` row and rejected by `account_balances_non_negative_check` — even when the
 * account holds 100 and the resulting balance would be a perfectly legal 90.
 *
 * That made every debit in the system fail: claim, the confirm upgrade, and the admin
 * adjustment all route through here. Seeding the row at 0 first means the floor is only ever
 * checked against the value that actually lands.
 */
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

/**
 * Pay a publisher out of a campaign budget, keeping the platform's cut — every payout in the
 * system routes through here, so the split can never be applied on one path and forgotten on
 * another. Three entries under one ref, still summing to zero:
 *
 *   campaign:{id}     -gross     the promoter's budget spends the agreed rate
 *   publisher:{org}   +net       what the publisher actually earns
 *   platform:fees     +cut       the platform's revenue
 *
 * The caller must already hold the campaign balance lock and have checked it covers `gross`.
 */
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
  // The row is already locked by the caller's balance check, so this read is free of races —
  // and a budget about to run dry is the promoter's live print run about to start bouncing.
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM account_balances WHERE account = ${'campaign:' + campaignId}`;
  const remaining = rows[0]?.balance ?? 0;
  if (remaining < gross * 10) budgetLow(campaignId, remaining, gross);
  return { net, cut };
}

/**
 * Read a balance and hold its row for the rest of the transaction, so two concurrent debits
 * cannot both pass the same `>= 0` check. Every money path that spends goes through this;
 * Prisma has no `FOR UPDATE` builder, which is why it is raw.
 */
export async function lockedBalance(tx: Tx, account: string): Promise<number> {
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM account_balances WHERE account = ${account} FOR UPDATE`;
  return rows[0]?.balance ?? 0;
}

/**
 * What a publisher may withdraw right now: its balance, minus earnings still inside the
 * settlement window, minus requests already queued for review.
 *
 * The holdback is the platform's clawback window — the thing that turns "review the fraud
 * pattern" from advice into a control, because no coin earned less than
 * SETTLEMENT_DELAY_DAYS ago can leave while the review runs. Only credits are held: a debit
 * (an earlier withdrawal) never extends the wait on what remains.
 *
 * Takes the open transaction and expects the caller to have locked the balance row first —
 * two concurrent requests must serialise, or both can pass the same check.
 */
export async function withdrawable(tx: Tx, publisherOrgId: string): Promise<number> {
  const account = `publisher:${publisherOrgId}`;
  const bal = await lockedBalance(tx, account);
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

/**
 * Balances for many accounts in one round trip. The list endpoints render a budget per row,
 * so doing this one `balance()` at a time is a query per campaign on every page load.
 */
export async function balances(accounts: string[]): Promise<Map<string, number>> {
  if (!accounts.length) return new Map();
  const rows = await prisma.accountBalance.findMany({
    where: { account: { in: accounts } },
  });
  return new Map(rows.map((r) => [r.account, r.balance]));
}
