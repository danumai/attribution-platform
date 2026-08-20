'use client';
import { num, when } from '@/lib/fmt';
import { Table } from '../Table';
import { pill, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading' | 'busy' | 'filterLedger'>;

export function Redemptions({ d, loading, busy, filterLedger }: Props) {
  const { link } = rowControls(busy);

  return (
    <Table
      loading={loading}
      rows={d.redemptions ?? []}
      empty="No redemptions yet."
      cols={[
        { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
        { h: 'Campaign', get: (x) => x.campaign_name },
        { h: 'Promoter', get: (x) => x.promoter_name },
        { h: 'Publisher', get: (x) => x.publisher_name },
        { h: 'Publisher user', sort: (x) => x.publisher_user_ref, get: (x) => <code>{x.publisher_user_ref}</code> },
        { h: 'Pays for', sort: (x) => x.kind, get: (x) => pill(x.kind === 'engagement' ? 'repeat' : 'signup') },
        // An engagement row is always settled in full — there is no guest tier for somebody
        // who already transacted — so this column only ever varies on acquisitions.
        {
          h: 'Tier',
          sort: (x) => x.identified,
          get: (x) => (x.kind === 'engagement' ? '—' : pill(x.identified ? 'identified' : 'guest')),
        },
        { h: 'Upgraded', sort: (x) => x.upgraded_at ?? '', get: (x) => when(x.upgraded_at) },
        { h: 'Coins', num: true, sort: (x) => x.coins, get: (x) => num(x.coins) },
        { h: '', get: (x) => link('Ledger', () => filterLedger(`campaign:${x.campaign_id}`)) },
      ]}
    />
  );
}
