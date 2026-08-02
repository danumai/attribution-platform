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
 * The web fallback a scan lands on when the publisher has no app registered for that
 * platform (or the scan came from a desktop). It carries no token — but it is still an
 * open redirect off our origin, so it is a pre-approved destination rather than free text:
 * rejecting every non-http(s) scheme kills `javascript:`/`data:` redirect XSS, and
 * requiring https outside localhost stops a scan being downgraded to cleartext.
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
