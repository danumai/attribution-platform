import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, Ledger as LedgerData } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { LedgerClient } from './LedgerClient';

export default async function AdminLedgerPage({
  searchParams,
}: {
  searchParams: { account?: string };
}) {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const account = searchParams.account ?? '';

  const [ledger, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<LedgerData>(`/v1/admin/ledger${account ? `?account=${encodeURIComponent(account)}` : ''}`),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <LedgerClient
      org={session.org}
      ledger={ledger}
      overview={overview}
      items={buildAdminNav(overview)}
      account={account}
    />
  );
}
