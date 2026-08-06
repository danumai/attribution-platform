# Gallery Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the indigo/white/Inter theme with **Gallery** — a dark-default, dual-scheme theme on a mid-tone warm grey canvas with a madder accent — across the landing page and every console surface.

**Architecture:** Colour tokens become `light-dark()` pairs in Tailwind v4's `@theme`, driven by `color-scheme` which a `data-theme` attribute sets. Nothing swaps classes at runtime. A contrast test written *first* locks the palette against WCAG before any surface changes. All downstream files are semantic-token consumers, so they change by rename, not by rewrite.

**Tech Stack:** Next.js 14 (app router), Tailwind CSS v4 (CSS-first `@theme`), TypeScript, `tsx` test runner.

**Spec:** `docs/superpowers/specs/2026-08-07-gallery-theme-design.md`

## Global Constraints

- **Contrast rule:** every text token clears **4.5:1** against all four of `canvas`, `sunk`, `card`, `card-alt` in its own scheme. Non-text indicators clear **3:1**.
- **Accent is split:** `accent` is for **fills only**. Anything drawn *on* a surface — links, labels, rail current item, chart strokes — uses `accent-text`. Never `text-accent`.
- **`lib/qr.ts` is not touched.** Its hex values are merchant-chosen QR style presets — product data, not theme.
- **No layout, component-structure, or copy changes.** Theme only.
- Dark is the default scheme, ignoring `prefers-color-scheme`.
- Radius scale: `sm 2px / md 3px / lg 4px / xl 6px`. Pills stay `rounded-full`.
- Only three shadow tokens exist after this work: `shadow-contact-sm`, `shadow-contact`, `shadow-pass`.
- Branch: `theme/gallery`. Commit after every task.

---

### Task 1: Contrast test (write this before touching any colour)

**Files:**
- Create: `frontend/test/theme-contrast.test.ts`
- Modify: `frontend/package.json` (test script)

**Interfaces:**
- Consumes: nothing.
- Produces: `ratio(a: string, b: string): number` — WCAG contrast between two `#rrggbb` strings. Used by no other task, but the assertions gate Task 2.

- [ ] **Step 1: Write the failing test**

Create `frontend/test/theme-contrast.test.ts`:

```ts
/**
 * Locks the palette against WCAG. The theme's one real hazard is that `accent` is
 * legible as a button fill and illegible as text, and that in dark mode `card-alt`
 * is *lighter* than the canvas — so light text has less contrast on a card than on
 * the page. Both were caught by measurement, not by eye. This test keeps them caught.
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
    new RegExp(`--color-${name}:\\s*light-dark\\(\\s*(#[0-9a-fA-F]{6})\\s*,\\s*(#[0-9a-fA-F]{6})\\s*\\)`),
  );
  assert.ok(m, `--color-${name} is not a light-dark() pair in globals.css`);
  return { light: m![1], dark: m![2] };
}

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
```

- [ ] **Step 2: Wire it into the test script**

In `frontend/package.json`, change the `test:unit` script:

```json
"test:unit": "tsx test/units.test.ts && tsx test/theme-contrast.test.ts"
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — `--color-canvas is not a light-dark() pair in globals.css` (the token does not exist yet).

- [ ] **Step 4: Commit**

```bash
git add frontend/test/theme-contrast.test.ts frontend/package.json
git commit -m "test: lock theme palette against WCAG contrast"
```

---

### Task 2: Rewrite the theme tokens

**Files:**
- Modify: `frontend/app/globals.css` (the `@theme` block and `:root`)

**Interfaces:**
- Produces: the full token vocabulary every later task consumes —
  surfaces `canvas | sunk | card | card-alt | card-high`,
  edges `line | line-soft`,
  text `ink | ink-soft | mut`,
  accent `accent | accent-hover | accent-on | accent-text | accent-soft | accent-line`,
  semantic `ok | warn | bad` each with `-soft` and `-line`,
  shadows `shadow-contact-sm | shadow-contact | shadow-pass`,
  labels `text-stamp` (console) and `text-stamp-caps` (landing).

- [ ] **Step 1: Replace the colour, geometry and elevation tokens**

In `frontend/app/globals.css`, replace everything from `/* ---- surfaces ---- */` through the end of the elevation block with:

