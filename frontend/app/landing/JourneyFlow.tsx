import * as lp from '@/lib/lp';

const STEPS = [
  { key: 'print', label: 'Print' },
  { key: 'scan', label: 'Scan' },
  { key: 'signup', label: 'Signup' },
  { key: 'ledger', label: 'Ledger' },
] as const;

/**
 * Four waypoints on one horizontal path. Activation — dot fill, label colour, the connecting line
 * drawing in, the arrival token — is driven entirely by CSS `animation-timeline: view()`.
 */
export default function JourneyFlow() {
  return (
    <div className={lp.journey} aria-hidden="true">
      <svg className={lp.journeyLine} viewBox="0 0 400 4" preserveAspectRatio="none">
        <line x1="0" y1="2" x2="400" y2="2" className={lp.journeyTrack} />
        <line x1="0" y1="2" x2="400" y2="2" className={lp.journeyDraw} />
      </svg>
      {STEPS.map((s) => (
        <div className={`group ${lp.journeyPoint}`} key={s.key}>
          <span className={lp.journeyDot} />
          <span className={lp.journeyToken} />
          <span className={lp.journeyLabel}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
