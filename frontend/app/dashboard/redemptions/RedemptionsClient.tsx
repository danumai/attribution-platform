'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import type { Me, OrgType, Partnership, Redemption } from '@/lib/types';
import type { DashboardData } from '../types';
import { alertWarn, btn, linkish } from '@/lib/tw';
import { requestPayout } from '../dialogs';
import { Redemptions } from '../sections/Redemptions';

export function RedemptionsClient({
  org, redemptions, partnerships, profile, items, showNoDestination, title, lede,
}: {
  org: { id: string; name: string; type: OrgType };
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

  const d: DashboardData = { publishers: [], partnerships, campaigns: [], redemptions, profile };

  return (
    <Shell
      org={org} items={items} active="redemptions" title={title} lede={lede}
      actions={!isPromoter ? (
        <button className={btn} onClick={() => requestPayout(profile, act)} disabled={busy}>
          Request payout
        </button>
      ) : null}
    >
      {showNoDestination && (
        <div className={alertWarn}>
          No destination registered yet — every scan sent to you currently fails. Add a Play
          package, an App Store id, or a web fallback in{' '}
          <Link className={linkish} href="/dashboard/settings">Settings</Link>.
        </div>
      )}
      <Redemptions d={d} loaded />
    </Shell>
  );
}
