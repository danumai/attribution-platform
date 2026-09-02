'use client';
import { Chart } from '@/lib/chart';
import { INK } from '@/lib/audience';
import { Empty, type Figure, Figures, SkeletonCard, SkeletonStrip, SkeletonTable, Split } from '@/lib/ui';
import type { Redemption } from '@/lib/types';
import { change, num } from '@/lib/fmt';
import { btn, card, cx, linkish, muted, queueCount, queueRow, sectionHead, stampCaps } from '@/lib/tw';
import { RedemptionTable } from '../RedemptionTable';
import type { Section, SectionProps } from '../types';

type Props = SectionProps & { onNewCampaign: () => void; canCreateCampaign: boolean };

/** `/v1/redemptions` returns the newest 100, so any total derived from it is a floor. */
const CAP = 100;

/**
 * Redemptions per day, counted off the rows this page already has. There is no scan-analytics
 * endpoint scoped to a whole promoter — only per campaign — so the only honest shape is this one.
 */
function perDay(rows: Redemption[]) {
  if (!rows.length) return null;
  const key = (t: string) => new Date(t).toISOString().slice(0, 10);
  const from = rows.map((r) => key(r.created_at)).reduce((a, b) => (a < b ? a : b));

  const slots: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.now(); t += 86_400_000)
    slots.push(new Date(t).toISOString().slice(0, 10));
  // A promoter two years in would otherwise get a 700-point plot in a 900px card, where a
  // day is a third of a pixel. The tail is the part anyone is reading for anyway.
  const days = slots.slice(-90);

  const total = new Map(days.map((k) => [k, 0]));
  const verified = new Map(days.map((k) => [k, 0]));
  for (const r of rows) {
    const k = key(r.created_at);
    if (!total.has(k)) continue;
    total.set(k, total.get(k)! + 1);
    if (r.identified) verified.set(k, verified.get(k)! + 1);
  }

  return {
    labels: days.map((k) =>
      new Date(`${k}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    ),
    total: days.map((k) => total.get(k)!),
    verified: days.map((k) => verified.get(k)!),
  };
}

export function Overview({ d, isPromoter, loaded, go, onNewCampaign, canCreateCampaign }: Props) {
  const { partnerships, campaigns, redemptions, profile } = d;
  const activePartnerships = partnerships.filter((p) => p.status === 'active');
  // a publisher is the one who has to act on a pending request; a promoter is only waiting
  const pending = partnerships.filter((p) => p.status === 'pending').length;
  const awaitingMe = isPromoter ? 0 : pending;
  // Same asymmetry for a repricing: the publisher decides, the promoter waits. Counted for both
  // so neither side has to remember an open proposal exists.
  const openProposals = partnerships.filter((p) => p.proposed_coin_rate !== null).length;

  const capped = redemptions.length >= CAP;
  const coinsGranted = redemptions.reduce((n, x) => n + (x.coins ?? 0), 0);
  const verified = redemptions.filter((x) => x.identified).length;
  const guests = redemptions.length - verified;
  const daily = perDay(redemptions);
  // Half the plotted span against the other half — the only comparison rows this capped can
  // honestly support, and `change` returns null rather than inventing one when they cannot.
  const half = daily ? Math.max(Math.floor(daily.labels.length / 2), 1) : 0;
  const drift = daily && change(daily.total, half);

  const kpis: Figure[] = [
    { k: 'Active campaigns', v: num(campaigns.filter((c) => c.status === 'active').length), go: 'campaigns' },
    { k: 'Active partnerships', v: num(activePartnerships.length), go: 'partnerships' },
    {
      k: 'Redemptions',
      v: capped ? `${num(CAP)}+` : num(redemptions.length),
      go: 'redemptions',
      spark: daily?.total,
      ...(drift == null ? {} : { delta: { pct: drift, since: `vs previous ${half} days`, goodUp: true } }),
    },
    // A promoter's own figure is a floor derived from the newest 100 rows; a publisher's is
    // its whole earned balance off the ledger, so it is exact and needs no "≥".
    isPromoter
      ? { k: 'Coins granted', v: `${capped ? '≥ ' : ''}${num(coinsGranted)}`, go: 'redemptions' }
      : { k: 'Coins earned', v: num(profile?.earnings ?? 0), go: 'redemptions' },
  ];
  // The publisher's second money number, and the one that answers "can I be paid today?".
  // Only worth a tile once something has actually been earned.
  if (!isPromoter && (profile?.earnings ?? 0) > 0)
    kpis.push({ k: 'Ready to withdraw', v: num(profile?.withdrawable ?? 0), go: 'redemptions' });

  const queue: [string, number, Section][] = [
    isPromoter
      ? ['Partnership requests waiting on a publisher', pending, 'partnerships']
      : ['Partnership requests waiting on you', awaitingMe, 'partnerships'],
    [
      isPromoter ? 'Rate changes waiting on a publisher' : 'Rate changes waiting on you',
      openProposals,
      'partnerships',
    ],
    [
      'Campaigns that cannot pay for one more signup',
      campaigns.filter((c) => c.status === 'active' && c.budget < c.coin_rate).length,
      'campaigns',
    ],
    ['Paused campaigns', campaigns.filter((c) => c.status === 'paused').length, 'campaigns'],
  ];

  return (
    <>
      <h2 className={sectionHead}>Live now</h2>
      {!loaded ? (
        <SkeletonStrip className="mt-3" />
      ) : (
        <Figures className="mt-3" items={kpis} onPick={(s) => go(s as Section)} />
      )}

      {/* Counts say where this account is; the line says which way it is going, and it is the
          only history a promoter has on this page. Both series count redemptions, so they
          share one axis — the coins those redemptions cost is a different measure and would
          need a second scale, which is how a chart invents a correlation. */}
      {loaded && daily && daily.labels.length > 1 && (
        <div className={cx(card, 'mt-3')}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <b className={cx(stampCaps, 'shrink-0')}>Redemptions per day</b>
            <span className={cx(muted, 'text-[12px]')}>
              {capped ? 'as far back as the newest 100 reach' : `last ${daily.labels.length} days`}
            </span>
          </div>
          <Chart
            labels={daily.labels}
            caption="Day"
            series={[
              { label: 'redemptions', color: INK.scans, values: daily.total },
              { label: 'verified', color: INK.signups, values: daily.verified },
            ]}
          />
        </div>
      )}

      {/* The split is real — `identified` is per row — but it is drawn from the same capped
          window as the counts above it, so it says so rather than implying a total. */}
      {loaded && redemptions.length > 0 && (
        <div className={cx(card, 'mt-3')}>
          <div className="flex items-baseline justify-between gap-3">
            <b className={stampCaps}>Verified vs guest</b>
            <span className={muted}>
              {capped ? 'newest 100 redemptions' : `${num(redemptions.length)} redemptions`}
            </span>
          </div>
          <Split className="mt-3" verified={verified} guest={guests} />
          <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-soft">
            <span>
              <b className="font-semibold text-ok">{num(verified)}</b> verified
            </span>
            <span>
              <b className="font-semibold text-warn">{num(guests)}</b> still guest
            </span>
          </div>
        </div>
      )}

      <h2 className={sectionHead}>Needs attention</h2>
      {!loaded ? (
        <SkeletonCard className="mt-3" lines={3} />
      ) : (
        <div className={cx(card, 'mt-3 p-2')}>
          {queue.map(([k, v, dest]) => (
            <button className={queueRow} key={k} onClick={() => go(dest)}>
              <span className={queueCount(Boolean(v))}>{v}</span>
              <span>{k}</span>
              <span className="ml-auto text-mut" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      )}

      <h2 className={sectionHead}>Latest redemptions</h2>
      {!loaded ? (
        <SkeletonTable className="mt-3" />
      ) : redemptions.length === 0 ? (
        <Empty
          className="mt-3"
          title="No rewards granted yet"
          body="A redemption appears here the moment a scan converts and a publisher vouches for the signup."
          action={
            canCreateCampaign ? (
              <button className={btn} onClick={onNewCampaign}>
                Create a campaign
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <RedemptionTable rows={redemptions.slice(0, 5)} />
          {redemptions.length > 5 && (
            <button className={cx(linkish, 'mt-3.5')} onClick={() => go('redemptions')}>
              All {num(redemptions.length)} redemptions
            </button>
          )}
        </>
      )}
    </>
  );
}
