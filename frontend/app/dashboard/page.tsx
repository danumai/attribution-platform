'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, org as getOrg, token } from '@/lib/api';
import { NavItem, Shell } from '@/lib/shell';
import { confirmDialog, promptDialog, toast } from '@/lib/ui';
import { ago, num } from '@/lib/fmt';
import {
  btn,
  btnGhost,
  btnTiny,
  card,
  code as codeChip,
  codeKey,
  cx,
  empty,
  fact,
  field,
  hint,
  kpi,
  kpiFigure,
  label,
  linkish,
  muted,
  pill,
  queueCount,
  queueRow,
  sectionHead,
  select,
  skeleton,
  stamp,
  table,
  tableWrap,
  td,
  tdNum,
  th,
  thNum,
  tr,
} from '@/lib/tw';

/** Stands in for a section while its data is in flight. Rendering the real section
 *  against empty arrays would claim "no campaigns yet" to someone who has forty. */
const Loading = ({ lines = 5 }: { lines?: number }) => (
  <div className={`${card} mt-3 grid gap-3`} aria-busy="true" aria-label="Loading">
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className={skeleton} style={{ width: `${100 - i * 9}%` }} />
    ))}
  </div>
);

/** Newest first, and never more rows than the caller asked for. */
function Redemptions({ rows }: { rows: any[] }) {
  return (
    <div className={tableWrap}>
      <table className={table}>
        <thead>
          <tr>
            <th className={th}>Campaign</th>
            <th className={th}>Publisher user</th>
            <th className={thNum}>Coins</th>
            <th className={th}>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr className={tr} key={x.id}>
              <td className={td}>{x.campaign_name}</td>
              <td className={td}>{x.publisher_user_ref}</td>
              <td className={tdNum}>{num(x.coins)}</td>
              <td className={td} title={new Date(x.created_at).toLocaleString()}>{ago(x.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Deep links from elsewhere in the console land on a section: /dashboard?s=campaigns */
const initialSection = () =>
  (typeof window !== 'undefined' && new URLSearchParams(location.search).get('s')) || 'overview';

const HEAD: Record<string, { title: string; lede: string }> = {
  overview: { title: 'Overview', lede: 'Where your campaigns stand right now.' },
  partnerships: {
    title: 'Partnerships',
    lede: 'A partnership fixes the rates before any campaign can spend against them.',
  },
  campaigns: { title: 'Campaigns', lede: 'Fund a campaign, then print its codes.' },
  redemptions: { title: 'Redemptions', lede: 'Every signup a scan turned into, newest first.' },
  settings: { title: 'Settings', lede: 'Where scanned users land, and the key your backend calls with.' },
};

export default function Dashboard() {
  const r = useRouter();
  const [me, setMe] = useState<any>(null);
  const [sec, setSec] = useState(initialSection);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [partnerships, setPartnerships] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [redemptions, setRedemptions] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newPartner, setNewPartner] = useState({
    publisher_org_id: '',
    coin_rate: 50,
    guest_rate: 10,
    grace_days: 7,
  });
  const [newCampaign, setNewCampaign] = useState({ partnership_id: '', name: '' });
  // Where scans are sent, per platform, plus the publisher's own declared joining bonus.
  const [dest, setDest] = useState({
    landing_url: '',
    android_package: '',
    ios_app_id: '',
    bonus_label: '',
  });
  const setDestField = (k: keyof typeof dest) => (e: any) =>
    setDest((d) => ({ ...d, [k]: e.target.value }));

  async function load() {
    try {
      const [p, ps, cs, rs, self] = await Promise.all([
        api('/v1/publishers'),
        api('/v1/partnerships'),
        api('/v1/campaigns'),
        api('/v1/redemptions'),
        api('/v1/orgs/me'),
      ]);
      setPublishers(p);
      setPartnerships(ps);
      setCampaigns(cs);
      setRedemptions(rs);
      setDest({
        landing_url: self.landing_url ?? '',
        android_package: self.android_package ?? '',
        ios_app_id: self.ios_app_id ?? '',
        bonus_label: self.bonus_label ?? '',
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    const o = getOrg();
    if (o?.type === 'admin') return void r.replace('/admin');
    setMe(o);
    // destinations aren't in the login payload; load() fetches them from /v1/orgs/me
    load();
  }, [r]);

  async function act(fn: () => Promise<any>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;
  const isPromoter = me.type === 'promoter';
  const activePartnerships = partnerships.filter((p) => p.status === 'active');
  // a publisher is the one who has to act on a pending request; a promoter is only waiting
  const awaitingMe = isPromoter ? 0 : partnerships.filter((p) => p.status === 'pending').length;

  const items: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'partnerships', label: 'Partnerships', icon: 'partnerships', badge: awaitingMe },
    { id: 'campaigns', label: 'Campaigns', icon: 'campaigns' },
    { id: 'redemptions', label: 'Redemptions', icon: 'redemptions' },
    ...(isPromoter ? [] : [{ id: 'settings', label: 'Settings', icon: 'settings' } as NavItem]),
  ];

  // /v1/redemptions returns the newest 100, so any total derived from it is a floor,
  // not a count. Print it as one rather than overstating certainty.
  const capped = redemptions.length >= 100;
  const coinsGranted = redemptions.reduce((n, x) => n + (x.coins ?? 0), 0);
  const kpis: [string, string, string][] = [
    ['Active campaigns', num(campaigns.filter((c) => c.status === 'active').length), 'campaigns'],
    ['Active partnerships', num(activePartnerships.length), 'partnerships'],
    ['Redemptions', capped ? `${num(100)}+` : num(redemptions.length), 'redemptions'],
    ['Coins granted', `${capped ? '≥ ' : ''}${num(coinsGranted)}`, 'redemptions'],
  ];

  return (
    <Shell
      org={me}
      items={items}
      active={sec}
      onSelect={setSec}
      title={HEAD[sec].title}
      lede={HEAD[sec].lede}
      actions={
        sec === 'campaigns' && isPromoter && activePartnerships.length > 0 ? (
          <button
            className={linkish}
            onClick={() => document.getElementById('new-campaign')?.scrollIntoView({ behavior: 'smooth' })}
          >
            New campaign
          </button>
        ) : null
      }
    >
      {sec === 'overview' && (
        <>
          <h2 className={sectionHead}>Live now</h2>
          {!loaded ? (
            <Loading lines={3} />
          ) : (
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
            {kpis.map(([k, v, go]) => (
              <button className={kpi} key={k} onClick={() => setSec(go)}>
                <b className={kpiFigure}>{v}</b>
                <span className={stamp}>{k}</span>
              </button>
            ))}
          </div>
          )}

          <h2 className={sectionHead}>Needs attention</h2>
          {!loaded ? (
            <Loading lines={3} />
          ) : (
          <div className={cx(card, 'mt-3 p-2')}>
            {[
              isPromoter
                ? ['Partnership requests waiting on a publisher', partnerships.filter((p) => p.status === 'pending').length, 'partnerships']
                : ['Partnership requests waiting on you', awaitingMe, 'partnerships'],
              ['Campaigns that cannot pay for one more signup', campaigns.filter((c) => c.status === 'active' && c.budget < c.coin_rate).length, 'campaigns'],
              ['Paused campaigns', campaigns.filter((c) => c.status === 'paused').length, 'campaigns'],
            ].map(([k, v, go]) => (
              <button className={queueRow} key={k as string} onClick={() => setSec(go as string)}>
                <span className={queueCount(Boolean(v))}>{(v as number) ?? 0}</span>
                <span>{k as string}</span>
                <span className="ml-auto text-mut" aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          )}

          <h2 className={sectionHead}>Latest redemptions</h2>
          {!loaded ? (
            <Loading />
          ) : redemptions.length === 0 ? (
            <div className={cx(card, empty, "mt-3")}>
              <p>No rewards granted yet. They appear here the moment a scan converts.</p>
            </div>
          ) : (
            <>
              <Redemptions rows={redemptions.slice(0, 5)} />
              {redemptions.length > 5 && (
                <button className={linkish} style={{ marginTop: 14 }} onClick={() => setSec('redemptions')}>
                  All {num(redemptions.length)} redemptions
                </button>
              )}
            </>
          )}
        </>
      )}

      {sec === 'partnerships' && (
        <>
          {isPromoter && (
            <>
              <h2 className={sectionHead}>Request a publisher partnership</h2>
              <div className={cx(card, "mt-3")}>
                <label className={label}>Publisher</label>
                <select
                  className={select}
                  value={newPartner.publisher_org_id}
                  onChange={(e) => setNewPartner({ ...newPartner, publisher_org_id: e.target.value })}
                >
                  <option value="">Select a publisher…</option>
                  {publishers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <label className={label}>Coins granted per verified signup (full tier)</label>
                <input
                  className={field}
                  type="number"
                  value={newPartner.coin_rate}
                  onChange={(e) => setNewPartner({ ...newPartner, coin_rate: +e.target.value })}
                />
                <label className={label}>Coins for an unverified guest (the rest is held back)</label>
                <input
                  className={field}
                  type="number"
                  value={newPartner.guest_rate}
                  onChange={(e) => setNewPartner({ ...newPartner, guest_rate: +e.target.value })}
                />
                <label className={label}>Days a guest has to verify and claim the remainder</label>
                <input
                  className={field}
                  type="number"
                  value={newPartner.grace_days}
                  onChange={(e) => setNewPartner({ ...newPartner, grace_days: +e.target.value })}
                />
                <button
                  disabled={busy || !newPartner.publisher_org_id}
                  onClick={() =>
                    act(
                      () => api('/v1/partnerships', { method: 'POST', body: JSON.stringify(newPartner) }),
                      'Partnership requested — waiting on the publisher.',
                    )
                  }
                >
                  {busy ? 'Sending…' : 'Request partnership'}
                </button>
              </div>
            </>
          )}

          <h2 className={sectionHead}>All partnerships</h2>
          {!loaded ? (
            <Loading />
          ) : partnerships.length === 0 ? (
            <div className={cx(card, empty, "mt-3")}>
              <p>
                {isPromoter
                  ? 'No partnerships yet. Request one above — a campaign can only spend against an active partnership.'
                  : 'No partnerships yet. They appear here when a promoter asks to work with you.'}
              </p>
            </div>
          ) : (
            <div className={tableWrap}>
              <table className={table}>
                <thead>
                  <tr>
                    <th className={th}>Promoter</th>
                    <th className={th}>Publisher</th>
                    <th className={thNum}>Guest / full</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {partnerships.map((p) => (
                    <tr className={tr} key={p.id}>
                      <td className={td}>{p.promoter_name}</td>
                      <td className={td}>{p.publisher_name}</td>
                      <td className={tdNum}>
                        {num(p.guest_rate)} / {num(p.coin_rate)}
                      </td>
                      <td className={td}>
                        <span className={pill(p.status)}>{p.status}</span>
                      </td>
                      <td className={td}>
                        {!isPromoter && p.status === 'pending' && (
                          <button
                            className={cx(btnTiny, "my-0.5")}
                            onClick={() =>
                              act(
                                () => api(`/v1/partnerships/${p.id}/accept`, { method: 'POST' }),
                                `Partnership with ${p.promoter_name} is active.`,
                              )
                            }
                          >
                            Accept
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {sec === 'campaigns' && (
        <>
          <h2 className={sectionHead}>Campaigns</h2>
          {!loaded && <Loading />}
          {loaded && campaigns.length === 0 && (
            <div className={cx(card, empty, "mt-3")}>
              <p>
                {isPromoter
                  ? 'No campaigns yet. An active partnership is what a campaign spends against — create one below.'
                  : 'No campaigns yet. They appear here once a promoter you partner with starts one.'}
              </p>
            </div>
          )}
          {campaigns.map((c) => {
            // What the promoter actually has to know: how many more signups this budget
            // can still pay for. Zero is the moment scans stop granting coins.
            const covers = c.coin_rate > 0 ? Math.floor(c.budget / c.coin_rate) : 0;
            // A fact the promoter has to act on prints in the ink that says so: ochre
            // when the budget is running down, red when it cannot pay for one more signup.
            const state = covers === 0 ? 'text-bad' : covers < 10 ? 'text-warn' : 'text-ink';
            return (
            <div className={cx(card, 'mt-3 grid gap-4')} key={c.id}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <b className="text-base font-[650] tracking-[-0.018em]">{c.name}</b>{' '}
                  <span className={cx(pill(c.status), 'ml-2')}>{c.status}</span>
                  <div className="mt-0.75 text-[12.5px] text-mut tabular-nums">
                    {c.promoter_name} → {c.publisher_name}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {isPromoter && (
                    <>
                      <button
                        className={btnGhost}
                        onClick={async () => {
                          const v = await promptDialog({
                            title: `Fund "${c.name}"`,
                            body: `At ${num(c.coin_rate)} coins per signup, 1000 coins covers about ${Math.floor(
                              1000 / c.coin_rate,
                            )} signups.`,
                            inputLabel: 'Coins to add',
                            input: '1000',
                            confirmText: 'Add funds',
                          });
                          if (v)
                            act(
                              () =>
                                api(`/v1/campaigns/${c.id}/fund`, {
                                  method: 'POST',
                                  body: JSON.stringify({ coins: +v }),
                                }),
                              `Funded ${num(+v)} coins.`,
                            );
                        }}
                      >
                        Fund
                      </button>
                      <button
                        className={btnGhost}
                        onClick={() =>
                          act(
                            () =>
                              api(`/v1/campaigns/${c.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({
                                  status: c.status === 'active' ? 'paused' : 'active',
                                }),
                              }),
                            c.status === 'active'
                              ? `${c.name} paused — scans stop granting coins.`
                              : `${c.name} is live again.`,
                          )
                        }
                      >
                        {c.status === 'active' ? 'Pause' : 'Activate'}
                      </button>
                      <Link className={btn} href={`/campaigns/${c.id}`}>
                        QR codes &amp; stats
                      </Link>
                    </>
                  )}
                  {!isPromoter && (
                    <Link className={btn} href={`/campaigns/${c.id}`}>
                      Stats
                    </Link>
                  )}
                </div>
              </div>

              {/* the facts are one group, so they sit together at the left rather than
                  spreading across the card — a 1fr grid pushed them a third of a screen apart */}
              <dl className="flex flex-wrap gap-x-11 gap-y-3.5 border-t border-line-soft pt-3.5">
                {([
                  ['Rate', num(c.coin_rate), 'coins / signup', 'text-ink'],
                  ['Budget', num(c.budget), 'coins', 'text-ink'],
                  ['Covers', num(covers), 'more signups', state],
                ] as const).map(([k, v, unit, ink]) => (
                  <div className="min-w-24" key={k}>
                    <dt className={stamp}>{k}</dt>
                    <dd className={cx(fact, ink)}>
                      {v} <small className="font-sans text-xs font-normal tracking-normal text-mut">{unit}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            );
          })}

          {isPromoter && activePartnerships.length > 0 && (
            <>
              <h2 className={sectionHead} id="new-campaign">New campaign</h2>
              <div className={cx(card, "mt-3")}>
                <label className={label}>Partnership</label>
                <select
                  className={select}
                  value={newCampaign.partnership_id}
                  onChange={(e) => setNewCampaign({ ...newCampaign, partnership_id: e.target.value })}
                >
                  <option value="">Select…</option>
                  {activePartnerships.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.publisher_name} — {p.coin_rate} coins/signup
                    </option>
                  ))}
                </select>
                <label className={label}>Campaign name</label>
                <input
                  className={field}
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                  placeholder="Inflight entertainment promo"
                />
                <button
                  disabled={busy || !newCampaign.partnership_id || !newCampaign.name}
                  onClick={() =>
                    act(async () => {
                      await api('/v1/campaigns', {
                        method: 'POST',
                        body: JSON.stringify(newCampaign),
                      });
                      setNewCampaign({ partnership_id: '', name: '' });
                    }, `Campaign "${newCampaign.name}" created.`)
                  }
                >
                  {busy ? 'Creating…' : 'Create campaign'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {sec === 'redemptions' && (
        <>
          <h2 className={sectionHead}>Redemptions</h2>
          {!loaded ? (
            <Loading lines={6} />
          ) : redemptions.length === 0 ? (
            <div className={cx(card, empty, "mt-3")}>
              <p>
                No rewards granted yet. A redemption is recorded the moment a publisher vouches
                for a signup that came from one of your codes.
              </p>
            </div>
          ) : (
            <>
              <Redemptions rows={redemptions} />
              {/* the endpoint returns the newest 100 — say so rather than implying this is all */}
              {redemptions.length >= 100 && (
                <p className={hint}>Showing the 100 most recent redemptions.</p>
              )}
            </>
          )}
        </>
      )}

      {sec === 'settings' && (
        <>
          <h2 className={sectionHead}>Where scans go</h2>
          <div className={cx(card, "mt-3")}>
            <p className={muted}>
              A scan is sent straight to your store listing. Nothing redeemable travels with it —
              your app receives no code, and attribution happens server-to-server afterwards.
            </p>
            <label className={label}>Google Play package (Android scans)</label>
            <input
                  className={field}
              value={dest.android_package}
              placeholder="com.example.app"
              onChange={setDestField('android_package')}
            />
            <label className={label}>App Store id (iPhone scans)</label>
            <input
                  className={field}
              value={dest.ios_app_id}
              placeholder="123456789"
              onChange={setDestField('ios_app_id')}
            />
            <label className={label}>Web fallback (desktop scans, and platforms with no app registered)</label>
            <input
                  className={field}
              value={dest.landing_url}
              placeholder="https://example.com/get-the-app"
              onChange={setDestField('landing_url')}
            />
            <label className={label}>Your joining bonus, in your own words</label>
            <input
                  className={field}
              value={dest.bonus_label}
              placeholder="100 free coins for new accounts"
              onChange={setDestField('bonus_label')}
            />
            <p className={muted}>
              A label for reporting and for promoters designing artwork. You grant the bonus, on
              your own terms — this platform never issues or fulfils it.
            </p>
            <button
              onClick={() =>
                act(async () => {
                  await api('/v1/orgs/me', { method: 'PATCH', body: JSON.stringify(dest) });
                }, 'Destinations saved.')
              }
            >
              Save destinations
            </button>
          </div>

          <h2 className={sectionHead}>API key</h2>
          <div className={cx(card, "mt-3")}>
            <p className={muted}>
              Your backend calls <code className={codeChip}>POST /v1/attribution/claim</code> with this key when a new
              user finishes signing up, passing the Play install referrer (Android) or the
              first-open IP (iOS).
            </p>
            {typeof window !== 'undefined' && localStorage.getItem('api_key') && (
              <code className={codeKey}>{localStorage.getItem('api_key')}</code>
            )}
            <button
              className={btnGhost}
              onClick={async () => {
                const go = await confirmDialog({
                  title: 'Rotate API key?',
                  body: 'The current key stops working immediately. Any backend still using it will start failing until you deploy the new one.',
                  confirmText: 'Rotate key',
                  danger: true,
                });
                if (go)
                  act(async () => {
                    const res = await api('/v1/api-keys/rotate', { method: 'POST' });
                    localStorage.setItem('api_key', res.api_key);
                  }, 'New API key issued — it is shown above.');
              }}
            >
              Rotate API key
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}
