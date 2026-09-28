'use client';
import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { SkeletonTable } from '@/components/ui/skeleton';
import { Empty } from '@/components/ui/empty';
import {
  btnGhost,
  btnTinyGhost,
  cx,
  menu,
  menuPop,
  menuScrim,
  menuSummary,
  muted,
  search,
  searchInput,
  table,
  tableFoot,
  tableWrap,
  tablebar,
  td,
  tdNum,
  th,
  thNum,
  tr,
} from '@/lib/tw';

/**
 * A column over rows of `T`. `sort` is required whenever `get` returns markup: comparing two React
 * elements with `>` is always false both ways.
 *
 * Cells stay on one line by default and the table scrolls sideways when it runs out of room;
 * squeezing columns instead wrapped dates over three lines and broke IDs at every hyphen. A column
 * with no heading is the row-actions column: it shrinks to fit and stays pinned to the right edge.
 */
export type Col<T> = {
  h: string;
  get: (row: T) => ReactNode;
  sort?: (row: T) => unknown;
  num?: boolean;
  /** Let long text wrap (JSON, free text). Pair it with a `width` floor so it can't collapse. */
  wrap?: boolean;
  /** One line with an ellipsis, the full value as its tooltip. For IDs and URLs. */
  truncate?: boolean;
  /** Width classes for the column: `min-w-80` on a wrapping column, `max-w-60` on a truncated one. */
  width?: string;
  /** Pin the column to the left edge while the table scrolls sideways — the row's name, usually. */
  sticky?: boolean;
};

/** The text a truncated cell shows in full on hover: its sort key, else its value, when plain. */
function plain<T>(c: Col<T>, row: T): string | undefined {
  for (const v of [c.sort?.(row), c.get(row)]) if (typeof v === 'string' || typeof v === 'number') return String(v);
}

/**
 * Layout classes for one column's cells. Pinned body cells take the row's background so scrolled
 * content passes under them, hover included, and carry no z-index: that would trap an open Actions
 * menu under the rows below it. Pinned heads already have a background and need to sit over the
 * other heads.
 */
function cellClass<T>(c: Col<T>, head = false) {
  const pinned = c.sticky || !c.h;
  return cx(
    c.wrap ? 'whitespace-normal wrap-anywhere' : 'whitespace-nowrap',
    c.wrap && !c.width && 'min-w-60',
    !c.truncate && c.width,
    !c.h && 'w-px',
    pinned && (head ? 'z-3!' : 'bg-inherit'),
    c.sticky && 'sticky left-0 shadow-[inset_-1px_0_0_var(--color-line-soft)]',
    !c.h && 'sticky right-0 shadow-[inset_1px_0_0_var(--color-line-soft)]',
  );
}

const PAGE = 50;

/**
 * One lowercase haystack per row, cached on the row object itself. The filter used to
 * `JSON.stringify` every row inside the predicate, which at `limit=1000` was 1000 serialisations
 * per keystroke.
 */
const haystacks = new WeakMap<object, string>();
function haystack(row: object): string {
  let s = haystacks.get(row);
  if (s === undefined) haystacks.set(row, (s = JSON.stringify(row).toLowerCase()));
  return s;
}

/** Row actions live behind one control instead of a run of dot-separated links. */
export function Actions({ children }: { children: ReactNode }) {
  // click-away and pick-an-item both close the menu, the way a native popover would
  const close = (e: MouseEvent<HTMLElement>) => e.currentTarget.closest('details')?.removeAttribute('open');
  return (
    <details className={menu}>
      <summary className={menuSummary} aria-label="Row actions" title="Actions">
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </summary>
      <div className={menuScrim} onClick={close} />
      <div className={menuPop} onClick={close}>
        {children}
      </div>
    </details>
  );
}

