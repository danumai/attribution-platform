# Design: retheme the frontend from Gallery to Frankly

**Date:** 2026-08-09
**Status:** approved, ready for planning

## Goal

Replace the current "Gallery" design system (dark-by-default mid-tone warm grey,
madder-red accent, 2–6px cut edges) with a system derived from
<https://franklyinsure.com/en>: light-only warm limestone surfaces, a pastel pink
accent, soft 8–24px radii, hairline borders, and near-flat elevation.

Values below were extracted from the live site's stylesheets
(`/css/frankly-staging-1-4e49ffc8dac886c1bc1c8.webflow.css`, `/css/app.css`) and its
GSAP bundle (`/js/wf-embeds-body.js`), not estimated from screenshots.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Scope | Full re-skin, light-only. The dark scheme and its toggle are removed. |
| Typography | **Unchanged.** Keep Schibsted Grotesk + JetBrains Mono. Frankly's Switzer is Fontshare-only and Almarena Neue Display is a paid Zetafonts licence; Schibsted Grotesk is already wired via `next/font` and is a close neutral grotesk. |
| Accent as text | Fills stay Frankly-exact pastel pink; `accent-text` becomes a derived deep rose so the 25 `text-accent-text` sites and the chart stroke stay readable. |
| Animation library | **No GSAP.** The landing page already reproduces Frankly's reveals, stagger and parallax natively via `animation-timeline: view()/scroll()`. Retune curves and durations only. |

## 1. Palette

All tokens become single hex values — `light-dark()` is removed throughout.

### Surfaces

The five-level surface structure is preserved: `sunk` is darker than `canvas`, cards
are lighter. All four of Frankly's limestone primitives are used.

| token | value | Frankly source |
|---|---|---|
| `--color-sunk` | `#E3DDD5` | limestone-40 |
| `--color-canvas` | `#ECE9E4` | limestone-30 |
| `--color-card` | `#F5F4F1` | limestone-10 |
| `--color-card-alt` | `#F0EEE9` | limestone-20 |
| `--color-card-high` | `#FFFFFF` | base white |

### Edges

Frankly's border is `#1111111a` (10% black) at 1px. Flattened to solid hex so the
contrast test can parse it:

| token | value |
|---|---|
| `--color-line` | `#D8D4CD` |
| `--color-line-soft` | `#E6E2DC` |

### Text

| token | value |
|---|---|
| `--color-ink` | `#111111` |
| `--color-ink-soft` | `#55504A` |
| `--color-mut` | `#635E56` |

`mut` is `#635E56`, not the more obvious `#6E6960`: the latter measures 4.04:1 on
`sunk` and fails. This was computed, not eyeballed.

### Accent

The existing fill/text split is kept — it maps onto Frankly's own usage exactly,
where pink is a block colour and never a text colour.

| token | value | note |
|---|---|---|
| `--color-accent` | `#FFACCA` | pink-30; fill only |
| `--color-accent-hover` | `#FF97BC` | derived |
| `--color-accent-on` | `#111111` | matches Frankly's `.button { color: #111 }` |
| `--color-accent-text` | `#9E1247` | derived deep rose, for text/stroke/icons |
| `--color-accent-soft` | `#FFD3E3` | pink-10 |
| `--color-accent-line` | `#F3DEE4` | pink-20 |

### Semantic and scrim

`ok`, `warn`, `bad` and their `-soft`/`-line` variants keep their **current
light-mode values** (`#3F6230`, `#7E520F`, `#A83226`, etc.). They are already tuned
for a warm light canvas and already pass. Only the dark half of each pair is dropped.

`--color-scrim` becomes `rgb(17 17 17 / .42)`.

### Verified contrast

Every text token against every surface it can land on. Worst case is always `sunk`,
the darkest surface:

| token | worst ratio | verdict |
|---|---|---|
| `ink` | 14.00 | pass |
| `ink-soft` | 5.91 | pass |
| `mut` | 4.77 | pass |
| `accent-text` | 5.92 | pass |
| `ok` | 5.19 | pass |
| `warn` | 5.02 | pass |
| `bad` | 4.94 | pass |

Fill pairs: `accent-on` on `accent` = **10.80**; on `accent-hover` = **9.36**;
`ink` on `accent-soft` = 14.10; `accent-text` on `accent-soft` = 5.96.

### Known limitation (inherited from the source)

`accent` against `canvas` is **1.44:1**. A primary button's *outline* is therefore
nearly invisible against the page — its label is not, at 10.80:1. Frankly has the
same property and mitigates it with `border: 1px solid <pink-30>` on the fill.
We copy that mitigation. This is accepted, not overlooked.

Focus rings continue to use `ink`, unchanged — `accent` at 1.44:1 is far below the
3:1 a non-text indicator requires.

## 2. Geometry and elevation

Radii move from cut edges to Frankly's soft corners. Frankly ships three
(`.5rem` / `1rem` / `1.5rem`); a 12px step is interpolated for the existing
four-token scale.

| token | from | to |
|---|---|---|
| `--radius-sm` | 2px | 8px |
| `--radius-md` | 3px | 12px |
| `--radius-lg` | 4px | 16px |
| `--radius-xl` | 6px | 24px |

Elevation flattens; depth is carried by hairline borders and surface value instead.

| token | from | to |
|---|---|---|
| `--shadow-tint` | `rgb(43 40 37 / .13)` | `rgb(17 17 17 / .05)` |
| `--shadow-tint-deep` | `rgb(43 40 37 / .22)` | `rgb(17 17 17 / .10)` |

