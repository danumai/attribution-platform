import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { AdminOverview, QrCode } from '@/lib/types';
import { buildAdminNav } from '../navItems';
import { QrCodesClient } from './QrCodesClient';

export default async function AdminQrCodesPage() {
  const session = getSession();
  if (!session) redirect('/login');
  if (session.org.type !== 'admin') redirect('/dashboard');

  const [qrCodes, overview] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<QrCode[]>('/v1/admin/qr-codes?limit=1000'),
      apiServer<AdminOverview>('/v1/admin/overview'),
    ]),
  );

  return (
    <QrCodesClient org={session.org} qrCodes={qrCodes} overview={overview} items={buildAdminNav(overview)} />
  );
}
