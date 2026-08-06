/**
 * The shapes the API actually returns.
 *
 * `api()` used to be `Promise<any>`, and that one `any` propagated into every `useState`,
 * every table column and every `.map` in the console — so a renamed server field became a
 * blank cell at runtime instead of a build error. These are hand-written rather than
 * generated on purpose: they are the contract the console reads, not the database schema,
 * and every field here is one a page already renders.
 *
 * Nothing validates at runtime. That is the honest limit of this file: it makes the client
 * consistent with itself, and the e2e suite is what keeps it consistent with the server.
 */
import type { Style } from './qr';

export type OrgType = 'promoter' | 'publisher' | 'admin';

/** `/v1/auth/login` and `/v1/auth/signup`. `api_key` is returned once, at signup. */
export interface AuthResult {
  token: string;
  org: { id: string; name: string; type: OrgType };
  api_key?: string | null;
}

/** `/v1/orgs/me` — `earnings` is present only for a publisher. */
export interface Me {
  id: string;
  name: string;
  type: OrgType;
  email: string;
  landing_url: string | null;
  android_package: string | null;
  ios_app_id: string | null;
  bonus_label: string | null;
  suspended: boolean;
  earnings?: number;
}

/** `/v1/publishers` — `ready` means it has somewhere to send a scan. */
export interface PublisherOption {
  id: string;
  name: string;
  bonus_label: string | null;
  ready: boolean;
}

export interface Partnership {
  id: string;
  promoter_org_id: string;
  publisher_org_id: string;
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
  status: string;
  created_at: string;
  promoter_name: string;
  publisher_name: string;
  /** a repricing the promoter has asked for; null until it is accepted or declined */
  proposed_coin_rate: number | null;
  proposed_guest_rate: number | null;
}

export interface Campaign {
  id: string;
  partnership_id: string;
  name: string;
  status: string;
  created_at: string;
  coin_rate: number;
  promoter_name: string;
  publisher_name: string;
  budget: number;
  /** admin listing only */
  scans?: number;
  /** admin listing only */
  redemptions?: number;
}

/** `/v1/campaigns/:id/stats` */
export interface CampaignStats {
  name: string;
  status: string;
  scans: number;
  redemptions: number;
  coins_granted: number;
  budget_remaining: number;
}

export interface QrCode {
  id: string;
  campaign_id: string;
  code: string;
  style: Style | null;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  voided: boolean;
  created_at: string;
  scan_url: string;
  /** admin listing only */
  campaign_name?: string;
  /** admin listing only */
  scans?: number;
}

export interface Redemption {
  id: string;
  campaign_id: string;
  scan_id: string;
  publisher_user_ref: string;
  coins: number;
  identified: boolean;
  match_method: string;
  upgraded_at: string | null;
  created_at: string;
  campaign_name: string;
  /** admin listing only */
  promoter_name?: string;
  /** admin listing only */
  publisher_name?: string;
}

/* ---------------- admin-only ---------------- */

export interface AdminOrg {
  id: string;
  name: string;
  type: OrgType;
  email: string;
  landing_url: string | null;
  suspended: boolean;
  created_at: string;
  has_api_key: boolean;
  campaigns: number;
  /** null for a promoter — only publishers earn a balance */
  coin_balance: number | null;
}

/** Every field is a count, so the whole thing is numeric bar the two derived flags. */
export interface AdminOverview {
  promoters: number;
  publishers: number;
  suspended_orgs: number;
  partnerships: number;
  pending_partnerships: number;
  campaigns: number;
  active_campaigns: number;
  qr_codes: number;
  scans: number;
  scans_24h: number;
  redemptions: number;
  identified_redemptions: number;
  guest_redemptions: number;
  voided_codes: number;
  coins_granted: number;
  total_funded: number;
  ledger_sum: number;
  ledger_balanced: boolean;
  conversion_rate: number;
}

export interface AdminScan {
  id: string;
  scanned_at: string;
  ip_hash: string | null;
  user_agent: string | null;
  platform: string;
  country: string | null;
  city: string | null;
  language: string | null;
  referer_host: string | null;
  os: string | null;
  browser: string | null;
  device_type: string | null;
  /** the four signals an iOS install is scored against — NULL when the hand-off screen was skipped */
  tz: string | null;
  screen: string | null;
  cores: number | null;
  dark: boolean | null;
  /** everything else the hand-off screen measured; reporting only, shape fixed by the server */
  client: Record<string, string | number | boolean> | null;
  consumed: boolean;
  qr_code: string;
  campaign_id: string;
  campaign_name: string;
  promoter_name: string;
  publisher_name: string;
  redeemed: boolean;
  coins: number | null;
  match_method: string | null;
}

export interface LedgerEntry {
  id: string;
  account: string;
  amount: number;
  ref: string;
  created_at: string;
}

export interface AccountBalance {
  account: string;
  balance: number;
}

export interface Ledger {
  entries: LedgerEntry[];
  balances: AccountBalance[];
}

export interface AuditEntry {
  id: string;
  actor_org_id: string | null;
  action: string;
  target: string;
  detail: unknown;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}
