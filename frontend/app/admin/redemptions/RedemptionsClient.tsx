'use client';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, OrgType, Redemption } from '@/lib/types';
import { Redemptions } from '../sections/Redemptions';

export function RedemptionsClient({
  org,
  redemptions,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  redemptions: Redemption[];
  overview: AdminOverview;
  items: NavItem[];
}) {
  const router = useRouter();
  const busy = false;

  const filterLedger = (account: string) => router.push(`/admin/ledger?account=${encodeURIComponent(account)}`);

  return (
    <Shell
      org={org}
      items={items}
      active="Redemptions"
      title="Redemptions"
      lede="Every signup a publisher vouched for."
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
      <Redemptions d={{ redemptions }} loading={false} busy={busy} filterLedger={filterLedger} />
    </Shell>
  );
}
