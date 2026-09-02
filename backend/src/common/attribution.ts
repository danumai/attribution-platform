/**
 * QR → app store → install → first open, with nothing redeemable in between.
 *
 * The QR is a *measurement* artifact, never an unlock mechanism: App Store 3.1.1 forbids QR codes
 * that unlock content, and Play restricts virtual currency to the app it was bought in. So a scan
 * hands the phone one store listing or App Clip, carrying nothing the app could spend, and
 * attribution happens server-to-server afterwards.
 *
 * Every match is deterministic — one opaque `claim_id` we minted, carried across the install by
 * Play's referrer, an App Clip's shared container, or the pasteboard.
 *
 * Deliberately absent: any attempt to recognise the device. Apple's DPLA forbids deriving data
 * from a device to identify it, naming browser and device configuration explicitly, so the scored
 * iOS match was deleted rather than tuned.
 */
import { BadRequestException } from '@nestjs/common';
import { str } from './security';

export type Platform = 'android' | 'ios' | 'other';

/** Which store listing to hand this scan to, and nothing more. Never compared against anything
 *  the app reports, so it carries no weight in who gets paid. */
export function detectPlatform(userAgent = ''): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  // iPadOS 13+ reports a desktop Safari UA; the touch hint is what still gives it away.
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

/** The App Clip's app id, as it goes into the AASA `appclips.apps` array. Validated hard because
 *  one malformed entry invalidates the whole document and silently breaks App Clip invocation for
 *  every publisher in it. */
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

/** The publisher's path segment in the App Clip invocation URL, and so the prefix registered in
 *  App Store Connect. DNS-label shape, because the same string becomes a subdomain if Apple ever
 *  refuses two apps sharing one domain. */
export function validateSlug(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('slug must be a string');
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(v))
    throw new BadRequestException('slug must be 3–40 characters of a–z, 0–9 and hyphens');
  return v;
}

/**
 * What the publisher gives a user out of its *own* pocket — a list, not a field. `type` is free
 * text with no registry: the platform never issues or fulfils any of these, so an unrecognised
 * type costs it nothing, where anything narrower would be a deploy per invented offer.
 */
export type BonusOn = 'acquisition' | 'engagement' | 'both';
const BONUS_ON: BonusOn[] = ['acquisition', 'engagement', 'both'];

export type Bonus = {
  /** the publisher's own slug for the kind of thing granted: `coins`, `subscription`, … */
  type: string;
  /** human wording, for artwork and reports */
  label: string;
  /** optional amount, for the offers that have one: 100 coins, 7 days */
  value?: number;
  /** optional unit for `value`: `coins`, `days`, `percent` */
  unit?: string;
  /** which claim this is granted on; `both` is the default */
  on: BonusOn;
  // A type alias, not an interface: only an alias gets the implicit index signature Prisma's
  // `InputJsonValue` requires, so this writes to a JSONB column uncast.
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
    // Slug rather than free text: `type` is the key the publisher's app switches on, and a key
    // with spaces or punctuation is one nobody can match on reliably.
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
  // `type` is the key a campaign names its reward by, so it has to identify one offer. Two
  // entries sharing a slug make "this campaign advertises `coins`" ambiguous.
  const seen = new Set<string>();
  for (const b of list)
    if (seen.has(b.type))
      throw new BadRequestException(`bonuses: ${b.type} appears twice — one entry per kind`);
    else seen.add(b.type);
  return list;
}

/** The offers that apply to one claim. Read defensively — the column is JSONB, so an old or
 *  hand-written row must degrade to "no offers" rather than throw inside a payout. */
export function bonusesFor(raw: unknown, kind: 'acquisition' | 'engagement'): Bonus[] {
  return allBonuses(raw).filter((b) => b.on === kind || b.on === 'both' || b.on === undefined);
}

/**
 * The offers one *campaign* advertises: the publisher's eligible list for this mode, narrowed to
 * the slugs the promoter picked; an empty pick means all of them. Read live rather than
 * snapshotted, so an offer the publisher withdraws drops out of the campaign.
 */
export function campaignBonuses(raw: unknown, mode: string, types?: string[] | null): Bonus[] {
  const eligible = bonusesFor(raw, mode === 'engagement' ? 'engagement' : 'acquisition');
  return types?.length ? eligible.filter((b) => types.includes(b.type)) : eligible;
}

/** The promoter's pick, checked against what the publisher actually grants. An unknown slug is a
 *  400: it is a campaign about to print a promise nobody fulfils, and the print run pays for it. */
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
  /** engagement only; an https origin the publisher has claimed as an App Link / Universal Link */
  deeplink_url?: string | null;
  /** App Store Connect provider token, when the publisher wants the campaign-link cross-check */
  ios_provider_token?: string | null;
  /** `campaignToken(campaign.id)` — resolved by the caller, which already has the campaign */
  campaign_token?: string | null;
}

/**
 * Where a scan is sent. Store listings only — a payload the app can read is what turns a QR into
 * an unlock mechanism. `claim_id` goes in Play's `referrer`, an install-attribution channel; the
 * App Store has no equivalent, so on iOS the claim travels beside the store hop.
 *
 * `code` rides in the same referrer under the same limits: an opaque reference, useless without
 * the publisher's API key, and the only way a traveller with no app yet is paid for both.
 */
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
    // Aggregate only — Apple reports first-time downloads per `ct` and nothing per user — so it
    // reconciles rather than attributes. Capped at 40 characters; ?, ! and & are rejected.
    return t.ios_provider_token && t.campaign_token
      ? `${url}?pt=${t.ios_provider_token}&ct=${t.campaign_token}&mt=8`
      : url;
  }
  // Desktop scan, or a publisher with no app registered yet: their own web page, no token.
  return t.landing_url;
}

/**
 * Where an *engagement* scan is sent: the publisher's App Link / Universal Link, carrying the code
 * and a store URL to fall back to.
 *
 * No "is the app installed" check, because both platforms answer that offline. Installed, the OS
 * opens the app and we never see the request; not installed, the page forwards to `qrm_fallback`,
 * a store URL we built so its Play referrer cannot be assembled wrong by a third party.
 */
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

/** Pull the transaction code out of a referrer string, so a publisher already reading the referrer
 *  needs no second integration. Shaped like `newShortCode()` — anything else is not a code we
 *  issued and must not be looked up. */
export function codeFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_code=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/**
 * The campaign token for an App Store campaign link (`ct=`). Keyed on the campaign, never the
 * scan: Apple caps it at 40 characters and reports it back only as a download count, so a
 * per-scan id would turn an aggregate report into the per-user join this design removes.
 */
export const campaignToken = (campaignId: string) => `qrm-${campaignId.replace(/-/g, '').slice(0, 32)}`;

/**
 * The Apple App Site Association document. One file lists every publisher with a registered App
 * Clip, each with its own `/c/<slug>/` prefix; routing is by longest prefix match.
 *
 * ponytail: one shared domain. If App Store Connect ever refuses two apps registering different
 * prefixes on one domain, the fallback is a subdomain per publisher.
 */
export const aasa = (appClipIds: string[]) => ({ appclips: { apps: appClipIds } });

/**
 * What a QR code actually encodes. One definition, because this string is *printed*. A publisher
 * with a registered App Clip gets `/c/<slug>/<code>`, everyone else `/r/<code>`; both resolve to
 * the same handler. Changing a slug after a run is printed orphans every code in the world.
 */
export const scanUrl = (base: string, code: string, slug?: string | null) =>
  slug ? `${base}/c/${slug}/${code}` : `${base}/r/${code}`;
