import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, AuditEntry } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { NotificationsClient } from './NotificationsClient';

export default async function AdminNotificationsPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [notifications, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<AuditEntry[]>('/v1/admin/notifications?limit=500'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <NotificationsClient
      org={session.org}
      notifications={notifications}
      overview={overview}
      items={buildAdminNav(overview)}
    />
  );
}
