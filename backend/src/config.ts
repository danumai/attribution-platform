/**
 * Every setting the process reads, validated at import time so a bad one fails before the
 * first request rather than on the path that needs it.
 *
 * BASE_URL is the one that cannot be fixed after the fact: it is encoded into the QR image,
 * which then gets printed. A wrong value there is a reprint, not a redeploy — so production
 * refuses to boot without it rather than falling back to localhost.
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
 * Public origin of this API — encoded into every QR code as `${BASE_URL}/r/{code}`, or
 * `${BASE_URL}/c/{slug}/{code}` for a publisher with an App Clip. It is also the domain whose
 * `.well-known/apple-app-site-association` those clips are verified against, so changing it
 * invalidates every printed code AND every App Clip association at once.
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
 * How long a scan stays claimable.
 *
 * One window, because there is now one match path. Every carrier — Play's install referrer, an
 * App Clip's shared container, the pasteboard — hands back the exact claim id, so a match is
 * as sound on day 30 as in the first minute and the window is bounded by how long a real
 * install-then-open gap can be rather than by how fast a guess goes stale. Play retains the
 * referrer ~90 days.
 */
export const REFERRER_WINDOW_DAYS = int('REFERRER_WINDOW_DAYS', 30, 1, 90);

/**
 * How long a matched install stays convertible into a paid signup.
 *
 * The window above is measured scan → *first open*, not scan → signup, and that split is why
 * `installs` exists: an install lands minutes after a scan, a signup can land days later, and
 * the carrier is readable only at first open — an App Clip's container is migrated once, and
 * the pasteboard holds one thing at a time.
 */
export const SIGNUP_WINDOW_DAYS = int('SIGNUP_WINDOW_DAYS', 30, 1, 180);

/**
 * Which upstream hops may set `X-Forwarded-For`. Every per-IP control here — login throttling,
 * scan limits, the global ceiling — reads `req.ip`, and `req.ip` is whatever this says to
 * believe. Nothing derived from the address is stored any more; these are rate limits only.
 *
 * `true` means "trust the header from anyone", which lets a client name its own address: one
 * attacker becomes unlimited distinct IPs and every limit evaporates. Express accepts it
 * happily, so it is refused here. Name the real hops (`1` for one load balancer, or the proxy
 * subnet) — never the wildcard.
 */
const rawTrustProxy = process.env.TRUST_PROXY ?? 'loopback';
if (rawTrustProxy === 'true')
  throw new Error(
    "TRUST_PROXY must not be 'true' — that trusts X-Forwarded-For from any client and " +
      'defeats every per-IP rate limit. Use the hop count (e.g. 1) or the proxy subnet.',
  );
export const TRUST_PROXY = /^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy) : rawTrustProxy;

/**
 * Where the rate limiters count. Unset means "in this process", which is correct for exactly
 * one instance and is how the stack runs locally.
 *
 * This is the setting that gates horizontal scale: every per-IP control here is a security
 * control, so N replicas with in-process counters is N× every limit. The deploy has to enforce
 * that, since the process cannot see its own replica count — this is only the switch.
 */
export const REDIS_URL = process.env.REDIS_URL ?? '';

/**
 * Bearer token for `GET /metrics`. Unauthenticated it is free reconnaissance — request volumes,
 * route names, and the attribution refusal rates that describe how much this platform pays out.
 * Production serves the endpoint only when a token is set.
 */
export const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';

if (PROD && METRICS_TOKEN && METRICS_TOKEN.length < 16)
  throw new Error('METRICS_TOKEN must be at least 16 characters in production');

/** Unauthenticated Swagger UI at `/docs`. Fine locally, reconnaissance in production — it lists
 *  every route, body shape and auth scheme in one page. */
export const ENABLE_DOCS = flag('ENABLE_DOCS', false);

/**
 * `POST /v1/campaigns/:id/fund` credits a campaign budget with no payment behind it — a promoter
 * can mint the budget that pays publishers real fees. It exists so the demo stack works without
 * a PSP and must stay off until checkout is wired up. Admins can still fund deliberately via
 * `campaigns/:id/adjust`, which is super-admin only and audited.
 */
export const ALLOW_SELF_FUNDING = flag('ALLOW_SELF_FUNDING', false);

/**
 * Whether a publisher signup is usable immediately. In production a publisher must be approved
 * by an admin before it appears in the directory or can enter a partnership — "sign up, look
 * legitimate, receive money" must not be one unauthenticated flow.
 */
export const AUTO_APPROVE_PUBLISHERS = flag('AUTO_APPROVE_PUBLISHERS', false);

/**
 * Basis points of every payout the platform keeps — the take rate. Snapshotted onto each
 * partnership at creation and never read live at payout time, so changing it here reprices only
 * future partnerships. 1000 = 10%; 0 is legal for a launch promotion.
 */
export const PLATFORM_FEE_BPS = int('PLATFORM_FEE_BPS', 1000, 0, 10_000);

/**
 * How long earned fees stay unwithdrawable — the platform's clawback window. Every fraud shape
 * the threat model accepts (self-scan, collusion, a disputed attribution) is bounded by "review
 * runs before real money leaves", and this is the number that makes that true. 0 disables it.
 */
export const SETTLEMENT_DELAY_DAYS = int('SETTLEMENT_DELAY_DAYS', 14, 0, 365);

/**
 * HMAC secret shared with the payment provider's webhook. Unset, `POST /v1/payments/webhook`
 * answers 404 and money-in is impossible — the correct failure mode, since an unsigned funding
 * webhook mints budgets for whoever finds it.
 *
 * `.env.example` ships the dev value below so the e2e suite's signature assertions run on a
 * fresh clone. Shipping it to production would let anyone who reads this repo credit a budget,
 * so it is refused at boot there — the same treatment JWT_SECRET's default gets.
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
