'use client';
/** The small render helpers the admin tables share: cell formatters and the two row controls. */
import type { Figure } from '@/lib/ui';
import type { AdminScan, AuditEntry } from '@/lib/types';
import type { Col } from './Table';
import { num } from '@/lib/fmt';
import {
  cx,
  health,
  healthMark,
  linkish,
  menuItem,
  muted,
  pill as pillFor,
} from '@/lib/tw';

export const pill = (s: string) => <span className={pillFor(s)}>{s}</span>;

// Fallback only: scans recorded before the signal columns existed have nothing but their UA.
// ponytail: crude UA bucketing. New scans carry `device_type` from the server instead.
export const device = (ua: string) =>
  !ua ? '—' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mobile/.test(ua) ? 'Mobile' : 'Desktop';

/**
 * How the hand-off screen behaved on one scan, as a single hover.
 *
 * Two facts, and the shortness is deliberate: this used to carry a dozen values describing the
 * handset itself, which is device fingerprinting whatever it is labelled. What is left is about
 * the *page* — how long it was held and how it was left — and it is read once, when somebody is
 * asking why a scan never attributed.
 *
 * `exit: auto` on an iPhone is the answer to that question: nobody tapped Continue, so nothing
 * was carried, so the install was organic as far as anyone can honestly say.
 */
export const handoff = (x: AdminScan) => {
  const rows = Object.entries(x.client ?? {}).filter(([, v]) => v !== null && v !== undefined);
  return rows.length
    ? rows.map(([k, v]) => `${k}  ${v}`).join('\n')
    : 'No hand-off screen — this scan went straight to its destination.';
};

/**
 * What an audit row records, shared by the Audit log and its unread end in Notifications.
 *
 * Shared because the two tabs read the same table: a notification that drifted into showing a
 * different `detail` shape from the permanent record would make the two disagree about what
 * happened, which is the one thing an audit trail may never do.
 */
export const auditCols: Col<AuditEntry>[] = [
  { h: 'Action', sort: (x) => x.action, get: (x) => <code>{x.action}</code> },
  { h: 'Target', sort: (x) => x.target, get: (x) => <code>{x.target}</code> },
  {
    h: 'Detail',
    sort: (x) => JSON.stringify(x.detail),
    get: (x) => <span className={cx(muted, 'whitespace-pre-wrap')}>{JSON.stringify(x.detail)}</span>,
  },
];

/** Counts, ready for the shared strip. */
export const counts = (items: [string, number | undefined][]): Figure[] =>
  items.map(([k, v]) => ({ k, v: num(v ?? 0) }));

/**
 * The two row controls, bound to the page's `busy` flag once per section.
 *
 * Curried rather than taking `busy` per call so the call sites read as the action they are —
 * `link('Suspend', …)` — and a section cannot forget to disable one while a mutation is in
 * flight, which is what double-submits a payout.
 */
export function rowControls(busy: boolean) {
  return {
    /** An in-page jump. A button, not an <a> without an href — that takes no keyboard focus. */
    link: (label: string, onClick: () => void, danger = false) => (
      <button className={cx(linkish, danger && 'text-bad')} disabled={busy} onClick={onClick}>
        {label}
      </button>
    ),
    /** One row inside an Actions menu. */
    item: (label: string, onClick: () => void, danger = false) => (
      <button key={label} className={menuItem(danger)} disabled={busy} onClick={onClick}>
        {label}
      </button>
    ),
  };
}

/**
 * Whether the platform's coins still sum to zero.
 *
 * It leads the Overview and it opens the Ledger, because those are the two places an
 * operator looks before authorising anything, and an integrity check that is only on one of
 * them is a check the other page silently claims to have passed.
 */
export function LedgerHealth({ ok, sum, onOpen }: { ok: boolean; sum: number; onOpen?: () => void }) {
  return (
    <div className={health(ok)}>
      <div className={healthMark(ok)} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ok ? <path d="m5 10.5 3.2 3L15 6.5" /> : <path d="M10 5.5v5.5M10 14v.1" />}
        </svg>
      </div>
      <div>
        <b className="font-[650] tracking-[-0.015em]">
          {ok ? 'Ledger balanced' : `Ledger off by ${num(sum)}`}
        </b>
        <p className={cx(muted, 'mt-0.75 max-w-[62ch]')}>
          {ok
            ? 'Every entry sums to zero — no coins have been created or lost.'
            : 'Entries do not sum to zero. Coins have been created or destroyed outside the ledger — investigate before any payout.'}
        </p>
      </div>
      {!ok && onOpen && (
        <span className="ml-auto self-center whitespace-nowrap">
          <button className={linkish} onClick={onOpen}>
            Open the ledger
          </button>
        </span>
      )}
    </div>
  );
}
