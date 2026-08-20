'use client';
import { MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, SkeletonTable } from '@/lib/ui';
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
 * A column over rows of `T`. `sort` is required whenever `get` returns markup: comparing two
 * React elements with `>` is always false both ways, so those headers used to announce
 * `aria-sort="ascending"` over an order that had not changed.
 */
export type Col<T> = { h: string; get: (row: T) => ReactNode; sort?: (row: T) => unknown; num?: boolean };

const PAGE = 50;

/**
 * One lowercase haystack per row, cached on the row object itself.
 *
 * The filter used to `JSON.stringify` every row inside the predicate, so with `limit=1000`
 * scans it re-serialised a thousand rows on every keystroke. A WeakMap keyed on the row means
 * each row is serialised once and the cache is collected with the data it describes.
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

  // Deliberately outside the memo's dependencies. Every call site passes `cols` as an inline
  // array literal, so a fresh identity arrives on every render and the memo never hit — it
  // re-filtered the whole table each time an unrelated piece of state (`busy`) changed. The
  // only part of `cols` the sort reads is the accessor for the sorted column, and `sort.i`
  // already changes whenever that does.
  const colsRef = useRef(cols);
  colsRef.current = cols;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = needle ? rows.filter((r) => haystack(r).includes(needle)) : rows.slice();
    if (sort) {
      // A column with no `sort` sorts on its rendered value, which is only meaningful when
      // that value is a primitive. `sortable()` is what stops a header claiming otherwise.
      const key = colsRef.current[sort.i].sort ?? colsRef.current[sort.i].get;
      out.sort((a, b) => {
        const [x, y] = [key(a), key(b)] as [any, any];
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
    }
    return out;
  }, [q, rows, sort]);

  /**
   * Whether clicking this header actually reorders anything.
   *
   * Without an explicit `sort`, the comparator falls back to `get`, and for a column that
   * renders markup that means comparing two React elements — always false in both directions,
   * so the order never changed while `aria-sort` told a screen reader it had. Probing the
   * first row is enough: a column renders the same kind of thing for every row.
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
                      className={cx(c.num ? thNum : th, sort?.i === i && 'text-accent-text')}
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
                <tr className={tr} key={(r as { id?: string; account?: string }).id ?? (r as { account?: string }).account ?? i}>
                  {cols.map((c, j) => (
                    <td key={j} className={c.num ? tdNum : td}>
                      {c.get(r)}
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
