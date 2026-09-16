'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { num } from '@/lib/fmt';
import { btn, btnGhost, card, codeKey, cx, pillBad } from '@/lib/tw';
import type { AdminOrg, AdminOverview, OrgType } from '@/lib/types';
import { Organizations } from '../sections/Organizations';

export function OrganizationsClient({
  org,
  orgs,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  orgs: AdminOrg[];
  overview: AdminOverview;
  items: NavItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // A rotated API key is shown exactly once, so it goes to a sticky panel rather than a toast —
  // same reasoning the original single-page admin console used.
  const [newKey, setNewKey] = useState('');

  /**
   * Mutations still go through the client-side api() (localStorage token), not apiServer() —
   * the backend at :4000 is a different origin than the httpOnly cookie belongs to, so a browser
   * click can't read that cookie to call it directly. Only the initial page load goes through
   * the cookie path; every write stays on the pre-migration pattern, unchanged.
   */
  const act = useCallback(
    async (fn: () => Promise<any>, ok = 'Done') => {
      setBusy(true);
      try {
        const res = await fn();
        if (res?.api_key) setNewKey(res.api_key);
        else toast.success(ok);
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
  const post = (path: string, body: unknown, ok?: string) =>
    void act(() => api(path, { method: 'POST', body: JSON.stringify(body) }), ok);
  const del = (path: string, ok?: string) => void act(() => api(path, { method: 'DELETE' }), ok);

  return (
    <Shell
      org={org}
      items={items}
      active="Organizations"
      title="Organizations"
      lede="Every promoter and publisher on the platform."
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
      {newKey && (
        <div className={cx(card, 'mt-3')}>
          <b>New API key — shown once. Copy it now.</b>
          <code className={codeKey}>{newKey}</code>
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <button
              className={btn}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newKey);
                  toast.success('Copied');
                } catch {
                  // Clipboard is permission-gated and absent over plain http. The key is on
                  // screen and selectable, so that stays the fallback.
                }
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
      <Organizations d={{ orgs }} loading={false} busy={busy} patch={patch} post={post} del={del} />
    </Shell>
  );
}