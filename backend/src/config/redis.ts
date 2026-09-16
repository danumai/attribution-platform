import Redis from 'ioredis';
import { log } from '../common/obs';
import { REDIS_URL } from './env';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!REDIS_URL) return null;
  if (client) return client;
  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  client.on('error', (e) => log.warn('redis.error', { error: e.message }));
  client.on('ready', () => log.info('redis.ready'));
  return client;
}

export async function closeRedis() {
  await client?.quit().catch(() => {});
  client = null;
}
