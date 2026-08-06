/**
 * The shared counter store, and the only thing this deployment uses Redis for.
 *
 * Optional by design: unset `REDIS_URL` and the process keeps its in-process rate limiter,
 * which is correct for a single instance and is how the stack runs locally. Set it and every
 * replica counts against the same window — which is the actual prerequisite for running more
 * than one, because the limits are security controls rather than tuning knobs.
 *
 * Nothing here is a cache. There is no read path that falls back to Redis, so a cold or missing
 * Redis costs throttling accuracy and nothing else — no correctness, no money, no data.
 */
import Redis from 'ioredis';
import { REDIS_URL } from '../config';
import { log } from '../common/obs';

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!REDIS_URL) return null;
  if (client) return client;
  client = new Redis(REDIS_URL, {
    // Fail fast and let the caller fall back to the local window. The default retries a
    // command forever, which on the scan hot path means requests piling up behind a dead
    // Redis instead of being served slightly less strictly.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    // Exponential-ish backoff, capped: a reconnect storm against a recovering Redis is how a
    // brief blip becomes a long one.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  // An 'error' event with no listener is an unhandled exception that takes the process down —
  // and a rate limiter must never be able to kill the API it protects.
  client.on('error', (e) => log.warn('redis.error', { error: e.message }));
  client.on('ready', () => log.info('redis.ready'));
  return client;
}

export async function closeRedis() {
  await client?.quit().catch(() => {});
  client = null;
}
