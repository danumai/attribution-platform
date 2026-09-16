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

export const BASE_URL = required('BASE_URL', 'http://localhost:4000').replace(/\/+$/, '');

export const FRONTEND_URLS = required('FRONTEND_URL', 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const FRONTEND_URL = FRONTEND_URLS[0];

if (PROD)
  for (const u of [BASE_URL, ...FRONTEND_URLS])
    if (!u.startsWith('https://'))
      throw new Error(`${u} must use https in production — scans are redirected over these origins`);

export const DATABASE_URL = required(
  'DATABASE_URL',
  'postgres://qrreward:qrreward@localhost:5436/qrreward',
);

export const DB_POOL_MAX = int('DB_POOL_MAX', 10, 1, 100);

export const REFERRER_WINDOW_DAYS = int('REFERRER_WINDOW_DAYS', 30, 1, 90);

export const SIGNUP_WINDOW_DAYS = int('SIGNUP_WINDOW_DAYS', 30, 1, 180);

const rawTrustProxy = process.env.TRUST_PROXY ?? 'loopback';
if (rawTrustProxy === 'true')
  throw new Error(
    "TRUST_PROXY must not be 'true' — that trusts X-Forwarded-For from any client and " +
      'defeats every per-IP rate limit. Use the hop count (e.g. 1) or the proxy subnet.',
  );
export const TRUST_PROXY = /^\d+$/.test(rawTrustProxy) ? Number(rawTrustProxy) : rawTrustProxy;

export const REDIS_URL = process.env.REDIS_URL ?? '';

export const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';

if (PROD && METRICS_TOKEN && METRICS_TOKEN.length < 16)
  throw new Error('METRICS_TOKEN must be at least 16 characters in production');

export const ENABLE_DOCS = flag('ENABLE_DOCS', false);

export const ALLOW_SELF_FUNDING = flag('ALLOW_SELF_FUNDING', false);

export const AUTO_APPROVE_PUBLISHERS = flag('AUTO_APPROVE_PUBLISHERS', false);

export const PLATFORM_FEE_BPS = int('PLATFORM_FEE_BPS', 1000, 0, 10_000);

export const SETTLEMENT_DELAY_DAYS = int('SETTLEMENT_DELAY_DAYS', 14, 0, 365);

const DEV_WEBHOOK_SECRET = 'dev-payment-webhook-secret-change-me';
export const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
if (PROD && PAYMENT_WEBHOOK_SECRET === DEV_WEBHOOK_SECRET)
  throw new Error('PAYMENT_WEBHOOK_SECRET must be set to a non-default value in production');
if (PROD && PAYMENT_WEBHOOK_SECRET && PAYMENT_WEBHOOK_SECRET.length < 16)
  throw new Error('PAYMENT_WEBHOOK_SECRET must be at least 16 characters in production');

export const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL ?? '';

export const ADMIN_EMAIL = required('ADMIN_EMAIL', 'admin@qrreward.local');
export const ADMIN_PASSWORD = required('ADMIN_PASSWORD', 'admin12345');

if (PROD && ADMIN_PASSWORD.length < 12)
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
