import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { Campaign, Me, Partnership } from '@/lib/types';
import { HEAD } from '../types';
import { buildDashboardNav, noDestination } from '../navItems';
import { CampaignsClient } from './CampaignsClient';

export default async function DashboardCampaignsPage() {
  const session = getSession();
  if (!session) redirect('/login');

  const [campaigns, partnerships, profile] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Campaign[]>('/v1/campaigns'),
      apiServer<Partnership[]>('/v1/partnerships'),
      apiServer<Me>('/v1/orgs/me'),
    ]),
  );

  return (
    <CampaignsClient
      org={session.org}
      campaigns={campaigns}
      partnerships={partnerships}
      profile={profile}
      items={buildDashboardNav(session.org.type, partnerships)}
      showNoDestination={noDestination(session.org.type, profile)}
      title={HEAD.campaigns.title}
      lede={HEAD.campaigns.lede}
    />
  );
}
