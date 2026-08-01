'use client';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, org as getOrg, token } from '@/lib/api';
import { confirmDialog, promptDialog, toast } from '@/lib/ui';

const TABS = [
  'Overview',
  'Organizations',
  'Partnerships',
  'Campaigns',
  'Scans',
  'Redemptions',
  'QR codes',
  'Ledger',
  'Audit log',
] as const;
type Tab = (typeof TABS)[number];

const when = (t?: string | null) => (t ? new Date(t).toLocaleString() : '—');
const ago = (t: string) => {
  let s = (Date.now() - new Date(t).getTime()) / 1000;
  for (const [n, u] of [[60, 's'], [60, 'm'], [24, 'h'], [7, 'd']] as const) {
    if (s < n) return `${Math.round(s)}${u} ago`;
    s /= n;
  }
  return when(t);
};
// ponytail: crude UA bucketing, good enough for a device column. Use a UA parser if it needs to be right.
const device = (ua: string) =>
  !ua ? '—' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mobile/.test(ua) ? 'Mobile' : 'Desktop';
const pill = (s: string) => <span className={`pill ${s}`}>{s}</span>;

type Col = { h: string; get: (row: any) => ReactNode; sort?: (row: any) => any };

/** One table for every tab: free-text filter + click-to-sort headers. */
function Table({ cols, rows, empty = 'Nothing here yet.' }: { cols: Col[]; rows: any[]; empty?: string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle
      ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle))
      : rows.slice();
    if (sort) {
      const key = cols[sort.i].sort ?? cols[sort.i].get;
      out.sort((a, b) => {
        const [x, y] = [key(a), key(b)] as any[];
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
    }
    return out;
  }, [q, rows, sort, cols]);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <input
          placeholder="Filter these rows…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <span className="muted">
          {shown.length}
          {shown.length !== rows.length && ` of ${rows.length}`} rows
        </span>
      </div>
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={i}
                style={{ cursor: c.h ? 'pointer' : 'default', userSelect: 'none' }}
                onClick={() =>
                  c.h && setSort((s) => (s?.i === i ? { i, dir: s.dir === 1 ? -1 : 1 } : { i, dir: 1 }))
                }
              >
                {c.h}
                {sort?.i === i ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.id ?? r.account ?? i}>
              {cols.map((c, j) => (
                <td key={j}>{c.get(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!shown.length && <p className="muted" style={{ marginTop: 12 }}>{empty}</p>}
    </>
  );
}

export default function Admin() {
  const r = useRouter();
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [d, setD] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [ledgerAccount, setLedgerAccount] = useState('');

  async function load() {
    try {
      const [overview, orgs, partnerships, campaigns, scans, redemptions, qrCodes, ledger, audit] =
        await Promise.all([
          api('/v1/admin/overview'),
          api('/v1/admin/orgs'),
          api('/v1/admin/partnerships'),
          api('/v1/admin/campaigns'),
          api(`/v1/admin/scans?limit=1000${campaignFilter ? `&campaign_id=${campaignFilter}` : ''}`),
          api('/v1/admin/redemptions?limit=1000'),
          api('/v1/admin/qr-codes'),
          api(`/v1/admin/ledger${ledgerAccount ? `?account=${encodeURIComponent(ledgerAccount)}` : ''}`),
          api('/v1/admin/audit-log?limit=500'),
        ]);
      setD({ overview, orgs, partnerships, campaigns, scans, redemptions, qrCodes, ledger, audit });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    const o = getOrg();
    if (o?.type !== 'admin') return void r.replace('/dashboard');
    setMe(o);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, campaignFilter, ledgerAccount]);

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
  const link = (label: string, onClick: () => void, danger = false) => (
    <a
      style={{ cursor: 'pointer', ...(danger ? { color: 'var(--bad)' } : {}) }}
      onClick={() => !busy && onClick()}
    >
      {label}
    </a>
  );
  const sep = <span className="muted"> · </span>;

  if (!me) return null;
  const o = d.overview ?? {};
  const campaigns: any[] = d.campaigns ?? [];
  // Redemptions carry the publisher's user ref; scans only know the device. Join so a scan row
  // can show who it turned into.
  const userByScan = new Map<string, any>((d.redemptions ?? []).map((x: any) => [x.scan_id, x]));

  return (
    <main style={{ maxWidth: 1240 }}>
      <div className="topbar">
        <div>
          <b>{me.name}</b> <span className="pill">super admin</span>
          {!o.ledger_balanced && d.overview && (
            <span className="pill suspended" style={{ marginLeft: 8 }}>
              ledger off by {o.ledger_sum}
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 14 }}>
          {link('Refresh', () => load())}
          {link('Sign out', () => {
            localStorage.clear();
            r.push('/login');
          })}
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
            {t === 'Partnerships' && o.pending_partnerships ? ` (${o.pending_partnerships})` : ''}
          </button>
        ))}
      </div>

      {newKey && (
        <div className="card">
          <b>New API key — shown once. Copy it now.</b>
          <code className="key">{newKey}</code>
          <div className="row">
            <button
              onClick={() => {
                navigator.clipboard.writeText(newKey);
                toast.success('Copied');
              }}
            >
              Copy
            </button>
            <button className="ghost" onClick={() => setNewKey('')}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {tab === 'Overview' && (
        <>
          <h2>Platform</h2>
          <div className="card row" style={{ justifyContent: 'space-between' }}>
            {[
              ['Promoters', o.promoters],
              ['Publishers', o.publishers],
              ['Partnerships', o.partnerships],
              ['Campaigns', o.campaigns],
              ['QR codes', o.qr_codes],
              ['Scans', o.scans],
              ['Redemptions', o.redemptions],
            ].map(([k, v]) => (
              <div className="stat" key={k as string}>
                <b>{v ?? 0}</b>
                <span className="muted">{k}</span>
              </div>
            ))}
          </div>

          <h2>Money</h2>
          <div className="card row" style={{ justifyContent: 'space-between' }}>
            {[
              ['Coins funded', o.total_funded],
              ['Coins granted', o.coins_granted],
              ['Unspent', (o.total_funded ?? 0) - (o.coins_granted ?? 0)],
              ['Identified', o.identified_redemptions],
              ['Guest', o.guest_redemptions],
            ].map(([k, v]) => (
              <div className="stat" key={k as string}>
                <b>{v ?? 0}</b>
                <span className="muted">{k}</span>
              </div>
            ))}
          </div>

          <h2>Needs attention</h2>
          <div className="card row" style={{ justifyContent: 'space-between' }}>
            {[
              ['Scans (24h)', o.scans_24h, 'Scans'],
              ['Active campaigns', o.active_campaigns, 'Campaigns'],
              ['Pending partnerships', o.pending_partnerships, 'Partnerships'],
              ['Suspended orgs', o.suspended_orgs, 'Organizations'],
              ['Voided codes', o.voided_codes, 'QR codes'],
            ].map(([k, v, go]) => (
              <div
                className="stat"
                key={k as string}
                style={{ cursor: 'pointer' }}
                onClick={() => setTab(go as Tab)}
              >
                <b>{v ?? 0}</b>
                <span className="muted">{k as string}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Scan → signup conversion</span>
              <b>{((o.conversion_rate ?? 0) * 100).toFixed(1)}%</b>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span>Ledger integrity (all entries sum to zero)</span>
              <b className={o.ledger_balanced ? 'ok' : 'err'}>
                {o.ledger_balanced ? 'balanced' : `OFF BY ${o.ledger_sum}`}
              </b>
            </div>
          </div>
        </>
      )}

      {tab === 'Organizations' && (
        <>
          <h2>Organizations</h2>
          <Table
            rows={d.orgs ?? []}
            cols={[
              { h: 'Name', get: (x) => x.name },
              { h: 'Type', get: (x) => pill(x.type) },
              { h: 'Email', get: (x) => x.email },
              { h: 'Landing URL', get: (x) => (x.landing_url ? <a href={x.landing_url} target="_blank" rel="noreferrer">{x.landing_url}</a> : '—') },
              { h: 'API key', get: (x) => (x.type !== 'publisher' ? '—' : x.has_api_key ? 'set' : <span className="err">missing</span>) },
              { h: 'Campaigns', get: (x) => x.campaigns },
              { h: 'Coins', get: (x) => x.coin_balance ?? '—' },
              { h: 'Joined', get: (x) => when(x.created_at), sort: (x) => x.created_at },
              { h: 'Status', get: (x) => pill(x.suspended ? 'suspended' : 'active'), sort: (x) => x.suspended },
              {
                h: '',
                get: (x) => (
                  <>
                    {link(x.suspended ? 'Reinstate' : 'Suspend', () =>
                      patch(`/v1/admin/orgs/${x.id}`, { suspended: !x.suspended }, x.suspended ? 'Reinstated' : 'Suspended'),
                    )}
                    {sep}
                    {link('Rename', async () => {
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
                        {sep}
                        {link('Landing URL', async () => {
                          const landing_url = await promptDialog({
                            title: `Landing URL for ${x.name}`,
                            body: 'Where a scanned user is redirected. Must be https.',
                            inputLabel: 'URL',
                            input: x.landing_url ?? '',
                            confirmText: 'Save',
                          });
                          if (landing_url) patch(`/v1/admin/orgs/${x.id}`, { landing_url }, 'Landing URL updated');
                        })}
                        {sep}
                        {link('Rotate key', async () => {
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
                    {sep}
                    {link(
                      'Offboard',
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
                  </>
                ),
              },
            ]}
          />
        </>
      )}

      {tab === 'Partnerships' && (
        <>
          <h2>Partnerships</h2>
          <p className="muted">
            Rates are per redemption. Guest rate is paid up front for an unidentified signup; the delta is
            released if the user identifies within the grace window.
          </p>
          <Table
            rows={d.partnerships ?? []}
            cols={[
              { h: 'Promoter', get: (x) => x.promoter_name },
              { h: 'Publisher', get: (x) => x.publisher_name },
              ...(['coin_rate', 'guest_rate', 'grace_days'] as const).map((f) => ({
                h: f === 'grace_days' ? 'Grace (days)' : f === 'coin_rate' ? 'Coins / signup' : 'Guest rate',
                sort: (x: any) => x[f],
                get: (x: any) => (
                  <input
                    type="number"
                    defaultValue={x[f]}
                    style={{ width: 90 }}
                    onBlur={(e) =>
                      +e.target.value !== x[f] &&
                      patch(`/v1/admin/partnerships/${x.id}`, { [f]: +e.target.value }, 'Rate updated')
                    }
                  />
                ),
              })),
              { h: 'Status', get: (x) => pill(x.status) },
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
        </>
      )}

      {tab === 'Campaigns' && (
        <>
          <h2>Campaigns</h2>
          <Table
            rows={campaigns}
            cols={[
              { h: 'Campaign', get: (x) => x.name },
              { h: 'Promoter', get: (x) => x.promoter_name },
              { h: 'Publisher', get: (x) => x.publisher_name },
              { h: 'Rate', get: (x) => x.coin_rate },
              { h: 'Scans', get: (x) => x.scans },
              { h: 'Redemptions', get: (x) => x.redemptions },
              {
                h: 'Conv.',
                sort: (x) => (x.scans ? x.redemptions / x.scans : -1),
                get: (x) => (x.scans ? `${((x.redemptions / x.scans) * 100).toFixed(0)}%` : '—'),
              },
              {
                h: 'Budget',
                sort: (x) => x.budget,
                get: (x) => (
                  <span className={x.budget < x.coin_rate ? 'err' : ''}>{x.budget}</span>
                ),
              },
              {
                h: 'Status',
                sort: (x) => x.status,
                get: (x) => (
                  <select
                    value={x.status}
                    style={{ width: 110 }}
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
                  <>
                    {link('Adjust budget', async () => {
                      const v = await promptDialog({
                        title: `Adjust budget for "${x.name}"`,
                        body: `Current budget is ${x.budget} coins. Negative claws back; the result cannot go below zero.`,
                        inputLabel: 'Coins',
                        input: '100',
                        confirmText: 'Adjust',
                      });
                      if (v) post(`/v1/admin/campaigns/${x.id}/adjust`, { coins: +v }, 'Budget adjusted');
                    })}
                    {sep}
                    {link('Scans', () => {
                      setCampaignFilter(x.id);
                      setTab('Scans');
                    })}
                    {sep}
                    {link('Ledger', () => {
                      setLedgerAccount(`campaign:${x.id}`);
                      setTab('Ledger');
                    })}
                    {x.status !== 'ended' && (
                      <>
                        {sep}
                        {link(
                          'Kill',
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
                      </>
                    )}
                  </>
                ),
              },
            ]}
          />
        </>
      )}

      {tab === 'Scans' && (
        <>
          <h2>Scans</h2>
          <p className="muted">
            Every QR scan, newest first. IPs are stored as a truncated hash — enough to spot a repeat
            scanner, not enough to identify a person. The user column fills in once the scan converts and
            the publisher reports its user reference.
          </p>
          <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} style={{ maxWidth: 340 }}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.promoter_name}
              </option>
            ))}
          </select>
          <Table
            rows={d.scans ?? []}
            empty="No scans recorded."
            cols={[
              { h: 'When', sort: (x) => x.scanned_at, get: (x) => <span title={when(x.scanned_at)}>{ago(x.scanned_at)}</span> },
              { h: 'Campaign', get: (x) => x.campaign_name },
              { h: 'Publisher', get: (x) => x.publisher_name },
              { h: 'QR', get: (x) => <code>{x.qr_code}</code> },
              { h: 'Device', sort: (x) => device(x.user_agent ?? ''), get: (x) => <span title={x.user_agent ?? ''}>{device(x.user_agent ?? '')}</span> },
              { h: 'IP hash', get: (x) => <code>{x.ip_hash ?? '—'}</code> },
              {
                h: 'User',
                get: (x) => {
                  const u = userByScan.get(x.id);
                  return u ? <code title={u.identified ? 'identified' : 'guest'}>{u.publisher_user_ref}</code> : '—';
                },
              },
              { h: 'Token', sort: (x) => x.consumed, get: (x) => (x.consumed ? 'spent' : 'open') },
              {
                h: 'Converted',
                sort: (x) => x.redeemed,
                get: (x) => <span className={x.redeemed ? 'ok' : 'muted'}>{x.redeemed ? `+${x.coins} coins` : '—'}</span>,
              },
            ]}
          />
        </>
      )}

      {tab === 'Redemptions' && (
        <>
          <h2>Redemptions</h2>
          <Table
            rows={d.redemptions ?? []}
            empty="No redemptions yet."
            cols={[
              { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
              { h: 'Campaign', get: (x) => x.campaign_name },
              { h: 'Promoter', get: (x) => x.promoter_name },
              { h: 'Publisher', get: (x) => x.publisher_name },
              { h: 'Publisher user', get: (x) => <code>{x.publisher_user_ref}</code> },
              { h: 'Kind', sort: (x) => x.identified, get: (x) => pill(x.identified ? 'identified' : 'guest') },
              { h: 'Upgraded', sort: (x) => x.upgraded_at ?? '', get: (x) => when(x.upgraded_at) },
              { h: 'Coins', sort: (x) => x.coins, get: (x) => x.coins },
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
        </>
      )}

      {tab === 'QR codes' && (
        <>
          <h2>QR codes</h2>
          <Table
            rows={d.qrCodes ?? []}
            empty="No codes issued."
            cols={[
              { h: 'Code', get: (x) => <code>{x.code}</code> },
              { h: 'Campaign', get: (x) => x.campaign_name },
              { h: 'Scans', sort: (x) => x.scans, get: (x) => x.scans },
              { h: 'Uses', sort: (x) => x.uses, get: (x) => `${x.uses}${x.max_uses ? ` / ${x.max_uses}` : ' / ∞'}` },
              { h: 'Expires', sort: (x) => x.expires_at ?? '', get: (x) => (x.expires_at ? when(x.expires_at) : 'never') },
              { h: 'Created', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
              { h: 'State', sort: (x) => x.voided, get: (x) => pill(x.voided ? 'suspended' : 'active') },
              {
                h: '',
                get: (x) => (
                  <>
                    <a href={x.scan_url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                    {sep}
                    {link('Copy URL', () => {
                      navigator.clipboard.writeText(x.scan_url);
                      toast.success('Scan URL copied');
                    })}
                    {sep}
                    {link('Expiry', async () => {
                      const v = await promptDialog({
                        title: `Expiry for /${x.code}`,
                        body: 'ISO timestamp, or leave blank for a code that never expires.',
                        inputLabel: 'Expires at',
                        input: x.expires_at ? new Date(x.expires_at).toISOString() : '',
                        confirmText: 'Save',
                      });
                      if (v !== null) patch(`/v1/admin/qr-codes/${x.id}`, { expires_at: v.trim() || null }, 'Expiry updated');
                    })}
                    {sep}
                    {link('Max uses', async () => {
                      const v = await promptDialog({
                        title: `Use limit for /${x.code}`,
                        body: 'Leave blank for unlimited scans.',
                        inputLabel: 'Max uses',
                        input: String(x.max_uses ?? ''),
                        confirmText: 'Save',
                      });
                      if (v !== null) patch(`/v1/admin/qr-codes/${x.id}`, { max_uses: v.trim() ? +v : null }, 'Max uses updated');
                    })}
                    {sep}
                    {link(
                      x.voided ? 'Unvoid' : 'Void',
                      () => patch(`/v1/admin/qr-codes/${x.id}`, { voided: !x.voided }, x.voided ? 'Code restored' : 'Code voided'),
                      !x.voided,
                    )}
                  </>
                ),
              },
            ]}
          />
        </>
      )}

      {tab === 'Ledger' && (
        <>
          <h2>Account balances</h2>
          <Table
            rows={d.ledger?.balances ?? []}
            empty="No accounts."
            cols={[
              { h: 'Account', get: (x) => <code>{x.account}</code> },
              { h: 'Balance', sort: (x) => x.balance, get: (x) => x.balance },
              { h: '', get: (x) => link('Entries', () => setLedgerAccount(x.account)) },
            ]}
          />
          <h2>
            Entries {ledgerAccount ? <>for <code>{ledgerAccount}</code></> : '(last 300, all accounts)'}
          </h2>
          {ledgerAccount && link('Clear account filter', () => setLedgerAccount(''))}
          <Table
            rows={d.ledger?.entries ?? []}
            empty="No entries."
            cols={[
              { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
              { h: 'Account', get: (x) => <code>{x.account}</code> },
              { h: 'Amount', sort: (x) => x.amount, get: (x) => <span className={x.amount < 0 ? 'err' : 'ok'}>{x.amount}</span> },
              { h: 'Ref', get: (x) => <code>{x.ref}</code> },
            ]}
          />
        </>
      )}

      {tab === 'Audit log' && (
        <>
          <h2>Audit log</h2>
          <p className="muted">Every privileged override, newest first.</p>
          <Table
            rows={d.audit ?? []}
            empty="No admin actions recorded."
            cols={[
              { h: 'When', sort: (x) => x.created_at, get: (x) => when(x.created_at) },
              { h: 'Actor', get: (x) => x.actor_name ?? 'system', sort: (x) => x.actor_name ?? '' },
              { h: 'Action', get: (x) => <code>{x.action}</code> },
              { h: 'Target', get: (x) => <code>{x.target}</code> },
              {
                h: 'Detail',
                get: (x) => (
                  <span className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(x.detail)}
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
    </main>
  );
}
