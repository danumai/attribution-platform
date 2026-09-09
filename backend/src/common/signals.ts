/**
 * Scan context from request headers alone — no name, email, phone or precise location. Kept out of
 * `attribution.ts` because these are reporting-only; that file's signals feed matching and must
 * stay coarse and stable.
 */
import { Request } from 'express';
import { Prisma } from '../../prisma/generated/client';

interface ScanSignals {
  /** ISO-3166 alpha-2, from the CDN in front of us. NULL when nothing resolved it. */
  country: string | null;
  city: string | null;
  /** primary Accept-Language tag, e.g. `en-us` */
  language: string | null;
  /** host that linked here, when a scan arrives via a page rather than a camera */
  referer_host: string | null;
  os: string | null;
  browser: string | null;
  /** mobile | tablet | desktop */
  device_type: string | null;
}

const head = (req: Request, name: string): string => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

// Geo from edge headers, not a bundled IP database: no dependency, no 60MB file, no refresh cron.
// Trade: NULL geo locally and behind proxies that omit them. ponytail: MaxMind GeoLite2 + a refresh
// job if geo is needed off a CDN or city accuracy must be guaranteed.
function geo(req: Request): { country: string | null; city: string | null } {
  // Netlify ships the whole answer as one base64 JSON header, not a header per field.
  let nf: { country?: { code?: string }; city?: string } = {};
  const rawNf = head(req, 'x-nf-geo');
  if (rawNf) {
    try {
      nf = JSON.parse(Buffer.from(rawNf, 'base64').toString('utf8'));
    } catch {
      /* not our shape — the other headers still get their turn */
    }
  }

  const raw = (
    head(req, 'cf-ipcountry') ||
    head(req, 'x-vercel-ip-country') ||
    head(req, 'cloudfront-viewer-country') ||
    head(req, 'fastly-client-country-code') ||
    nf.country?.code ||
    // Akamai packs its answer into one header: `georegion=...,country_code=DK,...`
    /country_code=([A-Za-z]{2})/.exec(head(req, 'x-akamai-edgescape'))?.[1] ||
    head(req, 'x-country-code') ||
    head(req, 'x-geo-country')
  ).toUpperCase();
  // CF sends XX for "could not resolve" and T1 for Tor exits — both are absence, not a place.
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : null;

  let city: string | null = null;
  const rawCity =
    head(req, 'x-vercel-ip-city') ||
    head(req, 'cf-ipcity') ||
    head(req, 'cloudfront-viewer-city') ||
    nf.city ||
    '';
  if (rawCity) {
    try {
      // Vercel percent-encodes it, so "São Paulo" arrives as "S%C3%A3o%20Paulo".
      city = decodeURIComponent(rawCity).trim().slice(0, 80) || null;
    } catch {
      city = rawCity.trim().slice(0, 80) || null; // malformed escape — keep the raw signal
    }
  }
  return { country, city };
}

// First tag of Accept-Language: `en-US,en;q=0.9,fr;q=0.8` → `en-us`.
function language(req: Request): string | null {
  const first = head(req, 'accept-language').split(',')[0].split(';')[0].trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(first) ? first : null;
}

// Host only: a camera scan sends no Referer, so a populated one means the scan was a click on a
// page. The path and query would only pull someone else's page state into our database.
function refererHost(req: Request): string | null {
  const raw = head(req, 'referer');
  if (!raw) return null;
  try {
    return new URL(raw).hostname.slice(0, 120) || null;
  } catch {
    return null;
  }
}

