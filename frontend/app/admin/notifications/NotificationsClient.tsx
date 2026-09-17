'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, AuditEntry, OrgType } from '@/lib/types';
import { Notifications } from '../sections/Notifications';

export function NotificationsClient({
  org,
  notifications,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  notifications: AuditEntry[];
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

  const post = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'POST', body: JSON.stringify(body) }), ok);

  return (
    <Shell
      org={org}
      items={items}
      active="Notifications"
      title="Notifications"
      lede="What tenants have done that nobody here has acknowledged — a funded budget, a repriced partnership. Marking one handled moves it out of here; the audit log keeps it forever."
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
      <Notifications d={{ notifications }} loading={false} busy={busy} post={post} />
    </Shell>
  );
}
