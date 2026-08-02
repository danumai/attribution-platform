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
