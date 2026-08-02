/**
 * Every externally-visible URL in one place, validated at import time.
 *
 * BASE_URL is the one setting that cannot be fixed after the fact: it is encoded into the
 * QR image, which then gets printed on physical media. A wrong value there is not a config
 * bug you redeploy away, it is a reprint. So production refuses to boot without it rather
 * than quietly falling back to localhost.
 */
const PROD = process.env.NODE_ENV === 'production';

function required(name: string, fallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (PROD) throw new Error(`${name} must be set in production`);
  return fallback;
}

/** Public origin of this API — encoded into every QR code as `${BASE_URL}/r/{code}`. */
export const BASE_URL = required('BASE_URL', 'http://localhost:4000').replace(/\/+$/, '');

/** Browser origins allowed by CORS. First entry is the canonical one used for redirects. */
export const FRONTEND_URLS = required('FRONTEND_URL', 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const FRONTEND_URL = FRONTEND_URLS[0];

if (PROD)
  for (const u of [BASE_URL, ...FRONTEND_URLS])
    if (!u.startsWith('https://'))
      throw new Error(`${u} must use https in production — scans are redirected over these origins`);

/**
 * Postgres connection string. Unset in production, the dev fallback below would send a
 * deploy at a localhost that either is not there or, worse, is some other database — so
 * production demands it explicitly rather than reporting "can't reach localhost:5436".
 */
export const DATABASE_URL = required(
  'DATABASE_URL',
  'postgres://qrreward:qrreward@localhost:5436/qrreward',
);

/**
 * How long a scan stays claimable, per match path.
 *
 * The referrer path is deterministic — Play hands the app the exact claim id — so it can
 * afford a window as long as a real install-then-open gap (people scan a poster, install on
 * wifi that evening, open it the next day). Play itself retains the referrer ~90 days.
 *
 * The fingerprint path is probabilistic: it matches on hashed IP + platform, and in markets
 * where a whole neighbourhood shares one carrier NAT address those collide fast. The window
 * is the main control on how often it mis-attributes, so it is deliberately short and
 * tunable per deployment rather than baked in.
 */
const int = (name: string, fallback: number, min: number, max: number) => {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(v) || v < min || v > max)
    throw new Error(`${name} must be an integer ${min}–${max}`);
  return v;
};

export const REFERRER_WINDOW_DAYS = int('REFERRER_WINDOW_DAYS', 30, 1, 90);
export const FINGERPRINT_WINDOW_MIN = int('FINGERPRINT_WINDOW_MIN', 60, 1, 1440);

/**
 * Which upstream hops may set `X-Forwarded-For`. Every per-IP control in this system —
 * login throttling, scan limits, the global ceiling, and the iOS fingerprint itself — reads
 * `req.ip`, and `req.ip` is whatever this setting says to believe.
 *
 * `true` means "trust the header from anyone", which lets any client name its own address:
 * one attacker becomes unlimited distinct IPs and every limit above evaporates. Express
 * accepts it happily, so this is refused here instead. Name the real hops (`1` for a single
 * load balancer, or the proxy subnet) — never the wildcard.
 */
const rawTrustProxy = process.env.TRUST_PROXY ?? 'loopback';
if (rawTrustProxy === 'true')
  throw new Error(
    "TRUST_PROXY must not be 'true' — that trusts X-Forwarded-For from any client and " +
      'defeats every per-IP rate limit. Use the hop count (e.g. 1) or the proxy subnet.',
  );
export const TRUST_PROXY = /^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy) : rawTrustProxy;

/** Super admin, seeded on first boot. Validated here so a bad value fails before the DB is touched. */
export const ADMIN_EMAIL = required('ADMIN_EMAIL', 'admin@qrreward.local');
export const ADMIN_PASSWORD = required('ADMIN_PASSWORD', 'admin12345');

if (PROD && ADMIN_PASSWORD.length < 12)
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
