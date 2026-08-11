import * as lp from '@/lib/lp';

/* The scale band.
 *
 * Four figures that count up as the band enters the viewport, on the same `lp-num`
 * machinery the two fare cards already use — a registered `--n` integer driven by
 * `animation-timeline: view()`. No second counter, and no JS: the element's own text
 * is the real number, so a reader without `view()` support, or with reduced motion on,
 * simply reads it straight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The first two figures are PLACEHOLDERS. Replace them with real platform totals
 * before this page is public — a marketing stat presented as measured when it is not
 * is the one thing on this page that would be a lie rather than a claim. The last two
 * are structural: they are true of the model itself and hold at any volume.
 * ───────────────────────────────────────────────────────────────────────────── */

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
