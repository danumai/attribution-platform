import { Tx, prisma } from './prisma';

/** Credit/debit an account inside an open transaction, keeping the balance in sync. */
export async function ledger(tx: Tx, account: string, amount: number, ref: string) {
  await tx.ledgerEntry.create({ data: { account, amount, ref } });
  await tx.accountBalance.upsert({
    where: { account },
    create: { account, balance: amount },
    update: { balance: { increment: amount } },
  });
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
