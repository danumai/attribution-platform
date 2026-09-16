'use client';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, Ledger as LedgerData, OrgType } from '@/lib/types';
import { Ledger } from '../sections/Ledger';

export function LedgerClient({
  org,
  ledger,
  overview,
  items,
  account,
}: {
  org: { id: string; name: string; type: OrgType };
  ledger: LedgerData;
  overview: AdminOverview;
  items: NavItem[];
  account: string;
}) {
  const router = useRouter();
  const busy = false;

  const onAccount = (account: string) =>
    router.push(account ? `/admin/ledger?account=${encodeURIComponent(account)}` : '/admin/ledger');

  return (
    <Shell
      org={org}
      items={items}
      active="Ledger"
      title="Ledger"
      lede="Account balances and the entries behind them."
      actions={
        <>
          {!overview.ledger_balanced && (
            <span className={pillBad}>ledger off by {num(overview.ledger_sum)}</span>
          )}
          <button className={btnGhost} onClick={() => router.refresh()}>
            Refresh
          </button>
        </>
      }
    >
      <Ledger d={{ ledger, overview }} loading={false} busy={busy} account={account} onAccount={onAccount} />
    </Shell>
  );
}
