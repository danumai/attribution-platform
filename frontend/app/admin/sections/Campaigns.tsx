'use client';
import { promptDialog } from '@/components/ui/dialog';
import { num } from '@/lib/fmt';
import { cx, select as selectField } from '@/lib/tw';
import { Actions, Table } from '../Table';
import { pill, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<
  SectionProps,
  'd' | 'loading' | 'busy' | 'patch' | 'post' | 'filterScans' | 'filterLedger'
>;

export function Campaigns({ d, loading, busy, patch, post, filterScans, filterLedger }: Props) {
  const { item } = rowControls(busy);
  /** What one redemption costs this campaign — the engagement price, or the signup one. */
  const rate = (x: { mode: string; engagement_rate: number; coin_rate: number }) =>
    x.mode === 'engagement' ? x.engagement_rate : x.coin_rate;

  return (
    <Table
      loading={loading}
      rows={d.campaigns ?? []}
      cols={[
        { h: 'Campaign', get: (x) => x.name },
        { h: 'Promoter', get: (x) => x.promoter_name },
        { h: 'Publisher', get: (x) => x.publisher_name },
        // Which guarantee this campaign's redemptions live under. Worth a column of its own
        // because it changes what every other number on the row means: an engagement
        // campaign's conversion is per purchase, not per person.
        { h: 'Pays for', sort: (x) => x.mode, get: (x) => pill(x.mode === 'engagement' ? 'repeat' : 'signup') },
        { h: 'Rate', num: true, sort: rate, get: rate },
        // `scans`/`redemptions` are counted only by the admin listing, hence optional
        { h: 'Scans', num: true, get: (x) => x.scans ?? 0 },
        { h: 'Redemptions', num: true, get: (x) => x.redemptions ?? 0 },
        {
          h: 'Conv.',
          num: true,
          sort: (x) => (x.scans ? (x.redemptions ?? 0) / x.scans : -1),
          get: (x) => (x.scans ? `${(((x.redemptions ?? 0) / x.scans) * 100).toFixed(0)}%` : '—'),
        },
        {
          h: 'Budget',
          num: true,
          sort: (x) => x.budget,
          get: (x) => <span className={x.budget < rate(x) ? 'text-bad' : ''}>{num(x.budget)}</span>,
        },
        {
          h: 'Status',
          sort: (x) => x.status,
          get: (x) => (
            <select
              className={cx(selectField, 'w-27.5 px-2 py-1.5 text-[13px]')}
              value={x.status}
              onChange={(e) => patch(`/v1/admin/campaigns/${x.id}`, { status: e.target.value }, 'Campaign updated')}
            >
              {['active', 'paused', 'ended'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          ),
        },
        {
          h: '',
          get: (x) => (
            <Actions>
              {item('Adjust budget', async () => {
                const v = await promptDialog({
                  title: `Adjust budget for "${x.name}"`,
                  body: `Current budget is ${num(x.budget)} coins. Negative claws back; the result cannot go below zero.`,
                  inputLabel: 'Coins',
                  input: '100',
                  confirmText: 'Adjust',
                });
                if (v) post(`/v1/admin/campaigns/${x.id}/adjust`, { coins: +v }, 'Budget adjusted');
              })}
              {item('View its scans', () => filterScans(x.id))}
              {item('View its ledger', () => filterLedger(`campaign:${x.id}`))}
              {x.status !== 'ended' &&
                item(
                  'Kill campaign',
                  async () => {
                    const reason = await promptDialog({
                      title: `Kill "${x.name}"?`,
                      body: 'Ends the campaign and voids every QR code it ever issued. Printed codes stop working immediately.',
                      inputLabel: 'Reason',
                      input: '',
                      confirmText: 'Kill campaign',
                      danger: true,
                    });
                    if (reason !== null) post(`/v1/admin/campaigns/${x.id}/kill`, { reason }, 'Campaign killed');
                  },
                  true,
                )}
            </Actions>
          ),
        },
      ]}
    />
  );
}
