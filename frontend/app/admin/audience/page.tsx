import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { Analytics } from '@/lib/audience';
import type { AdminOverview, Campaign } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { AudienceClient } from './AudienceClient';

export default async function AdminAudiencePage({
  searchParams,
}: {
  searchParams: { campaign_id?: string; days?: string };
}) {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const campaignId = searchParams.campaign_id ?? '';
  const days = Number(searchParams.days ?? '30') || 30;

  const [campaigns, analytics, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Campaign[]>('/v1/admin/campaigns?limit=1000'),
      apiServer<Analytics>(
        `/v1/admin/analytics?days=${days}${campaignId ? `&campaign_id=${campaignId}` : ''}`,
      ),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <AudienceClient
      org={session.org}
      campaigns={campaigns}
      analytics={analytics}
      overview={overview}
      items={buildAdminNav(overview)}
      campaignId={campaignId}
      days={days}
    />
  );
}
