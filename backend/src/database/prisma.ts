import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { DATABASE_URL } from '../config';

export type { Prisma } from '../generated/prisma/client';

// Prisma 7 talks to Postgres through a driver adapter, so the pool is ours to configure.
// A managed Postgres (RDS/Neon/Supabase) needs TLS; pg reads `sslmode=` straight from the
// connection string, so the URL stays the single place SSL is configured.
export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An idle-client error (network blip, DB failover) is emitted on the pool, and an
// unhandled 'error' event takes the whole process down. Log and let pg reconnect.
pool.on('error', (e) => console.error('pg idle client error', e.message));

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** The client handed to an interactive `prisma.$transaction(async (tx) => ...)` callback. */
export type Tx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$extends' | '$on' | '$use'
>;
