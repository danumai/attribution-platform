'use client';
import { useEffect, useState } from 'react';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

/* One settled signup, as the ledger sees it.
 *
 * The two cards above state the guest/verified split in prose. This is the same 50 coins as
 * five discs crossing from the promoter's budget to the publisher: the first leaves
 * immediately at the guest rate, the other four hang back hatched until the publisher
 * verifies, then follow.
 *
 * The gap between the two departures is the whole point — it is the grace window, and it is
 * the one part of the pricing model that is a duration rather than a number. That is also
 * why this is on a timer rather than on `animation-timeline: view()` like everything else on
 * this page: a scroll-driven version hands the length of the pause to the reader's scroll
 * wheel, so the thing being demonstrated is the one thing the reader cannot see. Scrolled
 * past quickly it collapses to a blur; scrolled slowly it is a stall. Authored timing is the
 * only way the wait reads as a wait.
 *
 * Latched rather than live: it plays once, on arrival, and the coins stay where they landed.
 * A live `inView` would restart the run every time the panel crossed the viewport edge, and
 * a one-shot animation restarting under a micro-scroll is a flicker (the marquee and the
 * scan loop can use the live flag because looping motion has no visible restart). */

/* Five discs at 10 coins each: the first is the guest rate, the rest are the held remainder.
   `--d` is when each leaves, `--i` is its resting place in the fan. */
const COINS = [
  { i: 0, d: '0.55s' },
  { i: 1, d: '2.65s' },
  { i: 2, d: '2.8s' },
  { i: 3, d: '2.95s' },
  { i: 4, d: '3.1s' },
];

export default function Settlement() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (inView) setRan(true);
  }, [inView]);

  return (
    <div className={lp.settle} ref={ref} data-run={ran ? '' : undefined}>
      <div className={lp.settleEnd}>
        <span className={lp.fieldTerm}>Promoter budget</span>
        <b>50</b>
      </div>

      <div className={lp.settleTrack} aria-hidden="true">
        {COINS.map((c) => (
          <span
            className={lp.settleCoin}
            key={c.i}
            style={{ '--i': c.i, '--d': c.d } as React.CSSProperties}
          >
            <span className={lp.settleDisc(c.i === 0)} />
          </span>
        ))}
      </div>

      <div className={lp.settleEndRight}>
        <span className={lp.fieldTerm}>Publisher</span>
        <b>50</b>
      </div>

      <p className={lp.settleNote}>
        10 coins settle the moment the signup is confirmed. The other 40 are held against the
        grace window and released in one idempotent call once the publisher verifies the
        person — or kept by the budget if it never does.
      </p>
    </div>
  );
}
