'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, org as getOrg, token } from '@/lib/api';
import { NavItem, Shell } from '@/lib/shell';
import { confirmDialog, promptDialog, toast } from '@/lib/ui';

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

  const coinsGranted = redemptions.reduce((n, x) => n + (x.coins ?? 0), 0);
  const kpis: [string, string | number, string][] = [
    ['Active campaigns', campaigns.filter((c) => c.status === 'active').length, 'campaigns'],
    ['Active partnerships', activePartnerships.length, 'partnerships'],
    ['Redemptions', redemptions.length, 'redemptions'],
    ['Coins granted', coinsGranted, 'redemptions'],
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
          <a onClick={() => document.getElementById('new-campaign')?.scrollIntoView({ behavior: 'smooth' })}>
            New campaign
          </a>
        ) : null
      }
    >
      {sec === 'overview' && (
        <>
          <h2>Live now</h2>
          <div className="kpis">
            {kpis.map(([k, v, go]) => (
              <button className="kpi" key={k} onClick={() => setSec(go)}>
                <b>{v}</b>
                <span className="muted">{k}</span>
              </button>
            ))}
          </div>

          <h2>Needs attention</h2>
          <div className="card queue">
            {[
              isPromoter
                ? ['Partnership requests waiting on a publisher', partnerships.filter((p) => p.status === 'pending').length, 'partnerships']
                : ['Partnership requests waiting on you', awaitingMe, 'partnerships'],
              ['Campaigns that cannot pay for one more signup', campaigns.filter((c) => c.status === 'active' && c.budget < c.coin_rate).length, 'campaigns'],
              ['Paused campaigns', campaigns.filter((c) => c.status === 'paused').length, 'campaigns'],
            ].map(([k, v, go]) => (
              <button className="queue-row" key={k as string} onClick={() => setSec(go as string)}>
                <span className={`queue-count${v ? ' hot' : ''}`}>{(v as number) ?? 0}</span>
                <span>{k as string}</span>
                <span className="queue-go" aria-hidden="true">→</span>
              </button>
            ))}
          </div>

          <h2>Latest redemptions</h2>
          <div className="card">
            {redemptions.length === 0 ? (
              <p className="muted">No rewards granted yet. They appear here the moment a scan converts.</p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Publisher user</th>
                      <th>Coins</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.slice(0, 5).map((x) => (
                      <tr key={x.id}>
                        <td>{x.campaign_name}</td>
                        <td>{x.publisher_user_ref}</td>
                        <td>{x.coins}</td>
                        <td>{new Date(x.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {redemptions.length > 5 && (
                  <a onClick={() => setSec('redemptions')}>All {redemptions.length} redemptions</a>
                )}
              </>
            )}
          </div>
        </>
      )}

      {sec === 'partnerships' && (
        <>
          {isPromoter && (
            <>
              <h2>Request a publisher partnership</h2>
              <div className="card">
                <label>Publisher</label>
                <select
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
                <label>Coins granted per verified signup (full tier)</label>
                <input
                  type="number"
                  value={newPartner.coin_rate}
                  onChange={(e) => setNewPartner({ ...newPartner, coin_rate: +e.target.value })}
                />
                <label>Coins for an unverified guest (the rest is held back)</label>
                <input
                  type="number"
                  value={newPartner.guest_rate}
                  onChange={(e) => setNewPartner({ ...newPartner, guest_rate: +e.target.value })}
                />
                <label>Days a guest has to verify and claim the remainder</label>
                <input
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

          <h2>All partnerships</h2>
          <div className="card">
            {partnerships.length === 0 && <p className="muted">None yet.</p>}
            {partnerships.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Promoter</th>
                    <th>Publisher</th>
                    <th>Guest / full</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {partnerships.map((p) => (
                    <tr key={p.id}>
                      <td>{p.promoter_name}</td>
                      <td>{p.publisher_name}</td>
                      <td>
                        {p.guest_rate} / {p.coin_rate}
                      </td>
                      <td>
                        <span className={`pill ${p.status}`}>{p.status}</span>
                      </td>
                      <td>
                        {!isPromoter && p.status === 'pending' && (
                          <button
                            style={{ margin: 0, padding: '4px 10px' }}
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
            )}
          </div>
        </>
      )}

      {sec === 'campaigns' && (
        <>
          <h2>Campaigns</h2>
          {campaigns.length === 0 && (
            <div className="card empty">
              <p>
                {isPromoter
                  ? 'No campaigns yet. An active partnership is what a campaign spends against — create one below.'
                  : 'No campaigns yet. They appear here once a promoter you partner with starts one.'}
              </p>
            </div>
          )}
          {campaigns.map((c) => (
            <div className="card" key={c.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <b>{c.name}</b> <span className={`pill ${c.status}`}>{c.status}</span>
                  <div className="muted">
                    {c.promoter_name} → {c.publisher_name} · {c.coin_rate} coins/signup · budget{' '}
                    <b>{c.budget}</b> coins
                  </div>
                </div>
                <div className="row">
                  {isPromoter && (
                    <>
                      <button
                        className="ghost"
                        style={{ margin: 0 }}
                        onClick={async () => {
                          const v = await promptDialog({
                            title: `Fund "${c.name}"`,
                            body: `At ${c.coin_rate} coins per signup, 1000 coins covers about ${Math.floor(
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
                              `Funded ${+v} coins.`,
                            );
                        }}
                      >
                        Fund
                      </button>
                      <button
                        className="ghost"
                        style={{ margin: 0 }}
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
                      <Link href={`/campaigns/${c.id}`}>
                        <button style={{ margin: 0 }}>QR codes & stats</button>
                      </Link>
                    </>
                  )}
                  {!isPromoter && (
                    <Link href={`/campaigns/${c.id}`}>
                      <button style={{ margin: 0 }}>Stats</button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isPromoter && activePartnerships.length > 0 && (
            <>
              <h2 id="new-campaign">New campaign</h2>
              <div className="card">
                <label>Partnership</label>
                <select
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
                <label>Campaign name</label>
                <input
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
          <h2>Redemptions</h2>
          <div className="card">
            {redemptions.length === 0 ? (
              <p className="muted">No rewards granted yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Publisher user</th>
                    <th>Coins</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {redemptions.map((x) => (
                    <tr key={x.id}>
                      <td>{x.campaign_name}</td>
                      <td>{x.publisher_user_ref}</td>
                      <td>{x.coins}</td>
                      <td>{new Date(x.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {sec === 'settings' && (
        <>
          <h2>Where scans go</h2>
          <div className="card">
            <p className="muted">
              A scan is sent straight to your store listing. Nothing redeemable travels with it —
              your app receives no code, and attribution happens server-to-server afterwards.
            </p>
            <label>Google Play package (Android scans)</label>
            <input
              value={dest.android_package}
              placeholder="com.example.app"
              onChange={setDestField('android_package')}
            />
            <label>App Store id (iPhone scans)</label>
            <input
              value={dest.ios_app_id}
              placeholder="123456789"
              onChange={setDestField('ios_app_id')}
            />
            <label>Web fallback (desktop scans, and platforms with no app registered)</label>
            <input
              value={dest.landing_url}
              placeholder="https://example.com/get-the-app"
              onChange={setDestField('landing_url')}
            />
            <label>Your joining bonus, in your own words</label>
            <input
              value={dest.bonus_label}
              placeholder="100 free coins for new accounts"
              onChange={setDestField('bonus_label')}
            />
            <p className="muted">
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

          <h2>API key</h2>
          <div className="card">
            <p className="muted">
              Your backend calls <code>POST /v1/attribution/claim</code> with this key when a new
              user finishes signing up, passing the Play install referrer (Android) or the
              first-open IP (iOS).
            </p>
            {typeof window !== 'undefined' && localStorage.getItem('api_key') && (
              <code className="key">{localStorage.getItem('api_key')}</code>
            )}
            <button
              className="ghost"
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
