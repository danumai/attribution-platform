// Prisma CLI config. The CLI is a standalone process, so it loads the repo-root .env itself
// rather than relying on the `--env-file` flag the app scripts use.
import { config } from 'dotenv';
import { join } from 'path';
import { defineConfig } from 'prisma/config';

config({ path: join(__dirname, '..', '.env'), quiet: true });

// Deliberately not imported from src/config: this file is loaded by the standalone CLI,
// and a migrate-only job container should not have to set BASE_URL, ADMIN_* and the rest
// just to run `migrate deploy`. The DATABASE_URL rule is duplicated, nothing else is.
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL)
  throw new Error('DATABASE_URL must be set in production');

const url =
  process.env.DATABASE_URL ?? 'postgres://qrreward:qrreward@localhost:5436/qrreward';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url,
    // `migrate dev` replays migrations into a throwaway database to detect drift. Left unset,
    // Prisma creates and drops one itself. Managed Postgres usually forbids that, so point
    // SHADOW_DATABASE_URL at a second empty database there. Never at the real one.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
