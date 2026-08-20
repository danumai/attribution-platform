'use client';
import { when } from '@/lib/fmt';
import { cx, field } from '@/lib/tw';
import { Table } from '../Table';
import { pill, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading' | 'busy' | 'patch'>;

/** The four priced fields, and the column heading each is read under. */
const RATES = [
  ['coin_rate', 'Coins / signup'],
  ['guest_rate', 'Guest rate'],
  ['engagement_rate', 'Coins / purchase'],
  ['grace_days', 'Grace (days)'],
] as const;

export function Partnerships({ d, loading, busy, patch }: Props) {
  const { link } = rowControls(busy);

  return (
    <Table
      loading={loading}
      rows={d.partnerships ?? []}
      cols={[
        { h: 'Promoter', get: (x) => x.promoter_name },
        { h: 'Publisher', get: (x) => x.publisher_name },
        ...RATES.map(([f, h]) => ({
          h,
          sort: (x: any) => x[f],
          get: (x: any) => (
            <input
              className={cx(field, 'w-22.5 px-2 py-1.5 text-[13px]')}
              type="number"
              defaultValue={x[f]}
              onBlur={(e) =>
                +e.target.value !== x[f] &&
                patch(`/v1/admin/partnerships/${x.id}`, { [f]: +e.target.value }, 'Rate updated')
              }
            />
          ),
        })),
        { h: 'Status', sort: (x) => x.status, get: (x) => pill(x.status) },
        { h: 'Created', get: (x) => when(x.created_at), sort: (x) => x.created_at },
        {
          h: '',
          // Pausing sets `suspended`, not `pending`: `pending` is the publisher's own inbox
          // state, and a publisher can accept its way out of that one.
          get: (x) =>
            x.status === 'active'
              ? link('Suspend', () =>
                  patch(`/v1/admin/partnerships/${x.id}`, { status: 'suspended' }, 'Partnership suspended'),
                )
              : link(x.status === 'pending' ? 'Force approve' : 'Reactivate', () =>
                  patch(`/v1/admin/partnerships/${x.id}`, { status: 'active' }, 'Partnership approved'),
                ),
        },
      ]}
    />
  );
}
