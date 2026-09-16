'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, OrgType, QrCode } from '@/lib/types';
import { QrCodes } from '../sections/QrCodes';

export function QrCodesClient({
  org,
  qrCodes,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  qrCodes: QrCode[];
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
      active="QR codes"
      title="QR codes"
      lede="Issued codes, their limits and their state."
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
      <QrCodes d={{ qrCodes }} loading={false} busy={busy} patch={patch} />
    </Shell>
  );
}
