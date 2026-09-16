import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, AuditEntry } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { AuditLogClient } from './AuditLogClient';

export default async function AdminAuditLogPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [audit, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<AuditEntry[]>('/v1/admin/audit-log?limit=500'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <AuditLogClient org={session.org} audit={audit} overview={overview} items={buildAdminNav(overview)} />
  );
}
