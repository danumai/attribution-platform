/**
 * What a scan tells us about its context, taken from request headers alone.
 *
 * A QR code carries no data about whoever scanned it — everything below comes from the one
 * HTTP request the redirect hop sees. That is also the ceiling: no name, no email, no phone,
 * no precise location, and nothing the store listing hands back. Anyone asking this platform
 * for "who scanned" is asking for something the medium cannot produce.
 *
 * Separate from `attribution.ts` on purpose. That file's `detectPlatform` is one half of the
 * iOS fingerprint match, so it is deliberately coarse and must stay stable — a scan and a
 * first-open have to agree on it. Nothing here feeds matching; it is reporting only, so it can
 * be as fine-grained as the headers allow and can change shape without breaking attribution.
 */
import { Request } from 'express';

export interface ScanSignals {
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

/**
 * Geo comes from the edge, not from a bundled IP database.
 *
 * Cloudflare, Vercel and friends already resolve the client address and pass the answer down
 * as a header, which costs us no dependency, no 60MB database file and no monthly refresh cron.
 * The trade is that geo is NULL in local development and behind any proxy that does not add
 * these — which is why every consumer treats it as optional rather than assuming coverage.
 *
 * ponytail: edge headers only. Add MaxMind GeoLite2 + a refresh job if geo is ever needed
 * off a CDN, or if city-level accuracy has to be guaranteed rather than best-effort.
 */
function geo(req: Request): { country: string | null; city: string | null } {
  const raw = (
    head(req, 'cf-ipcountry') ||
    head(req, 'x-vercel-ip-country') ||
    head(req, 'x-geo-country')
  ).toUpperCase();
  // CF sends XX for "could not resolve" and T1 for Tor exits — both are absence, not a place.
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : null;

  let city: string | null = null;
  const rawCity = head(req, 'x-vercel-ip-city') || head(req, 'cf-ipcity');
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

/** The first tag of Accept-Language. `en-US,en;q=0.9,fr;q=0.8` → `en-us`. */
function language(req: Request): string | null {
  const first = head(req, 'accept-language').split(',')[0].split(';')[0].trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(first) ? first : null;
}

/**
 * Host only, never the path.
 *
 * A camera scan sends no Referer at all — a populated one means the "scan" was a click on a
 * page, which is worth knowing (an aggregator reposted the code, or someone is replaying the
 * URL). The host answers that; the path and query would only pull someone else's page state
 * into our database for no reporting gain.
 */
function refererHost(req: Request): string | null {
  const raw = head(req, 'referer');
  if (!raw) return null;
  try {
    return new URL(raw).hostname.slice(0, 120) || null;
  } catch {
    return null;
  }
}

/**
 * UA parsing, ordered most-specific first — every in-app browser also claims to be Safari or
 * Chrome, and Edge/Opera/Samsung all claim to be Chrome, so a naive `includes('Chrome')` test
 * swallows six real answers into one wrong one.
 *
 * The in-app rows are the ones that pay for this function: "this scan came through Instagram's
 * webview" is a channel attribution a plain Chrome/Safari split can never give.
 */
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

/**
 * Client hints beat the UA string where they exist: Chrome has been freezing the UA for years,
 * so `sec-ch-ua-mobile` is the only trustworthy mobile answer on recent Chrome/Android. They
 * are absent on Safari and Firefox, hence the UA fallback rather than a replacement.
 */
function deviceType(req: Request, ua: string, os: string | null): string {
  // Named tablets first, and only these: an Android tablet answers the mobile hint with ?0,
  // which on its own would file it as a desktop.
  if (/Tablet|iPad|Nexus 7|SM-T|SM-X|Kindle|Silk/i.test(ua)) return 'tablet';

  const hint = head(req, 'sec-ch-ua-mobile');
  if (hint === '?1') return 'mobile';
  // ?0 means "not a phone", which on a phone OS means a tablet rather than a desktop.
  if (hint === '?0') return os === 'Android' || os === 'iOS' ? 'tablet' : 'desktop';

  // No hints (Safari, Firefox): fall back to the UA. Android phones say "Mobile" and Android
  // tablets omit it — but only trust that where Chrome has not already frozen the UA, which is
  // why this sits below the hint rather than above it.
  if (os === 'Android' && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Everything the redirect can learn, in one pass over the headers. */
export function scanSignals(req: Request): ScanSignals {
  const ua = head(req, 'user-agent');
  // `sec-ch-ua-platform` arrives quoted (`"Android"`) and is authoritative when Chrome sends it.
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
