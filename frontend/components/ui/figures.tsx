import { ReactNode } from 'react';
import { Spark } from '@/lib/chart';
import {
  cx,
  delta as deltaChip,
  figure,
  figureCell,
  figureCellLink,
  figureColumns,
  figureStrip,
  stampCaps,
} from '@/lib/tw';

/**
 * One printed figure. `go` marks the section this number was counted from; `delta` is the signed
 * change against a named period and `spark` the shape it came out of. Neither is ever invented,
 * so a caller with no history simply omits them.
 */
export type Figure = {
  k: string;
  v: ReactNode;
  go?: string;
  /** `pct` as a fraction; `goodUp` says which direction is the good news */
  delta?: { pct: number; since: string; goodUp?: boolean };
  spark?: number[];
};

/**
 * A run of figures printed as one strip. One definition, because four surfaces spelling out "a
 * number" for themselves is four vocabularies an operator reads side by side.
 */
export function Figures({
  items,
  onPick,
  className,
}: {
  items: Figure[];
  onPick?: (go: string) => void;
  /** margins belong to the call site, the way every other primitive in `tw` works */
  className?: string;
}) {
  return (
    <div className={cx(figureStrip, figureColumns(items.length), className)}>
      {items.map(({ k, v, go, delta, spark }) => {
        // Up is not automatically the good news — a caller says which direction it wanted,
        // and the arrow carries the direction even where the colour cannot be seen.
        const up = (delta?.pct ?? 0) >= 0;
        const good = up === (delta?.goodUp ?? true);
        const body = (
          <>
            <span className={cx(stampCaps, 'block transition-colors duration-150 ease-press group-hover:text-accent-text')}>
              {k}
            </span>
            <span className="mt-2 flex items-end justify-between gap-3">
              <b className={figure}>{v}</b>
              {spark && spark.length > 1 && (
                <Spark className="mb-1.5 h-5 w-18 min-w-10 shrink" values={spark} />
              )}
            </span>
            {delta && (
              <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className={deltaChip(good)}>
                  <span aria-hidden="true">{up ? '↑' : '↓'}</span>
                  {Math.abs(delta.pct * 100).toFixed(0)}%
                  <span className="sr-only">{up ? 'up' : 'down'}</span>
                </span>
                <span className="text-[11.5px] text-mut">{delta.since}</span>
              </span>
            )}
          </>
        );
        return go && onPick ? (
          <button key={k} className={figureCellLink} onClick={() => onPick(go)} title={`Open ${k}`}>
            {body}
          </button>
        ) : (
          <div key={k} className={figureCell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}