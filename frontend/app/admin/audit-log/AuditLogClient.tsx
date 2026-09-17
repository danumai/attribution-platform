'use client';
import { useRouter } from 'next/navigation';
import { Shell, type NavItem } from '@/lib/shell';
import { num } from '@/lib/fmt';
import { btnGhost, pillBad } from '@/lib/tw';
import type { AdminOverview, AuditEntry, OrgType } from '@/lib/types';
import { AuditLog } from '../sections/AuditLog';

export function AuditLogClient({
  org,
  audit,
  overview,
  items,
}: {
  org: { id: string; name: string; type: OrgType };
  audit: AuditEntry[];
  overview: AdminOverview;
  items: NavItem[];
}) {
  const router = useRouter();

  return (
    <Shell
      org={org}
      items={items}
      active="Audit log"
      title="Audit log"
      lede="Every privileged override, newest first."
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
      <AuditLog d={{ audit }} loading={false} />
    </Shell>
  );
}