```css
  /* ---- surfaces ----
     Five levels, not three. The canvas is mid-tone, so `sunk` is genuinely darker
     than the page and cards are genuinely lighter — depth is value, not shadow. */
  --color-canvas:    light-dark(#E7E2DA, #2B2825);
  --color-sunk:      light-dark(#DCD6CC, #211E1B);
  --color-card:      light-dark(#F6F3ED, #35312C);
  --color-card-alt:  light-dark(#EFEBE3, #3D3831);
  --color-card-high: light-dark(#FFFFFF, #454039);

  /* ---- edges ---- */
  --color-line:      light-dark(#D3CCC1, #4A443C);
  --color-line-soft: light-dark(#E0DAD1, #3B3630);

  /* ---- text ---- */
  --color-ink:      light-dark(#2B2825, #F2EEE7);
  --color-ink-soft: light-dark(#56504A, #C8C1B6);
  --color-mut:      light-dark(#625B50, #ADA598);

  /* ---- accent: madder, split in two ----
     `accent` is a FILL. Against the dark canvas it measures 2.5:1 — fine under bone
     type on a button, illegible as text or as a chart stroke. Anything drawn *on* a
     surface uses `accent-text`. This split is the whole accessibility story. */
  --color-accent:       light-dark(#93332A, #B04034);
  --color-accent-hover: light-dark(#7E2B23, #C24A3D);
  --color-accent-on:    light-dark(#FBF8F2, #FBF8F2);
  --color-accent-text:  light-dark(#93332A, #E68C80);
  --color-accent-soft:  light-dark(#F0E4E0, #3A2A26);
  --color-accent-line:  light-dark(#D9BDB6, #5C332C);

  /* ---- semantic ---- */
  --color-ok:      light-dark(#3F6230, #8FAE7C);
  --color-ok-soft: light-dark(#E4EADD, #262E22);
  --color-ok-line: light-dark(#BFCFB2, #3D4A35);

  --color-warn:      light-dark(#7E520F, #D9A441);
  --color-warn-lit:  light-dark(#9A660F, #E8B65C);
  --color-warn-soft: light-dark(#F2E9D6, #332A18);
  --color-warn-line: light-dark(#DCC79A, #4E4126);

  --color-bad:      light-dark(#A83226, #EA887A);
  --color-bad-soft: light-dark(#F3E1DE, #3A2523);
  --color-bad-line: light-dark(#DCB6B0, #5A3730);

  /* the mobile rail scrim — was a hardcoded #0d1117 in shell.tsx */
  --color-scrim: light-dark(rgb(43 40 37 / .42), rgb(0 0 0 / .60));

  /* ---- type ---- */
  --font-sans: var(--font-schibsted), -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Two label tokens. The console keeps sentence case — a decision already made and
     still right for labels read fast and repeatedly. The landing page gets the
     wide-tracked caps that carry the direction's character. */
  --text-stamp: 12px;
  --text-stamp--line-height: 1.4;
  --text-stamp--letter-spacing: 0;
  --text-stamp--font-weight: 500;

  --text-stamp-caps: 10.5px;
  --text-stamp-caps--line-height: 1.4;
  --text-stamp-caps--letter-spacing: 0.13em;
  --text-stamp-caps--font-weight: 600;
```

Keep the `--text-hero / display / title / lede` block exactly as it is, but relax the
hero tracking, since Schibsted Grotesk is narrower than Inter:

```css
  --text-hero--letter-spacing: -0.03em;
```

Then replace the geometry and elevation blocks:

```css
  /* ---- geometry: cut edges, not soft SaaS ---- */
  --radius-sm: 2px;
  --radius-md: 3px;
  --radius-lg: 4px;
  --radius-xl: 6px;

  /* ---- elevation ----
     Ten tokens became three. Depth is carried by the five surface values; a shadow
     only marks something that genuinely floats. light-dark() returns a colour, so it
     cannot switch a whole box-shadow — the tint is a variable the shadows compose. */
  --shadow-tint:      light-dark(rgb(43 40 37 / .13), rgb(0 0 0 / .40));
  --shadow-tint-deep: light-dark(rgb(43 40 37 / .22), rgb(0 0 0 / .62));

  --shadow-contact-sm: 0 1px 2px var(--shadow-tint);
  --shadow-contact:    0 4px 16px -4px var(--shadow-tint);
  --shadow-pass:       0 18px 48px -16px var(--shadow-tint-deep);
```

