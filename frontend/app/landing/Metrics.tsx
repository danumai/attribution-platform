import * as lp from '@/lib/lp';

/**
 * The scale band: four figures that count up as it enters the viewport, on the same `lp-num`
 * machinery the two fare cards already use.
 */

const STATS = [
  { to: 128, unit: 'k', cap: 'scans routed to a publisher', placeholder: true },
  { to: 41, unit: 'k', cap: 'signups confirmed and settled', placeholder: true },
  { to: 4, unit: '', cap: 'checkpoints every scan clears before a coin moves' },
  { to: 0, unit: '', cap: 'coins spent before a publisher confirms a real signup' },
];

export default function Metrics() {
  return (
    <div className={lp.metrics}>
      {STATS.map((s) => (
        <div className={lp.metric} key={s.cap}>
          <span className={lp.metricNum}>
            {/* `relative` is what the ::after counter positions against */}
            <span className="lp-num relative" style={{ '--to': s.to } as React.CSSProperties}>
              {s.to}
            </span>
            {s.unit && <small>{s.unit}</small>}
          </span>
          <span className={lp.metricCap}>{s.cap}</span>
        </div>
      ))}
    </div>
  );
}
