import { BadRequestException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { createHash } from 'crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- rate limiting ----------
// ponytail: in-process fixed window. Swap for a Redis sliding window once >1 instance runs.
const buckets = new Map<string, { n: number; reset: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref(); // bounded memory: expired keys swept once a minute, never on the hot path

export function rateLimited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  return ++b.n > max;
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

// ---------- redirect destinations ----------
const isLocal = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');

/**
 * Publisher landing URLs are the one place we hand a scan token to an outside origin,
 * so they are a pre-approved destination, not free text (Epic 17). Rejecting every
 * non-http(s) scheme kills `javascript:`/`data:` redirect XSS; requiring https outside
 * localhost stops the token being exfiltrated in cleartext.
 */
export function validateLandingUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequestException('landing_url must be a string');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException('landing_url must be an absolute URL');
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(u.hostname)))
    throw new BadRequestException('landing_url must use https (http allowed only for localhost)');
  if (u.username || u.password)
    throw new BadRequestException('landing_url must not embed credentials');
  return u.toString();
}

// ---------- response headers ----------
/**
 * `default-src 'none'` is what makes the QR image endpoint safe: it renders attacker-supplied
 * SVG (logo data URLs) from our own origin, and CSP + nosniff stop that SVG executing script
 * when loaded directly. `no-referrer` keeps scan tokens out of onward Referer headers.
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