Delete outright: `--color-paper`, `--color-bg-deep`, `--color-card-sunk`,
`--color-accent-ink`, `--color-press-deep`, `--shadow-board`, `--shadow-strip`,
`--shadow-rules`, `--shadow-key`, `--shadow-key-lit`, `--shadow-key-down`,
`--shadow-lift`.

- [ ] **Step 2: Switch the scheme and the focus ring**

Replace the `:root` block and the focus rule in `@layer base`:

```css
:root {
  color-scheme: light dark;
}

/* The toggle stamps data-theme before first paint; light-dark() resolves off
   color-scheme, so this attribute is the entire mechanism. Dark is the default. */
:root:not([data-theme="light"]) { color-scheme: dark; }
:root[data-theme="light"]       { color-scheme: light; }
```

```css
  /* Ink, not accent: madder is 2.5:1 on the dark canvas, under the 3:1 a non-text
     indicator needs. An achromatic ring also suits the restraint of the theme. */
  :focus-visible { outline: 2px solid var(--color-ink); outline-offset: 2px; }
```

- [ ] **Step 3: Run the contrast test**

Run: `cd frontend && npm run test:unit`
Expected: PASS — `theme-contrast: all token/surface pairs pass`

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: Gallery theme tokens, dual-scheme via light-dark()"
```

---

### Task 3: Fonts, scheme bootstrap, theme colour

**Files:**
- Modify: `frontend/app/layout.tsx`

**Interfaces:**
- Produces: `--font-schibsted` and `--font-jetbrains` CSS variables on `<html>`, consumed by the `--font-sans` / `--font-mono` tokens from Task 2.

- [ ] **Step 1: Replace the file**

```tsx
import { Schibsted_Grotesk, JetBrains_Mono } from 'next/font/google';
import { UI } from '@/lib/ui';
import './globals.css';

const sans = Schibsted_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-schibsted',
});

/* Figures are mono everywhere in this theme, so the stack has to be the same face on
   every OS — the system stack renders as SF Mono / Consolas / DejaVu and the strip of
   numbers stops looking designed. Two weights, latin only. */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export const metadata = {
  title: 'QR Reward Platform',
  description:
    'Run QR reward campaigns with publishers — scans, redemptions and budgets in one place.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E7E2DA' },
    { media: '(prefers-color-scheme: dark)', color: '#2B2825' },
  ],
};

/* Runs before first paint, so a light-mode reader never sees a dark flash. Kept as a
   string rather than a module because it must execute ahead of hydration. */
const BOOT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-[15px] leading-[1.55] tracking-[-0.011em] text-ink antialiased">
        {children}
        <UI />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds. Font fetch requires network; if offline, expect a `next/font` error and retry when connected.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: Schibsted Grotesk + JetBrains Mono, pre-paint scheme bootstrap"
```

---

### Task 4: Theme toggle

**Files:**
- Create: `frontend/lib/theme.tsx`

**Interfaces:**
- Produces: `<ThemeToggle className?: string />`, a client component. Consumed by Task 6 (`shell.tsx`) and Task 9 (`lp.ts` / `Landing.tsx`).

- [ ] **Step 1: Write the component**

```tsx
'use client';
/**
 * The scheme switch. `data-theme` on <html> drives `color-scheme`, which is what
 * every light-dark() token resolves against — so flipping one attribute retints the
 * whole product with no class swapping and no re-render below this component.
 *
 * Absent the attribute the theme is dark (see globals.css), and layout.tsx restores
 * a stored choice before first paint.
 */
import { useEffect, useState } from 'react';
import { btnBase, cx } from '@/lib/tw';

