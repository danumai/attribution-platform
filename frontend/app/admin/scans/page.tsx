import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, AdminScan, Campaign, Redemption } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { ScansClient } from './ScansClient';

export default async function AdminScansPage({
  searchParams,
}: {
  searchParams: { campaign_id?: string };
}) {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const campaignId = searchParams.campaign_id ?? '';

  const [scans, redemptions, campaigns, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<AdminScan[]>(
        `/v1/admin/scans?limit=1000${campaignId ? `&campaign_id=${campaignId}` : ''}`,
      ),
      apiServer<Redemption[]>('/v1/admin/redemptions?limit=1000'),
      apiServer<Campaign[]>('/v1/admin/campaigns?limit=1000'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <ScansClient
      org={session.org}
      scans={scans}
      redemptions={redemptions}
      campaigns={campaigns}
      overview={overview}
      items={buildAdminNav(overview)}
      campaignId={campaignId}
    />
  );
}
