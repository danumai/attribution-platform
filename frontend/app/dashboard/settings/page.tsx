import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { Me, Partnership } from '@/lib/types';
import { HEAD } from '../types';
import { buildDashboardNav } from '../navItems';
import { SettingsClient } from './SettingsClient';

export default async function DashboardSettingsPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type === 'promoter') redirect('/dashboard');

  const [partnerships, profile] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Partnership[]>('/v1/partnerships'),
      apiServer<Me>('/v1/orgs/me'),
    ]),
  );

  return (
    <SettingsClient
      org={session.org}
      profile={profile}
      partnerships={partnerships}
      items={buildDashboardNav(session.org.type, partnerships)}
      title={HEAD.settings.title}
      lede={HEAD.settings.lede}
    />
  );
}