export function ThemeToggle({ className }: { className?: string }) {
  const [light, setLight] = useState(false);

  // The server cannot know the stored choice, so the icon syncs after mount.
  useEffect(() => setLight(document.documentElement.dataset.theme === 'light'), []);

  function flip() {
    const next = light ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode — the choice just will not survive a reload */
    }
    setLight(!light);
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      className={cx(
        btnBase,
        'grid size-8 place-items-center border-transparent bg-transparent text-mut',
        'enabled:hover:bg-card-alt enabled:hover:text-ink [&_svg]:size-[17px]',
        className,
      )}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {light ? (
          <path d="M16 11.2A6.5 6.5 0 0 1 8.8 4a6.5 6.5 0 1 0 7.2 7.2Z" />
        ) : (
          <>
            <circle cx="10" cy="10" r="3.4" />
            <path d="M10 2.2v1.6M10 16.2v1.6M17.8 10h-1.6M3.8 10H2.2M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1M15.5 15.5l-1.1-1.1M5.6 5.6 4.5 4.5" />
          </>
        )}
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/theme.tsx
git commit -m "feat: theme toggle"
```

---

### Task 5: Console primitives

**Files:**
- Modify: `frontend/lib/tw.ts`

**Interfaces:**
- Consumes: every token from Task 2.
- Produces: the same exported names as today (`card`, `btn`, `field`, `pill`, …) — no signature changes, so no consumer needs editing beyond the renames in Tasks 6–10.

- [ ] **Step 1: Apply the renames**

Across the file:

| Find | Replace | Notes |
|---|---|---|
| `text-accent` | `text-accent-text` | 28 sites. **Not** `bg-accent`. |
| `bg-paper` | `bg-canvas` | |
| `bg-card-sunk` / `bg-bg-deep` | `bg-sunk` | |
| `text-accent-ink` | `text-accent-on` | on-fill text |
| `shadow-key-lit` / `shadow-key-down` / `shadow-key` | *(delete the class)* | accent glow is gone |
| `shadow-board` / `shadow-strip` / `shadow-rules` / `shadow-lift` | `shadow-contact` | |

- [ ] **Step 2: Point popovers at the new top surface**

`menuPop` and any floating panel move from `bg-card` to `bg-card-high`:

```ts
export const menuPop =
  'absolute top-[calc(100%+6px)] right-0 z-41 min-w-49 rounded-xl border border-line bg-card-high p-1.5 shadow-contact animate-rise-fast';
```

- [ ] **Step 3: Note why the QR plate does not theme**

`qrbox` takes its background from the merchant's chosen backdrop at the call site, so it is already theme-independent. Add the comment so nobody "fixes" it:

```ts
/* The plate's background comes from the merchant's chosen backdrop at the call site,
   not from a theme token — a QR preview is a proof of a printed artifact, and the
   Cutout preset is transparent. Theming this dark would render an unscannable code. */
export const qrbox =
  'flex aspect-square items-center justify-center rounded-lg border border-line p-4 shadow-contact-sm ' +
  'transition-colors duration-200 ease-press [&_img]:max-h-full [&_img]:max-w-full';
```

- [ ] **Step 4: Verify nothing dangles**

Run:
```bash
cd frontend && grep -nE "bg-paper|card-sunk|bg-deep|accent-ink|shadow-(key|board|strip|rules|lift)" lib/tw.ts
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/tw.ts
git commit -m "refactor: console primitives onto Gallery tokens"
```

---

### Task 6: Console chrome

**Files:**
- Modify: `frontend/lib/ui.tsx`, `frontend/lib/shell.tsx`

- [ ] **Step 1: Lift the floating layers in `ui.tsx`**

The toast (`ui.tsx:427`) and the dialog (`ui.tsx:481`) float above everything, so both move to `bg-card-high`. The dialog's `backdrop:` colour switches to the scrim token:

```
backdrop:bg-scrim
```

replacing `backdrop:bg-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]`.

- [ ] **Step 2: Fix the hardcoded scrim in `shell.tsx:143`**

Replace `max-[900px]:bg-[color-mix(in_srgb,#0d1117_45%,transparent)]` with `max-[900px]:bg-scrim`.

- [ ] **Step 3: Rail current item and the toggle**

In `railItem`, `'border-transparent bg-accent-soft font-semibold text-accent'` becomes `text-accent-text`.

Import `ThemeToggle` from `@/lib/theme` and render it in the rail footer beside the existing controls.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run build && grep -rn "text-accent\b\|#0d1117" lib/ui.tsx lib/shell.tsx`
Expected: build succeeds, grep gives no output.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/ui.tsx frontend/lib/shell.tsx
git commit -m "refactor: console chrome onto Gallery tokens, add theme toggle to rail"
```

---

### Task 7: Charts

**Files:**
- Modify: `frontend/lib/audience.tsx:19`, `frontend/lib/chart.tsx:382`

- [ ] **Step 1: Series colours**

A chart stroke is a non-text graphic; madder at 2.5:1 is invisible on the dark canvas.

`audience.tsx:19`:
```ts
/* accent-text, not accent: the fill colour is 2.5:1 on the dark canvas and a line
   drawn in it disappears. See the accent split in the theme spec. */
export const INK = { scans: 'var(--color-accent-text)', signups: 'var(--color-ok)' };
```

`chart.tsx:382` — the `Spark` default:
```ts
  color = 'var(--color-accent-text)',
```

- [ ] **Step 2: Sweep the rest of `audience.tsx`**

`text-accent` → `text-accent-text` (the "show all" control at line 129).

- [ ] **Step 3: Verify**

Run: `cd frontend && grep -rn "color-accent)\|text-accent\b" lib/chart.tsx lib/audience.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/chart.tsx frontend/lib/audience.tsx
git commit -m "fix: chart series use accent-text so strokes stay visible on dark"
```

---

### Task 8: QR studio

**Files:**
- Modify: `frontend/app/campaigns/[id]/page.tsx`

- [ ] **Step 1: Explain the fixed checkerboard**

`checker()` at line 384 must keep its light hex — it stands for transparency behind a
code that will be printed on light stock. Add the reason:

```ts
/* Deliberately not themed. The checker stands for transparency in a preview of a
   physical printed artifact; darkening it would imply a dark substrate and make the
   Cutout preset look scannable when it is not. */
const checker = (px: number) => `repeating-conic-gradient(#eeeeee 0 25%, #fff 0 50%) 50%/${px}px ${px}px`;
```

- [ ] **Step 2: Sweep the token renames**

`text-accent` → `text-accent-text`, and any deleted shadow token → `shadow-contact`.
Leave every `#rrggbb` that is a QR style value (`style.dark`, `style.light`,
`eyeColor`, `frameColor`, `gradient`, and the `BACKDROPS` list) exactly as it is —
that is merchant data.

- [ ] **Step 3: Verify**

Run: `cd frontend && grep -nE "text-accent\b|shadow-(key|board|strip|rules|lift)" "app/campaigns/[id]/page.tsx"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/campaigns/[id]/page.tsx"
git commit -m "refactor: QR studio chrome onto Gallery tokens"
```

---

### Task 9: Landing page

**Files:**
- Modify: `frontend/lib/lp.ts`, `frontend/app/landing/landing.css`, `frontend/app/landing/Landing.tsx`
- Delete: `frontend/app/landing/Spotlight.tsx`, `frontend/app/landing/HeroGlow.tsx`

- [ ] **Step 1: Remove the ambient glow in `lp.ts`**

Delete the `heroGlow` export entirely. Three coloured radial washes behind the hero is
the loudest generic-SaaS signature in the file. Replace with a faint value shift:

```ts
/** A single faint value shift, not a coloured wash — depth from value, as everywhere else. */
export const heroWash =
  'pointer-events-none absolute inset-[-120px_-10%_auto_-10%] -z-1 h-[640px] ' +
  'bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--color-card)_60%,transparent),transparent_72%)]';
```

- [ ] **Step 2: Drop the sheen hook and switch the labels**

In `btn`, remove the `lp-btn` class and `overflow-hidden` (both existed only for the
sheen):

```ts
export const btn = cx(btnBase, lpPad, inkAccent, 'active:translate-y-px');
```

Landing micro-labels move to the caps token — `fieldTerm`, `boardTitle`,
`journeyLabel`, and the `[&>span]:text-stamp` in `boardFoot`:

```ts
export const fieldTerm = 'text-stamp-caps text-mut uppercase';
```

`eyebrow` uses `text-accent` twice (text and the rule) — the text becomes
`text-accent-text`; the `before:bg-accent` rule is a fill and stays.

- [ ] **Step 3: Delete the dead effects in `landing.css`**

Remove two whole blocks:
- the `@media (hover: hover)` block containing `@property --spot`, `.lp [data-spot]`, and `.lp [data-spot]:hover`
- the `.lp .lp-btn::after` and `.lp .lp-btn:hover::after` rules

The `.lp-range` track and thumb rules keep `var(--color-accent)` — a slider fill is a
fill, and it is correct there.

- [ ] **Step 4: Remove the components**

```bash
git rm frontend/app/landing/Spotlight.tsx frontend/app/landing/HeroGlow.tsx
```

Then in `Landing.tsx`, drop both imports, unwrap the `<Spotlight>` container to a plain
`<div>` carrying the same `className`, drop every `data-spot` attribute, and swap
`<HeroGlow />` for `<div className={lp.heroWash} />`.

- [ ] **Step 5: Verify**

Run:
```bash
cd frontend && npm run build && grep -rn "data-spot\|lp-btn\|heroGlow\|Spotlight\|HeroGlow" app lib
```
Expected: build succeeds, grep gives no output.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/app/landing frontend/lib/lp.ts
git commit -m "refactor: landing onto Gallery tokens, drop glow/sheen/spotlight"
```

---

### Task 10: Remaining token consumers

**Files:**
- Modify: `frontend/lib/pass.tsx`, `frontend/app/landing/ActivityBoard.tsx`, `frontend/app/login/page.tsx`, `frontend/app/admin/page.tsx`

- [ ] **Step 1: Sweep all four**

Same table as Task 5, Step 1. These files only consume tokens, so this is rename work.

- [ ] **Step 2: Verify the whole tree is clean**

Run:
```bash
cd frontend && grep -rnE "bg-paper|card-sunk|bg-deep|accent-ink|text-accent\b|shadow-(key|board|strip|rules|lift)" app lib
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/pass.tsx frontend/app/landing/ActivityBoard.tsx frontend/app/login/page.tsx frontend/app/admin/page.tsx
git commit -m "refactor: remaining surfaces onto Gallery tokens"
```

---

### Task 11: Brand mark

**Files:**
- Modify: `frontend/app/icon.svg`

- [ ] **Step 1: Recolour the favicon**

The ticket keeps its geometry; only the two colours move from the old warm-black/cream
to Gallery's canvas and bone. `lib/mark.tsx` needs no change — `TicketMark` already
inherits `currentColor` through `fill`.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="2" fill="#2B2825"/>
  <path fill="#F2EEE7" d="M3.5 8.25A1.25 1.25 0 0 1 4.75 7h14.5a1.25 1.25 0 0 1 1.25 1.25v2.1a1.9 1.9 0 0 0 0 3.3v2.1A1.25 1.25 0 0 1 19.25 17H4.75a1.25 1.25 0 0 1-1.25-1.25v-2.1a1.9 1.9 0 0 0 0-3.3v-2.1Zm11.75.6v1.2h1.2v-1.2h-1.2Zm0 2.55v1.2h1.2v-1.2h-1.2Zm0 2.55v1.2h1.2v-1.2h-1.2Z"/>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/icon.svg
git commit -m "feat: recolour brand mark to Gallery"
```

---

### Task 12: Full verification

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Tests and build**

Run: `cd frontend && npm run test:unit && npm run build`
Expected: contrast test passes, build succeeds with no type errors.

- [ ] **Step 2: Visual pass, both schemes**

Run `npm run dev` and walk every surface in dark, then flip the toggle and walk it
again in light: landing, login, dashboard, campaign detail **including the QR studio**,
admin, publisher-sim, campaign-ended, not-found, error.

Look specifically for:
- any text that lost contrast on a **card** or a **zebra row** (the failure mode the whole spec is built around)
- QR previews still rendering on a light plate with the Cutout preset visibly transparent
- charts with visible strokes in both schemes
- no dark flash on reload in light mode
- focus rings visible on every interactive element

- [ ] **Step 3: Commit any fixes and finish**

```bash
git add -A && git commit -m "fix: visual pass corrections"
```

---

## Self-Review

**Spec coverage** — token architecture → Task 2; palette → Tasks 1–2; typography → Tasks 2–3; two label tokens → Tasks 2, 9; geometry → Task 2; elevation → Task 2 plus renames in 5–10; focus → Task 2; motion deletions → Tasks 5 (shadow-key), 9 (sheen, glow, spotlight); default scheme and toggle → Tasks 3, 4, 6, 9; chart colours → Task 7; QR plate → Tasks 5, 8; mobile scrim → Task 6; brand mark → Task 11; verification → Tasks 1, 12. No gaps.

**Deviation from spec, recorded:** the spec expected the QR checkerboard to need a themed variant. It does not — `qrbox` already takes its background from the merchant's chosen backdrop at the call site, so the fix is a comment, not a code change. Tasks 5 and 8 reflect the smaller scope.

**Type consistency** — `ratio()` is defined in Task 1 and used nowhere else. `ThemeToggle` is defined in Task 4 and consumed by Tasks 6 and 9 under that exact name. `heroWash` replaces `heroGlow` and is consumed only in Task 9, where it is introduced. Token names are fixed by Task 2's Produces block and used verbatim thereafter.
