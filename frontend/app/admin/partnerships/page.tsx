import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, Partnership } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { PartnershipsClient } from './PartnershipsClient';

export default async function AdminPartnershipsPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [partnerships, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Partnership[]>('/v1/admin/partnerships?limit=1000'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <PartnershipsClient
      org={session.org}
      partnerships={partnerships}
      overview={overview}
      items={buildAdminNav(overview)}
    />
  );
}
