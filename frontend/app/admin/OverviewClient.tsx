'use client';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import type { Analytics } from '@/lib/audience';
import type { AdminOverview, OrgType } from '@/lib/types';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import { Overview } from './sections/Overview';
import { TAB_HREF } from './navItems';
import type { Tab } from './types';

export function OverviewClient({
  org,
  overview,
  analytics,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  overview: AdminOverview;
  analytics: Analytics;
  items: NavItem[];
}) {
  const router = useRouter();

  return (
    <Shell
      org={org}
      items={items}
      active="Overview"
      title="Overview"
      lede="Does the money add up, and what is waiting on you."
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
      <Overview
        d={{ overview, analytics }}
        go={(tab: Tab) => router.push(TAB_HREF[tab] ?? '/admin')}
        failed={false}
        loadErr=""
        onRetry={() => router.refresh()}
      />
    </Shell>
  );
}