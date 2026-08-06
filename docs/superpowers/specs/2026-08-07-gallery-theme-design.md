# Gallery — theme redesign

**Date:** 2026-08-07
**Scope:** `frontend/` — visual theme only, landing page through every console surface.

## Goal

Replace the current theme with one that reads premium and is recognisably not the
default palette an AI reaches for. The existing system is light-only, built on
`#4f46e5` indigo, white cards, Inter, and soft neutral shadows — which is precisely
the generic SaaS look being escaped.

The new theme is **Gallery**: a mid-dark warm grey canvas with a madder-red pigment
accent and bone type, dark by default, with a warm-grey-paper light counterpart.

## Decisions taken

| Question | Answer |
|---|---|
| Light, dark, or both | Both. Dark is the default. |
| Brand constraint | None — identity set from scratch. |
| Direction | **F — Gallery**, chosen from eight mocked directions. |
| Micro-labels | Wide-tracked caps on the landing page, sentence case in the console. |

### Why a mid-tone canvas

Every other direction considered sat on a near-black or near-white base. A mid-tone
base is the one structural advantage none of them have: surfaces are available both
**lighter and darker** than the canvas, so depth is expressed as value rather than as
shadow. The current system fakes recession with a slightly-grey `card-sunk` on a
near-white page, which barely reads at all.

## Token architecture

### Dual scheme via `light-dark()`

`:root` declares `color-scheme: light dark`, and each colour token is a single
`light-dark()` pair inside `@theme`:

```css
--color-canvas: light-dark(#E7E2DA, #2B2825);
--color-card:   light-dark(#F6F3ED, #35312C);
```

One declaration per token instead of two blocks that drift apart. Native CSS — no
class swapping, no flash of the wrong theme.

### Shadows cannot use `light-dark()`

`light-dark()` resolves to a colour, so it cannot switch a whole `box-shadow` value.
Shadows take their colour from a variable instead:

```css
--shadow-tint:    light-dark(rgb(43 40 37 / .13), rgb(0 0 0 / .40));
--shadow-contact: 0 4px 16px -4px var(--shadow-tint);
```

### Surface vocabulary

Five levels replace today's five differently-named ones. `--color-bg-deep` is dropped
and merges into `sunk` (one call site).

| New token | Replaces | Role |
|---|---|---|
| `--color-canvas` | `--color-paper` | app canvas |
| `--color-sunk` | `--color-card-sunk`, `--color-bg-deep` | recessed trough — **darker than canvas** |
| `--color-card` | `--color-card` | raised surface |
| `--color-card-alt` | `--color-card-alt` | hover / table zebra |
| `--color-card-high` | *(new)* | popovers, menus, modals |

## Palette

### The contrast rule

Text tokens are **not** checked against the canvas alone. In dark mode `card` and
`card-alt` are *lighter* than the canvas, so light text has **less** contrast on a
card than on the page — and muted text sits on cards and zebra rows constantly. In
light mode the same trap runs the other way, via `sunk`.

**Every text token must clear 4.5:1 against all four of `canvas`, `sunk`, `card` and
`card-alt` in its own scheme.** The figures below are the worst case across those
four, and that is what the test enforces.

Applying this rule during review corrected four values that passed against the canvas
and failed on `card-alt`: dark `mut` `#9E968A` → `#ADA598` (4.4 → 4.8), dark
`accent-text` `#DF8377` → `#E68C80` (4.2 → 4.7), dark `bad` `#E5786A` → `#EA887A`
(4.0 → 4.6), and light `mut` `#6B6459` → `#625B50` (4.0 on `sunk` → 4.6).

### Dark (default) — canvas `#2B2825`

