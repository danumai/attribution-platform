/**
 * QR → app store → install → first open, with nothing redeemable in between.
 *
 * The compliance constraint that shapes this whole file: the QR must be a *measurement*
 * artifact, never an unlock mechanism. App Store 3.1.1 forbids apps using "their own
 * mechanisms to unlock content or functionality, such as license keys, augmented reality
 * markers, QR codes"; Google Play restricts virtual currency to the app it was bought in.
 * So a scan hands the phone exactly one thing — a store listing — and carries no token,
 * code or claim the app could spend. Attribution happens server-to-server afterwards,
 * the same way every mobile measurement partner does it.
 *
 * Two match paths, deterministic first:
 *
 *   Android  Play's Install Referrer survives the install, so the claim id rides along in
 *            `referrer=`. The app reads it via the standard Install Referrer API and its
 *            own backend hands it to us. Exact match, long window.
 *
 *   iOS      No referrer exists. Falls back to the industry-standard fingerprint match:
 *            the scan's coarse device signals (hashed IP + platform) are re-presented at
 *            first open and matched inside a short window. Probabilistic on purpose.
 */
import { BadRequestException } from '@nestjs/common';
import { str } from './security';

export type Platform = 'android' | 'ios' | 'other';

/**
 * Coarse on purpose — this is one of two fingerprint dimensions, so it has to agree
 * between a mobile browser at scan time and a native app at first open. Anything finer
 * (browser version, engine) differs across that boundary and would never match.
 */
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

/**
 * What the publisher gives a user out of its *own* pocket — coins, a subscription, a discount,
 * whatever it runs. A list, not a field: a publisher offers more than one thing, and the two
 * events this platform can name are already different products (a signup, a repeat purchase).
 *
 * `type` is free text and there is no registry of allowed kinds. That is not laziness about
 * validation — it is the same rule as everywhere else on this boundary: the platform never
 * issues or fulfils any of these, so a type it does not recognise costs it nothing. The
 * publisher's own app switches on `type` and grants `value`/`unit`; this side only stores,
 * echoes, and bounds. Anything narrower would be a deploy here every time a publisher invented
 * an offer.
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
  /** which claim this is granted on. `both` is the default and what one label always meant. */
  on: BonusOn;
  // A type alias rather than an interface on purpose: only an alias gets the implicit index
  // signature Prisma's `InputJsonValue` requires, so this writes to a JSONB column uncast.
};

/** Matches the CHECK in 9d_publisher_bonuses; one PATCH must not bloat every claim response. */
export const MAX_BONUSES = 20;

