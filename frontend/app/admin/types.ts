import type { Analytics } from '@/lib/audience';
import type {
  AdminOrg,
  AdminOverview,
  AdminScan,
  AuditEntry,
  Campaign,
  Ledger,
  Partnership,
  QrCode,
  Redemption,
} from '@/lib/types';

/** The rail: eleven sections, grouped by what an operator is doing when they open them. */
export const TABS = [
  { id: 'Overview', icon: 'overview', group: '' },
  { id: 'Organizations', icon: 'orgs', group: 'Accounts' },
  { id: 'Partnerships', icon: 'partnerships', group: 'Accounts' },
  { id: 'Campaigns', icon: 'campaigns', group: 'Accounts' },
  { id: 'Audience', icon: 'overview', group: 'Traffic' },
  { id: 'Scans', icon: 'scans', group: 'Traffic' },
  { id: 'Redemptions', icon: 'redemptions', group: 'Traffic' },
  { id: 'QR codes', icon: 'qr', group: 'Traffic' },
  { id: 'Ledger', icon: 'ledger', group: 'Money' },
  { id: 'Notifications', icon: 'audit', group: 'Money' },
  { id: 'Audit log', icon: 'audit', group: 'Money' },
] as const;

export type Tab = (typeof TABS)[number]['id'];

export const HEAD: Record<Tab, string> = {
  Overview: 'Does the money add up, and what is waiting on you.',
  Organizations: 'Every promoter and publisher on the platform.',
  Partnerships:
    'Rates are per redemption. Guest rate is paid up front for an unidentified signup; the delta is released if the user identifies within the grace window.',
  Campaigns: 'Budgets, conversion and the kill switch.',
  Audience:
    'Where scans come from, on what, and when. Everything here is read off the request the redirect already receives — a QR code carries nothing about whoever scanned it.',
  Scans:
    'Every QR scan, newest first. IPs are stored as a truncated hash — enough to spot a repeat scanner, not enough to identify a person.',
  Redemptions: 'Every signup a publisher vouched for.',
  'QR codes': 'Issued codes, their limits and their state.',
  Ledger: 'Account balances and the entries behind them.',
  Notifications:
    'What tenants have done that nobody here has acknowledged — a funded budget, a repriced partnership. Marking one handled moves it out of here; the audit log keeps it forever.',
  'Audit log': 'Every privileged override, newest first.',
};

/** Everything the console holds at once. Partial because it fills in as the fetches land. */
export interface AdminData {
  overview?: AdminOverview;
  orgs?: AdminOrg[];
  partnerships?: Partnership[];
  campaigns?: Campaign[];
  scans?: AdminScan[];
  redemptions?: Redemption[];
  qrCodes?: QrCode[];
  ledger?: Ledger;
  audit?: AuditEntry[];
  notifications?: AuditEntry[];
  analytics?: Analytics;
}

/**
 * What every section needs from the page: the data, the two states that gate rendering, the
 * two mutating verbs, and the cross-tab jumps.
 *
 * `filterScans` / `filterLedger` are one call rather than the set-filter-then-switch-tab pair
 * they replace — the filter and the destination are one intent, and splitting them is how a
 * tab ends up showing platform-wide rows under a heading that names one campaign.
 */
export interface SectionProps {
  d: AdminData;
  loading: boolean;
  busy: boolean;
  patch: (path: string, body: unknown, ok?: string) => void;
  post: (path: string, body: unknown, ok?: string) => void;
  go: (tab: Tab) => void;
  filterScans: (campaignId: string) => void;
  filterLedger: (account: string) => void;
}
