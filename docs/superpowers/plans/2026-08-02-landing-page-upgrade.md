# Landing Page Upgrade ("Bolder Ticket") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `frontend/app/landing/` visually richer and more animated — an ambient gradient hero, scroll parallax, glass accents, a scroll-driven "journey" flow diagram standing in for a promo video, and consistent section-entrance motion — while keeping the printed-ticket design language and all existing copy/structure.

**Architecture:** Pure presentation-layer change inside `frontend/app/landing/`. One new component (`JourneyFlow.tsx`) for the scroll-driven flow diagram, one new hook (`useInView.ts`) extracted from the `IntersectionObserver`-gating pattern already duplicated in `ScanStub.tsx` and `ActivityBoard.tsx`, and additions to `landing.css` for the gradient mesh, parallax, glass accents, and generic scroll-entrance classes. `Landing.tsx` gets new class hooks and the `JourneyFlow` mount point, not a rewrite.

**Tech Stack:** Next.js 14 / React 18 (existing), plain CSS + native `IntersectionObserver` and `animation-timeline` (existing pattern), no new npm dependencies.

## Global Constraints

- No new npm packages (spec: "Technical approach").
- No changes to `frontend/app/landing/*` data-fetching, routing, or the five-section content structure (spec: "Non-Goals").
- No fabricated customer logos, testimonials, or real traction numbers; illustrative stats stay labeled "Example data" (spec: "Content changes").
- All motion must respect `prefers-reduced-motion: reduce` and be fully legible/readable with motion off (spec: "Motion inventory").
- Looping/ambient animations must stop when their element is off-screen (spec: "Motion inventory"; existing pattern: `ScanStub.tsx`'s `data-run` gate).
- This is a manual-verification UI change — no automated test suite exists for this frontend beyond backend tests (spec: "Testing / Verification"). Each task's verification step is "run the dev server and visually confirm X," not a unit test.
- Scope is `frontend/app/landing/` and `frontend/DESIGN.md` only — no console/portal design-system files touched.

---

## Task 1: Extract the shared `useInView` hook

**Files:**
- Create: `frontend/app/landing/useInView.ts`
- Modify: `frontend/app/landing/ScanStub.tsx` (replace inline `IntersectionObserver` with the hook)
- Modify: `frontend/app/landing/ActivityBoard.tsx` (replace inline `matchMedia` reduced-motion check is separate — only touch if it also gains view-gating; see step 3)

**Interfaces:**
- Produces: `useInView<T extends HTMLElement>(): { ref: RefObject<T>; inView: boolean }` — a hook that returns a ref to attach to any element and a boolean that is `true` while that element intersects the viewport (default `IntersectionObserver` options, matching `ScanStub.tsx`'s current behavior of no `threshold`/`rootMargin` overrides).
- Consumes: nothing (leaf utility).

This hook is the one abstraction this upgrade justifies: the `IntersectionObserver`-gating pattern already exists twice (`ScanStub.tsx`, and will be needed again in `JourneyFlow.tsx` and the generic section-entrance code in Task 5), so extracting it now avoids a third and fourth copy-paste.

- [ ] **Step 1: Write `useInView.ts`**

```typescript
'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

export function useInView<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  inView: boolean;
} {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, inView };
}
```

- [ ] **Step 2: Rewire `ScanStub.tsx` to use it**

Replace the existing `useRef`/`useState`/`useEffect` block in `frontend/app/landing/ScanStub.tsx` (lines 9–18) with:

```typescript
import { useInView } from './useInView';

export default function ScanStub() {
  const { ref, inView } = useInView<HTMLElement>();

  return (
    <aside className="lp-stub" ref={ref} data-run={inView ? '' : undefined}>
```

Remove the now-unused `useEffect`, `useRef`, `useState` imports from `ScanStub.tsx` if nothing else in the file needs them (check before removing — `ScanStub.tsx` uses no other hook, so all three become unused and should be dropped from the `import` line).

- [ ] **Step 3: Verify no behavior change**

Run: `pnpm -C frontend dev`, open `http://localhost:3000` (or the landing route — confirm via `frontend/app/page.tsx` that `/` renders `Landing`).

Expected: the stub's QR sweep/ring/status-flip animation still runs only while the stub is scrolled into view, exactly as before. No console errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/landing/useInView.ts frontend/app/landing/ScanStub.tsx
git commit -m "refactor: extract useInView hook from ScanStub's IntersectionObserver gating"
```

---

## Task 2: Hero gradient mesh + parallax

**Files:**
- Modify: `frontend/app/landing/landing.css` (add rules near the `---------- hero ----------` section, after line 303's `.lp-hero` block)
- Modify: `frontend/app/landing/Landing.tsx` (add a background element inside `<header className="lp-hero lp-wrap">`)

**Interfaces:**
- Produces: `.lp-hero-glow` CSS class (ambient gradient backdrop, absolutely positioned behind the hero pass) and `.lp-parallax` CSS class (applied to `.lp-pass` for scroll-linked depth).
- Consumes: existing CSS custom properties `--press`, `--hold`, `--post` defined in `.lp` (landing.css:12–29).

- [ ] **Step 1: Add the gradient-mesh element to the hero**

In `frontend/app/landing/Landing.tsx`, inside `<header className="lp-hero lp-wrap">` (line 104), add a decorative element as the first child, before `<div className="lp-pass ...">`:

```tsx
<header className="lp-hero lp-wrap">
  <div className="lp-hero-glow" aria-hidden="true" />
  <div className="lp-pass lp-pass-shell lp-stocked lp-cropped">
```

- [ ] **Step 2: Style the glow and parallax in `landing.css`**

Add after the `.lp-hero { padding: 46px 0 12px; }` rule (landing.css:303):

```css
/* ambient gradient backdrop, low-saturation, using the system's own three inks
   at low opacity so it reads as this product's colors, not a generic SaaS wash */
.lp-hero {
  position: relative;
  isolation: isolate;
}
.lp-hero-glow {
  position: absolute;
  inset: -80px -10% auto -10%;
  height: 620px;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(45% 55% at 18% 20%, color-mix(in srgb, var(--press) 16%, transparent), transparent 70%),
    radial-gradient(38% 48% at 82% 10%, color-mix(in srgb, var(--hold) 14%, transparent), transparent 72%),
    radial-gradient(40% 50% at 55% 60%, color-mix(in srgb, var(--post) 10%, transparent), transparent 74%);
  filter: blur(6px);
  opacity: 0.9;
}
@media (prefers-reduced-motion: no-preference) {
  .lp-hero-glow {
    animation: lp-glow-drift 22s ease-in-out infinite alternate;
  }
}
@keyframes lp-glow-drift {
  from { background-position: 0 0, 0 0, 0 0; transform: translateY(0); }
  to { background-position: 30px 20px, -24px 16px, 14px -18px; transform: translateY(6px); }
}
```

- [ ] **Step 3: Add scroll parallax to the hero pass**

Append to the same area of `landing.css`:

```css
@supports (animation-timeline: scroll()) {
  @media (prefers-reduced-motion: no-preference) {
    /* the pass drifts slower than the page, reading as sitting above the desk */
    .lp .lp-hero .lp-pass {
      animation: lp-parallax-pass linear both;
      animation-timeline: scroll(root block);
      animation-range: 0 640px;
    }
    @keyframes lp-parallax-pass {
      to { transform: translateY(-24px); }
    }
  }
}
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm -C frontend dev`, load the landing page.

Expected: a soft, slow-moving multicolor glow visible behind/around the hero pass (not overpowering the card — card stays fully legible). Scrolling down slowly makes the hero pass shift upward slightly slower than the rest of the page. With OS-level "reduce motion" on, the glow is static and no parallax occurs, but the glow is still visible.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/landing/landing.css frontend/app/landing/Landing.tsx
git commit -m "feat: add ambient gradient glow and scroll parallax to landing hero"
```

---

## Task 3: Glass accents — nav blur-in and activity board edge highlight

**Files:**
- Modify: `frontend/app/landing/landing.css` (`.lp-nav` block at line 197, `.lp-board` block at line 454)

**Interfaces:**
- Consumes: existing `.lp-nav`, `.lp-board` selectors — this task only adds properties, no new classes or markup.

- [ ] **Step 1: Add scroll-triggered glass blur to the nav**

In `landing.css`, extend the existing scroll-timeline block for `.lp-nav` (around line 926–934, inside the `@supports (animation-timeline: scroll())` block) — replace:

```css
    /* the nav lifts off the page once the reader has left the top */
    .lp .lp-nav {
      animation: lp-nav-set linear both;
      animation-timeline: scroll(root block);
      animation-range: 0 130px;
    }
    @keyframes lp-nav-set {
      to { box-shadow: 0 14px 26px -24px rgba(26, 23, 18, 0.75); }
    }
```

with:

```css
    /* the nav lifts off the page once the reader has left the top, and gains a
       glass tint so it reads as floating over the scrolled content beneath it */
    .lp .lp-nav {
      animation: lp-nav-set linear both;
      animation-timeline: scroll(root block);
      animation-range: 0 130px;
    }
    @keyframes lp-nav-set {
      to {
        box-shadow: 0 14px 26px -24px rgba(26, 23, 18, 0.75);
        background: color-mix(in srgb, var(--paper) 82%, transparent);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
    }
```

- [ ] **Step 2: Add a glass highlight edge to the activity board**

In `landing.css`, extend the `.lp-board` rule (line 454–461) — add a highlight pseudo-element after it:

```css
.lp-board {
  margin-top: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--stock);
  overflow: hidden;
  box-shadow: 0 1px 0 #fff inset, 0 18px 40px -34px rgba(26, 23, 18, 0.4);
  position: relative;
}
/* a soft light-catch along the top edge, the one "glass" touch on this card */
.lp-board::after {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 40%;
  background: linear-gradient(to bottom, color-mix(in srgb, #fff 55%, transparent), transparent);
  pointer-events: none;
  border-radius: 12px 12px 0 0;
}
```

- [ ] **Step 3: Verify in browser**

Run: `pnpm -C frontend dev`.

Expected: scrolling past the top of the page, the sticky nav gains a translucent/blurred background so content scrolling underneath it is visible-but-blurred, not a hard opaque bar. The activity board card shows a subtle light sheen along its top edge. Neither effect should make text illegible.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/landing/landing.css
git commit -m "feat: add glass accents to nav scroll state and activity board"
```

---

## Task 4: `JourneyFlow` scroll-driven flow diagram

**Files:**
- Create: `frontend/app/landing/JourneyFlow.tsx`
- Modify: `frontend/app/landing/Landing.tsx` (mount inside the four-coupon section, around line 158–177)
- Modify: `frontend/app/landing/landing.css` (new `.lp-journey*` rules)

**Interfaces:**
- Produces: `JourneyFlow` — a client component, no props, self-contained. Renders an SVG with a dashed connecting path and 4 waypoint markers (print/scan/signup/ledger), and exposes `data-active` on each waypoint once its corresponding coupon (`LEGS[i]`) has scrolled into view.
- Consumes: `useInView` from `./useInView` (Task 1) — one instance per waypoint, or a single multi-element observer (see Step 1 for the chosen approach).

- [ ] **Step 1: Write `JourneyFlow.tsx`**

The component gives each of its 4 waypoints its own `useInView` (Task 1) so it activates as
the reader scrolls past it, independent of the coupons' own text. This keeps `JourneyFlow`
self-contained rather than reaching into sibling DOM. `useInView` is called a fixed 4 times
(not in a loop), which is a valid, non-conditional hook usage.

```tsx
'use client';
import { useInView } from './useInView';

const STEPS = [
  { key: 'print', label: 'Print' },
  { key: 'scan', label: 'Scan' },
  { key: 'signup', label: 'Signup' },
  { key: 'ledger', label: 'Ledger' },
] as const;

// Four waypoints on one horizontal path, each gated by its own useInView so the
// diagram activates step-by-step as the reader scrolls past the matching
// coupon column above it (see .lp-journey CSS: it sits directly under .lp-strip
// and shares its 4-column grid, so waypoint N aligns under coupon N).
export default function JourneyFlow() {
  const w0 = useInView<HTMLDivElement>();
  const w1 = useInView<HTMLDivElement>();
  const w2 = useInView<HTMLDivElement>();
  const w3 = useInView<HTMLDivElement>();
  const waypoints = [w0, w1, w2, w3];
  const reachedCount = waypoints.filter((w) => w.inView).length;

  return (
    <div className="lp-journey" aria-hidden="true">
      <svg className="lp-journey-line" viewBox="0 0 400 4" preserveAspectRatio="none">
        <line x1="0" y1="2" x2="400" y2="2" className="lp-journey-track" />
        <line
          x1="0"
          y1="2"
          x2="400"
          y2="2"
          className="lp-journey-draw"
          style={{ '--reached': reachedCount } as React.CSSProperties}
        />
      </svg>
      {STEPS.map((s, i) => (
        <div
          className="lp-journey-point"
          key={s.key}
          ref={waypoints[i].ref}
          data-active={waypoints[i].inView ? '' : undefined}
        >
          <span className="lp-journey-dot" />
          <span className="lp-journey-token" />
          <span className="lp-journey-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
```

Note: `IntersectionObserver`'s default `threshold: 0` (used by `useInView`, matching
`ScanStub.tsx`'s existing behavior) fires as soon as any pixel of the waypoint is visible —
looser than the originally-considered 60% threshold, but consistent with the rest of the
codebase's gating pattern and avoids adding a second `useInView` variant just for this component.

- [ ] **Step 2: Mount it in `Landing.tsx`**

In `frontend/app/landing/Landing.tsx`, import it at the top:

```tsx
import JourneyFlow from './JourneyFlow';
```

Then in the four-coupon section (line 158–177), insert it between the section head and the strip:

```tsx
      <section className="lp-section lp-wrap">
        <hr className="lp-trim" />
        <div className="lp-section-head">
          <h2 className="lp-h2">One scan, four coupons.</h2>
          <p className="lp-sub">
            Nothing is charged to you until the fourth. Every stage is a checkpoint the scan has to
            clear, and the money only moves at the end of the strip.
          </p>
        </div>
        <JourneyFlow />
        <div className="lp-strip lp-stocked">
```

- [ ] **Step 3: Style `.lp-journey*` in `landing.css`**

Add near the `---------- the route: four coupons on one strip ----------` section (before line 608's `.lp-strip` rule):

```css
/* ---------- the journey: a scroll-activated flow diagram standing in for a
   promo video. Four waypoints on one line, each lighting up (and sending a
   token traveling to it) as its matching coupon below scrolls into view. ---------- */

.lp-journey {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 22px;
  padding: 0 6px;
}
.lp-journey-line {
  position: absolute;
  inset: 15px 6px auto 6px;
  width: calc(100% - 12px);
  height: 4px;
  overflow: visible;
}
.lp-journey-track,
.lp-journey-draw {
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.lp-journey-track { stroke: var(--line); }
.lp-journey-draw {
  stroke: var(--press);
  stroke-dasharray: 100;
  stroke-dashoffset: calc(100 - (var(--reached, 0) * 25));
  transition: stroke-dashoffset 0.6s var(--ease);
}

.lp-journey-point {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
}
.lp-journey-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--stock);
  border: 2px solid var(--line);
  transition: border-color 0.3s var(--ease), background 0.3s var(--ease), transform 0.3s var(--ease);
}
.lp-journey-point[data-active] .lp-journey-dot {
  border-color: var(--press);
  background: var(--press);
  transform: scale(1.15);
}
.lp-journey-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mut);
  transition: color 0.3s var(--ease);
}
.lp-journey-point[data-active] .lp-journey-label { color: var(--press); }

/* the token that travels to a waypoint the instant it activates */
.lp-journey-token {
  position: absolute;
  top: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--post);
  opacity: 0;
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .lp-journey-point[data-active] .lp-journey-token {
    animation: lp-token-arrive 0.5s var(--ease) both;
  }
}
@keyframes lp-token-arrive {
  from { opacity: 0; transform: translate(-16px, -6px) scale(0.6); }
  60% { opacity: 1; }
  to { opacity: 0; transform: translate(0, 0) scale(1); }
}

@media (max-width: 1000px) {
  .lp-journey { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .lp-journey-label { display: none; }
}
@media (max-width: 720px) {
  .lp-journey { display: none; }
}
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm -C frontend dev`.

Expected: above the four-coupon strip, a horizontal line with 4 dots (Print/Scan/Signup/Ledger). Scrolling so each dot individually crosses ~60% into the viewport lights that dot press-blue, sends a small green token-dot flourish, and advances the connecting line's fill. Diagram is hidden below 720px (coupons alone still communicate the flow at that width — consistent with the strip's own single-column collapse). With reduced motion, dots still switch to active state (no animation, but the state changes are instant and visible).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/landing/JourneyFlow.tsx frontend/app/landing/Landing.tsx frontend/app/landing/landing.css
git commit -m "feat: add scroll-driven JourneyFlow diagram to the four-coupon section"
```

---

## Task 5: Generic section-entrance motion

**Files:**
- Modify: `frontend/app/landing/Landing.tsx` (add `lp-enter` class to section headings/cards in the 3 remaining sections: classes, rules, close — lines 179–296)
- Modify: `frontend/app/landing/landing.css` (new `.lp-enter` rule using `useInView`-free, pure-CSS `animation-timeline: view()` — matching the existing pattern already used for `.lp-leg` at line 944)

**Interfaces:**
- Produces: `.lp-enter` CSS class — a fade+rise entrance triggered by `animation-timeline: view()`, same mechanism already used for `.lp-leg` (landing.css:938–951) and `.lp-meter i` / `.lp-num` (landing.css:953–978). No new JS.
- Consumes: nothing new — this task is CSS-only, reusing the existing `@supports (animation-timeline: view())` block.

Per `DESIGN.md`'s existing "Don't give an element a scroll entrance just because it is a section" rule, this task does NOT blanket every section — it targets exactly the elements the spec's motion table calls out (section headings/cards), reusing the one entrance idiom already established for `.lp-leg`, so all entrances in the page share one authored feel rather than each section inventing its own.

- [ ] **Step 1: Add the `.lp-enter` rule to `landing.css`**

Add inside the existing `@supports (animation-timeline: view())` block (after the `.lp-stamp` rule ending at line 991):

```css
    /* generic section entrance: fade + rise, reused everywhere a card or class
       block scrolls into place — the same idiom .lp-leg already uses */
    .lp-enter {
      animation: lp-enter-rise linear both;
      animation-timeline: view();
      animation-range: entry 5% entry 55%;
    }
    @keyframes lp-enter-rise {
      from { opacity: 0; transform: translateY(18px); filter: blur(3px); }
    }
```

- [ ] **Step 2: Apply `lp-enter` to the fare-class cards**

In `Landing.tsx`, lines 190 and 215, add the class:

```tsx
<article className="lp-class lp-class-guest lp-stocked lp-enter">
```
```tsx
<article className="lp-class lp-class-verified lp-stocked lp-enter">
```

- [ ] **Step 3: Apply `lp-enter` to the fare-rules rows**

Line 253's map already renders `.lp-rule` per row; add `lp-enter` there:

```tsx
{RULES.map((r) => (
  <div className="lp-rule lp-enter" key={r.term}>
```

- [ ] **Step 4: Apply `lp-enter` to the closing pass**

Line 264:

```tsx
<div className="lp-close-pass lp-pass-shell lp-stocked lp-cropped lp-enter">
```

- [ ] **Step 5: Verify in browser**

Run: `pnpm -C frontend dev`.

Expected: scrolling to the "Two fares for the same seat" section, each fare card fades/rises into place as it crosses into view (not both at once unless scrolled fast). Same for each fare-rule row and the closing pass. With reduced motion, everything renders at full opacity immediately (per the existing `@supports`/pattern — `animation-timeline: view()` rules already live only inside `@media (prefers-reduced-motion: no-preference)`).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/landing/Landing.tsx frontend/app/landing/landing.css
git commit -m "feat: extend view-timeline entrance motion to fare cards, rules, and close section"
```

---

## Task 6: Counter prominence and extended hover micro-interactions

**Files:**
- Modify: `frontend/app/landing/landing.css` (`.lp-class .lp-amount` at line 714, `.lp-board-coins` at line 520, `.lp-class` at line 665)

**Interfaces:** none — CSS-only, no new classes or markup.

Covers two rows from the spec's motion table not yet addressed: fare meter/counter figures
"made more prominent visually," and the hover micro-interaction pattern (already on `.lp-leg`
and `.lp-rule`) extended to the fare-class cards.

- [ ] **Step 1: Enlarge the fare-tier counters**

In `landing.css`, change `.lp-class .lp-amount` (line 714–721) font-size from `34px` to `44px`
and tighten `letter-spacing` slightly to match:

```css
.lp-class .lp-amount {
  font-family: var(--mono);
  font-size: 44px;
  font-weight: 600;
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
  margin: 26px 0 6px;
}
```

- [ ] **Step 2: Enlarge the activity board's running total**

In `landing.css`, change `.lp-board-foot b` (line 547–553) font-size from `14px` to `17px`:

```css
.lp-board-foot b {
  font-family: var(--mono);
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Add hover micro-interaction to fare-class cards**

In `landing.css`, extend the `.lp-class` rule (line 665–674) with a hover state matching the
lift-free, background-only pattern already used by `.lp-leg:hover` and `.lp-rule:hover`:

```css
.lp-class {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 32px 30px 30px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--stock);
  transition: border-color 0.24s ease, box-shadow 0.24s ease;
}
.lp-class:hover {
  border-color: color-mix(in srgb, var(--ink) 30%, var(--line));
  box-shadow: 0 1px 0 #fff inset, 0 18px 34px -28px rgba(26, 23, 18, 0.35);
}
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm -C frontend dev`. Expected: the "10 of 50 coins" / "50 of 50 coins" figures and the
activity board's running coin total are visibly larger/heavier than before. Hovering a fare-tier
card shows a subtle border/shadow response, consistent with how the coupon strip and fare-rules
rows already respond to hover.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/landing/landing.css
git commit -m "feat: enlarge fare/activity counters and add hover state to fare-tier cards"
```

---

## Task 7: Update `DESIGN.md` to scope the loosened rules to the landing page

**Files:**
- Modify: `frontend/DESIGN.md` (the "Don't" list around line 333–342, and the "Materials"/"Elevation & Depth" intro framing around lines 239 and 254)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a landing-page scoping note**

In `frontend/DESIGN.md`, immediately after the "### Don't:" list (after line 342, before the closing of the file), add:

```markdown

### Landing-Page Exception

The public landing page (`frontend/app/landing/`) is allowed a small, deliberate exception to
three rules above, in service of the page's job as the product's first impression rather than
a working portal screen:

- An ambient gradient glow behind the hero (`.lp-hero-glow`) is permitted — restricted to the
  hero only, built from the system's own three inks at low opacity, never on text.
- `backdrop-filter` glass is permitted in exactly two places: the sticky nav once scrolled, and
  a light-catch highlight on the activity board — never as a wholesale glassmorphism treatment.
- Section entrance motion (`.lp-enter`, reusing the `.lp-leg` view-timeline idiom) is permitted
  on the fare cards, fare-rule rows, and closing pass, in addition to the strip's existing
  per-leg entrance — still one shared idiom, not a different animation per section.

This exception is landing-page-only. The console shell (promoter, publisher, admin portals)
keeps the rules above exactly as written: printed, not rendered; one authored motion event; no
gradients or glass.
```

- [ ] **Step 2: Verify the doc reads coherently**

Read the full "Do's and Don'ts" section plus the new note back and confirm it doesn't contradict itself (the "Don't" list still stands for the portal; the exception is explicitly scoped).

- [ ] **Step 3: Commit**

```bash
git add frontend/DESIGN.md
git commit -m "docs: scope the no-gradient/no-glass/one-motion-event rules to the console shell, document the landing page's exception"
```

---

## Task 8: `JourneyModal` — click-to-play PiP replay of the journey

**Added mid-implementation** at the user's explicit request for a click-to-play element
("a pip type in landing page where the video will be played on click if anyone wants to know
the journey"). No real video asset exists in this repo (confirmed: no `.mp4`/`.webm`/etc.
anywhere in the tree), consistent with the spec's original decision to replace "promo video"
with an animated sequence rather than fabricate or source real footage. This task builds a
click-to-open, picture-in-picture-style floating panel that autoplays the same four-step
journey (print → scan → signup → ledger) `JourneyFlow` (Task 4) already visualizes on scroll —
here, time-driven instead of scroll-driven, so a visitor can watch it on demand without
scrolling.

**Files:**
- Create: `frontend/app/landing/JourneyModal.tsx`
- Modify: `frontend/app/landing/Landing.tsx` (add a trigger button in the four-coupon section
  head, mount the modal)
- Modify: `frontend/app/landing/landing.css` (new `.lp-journey-modal*` and `.lp-journey-trigger`
  rules — reuses `.lp-journey-point`/`.lp-journey-dot`/`.lp-journey-label`/`.lp-journey-track`/
  `.lp-journey-draw`/`.lp-journey-token` styling from Task 4 rather than duplicating it)

**Interfaces:**
- Produces: `JourneyModal` — a client component, props `{ open: boolean; onClose: () => void }`.
  Self-contained autoplay: while `open`, cycles an `active` index 0→3 on a fixed interval, then
  holds on step 4 briefly before looping back to 0 (matches the "one rehearsed sequence" motion
  philosophy already established for the hero press-run — an authored loop, not raw video).
- Consumes: nothing from Task 4's `JourneyFlow.tsx` at the code level (no shared component —
  the two are visually consistent because they share CSS classes, not because one imports the
  other), avoiding coupling a scroll-gated component to a time-gated one.

- [ ] **Step 1: Write `JourneyModal.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';

const STEPS = [
  { key: 'print', label: 'Print', body: 'Design and export a print-ready QR code.' },
  { key: 'scan', label: 'Scan', body: 'A phone scans it and opens the publisher’s store listing.' },
  { key: 'signup', label: 'Signup', body: 'The user signs up; the install is matched server-to-server.' },
  { key: 'ledger', label: 'Ledger', body: 'The fee posts from campaign budget to the publisher, atomically.' },
] as const;

const STEP_MS = 1800;

export default function JourneyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      setActive((i) => (i + 1) % STEPS.length);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="lp-journey-modal-scrim" onClick={onClose}>
      <div
        className="lp-journey-modal lp-pass-shell lp-stocked"
        role="dialog"
        aria-modal="true"
        aria-label="The scan-to-payout journey"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="lp-journey-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>
        <div className="lp-journey lp-journey-modal-inner">
          {STEPS.map((s, i) => (
            <div className="lp-journey-point" key={s.key} data-active={i === active ? '' : undefined}>
              <span className="lp-journey-dot" />
              <span className="lp-journey-label">{s.label}</span>
            </div>
          ))}
        </div>
        <p className="lp-journey-modal-body">{STEPS[active].body}</p>
      </div>
    </div>
  );
}
```

Note: this component does not import `.lp-journey-line`'s SVG path-draw (that math is specific
to the scroll-gated `JourneyFlow`); the modal shows the four dots/labels stepping through their
active state on a timer, which is simpler and appropriate for a fixed-size floating panel. If
you want the connecting line too, you may add it following the same SVG pattern Task 4 used
(`viewBox="0 0 400 4"`, `stroke-dasharray: 400`, offset driven by `active` instead of
`--reached`) — but it is not required; keep the modal simple unless it's trivial to add
consistently with Task 4's (already-fixed) math.

- [ ] **Step 2: Add the trigger button and mount the modal in `Landing.tsx`**

Add `'use client'` is not needed in `Landing.tsx` itself unless it wasn't already a client
component — check: `Landing.tsx` currently has no `'use client'` directive and is a server
component that composes client components (`ActivityBoard`, `ScanStub`, `JourneyFlow`). The
modal's open/close state must live in a client component. Two options: (a) add
`'use client'` to `Landing.tsx` (simplest, but makes the whole page a client component), or
(b) create a tiny wrapper client component that owns just the trigger button + modal state.
Prefer (b) to keep `Landing.tsx` a server component, consistent with the existing pattern of
isolating client interactivity into small dedicated files (`ScanStub.tsx`, `ActivityBoard.tsx`,
`JourneyFlow.tsx` are all `'use client'`, `Landing.tsx` is not).

Create `frontend/app/landing/JourneyTrigger.tsx`:

```tsx
'use client';
import { useState } from 'react';
import JourneyModal from './JourneyModal';

export default function JourneyTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="lp-btn lp-btn-ghost lp-journey-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">&#9654;</span> Watch the journey
      </button>
      <JourneyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

In `frontend/app/landing/Landing.tsx`, import it:

```tsx
import JourneyTrigger from './JourneyTrigger';
```

Add the button next to the section sub-copy in the four-coupon section (immediately after the
existing `<p className="lp-sub">...</p>` inside `.lp-section-head`, before the closing
`</div>`):

```tsx
          <p className="lp-sub">
            Nothing is charged to you until the fourth. Every stage is a checkpoint the scan has to
            clear, and the money only moves at the end of the strip.
          </p>
          <JourneyTrigger />
        </div>
```

- [ ] **Step 3: Style the modal in `landing.css`**

Add near the end of the `.lp-journey*` block from Task 4 (after the `@media (max-width: 720px)`
rule that hides `.lp-journey`):

```css
.lp-journey-trigger {
  margin-top: 18px;
}
.lp-journey-trigger span { font-size: 11px; }

.lp-journey-modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: color-mix(in srgb, var(--ink) 45%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.lp-journey-modal {
  position: relative;
  width: min(420px, 100%);
  padding: 34px 28px 28px;
}
.lp-journey-modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--stock);
  color: var(--ink-soft);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.lp-journey-modal-close:hover { background: var(--stock-2); color: var(--ink); }
.lp-journey-modal-inner {
  margin-bottom: 20px;
}
.lp-journey-modal-body {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-soft);
  min-height: 44px;
}
```

- [ ] **Step 4: Verify in browser**

Run: `pnpm -C frontend dev`. Expected: a "Watch the journey" ghost button appears below the
four-coupon section's intro copy. Clicking it opens a centered floating panel (picture-in-
picture style) over a dimmed backdrop; the four waypoints step through their active state
automatically every ~1.8s, looping; the body text below changes to match the active step.
Clicking the close button, clicking the dimmed backdrop, or pressing Escape closes it. With OS
reduced-motion on, the panel still opens and the steps are all visible, but they don't
auto-advance (matching `ActivityBoard.tsx`'s existing `matchMedia` reduced-motion pattern for
timer-driven effects — confirm this task's `setInterval` guard follows that same precedent).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/landing/JourneyModal.tsx frontend/app/landing/JourneyTrigger.tsx frontend/app/landing/Landing.tsx frontend/app/landing/landing.css
git commit -m "feat: add click-to-play journey modal (PiP-style) as an on-demand alternative to scrolling"
```

---

## Final Verification

- [ ] **Full manual pass**

Run: `pnpm -C frontend dev`, then walk the entire landing page top to bottom:
1. Hero: gradient glow visible, hero pass parallaxes on scroll, press-run entrance sequence still plays once on load.
2. Nav: gains blur/tint after scrolling past ~130px.
3. Four-coupon section: `JourneyFlow` diagram activates waypoint-by-waypoint as coupons scroll by.
4. Fare-tier section: both cards fade/rise in, counters and meters still animate as before.
5. Fare-rules section: rows fade/rise in on scroll.
6. Close section: closing pass fades/rises in.
7. Toggle OS "reduce motion" (macOS: System Settings → Accessibility → Display → Reduce Motion) and reload: page is fully readable, no animation plays, no layout is broken or content hidden.
8. Resize to ~1000px, ~720px, ~480px: journey diagram hides at 720px, everything else reflows per the existing responsive rules untouched by this plan.
9. "Watch the journey" button opens the PiP modal, auto-advances through all 4 steps and loops, and closes via button/backdrop/Escape.

- [ ] **No new dependencies check**

Run: `git diff main -- frontend/package.json` (or `git diff --stat` against the pre-upgrade commit) — expect no changes to `frontend/package.json`.
