const STEPS = [
  { key: 'print', label: 'Print' },
  { key: 'scan', label: 'Scan' },
  { key: 'signup', label: 'Signup' },
  { key: 'ledger', label: 'Ledger' },
] as const;

// Four waypoints on one horizontal path. Activation (dot fill, label color,
// the connecting line drawing in, the arrival token) is driven entirely by
// CSS `animation-timeline: view()` in landing.css — staggered per waypoint,
// the same idiom .lp-leg uses below it — so it advances step-by-step as the
// reader scrolls, with no IntersectionObserver needed. (An IO-per-waypoint
// approach doesn't work here: all 4 points sit in one row, so they cross the
// viewport threshold together instead of one-by-one, and IO's live boolean
// would also un-activate every point the moment the diagram scrolls out of
// view.) Browsers without view() support, or with reduced motion, simply
// show the static, fully-legible neutral state — see the CSS for the
// @supports/@media gate.
export default function JourneyFlow() {
  return (
    <div className="lp-journey" aria-hidden="true">
      <svg className="lp-journey-line" viewBox="0 0 400 4" preserveAspectRatio="none">
        <line x1="0" y1="2" x2="400" y2="2" className="lp-journey-track" />
        <line x1="0" y1="2" x2="400" y2="2" className="lp-journey-draw" />
      </svg>
      {STEPS.map((s) => (
        <div className="lp-journey-point" key={s.key}>
          <span className="lp-journey-dot" />
          <span className="lp-journey-token" />
          <span className="lp-journey-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
