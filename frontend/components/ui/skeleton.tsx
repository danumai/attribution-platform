import { card, cx, figureCell, figureColumns, figureStrip, skeleton } from '@/lib/tw';

/**
 * Stands in for a section while its data is in flight — one shape per thing being awaited, rather
 * than the same five shimmering bars whether a table, a strip or a chart is coming. Kept as one
 * file: these three are one visual family (loading placeholders), reached for together.
 */
export function SkeletonCard({ lines = 5, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx(card, 'grid gap-3', className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={skeleton} style={{ width: `${100 - i * 9}%` }} />
      ))}
    </div>
  );
}

export function SkeletonStrip({ cells = 4, className }: { cells?: number; className?: string }) {
  return (
    <div
      className={cx(figureStrip, figureColumns(cells), className)}
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: cells }, (_, i) => (
        <div key={i} className={figureCell}>
          <div className={cx(skeleton, 'h-2 w-14')} />
          <div className={cx(skeleton, 'mt-3 h-6 w-16')} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={cx('overflow-hidden rounded-xl border border-line bg-card shadow-contact-sm', className)}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex gap-4 border-b border-line bg-card-alt px-3.5 py-3.5">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className={cx(skeleton, 'h-2.5 flex-1')} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-line-soft px-3.5 py-3.5 last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className={cx(skeleton, 'flex-1')} style={{ opacity: 1 - r * 0.13 }} />
          ))}
        </div>
      ))}
    </div>
  );
}