| Token | Hex | Worst-case contrast |
|---|---|---|
| `sunk` | `#211E1B` | — |
| `canvas` | `#2B2825` | base |
| `card` | `#35312C` | — |
| `card-alt` | `#3D3831` | — |
| `card-high` | `#454039` | — |
| `line-soft` | `#3B3630` | — |
| `line` | `#4A443C` | — |
| `ink` | `#F2EEE7` | 11.0:1 |
| `ink-soft` | `#C8C1B6` | 6.5:1 |
| `mut` | `#ADA598` | 4.8:1 |
| `accent` (fill) | `#B04034` | fill only |
| `accent-hover` | `#C24A3D` | fill only |
| `accent-on` | `#FBF8F2` | 5.5:1 on the fill |
| `accent-text` | `#E68C80` | 4.7:1 |
| `ok` | `#8FAE7C` | 4.7:1 |
| `warn` | `#D9A441` | 5.2:1 |
| `bad` | `#EA887A` | 4.6:1 |

### Light — canvas `#E7E2DA`

| Token | Hex | Contrast |
|---|---|---|
| `sunk` | `#DCD6CC` | — |
| `canvas` | `#E7E2DA` | base |
| `card` | `#F6F3ED` | — |
| `card-alt` | `#EFEBE3` | — |
| `card-high` | `#FFFFFF` | — |
| `line-soft` | `#E0DAD1` | — |
| `line` | `#D3CCC1` | — |
| `ink` | `#2B2825` | 11.3:1 |
| `ink-soft` | `#56504A` | 6.3:1 |
| `mut` | `#625B50` | 4.6:1 |
| `accent` (fill) | `#93332A` | fill only |
| `accent-hover` | `#7E2B23` | fill only |
| `accent-on` | `#FBF8F2` | 7.2:1 on the fill |
| `accent-text` | `#93332A` | 5.3:1 |
| `ok` | `#4F7A3C` | 4.6:1 |
| `warn` | `#8A5A12` | 5.4:1 |
| `bad` | `#A83226` | 5.5:1 |

In light mode the worst case is `sunk`, the only surface darker than the canvas.

### The accent splits in two — the critical rule

Madder `#B04034` measures **2.5:1** against the dark canvas. It is legible as a button
fill with bone type on it, and illegible as text or as a chart stroke.

The system therefore carries two accent values:

- **`accent`** — fills only. Button backgrounds, meter fills, the brand mark.
- **`accent-text`** — anything drawn *on* the canvas: links, accent-coloured labels,
  the current rail item, filter chips, code tabs, chart series strokes.

In light mode both resolve to `#93332A`. In dark mode `accent-text` lightens to
`#E68C80`.

Every current `text-accent` call site (28 of them) moves to `accent-text`.

## Typography

- **Sans:** Schibsted Grotesk replaces Inter, via `next/font/google`.
- **Mono:** JetBrains Mono replaces the system mono stack, for every figure.
  This is a real cost — mono goes from free to a self-hosted webfont. Two weights
  (400, 500), latin subset only. Accepted for the sake of a consistent designed look.
- **Scale:** the existing `hero / display / title / lede / stamp` scale is good and
  stays. Only tracking relaxes slightly, since Schibsted is narrower than Inter
  (hero `-0.035em` → `-0.03em`).

### Two label tokens

The console keeps sentence-case labels, honouring the existing decision recorded at
`globals.css:56`. The landing page gets the wide-tracked caps that carry much of
Gallery's character.

| Token | Used by | Spec |
|---|---|---|
| `--text-stamp` | console (`tw.ts`) | 12px / `0` tracking / 500 / sentence case |
| `--text-stamp-caps` | landing (`lp.ts`) | 10.5px / `0.13em` / 600 / uppercase |

Named `--text-stamp-caps` rather than `--text-mark`, because `lp.ts` already exports a
`mark` class for the brand lockup and the collision would confuse.

## Geometry

Radius drops from soft-SaaS to cut edges. Pills stay fully round.

| | old | new |
|---|---|---|
| `--radius-sm` | 6px | 2px |
| `--radius-md` | 8px | 3px |
| `--radius-lg` | 12px | 4px |
| `--radius-xl` | 16px | 6px |

## Elevation

Ten shadow tokens collapse to three, because depth now comes from the five surface
values. Deleted: `shadow-key`, `shadow-key-lit`, `shadow-key-down`, `shadow-board`,
`shadow-strip`, `shadow-rules`, `shadow-lift` (22 call sites total).

