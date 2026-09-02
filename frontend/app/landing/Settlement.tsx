'use client';
import { useEffect, useRef, useState } from 'react';
import { useInView } from './useInView';
import * as lp from '@/lib/lp';

/**
 * One settled signup, as the ledger sees it: 50 coins as the two payments it actually is.
 */

// When each phase starts, in ms from arrival. The 0.8s gaps are the crossings — a figure must not
// tick over until the token carrying it has arrived.
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

// Reduced motion gets the settled ledger, not a faster version of the animation: the final state
// is the whole story.
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
