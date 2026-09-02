'use client';
import { useState } from 'react';
import * as lp from '@/lib/lp';

// The one thing a pay-per-signup page cannot say in prose: what a given budget actually buys. Two
// sliders, three figures, and the figures do not animate.

const GUEST_SHARE = 0.2; // the default guest rate is a fifth of the full rate

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BudgetPlanner() {
  const [budget, setBudget] = useState(25000);
  const [rate, setRate] = useState(50);
  const [cpi, setCpi] = useState(120);

  const guestRate = Math.max(1, Math.round(rate * GUEST_SHARE));
  const verified = Math.floor(budget / rate);
  const guestOnly = Math.floor(budget / guestRate);
  const held = rate - guestRate;

  // The same budget, priced the way an install is usually priced. This is the only
  // comparison the page can make honestly: it is arithmetic on a number the reader
  // supplies, not a claim about what anyone else actually charges.
  const elsewhere = Math.floor(budget / cpi);
  const delta = verified - elsewhere;

  const pct = (v: number, min: number, max: number) => `${((v - min) / (max - min)) * 100}%`;

  return (
    <div className={lp.planner}>
      <div className={lp.plannerControls}>
        <label className={lp.plannerField}>
          <span className={lp.plannerLabel}>
            Budget you fund <b>{fmt(budget)} coins</b>
          </span>
          <input
            type="range"
            className={lp.range}
            min={1000}
            max={100000}
            step={1000}
            value={budget}
            onChange={(e) => setBudget(+e.target.value)}
            style={{ '--pct': pct(budget, 1000, 100000) } as React.CSSProperties}
          />
        </label>

        <label className={lp.plannerField}>
          <span className={lp.plannerLabel}>
            Your rate per verified signup <b>{rate} coins</b>
          </span>
          <input
            type="range"
            className={lp.range}
            min={10}
            max={200}
            step={5}
            value={rate}
            onChange={(e) => setRate(+e.target.value)}
            style={{ '--pct': pct(rate, 10, 200) } as React.CSSProperties}
          />
        </label>

        <label className={lp.plannerField}>
          <span className={lp.plannerLabel}>
            What an install costs you elsewhere <b>{cpi} coins</b>
          </span>
          <input
            type="range"
            className={lp.range}
            min={20}
            max={400}
            step={10}
            value={cpi}
            onChange={(e) => setCpi(+e.target.value)}
            style={{ '--pct': pct(cpi, 20, 400) } as React.CSSProperties}
          />
        </label>
      </div>

      <div className={lp.plannerOut}>
        <div className={lp.plannerFigure}>
          <span className={lp.plannerNum}>{fmt(verified)}</span>
          <span className={lp.plannerCap}>verified signups, at most</span>
        </div>
        <div className={lp.plannerFigure}>
          <span className={`${lp.plannerNum} text-warn-lit`}>{fmt(guestOnly)}</span>
          <span className={lp.plannerCap}>if none are ever verified</span>
        </div>
        <div className={lp.plannerFigure}>
          <span className={lp.plannerNum}>{held}</span>
          <span className={lp.plannerCap}>coins held per signup, until verified</span>
        </div>
        <div className={lp.plannerFigure}>
          <span className={lp.plannerNum}>{fmt(elsewhere)}</span>
          <span className={lp.plannerCap}>installs the same budget buys at {cpi} coins each</span>
        </div>

        <p className={lp.plannerVs}>
          {delta === 0 ? (
            <span>
              At <b>{rate}</b> against <b>{cpi}</b> the two come out level — the difference is
              that only one of them is billed after somebody confirms the user is real.
            </span>
          ) : (
            <span>
              Same budget, <b>{fmt(Math.abs(delta))}</b> {delta > 0 ? 'more' : 'fewer'} users —
              and every one of them is a signup a publisher has confirmed, not an install
              somebody reported.
            </span>
          )}
        </p>
      </div>

      <p className={lp.plannerNote}>
        Guest rate shown at the {GUEST_SHARE * 100}% default — you set the real one per
        partnership. Either way the funded budget is the ceiling: it draws down, it never
        overdraws.
      </p>
    </div>
  );
}
