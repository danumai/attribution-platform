import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, Campaign } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { CampaignsClient } from './CampaignsClient';

export default async function AdminCampaignsPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [campaigns, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Campaign[]>('/v1/admin/campaigns?limit=1000'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <CampaignsClient org={session.org} campaigns={campaigns} overview={overview} items={buildAdminNav(overview)} />
  );
}
