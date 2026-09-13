import { cx, split } from '@/lib/tw';

/** Verified against guest, in the two colours the landing page already assigns those states. */
export function Split({
  verified,
  guest,
  className,
}: {
  verified: number;
  guest: number;
  className?: string;
}) {
  const total = verified + guest;
  if (!total) return null;
  return (
    <div className={cx(split, className)} aria-hidden="true">
      <i className="block h-full bg-ok" style={{ width: `${(verified / total) * 100}%` }} />
      <i className="block h-full bg-warn-lit" style={{ width: `${(guest / total) * 100}%` }} />
    </div>
  );
}