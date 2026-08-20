import type { Campaign, Me, Partnership, PublisherOption, Redemption } from '@/lib/types';

export type Section = 'overview' | 'partnerships' | 'campaigns' | 'redemptions' | 'settings';

export const HEAD: Record<Section, { title: string; lede: string }> = {
  overview: { title: 'Overview', lede: 'Where your campaigns stand right now.' },
  partnerships: {
    title: 'Partnerships',
    lede: 'A partnership fixes the rates before any campaign can spend against them.',
  },
  campaigns: { title: 'Campaigns', lede: 'Fund a campaign, then print its codes.' },
  redemptions: { title: 'Redemptions', lede: 'Every signup a scan turned into, newest first.' },
  settings: {
    title: 'Settings',
    lede: 'Where scanned users land, and the key your backend calls with.',
  },
};

export const isSection = (s: string): s is Section => s in HEAD;

/** Everything the five fetches return, passed to a section as one bag. */
export interface DashboardData {
  publishers: PublisherOption[];
  partnerships: Partnership[];
  campaigns: Campaign[];
  redemptions: Redemption[];
  /** `/v1/orgs/me` — the publisher's earned balance and its configured destinations. */
  profile: Me | null;
}

/**
 * Run a mutation, report it, and refresh. Every write on this page goes through one of these
 * so that "the request succeeded" and "the page now shows what the server holds" cannot come
 * apart — a saved rate that still renders the old number is a promoter funding the wrong one.
 */
export type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

export interface SectionProps {
  d: DashboardData;
  isPromoter: boolean;
  loaded: boolean;
  busy: boolean;
  act: Act;
  go: (s: Section) => void;
}
