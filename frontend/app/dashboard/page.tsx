'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, org as getOrg, token } from '@/lib/api';
import { NavItem, Shell } from '@/lib/shell';
import { toast } from '@/lib/ui';
import type { Campaign, Me, Partnership, PublisherOption, Redemption } from '@/lib/types';
import { alertWarn, btn, linkish } from '@/lib/tw';
import { HEAD, isSection, type DashboardData, type Section } from './types';
import { newCampaign, newPartnership, requestPayout } from './dialogs';
import { Campaigns } from './sections/Campaigns';
import { Overview } from './sections/Overview';
import { Partnerships } from './sections/Partnerships';
import { Redemptions } from './sections/Redemptions';
import { Settings } from './sections/Settings';

const NO_DATA: DashboardData = {
  publishers: [],
  partnerships: [],
  campaigns: [],
  redemptions: [],
  profile: null,
};

export default function Dashboard() {
  const r = useRouter();
  const [me, setMe] = useState<ReturnType<typeof getOrg>>(null);
  const [sec, setSec] = useState<Section>('overview');
  const [d, setD] = useState<DashboardData>(NO_DATA);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [publishers, partnerships, campaigns, redemptions, profile] = await Promise.all([
        api<PublisherOption[]>('/v1/publishers'),
        api<Partnership[]>('/v1/partnerships'),
        api<Campaign[]>('/v1/campaigns'),
        api<Redemption[]>('/v1/redemptions'),
        api<Me>('/v1/orgs/me'),
      ]);
      setD({ publishers, partnerships, campaigns, redemptions, profile });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!token()) return void r.replace('/login');
    const o = getOrg();
    if (o?.type === 'admin') return void r.replace('/admin');
    setMe(o);
    // Deep links from elsewhere in the console land on a section: /dashboard?s=campaigns.
    // Read here rather than in a `useState` initialiser — the server prerender has no
    // `location`, so an initialiser would render "overview" on the server and something else
    // on the client, which is exactly the case a deep link hits.
    const s = new URLSearchParams(location.search).get('s');
    if (s && isSection(s)) setSec(s);
    load();
  }, [r, load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
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
    },
    [load],
  );

  if (!me) return null;

  const isPromoter = me.type === 'promoter';
  const activePartnerships = d.partnerships.filter((p) => p.status === 'active');
  // a publisher is the one who has to act on a pending request; a promoter is only waiting
  const awaitingMe = isPromoter ? 0 : d.partnerships.filter((p) => p.status === 'pending').length;
  // Same asymmetry for a repricing: the publisher decides, the promoter waits.
  const openProposals = d.partnerships.filter((p) => p.proposed_coin_rate !== null).length;
  const canCreateCampaign = isPromoter && activePartnerships.length > 0;

  // A publisher with no destination registered redirects nobody: every scan of every campaign
  // it is partnered on dies at `no_destination`, silently, for as long as this is unset.
  const noDestination =
    !isPromoter &&
    loaded &&
    d.profile &&
    !d.profile.landing_url &&
    !d.profile.android_package &&
    !d.profile.ios_app_id;

  const items: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    {
      id: 'partnerships',
      label: 'Partnerships',
      icon: 'partnerships',
      // Both are decisions sitting in the publisher's own inbox, so they count as one badge.
      badge: awaitingMe + (isPromoter ? 0 : openProposals),
    },
    { id: 'campaigns', label: 'Campaigns', icon: 'campaigns' },
    { id: 'redemptions', label: 'Redemptions', icon: 'redemptions' },
    ...(isPromoter ? [] : [{ id: 'settings', label: 'Settings', icon: 'settings' } as NavItem]),
  ];

  const shared = { d, isPromoter, loaded, busy, act, go: setSec };

  /** The one action this section puts in the header, if it has one. */
  const headerAction =
    sec === 'campaigns' && canCreateCampaign ? (
      <button className={btn} onClick={() => newCampaign(activePartnerships, act)} disabled={busy}>
        New campaign
      </button>
    ) : sec === 'redemptions' && !isPromoter ? (
      <button className={btn} onClick={() => requestPayout(d.profile, act)} disabled={busy}>
        Request payout
      </button>
    ) : sec === 'partnerships' && isPromoter ? (
      <button
        className={btn}
        onClick={() => newPartnership(d.publishers, act)}
        disabled={busy || d.publishers.length === 0}
      >
        Request partnership
      </button>
    ) : null;

  return (
    <Shell
      org={me}
      items={items}
      active={sec}
      onSelect={(id) => setSec(id as Section)}
      title={HEAD[sec].title}
      lede={HEAD[sec].lede}
      actions={headerAction}
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
        <Overview
          {...shared}
          canCreateCampaign={canCreateCampaign}
          onNewCampaign={() => newCampaign(activePartnerships, act)}
        />
      )}
      {sec === 'partnerships' && <Partnerships {...shared} />}
      {sec === 'campaigns' && <Campaigns {...shared} canCreateCampaign={canCreateCampaign} />}
      {sec === 'redemptions' && <Redemptions {...shared} />}
      {sec === 'settings' && <Settings {...shared} />}
    </Shell>
  );
}
