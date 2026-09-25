import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiServer, withAuthRedirect } from '@/lib/apiServer';
import type { Analytics } from '@/lib/audience';
import type { CampaignStats, QrCode } from '@/lib/types';
import { CampaignClient } from './CampaignClient';

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { days?: string };
}) {
  const session = getSession();
  if (!session) redirect('/login');

  const days = Number(searchParams.days ?? '30') || 30;

  const [stats, qrs, audience] = await withAuthRedirect(() =>
    Promise.all([
      apiServer<CampaignStats>(`/v1/campaigns/${params.id}/stats`),
      apiServer<QrCode[]>(`/v1/campaigns/${params.id}/qr-codes`),
      apiServer<Analytics>(`/v1/campaigns/${params.id}/analytics?days=${days}`),
    ]),
  );

  return (
    <CampaignClient
      org={session.org}
      campaignId={params.id}
      initialStats={stats}
      initialQrs={qrs}
      audience={audience}
      days={days}
    />
  );
}