| Token | Value | Used by |
|---|---|---|
| `--shadow-contact-sm` | `0 1px 2px var(--shadow-tint)` | cards, fields, buttons |
| `--shadow-contact` | `0 4px 16px -4px var(--shadow-tint)` | menus, popovers |
| `--shadow-pass` | `0 18px 48px -16px var(--shadow-tint-deep)` | modals, the landing proof panel |

`--shadow-tint-deep` is a second tint pair for the modal layer only.

## Focus

`:focus-visible` becomes a **2px ink** ring at 2px offset, replacing the accent ring.
Madder is 2.5:1 on the canvas, below the 3:1 WCAG requires of a non-text indicator.
An achromatic focus ring also suits the restraint of the direction.

## Motion

### Deleted — five removals, all one-commit reversible

| What | Where | Why |
|---|---|---|
| `shadow-key` ×3 | `globals.css`, `tw.ts`, `lp.ts` | Accent-tinted glow under buttons — the loudest generic-SaaS tell, and muddy on a mid-grey canvas. |
| `.lp-btn::after` sheen | `landing.css` | A white gleam sweeping the primary button. Reads as a shiny web button. |
| `heroGlow` | `lp.ts` | Three coloured radial washes behind the hero. Replaced by a faint vertical value shift. |
| `[data-spot]` spotlight | `landing.css`, `Spotlight.tsx` | Accent radial following the cursor. Same family of effect. |
| 4 elevation tokens | `globals.css` | `board`/`strip`/`rules`/`lift` largely duplicate each other. |

### Retained in full

The landing page's structural motion is good and is not what makes a page read as
AI-generated. Untouched: the `lp-press-land` entrance, `lp-struck` headline wipe,
scroll-linked nav progress and parallax, the coupon strip dealing itself out, the
journey waypoints, the counting figures (`@property --n`), and the FAQ stagger.
The global `prefers-reduced-motion` opt-out stays as-is.

One keyframe needs a token update: `lp-second-plate` animates `from { color:
var(--color-ink) }`, which still resolves correctly but should be re-checked against
the new ink value.

## Default scheme and the toggle

**Always dark by default, ignoring `prefers-color-scheme`.** An inline script in
`<head>` stamps `data-theme` on `<html>` before first paint (no flash), reading a
persisted `localStorage` value and falling back to `dark`. `data-theme` sets
`color-scheme`, which is what `light-dark()` resolves against.

A toggle control lives in two places: the landing nav (`lp.ts`) and the console rail
footer (`shell.tsx`).

*Assumption on record:* "dark as default" is read literally as opting out of the OS
preference. Following the OS with a dark fallback is a one-line change to the
inline script if that reading is wrong.

`viewport.themeColor` in `layout.tsx` becomes two entries, one per
`prefers-color-scheme`.

## The three spots that need judgment, not mechanical edits

### 1. Chart colours

`lib/audience.tsx:19` sets `INK = { scans: var(--color-accent), signups:
var(--color-ok) }`. A madder stroke at 2.5:1 is effectively invisible on the dark
canvas. Chart series must read from `accent-text`. `lib/chart.tsx` takes colour as a
prop and otherwise reads `--color-line`, `--color-card` and `--color-mut`, so it
follows the tokens once `INK` is corrected. `Spark`'s default of
`var(--color-accent)` (`chart.tsx:382`) needs the same change.

### 2. QR previews stay light in both schemes

A QR preview is a proof of a physical printed artifact, and the `Cutout` preset
renders with `light: '#0000'` — transparent. On a dark plate that is an unscannable
code and a misleading preview.

`qrbox` (`tw.ts`) and the transparency checkerboard
(`app/campaigns/[id]/page.tsx:384`, currently `#eeeeee`/`#fff`) therefore keep a light
plate in both schemes, the way a design tool holds its canvas white. The surrounding
studio chrome themes normally.

