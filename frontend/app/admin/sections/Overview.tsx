'use client';
import { ScanTrend, dailySeries } from '@/lib/audience';
import { Figures } from '@/components/ui/figures';
import { LoadError } from '@/components/ui/loadError';
import { SkeletonStrip } from '@/components/ui/skeleton';
import { Split } from '@/components/ui/split';
import { num } from '@/lib/fmt';
import { card, cx, muted, queueCount, queueRow, sectionHead, stampCaps } from '@/lib/tw';
import { LedgerHealth, counts } from '../cells';
import type { SectionProps, Tab } from '../types';

type Props = Pick<SectionProps, 'd' | 'go'> & {
  failed: boolean;
  loadErr: string;
  onRetry: () => void;
};

export function Overview({ d, go, failed, loadErr, onRetry }: Props) {
  const o = d.overview;
  if (!o) return failed ? <LoadError message={loadErr} onRetry={onRetry} /> : <SkeletonStrip className="mt-3" />;

  // The shape behind the two headline figures, gaps included: a quiet day the analytics query
  // never returned still has to draw as a trough, or the trace flatters itself.
  const trend = dailySeries(d.analytics ?? null);

  return (
    <>
      {/* The one thing a platform operator has to know before anything else: does the money
          add up. It leads the page rather than sitting in a footnote row. */}
      <LedgerHealth ok={o.ledger_balanced} sum={o.ledger_sum} onOpen={() => go('Ledger')} />

      <h2 className={sectionHead}>Live now</h2>
      <Figures
        className="mt-3"
        onPick={(dest) => go(dest as Tab)}
        items={[
          { k: 'Scans, last 24h', v: num(o.scans_24h), go: 'Audience', spark: trend.scans },
          { k: 'Active campaigns', v: num(o.active_campaigns), go: 'Campaigns' },
          {
            k: 'Scan → signup',
            v: `${((o.conversion_rate ?? 0) * 100).toFixed(1)}%`,
            go: 'Audience',
            spark: trend.signups,
          },
        ]}
      />

      {/* Three integers say where the platform is; only a line says which way it is going,
          which is the question this page is opened to answer. Same query and same window as
          the Audience tab, so the two cannot disagree about a day. */}
      <ScanTrend className="mt-3" data={d.analytics ?? null} />

      {/* Exact, unlike the dashboard's version of the same split: these two counts come off
          the overview endpoint rather than being derived from a capped page of rows. */}
      {o.redemptions > 0 && (
        <div className={cx(card, 'mt-3')}>
          <div className="flex items-baseline justify-between gap-3">
            <b className={stampCaps}>Verified vs guest</b>
            <span className={muted}>{num(o.redemptions)} redemptions</span>
          </div>
          <Split className="mt-3" verified={o.identified_redemptions} guest={o.guest_redemptions} />
          <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-soft">
            <span>
              <b className="font-semibold text-ok">{num(o.identified_redemptions)}</b> verified
            </span>
            <span>
              <b className="font-semibold text-warn">{num(o.guest_redemptions)}</b> still guest
            </span>
          </div>
        </div>
      )}

      <h2 className={sectionHead}>Needs attention</h2>
      <div className={cx(card, 'mt-3 p-2')}>
        {(
          [
            ['Tenant changes you have not acknowledged', o.open_notifications, 'Notifications'],
            ['Partnerships waiting on a publisher', o.pending_partnerships, 'Partnerships'],
            ['Suspended organizations', o.suspended_orgs, 'Organizations'],
            ['Voided QR codes', o.voided_codes, 'QR codes'],
          ] as [string, number | undefined, Tab][]
        ).map(([k, v, dest]) => (
          <button className={queueRow} key={k} onClick={() => go(dest)}>
            <span className={queueCount(Boolean(v))}>{num(v ?? 0)}</span>
            <span>{k}</span>
            <span className="ml-auto text-mut" aria-hidden="true">
              →
            </span>
          </button>
        ))}
        {!o.open_notifications && !o.pending_partnerships && !o.suspended_orgs && !o.voided_codes && (
          <p className={cx(muted, 'px-3 py-2.5')}>Nothing is waiting on you.</p>
        )}
      </div>

      <h2 className={sectionHead}>Coins</h2>
      <Figures
        className="mt-3"
        items={counts([
          ['funded', o.total_funded],
          ['granted', o.coins_granted],
          ['unspent', (o.total_funded ?? 0) - (o.coins_granted ?? 0)],
          ['identified', o.identified_redemptions],
          ['guest', o.guest_redemptions],
        ])}
      />

      <h2 className={sectionHead}>Platform</h2>
      <Figures
        className="mt-3"
        items={counts([
          ['promoters', o.promoters],
          ['publishers', o.publishers],
          ['partnerships', o.partnerships],
          ['campaigns', o.campaigns],
          ['QR codes', o.qr_codes],
          ['scans', o.scans],
          ['redemptions', o.redemptions],
        ])}
      />
    </>
  );
}
