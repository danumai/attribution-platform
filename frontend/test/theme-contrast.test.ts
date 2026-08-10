/**
 * Locks the palette against WCAG.
 *
 * The theme has one real hazard: `accent` is legible as a button fill and illegible
 * as anything else — the pastel pink measures 1.44:1 against the canvas — so the
 * system carries a separate `accent-text` for type, strokes and icons. Collapsing the
 * two back into one token is the easiest way to ship this palette inaccessible.
 *
 * The second trap is that `sunk` is darker than the canvas, so dark text has *less*
 * contrast in a recessed well than on the page. It, not the canvas, is the worst case
 * for every text token, and `mut` was wrong until that was computed rather than
 * eyeballed (#6E6960 measures 4.04:1 there).
 *
 * Hence: every text token is checked against every surface it can land on, not just
 * the canvas.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** relative luminance, per WCAG 2.1 */
function lum(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** pulls `--color-x: #aabbcc` out of globals.css */
function token(name: string): string {
  const m = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(m, `--color-${name} is not a plain hex value in globals.css`);
  return m![1];
}

/* the checker itself has to be right before it can judge anything else */
assert.equal(Math.round(ratio('#000000', '#ffffff')), 21);
assert.equal(Math.round(ratio('#ECE9E4', '#ECE9E4')), 1);

const SURFACES = ['canvas', 'sunk', 'card', 'card-alt', 'card-high'] as const;
const TEXT = ['ink', 'ink-soft', 'mut', 'accent-text', 'ok', 'warn', 'bad'] as const;

const surf = SURFACES.map((s) => [s, token(s)] as const);

for (const t of TEXT) {
  const fg = token(t);
  for (const [sname, bg] of surf) {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${t} ${fg} on ${sname} ${bg} = ${r.toFixed(2)}:1, needs 4.5:1`);
  }
}

// text sitting ON the accent fill, and on the hover state it changes to under the cursor
for (const fill of ['accent', 'accent-hover'] as const) {
  const on = ratio(token('accent-on'), token(fill));
  assert.ok(on >= 4.5, `accent-on over ${fill} = ${on.toFixed(2)}:1, needs 4.5:1`);
}

// text on the tinted panel, which is a surface in everything but name
for (const t of ['ink', 'accent-text'] as const) {
  const r = ratio(token(t), token('accent-soft'));
  assert.ok(r >= 4.5, `${t} on accent-soft = ${r.toFixed(2)}:1, needs 4.5:1`);
}

// the focus ring is a non-text indicator: 3:1 against every surface it lands on
for (const [sname, bg] of surf) {
  const r = ratio(token('ink'), bg);
  assert.ok(r >= 3, `focus ring on ${sname} = ${r.toFixed(2)}:1, needs 3:1`);
}

/* The split that keeps this palette honest. `accent` is pastel and must stay a fill;
   if someone ever "simplifies" accent-text to equal it, this fails rather than
   silently shipping 1.44:1 type. */
assert.notEqual(token('accent'), token('accent-text'), 'accent must stay a fill-only token');
assert.ok(
  ratio(token('accent'), token('canvas')) < 3,
  'accent now clears 3:1 on canvas — re-check whether the fill/text split is still needed',
);

console.log('theme-contrast: all token/surface pairs pass');
