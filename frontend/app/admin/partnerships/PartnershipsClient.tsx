'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, OrgType, Partnership } from '@/lib/types';
import { Partnerships } from '../sections/Partnerships';

export function PartnershipsClient({
  org,
  partnerships,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  partnerships: Partnership[];
  overview: AdminOverview;
  items: NavItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (fn: () => Promise<any>, ok = 'Done') => {
      setBusy(true);
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const patch = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'PATCH', body: JSON.stringify(body) }), ok);

  return (
    <Shell
      org={org}
      items={items}
      active="Partnerships"
      title="Partnerships"
      lede="Rates are per redemption. Guest rate is paid up front for an unidentified signup; the delta is released if the user identifies within the grace window."
      actions={
        <>
          {!overview.ledger_balanced && (
            <span className={pillBad}>ledger off by {num(overview.ledger_sum)}</span>
          )}
          <button className={btnGhost} onClick={() => router.refresh()}>
            Refresh
          </button>
        </>
      }
    >
      <Partnerships d={{ partnerships }} loading={false} busy={busy} patch={patch} />
    </Shell>
  );
}
