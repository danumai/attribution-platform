/**
 * The pieces of non-trivial pure logic in the frontend.
 *
 * Everything else here is presentation, which a unit test would only restate. These are not:
 * `ago` carries a unit across four divisions, `samePlate` decides whether the preset picker
 * keeps its highlight, `contrastProblem` is the only thing standing between a promoter and a
 * print run of codes no scanner can read, and `ticks` and `change` are the two places a chart
 * can quietly misstate its own data — an axis that clips the tallest mark, or a delta
 * invented out of a window that never had a number in it.
 *
 * `assert`, no framework — same shape as backend/test/*.test.ts.
 */
import assert from 'node:assert/strict';
import { ago, change, num, when } from '../lib/fmt';
import { DEFAULT_STYLE, contrastProblem, samePlate } from '../lib/qr';
import { ticks } from '../lib/chart';

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

/* ---------------- ticks: the y axis a plot is drawn against ---------------- */

// A clean scale, not the data's own maximum: 205 tops out at 300 in hundreds.
assert.deepEqual(ticks(205).lines, [0, 100, 200, 300]);
assert.equal(ticks(205).top, 300);
// Every value on these axes is a count of things that happened. A quiet week must not be
// scaled against 0.5 and 1.5 — there is no such quantity of scans.
assert.deepEqual(ticks(2).lines, [0, 1, 2]);
assert.deepEqual(ticks(1).lines, [0, 1]);
// No data at all still needs an axis to draw the baseline against.
assert.deepEqual(ticks(0).lines, [0, 1]);
// The top is never below the data, or the tallest mark would run out of the plot.
for (const m of [3, 7, 9, 47, 99, 101, 1234, 98_765])
  assert.ok(ticks(m).top >= m, `axis top ${ticks(m).top} clips a max of ${m}`);

/* ---------------- change: the delta under a figure ---------------- */

// Two clean windows of three: 30 against 15 is a doubling.
assert.equal(change([5, 5, 5, 10, 10, 10], 3), 1);
assert.equal(change([10, 10, 10, 5, 5, 5], 3), -0.5);
// Not enough history for two full windows is not a zero change — it is no answer.
assert.equal(change([1, 2, 3], 2), null);
// Neither is growth from nothing: there is no percentage increase over zero, and printing
// one would dress an unknown up as a measurement.
assert.equal(change([0, 0, 4, 4], 2), null);

console.log('frontend units ok');
