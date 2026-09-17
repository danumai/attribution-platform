'use client';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { num } from '@/lib/fmt';
import { btnGhost, cx, pillBad, select as selectField } from '@/lib/tw';
import type { AdminOverview, AdminScan, Campaign, OrgType, Redemption } from '@/lib/types';
import { Scans } from '../sections/Scans';

export function ScansClient({
  org,
  scans,
  redemptions,
  campaigns,
  overview,
  items,
  campaignId,
}: {
  org: { id: string; name: string; type: OrgType };
  scans: AdminScan[];
  redemptions: Redemption[];
  campaigns: Campaign[];
  overview: AdminOverview;
  items: NavItem[];
  campaignId: string;
}) {
  const router = useRouter();

  const campaignPicker = (
    <select
      className={cx(selectField, 'mt-3 max-w-85')}
      value={campaignId}
      onChange={(e) => router.push(e.target.value ? `/admin/scans?campaign_id=${e.target.value}` : '/admin/scans')}
      aria-label="Campaign"
    >
      <option value="">All campaigns</option>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} — {c.promoter_name}
        </option>
      ))}
    </select>
  );

  return (
    <Shell
      org={org}
      items={items}
      active="Scans"
      title="Scans"
      lede="Every QR scan, newest first. IPs are stored as a truncated hash — enough to spot a repeat scanner, not enough to identify a person."
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
      <Scans d={{ scans, redemptions }} loading={false} campaignPicker={campaignPicker} />
    </Shell>
  );
}
