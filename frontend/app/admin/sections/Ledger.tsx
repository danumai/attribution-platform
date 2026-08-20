'use client';
import { num, when } from '@/lib/fmt';
import { filterBar, filterChip, filterChipDrop, muted, sectionHead } from '@/lib/tw';
import { Table } from '../Table';
import { LedgerHealth, rowControls } from '../cells';
import type { SectionProps } from '../types';

type Props = Pick<SectionProps, 'd' | 'loading' | 'busy'> & {
  account: string;
  onAccount: (account: string) => void;
};

export function Ledger({ d, loading, busy, account, onAccount }: Props) {
  const { link } = rowControls(busy);
  const o = d.overview;

  return (
    <>
      {/* The integrity check leads this tab as it leads the Overview. An operator who
          deep-links straight here would otherwise read balances with no way to know whether
          they still sum to zero. */}
      {o && <LedgerHealth ok={o.ledger_balanced} sum={o.ledger_sum} />}

      <h2 className={sectionHead}>Account balances</h2>
      <Table
        loading={loading}
        rows={d.ledger?.balances ?? []}
        empty="No accounts."
        cols={[
          { h: 'Account', sort: (x) => x.account, get: (x) => <code>{x.account}</code> },
          {
            h: 'Balance',
            num: true,
            sort: (x) => x.balance,
            // A balance carries its own sign: coins drawn out of an account are a debit, and
            // printing them in the same ink as a credit hides the direction.
            get: (x) => (
              <span className={x.balance < 0 ? 'text-bad' : x.balance > 0 ? 'text-ok' : ''}>
                {num(x.balance)}
              </span>
            ),
          },
          { h: '', get: (x) => link('Entries', () => onAccount(x.account)) },
        ]}
      />

      <h2 className={sectionHead}>Entries</h2>
      {/* What is narrowing the table is a control above it, not a clause inside the heading —
          a filter you cannot see is a filter you forget you set. */}
      <div className={filterBar}>
        {account ? (
          <>
            <span className={filterChip}>
              <code>{account}</code>
              <button
                className={filterChipDrop}
                onClick={() => onAccount('')}
                aria-label="Show every account"
                title="Show every account"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="m4.5 4.5 7 7m0-7-7 7" />
                </svg>
              </button>
            </span>
            <span className={muted}>Every entry posted against this account.</span>
          </>
        ) : (
          <span className={muted}>
            The 300 newest entries, every account. Pick one above to see all of its.
          </span>
        )}
      </div>
      <Table
        loading={loading}
        rows={d.ledger?.entries ?? []}
        empty="No entries."
        cols={[
          { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
          { h: 'Account', sort: (x) => x.account, get: (x) => <code>{x.account}</code> },
          {
            h: 'Amount',
            num: true,
            sort: (x) => x.amount,
            get: (x) => <span className={x.amount < 0 ? 'text-bad' : 'text-ok'}>{num(x.amount)}</span>,
          },
          { h: 'Ref', sort: (x) => x.ref, get: (x) => <code>{x.ref}</code> },
        ]}
      />
    </>
  );
}
