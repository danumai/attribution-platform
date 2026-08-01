'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, org as getOrg, token } from '@/lib/api';
import { confirmDialog, promptDialog, toast } from '@/lib/ui';

export default function Dashboard() {
  const r = useRouter();
  const [me, setMe] = useState<any>(null);
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
  const [landingUrl, setLandingUrl] = useState('');

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
      setLandingUrl(self.landing_url ?? '');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    const o = getOrg();
    if (o?.type === 'admin') return void r.replace('/admin');
    setMe(o);
    // landing_url isn't in the login payload; load() fetches it from /v1/orgs/me
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

  return (
    <main>
      <div className="topbar">
        <div>
          <b>{me.name}</b> <span className="pill">{me.type}</span>
        </div>
        <a
          style={{ cursor: 'pointer' }}
          onClick={() => {
            localStorage.clear();
            r.push('/login');
          }}
        >
          Sign out
        </a>
      </div>

      {isPromoter ? (
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
                  () =>
                    api('/v1/partnerships', { method: 'POST', body: JSON.stringify(newPartner) }),
                  'Partnership requested — waiting on the publisher.',
                )
              }
            >
              {busy ? 'Sending…' : 'Request partnership'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Publisher settings</h2>
          <div className="card">
            <label>Landing URL — where a scanned user lands on your side</label>
            <input
              value={landingUrl}
              placeholder="https://example.com/signup"
              onChange={(e) => setLandingUrl(e.target.value)}
            />
            <button
              disabled={!landingUrl}
              onClick={() =>
                act(async () => {
                  await api('/v1/orgs/me', {
                    method: 'PATCH',
                    body: JSON.stringify({ landing_url: landingUrl }),
                  });
                }, 'Landing URL saved.')
              }
            >
              Save landing URL
            </button>
            <p className="muted" style={{ marginTop: 16 }}>
              Your backend calls <code>POST /v1/redemptions/verify</code> with your API key after a
              scanned user signs up.
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

      <h2>Partnerships</h2>
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

      {isPromoter && activePartnerships.length > 0 && (
        <>
          <h2>New campaign</h2>
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

      <h2>Campaigns</h2>
      {campaigns.length === 0 && <div className="card"><p className="muted">None yet.</p></div>}
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

      <h2>Recent redemptions</h2>
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
    </main>
  );
}
