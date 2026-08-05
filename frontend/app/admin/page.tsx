'use client';
import { MouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, org as getOrg, token } from '@/lib/api';
import { Shell } from '@/lib/shell';
import { Analytics, Audience } from '@/lib/audience';
import { Figure, Figures, LoadError, confirmDialog, promptDialog, toast } from '@/lib/ui';
import type {
  AdminOrg,
  AdminOverview,
  AdminScan,
  AuditEntry,
  Campaign,
  Ledger,
  Partnership,
  QrCode,
  Redemption,
} from '@/lib/types';
import { ago, num, when } from '@/lib/fmt';
import {
  btn,
  btnGhost,
  btnTinyGhost,
  card,
  cx,
  codeKey,
  empty as emptyBox,
  field,
  filterBar,
  filterChip,
  filterChipDrop,
  health,
  healthMark,
  link as linkClass,
  linkish,
  menu,
  menuItem,
  menuPop,
  menuScrim,
  menuSummary,
  muted,
  pill as pillFor,
  pillBad,
  queueCount,
  queueRow,
  search,
  searchInput,
  sectionHead,
  select as selectField,
  skeleton,
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

/** The rail: nine sections, grouped by what an operator is doing when they open them. */
const TABS = [
  { id: 'Overview', icon: 'overview', group: '' },
  { id: 'Organizations', icon: 'orgs', group: 'Accounts' },
  { id: 'Partnerships', icon: 'partnerships', group: 'Accounts' },
  { id: 'Campaigns', icon: 'campaigns', group: 'Accounts' },
  { id: 'Audience', icon: 'overview', group: 'Traffic' },
  { id: 'Scans', icon: 'scans', group: 'Traffic' },
  { id: 'Redemptions', icon: 'redemptions', group: 'Traffic' },
  { id: 'QR codes', icon: 'qr', group: 'Traffic' },
  { id: 'Ledger', icon: 'ledger', group: 'Money' },
  { id: 'Audit log', icon: 'audit', group: 'Money' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const HEAD: Record<Tab, string> = {
  Overview: 'Does the money add up, and what is waiting on you.',
  Organizations: 'Every promoter and publisher on the platform.',
  Partnerships:
    'Rates are per redemption. Guest rate is paid up front for an unidentified signup; the delta is released if the user identifies within the grace window.',
  Campaigns: 'Budgets, conversion and the kill switch.',
  Audience:
    'Where scans come from, on what, and when. Everything here is read off the request the redirect already receives — a QR code carries nothing about whoever scanned it.',
  Scans: 'Every QR scan, newest first. IPs are stored as a truncated hash — enough to spot a repeat scanner, not enough to identify a person.',
  Redemptions: 'Every signup a publisher vouched for.',
  'QR codes': 'Issued codes, their limits and their state.',
  Ledger: 'Account balances and the entries behind them.',
  'Audit log': 'Every privileged override, newest first.',
};

// Fallback only: scans recorded before the signal columns existed have nothing but their UA.
// ponytail: crude UA bucketing. New scans carry `device_type` from the server instead.
const device = (ua: string) =>
  !ua ? '—' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mobile/.test(ua) ? 'Mobile' : 'Desktop';

/** `Intl` knows every country name already — a lookup table here would be dead weight. */
const regionNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;
const country = (code: string) => {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
};
const pill = (s: string) => <span className={pillFor(s)}>{s}</span>;

/**
 * A column over rows of `T`. `sort` is required whenever `get` returns markup: comparing two
 * React elements with `>` is always false both ways, so those headers used to announce
 * `aria-sort="ascending"` over an order that had not changed.
 */
type Col<T> = { h: string; get: (row: T) => ReactNode; sort?: (row: T) => unknown; num?: boolean };

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
function Actions({ children }: { children: ReactNode }) {
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
function Table<T extends object>({
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

  if (loading)
    return (
      <div className={cx(card, 'mt-3 grid gap-2.5')}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={skeleton} style={{ width: `${100 - i * 7}%` }} />
        ))}
      </div>
    );

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
                      className={cx(c.num ? thNum : th, sort?.i === i && 'text-accent')}
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
        <div className={cx(card, emptyBox, 'mt-3')}>
          <p>{q ? `Nothing matches “${q}”.` : empty}</p>
          {q && (
            <button className={cx(btnGhost, 'mt-3.5')} onClick={() => setQ('')}>
              Clear the filter
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Counts, ready for the shared strip. */
const counts = (items: [string, number | undefined][]): Figure[] =>
  items.map(([k, v]) => ({ k, v: num(v ?? 0) }));

/**
 * Whether the platform's coins still sum to zero.
 *
 * It leads the Overview and it opens the Ledger, because those are the two places an
 * operator looks before authorising anything, and a integrity check that is only on one of
 * them is a check the other page silently claims to have passed.
 */
function LedgerHealth({ ok, sum, onOpen }: { ok: boolean; sum: number; onOpen?: () => void }) {
  return (
    <div className={health(ok)}>
      <div className={healthMark(ok)} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {ok ? <path d="m5 10.5 3.2 3L15 6.5" /> : <path d="M10 5.5v5.5M10 14v.1" />}
        </svg>
      </div>
      <div>
        <b className="font-[650] tracking-[-0.015em]">
          {ok ? 'Ledger balanced' : `Ledger off by ${num(sum)}`}
        </b>
        <p className={cx(muted, 'mt-0.75 max-w-[62ch]')}>
          {ok
            ? 'Every entry sums to zero — no coins have been created or lost.'
            : 'Entries do not sum to zero. Coins have been created or destroyed outside the ledger — investigate before any payout.'}
        </p>
      </div>
      {!ok && onOpen && (
        <span className="ml-auto self-center whitespace-nowrap">
          <button className={linkish} onClick={onOpen}>
            Open the ledger
          </button>
        </span>
      )}
    </div>
  );
}

/** Everything the console holds at once. Partial because it fills in as the fetches land. */
interface AdminData {
  overview?: AdminOverview;
  orgs?: AdminOrg[];
  partnerships?: Partnership[];
  campaigns?: Campaign[];
  scans?: AdminScan[];
  redemptions?: Redemption[];
  qrCodes?: QrCode[];
  ledger?: Ledger;
  audit?: AuditEntry[];
  analytics?: Analytics;
}

export default function Admin() {
  const r = useRouter();
  const [me, setMe] = useState<ReturnType<typeof getOrg>>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [d, setD] = useState<AdminData>({});
  // Recorded, not just toasted: `loading` is derived from `!d.overview`, so without this a
  // failed load is indistinguishable from one in flight and the console shimmers forever.
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [ledgerAccount, setLedgerAccount] = useState('');
  const [days, setDays] = useState(30);

  /** The seven endpoints no filter on this page affects. */
  const loadCore = useCallback(async () => {
    try {
      const [overview, orgs, partnerships, campaigns, redemptions, qrCodes, audit] =
        await Promise.all([
          api<AdminOverview>('/v1/admin/overview'),
          api<AdminOrg[]>('/v1/admin/orgs?limit=1000'),
          api<Partnership[]>('/v1/admin/partnerships?limit=1000'),
          api<Campaign[]>('/v1/admin/campaigns?limit=1000'),
          api<Redemption[]>('/v1/admin/redemptions?limit=1000'),
          api<QrCode[]>('/v1/admin/qr-codes?limit=1000'),
          api<AuditEntry[]>('/v1/admin/audit-log?limit=500'),
        ]);
      setD((p) => ({ ...p, overview, orgs, partnerships, campaigns, redemptions, qrCodes, audit }));
      setLoadErr('');
    } catch (e: any) {
      setLoadErr(e.message);
      toast.error(e.message);
    }
  }, []);

  /**
   * The three that a filter does change — kept apart because they used to ride along with the
   * other seven: picking one account from the ledger dropdown re-pulled ~2500 unrelated rows.
   *
   * `analytics` shares the campaign filter with the Scans tab on purpose: picking a campaign
   * in one place and reading the other's platform-wide numbers is how you misread both.
   */
  const loadFiltered = useCallback(async () => {
    try {
      const [scans, ledger, analytics] = await Promise.all([
        api<AdminScan[]>(
          `/v1/admin/scans?limit=1000${campaignFilter ? `&campaign_id=${campaignFilter}` : ''}`,
        ),
        api<Ledger>(
          `/v1/admin/ledger${ledgerAccount ? `?account=${encodeURIComponent(ledgerAccount)}` : ''}`,
        ),
        api<Analytics>(
          `/v1/admin/analytics?days=${days}${campaignFilter ? `&campaign_id=${campaignFilter}` : ''}`,
        ),
      ]);
      setD((p) => ({ ...p, scans, ledger, analytics }));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [campaignFilter, ledgerAccount, days]);

  const load = useCallback(
    () => Promise.all([loadCore(), loadFiltered()]),
    [loadCore, loadFiltered],
  );

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    const o = getOrg();
    if (o?.type !== 'admin') return void r.replace('/dashboard');
    setMe(o);
    loadCore();
  }, [r, loadCore]);

  useEffect(() => {
    if (token()) loadFiltered();
  }, [loadFiltered]);

  async function act(fn: () => Promise<any>, ok = 'Done') {
    setBusy(true);
    try {
      const res = await fn();
      // a rotated key is shown exactly once, so it goes to a sticky panel rather than a toast
      if (res?.api_key) setNewKey(res.api_key);
      else toast.success(ok);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  const patch = (path: string, body: any, ok?: string) =>
    act(() => api(path, { method: 'PATCH', body: JSON.stringify(body) }), ok);
  const post = (path: string, body: any, ok?: string) =>
    act(() => api(path, { method: 'POST', body: JSON.stringify(body) }), ok);
  /** An in-page jump. A button, not an <a> without an href — that takes no keyboard focus. */
  const link = (label: string, onClick: () => void, danger = false) => (
    <button
      className={cx(linkish, danger && 'text-bad')}
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  );
  /** One row inside an Actions menu. */
  const item = (label: string, onClick: () => void, danger = false) => (
    <button key={label} className={menuItem(danger)} disabled={busy} onClick={onClick}>
      {label}
    </button>
  );

  if (!me) return null;
  // A failed load is its own state — not "still loading", and not data.
  const failed = !d.overview && Boolean(loadErr);
  const loading = !d.overview && !failed;
  const o = d.overview;
  const campaigns = d.campaigns ?? [];
  // Redemptions carry the publisher's user ref; scans only know the device. Join so a scan row
  // can show who it turned into.
  const userByScan = new Map((d.redemptions ?? []).map((x) => [x.scan_id, x]));
  // One control, two tabs — Audience and Scans are the same rows counted two ways, so a
  // campaign chosen on one must still be chosen on the other.
  const campaignPicker = (
    <select
      className={cx(selectField, 'mt-3 max-w-85')}
      value={campaignFilter}
      onChange={(e) => setCampaignFilter(e.target.value)}
      aria-label="Campaign"
    >
      <option value="">All campaigns</option>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} — {c.promoter_name}
        </option>
      ))}
    </select>
  );

  return (
    <Shell
      org={me}
      items={TABS.map((t) => ({
        id: t.id,
        label: t.id,
        icon: t.icon,
        group: t.group || undefined,
        badge: t.id === 'Partnerships' ? o?.pending_partnerships : undefined,
      }))}
      active={tab}
      onSelect={(id) => setTab(id as Tab)}
      title={tab}
      lede={HEAD[tab]}
      actions={
        <>
          {o && !o.ledger_balanced && (
            <span className={pillBad}>ledger off by {num(o.ledger_sum)}</span>
          )}
          <button className={btnGhost} onClick={() => load()}>
            Refresh
          </button>
        </>
      }
    >
      {newKey && (
        <div className={cx(card, 'mt-3')}>
          <b>New API key — shown once. Copy it now.</b>
          <code className={codeKey}>{newKey}</code>
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <button
              className={btn}
              onClick={() => {
                navigator.clipboard.writeText(newKey);
                toast.success('Copied');
              }}
            >
              Copy
            </button>
            <button className={btnGhost} onClick={() => setNewKey('')}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {tab === 'Overview' &&
        (!o ? (
          failed ? (
            <LoadError message={loadErr} onRetry={() => load()} />
          ) : (
            <div className={cx(card, 'mt-3 grid gap-3')}>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className={skeleton} style={{ width: `${100 - i * 9}%` }} />
              ))}
            </div>
          )
        ) : (
          <>
            {/* The one thing a platform operator has to know before anything else: does the
                money add up. It leads the page rather than sitting in a footnote row. */}
            <LedgerHealth
              ok={o.ledger_balanced}
              sum={o.ledger_sum}
              onOpen={() => setTab('Ledger')}
            />

            <h2 className={sectionHead}>Live now</h2>
            <Figures
              className="mt-3"
              onPick={(go) => setTab(go as Tab)}
              items={[
                { k: 'Scans, last 24h', v: num(o.scans_24h), go: 'Audience' },
                { k: 'Active campaigns', v: num(o.active_campaigns), go: 'Campaigns' },
                {
                  k: 'Scan → signup',
                  v: `${((o.conversion_rate ?? 0) * 100).toFixed(1)}%`,
                  go: 'Audience',
                },
              ]}
            />

            <h2 className={sectionHead}>Needs attention</h2>
            <div className={cx(card, 'mt-3 p-2')}>
              {[
                ['Partnerships waiting on a publisher', o.pending_partnerships, 'Partnerships'],
                ['Suspended organizations', o.suspended_orgs, 'Organizations'],
                ['Voided QR codes', o.voided_codes, 'QR codes'],
              ].map(([k, v, go]) => (
                <button className={queueRow} key={k as string} onClick={() => setTab(go as Tab)}>
                  <span className={queueCount(Boolean(v))}>{num(v as number)}</span>
                  <span>{k as string}</span>
                  <span className="ml-auto text-mut" aria-hidden="true">
                    →
                  </span>
                </button>
              ))}
              {!o.pending_partnerships && !o.suspended_orgs && !o.voided_codes && (
                <p className={cx(muted, 'px-3 py-2.5')}>Nothing is waiting on you.</p>
              )}
            </div>

            <h2 className={sectionHead}>Coins</h2>
            <Figures
              className="mt-3"
              items={counts([
                ['funded', o.total_funded],
                ['granted', o.coins_granted],
                ['unspent', (o.total_funded ?? 0) - (o.coins_granted ?? 0)],
                ['identified', o.identified_redemptions],
                ['guest', o.guest_redemptions],
              ])}
            />

            <h2 className={sectionHead}>Platform</h2>
            <Figures
              className="mt-3"
              items={counts([
                ['promoters', o.promoters],
                ['publishers', o.publishers],
                ['partnerships', o.partnerships],
                ['campaigns', o.campaigns],
                ['QR codes', o.qr_codes],
                ['scans', o.scans],
                ['redemptions', o.redemptions],
              ])}
            />
          </>
        ))}

      {tab === 'Organizations' && (
        <Table
          loading={loading}
          rows={d.orgs ?? []}
          cols={[
            { h: 'Name', get: (x) => x.name },
            { h: 'Type', sort: (x) => x.type, get: (x) => pill(x.type) },
            { h: 'Email', get: (x) => x.email },
            { h: 'Landing URL', sort: (x) => x.landing_url ?? '', get: (x) => (x.landing_url ? <a className={linkClass} href={x.landing_url} target="_blank" rel="noreferrer">{x.landing_url}</a> : '—') },
            { h: 'API key', sort: (x) => x.has_api_key, get: (x) => (x.type !== 'publisher' ? '—' : x.has_api_key ? 'set' : <span className="text-bad">missing</span>) },
            { h: 'Campaigns', num: true, get: (x) => x.campaigns },
            { h: 'Coins', num: true, get: (x) => x.coin_balance ?? '—' },
            { h: 'Joined', get: (x) => when(x.created_at), sort: (x) => x.created_at },
            { h: 'Status', get: (x) => pill(x.suspended ? 'suspended' : 'active'), sort: (x) => x.suspended },
            {
              h: '',
              get: (x) => (
                <Actions>
                  {item(x.suspended ? 'Reinstate' : 'Suspend', () =>
                    patch(`/v1/admin/orgs/${x.id}`, { suspended: !x.suspended }, x.suspended ? 'Reinstated' : 'Suspended'),
                  )}
                  {item('Rename', async () => {
                    const name = await promptDialog({
                      title: `Rename ${x.name}`,
                      inputLabel: 'Organization name',
                      input: x.name,
                      confirmText: 'Rename',
                    });
                    if (name && name !== x.name) patch(`/v1/admin/orgs/${x.id}`, { name }, 'Renamed');
                  })}
                  {x.type === 'publisher' && (
                    <>
                      {item('Set landing URL', async () => {
                        const landing_url = await promptDialog({
                          title: `Landing URL for ${x.name}`,
                          body: 'Where a scanned user is redirected. Must be https.',
                          inputLabel: 'URL',
                          input: x.landing_url ?? '',
                          confirmText: 'Save',
                        });
                        if (landing_url) patch(`/v1/admin/orgs/${x.id}`, { landing_url }, 'Landing URL updated');
                      })}
                      {item('Rotate API key', async () => {
                        const go = await confirmDialog({
                          title: `Rotate the API key for ${x.name}?`,
                          body: 'The old key stops working immediately, and their backend will fail until they deploy the new one.',
                          confirmText: 'Rotate key',
                          danger: true,
                        });
                        if (go) post(`/v1/admin/orgs/${x.id}/rotate-key`, {});
                      })}
                    </>
                  )}
                  {item(
                    'Offboard org',
                    async () => {
                      const reason = await promptDialog({
                        title: `Offboard ${x.name}?`,
                        body: 'Suspends the org, revokes its API key and ends every campaign it takes part in. Recorded in the audit log.',
                        inputLabel: 'Reason',
                        input: '',
                        confirmText: 'Offboard',
                        danger: true,
                      });
                      if (reason !== null) post(`/v1/admin/orgs/${x.id}/offboard`, { reason }, 'Org offboarded');
                    },
                    true,
                  )}
                </Actions>
              ),
            },
          ]}
        />
      )}

      {tab === 'Partnerships' && (
        <Table
          loading={loading}
          rows={d.partnerships ?? []}
          cols={[
            { h: 'Promoter', get: (x) => x.promoter_name },
            { h: 'Publisher', get: (x) => x.publisher_name },
            ...(['coin_rate', 'guest_rate', 'grace_days'] as const).map((f) => ({
              h: f === 'grace_days' ? 'Grace (days)' : f === 'coin_rate' ? 'Coins / signup' : 'Guest rate',
              sort: (x: any) => x[f],
              get: (x: any) => (
                <input
                  className={cx(field, 'w-22.5 px-2 py-1.5 text-[13px]')}
                  type="number"
                  defaultValue={x[f]}
                  onBlur={(e) =>
                    +e.target.value !== x[f] &&
                    patch(`/v1/admin/partnerships/${x.id}`, { [f]: +e.target.value }, 'Rate updated')
                  }
                />
              ),
            })),
            { h: 'Status', sort: (x) => x.status, get: (x) => pill(x.status) },
            { h: 'Created', get: (x) => when(x.created_at), sort: (x) => x.created_at },
            {
              h: '',
              get: (x) =>
                x.status === 'pending'
                  ? link('Force approve', () =>
                      patch(`/v1/admin/partnerships/${x.id}`, { status: 'active' }, 'Partnership approved'),
                    )
                  : link('Set pending', () =>
                      patch(`/v1/admin/partnerships/${x.id}`, { status: 'pending' }, 'Partnership paused'),
                    ),
            },
          ]}
        />
      )}

      {tab === 'Campaigns' && (
        <Table
          loading={loading}
          rows={campaigns}
          cols={[
            { h: 'Campaign', get: (x) => x.name },
            { h: 'Promoter', get: (x) => x.promoter_name },
            { h: 'Publisher', get: (x) => x.publisher_name },
            { h: 'Rate', num: true, get: (x) => x.coin_rate },
            // `scans`/`redemptions` are counted only by the admin listing, hence optional
            { h: 'Scans', num: true, get: (x) => x.scans ?? 0 },
            { h: 'Redemptions', num: true, get: (x) => x.redemptions ?? 0 },
            {
              h: 'Conv.',
              num: true,
              sort: (x) => (x.scans ? (x.redemptions ?? 0) / x.scans : -1),
              get: (x) => (x.scans ? `${(((x.redemptions ?? 0) / x.scans) * 100).toFixed(0)}%` : '—'),
            },
            {
              h: 'Budget',
              num: true,
              sort: (x) => x.budget,
              get: (x) => (
                <span className={x.budget < x.coin_rate ? 'text-bad' : ''}>{num(x.budget)}</span>
              ),
            },
            {
              h: 'Status',
              sort: (x) => x.status,
              get: (x) => (
                <select
                  className={cx(selectField, 'w-27.5 px-2 py-1.5 text-[13px]')}
                  value={x.status}
                  onChange={(e) => patch(`/v1/admin/campaigns/${x.id}`, { status: e.target.value }, 'Campaign updated')}
                >
                  {['active', 'paused', 'ended'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              ),
            },
            {
              h: '',
              get: (x) => (
                <Actions>
                  {item('Adjust budget', async () => {
                    const v = await promptDialog({
                      title: `Adjust budget for "${x.name}"`,
                      body: `Current budget is ${num(x.budget)} coins. Negative claws back; the result cannot go below zero.`,
                      inputLabel: 'Coins',
                      input: '100',
                      confirmText: 'Adjust',
                    });
                    if (v) post(`/v1/admin/campaigns/${x.id}/adjust`, { coins: +v }, 'Budget adjusted');
                  })}
                  {item('View its scans', () => {
                    setCampaignFilter(x.id);
                    setTab('Scans');
                  })}
                  {item('View its ledger', () => {
                    setLedgerAccount(`campaign:${x.id}`);
                    setTab('Ledger');
                  })}
                  {x.status !== 'ended' &&
                    item(
                      'Kill campaign',
                      async () => {
                        const reason = await promptDialog({
                          title: `Kill "${x.name}"?`,
                          body: 'Ends the campaign and voids every QR code it ever issued. Printed codes stop working immediately.',
                          inputLabel: 'Reason',
                          input: '',
                          confirmText: 'Kill campaign',
                          danger: true,
                        });
                        if (reason !== null) post(`/v1/admin/campaigns/${x.id}/kill`, { reason }, 'Campaign killed');
                      },
                      true,
                    )}
                </Actions>
              ),
            },
          ]}
        />
      )}

      {tab === 'Audience' && (
        <>
          {campaignPicker}
          <Audience data={d.analytics ?? null} days={days} onDays={setDays} scoped={Boolean(campaignFilter)} />
        </>
      )}

      {tab === 'Scans' && (
        <>
          <p className={cx(muted, 'mt-3')}>
            The user column fills in once the scan converts and the publisher reports its user reference.
          </p>
          {campaignPicker}
          <Table
            loading={loading}
            rows={d.scans ?? []}
            empty="No scans recorded."
            cols={[
              { h: 'When', sort: (x) => x.scanned_at, get: (x) => <span title={when(x.scanned_at)}>{ago(x.scanned_at)}</span> },
              { h: 'Campaign', get: (x) => x.campaign_name },
              { h: 'Publisher', get: (x) => x.publisher_name },
              { h: 'QR', sort: (x) => x.qr_code, get: (x) => <code>{x.qr_code}</code> },
              {
                h: 'Where',
                sort: (x) => x.country ?? '',
                get: (x) =>
                  x.country ? (
                    <span title={x.city ?? undefined}>
                      {country(x.country)}
                      {x.city ? <span className={cx(muted, 'ml-1.5')}>{x.city}</span> : null}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              // device_type is stored from the scan itself; the UA fallback only covers rows
              // recorded before those columns existed.
              { h: 'Device', sort: (x) => x.device_type ?? device(x.user_agent ?? ''), get: (x) => <span title={x.user_agent ?? ''}>{x.device_type ?? device(x.user_agent ?? '')}</span> },
              { h: 'OS', sort: (x) => x.os ?? '', get: (x) => x.os ?? '—' },
              { h: 'Browser', sort: (x) => x.browser ?? '', get: (x) => x.browser ?? '—' },
              { h: 'Lang', sort: (x) => x.language ?? '', get: (x) => x.language ?? '—' },
              { h: 'From', sort: (x) => x.referer_host ?? '', get: (x) => x.referer_host ?? <span className={muted}>camera</span> },
              { h: 'IP hash', sort: (x) => x.ip_hash ?? '', get: (x) => <code>{x.ip_hash ?? '—'}</code> },
              {
                h: 'User',
                sort: (x) => userByScan.get(x.id)?.publisher_user_ref ?? '',
                get: (x) => {
                  const u = userByScan.get(x.id);
                  return u ? <code title={u.identified ? 'identified' : 'guest'}>{u.publisher_user_ref}</code> : '—';
                },
              },
              { h: 'Token', sort: (x) => x.consumed, get: (x) => (x.consumed ? 'spent' : 'open') },
              {
                h: 'Converted',
                sort: (x) => x.redeemed,
                get: (x) => <span className={x.redeemed ? 'text-ok' : 'text-mut'}>{x.redeemed ? `+${num(x.coins)} coins` : '—'}</span>,
              },
            ]}
          />
        </>
      )}

      {tab === 'Redemptions' && (
        <Table
          loading={loading}
          rows={d.redemptions ?? []}
          empty="No redemptions yet."
          cols={[
            { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
            { h: 'Campaign', get: (x) => x.campaign_name },
            { h: 'Promoter', get: (x) => x.promoter_name },
            { h: 'Publisher', get: (x) => x.publisher_name },
            { h: 'Publisher user', sort: (x) => x.publisher_user_ref, get: (x) => <code>{x.publisher_user_ref}</code> },
            { h: 'Kind', sort: (x) => x.identified, get: (x) => pill(x.identified ? 'identified' : 'guest') },
            { h: 'Upgraded', sort: (x) => x.upgraded_at ?? '', get: (x) => when(x.upgraded_at) },
            { h: 'Coins', num: true, sort: (x) => x.coins, get: (x) => num(x.coins) },
            {
              h: '',
              get: (x) =>
                link('Ledger', () => {
                  setLedgerAccount(`campaign:${x.campaign_id}`);
                  setTab('Ledger');
                }),
            },
          ]}
        />
      )}

      {tab === 'QR codes' && (
        <Table
          loading={loading}
          rows={d.qrCodes ?? []}
          empty="No codes issued."
          cols={[
            { h: 'Code', sort: (x) => x.code, get: (x) => <code>{x.code}</code> },
            { h: 'Campaign', get: (x) => x.campaign_name ?? '' },
            { h: 'Scans', num: true, sort: (x) => x.scans ?? 0, get: (x) => x.scans ?? 0 },
            { h: 'Uses', sort: (x) => x.uses, get: (x) => `${x.uses}${x.max_uses ? ` / ${x.max_uses}` : ' / ∞'}` },
            { h: 'Expires', sort: (x) => x.expires_at ?? '', get: (x) => (x.expires_at ? when(x.expires_at) : 'never') },
            { h: 'Created', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
            { h: 'State', sort: (x) => x.voided, get: (x) => pill(x.voided ? 'suspended' : 'active') },
            {
              h: '',
              get: (x) => (
                <Actions>
                  <a className={menuItem()} href={x.scan_url} target="_blank" rel="noreferrer">
                    Open the scan URL
                  </a>
                  {item('Copy scan URL', () => {
                    navigator.clipboard.writeText(x.scan_url);
                    toast.success('Scan URL copied');
                  })}
                  {item('Set expiry', async () => {
                    const v = await promptDialog({
                      title: `Expiry for /${x.code}`,
                      body: 'ISO timestamp, or leave blank for a code that never expires.',
                      inputLabel: 'Expires at',
                      input: x.expires_at ? new Date(x.expires_at).toISOString() : '',
                      confirmText: 'Save',
                    });
                    if (v !== null) patch(`/v1/admin/qr-codes/${x.id}`, { expires_at: v.trim() || null }, 'Expiry updated');
                  })}
                  {item('Set max uses', async () => {
                    const v = await promptDialog({
                      title: `Use limit for /${x.code}`,
                      body: 'Leave blank for unlimited scans.',
                      inputLabel: 'Max uses',
                      input: String(x.max_uses ?? ''),
                      confirmText: 'Save',
                    });
                    if (v !== null) patch(`/v1/admin/qr-codes/${x.id}`, { max_uses: v.trim() ? +v : null }, 'Max uses updated');
                  })}
                  {item(
                    x.voided ? 'Restore this code' : 'Void this code',
                    () => patch(`/v1/admin/qr-codes/${x.id}`, { voided: !x.voided }, x.voided ? 'Code restored' : 'Code voided'),
                    !x.voided,
                  )}
                </Actions>
              ),
            },
          ]}
        />
      )}

      {tab === 'Ledger' && (
        <>
          {/* The integrity check leads this tab as it leads the Overview. An operator who
              deep-links straight here would otherwise read balances with no way to know
              whether they still sum to zero. */}
          {o && <LedgerHealth ok={o.ledger_balanced} sum={o.ledger_sum} />}

          <h2 className={sectionHead}>Account balances</h2>
          <Table
            loading={loading}
            rows={d.ledger?.balances ?? []}
            empty="No accounts."
            cols={[
              { h: 'Account', sort: (x) => x.account, get: (x) => <code>{x.account}</code> },
              {
                h: 'Balance',
                num: true,
                sort: (x) => x.balance,
                // A balance carries its own sign: coins drawn out of an account are a debit,
                // and printing them in the same ink as a credit hides the direction.
                get: (x) => (
                  <span className={x.balance < 0 ? 'text-bad' : x.balance > 0 ? 'text-ok' : ''}>
                    {num(x.balance)}
                  </span>
                ),
              },
              { h: '', get: (x) => link('Entries', () => setLedgerAccount(x.account)) },
            ]}
          />

          <h2 className={sectionHead}>Entries</h2>
          {/* What is narrowing the table is a control above it, not a clause inside the
              heading — a filter you cannot see is a filter you forget you set. */}
          <div className={filterBar}>
            {ledgerAccount ? (
              <>
                <span className={filterChip}>
                  <code>{ledgerAccount}</code>
                  <button
                    className={filterChipDrop}
                    onClick={() => setLedgerAccount('')}
                    aria-label="Show every account"
                    title="Show every account"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="m4.5 4.5 7 7m0-7-7 7" />
                    </svg>
                  </button>
                </span>
                <span className={muted}>Every entry posted against this account.</span>
              </>
            ) : (
              <span className={muted}>
                The 300 newest entries, every account. Pick one above to see all of its.
              </span>
            )}
          </div>
          <Table
            loading={loading}
            rows={d.ledger?.entries ?? []}
            empty="No entries."
            cols={[
              { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
              { h: 'Account', sort: (x) => x.account, get: (x) => <code>{x.account}</code> },
              { h: 'Amount', num: true, sort: (x) => x.amount, get: (x) => <span className={x.amount < 0 ? 'text-bad' : 'text-ok'}>{num(x.amount)}</span> },
              { h: 'Ref', sort: (x) => x.ref, get: (x) => <code>{x.ref}</code> },
            ]}
          />
        </>
      )}

      {tab === 'Audit log' && (
        <Table
          loading={loading}
          rows={d.audit ?? []}
          empty="No admin actions recorded."
          cols={[
            { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
            { h: 'Actor', get: (x) => x.actor_name ?? 'system', sort: (x) => x.actor_name ?? '' },
            { h: 'Action', sort: (x) => x.action, get: (x) => <code>{x.action}</code> },
            { h: 'Target', sort: (x) => x.target, get: (x) => <code>{x.target}</code> },
            {
              h: 'Detail',
              sort: (x) => JSON.stringify(x.detail),
              get: (x) => (
                <span className={cx(muted, 'whitespace-pre-wrap')}>
                  {JSON.stringify(x.detail)}
                </span>
              ),
            },
          ]}
        />
      )}
    </Shell>
  );
}
