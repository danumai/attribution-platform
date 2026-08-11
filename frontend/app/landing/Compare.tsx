import * as lp from '@/lib/lp';

/* What a promoter is actually choosing between.
 *
 * Rows arrive on a stagger off `view()` — the same idiom the money-controls list uses,
 * so the two sections read as one page rather than two. Nothing here is decorative: the
 * stagger is what makes a seven-row table land as seven comparisons instead of a wall.
 *
 * Claims about the other two columns are deliberately about their *pricing model*, not
 * about any named competitor's conduct. */

const COLS = ['This platform', 'CPI network', 'Affiliate link'];

const ROWS: { term: string; mine: string; cpi: string; aff: string }[] = [
  {
    term: 'What you pay for',
    mine: 'A signup the publisher has confirmed',
    cpi: 'A reported install',
    aff: 'A click, or a claimed conversion',
  },
  {
    term: 'Who vouches for the user',
    mine: 'The publisher, at its own bar',
    cpi: 'The network that bills you',
    aff: 'Nobody',
  },
  {
    term: 'Spend ceiling',
    mine: 'The balance you funded — it draws down, never overdraws',
    cpi: 'A daily cap, reconciled on an invoice',
    aff: 'Uncapped',
  },
  {
    term: 'If the creative leaks',
    mine: 'Void the batch; every later scan is refused',
    cpi: 'Pause the campaign and dispute afterwards',
    aff: 'The link keeps working',
  },
  {
    term: 'Where the money is recorded',
    mine: 'Double-entry ledger, append-only',
    cpi: 'A monthly statement',
    aff: 'A monthly statement',
  },
  {
    term: 'Unverified users',
    mine: 'Billed at the guest rate; the rest is held',
    cpi: 'Billed in full',
    aff: 'Billed in full',
  },
  {
    term: 'What the code itself unlocks',
    mine: 'Nothing — it opens a store listing',
    cpi: 'n/a',
    aff: 'Whatever the link carries',
  },
];

export default function Compare() {
  return (
    <div className={lp.compare}>
      <div className={lp.compareHead} aria-hidden="true">
        <span>Measure</span>
        {COLS.map((c, i) => (
          <span className={i === 0 ? lp.compareMine : undefined} key={c}>
            {c}
          </span>
        ))}
      </div>

      {ROWS.map((r) => (
        <div className={lp.compareRow} key={r.term}>
          <span className={lp.compareTerm}>{r.term}</span>
          <span className={lp.compareCellMine}>
            {/* Below 860px the head row is gone, so each cell carries its own column
                name — otherwise the two surviving columns are unlabelled. */}
            <span className={lp.compareWho}>{COLS[0]}</span>
            {r.mine}
          </span>
          <span className={lp.compareCell}>
            <span className={lp.compareWho}>{COLS[1]}</span>
            {r.cpi}
          </span>
          <span className={lp.compareCell}>
            <span className={lp.compareWho}>{COLS[2]}</span>
            {r.aff}
          </span>
        </div>
      ))}
    </div>
  );
}
