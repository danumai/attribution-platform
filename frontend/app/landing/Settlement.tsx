'use client';
import { useEffect, useRef, useState } from 'react';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

/* One settled signup, as the ledger sees it.
 *
 * This used to be five identical discs crossing a hairline between two figures that both
 * read 50 the whole way through, under a paragraph explaining what you were meant to have
 * seen. Nothing in it ever changed, so there was nothing to understand — the prose was
 * carrying the idea and the motion was decoration on top of it.
 *
 * It is now the two payments the model actually makes, one lane each, and the two figures
 * move when a payment lands:
 *
 *     Promoter 50 → 40 → 0        Publisher 0 → 10 → 50
 *
 *   1. The 10 crosses on its own, straight away. That is the guest rate, paid the moment the
 *      signup is confirmed.
 *   2. The 40 sits in its lane while the grace window fills underneath it, visibly, as a bar.
 *      The wait is the one part of this pricing model that is a duration rather than a
 *      number, so it is the one part drawn as a duration.
 *   3. Verification lands and the 40 follows.
 *
 * The phases are on a timer rather than on `animation-timeline: view()` like the rest of the
 * page, because a scroll-driven version hands the length of the pause to the reader's scroll
 * wheel — and the pause is the thing being demonstrated. Scrolled fast it collapses to a
 * blur; scrolled slowly it is a stall. Authored timing is the only way a wait reads as a wait.
 *
 * Latched, not live: it runs once on arrival and the coins stay where they landed. A live
 * `inView` would restart the whole settlement every time the panel crossed the viewport edge. */

/* When each phase starts, in ms from arrival. The 0.8s gaps are the crossings — a figure must
   not tick over until the token carrying it has actually arrived — and the 1.95s is the grace
   window. Everything visible below is a function of `phase` alone. */
const PHASES = [450, 1250, 3200, 4000];

/* What the ledger reads in each phase. Same 50 coins, in three states: all in the budget,
   split, all delivered. */
const PROMOTER = [50, 50, 40, 40, 0];
const PUBLISHER = [0, 0, 10, 10, 50];

export default function Settlement() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [phase, setPhase] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!inView || started.current) return;
    started.current = true;

    /* Reduced motion gets the settled ledger, not a faster version of the animation: the
       final state is the whole story — 0 in the budget, 50 delivered, both payments landed. */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase(PHASES.length);
      return;
    }
    const t = PHASES.map((ms, i) => window.setTimeout(() => setPhase(i + 1), ms));
    return () => t.forEach(clearTimeout);
  }, [inView]);

  const verified = phase >= 3;

  return (
    <div className={lp.settle} ref={ref}>
      <div className={lp.settleEnd}>
        <span className={lp.fieldTerm}>Promoter budget</span>
        {/* keyed on the value so a change remounts the element and replays the tick */}
        <b className={lp.settleFig} key={`p${PROMOTER[phase]}`}>{PROMOTER[phase]}</b>
      </div>

      <div className={lp.settleLanes} aria-hidden="true">
        {/* paid on confirmation */}
        <div className={lp.settleRow}>
          <span className={lp.settleRail}>
            <span className={lp.settleLane} data-sent={phase >= 1 ? '' : undefined}>
              <span className={lp.settleToken(true)}>10</span>
            </span>
          </span>
          <span className={lp.settleTag}>on confirmation</span>
        </div>

        {/* held, then paid on verification — the bar under it is the grace window running */}
        <div className={lp.settleRow}>
          <span className={lp.settleRail}>
            <span
              className={lp.settleGrace}
              data-run={phase >= 2 ? '' : undefined}
              data-done={verified ? '' : undefined}
            />
            <span className={lp.settleLane} data-sent={phase >= 4 ? '' : undefined}>
              <span className={lp.settleToken(verified)}>40</span>
            </span>
          </span>
          <span className={lp.settleTag} data-on={verified ? '' : undefined}>
            {verified ? 'verified — released' : 'held · grace window'}
          </span>
        </div>
      </div>

      <div className={lp.settleEndRight}>
        <span className={lp.fieldTerm}>Publisher</span>
        <b className={lp.settleFig} key={`v${PUBLISHER[phase]}`}>{PUBLISHER[phase]}</b>
      </div>

      <p className={lp.settleNote}>Never verified, never released — the 40 stays in the budget.</p>
    </div>
  );
}
