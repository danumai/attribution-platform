/**
 * Every setting the process reads, validated at import time so a bad one fails before the first
 * request. BASE_URL is the one that cannot be fixed after the fact — it is encoded into printed
 * QR codes — so production refuses to boot without it rather than falling back to localhost.
 */
const PROD = process.env.NODE_ENV === 'production';

function required(name: string, fallback: string): string {
  const v = process.env[name];
  if (v) return v;
  if (PROD) throw new Error(`${name} must be set in production`);
  return fallback;
}

const int = (name: string, fallback: number, min: number, max: number) => {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(v) || v < min || v > max)
    throw new Error(`${name} must be an integer ${min}–${max}`);
  return v;
};

const flag = (name: string, prodDefault: boolean) =>
  process.env[name] === undefined ? (PROD ? prodDefault : true) : process.env[name] === 'true';

/**
 * Public origin of this API — encoded into every QR code, and the domain whose
 * `.well-known/apple-app-site-association` App Clips are verified against. Changing it
 * invalidates every printed code and every App Clip association at once.
 */
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

/** Postgres connection string. Demanded in production so a deploy cannot silently target the
 *  dev fallback — either nothing, or somebody else's database. */
export const DATABASE_URL = required(
  'DATABASE_URL',
  'postgres://qrreward:qrreward@localhost:5436/qrreward',
);

/**
 * How long a scan stays claimable. One window, because every carrier hands back the exact claim
 * id: a match is as sound on day 30 as in the first minute, so the bound is how long a real
 * install-then-open gap can be. Play retains the referrer ~90 days.
 */
export const REFERRER_WINDOW_DAYS = int('REFERRER_WINDOW_DAYS', 30, 1, 90);

/**
 * How long a matched install stays convertible into a paid signup. The window above is scan →
 * *first open*, not scan → signup, and that split is why `installs` exists: the carrier is
 * readable only at first open, but a signup can land days later.
 */
export const SIGNUP_WINDOW_DAYS = int('SIGNUP_WINDOW_DAYS', 30, 1, 180);

/**
 * Which upstream hops may set `X-Forwarded-For`. Every per-IP control reads `req.ip`, and
 * `req.ip` is whatever this says to believe.
 *
 * `true` means "trust the header from anyone", so one attacker becomes unlimited distinct IPs
 * and every limit evaporates. Express accepts it happily; it is refused here.
 */
const rawTrustProxy = process.env.TRUST_PROXY ?? 'loopback';
if (rawTrustProxy === 'true')
  throw new Error(
    "TRUST_PROXY must not be 'true' — that trusts X-Forwarded-For from any client and " +
      'defeats every per-IP rate limit. Use the hop count (e.g. 1) or the proxy subnet.',
  );
export const TRUST_PROXY = /^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy) : rawTrustProxy;

/**
 * Where the rate limiters count. Unset means "in this process", which is correct for exactly one
 * instance. This is the setting that gates horizontal scale: every per-IP control here is a
 * security control, so N replicas with in-process counters is N× every limit.
 */
export const REDIS_URL = process.env.REDIS_URL ?? '';

/**
 * Bearer token for `GET /metrics`. Unauthenticated it is free reconnaissance — request volumes,
 * route names, and the refusal rates that describe how much this platform pays out.
 */
export const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';

if (PROD && METRICS_TOKEN && METRICS_TOKEN.length < 16)
  throw new Error('METRICS_TOKEN must be at least 16 characters in production');

/** Unauthenticated Swagger UI at `/docs`. Fine locally, reconnaissance in production — it lists
 *  every route, body shape and auth scheme in one page. */
export const ENABLE_DOCS = flag('ENABLE_DOCS', false);

/**
 * `POST /v1/campaigns/:id/fund` credits a campaign budget with no payment behind it, so a
 * promoter can mint the budget that pays publishers real fees. For the demo stack only; admins
 * can still fund deliberately via `campaigns/:id/adjust`, which is audited.
 */
export const ALLOW_SELF_FUNDING = flag('ALLOW_SELF_FUNDING', false);

/**
 * Whether a publisher signup is usable immediately. In production it must be approved by an admin
 * first — "sign up, look legitimate, receive money" must not be one unauthenticated flow.
 */
export const AUTO_APPROVE_PUBLISHERS = flag('AUTO_APPROVE_PUBLISHERS', false);

/**
 * Basis points of every payout the platform keeps. Snapshotted onto each partnership at creation
 * and never read live, so changing it reprices only future partnerships. 1000 = 10%.
 */
export const PLATFORM_FEE_BPS = int('PLATFORM_FEE_BPS', 1000, 0, 10_000);

/**
 * How long earned fees stay unwithdrawable — the clawback window. Every fraud shape the threat
 * model accepts is bounded by "review runs before real money leaves", and this is that bound.
 */
export const SETTLEMENT_DELAY_DAYS = int('SETTLEMENT_DELAY_DAYS', 14, 0, 365);

/**
 * HMAC secret shared with the payment provider's webhook. Unset, `POST /v1/payments/webhook`
 * answers 404 and money-in is impossible — the correct failure mode, since an unsigned funding
 * webhook mints budgets for whoever finds it. The dev value below ships in `.env.example` so the
 * e2e suite runs on a fresh clone, and is refused at boot in production.
 */
const DEV_WEBHOOK_SECRET = 'dev-payment-webhook-secret-change-me';
export const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
if (PROD && PAYMENT_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET)
  throw new Error('PAYMENT_WEBHOOK_SECRET must be set to a non-default value in production');
if (PROD && PAYMENT_WEBHOOK_SECRET && PAYMENT_WEBHOOK_SECRET.length < 16)
  throw new Error('PAYMENT_WEBHOOK_SECRET must be at least 16 characters in production');

/** Where operational alerts are POSTed as `{ text }` — Slack-compatible. Unset, alerts still
 *  land in the structured log as `error`. */
export const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL ?? '';

/** Super admin, seeded on first boot. Validated here so a bad value fails before the DB is touched. */
export const ADMIN_EMAIL = required('ADMIN_EMAIL', 'admin@qrreward.local');
export const ADMIN_PASSWORD = required('ADMIN_PASSWORD', 'admin12345');

if (PROD && ADMIN_PASSWORD.length < 12)
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
