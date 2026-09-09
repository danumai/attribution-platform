import { Pool } from 'pg';
import { DATABASE_URL, DB_POOL_MAX } from './env';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (e) => console.error('pg idle client error', e.message));
