'use client';
import { ChangeEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, org as getOrg, token } from '@/lib/api';
import { NavItem, Shell } from '@/lib/shell';
import {
  Empty,
  type Figure,
  Figures,
  SkeletonCard,
  SkeletonStrip,
  SkeletonTable,
  Split,
  confirmDialog,
  formDialog,
  promptDialog,
  toast,
} from '@/lib/ui';
import { Chart } from '@/lib/chart';
import { INK } from '@/lib/audience';
import { ago, change, num } from '@/lib/fmt';
import type { Campaign, Me, Partnership, PublisherOption, Redemption } from '@/lib/types';
import {
  alertWarn,
  btn,
  btnGhost,
  btnTiny,
  card,
  code as codeChip,
  codeKey,
  cx,
  fact,
  field,
  hint,
  label,
  linkish,
  meterInk,
  muted,
  pill,
  queueCount,
  queueRow,
  sectionHead,
  stamp,
  table,
  tableWrap,
  td,
  tdNum,
  th,
  thNum,
  tr,
} from '@/lib/tw';

/** Newest first, and never more rows than the caller asked for. */
function Redemptions({ rows }: { rows: Redemption[] }) {
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

/**
 * Redemptions per day, counted off the rows this page already has.
 *
 * There is no scan-analytics endpoint scoped to a whole promoter — only per campaign — so the
 * only history available here is the redemption list itself, and that arrives capped at the
 * newest hundred. The cap is handled by refusing to plot past it: the axis starts at the
 * oldest row on hand, so every day drawn is a day the window fully covers. A series that
 * began before that would slope up out of nothing and read as growth.
 */
function perDay(rows: Redemption[]) {
  if (!rows.length) return null;
  const key = (t: string) => new Date(t).toISOString().slice(0, 10);
  const from = rows.map((r) => key(r.created_at)).reduce((a, b) => (a < b ? a : b));

  const slots: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.now(); t += 86_400_000)
    slots.push(new Date(t).toISOString().slice(0, 10));
  // A promoter two years in would otherwise get a 700-point plot in a 900px card, where a
  // day is a third of a pixel. The tail is the part anyone is reading for anyway.
  const days = slots.slice(-90);

  const total = new Map(days.map((k) => [k, 0]));
  const verified = new Map(days.map((k) => [k, 0]));
  for (const r of rows) {
    const k = key(r.created_at);
    if (!total.has(k)) continue;
    total.set(k, total.get(k)! + 1);
    if (r.identified) verified.set(k, verified.get(k)! + 1);
  }

  return {
    labels: days.map((k) =>
      new Date(`${k}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    ),
    total: days.map((k) => total.get(k)!),
    verified: days.map((k) => verified.get(k)!),
  };
}

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
  const [me, setMe] = useState<ReturnType<typeof getOrg>>(null);
  const [sec, setSec] = useState('overview');
  const [publishers, setPublishers] = useState<PublisherOption[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  // /v1/orgs/me — carries the publisher's earned balance and its configured destinations
  const [profile, setProfile] = useState<Me | null>(null);
  // Read in an effect, never in render: this component is prerendered on the server, where
  // there is no localStorage, so reading it during render is a guaranteed hydration mismatch.
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Where scans are sent, per platform, plus the publisher's own declared joining bonus.
  const [dest, setDest] = useState({
    landing_url: '',
    android_package: '',
    ios_app_id: '',
    bonus_label: '',
  });
  const setDestField = (k: keyof typeof dest) => (e: ChangeEvent<HTMLInputElement>) =>
    setDest((d) => ({ ...d, [k]: e.target.value }));

  async function load() {
    try {
      const [p, ps, cs, rs, self] = await Promise.all([
        api<PublisherOption[]>('/v1/publishers'),
        api<Partnership[]>('/v1/partnerships'),
        api<Campaign[]>('/v1/campaigns'),
        api<Redemption[]>('/v1/redemptions'),
        api<Me>('/v1/orgs/me'),
      ]);
      setPublishers(p);
      setPartnerships(ps);
      setCampaigns(cs);
      setRedemptions(rs);
      setProfile(self);
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
    setApiKey(localStorage.getItem('api_key'));
    // Deep links from elsewhere in the console land on a section: /dashboard?s=campaigns.
    // Also read here rather than in a `useState` initialiser — the server prerender has no
    // `location`, so an initialiser would render "overview" on the server and something else
    // on the client, which is exactly the case a deep link hits.
    const s = new URLSearchParams(location.search).get('s');
    if (s && s in HEAD) setSec(s);
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

  /* ---- creation, as dialogs ----
     These used to be forms parked permanently under their own lists, on screen whether or not
     anyone wanted to create anything. A creation form is a moment, not furniture. */

  async function newPartnership() {
    const v = await formDialog({
      title: 'Request a publisher partnership',
      body: 'The rates are fixed here, before any campaign can spend against them.',
      confirmText: 'Request partnership',
      fields: [
        {
          name: 'publisher_org_id',
          label: 'Publisher',
          type: 'select',
          required: true,
          placeholder: 'Select a publisher…',
          options: publishers.map((p) => ({
            value: p.id,
            label: `${p.name}${p.bonus_label ? ` — ${p.bonus_label}` : ''}${p.ready ? '' : ' (no app registered yet)'}`,
          })),
        },
        {
          name: 'coin_rate',
          label: 'Coins granted per verified signup (full tier)',
          type: 'number',
          value: '50',
          required: true,
        },
        {
          name: 'guest_rate',
          label: 'Coins for an unverified guest (the rest is held back)',
          type: 'number',
          value: '10',
          required: true,
        },
        {
          name: 'grace_days',
          label: 'Days a guest has to verify and claim the remainder',
          type: 'number',
          value: '7',
          required: true,
        },
      ],
    });
    if (!v) return;
    // Worth knowing before a print run, not after: this publisher's scans go nowhere until it
    // registers a destination. Partnering is still fine — printing codes is not.
    if (!publishers.find((p) => p.id === v.publisher_org_id)?.ready)
      toast.info('That publisher has no app or web fallback registered yet, so scans cannot be delivered until it does.');
    await act(
      () =>
        api('/v1/partnerships', {
          method: 'POST',
          body: JSON.stringify({
            publisher_org_id: v.publisher_org_id,
            coin_rate: +v.coin_rate,
            guest_rate: +v.guest_rate,
            grace_days: +v.grace_days,
          }),
        }),
      'Partnership requested — waiting on the publisher.',
    );
  }

  async function newCampaign() {
    const v = await formDialog({
      title: 'New campaign',
      body: 'A campaign spends against one active partnership, at that partnership’s rates.',
      confirmText: 'Create campaign',
      fields: [
        {
          name: 'partnership_id',
          label: 'Partnership',
          type: 'select',
          required: true,
          placeholder: 'Select…',
          options: activePartnerships.map((p) => ({
            value: p.id,
            label: `${p.publisher_name} — ${p.coin_rate} coins/signup`,
          })),
        },
        {
          name: 'name',
          label: 'Campaign name',
          required: true,
          placeholder: 'Inflight entertainment promo',
        },
      ],
    });
    if (!v) return;
    await act(
      () => api('/v1/campaigns', { method: 'POST', body: JSON.stringify(v) }),
      `Campaign "${v.name}" created.`,
    );
  }

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
  const verified = redemptions.filter((x) => x.identified).length;
  const guests = redemptions.length - verified;
  const daily = perDay(redemptions);
  // Half the plotted span against the other half — the only comparison rows this capped
  // can honestly support, and `change` returns null rather than inventing one when they cannot.
  const half = daily ? Math.max(Math.floor(daily.labels.length / 2), 1) : 0;
  const drift = daily && change(daily.total, half);
  const kpis: Figure[] = [
    { k: 'Active campaigns', v: num(campaigns.filter((c) => c.status === 'active').length), go: 'campaigns' },
    { k: 'Active partnerships', v: num(activePartnerships.length), go: 'partnerships' },
    {
      k: 'Redemptions',
      v: capped ? `${num(100)}+` : num(redemptions.length),
      go: 'redemptions',
      spark: daily?.total,
      ...(drift == null ? {} : { delta: { pct: drift, since: `vs previous ${half} days`, goodUp: true } }),
    },
    // A promoter's own figure is a floor derived from the newest 100 rows; a publisher's is
    // its whole earned balance off the ledger, so it is exact and needs no "≥".
    isPromoter
      ? { k: 'Coins granted', v: `${capped ? '≥ ' : ''}${num(coinsGranted)}`, go: 'redemptions' }
      : { k: 'Coins earned', v: num(profile?.earnings ?? 0), go: 'redemptions' },
  ];

  // A publisher with no destination registered redirects nobody: every scan of every campaign
  // it is partnered on dies at `no_destination`, silently, for as long as this is unset.
  const noDestination =
    !isPromoter && loaded && profile && !profile.landing_url && !profile.android_package && !profile.ios_app_id;

  const canCreateCampaign = isPromoter && activePartnerships.length > 0;

  return (
    <Shell
      org={me}
      items={items}
      active={sec}
      onSelect={setSec}
      title={HEAD[sec].title}
      lede={HEAD[sec].lede}
      actions={
        sec === 'campaigns' && canCreateCampaign ? (
          <button className={btn} onClick={newCampaign} disabled={busy}>
            New campaign
          </button>
        ) : sec === 'partnerships' && isPromoter ? (
          <button className={btn} onClick={newPartnership} disabled={busy || publishers.length === 0}>
            Request partnership
          </button>
        ) : null
      }
    >
      {noDestination && sec !== 'settings' && (
        <div className={alertWarn}>
          No destination registered yet — every scan sent to you currently fails. Add a Play
          package, an App Store id, or a web fallback in{' '}
          <button className={linkish} onClick={() => setSec('settings')}>
            Settings
          </button>
          .
        </div>
      )}

      {sec === 'overview' && (
        <>
          <h2 className={sectionHead}>Live now</h2>
          {!loaded ? <SkeletonStrip className="mt-3" /> : <Figures className="mt-3" items={kpis} onPick={setSec} />}

          {/* Counts say where this account is; the line says which way it is going, and it is
              the only history a promoter has on this page. Both series count redemptions, so
              they share one axis — the coins those redemptions cost is a different measure and
              would need a second scale, which is how a chart invents a correlation. */}
          {loaded && daily && daily.labels.length > 1 && (
            <div className={cx(card, 'mt-3')}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <b className={cx(stamp, 'shrink-0')}>Redemptions per day</b>
                <span className={cx(muted, 'text-[12px]')}>
                  {capped ? 'as far back as the newest 100 reach' : `last ${daily.labels.length} days`}
                </span>
              </div>
              <Chart
                labels={daily.labels}
                caption="Day"
                series={[
                  { label: 'redemptions', color: INK.scans, values: daily.total },
                  { label: 'verified', color: INK.signups, values: daily.verified },
                ]}
              />
            </div>
          )}

          {/* The split is real — `identified` is per row — but it is drawn from the same capped
              window as the counts above it, so it says so rather than implying a total. */}
          {loaded && redemptions.length > 0 && (
            <div className={cx(card, 'mt-3')}>
              <div className="flex items-baseline justify-between gap-3">
                <b className={stamp}>Verified vs guest</b>
                <span className={muted}>
                  {capped ? 'newest 100 redemptions' : `${num(redemptions.length)} redemptions`}
                </span>
              </div>
              <Split className="mt-3" verified={verified} guest={guests} />
              <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-soft">
                <span><b className="font-semibold text-ok">{num(verified)}</b> verified</span>
                <span><b className="font-semibold text-warn">{num(guests)}</b> still guest</span>
              </div>
            </div>
          )}

          <h2 className={sectionHead}>Needs attention</h2>
          {!loaded ? (
            <SkeletonCard className="mt-3" lines={3} />
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
            <SkeletonTable className="mt-3" />
          ) : redemptions.length === 0 ? (
            <Empty
              className="mt-3"
              title="No rewards granted yet"
              body="A redemption appears here the moment a scan converts and a publisher vouches for the signup."
              action={
                canCreateCampaign ? (
                  <button className={btn} onClick={newCampaign}>Create a campaign</button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Redemptions rows={redemptions.slice(0, 5)} />
              {redemptions.length > 5 && (
                <button className={cx(linkish, 'mt-3.5')} onClick={() => setSec('redemptions')}>
                  All {num(redemptions.length)} redemptions
                </button>
              )}
            </>
          )}
        </>
      )}

      {sec === 'partnerships' && (
        <>
          <h2 className={sectionHead}>All partnerships</h2>
          {!loaded ? (
            <SkeletonTable className="mt-3" cols={5} />
          ) : partnerships.length === 0 ? (
            <Empty
              className="mt-3"
              title="No partnerships yet"
              body={
                isPromoter
                  ? 'A campaign can only spend against an active partnership, so this is the first step.'
                  : 'They appear here when a promoter asks to work with you.'
              }
              action={
                isPromoter ? (
                  <button className={btn} onClick={newPartnership} disabled={publishers.length === 0}>
                    Request a partnership
                  </button>
                ) : undefined
              }
            />
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
                            className={cx(btnTiny, 'my-0.5')}
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
          {!loaded && <SkeletonCard className="mt-3" />}
          {loaded && campaigns.length === 0 && (
            <Empty
              className="mt-3"
              title="No campaigns yet"
              body={
                isPromoter
                  ? 'A campaign spends against an active partnership. Once you have one, this is where the codes come from.'
                  : 'They appear here once a promoter you partner with starts one.'
              }
              action={
                canCreateCampaign ? (
                  <button className={btn} onClick={newCampaign}>New campaign</button>
                ) : isPromoter ? (
                  <button className={btnGhost} onClick={() => setSec('partnerships')}>
                    Request a partnership first
                  </button>
                ) : undefined
              }
            />
          )}
          {campaigns.map((c) => {
            // What the promoter actually has to know: how many more signups this budget
            // can still pay for. Zero is the moment scans stop granting coins.
            const covers = c.coin_rate > 0 ? Math.floor(c.budget / c.coin_rate) : 0;
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
                    spreading across the card — a 1fr grid pushed them a third of a screen apart.

                    No meter here: this listing carries the budget still remaining but not the
                    total ever funded, so a bar would have to invent its own ceiling. The real
                    burn-down lives on the campaign page, where the stats endpoint gives both
                    halves of the fraction. */}
                <dl className="flex flex-wrap gap-x-11 gap-y-3.5 border-t border-line-soft pt-3.5">
                  {([
                    ['Rate', num(c.coin_rate), 'coins / signup', 'text-ink'],
                    ['Budget', num(c.budget), 'coins', 'text-ink'],
                    ['Covers', num(covers), 'more signups', meterInk(covers)],
                  ] as const).map(([k, v, unit, ink]) => (
                    <div className="min-w-24" key={k}>
                      <dt className={stamp}>{k}</dt>
                      <dd className={cx(fact, ink)}>
                        {v}{' '}
                        <small className="font-sans text-xs font-normal tracking-normal text-mut">
                          {unit}
                        </small>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </>
      )}

      {sec === 'redemptions' && (
        <>
          <h2 className={sectionHead}>Redemptions</h2>
          {!loaded ? (
            <SkeletonTable className="mt-3" rows={8} />
          ) : redemptions.length === 0 ? (
            <Empty
              className="mt-3"
              title="No rewards granted yet"
              body="A redemption is recorded the moment a publisher vouches for a signup that came from one of your codes."
            />
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
          <div className={cx(card, 'mt-3')}>
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
              className={cx(btn, 'mt-5')}
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api('/v1/orgs/me', { method: 'PATCH', body: JSON.stringify(dest) });
                }, 'Destinations saved.')
              }
            >
              {busy ? 'Saving…' : 'Save destinations'}
            </button>
          </div>

          <h2 className={sectionHead}>API key</h2>
          <div className={cx(card, 'mt-3')}>
            <p className={muted}>
              Your backend calls <code className={codeChip}>POST /v1/attribution/claim</code> with this key when a new
              user finishes signing up, passing the Play install referrer (Android) or the
              first-open IP (iOS).
            </p>
            {/* The key is only ever held in this browser: the server stores a hash, so it
                cannot be shown again on another device. Say that, rather than rendering
                nothing and looking broken. */}
            {apiKey ? (
              <code className={codeKey}>{apiKey}</code>
            ) : (
              <p className={hint}>
                Your key was shown once when it was issued and is not stored here. If you no
                longer have it, rotate to issue a new one.
              </p>
            )}
            <button
              className={cx(btnGhost, 'mt-4')}
              onClick={async () => {
                const go = await confirmDialog({
                  title: 'Rotate API key?',
                  body: 'The current key stops working immediately. Any backend still using it will start failing until you deploy the new one.',
                  confirmText: 'Rotate key',
                  danger: true,
                });
                if (go)
                  act(async () => {
                    const res = await api<{ api_key: string }>('/v1/api-keys/rotate', {
                      method: 'POST',
                    });
                    localStorage.setItem('api_key', res.api_key);
                    setApiKey(res.api_key);
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
