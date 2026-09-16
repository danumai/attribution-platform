/**
 * QR → store → install → first open, nothing redeemable in between: App Store 3.1.1 forbids
 * QR-unlocked content and Play confines virtual currency to its own app, so a scan carries only a
 * store listing or App Clip and attribution runs server-to-server on our opaque `claim_id` (Play
 * referrer, App Clip container, pasteboard). No device recognition — Apple's DPLA forbids it.
 */
import { BadRequestException } from '@nestjs/common';
import { str } from './security';

export type Platform = 'android' | 'ios' | 'other';

/** Which store listing to hand the scan to; never compared with what the app reports, so it
 *  carries no weight in who gets paid. */
export function detectPlatform(userAgent = ''): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  // iPadOS 13+ reports a desktop Safari UA; the touch hint still gives it away.
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && ua.includes('mobile')))
    return 'ios';
  return 'other';
}

/** Reverse-DNS, as Play requires. Anchored so it cannot smuggle a query string into the URL. */
export function validateAndroidPackage(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('android_package must be a string');
  const v = raw.trim();
  if (v.length > 255 || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(v))
    throw new BadRequestException('android_package must look like com.example.app');
  return v;
}

/** Apple's numeric adam id — the digits in apps.apple.com/app/id123456789. */
export function validateIosAppId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number')
    throw new BadRequestException('ios_app_id must be a string');
  const v = String(raw).trim().replace(/^id/i, '');
  if (!/^\d{6,12}$/.test(v))
    throw new BadRequestException('ios_app_id must be the numeric App Store id, e.g. 123456789');
  return v;
}

/** App Clip app id for the AASA `appclips.apps` array. Validated hard: one malformed entry
 *  invalidates the whole document and silently breaks every publisher in it. */
export function validateAppClipId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('ios_appclip_id must be a string');
  const v = raw.trim();
  if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,180}$/.test(v))
    throw new BadRequestException(
      'ios_appclip_id must be TEAMID.bundle.id.Clip, e.g. ABCDE12345.com.example.app.Clip',
    );
  return v;
}

/** App Store Connect provider token — the `pt=` of a campaign link. Digits, nothing else. */
export function validateProviderToken(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number')
    throw new BadRequestException('ios_provider_token must be a string');
  const v = String(raw).trim();
  if (!/^\d{4,20}$/.test(v))
    throw new BadRequestException('ios_provider_token must be the numeric provider id from App Store Connect');
  return v;
}

/** The publisher's path segment in the App Clip invocation URL, and so its App Store Connect
 *  prefix. DNS-label shape: it becomes a subdomain if Apple ever refuses two apps on one domain. */
export function validateSlug(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('slug must be a string');
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(v))
    throw new BadRequestException('slug must be 3–40 characters of a–z, 0–9 and hyphens');
  return v;
}

/** What the publisher gives out of its *own* pocket — a list, not a field. `type` is free text
 *  with no registry: the platform never fulfils these, and a registry means a deploy per offer. */
export type BonusOn = 'acquisition' | 'engagement' | 'both';
const BONUS_ON: BonusOn[] = ['acquisition', 'engagement', 'both'];

export type Bonus = {
  /** publisher's own slug for what is granted: `coins`, `subscription`, … */
  type: string;
  /** human wording, for artwork and reports */
  label: string;
  /** optional amount: 100 coins, 7 days */
  value?: number;
  /** optional unit for `value`: `coins`, `days`, `percent` */
  unit?: string;
  /** which claim this is granted on; default `both` */
  on: BonusOn;
  // Alias, not interface: only an alias gets the implicit index signature Prisma's
  // `InputJsonValue` needs to write JSONB uncast.
};

/** Matches the CHECK in 9d_publisher_bonuses; one PATCH must not bloat every claim response. */
export const MAX_BONUSES = 20;