export function validateBonuses(raw: unknown): Bonus[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new BadRequestException('bonuses must be an array');
  if (raw.length > MAX_BONUSES)
    throw new BadRequestException(`bonuses must be ${MAX_BONUSES} entries or fewer`);
  return raw.map((entry, i) => {
    const at = `bonuses[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new BadRequestException(`${at} must be an object`);
    const e = entry as Record<string, unknown>;
    // Slug rather than free text: `type` is the key the publisher's app switches on, and a
    // key with spaces or punctuation in it is one nobody can match on reliably.
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
}

/**
 * The offers that apply to one claim. Read defensively — the column is JSONB, so a row written
 * before this shape existed, or by hand, must degrade to "no offers" rather than throw inside
 * a payout response.
 */
export function bonusesFor(raw: unknown, kind: 'acquisition' | 'engagement'): Bonus[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Bonus[]).filter(
    (b) => b && typeof b === 'object' && (b.on === kind || b.on === 'both' || b.on === undefined),
  );
}

/**
 * The one-line summary that used to be the whole feature. Still returned everywhere it was, so
 * a publisher integrated against `bonus_label` keeps working and only the artwork and the app
 * need to learn about the list.
 */
export function bonusLabel(list: Bonus[]): string | null {
  return list.map((b) => b.label).join(' + ') || null;
}

interface AppTargets {
  android_package: string | null;
  ios_app_id: string | null;
  landing_url: string | null;
  /** engagement only; an https origin the publisher has claimed as an App Link / Universal Link */
  deeplink_url?: string | null;
}

/**
 * Where a scan is sent. Store listings only — no deep link carrying a payload, because a
 * payload the app can read is the thing that turns a QR into an unlock mechanism.
 *
 * `claim_id` goes in Play's `referrer` (an install-attribution channel, not app content).
 * The App Store has no equivalent, which is exactly why iOS needs the fingerprint path.
 *
 * `code` is the engagement addition and rides in the same referrer, for the same reason and
 * under the same limits: it is an opaque transaction reference, it is useless without the
 * publisher's server-side API key, and Play's referrer is the one channel that survives an
 * install. Carrying it is what lets a traveller who had no app yet be paid for *both* the
 * signup and the ticket they bought — the referrer is the only place both facts can travel.
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
  if (platform === 'ios' && t.ios_app_id) return `https://apps.apple.com/app/id${t.ios_app_id}`;
  // Desktop scan, or a publisher who has not registered an app yet: their own web page,
  // still with no token on it.
  return t.landing_url;
}

/**
 * Where an *engagement* scan is sent: the publisher's App Link / Universal Link, carrying the
 * transaction code and the store URL to fall back to.
 *
 * There is deliberately no "is the app installed" check, here or anywhere — both platforms
 * answer that offline, before the request leaves the handset, and no server can:
 *
 *   installed      the OS opens the app with `qrm_code` and we never see the request.
 *   not installed  the browser loads the publisher's page, which forwards to `qrm_fallback` —
 *                  a store URL we built, so its Play referrer cannot be assembled wrong by a
 *                  third party.
 *
 * No `deeplink_url` registered simply falls back to the acquisition destination; on Android the
 * referrer still carries the code, so the campaign works either way.
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

/**
 * The engagement equivalent: pull the transaction code out of a referrer string, so a publisher
 * that already reads the referrer at first open does not need a second integration to collect
 * the purchase reward on an install that came from a boarding pass.
 *
 * Shaped like `newShortCode()` — base64url out of `randomBytes`, so it survives a referrer
 * without escaping. Anything else is not a code we issued and must not be looked up.
 */
export function codeFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_code=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------------------
 * Device signals — every fingerprint dimension past hashed IP + platform.
 *
 * Two sides have to produce byte-identical strings for these to be worth anything: a mobile
 * browser on the interstitial, and a native SDK at first open, minutes later. Everything below
 * exists to survive that crossing. Anything that does not survive it (UA string, browser
 * version, engine, fonts, canvas) is worse than useless here — it does not merely fail to
 * match, it drags a real match below the acceptance line.
 * ------------------------------------------------------------------------- */

/** IANA zone: `Asia/Dhaka` in the browser, the same string from `TimeZone.current` natively. */
export function normTz(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return /^[A-Za-z0-9_+/-]{1,64}$/.test(v) ? v : null;
}

/**
 * `{short}x{long}@{dpr}` — orientation-normalised, because a phone held sideways at scan time
 * and upright at first open is the same phone, and unsorted `w x h` would say otherwise.
 *
 * CSS pixels in the browser, points natively (`UIScreen.bounds`, `dp` on Android) — the same
 * numbers by construction, which is exactly why this is the strongest signal available and
 * why it is weighted highest below.
 */
export function normScreen(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{2,5})x(\d{2,5})@(\d{1,2}(?:\.\d{1,2})?)$/.exec(raw.trim());
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])];
  // A trailing `.0` and a bare integer are the same ratio; JS agrees, Postgres `=` does not.
  return `${Math.min(w, h)}x${Math.max(w, h)}@${Number(m[3])}`;
}

/** Primary language subtag, lowercased: `en-US` and `en-us` are one locale. */
export function normLang(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().split(',')[0].split(';')[0].trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(v) ? v : null;
}

/**
 * Logical CPU count: `navigator.hardwareConcurrency` in the browser, `activeProcessorCount`
 * natively. It splits handsets by generation where the screen only splits them by body size —
 * an iPhone 13 and a 15 share `390x844@3` and do not share a core count.
 *
 * Bounded rather than trusted: it crosses a trust boundary on both sides, and a nonsense value
 * must land as NULL rather than as its own bucket.
 */