/** One table for every tab: free-text filter, click-to-sort headers, paged rendering. */
export function Table<T extends object>({
  cols,
  rows,
  empty = 'Nothing here yet.',
  loading,
}: {
  cols: Col<T>[];
  rows: T[];
  empty?: string;
  loading?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // Deliberately outside the memo's dependencies: every call site passes `cols` as an inline array
  // literal, so a fresh identity arrives on every render and the memo would never hold.
  const colsRef = useRef(cols);
  colsRef.current = cols;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = needle ? rows.filter((r) => haystack(r).includes(needle)) : rows.slice();
    if (sort) {
      // A column with no `sort` sorts on its rendered value, which is only meaningful when that value
      // is a primitive.
      const key = colsRef.current[sort.i].sort ?? colsRef.current[sort.i].get;
      out.sort((a, b) => {
        const [x, y] = [key(a), key(b)] as [any, any];
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
    }
    return out;
  }, [q, rows, sort]);

  /**
   * Whether clicking this header actually reorders anything. Without an explicit `sort` the
   * comparator falls back to `get`, which for a column rendering markup compares React elements.
   */
  const sortable = (c: Col<T>) => {
    if (!c.h) return false;
    if (c.sort) return true;
    if (!rows.length) return false;
    const v = c.get(rows[0]);
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  };

  // a narrowed result set starts at the top again, not 300 rows down
  useEffect(() => setLimit(PAGE), [q, sort]);

  if (loading) return <SkeletonTable className="mt-3" rows={6} cols={Math.min(cols.length, 6)} />;

  return (
    <>
      <div className={tablebar}>
        <div className={search}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" strokeLinecap="round" />
          </svg>
          <input className={searchInput} placeholder="Filter these rows…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter rows" />
          {q && (
            <button className={cx(btnTinyGhost, 'shrink-0')} onClick={() => setQ('')}>
              Clear
            </button>
          )}
        </div>
        <span className={muted}>
          {shown.length}
          {shown.length !== rows.length && ` of ${rows.length}`} rows
        </span>
      </div>

      {shown.length ? (
        <div className={tableWrap}>
          <table className={table}>
            <thead>
              <tr>
                {cols.map((c, i) => {
                  const can = sortable(c);
                  return (
                    <th
                      key={i}
                      className={cx(
                        c.num ? thNum : th,
                        cellClass(c, true),
                        sort?.i === i && 'text-accent-text',
                      )}
                      aria-sort={
                        can && sort?.i === i ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined
                      }
                      style={{ cursor: can ? 'pointer' : 'default', userSelect: 'none' }}
                      onClick={() =>
                        can && setSort((s) => (s?.i === i ? { i, dir: s.dir === 1 ? -1 : 1 } : { i, dir: 1 }))
                      }
                    >
                      {c.h}
                      {can && sort?.i === i && <span className="ml-1">{sort.dir === 1 ? '↑' : '↓'}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((r, i) => (
                // every row type here carries one or the other; the index is the last resort
                <tr className={cx(tr, 'bg-card')} key={(r as { id?: string; account?: string }).id ?? (r as { account?: string }).account ?? i}>
                  {cols.map((c, j) => (
                    <td key={j} className={cx(c.num ? tdNum : td, cellClass(c))}>
                      {c.truncate ? (
                        <div className={cx('truncate', c.width ?? 'max-w-60')} title={plain(c, r)}>
                          {c.get(r)}
                        </div>
                      ) : (
                        c.get(r)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limit && (
            <div className={tableFoot}>
              <button className={btnGhost} onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, shown.length - limit)} more
              </button>
              <span className={muted}>{shown.length - limit} rows below</span>
            </div>
          )}
        </div>
      ) : (
        <Empty
          className="mt-3"
          title={q ? 'Nothing matches that filter' : empty}
          body={q ? `No row contains “${q}”.` : undefined}
          action={
            q ? (
              <button className={btnGhost} onClick={() => setQ('')}>
                Clear the filter
              </button>
            ) : undefined
          }
        />
      )}
    </>
  );
}
