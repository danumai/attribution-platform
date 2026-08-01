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
      throw new Error(`${u} must use https in production — scan tokens travel over these origins`);

/**
 * Postgres connection string. Unset in production, the dev fallback below would send a
 * deploy at a localhost that either is not there or, worse, is some other database — so
 * production demands it explicitly rather than reporting "can't reach localhost:5436".
 */
export const DATABASE_URL = required(
  'DATABASE_URL',
  'postgres://qrreward:qrreward@localhost:5436/qrreward',
);

/** Super admin, seeded on first boot. Validated here so a bad value fails before the DB is touched. */
export const ADMIN_EMAIL = required('ADMIN_EMAIL', 'admin@qrreward.local');
export const ADMIN_PASSWORD = required('ADMIN_PASSWORD', 'admin12345');

if (PROD && ADMIN_PASSWORD.length < 12)
  throw new Error('ADMIN_PASSWORD must be at least 12 characters in production');