The three composed shadows (`--shadow-contact-sm`, `--shadow-contact`,
`--shadow-pass`) keep their geometry and pick up the new tints.

## 3. Motion

Frankly drives motion with GSAP + ScrollTrigger + SplitText + Draggable/Inertia.
Its measured parameters are `power3.out` / `power2.out`, durations 0.4–0.8s,
`stagger: 0.1`, y offsets 10–20px, and `scrub: 2` on scroll-linked parallax; the one
custom curve in its CSS is `cubic-bezier(.625, .05, 0, 1)`.

`app/landing/landing.css` already produces this behaviour natively — scroll reveals,
per-item stagger, parallax, animated counters, clip-path wipes — with no JS. The
existing `--ease-out: cubic-bezier(.16, 1, .3, 1)` is already an expo-out curve very
close to `power3.out`. **No animation library is added.**

Changes:

1. Add `--ease-drift: cubic-bezier(.625, .05, 0, 1)` and use it for the scroll-linked
   moves (`lp-parallax-pass`, `lp-nav-set`, `lp-feed`).
2. Lengthen generic reveals from `0.5s`/`0.6s` to `0.65s`, matching Frankly's
   measured duration.
3. Normalise reveal stagger steps to `0.1s`.
4. Standardise pointer-level transitions to `0.2s`, matching Frankly's
   `transition: all .2s`.
5. Remove `filter: blur(...)` from `lp-enter-rise`, `lp-arrive` and `lp-press-land`.
   Frankly never blurs, and blur over pastel limestone reads as muddy.

Explicitly **not** replicated, and why:

- `scrub: 2` — ScrollTrigger's smoothed/lagging scroll follow. CSS
  `animation-timeline: scroll()` is instantaneous; reproducing the lag needs JS.
- SplitText per-line headline reveals. The existing `lp-struck` clip-path wipe is
  the same effect family and already ships.

The `prefers-reduced-motion` global opt-out in `globals.css` is unchanged.

## 4. Removing the dark scheme

| file | change |
|---|---|
| `app/globals.css` | Unwrap every `light-dark(a, b)` to its light value. Replace the three `:root` scheme rules with a single `:root { color-scheme: light; }`. |
| `lib/theme.tsx` | Delete `ThemeToggle` (and the file, if nothing else lives there). |
| `app/layout.tsx` | Remove the inline `BOOT` script and its `<head>`/`<script>` wrapper. Collapse `viewport.themeColor` to the single value `#ECE9E4`. |
| `app/landing/Landing.tsx` | Remove the `ThemeToggle` from the nav (reverts the toggle added in `2b8dbb5`). |
| `lib/shell.tsx` | Remove the `ThemeToggle` from the console chrome. |
| `test/theme-contrast.test.ts` | Rewrite `token()` to match `--color-x: #RRGGBB` instead of a `light-dark()` pair. Drop the dark-mode `card-alt` trap assertions; keep the light-mode `sunk` trap and the `accent` vs `accent-text` split assertion. |

Component TSX is otherwise untouched. Every visual change lands in `@theme` tokens
and in `landing.css`, so `lib/tw.ts`, `lib/lp.ts` and the page components inherit it
without edits.

## Follow-on found during implementation

Changing `accent` from a 2.5:1 red to a 1.44:1 pastel broke six places that were
using it as an *indicator* rather than a fill. Grepping every `var(--color-accent)`
consumer caught them; all six move to `accent-text`:

| location | use | accent | accent-text |
|---|---|---|---|
| `lp-journey-dot-active` | active waypoint dot | 1.44 | 6.59 |
| `lp-journey-label-active` | active waypoint label (text) | 1.44 | 6.59 |
| `.lp-range::-*-track` ×2 | filled portion of the slider | 1.30 | 5.92 |
| `.lp-range::-*-thumb` ×2 | 2px thumb border | 1.59 | 7.26 |

Separately, `.lp-range:focus-visible` sets `outline: none` and relied on a 24% tint
of `accent` as its *only* focus indicator — under 1.5:1 once the accent went pastel.
It becomes the system ink ring (`0 0 0 2px canvas, 0 0 0 4px ink`), matching the
global `:focus-visible` rule.

Left as `accent`: the FAQ mark fill (paired with `accent-on` at 10.80:1), the hero
wash gradient in `lib/lp.ts` (decorative, 14–30% alpha), and the `ring-accent/12`
halos in `lib/tw.ts` — those sit alongside a `border-accent-text` that carries the
indicator at 7.26:1.

The rewritten contrast test now asserts `accent !== accent-text` and that `accent`
stays *below* 3:1 on canvas, so this class of regression fails the build.

## Testing

- `pnpm -C frontend run test:unit` must pass, including the rewritten
  `theme-contrast.test.ts`. That test is the gate: it re-derives every ratio in the
  table above from `globals.css`, so a mistyped hex fails the build rather than
  shipping.
- `pnpm -C frontend run build` must succeed (catches a dangling `ThemeToggle`
  import after removal).
- `pnpm -C frontend run lint` must pass.
- Manual: load `/` and confirm the landing arrival sequence, scroll reveals,
  counters and FAQ still run; load `/dashboard` and confirm no surface renders dark.
- Manual: confirm `localStorage` no longer gates first paint and there is no flash.

## Out of scope

- Switzer / Almarena Neue licensing and self-hosting.
- Any GSAP or scroll-smoothing library.
- Layout, copy, component structure, or spacing scale changes.
- Backend, and any `frontend/app/**` route logic.
