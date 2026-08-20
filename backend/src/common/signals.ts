/**
 * What a scan tells us about its context, taken from request headers alone.
 *
 * A QR code carries no data about whoever scanned it — everything below comes from the one HTTP
 * request the redirect hop sees. That is also the ceiling: no name, email, phone or precise
 * location, and nothing the store listing hands back.
 *
 * Separate from `attribution.ts` on purpose: that file's signals feed *matching* and must stay
 * coarse and stable, since a scan and a first-open have to agree on them. Everything here is
 * reporting only, so it can be as fine-grained as the headers allow and can change shape freely.
 */
import { Request } from 'express';

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

/**
 * Geo comes from the edge, not from a bundled IP database.
 *
 * Cloudflare, Vercel and friends already resolve the client address into a header, which costs
 * no dependency, no 60MB database and no refresh cron. The trade is NULL geo in local
 * development and behind any proxy that does not add these, so every consumer treats it as
 * optional.
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
 * A camera scan sends no Referer, so a populated one means the "scan" was a click on a page —
 * an aggregator reposted the code, or someone is replaying the URL. The host answers that; the
 * path and query would only pull someone else's page state into our database.
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
 * UA parsing, ordered most-specific first: every in-app browser also claims Safari or Chrome,
 * and Edge/Opera/Samsung all claim Chrome, so a naive `includes('Chrome')` swallows six real
 * answers into one wrong one. The in-app rows are what pay for this function — "came through
 * Instagram's webview" is a channel a Chrome/Safari split can never give.
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

/* ---------------------------------------------------------------------------
 * The second source: what the hand-off screen measured in the browser. Reporting only — the
 * timezone, screen, core count and appearance it also sends are matching signals and are parsed
 * by `attribution.ts`. Mixing the two is how a reporting field ends up scored.
 * ------------------------------------------------------------------------- */

/**
 * A bounded integer, or absence. Everything here arrives from a phone, so nothing is trusted.
 * The empty check is load-bearing: `Number('')` is `0`, so an absent key would otherwise land
 * as a real in-range zero — "reported no touch points" rather than "was never asked".
 */
const int = (raw: unknown, lo: number, hi: number): number | null => {
  const v = String(raw ?? '').trim();
  const n = Number(v);
  return v && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null;
};

/**
 * A short enum-ish token: lowercased, charset-bounded, so a value read straight into the
 * console can never carry markup. The comma is allowed because `languages` is a list.
 */
const tok = (raw: unknown, max = 24): string | null => {
  const v = String(raw ?? '').trim().toLowerCase();
  return v && v.length <= max && /^[a-z0-9._,-]+$/.test(v) ? v : null;
};

/**
 * What the browser measured, as a bag of reporting facts.
 *
 * Every value is optional twice over: the API is missing on some engines (Safari has no
 * `deviceMemory` or `connection`), and the whole screen is skipped for Android and desktop. So
 * this returns NULL rather than an object of nulls — an empty bag would read as "measured
 * nothing" when the truth is "was never asked".
 */
export function clientSignals(q: Record<string, unknown>): Record<string, unknown> | null {
  const bag: Record<string, unknown> = {
    /** inner window size in CSS px — smaller than `screen` by exactly the browser or in-app chrome */
    viewport: /^\d{2,5}x\d{2,5}$/.test(String(q.vp ?? '')) ? String(q.vp) : null,
    /** minutes east of UTC. Redundant with `tz` when that resolved, the only clock answer when it did not. */
    utc_offset: int(q.tzo, -900, 900),
    /** 0 on a desktop pointer, 5 on essentially every iPhone — a bot check, not an identity */
    touch_points: int(q.td, 0, 32),
    /** the whole `navigator.languages` list; the primary tag alone is already in `language` */
    languages: tok(q.langs, 120),
    /** `4g` / `3g` / `slow-2g`, Chromium only. A slow link is the honest reason for a drop-off. */
    network: tok(q.net, 12),
    /** advertised RAM in GB, Chromium only and deliberately coarse (0.25 … 8) */
    memory_gb: int(q.dm, 0, 64),
    color_depth: int(q.cd, 1, 64),
    /** the OS the *browser* claims, which is not always the one the UA claims */
    platform: tok(q.pf, 32),
    /** true in an installed PWA / standalone webview rather than a browser tab */
    standalone: q.sa === '1' ? true : q.sa === '0' ? false : null,
    /** an accessibility preference, reported because it changes what the screen was able to show */
    reduced_motion: q.rm === '1' ? true : q.rm === '0' ? false : null,
    /** ms the screen was actually held before it handed off — the real cost of this hop */
    held_ms: int(q.held, 0, 600_000),
    /** `tap` when the reader pressed Continue, `auto` when the hold ran out */
    exit: q.via === 'tap' ? 'tap' : q.via === 'auto' ? 'auto' : null,
  };
  for (const [k, v] of Object.entries(bag)) if (v === null) delete bag[k];
  return Object.keys(bag).length ? bag : null;
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
