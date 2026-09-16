import * as bcrypt from 'bcryptjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './config';
import { sha256 } from './common/security';
import { prisma } from './config/prisma';

const PROD = process.env.NODE_ENV === 'production';

/**
 * Accounts come from env, never signup. Dev re-asserts the demo logins every boot; production only
 * bootstraps the admin if absent (re-asserting would reset its password and un-suspend it).
 */
export async function seedAccounts() {
  const e = process.env;
  // `overwrite: false` in production — a redeploy must not revert a rotated admin password.
  await seedOrg('Super Admin', 'admin', ADMIN_EMAIL, ADMIN_PASSWORD, undefined, undefined, !PROD);
  if (PROD) return;
  if (e.PROMOTER_EMAIL && e.PROMOTER_PASSWORD)
    await seedOrg(e.PROMOTER_NAME ?? 'Promoter', 'promoter', e.PROMOTER_EMAIL, e.PROMOTER_PASSWORD);
  if (e.PUBLISHER_EMAIL && e.PUBLISHER_PASSWORD)
    await seedOrg(
      e.PUBLISHER_NAME ?? 'Publisher',
      'publisher',
      e.PUBLISHER_EMAIL,
      e.PUBLISHER_PASSWORD,
      e.PUBLISHER_API_KEY,
      e.PUBLISHER_LANDING_URL,
    );
}

async function seedOrg(
  name: string,
  type: string,
  email: string,
  password: string,
  apiKey?: string,
  landingUrl?: string,
  overwrite = true,
) {
  // Raw upsert, not prisma.upsert: read-then-write lets two replicas booting at once collide on
  // the unique email. `xmax = 0` is how Postgres reports insert-vs-update; seeded orgs skip vetting.
  const rows = await prisma.$queryRaw<{ created: boolean }[]>`
    INSERT INTO orgs (name, type, email, password_hash, api_key_hash, landing_url, approved)
    VALUES (${name}, ${type}, ${email.toLowerCase()}, ${await bcrypt.hash(password, 10)},
            ${apiKey ? sha256(apiKey) : null}, ${landingUrl ?? null}, true)
    ON CONFLICT (email) DO UPDATE SET
      name          = CASE WHEN ${overwrite} THEN EXCLUDED.name          ELSE orgs.name          END,
      type          = CASE WHEN ${overwrite} THEN EXCLUDED.type          ELSE orgs.type          END,
      password_hash = CASE WHEN ${overwrite} THEN EXCLUDED.password_hash ELSE orgs.password_hash END,
      api_key_hash  = CASE WHEN ${overwrite} THEN COALESCE(EXCLUDED.api_key_hash, orgs.api_key_hash) ELSE orgs.api_key_hash END,
      landing_url   = CASE WHEN ${overwrite} THEN COALESCE(EXCLUDED.landing_url,  orgs.landing_url)  ELSE orgs.landing_url  END,
      suspended     = CASE WHEN ${overwrite} THEN false                 ELSE orgs.suspended     END
    RETURNING (xmax = 0) AS created`;
  const verb = rows[0]?.created ? 'seeded' : overwrite ? 'updated' : 'left unchanged';
  console.log(`${verb} ${type}: ${email.toLowerCase()}`);
}
