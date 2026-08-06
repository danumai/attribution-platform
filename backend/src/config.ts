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
 * Both windows above are measured scan → *first open*, not scan → signup. That distinction is
 * the whole reason `installs` exists: an install lands minutes after a scan, a signup can land
 * days later, and forcing one window to cover both is what made the fingerprint path useless.
 * This is the second leg — how long a matched install stays convertible into a paid signup.
 */
export const SIGNUP_WINDOW_DAYS = int('SIGNUP_WINDOW_DAYS', 30, 1, 180);

/**
 * The accept/reject line for a probabilistic match, in the same 0–100 units as `score()`.
 *
 * Hashed IP + platform alone scores 55, so this default of 70 refuses them. That is the point:
 * an IP is not an identity. Carrier-grade NAT, café wifi, airport wifi and corporate VPNs all
 * put thousands of unrelated handsets behind one address, and "same NAT, both on iOS" describes
 * a postcode. At least one real device signal — timezone plus locale, or the screen geometry —
 * has to agree before anyone is paid.
 *
 * Raise it toward 80 to demand the screen match; there is no honest value below 60.
 */
export const MIN_CONFIDENCE = int('MIN_CONFIDENCE', 70, 60, 100);

/**
 * How far back the repeat-device check looks. One handset installing the same app for a second
 * campaign reward is the cheapest fraud there is, and the only one a device signal can catch.
 *
 * 0 disables it. Worth doing in markets where the fingerprint is coarse enough that unrelated
 * households collide — a blocked honest install is a publisher support ticket, and this trades
 * that risk against the farm.
 */
export const DEVICE_DEDUPE_DAYS = int('DEVICE_DEDUPE_DAYS', 7, 0, 90);

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

/**
 * Where the rate limiters count. Unset means "count in this process", which is correct for
 * exactly one instance and is how the stack runs locally.
 *
 * This is the setting that gates horizontal scale. Every per-IP control here is a security
 * control, so N replicas with in-process counters is N× every limit — twice the login attempts
 * before throttling, twice the scan ceiling. Production refuses to boot with more than one
 * instance and no shared store, but it cannot see the replica count from in here, so the
 * warning is the deploy's job; this is only the switch.
 */
export const REDIS_URL = process.env.REDIS_URL ?? '';

/**
 * Bearer token for `GET /metrics`. Unauthenticated it is free reconnaissance — request volumes,
 * route names, and the attribution refusal rates that describe how much this platform is
 * paying out. Production serves the endpoint only when a token is set.
 */
export const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';

if (PROD && METRICS_TOKEN && METRICS_TOKEN.length < 16)
  throw new Error('METRICS_TOKEN must be at least 16 characters in production');

const flag = (name: string, prodDefault: boolean) =>
  process.env[name] === undefined ? (PROD ? prodDefault : true) : process.env[name] === 'true';

/**
 * Unauthenticated Swagger UI at `/docs`. Fine locally, reconnaissance in production — it
 * lists every route, body shape and auth scheme in one page. Opt in explicitly if a
 * deployment really wants it published.
 */
export const ENABLE_DOCS = flag('ENABLE_DOCS', false);

/**
 * `POST /v1/campaigns/:id/fund` credits a campaign budget with no payment behind it — a
 * promoter can mint their own budget, and that budget is what pays publishers real fees.
 * It exists so the demo stack is usable without a PSP, and it must stay off in production
 * until checkout is wired up. Admins can still fund deliberately via `campaigns/:id/adjust`,
 * which is super-admin only and audited.
 */
export const ALLOW_SELF_FUNDING = flag('ALLOW_SELF_FUNDING', false);

/** Super admin, seeded on first boot. Validated here so a bad value fails before the DB is touched. */
export const ADMIN_EMAIL = required('ADMIN_EMAIL', 'admin@qrreward.local');
export const ADMIN_PASSWORD = required('ADMIN_PASSWORD', 'admin12345');

if (PROD && ADMIN_PASSWORD.length < 12)
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
