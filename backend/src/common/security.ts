import { BadRequestException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { getRedis } from '../config/redis';
import { count, log } from './obs';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Fixed window: Redis when `REDIS_URL` is set, else in-process — which multiplies every per-IP
// security control here by the replica count. See REDIS_URL in config.ts.
const buckets = new Map<string, { n: number; reset: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref(); // bounded memory, swept off the hot path

function localRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  return ++b.n > max;
}

// `INCR` then `PEXPIRE` on first hit: atomic without Lua because `INCR` is both read and write.
// Pipelined rather than two round trips — this runs on the scan hot path.
async function redisRateLimited(
  redis: Redis,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const res = await redis.pipeline().incr(key).pexpire(key, windowMs, 'NX').exec();
  // `exec()` reports failures as *data* and returns `null` when the connection is gone; unchecked,
  // `undefined > 300` is `false`, so a dead Redis silently stops limiting anything.
  const [err, n] = res?.[0] ?? [new Error('redis connection unavailable'), null];
  if (err || typeof n !== 'number') throw err ?? new Error('redis returned no count');
  return n > max;
}

/** Counting is best-effort; refusing to serve because the counter is unreachable is not. A Redis
 *  outage degrades to per-instance limits — warned, because it weakens a security control. */
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

/** Blanket per-IP floor beneath the tuned limits (login, signup, scan, partner key), so a route
 *  added later is never accidentally unlimited. Keyed on IP, not session: an attacker without a
 *  valid token is the one to slow down and has no session to key on. */
export async function globalRateLimit(req: Request, res: Response, next: NextFunction) {
  // Never throttle these: a 429ed health check turns a spike into a pulled-from-rotation outage,
  // and a 429ed metrics scrape blinds monitoring at the worst moment.
  if (req.path === '/healthz' || req.path === '/metrics') return next();
  if (await rateLimited(`global:${clientIp(req)}`, 300)) {
    count('rate_limited_total', { limit: 'global' });
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ statusCode: 429, message: 'too many requests' });
  }
  next();
}

/** A bounded string from an untrusted body. Rejects rather than truncates: a `publisher_user_ref`
 *  silently cut to 200 chars would collide with another user's ref and misroute attribution. */
export function str(v: unknown, name: string, max: number, required = true): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadRequestException(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new BadRequestException(`${name} must be a string`);
  // Reject NUL here: Postgres cannot store it in text and would reject mid-transaction.
  if (v.includes('\0')) throw new BadRequestException(`${name} must not contain null bytes`);
  if (v.length > max)
    throw new BadRequestException(`${name} must be ${max} characters or fewer`);
  return v;
}

/** Fingerprint key for one device, hashed so no raw address is stored. Canonicalised first because
 *  both halves of the iOS match spell one address differently — socket `::ffff:203.0.113.7` vs the
 *  publisher's `203.0.113.7` — and hashing raw strings hides that as 0% attribution, no error. */
export function ipHash(ip: string): string {
  let v = ip.trim().toLowerCase();
  // IPv4-mapped IPv6, what a dual-stack socket reports for a plain IPv4 client.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) v = mapped[1];
  // Collapse IPv6 spellings (`2001:db8::1` == `2001:0db8:0:0:0:0:0:1`) to the canonical compressed
  // form; the WHATWG URL parser already does it, so no address maths here.
  if (v.includes(':'))
    try {
      v = new URL(`http://[${v}]`).hostname.replace(/^\[|\]$/g, '');
    } catch {
      /* unparseable — hash as-is rather than drop the signal */
    }
  return sha256(v).slice(0, 16);
}

const isLocal = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');

// Pre-approved rather than free text because this is an open redirect off our origin: non-http(s)
// would allow `javascript:`/`data:` redirect XSS, and https outside localhost stops a cleartext
// downgrade and is what makes App Links and Universal Links work at all.
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

/** `default-src 'none'` + nosniff is what makes the QR image endpoint safe: it renders
 *  attacker-supplied SVG (logo data URLs) from our own origin, and these stop that SVG executing
 *  script when loaded directly. `no-referrer` keeps scan URLs out of onward Referer headers. */
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
