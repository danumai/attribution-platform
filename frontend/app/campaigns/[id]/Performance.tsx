'use client';
import type { Analytics } from '@/lib/audience';
import { dailySeries } from '@/lib/audience';
import type { CampaignStats } from '@/lib/types';
import { Figures, Meter } from '@/lib/ui';
import { num } from '@/lib/fmt';
import { card, cx, figure, muted, stampCaps } from '@/lib/tw';

export function Performance({ stats, audience }: { stats: CampaignStats; audience: Analytics | null }) {
  /* What was ever put in: everything granted out of it, plus everything still sitting there.
     The stats endpoint gives both halves, which is what makes the burn-down a measurement
     rather than a bar against an invented ceiling. */
  const funded = stats.coins_granted + stats.budget_remaining;
  // The daily shape behind the two counting figures, from the same window the Audience panel
  // below is showing — so a rising trace and a rising line are the same rise.
  const shape = dailySeries(audience);

  return (
    <>
      {/* The two counting figures carry their own shape. The two coin figures do not: a budget
          is a level rather than a rate, and a trace of it would be a different measurement
          wearing the same mark as the two beside it. */}
      <Figures
        className="mt-3"
        items={[
          { k: 'scans', v: num(stats.scans), spark: shape.scans },
          { k: 'rewards granted', v: num(stats.redemptions), spark: shape.signups },
          { k: 'coins granted', v: num(stats.coins_granted) },
          { k: 'budget left', v: num(stats.budget_remaining) },
        ]}
      />

      {/* Burn-down and conversion, the two proportions the figures above cannot show on their
          own. Both denominators are real: the funded total is what has been granted plus what
          is left, and the funnel is this campaign's own scans against its own redemptions. */}
      <div className="mt-3 grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
        <div className={card}>
          <div className="flex items-baseline justify-between gap-3">
            <b className={stampCaps}>Budget</b>
            <span className={muted}>
              {num(stats.coins_granted)} of {num(funded)} spent
            </span>
          </div>
          <Meter className="mt-3" value={stats.budget_remaining} of={funded} />
          <p className={cx(figure, 'mt-3')}>
            {funded ? `${((stats.budget_remaining / funded) * 100).toFixed(0)}%` : '—'}{' '}
            <small className="text-xs font-normal tracking-normal text-mut">still available</small>
          </p>
        </div>

        <div className={card}>
          <div className="flex items-baseline justify-between gap-3">
            <b className={stampCaps}>Scan → signup</b>
            <span className={muted}>
              {num(stats.redemptions)} of {num(stats.scans)} scans
            </span>
          </div>
          <Meter className="mt-3" value={stats.redemptions} of={stats.scans} state="ok" />
          <p className={cx(figure, 'mt-3')}>
            {stats.scans ? `${((stats.redemptions / stats.scans) * 100).toFixed(1)}%` : '—'}{' '}
            <small className="text-xs font-normal tracking-normal text-mut">converted</small>
          </p>
        </div>
      </div>
    </>
  );
}
