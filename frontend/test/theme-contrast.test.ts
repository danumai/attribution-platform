/**
 * Locks the palette against WCAG.
 *
 * The theme has one real hazard and it bit twice during design. First, `accent` is
 * legible as a button fill and illegible as text — 2.5:1 on the dark canvas — so the
 * system carries a separate `accent-text`. Second, in dark mode `card-alt` is
 * *lighter* than the canvas, so light text has less contrast on a zebra row than on
 * the page; in light mode `sunk` is the mirror-image trap. Six token values were
 * wrong until these ratios were computed rather than eyeballed.
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

/** pulls `--color-x: light-dark(#aaa, #bbb)` out of globals.css */
function token(name: string): { light: string; dark: string } {
  const m = CSS.match(
    new RegExp(
      `--color-${name}:\\s*light-dark\\(\\s*(#[0-9a-fA-F]{6})\\s*,\\s*(#[0-9a-fA-F]{6})\\s*\\)`,
    ),
  );
  assert.ok(m, `--color-${name} is not a light-dark() pair in globals.css`);
  return { light: m![1], dark: m![2] };
}

/* the checker itself has to be right before it can judge anything else */
assert.equal(Math.round(ratio('#000000', '#ffffff')), 21);
assert.equal(Math.round(ratio('#2b2825', '#2b2825')), 1);

const SURFACES = ['canvas', 'sunk', 'card', 'card-alt'] as const;
const TEXT = ['ink', 'ink-soft', 'mut', 'accent-text', 'ok', 'warn', 'bad'] as const;

for (const scheme of ['light', 'dark'] as const) {
  const surf = SURFACES.map((s) => [s, token(s)[scheme]] as const);

  for (const t of TEXT) {
    const fg = token(t)[scheme];
    for (const [sname, bg] of surf) {
      const r = ratio(fg, bg);
      assert.ok(
        r >= 4.5,
        `${scheme}/${t} ${fg} on ${sname} ${bg} = ${r.toFixed(2)}:1, needs 4.5:1`,
      );
    }
  }

  // text sitting ON the accent fill
  const on = ratio(token('accent-on')[scheme], token('accent')[scheme]);
  assert.ok(on >= 4.5, `${scheme}/accent-on = ${on.toFixed(2)}:1, needs 4.5:1`);

  // the focus ring is a non-text indicator: 3:1 against every surface it lands on
  for (const [sname, bg] of surf) {
    const r = ratio(token('ink')[scheme], bg);
    assert.ok(r >= 3, `${scheme}/focus ring on ${sname} = ${r.toFixed(2)}:1, needs 3:1`);
  }
}

console.log('theme-contrast: all token/surface pairs pass');