**`lib/qr.ts` is not touched.** Its hex values are merchant-chosen style presets for
their own printed codes — product data, not theme. A future reader must not "fix"
them for consistency.

### 3. The mobile scrim

`lib/shell.tsx:143` hardcodes `color-mix(in srgb, #0d1117 45%, transparent)`. It
becomes a token so it darkens correctly in both schemes.

## Files changed

14 files reference theme tokens directly; the table below adds three more that change
for other reasons (the deleted `Spotlight.tsx` and the two brand-mark files), for 17
in total. Grep confirms **zero** raw Tailwind palette utilities (`bg-slate-800`,
`text-indigo-600`, …) anywhere in `app/` or `lib/` — everything already routes through
semantic tokens, which is why the tail is small.

| File | Change |
|---|---|
| `app/globals.css` | Rewrite `@theme`: `light-dark()` colours, shadow tints, radii, two label tokens, focus ring, `color-scheme`. |
| `app/layout.tsx` | Schibsted Grotesk + JetBrains Mono; per-scheme `themeColor`; pre-paint theme script; `bg-paper` → `bg-canvas`. |
| `lib/tw.ts` | `text-accent` → `text-accent-text`; surface renames; shadow renames; `card-high` for `menuPop`; light `qrbox` plate. |
| `lib/lp.ts` | Remove `heroGlow` and the `lp-btn` hook; `--text-stamp-caps` labels; nav and `passShell` surfaces; theme toggle. |
| `app/landing/landing.css` | Delete `[data-spot]` and `.lp-btn::after` blocks; range track colours; re-check `lp-second-plate`. |
| `lib/shell.tsx` | Scrim token; rail current item → `accent-text`; theme toggle. |
| `lib/ui.tsx` | Modal and popover surfaces → `card-high`. |
| `lib/audience.tsx` | `INK` → `accent-text`. |
| `lib/chart.tsx` | `Spark` default colour → `accent-text`. |
| `lib/pass.tsx` | Surface and shadow tokens. |
| `app/landing/ActivityBoard.tsx` | Surface and shadow tokens. |
| `app/landing/Spotlight.tsx` | Deleted along with `[data-spot]`. |
| `app/campaigns/[id]/page.tsx` | Theme-independent checkerboard and QR plate. |
| `app/login/page.tsx`, `app/admin/page.tsx` | Token renames only. |
| `app/icon.svg`, `lib/mark.tsx` | Mark recoloured to Gallery values. |

The remaining pages — `dashboard`, `publisher-sim`, `campaign-ended`, `not-found`,
`error` — inherit the theme through `tw.ts` and need no edits.

Mechanical edit count: 28 `text-accent`, 15 surface renames, 22 shadow tokens ≈ 65.

## Verification

The accent split is the failure most likely to ship broken and to regress silently
later, so it gets one runnable check.

**`frontend/test/theme-contrast.test.ts`** — parses the `light-dark()` pairs out of
`app/globals.css` and asserts, for both schemes:

- every text token (`ink`, `ink-soft`, `mut`, `accent-text`, `ok`, `warn`, `bad`)
  clears **4.5:1** against **all four** of `canvas`, `sunk`, `card` and `card-alt`;
- `accent-on` clears 4.5:1 against `accent`;
- the focus ring and every non-text indicator clears **3:1**.

Plain `assert`, no framework, no fixtures, run by the existing `npm run test:unit`.
It fails loudly if anyone later "simplifies" `accent-text` back to `accent`.

Write this test **first**, before editing `globals.css`. The four-surface rule already
forced four colour corrections during design review; expect it to force one or two
more small adjustments once it runs against real values, and treat that as the test
working rather than as a problem. Where a value must move, lighten (dark) or darken
(light) the token rather than changing its hue — the palette's character lives in the
hues, not the exact luminance.

Then a manual visual pass over both schemes on: landing, login, dashboard, campaign
detail (including the QR studio), admin, publisher-sim, campaign-ended, not-found,
error.

## Out of scope

No layout changes, no component restructuring, no copy changes, no changes to
`lib/qr.ts` preset data. Theme only.
