import { cx, meter, meterFill } from '@/lib/tw';

/**
 * A proportion, printed. `of` is the denominator the bar is drawn against — pass it only when it
 * is real, since a meter with an invented ceiling is worse than no meter.
 */
export function Meter({
  value,
  of,
  state,
  className,
}: {
  value: number;
  of: number;
  state?: 'ok' | 'warn' | 'bad';
  className?: string;
}) {
  const ratio = of > 0 ? Math.min(Math.max(value / of, 0), 1) : 0;
  return (
    <div
      className={cx(meter, className)}
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i className={meterFill(ratio, state)} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}