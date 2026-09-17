'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import type { Campaign, Me, OrgType, Partnership, Redemption } from '@/lib/types';
import type { DashboardData } from './types';
import { alertWarn, linkish } from '@/lib/tw';
import { newCampaign } from './dialogs';
import { Overview } from './sections/Overview';

export function OverviewClient({
  org, campaigns, redemptions, partnerships, profile, items, showNoDestination, title, lede,
}: {
  org: { id: string; name: string; type: OrgType };
  campaigns: Campaign[];
  redemptions: Redemption[];
  partnerships: Partnership[];
  profile: Me | null;
  items: NavItem[];
  showNoDestination: boolean;
  title: string;
  lede: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const isPromoter = org.type === 'promoter';
  const activePartnerships = partnerships.filter((p) => p.status === 'active');
  const canCreateCampaign = isPromoter && activePartnerships.length > 0;

  const act = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }, [router]);

  const d: DashboardData = { publishers: [], partnerships, campaigns, redemptions, profile };

  return (
    <Shell org={org} items={items} active="overview" title={title} lede={lede}>
      {showNoDestination && (
        <div className={alertWarn}>
          No destination registered yet — every scan sent to you currently fails. Add a Play
          package, an App Store id, or a web fallback in{' '}
          <Link className={linkish} href="/dashboard/settings">Settings</Link>.
        </div>
      )}
      <Overview
        d={d}
        isPromoter={isPromoter}
        loaded
        busy={busy}
        act={act}
        go={(s) => router.push(s === 'overview' ? '/dashboard' : `/dashboard/${s}`)}
        canCreateCampaign={canCreateCampaign}
        onNewCampaign={() => newCampaign(activePartnerships, act)}
      />
    </Shell>
  );
}