export function normCores(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 512 ? n : null;
}

/**
 * Whether the device is in dark appearance: `prefers-color-scheme` in the browser,
 * `userInterfaceStyle` / `isNightModeActive` natively.
 *
 * Worth one bit and weighted like one. It earns its place as a tiebreaker: `decide()` refuses
 * a tie rather than guessing, so a bit that splits two otherwise-identical scans on one NAT is
 * a match that would otherwise be thrown away.
 */
export function normDark(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  const v = String(raw ?? '').trim().toLowerCase();
  if (['1', 'true', 'dark', 'yes'].includes(v)) return true;
  if (['0', 'false', 'light', 'no'].includes(v)) return false;
  return null;
}

export interface DeviceSignals {
  tz: string | null;
  screen: string | null;
  language: string | null;
  cores: number | null;
  dark: boolean | null;
}

/**
 * Confidence weights, in the 0–100 units `MIN_CONFIDENCE` is expressed in.
 *
 * `BASE` is what hashed IP + platform is worth on its own, and it is deliberately below any
 * legal `MIN_CONFIDENCE`: those two are the *filter* that produces candidates, not evidence
 * that this is the right one. Everything above the base has to be earned by a signal that
 * actually describes the handset.
 *
 * SCREEN outweighs TZ + LANG together because it is the only one with real entropy — a whole
 * country shares a timezone and a language, while screen geometry splits it by model.
 *
 * The weights sum to exactly 100 with `BASE`, so a confidence reads as a percentage and
 * compares directly against `MIN_CONFIDENCE`. A new signal has to be paid for out of the
 * existing ones.
 */
export const BASE = 55;
export const WEIGHTS = { tz: 8, screen: 22, language: 7, cores: 5, dark: 3 } as const;

/**
 * What a scan's stored signals score against the ones presented at first open.
 *
 * `== null` rather than falsy: `dark: false` and `cores: 0` are answers, and a truthiness test
 * would silently drop the light-mode half of every device.
 */
export function score(scan: Partial<DeviceSignals>, open: DeviceSignals): number {
  let n = BASE;
  for (const k of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[])
    if (scan[k] != null && open[k] != null && scan[k] === open[k]) n += WEIGHTS[k];
  return n;
}

type Decision<T> =
  | { scan: T; confidence: number }
  | { reason: 'no_match' | 'ambiguous' | 'low_confidence'; confidence?: number };

/**
 * Choose among candidate scans, or refuse. Pure, so the rule that decides who gets paid can
 * be read and tested without a database.
 *
 * The two refusals are the design, not error handling:
 *
 *   low_confidence  The network narrowed it to these scans and no signal from the handset
 *                   agreed with any of them. An IP is a postcode — carrier-grade NAT, café
 *                   wifi, an airport, a corporate VPN — and "somebody on this postcode
 *                   installed something" is not evidence about who scanned the poster.
 *
 *   ambiguous       Two scans fit the evidence equally well. Newest-first would resolve it,
 *                   and that is exactly the temptation to refuse: picking one would be
 *                   inventing a fact, and it would pay one publisher for another's scan.
 *
 * Both are correct answers. Most installs are organic and the honest reply to most of these
 * questions is "we don't know."
 */
export function decide<T extends Partial<DeviceSignals>>(
  candidates: T[],
  open: DeviceSignals,
  minConfidence: number,
): Decision<T> {
  if (!candidates.length) return { reason: 'no_match' };

  // Candidates arrive newest-first and `sort` is stable, so equal evidence still orders by
  // recency — which is precisely the tie the next line then declines to act on.
  const scored = candidates
    .map((scan) => ({ scan, confidence: score(scan, open) }))
    .sort((a, b) => b.confidence - a.confidence);

  const [best, runnerUp] = scored;
  if (runnerUp && runnerUp.confidence === best.confidence)
    return { reason: 'ambiguous', confidence: best.confidence };
  if (best.confidence < minConfidence)
    return { reason: 'low_confidence', confidence: best.confidence };
  return best;
}
