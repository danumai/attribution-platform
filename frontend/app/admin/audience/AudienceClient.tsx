'use client';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { Audience, type Analytics } from '@/lib/audience';
import { num } from '@/lib/fmt';
import { btnGhost, cx, pillBad, select as selectField } from '@/lib/tw';
import type { AdminOverview, Campaign, OrgType } from '@/lib/types';

export function AudienceClient({
  org,
  campaigns,
  analytics,
  overview,
  items,
  campaignId,
  days,
}: {
  org: { id: string; name: string; type: OrgType };
  campaigns: Campaign[];
  analytics: Analytics;
  overview: AdminOverview;
  items: NavItem[];
  campaignId: string;
  days: number;
}) {
  const router = useRouter();

  const query = (next: { campaign_id?: string; days?: number }) => {
    const params = new URLSearchParams();
    const cid = next.campaign_id ?? campaignId;
    const d = next.days ?? days;
    if (cid) params.set('campaign_id', cid);
    if (d !== 30) params.set('days', String(d));
    const qs = params.toString();
    router.push(qs ? `/admin/audience?${qs}` : '/admin/audience');
  };

  const campaignPicker = (
    <select
      className={cx(selectField, 'mt-3 max-w-85')}
      value={campaignId}
      onChange={(e) => query({ campaign_id: e.target.value })}
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
      active="Audience"
      title="Audience"
      lede="Where scans come from, on what, and when. Everything here is read off the request the redirect already receives — a QR code carries nothing about whoever scanned it."
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
      {campaignPicker}
      <Audience
        data={analytics}
        days={days}
        onDays={(d) => query({ days: d })}
        scoped={Boolean(campaignId)}
      />
    </Shell>
  );
}
