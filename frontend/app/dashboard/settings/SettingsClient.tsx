'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import type { Me, OrgType, Partnership } from '@/lib/types';
import type { DashboardData } from '../types';
import { Settings } from '../sections/Settings';

export function SettingsClient({ org, profile, partnerships, items, title, lede }: {
  org: { id: string; name: string; type: OrgType };
  profile: Me | null;
  partnerships: Partnership[];
  items: NavItem[];
  title: string;
  lede: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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

  const d: DashboardData = { publishers: [], partnerships, campaigns: [], redemptions: [], profile };

  return (
    <Shell org={org} items={items} active="settings" title={title} lede={lede}>
      <Settings d={d} busy={busy} act={act} />
    </Shell>
  );
}