// Most-specific first: in-app browsers all claim Safari or Chrome and Edge/Opera/Samsung claim
// Chrome, so `includes('Chrome')` would swallow six answers into one wrong one.
const BROWSERS: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/TikTok|BytedanceWebview|musical_ly/i, 'TikTok'],
  [/Snapchat/i, 'Snapchat'],
  [/MicroMessenger/i, 'WeChat'],
  [/\bLine\//i, 'LINE'],
  [/WhatsApp/i, 'WhatsApp'],
  [/Twitter|TwitterAndroid/i, 'X'],
  [/Pinterest/i, 'Pinterest'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Edg[A-Z]?\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/SamsungBrowser/i, 'Samsung Internet'],
  [/YaBrowser/i, 'Yandex'],
  [/UCBrowser/i, 'UC Browser'],
  [/MiuiBrowser/i, 'Mi Browser'],
  [/Firefox\/|FxiOS/i, 'Firefox'],
  [/CriOS|Chrome\//i, 'Chrome'],
  [/Safari\//i, 'Safari'],
];

const OSES: [RegExp, string][] = [
  [/Windows NT/i, 'Windows'],
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod|iOS |CPU OS /i, 'iOS'],
  [/CrOS/i, 'ChromeOS'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/Linux|X11/i, 'Linux'],
];

const first = (table: [RegExp, string][], ua: string) =>
  table.find(([re]) => re.test(ua))?.[1] ?? null;

// Client hints beat the UA where present: Chrome froze its UA, so `sec-ch-ua-mobile` is its only
// trustworthy mobile answer. Absent on Safari/Firefox, hence a UA fallback rather than removal.
function deviceType(req: Request, ua: string, os: string | null): string {
  // Named tablets first: an Android tablet answers the mobile hint ?0, which alone reads desktop.
  if (/Tablet|iPad|Nexus 7|SM-T|SM-X|Kindle|Silk/i.test(ua)) return 'tablet';

  const hint = head(req, 'sec-ch-ua-mobile');
  if (hint === '?1') return 'mobile';
  // ?0 is "not a phone", which on a phone OS means tablet, not desktop.
  if (hint === '?0') return os === 'Android' || os === 'iOS' ? 'tablet' : 'desktop';

  // No hints (Safari, Firefox): UA fallback — Android phones say "Mobile", tablets omit it.
  if (os === 'Android' && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

// The second source: what the hand-off screen reports about itself. Two keys only — the earlier
// dozen (viewport, colour depth, touch points, memory, network) was a fingerprint kit.

// Bounded int, or absence. The empty check is load-bearing: `Number('')` is `0`, so an absent key
// would land as a real in-range zero — "held for no time" rather than "never asked".
const int = (raw: unknown, lo: number, hi: number): number | null => {
  const v = String(raw ?? '').trim();
  const n = Number(v);
  return v && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};

/** What the hand-off screen cost. NULL rather than an object of nulls: the screen is skipped
 *  entirely on Android and desktop, so "never asked" must not read as "measured nothing". */
export function clientSignals(q: Record<string, unknown>): Prisma.InputJsonObject | null {
  const bag: Record<string, string | number> = {};
  /** ms the screen was held before handing off — the cost of this hop */
  const held = int(q.held, 0, 600_000);
  if (held !== null) bag.held_ms = held;
  /** `tap` when the scanner pressed Continue, `auto` when the bail-out fired */
  if (q.via === 'tap' || q.via === 'auto') bag.exit = q.via;
  return Object.keys(bag).length ? bag : null;
}

/** Everything the redirect can learn, in one pass over the headers. */
export function scanSignals(req: Request): ScanSignals {
  const ua = head(req, 'user-agent');
  // `sec-ch-ua-platform` arrives quoted (`"Android"`) and is authoritative when sent.
  const hinted = head(req, 'sec-ch-ua-platform').replace(/"/g, '').trim();
  const os =
    ({ Android: 'Android', Windows: 'Windows', macOS: 'macOS', Linux: 'Linux', 'Chrome OS': 'ChromeOS', iOS: 'iOS' } as Record<string, string>)[hinted] ??
    first(OSES, ua);
  return {
    ...geo(req),
    language: language(req),
    referer_host: refererHost(req),
    os,
    browser: first(BROWSERS, ua),
    device_type: deviceType(req, ua, os),
  };
}
