import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { Me, Partnership, Redemption } from '@/lib/types';
import { HEAD } from '../types';
import { buildDashboardNav, noDestination } from '../navItems';
import { RedemptionsClient } from './RedemptionsClient';

export default async function DashboardRedemptionsPage() {
  const session = getSession();
  if (!session) redirect('/login');

  const [redemptions, partnerships, profile] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Redemption[]>('/v1/redemptions'),
      apiServer<Partnership[]>('/v1/partnerships'),
      apiServer<Me>('/v1/orgs/me'),
    ]),
  );

  return (
    <RedemptionsClient
      org={session.org}
      redemptions={redemptions}
      partnerships={partnerships}
      profile={profile}
      items={buildDashboardNav(session.org.type, partnerships)}
      showNoDestination={noDestination(session.org.type, profile)}
      title={HEAD.redemptions.title}
      lede={HEAD.redemptions.lede}
    />
  );
}
