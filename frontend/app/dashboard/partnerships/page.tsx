import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { Me, Partnership, PublisherOption } from '@/lib/types';
import { HEAD } from '../types';
import { buildDashboardNav, noDestination } from '../navItems';
import { PartnershipsClient } from './PartnershipsClient';

export default async function DashboardPartnershipsPage() {
  const session = getSession();
  if (!session) redirect('/login');

  const [partnerships, publishers, profile] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Partnership[]>('/v1/partnerships'),
      apiServer<PublisherOption[]>('/v1/publishers'),
      apiServer<Me>('/v1/orgs/me'),
    ]),
  );

  return (
    <PartnershipsClient
      org={session.org}
      partnerships={partnerships}
      publishers={publishers}
      profile={profile}
      items={buildDashboardNav(session.org.type, partnerships)}
      showNoDestination={noDestination(session.org.type, profile)}
      title={HEAD.partnerships.title}
      lede={HEAD.partnerships.lede}
    />
  );
}
