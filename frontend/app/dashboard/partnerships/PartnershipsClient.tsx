'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import type { Me, OrgType, Partnership, PublisherOption } from '@/lib/types';
import type { DashboardData } from '../types';
import { alertWarn, btn, linkish } from '@/lib/tw';
import { newPartnership } from '../dialogs';
import { Partnerships } from '../sections/Partnerships';

export function PartnershipsClient({
  org, partnerships, publishers, profile, items, showNoDestination, title, lede,
}: {
  org: { id: string; name: string; type: OrgType };
  partnerships: Partnership[];
  publishers: PublisherOption[];
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

  const d: DashboardData = { publishers, partnerships, campaigns: [], redemptions: [], profile };

  return (
    <Shell
      org={org} items={items} active="partnerships" title={title} lede={lede}
      actions={isPromoter ? (
        <button className={btn} onClick={() => newPartnership(publishers, act)} disabled={busy || publishers.length === 0}>
          Request partnership
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
      <Partnerships
        d={d} isPromoter={isPromoter} loaded busy={busy} act={act}
        go={(s) => router.push(s === 'overview' ? '/dashboard' : `/dashboard/${s}`)}
      />
    </Shell>
  );
}
