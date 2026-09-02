/**
 * The shapes the API actually returns.
 *
 * Hand-written rather than generated, on purpose: this is the contract the console reads, not
 * the database schema, and every field here is one a page already renders.
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

/**
 * One offer a publisher grants out of its own pocket. `type` is the publisher's own slug —
 * `coins`, `subscription`, anything — because this platform never fulfils any of it; the
 * publisher's app is what reads `type`/`value`/`unit` and grants.
 */
export interface Bonus {
  type: string;
  label: string;
  value?: number;
  unit?: string;
  /** which claim it is granted on */
  on: 'acquisition' | 'engagement' | 'both';
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
  /** `TEAMID.bundle.id.Clip` — set together with `slug` to turn on the App Clip carrier */
  ios_appclip_id: string | null;
  /** the path segment of the App Clip invocation URL, and the prefix registered with Apple */
  slug: string | null;
  /** App Store Connect provider token, for the aggregate campaign-link cross-check */
  ios_provider_token: string | null;
  /** where an engagement scan is sent so the OS can open the app if it is installed */
  deeplink_url: string | null;
  bonuses: Bonus[];
  suspended: boolean;
  approved?: boolean;
  /** publisher only: everything ever earned — the ledger balance for this org */
  earnings?: number;
  /**
   * publisher only: the part of `earnings` that has cleared the settlement window and is not
   * already reserved by a queued request. This is what a payout can be requested against;
   * `earnings` is the headline number and is always the larger of the two.
   */
  withdrawable?: number;
}

/** `/v1/publishers` — `ready` means it has somewhere to send a scan. */
export interface PublisherOption {
  id: string;
  name: string;
  bonuses: Bonus[];
  ready: boolean;
}

export interface Partnership {
  id: string;
  promoter_org_id: string;
  publisher_org_id: string;
  coin_rate: number;
  guest_rate: number;
  grace_days: number;
  /** what one repeat purchase pays in an engagement campaign */
  engagement_rate: number;
  status: string;
  created_at: string;
  promoter_name: string;
  publisher_name: string;
  /** a repricing the promoter has asked for; null until it is accepted or declined */
  proposed_coin_rate: number | null;
  proposed_guest_rate: number | null;
  proposed_engagement_rate: number | null;
  /** what the publisher itself grants the user — read live, so it tracks the publisher's edits */
  publisher_bonuses: Bonus[];
}

export interface Campaign {
  id: string;
  partnership_id: string;
  name: string;
  status: string;
  /** acquisition = one payout per user ever; engagement = one per issued transaction code */
  mode: 'acquisition' | 'engagement';
  /** which of the publisher's offers this campaign promises, by `type`. Empty = all eligible. */
  bonus_types: string[];
  /** those offers resolved against the publisher's current list — what the artwork may say */
  publisher_bonuses: Bonus[];
  created_at: string;
  coin_rate: number;
  engagement_rate: number;
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
  /** the publisher's own offers that apply to this campaign's mode — what the artwork promises */
  publisher_bonuses: Bonus[];
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
  /** the promoter's own reference for the purchase this code was minted against — a PNR, an
   * order number. NULL for every code designed in the portal; set only by `POST /v1/issue`. */
  issued_ref: string | null;
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
  /** which payout guarantee this row lives under */
  kind: 'acquisition' | 'engagement';
  /** `code` is the engagement path — the transaction code named the purchase outright */
  match_method: string;
  qr_code_id: string | null;
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
  /** the publisher-vetting gate: false hides the org from the directory and blocks new partnerships */
  approved: boolean;
  created_at: string;
  has_api_key: boolean;
  campaigns: number;
  /** null for a promoter — only publishers earn a balance */
  coin_balance: number | null;
  /** any partnership, payment, withdrawal or ledger entry — true means delete is refused */
  has_history: boolean;
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
  engagement_campaigns: number;
  engagement_redemptions: number;
  engagement_coins: number;
  identified_redemptions: number;
  guest_redemptions: number;
  voided_codes: number;
  coins_granted: number;
  total_funded: number;
  ledger_sum: number;
  ledger_balanced: boolean;
  conversion_rate: number;
  /** tenant actions nobody on the platform side has acknowledged yet */
  open_notifications: number;
}

export interface AdminScan {
  id: string;
  scanned_at: string;
  user_agent: string | null;
  platform: string;
  country: string | null;
  city: string | null;
  language: string | null;
  referer_host: string | null;
  os: string | null;
  browser: string | null;
  device_type: string | null;
  /**
   * How the hand-off screen behaved — `held_ms` and `exit` (`tap` | `auto`), nothing about the
   * device. `exit: 'auto'` on an iOS scan is the shape of an install nobody could attribute:
   * the scanner never tapped, so the claim was never carried.
   */
  client: Record<string, string | number | boolean> | null;
  consumed: boolean;
  qr_code: string;
  campaign_id: string;
  campaign_name: string;
  promoter_name: string;
  publisher_name: string;
  redeemed: boolean;
  /** summed: one scan can pay both an acquisition and a purchase reward */
  coins: number | null;
  /** which carrier brought the claim back; `+`-joined when a scan paid twice, e.g. `referrer+code` */
  match_method: string | null;
  kind: string | null;
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
  /** `/v1/admin/notifications` only: which kind of tenant did this */
  actor_type?: string | null;
  acknowledged_at?: string | null;
}
