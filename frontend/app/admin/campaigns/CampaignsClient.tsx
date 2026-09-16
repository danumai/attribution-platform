'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, Campaign, OrgType } from '@/lib/types';
import { Campaigns } from '../sections/Campaigns';

export function CampaignsClient({
  org,
  campaigns,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  campaigns: Campaign[];
  overview: AdminOverview;
  items: NavItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (fn: () => Promise<any>, ok = 'Done') => {
      setBusy(true);
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const patch = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'PATCH', body: JSON.stringify(body) }), ok);
  const post = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'POST', body: JSON.stringify(body) }), ok);
  const filterScans = (campaignId: string) => router.push(`/admin/scans?campaign_id=${campaignId}`);
  const filterLedger = (account: string) => router.push(`/admin/ledger?account=${encodeURIComponent(account)}`);

  return (
    <Shell
      org={org}
      items={items}
      active="Campaigns"
      title="Campaigns"
      lede="Budgets, conversion and the kill switch."
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
      <Campaigns
        d={{ campaigns }}
        loading={false}
        busy={busy}
        patch={patch}
        post={post}
        filterScans={filterScans}
        filterLedger={filterLedger}
      />
    </Shell>
  );
}
