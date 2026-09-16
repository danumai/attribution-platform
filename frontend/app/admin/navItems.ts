/**
 * Pure — no fetching. Every admin route fetches /v1/admin/overview anyway (for the ledger
 * banner and the two badge counts), so building the nav from that same response costs nothing
 * extra. Real hrefs, matching the eleven routes the old client-tab admin console used to fake.
 */
import type { NavItem } from '@/lib/shell';
import type { AdminOverview } from '@/lib/types';

const TAB_DEFS: { id: string; label: string; icon: NavItem['icon']; href: string; group?: string }[] = [
  { id: 'Overview', label: 'Overview', icon: 'overview', href: '/admin' },
  { id: 'Organizations', label: 'Organizations', icon: 'orgs', href: '/admin/organizations', group: 'Accounts' },
  { id: 'Partnerships', label: 'Partnerships', icon: 'partnerships', href: '/admin/partnerships', group: 'Accounts' },
  { id: 'Campaigns', label: 'Campaigns', icon: 'campaigns', href: '/admin/campaigns', group: 'Accounts' },
  { id: 'Audience', label: 'Audience', icon: 'overview', href: '/admin/audience', group: 'Traffic' },
  { id: 'Scans', label: 'Scans', icon: 'scans', href: '/admin/scans', group: 'Traffic' },
  { id: 'Redemptions', label: 'Redemptions', icon: 'redemptions', href: '/admin/redemptions', group: 'Traffic' },
  { id: 'QR codes', label: 'QR codes', icon: 'qr', href: '/admin/qr-codes', group: 'Traffic' },
  { id: 'Ledger', label: 'Ledger', icon: 'ledger', href: '/admin/ledger', group: 'Money' },
  { id: 'Notifications', label: 'Notifications', icon: 'audit', href: '/admin/notifications', group: 'Money' },
  { id: 'Audit log', label: 'Audit log', icon: 'audit', href: '/admin/audit-log', group: 'Money' },
];

export function buildAdminNav(overview: AdminOverview | null): NavItem[] {
  return TAB_DEFS.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    href: t.href,
    group: t.group,
    badge:
      t.id === 'Partnerships'
        ? overview?.pending_partnerships
        : t.id === 'Notifications'
          ? overview?.open_notifications
          : undefined,
  }));
}

/** Every route's Shell needs to jump straight to another tab from inside a section (e.g.
 *  "View its scans" from the Campaigns table). One lookup, shared by every Client wrapper. */
export const TAB_HREF: Record<string, string> = Object.fromEntries(
  TAB_DEFS.map((t) => [t.id, t.href]),
);