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
 * Read a balance and hold its row for the rest of the transaction, so two concurrent debits
 * cannot both pass the same `>= 0` check. Every money path that spends goes through this;
 * Prisma has no `FOR UPDATE` builder, which is why it is raw.
 */
export async function lockedBalance(tx: Tx, account: string): Promise<number> {
  const rows = await tx.$queryRaw<{ balance: number }[]>`
    SELECT balance FROM account_balances WHERE account = ${account} FOR UPDATE`;
  return rows[0]?.balance ?? 0;
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
