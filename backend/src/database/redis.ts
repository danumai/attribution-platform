/**
 * The shared rate-limit counter store, and the only thing this deployment uses Redis for.
 *
 * Optional by design: unset, the process keeps its in-process limiter, which is correct for a
 * single instance. Set, every replica counts against the same window — the prerequisite for
 * running more than one.
 *
 * Nothing here is a cache: no read path falls back to Redis, so losing it costs throttling
 * accuracy and nothing else — no correctness, no money, no data.
 */
import Redis from 'ioredis';
import { REDIS_URL } from '../config';
import { log } from '../common/obs';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!REDIS_URL) return null;
  if (client) return client;
  client = new Redis(REDIS_URL, {
    // Fail fast and let the caller fall back to the local window: the default retries forever,
    // which on the scan hot path piles requests up behind a dead Redis.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    // Capped backoff: a reconnect storm against a recovering Redis turns a blip into an outage.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  // An unlistened 'error' event takes the process down, and a rate limiter must never be able
  // to kill the API it protects.
  client.on('error', (e) => log.warn('redis.error', { error: e.message }));
  client.on('ready', () => log.info('redis.ready'));
  return client;
}

export async function closeRedis() {
  await client?.quit().catch(() => {});
  client = null;
}