export function validateBonuses(raw: unknown): Bonus[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new BadRequestException('bonuses must be an array');
  if (raw.length > MAX_BONUSES)
    throw new BadRequestException(`bonuses must be ${MAX_BONUSES} entries or fewer`);
  const list = raw.map((entry, i) => {
    const at = `bonuses[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new BadRequestException(`${at} must be an object`);
    const e = entry as Record<string, unknown>;
    // Slug, not free text: `type` is the key the publisher's app switches on.
    const type = str(e.type, `${at}.type`, 40)!.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(type))
      throw new BadRequestException(`${at}.type must be a slug, e.g. coins or subscription`);
    const label = str(e.label, `${at}.label`, 120)!.trim();
    if (!label) throw new BadRequestException(`${at}.label is required`);
    const on = (e.on ?? 'both') as BonusOn;
    if (!BONUS_ON.includes(on))
      throw new BadRequestException(`${at}.on must be one of ${BONUS_ON.join(', ')}`);
    const bonus: Bonus = { type, label, on };
    if (e.value !== undefined && e.value !== null && e.value !== '') {
      const value = Number(e.value);
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)
        throw new BadRequestException(`${at}.value must be a number between 0 and 1000000000`);
      bonus.value = value;
    }
    const unit = str(e.unit, `${at}.unit`, 20, false)?.trim();
    if (unit) bonus.unit = unit;
    return bonus;
  });
  // One entry per `type`: duplicates make "this campaign advertises `coins`" ambiguous.
  const seen = new Set<string>();
  for (const b of list)
    if (seen.has(b.type))
      throw new BadRequestException(`bonuses: ${b.type} appears twice — one entry per kind`);
    else seen.add(b.type);
  return list;
}

/** The offers that apply to one claim. Defensive read: the column is JSONB, so an old or
 *  hand-written row must degrade to "no offers" rather than throw inside a payout. */
export function bonusesFor(raw: unknown, kind: 'acquisition' | 'engagement'): Bonus[] {
  return allBonuses(raw).filter((b) => b.on === kind || b.on === 'both' || b.on === undefined);
}

/** The offers one *campaign* advertises: the publisher's eligible list for this mode narrowed to
 *  the promoter's slugs (empty = all). Read live, so a withdrawn offer drops out of the campaign. */
export function campaignBonuses(raw: unknown, mode: string, types?: string[] | null): Bonus[] {
  const eligible = bonusesFor(raw, mode === 'engagement' ? 'engagement' : 'acquisition');
  return types?.length ? eligible.filter((b) => types.includes(b.type)) : eligible;
}

/** The promoter's pick, checked against what the publisher actually grants. Unknown slug is a
 *  400: otherwise the print run advertises a promise nobody fulfils. */
export function validateBonusTypes(raw: unknown, eligible: Bonus[]): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new BadRequestException('bonus_types must be an array');
  const picked = [
    ...new Set(raw.map((t, i) => str(t, `bonus_types[${i}]`, 40)!.trim().toLowerCase())),
  ];
  for (const t of picked)
    if (!eligible.some((b) => b.type === t))
      throw new BadRequestException(`bonus_types: this publisher grants no "${t}" on this campaign`);
  return picked;
}

/** Every offer on the row, unscoped: what the promoter console shows when choosing a publisher. */
export function allBonuses(raw: unknown): Bonus[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Bonus[]).filter((b) => b && typeof b === 'object' && !Array.isArray(b));
}

/** The one-line summary that used to be the whole feature, still returned everywhere it was. */
export function bonusLabel(list: Bonus[]): string | null {
  return list.map((b) => b.label).join(' + ') || null;
}

interface AppTargets {
  android_package: string | null;
  ios_app_id: string | null;
  landing_url: string | null;
  /** engagement only; https origin the publisher claimed as an App Link / Universal Link */
  deeplink_url?: string | null;
  /** App Store Connect provider token, for the campaign-link cross-check */
  ios_provider_token?: string | null;
  /** `campaignToken(campaign.id)` — resolved by the caller, which already has the campaign */
  campaign_token?: string | null;
}

/** Where a scan is sent — store listings only; a payload the app can read is what turns a QR into
 *  an unlock. `claim_id` and `code` ride Play's `referrer` (an install-attribution channel) as
 *  opaque refs useless without the publisher's API key; the App Store has no equivalent. */
export function storeUrl(
  platform: Platform,
  t: AppTargets,
  claimId: string,
  code?: string,
): string | null {
  if (platform === 'android' && t.android_package) {
    const referrer =
      `utm_source=qrmarketer&utm_medium=qr&qrm_claim=${claimId}` +
      (code ? `&qrm_code=${code}` : '');
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(
      t.android_package,
    )}&referrer=${encodeURIComponent(referrer)}`;
  }
  if (platform === 'ios' && t.ios_app_id) {
    const url = `https://apps.apple.com/app/id${t.ios_app_id}`;
    // Reconciles, never attributes: Apple reports first-time downloads per `ct`, nothing per
    // user. `ct` is capped at 40 characters; ?, ! and & are rejected.
    return t.ios_provider_token && t.campaign_token
      ? `${url}?pt=${t.ios_provider_token}&ct=${t.campaign_token}&mt=8`
      : url;
  }
  // Desktop scan, or no app registered yet: the publisher's own web page, no token.
  return t.landing_url;
}

/** Where an *engagement* scan is sent: the publisher's App Link / Universal Link with the code and
 *  a store fallback. No install check — both platforms answer that offline; `qrm_fallback` is a
 *  store URL we build ourselves so a third party cannot assemble its Play referrer wrong. */
export function engagementUrl(
  platform: Platform,
  t: AppTargets,
  claimId: string,
  code: string,
  fallback?: string | null,
): string | null {
  const store = fallback ?? storeUrl(platform, t, claimId, code);
  if (!t.deeplink_url) return store;
  const u = new URL(t.deeplink_url);
  u.searchParams.set('qrm_code', code);
  if (store) u.searchParams.set('qrm_fallback', store);
  return u.toString();
}

/** Pull our claim id back out of a raw Play Install Referrer string. */
export function claimIdFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_claim=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/** Transaction code from a referrer, so a publisher already reading it needs no second
 *  integration. Must match `newShortCode()` shape — anything else is not ours to look up. */
export function codeFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_code=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/** Campaign token for an App Store campaign link (`ct=`), keyed on the campaign and never the
 *  scan: Apple caps it at 40 characters and reports only download counts, not per-user joins. */
export const campaignToken = (campaignId: string) => `qrm-${campaignId.replace(/-/g, '').slice(0, 32)}`;

/** Apple App Site Association document: one file, one shared domain, every App Clip publisher
 *  under its own `/c/<slug>/` prefix (longest match wins). ponytail: subdomain per publisher if
 *  App Store Connect ever refuses two apps registering prefixes on one domain. */
export const aasa = (appClipIds: string[]) => ({ appclips: { apps: appClipIds } });

/** What a QR encodes, defined once because this string is *printed*: `/c/<slug>/<code>` for a
 *  registered App Clip, else `/r/<code>`. Changing a slug orphans every code already printed. */
export const scanUrl = (base: string, code: string, slug?: string | null) =>
  slug ? `${base}/c/${slug}/${code}` : `${base}/r/${code}`;
