// Self-check for the security primitives that have no DB dependency.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { ipHash, rateLimited, validateLandingUrl } from '../src/common/security';

// The iOS match only works if the socket-derived address and the string the publisher's
// server reports hash identically. Every case below is a real spelling mismatch that would
// otherwise silently drop the attribution rate to zero.
assert.equal(ipHash('::ffff:203.0.113.7'), ipHash('203.0.113.7'), 'IPv4-mapped IPv6 must match plain IPv4');
assert.equal(ipHash('2001:0db8:0000:0000:0000:0000:0000:0001'), ipHash('2001:db8::1'), 'IPv6 must be canonicalised');
assert.equal(ipHash('2001:DB8::1'), ipHash('2001:db8::1'), 'IPv6 is case-insensitive');
assert.equal(ipHash(' 203.0.113.7 '), ipHash('203.0.113.7'), 'surrounding whitespace must not matter');
// ...and distinct addresses must still be distinct, loopback included.
assert.notEqual(ipHash('::1'), ipHash('127.0.0.1'));
assert.notEqual(ipHash('203.0.113.7'), ipHash('203.0.113.8'));
assert.equal(ipHash('garbage').length, 16, 'an unparseable address is still hashed, not dropped');

// --- landing URL: the one place we hand a scan token to an outside origin ---
for (const bad of [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'http://evil.example.com/steal', // cleartext off-localhost would leak the token
  'https://user:pw@evil.example.com', // embedded credentials
  'not a url',
  '//evil.example.com',
])
  assert.throws(() => validateLandingUrl(bad), `should reject ${bad}`);

for (const ok of [
  'https://publisher.example.com/claim',
  'http://localhost:3000/publisher-sim',
  'http://127.0.0.1:3000/x',
])
  assert.equal(typeof validateLandingUrl(ok), 'string', `should accept ${ok}`);

assert.equal(validateLandingUrl(undefined), null); // absent means "leave unchanged"
assert.equal(validateLandingUrl(''), null);
assert.throws(() => validateLandingUrl(42 as unknown as string));

// --- rate limiter: allows exactly `max` in a window, then blocks ---
const key = `test-${Math.random()}`;
for (let i = 0; i < 3; i++) assert.equal(rateLimited(key, 3), false, `hit ${i} should pass`);
assert.equal(rateLimited(key, 3), true, '4th hit should be limited');
assert.equal(rateLimited(`other-${Math.random()}`, 3), false, 'buckets are per-key');

// window expiry
const k2 = `test-${Math.random()}`;
assert.equal(rateLimited(k2, 1, 1), false);
assert.equal(rateLimited(k2, 1, 1), true);
// --- production config guards: each of these is a silent prod outage or auth bypass ---
// config.ts validates at import time, so each case needs its own process.
function prodBootError(env: Record<string, string>): string {
  const base = {
    NODE_ENV: 'production',
    BASE_URL: 'https://api.example.com',
    FRONTEND_URL: 'https://app.example.com',
    JWT_SECRET: 'a-real-secret',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'a-long-enough-password',
    DATABASE_URL: 'postgres://u:p@db.example.com:5432/qrreward',
  };
  const r = spawnSync(
    process.execPath,
    [
      '-r',
      'ts-node/register',
      '-e',
      "require('./src/config'); require('./src/modules/auth/tokens'); require('./src/database/prisma')",
    ],
    { cwd: join(__dirname, '..'), env: { ...process.env, ...base, ...env }, encoding: 'utf8' },
  );
  return r.status === 0 ? '' : r.stderr;
}

assert.equal(prodBootError({}), '', 'a fully-configured production env should import cleanly');
assert.match(prodBootError({ BASE_URL: 'http://api.example.com' }), /must use https/,
  'cleartext BASE_URL would print QR codes that leak scan tokens');
assert.match(prodBootError({ FRONTEND_URL: 'http://app.example.com' }), /must use https/);
assert.match(prodBootError({ JWT_SECRET: 'dev-secret-change-me' }), /JWT_SECRET/,
  'the default signing secret is a total auth bypass');
assert.match(prodBootError({ ADMIN_PASSWORD: 'short' }), /at least 12/);
assert.match(prodBootError({ ADMIN_EMAIL: '' }), /ADMIN_EMAIL must be set in production/);
assert.match(prodBootError({ BASE_URL: '' }), /BASE_URL must be set in production/,
  'without BASE_URL every printed QR would point at localhost');
assert.match(prodBootError({ DATABASE_URL: '' }), /DATABASE_URL must be set in production/,
  'the dev fallback would point a production deploy at a localhost database');

setTimeout(() => {
  assert.equal(rateLimited(k2, 1, 1), false, 'window should reset');
  console.log('security self-check passed');
  process.exit(0);
}, 5);
