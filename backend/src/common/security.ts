import { BadRequestException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { getRedis } from '../database/redis';
import { count, log } from './obs';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- rate limiting ----------
/**
 * A fixed window, counted in Redis when `REDIS_URL` is set and in this process when it is not.
 *
 * Every per-IP control here is a *security* control, so an in-process counter multiplies each
 * of them by the replica count — two instances means twice the login attempts before anyone is
 * throttled. In-process is correct for exactly one instance; see REDIS_URL in config.ts.
 */
const buckets = new Map<string, { n: number; reset: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref(); // bounded memory: expired keys swept once a minute, never on the hot path

function localRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  return ++b.n > max;
}

/**
 * `INCR` then `PEXPIRE` on the first hit of a window — the standard fixed-window counter, and
 * atomic without a Lua script because `INCR` is itself the read and the write.
 *
 * A pipeline rather than two round trips: this runs on the scan hot path, and the second call
 * would otherwise double the latency this adds.
 */
async function redisRateLimited(
  redis: Redis,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const res = await redis.pipeline().incr(key).pexpire(key, windowMs, 'NX').exec();
  // `exec()` reports a failed command as *data* — a `[error, result]` tuple — and returns
  // `null` outright when the connection is gone. Unchecked, `undefined > 300` is `false`, so a
  // dead Redis silently stops limiting anything. Throw so the caller's fallback runs.
  const [err, n] = res?.[0] ?? [new Error('redis connection unavailable'), null];
  if (err || typeof n !== 'number') throw err ?? new Error('redis returned no count');
  return n > max;
}

/**
 * Counting is best-effort; refusing to serve because the counter is unreachable is not. On a
 * Redis outage this falls back to the in-process window rather than failing open — degraded to
 * per-instance limits, which is what the deployment had before Redis existed, instead of no
 * limits at all. The log line is warn because it silently weakens a security control.
 */
export async function rateLimited(key: string, max: number, windowMs = 60_000): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return localRateLimited(key, max, windowMs);
  try {
    return await redisRateLimited(redis, key, max, windowMs);
  } catch (e: any) {
    log.warn('ratelimit.redis_unavailable', { error: e?.message });
    return localRateLimited(key, max, windowMs);
  }
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

/**
 * A blanket per-IP ceiling under every route, including the authenticated ones.
 *
 * The specific limits (login, signup, scan, partner key) are the ones tuned to their path;
 * this is the floor beneath all of them, so a route added later is never accidentally
 * unlimited. It sits high enough that a dashboard loading a dozen panels never notices, and
 * low enough that scraping or credential stuffing from one address runs out of room.
 *
 * Deliberately keyed on IP alone rather than on the session: an attacker without a valid
 * token is exactly the one to slow down, and they have no session to key on.
 */
export async function globalRateLimit(req: Request, res: Response, next: NextFunction) {
  // Health checks are what the load balancer uses to decide this process is alive. Throttling
  // them would turn a traffic spike into a pulled-from-rotation outage. Metrics likewise: a
  // scrape that gets 429ed blinds the monitoring exactly when the traffic is interesting.
  if (req.path === '/healthz' || req.path === '/metrics') return next();
  if (await rateLimited(`global:${clientIp(req)}`, 300)) {
    count('rate_limited_total', { limit: 'global' });
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ statusCode: 429, message: 'too many requests' });
  }
  next();
}

/**
 * A bounded string from an untrusted body.
 *
 * Every free-text field crossing a trust boundary needs a ceiling, or it becomes a cheap way
 * to bloat a row, a log line and an index entry at once. Rejecting loudly beats truncating
 * silently: a `publisher_user_ref` quietly cut to 200 chars would collide with a different
 * user's ref and hand one user's attribution to another.
 */
export function str(v: unknown, name: string, max: number, required = true): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadRequestException(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new BadRequestException(`${name} must be a string`);
  // Reject NUL outright — Postgres cannot store it in a text column and rejects mid-transaction.
  if (v.includes('\0')) throw new BadRequestException(`${name} must not contain null bytes`);
  if (v.length > max)
    throw new BadRequestException(`${name} must be ${max} characters or fewer`);
  return v;
}

/**
 * The fingerprint key for one device, hashed so no raw address is ever stored.
 *
 * Both halves of the iOS match go through here, and that is the whole point: the scan side
 * gets its address from the socket, the claim side gets it as a string from the publisher's
 * own server, and the two spell the same address differently. A dual-stack listener reports
 * every IPv4 client as `::ffff:203.0.113.7`, while the publisher sends `203.0.113.7`; IPv6
 * is worse, since `2001:db8::1` and `2001:0db8:0:0:0:0:0:1` are the same host. Hashing the
 * raw strings makes those mismatches invisible — no error, just an attribution rate of zero.
 */
export function ipHash(ip: string): string {
  let v = ip.trim().toLowerCase();
  // IPv4-mapped IPv6 — what a dual-stack socket reports for a plain IPv4 client.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) v = mapped[1];
  // Collapse the many spellings of one IPv6 address to the canonical compressed form. The
  // WHATWG URL parser already implements exactly that, so there is no address maths here.
  if (v.includes(':'))
    try {
      v = new URL(`http://[${v}]`).hostname.replace(/^\[|\]$/g, '');
    } catch {
      /* not a parseable IPv6 literal — hash it as-is rather than dropping the signal */
    }
  return sha256(v).slice(0, 16);
}

// ---------- redirect destinations ----------
const isLocal = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');

/**
 * A publisher-registered URL a scan can be redirected to. It carries no token — but it is
 * still an open redirect off our origin, so it is a pre-approved destination rather than free
 * text: rejecting every non-http(s) scheme kills `javascript:`/`data:` redirect XSS, and
 * requiring https outside localhost stops a scan being downgraded to cleartext.
 *
 * Shared by `landing_url` (the web fallback) and `deeplink_url` (where an engagement scan is
 * sent so the OS can open the app). https is also what makes the second work at all — App
 * Links and Universal Links are only claimed on https origins.
 */
function validateRedirectUrl(raw: unknown, name: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException(`${name} must be a string`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException(`${name} must be an absolute URL`);
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(u.hostname)))
    throw new BadRequestException(`${name} must use https (http allowed only for localhost)`);
  if (u.username || u.password)
    throw new BadRequestException(`${name} must not embed credentials`);
  return u.toString();
}

export const validateLandingUrl = (raw: unknown) => validateRedirectUrl(raw, 'landing_url');
export const validateDeeplinkUrl = (raw: unknown) => validateRedirectUrl(raw, 'deeplink_url');

// ---------- response headers ----------
/**
 * `default-src 'none'` is what makes the QR image endpoint safe: it renders attacker-supplied
 * SVG (logo data URLs) from our own origin, and CSP + nosniff stop that SVG executing script
 * when loaded directly. `no-referrer` keeps our scan URLs out of onward Referer headers, so
 * a store listing never learns which code sent the visitor.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader('X-Powered-By');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (process.env.NODE_ENV === 'production')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
