/**
 * The three pieces of non-trivial pure logic in the frontend.
 *
 * Everything else here is presentation, which a unit test would only restate. These three are
 * not: `ago` carries a unit across four divisions, `samePlate` decides whether the preset
 * picker keeps its highlight, and `contrastProblem` is the only thing standing between a
 * promoter and a print run of codes no scanner can read.
 *
 * `assert`, no framework — same shape as backend/test/*.test.ts.
 */
import assert from 'node:assert/strict';
import { ago, num, when } from '../lib/fmt';
import { DEFAULT_STYLE, contrastProblem, samePlate } from '../lib/qr';

/* ---------------- ago ---------------- */

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();

assert.equal(ago(null), '—');
assert.equal(ago(undefined), '—');
assert.equal(ago(secondsAgo(5)), '5s ago');
// The carry: 90s is a minute and a half, not "90s ago".
assert.equal(ago(secondsAgo(90)), '2m ago');
assert.equal(ago(secondsAgo(3600)), '1h ago');
assert.equal(ago(secondsAgo(86_400)), '1d ago');
// Past a week it stops counting and prints the absolute stamp instead.
const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
assert.equal(ago(old), when(old));

assert.equal(num(null), '0');
assert.equal(num(1234), (1234).toLocaleString());

/* ---------------- samePlate ---------------- */

assert.equal(samePlate(DEFAULT_STYLE, { ...DEFAULT_STYLE }), true);
// Size, ecc and logo are the promoter's, not the preset's — changing them must not clear
// the picker's highlight.
assert.equal(samePlate(DEFAULT_STYLE, { ...DEFAULT_STYLE, size: 2048, ecc: 'H' }), true);
assert.equal(samePlate(DEFAULT_STYLE, { ...DEFAULT_STYLE, logo: 'data:image/png;base64,x' }), true);
// A key the preset does own is a different plate.
assert.equal(samePlate(DEFAULT_STYLE, { ...DEFAULT_STYLE, dark: '#ff0000' }), false);
assert.equal(samePlate(DEFAULT_STYLE, { ...DEFAULT_STYLE, shape: 'dots' }), false);
// An absent key and an explicitly-null one are the same plate; both mean "no gradient".
assert.equal(samePlate({ gradient: null }, {}), true);
assert.equal(samePlate({ gradient: { from: '#000', to: '#fff' } }, {}), false);

/* ---------------- contrastProblem ---------------- */

// Black on white is the whole point of a QR code.
assert.equal(contrastProblem({ dark: '#000000', light: '#ffffff' }), null);
// Pale ink on white is what a promoter reaches for when they want it to match the artwork,
// and it is exactly the print run that comes back unscannable.
assert.match(String(contrastProblem({ dark: '#dddddd', light: '#ffffff' })), /module colour/);
// A gradient is two inks, and either end failing is enough.
assert.match(
  String(contrastProblem({ gradient: { from: '#111111', to: '#eeeeee' }, light: '#ffffff' })),
  /gradient end/,
);
assert.equal(
  contrastProblem({ gradient: { from: '#111111', to: '#222222' }, light: '#ffffff' }),
  null,
);
// The eyes are checked separately: they can be tinted while the modules stay dark.
assert.match(
  String(contrastProblem({ dark: '#000000', eyeColor: '#f2f2f2', light: '#ffffff' })),
  /eye colour/,
);
// A transparent background cannot be judged — whatever it prints on decides, so say nothing
// rather than warn about a contrast that does not exist yet.
assert.equal(contrastProblem({ dark: '#eeeeee', light: 'transparent' }), null);

console.log('frontend units ok');
