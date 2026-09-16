import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOrg, AdminOverview } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { OrganizationsClient } from './OrganizationsClient';

export default async function AdminOrganizationsPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [orgs, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<AdminOrg[]>('/v1/admin/orgs?limit=1000'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <OrganizationsClient org={session.org} orgs={orgs} overview={overview} items={buildAdminNav(overview)} />
  );
}