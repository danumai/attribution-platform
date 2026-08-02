'use client';
import { useInView } from './useInView';

const STEPS = [
  { key: 'print', label: 'Print' },
  { key: 'scan', label: 'Scan' },
  { key: 'signup', label: 'Signup' },
  { key: 'ledger', label: 'Ledger' },
] as const;

// Four waypoints on one horizontal path, each gated by its own useInView so the
// diagram activates step-by-step as the reader scrolls past the matching
// coupon column above it (see .lp-journey CSS: it sits directly under .lp-strip
// and shares its 4-column grid, so waypoint N aligns under coupon N).
export default function JourneyFlow() {
  const w0 = useInView<HTMLDivElement>();
  const w1 = useInView<HTMLDivElement>();
  const w2 = useInView<HTMLDivElement>();
  const w3 = useInView<HTMLDivElement>();
  const waypoints = [w0, w1, w2, w3];
  const reachedCount = waypoints.filter((w) => w.inView).length;

  return (
    <div className="lp-journey" aria-hidden="true">
      <svg className="lp-journey-line" viewBox="0 0 400 4" preserveAspectRatio="none">
        <line x1="0" y1="2" x2="400" y2="2" className="lp-journey-track" />
        <line
          x1="0"
          y1="2"
          x2="400"
          y2="2"
          className="lp-journey-draw"
          style={{ '--reached': reachedCount } as React.CSSProperties}
        />
      </svg>
      {STEPS.map((s, i) => (
        <div
          className="lp-journey-point"
          key={s.key}
          ref={waypoints[i].ref}
          data-active={waypoints[i].inView ? '' : undefined}
        >
          <span className="lp-journey-dot" />
          <span className="lp-journey-token" />
          <span className="lp-journey-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
