'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, org as getOrg, token } from '@/lib/api';
import { Shell } from '@/lib/shell';
import { Analytics, Audience } from '@/lib/audience';
import { toast } from '@/lib/ui';
import type {
  AdminOrg,
  AdminOverview,
  AdminScan,
  AuditEntry,
  Campaign,
  Ledger as LedgerData,
  Partnership,
  QrCode,
  Redemption,
} from '@/lib/types';
import { num } from '@/lib/fmt';
import { btn, btnGhost, card, codeKey, cx, pillBad, select as selectField } from '@/lib/tw';
import { HEAD, TABS, type AdminData, type Tab } from './types';
import { AuditLog } from './sections/AuditLog';
import { Campaigns } from './sections/Campaigns';
import { Ledger } from './sections/Ledger';
import { Notifications } from './sections/Notifications';
import { Organizations } from './sections/Organizations';
import { Overview } from './sections/Overview';
import { Partnerships } from './sections/Partnerships';
import { QrCodes } from './sections/QrCodes';
import { Redemptions } from './sections/Redemptions';
import { Scans } from './sections/Scans';

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

  /** The eight endpoints no filter on this page affects. */
  const loadCore = useCallback(async () => {
    try {
      const [overview, orgs, partnerships, campaigns, redemptions, qrCodes, audit, notifications] =
        await Promise.all([
          api<AdminOverview>('/v1/admin/overview'),
          api<AdminOrg[]>('/v1/admin/orgs?limit=1000'),
          api<Partnership[]>('/v1/admin/partnerships?limit=1000'),
          api<Campaign[]>('/v1/admin/campaigns?limit=1000'),
          api<Redemption[]>('/v1/admin/redemptions?limit=1000'),
          api<QrCode[]>('/v1/admin/qr-codes?limit=1000'),
          api<AuditEntry[]>('/v1/admin/audit-log?limit=500'),
          api<AuditEntry[]>('/v1/admin/notifications?limit=500'),
        ]);
      setD((p) => ({ ...p, overview, orgs, partnerships, campaigns, redemptions, qrCodes, audit, notifications }));
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
        api<LedgerData>(
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

  const load = useCallback(() => Promise.all([loadCore(), loadFiltered()]), [loadCore, loadFiltered]);

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

  const act = useCallback(
    async (fn: () => Promise<any>, ok = 'Done') => {
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
    },
    [load],
  );

  const patch = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'PATCH', body: JSON.stringify(body) }), ok);
  const post = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'POST', body: JSON.stringify(body) }), ok);
  const del = (path: string, ok?: string) => void act(() => api(path, { method: 'DELETE' }), ok);

  const filterScans = (campaignId: string) => {
    setCampaignFilter(campaignId);
    setTab('Scans');
  };
  const filterLedger = (account: string) => {
    setLedgerAccount(account);
    setTab('Ledger');
  };

  if (!me) return null;

  // A failed load is its own state — not "still loading", and not data.
  const failed = !d.overview && Boolean(loadErr);
  const loading = !d.overview && !failed;
  const o = d.overview;
  const shared = { d, loading, busy, patch, post, del, go: setTab, filterScans, filterLedger };

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
      {(d.campaigns ?? []).map((c) => (
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
        badge:
          t.id === 'Partnerships'
            ? o?.pending_partnerships
            : t.id === 'Notifications'
              ? o?.open_notifications
              : undefined,
      }))}
      active={tab}
      onSelect={(id) => setTab(id as Tab)}
      title={tab}
      lede={HEAD[tab]}
      actions={
        <>
          {o && !o.ledger_balanced && <span className={pillBad}>ledger off by {num(o.ledger_sum)}</span>}
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

      {tab === 'Overview' && <Overview {...shared} failed={failed} loadErr={loadErr} onRetry={() => load()} />}
      {tab === 'Organizations' && <Organizations {...shared} />}
      {tab === 'Partnerships' && <Partnerships {...shared} />}
      {tab === 'Campaigns' && <Campaigns {...shared} />}
      {tab === 'Audience' && (
        <>
          {campaignPicker}
          <Audience
            data={d.analytics ?? null}
            days={days}
            onDays={setDays}
            scoped={Boolean(campaignFilter)}
          />
        </>
      )}
      {tab === 'Scans' && <Scans {...shared} campaignPicker={campaignPicker} />}
      {tab === 'Redemptions' && <Redemptions {...shared} />}
      {tab === 'QR codes' && <QrCodes {...shared} />}
      {tab === 'Ledger' && <Ledger {...shared} account={ledgerAccount} onAccount={setLedgerAccount} />}
      {tab === 'Notifications' && <Notifications {...shared} />}
      {tab === 'Audit log' && <AuditLog {...shared} />}
    </Shell>
  );
}
