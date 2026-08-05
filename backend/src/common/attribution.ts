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

/** Free text the publisher declares about *their own* joining bonus. Never an instruction. */
export function validateBonusLabel(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('bonus_label must be a string');
  const v = raw.trim();
  if (v.length > 120) throw new BadRequestException('bonus_label must be 120 characters or fewer');
  return v;
}

export interface AppTargets {
  android_package: string | null;
  ios_app_id: string | null;
  landing_url: string | null;
}

/**
 * Where a scan is sent. Store listings only — no deep link carrying a payload, because a
 * payload the app can read is the thing that turns a QR into an unlock mechanism.
 *
 * `claim_id` goes in Play's `referrer` (an install-attribution channel, not app content).
 * The App Store has no equivalent, which is exactly why iOS needs the fingerprint path.
 */
export function storeUrl(platform: Platform, t: AppTargets, claimId: string): string | null {
  if (platform === 'android' && t.android_package) {
    const referrer = `utm_source=qrmarketer&utm_medium=qr&qrm_claim=${claimId}`;
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(
      t.android_package,
    )}&referrer=${encodeURIComponent(referrer)}`;
  }
  if (platform === 'ios' && t.ios_app_id) return `https://apps.apple.com/app/id${t.ios_app_id}`;
  // Desktop scan, or a publisher who has not registered an app yet: their own web page,
  // still with no token on it.
  return t.landing_url;
}

/** Pull our claim id back out of a raw Play Install Referrer string. */
export function claimIdFromReferrer(referrer?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  const m = /(?:^|[&?])qrm_claim=([A-Za-z0-9_-]{6,64})(?:&|$)/.exec(referrer.trim());
  return m ? m[1] : null;
}

/* ---------------------------------------------------------------------------
 * Device signals — the fingerprint's third, fourth and fifth dimensions.
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

export interface DeviceSignals {
  tz: string | null;
  screen: string | null;
  language: string | null;
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
 */
export const BASE = 55;
export const WEIGHTS = { tz: 10, screen: 25, language: 10 } as const;

/** What a scan's stored signals score against the ones presented at first open. */
export function score(scan: Partial<DeviceSignals>, open: DeviceSignals): number {
  let n = BASE;
  for (const k of ['tz', 'screen', 'language'] as const)
    if (scan[k] && open[k] && scan[k] === open[k]) n += WEIGHTS[k];
  return n;
}

export type Decision<T> =
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
