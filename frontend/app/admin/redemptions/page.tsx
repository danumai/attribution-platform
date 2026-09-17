import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, Redemption } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { RedemptionsClient } from './RedemptionsClient';

export default async function AdminRedemptionsPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [redemptions, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<Redemption[]>('/v1/admin/redemptions?limit=1000'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <RedemptionsClient
      org={session.org}
      redemptions={redemptions}
      overview={overview}
      items={buildAdminNav(overview)}
    />
  );
}
