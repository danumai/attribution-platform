import type { NavItem } from '@/lib/shell';
import type { Me, OrgType, Partnership } from '@/lib/types';

export function buildDashboardNav(orgType: OrgType, partnerships: Partnership[]): NavItem[] {
  const isPromoter = orgType === 'promoter';
  const awaitingMe = isPromoter ? 0 : partnerships.filter((p) => p.status === 'pending').length;
  const openProposals = partnerships.filter((p) => p.proposed_coin_rate !== null).length;

  return [
    { id: 'overview', label: 'Overview', icon: 'overview', href: '/dashboard' },
    {
      id: 'partnerships',
      label: 'Partnerships',
      icon: 'partnerships',
      href: '/dashboard/partnerships',
      badge: awaitingMe + (isPromoter ? 0 : openProposals),
    },
    { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', href: '/dashboard/campaigns' },
    { id: 'redemptions', label: 'Redemptions', icon: 'redemptions', href: '/dashboard/redemptions' },
    ...(isPromoter
      ? []
      : [{ id: 'settings', label: 'Settings', icon: 'settings' as const, href: '/dashboard/settings' }]),
  ];
}

export function noDestination(orgType: OrgType, profile: Me | null): boolean {
  return (
    orgType !== 'promoter' &&
    !!profile &&
    !profile.landing_url &&
    !profile.android_package &&
    !profile.ios_app_id
  );
}
