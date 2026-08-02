# Landing Page Upgrade — "Bolder Ticket"

## Context

`frontend/app/landing/` (`Landing.tsx`, `ActivityBoard.tsx`, `ScanStub.tsx`, `CodeMark.tsx`,
`landing.css`) implements the current landing page under the "Printed Instrument" design
system documented in `frontend/DESIGN.md`: a printed-ticket metaphor (buff card stock,
thermal ink, perforations, three fixed-meaning inks), deliberately free of gradients, glass,
and decorative motion, with a hard rule against fabricated logos/testimonials/traction.

The user wants the page to feel more impressive and communicate the product's journey more
richly — richer animation, more visual "wow," and a promo-video-style element — even where
that means loosening `DESIGN.md`'s current restrictions. This is a visual/motion upgrade, not
a copy or information-architecture change: the five existing sections (hero, four-coupon flow,
guest/verified tiers, fare rules, closing CTA) stay as-is structurally.

## Goals

- Make the page feel like a funded, polished product launch, not a print-shop mockup.
- Communicate the promoter → scan → publisher → ledger journey more vividly than static text/cards.
- Add real, felt motion: entrances, scroll storytelling, hover/interaction feedback.
- Do this without a real video asset (none exists) and without fabricating customer proof
  (logos, testimonials, real traction numbers) — illustrative stats stay clearly labeled as
  example data, per user decision.
- No new npm dependencies. The existing codebase already implements custom counters,
  scroll-progress, and gated looping animation by hand (see `ScanStub.tsx`,
  `ActivityBoard.tsx`, and the `<integer>` custom-property counters in `landing.css`) — this
  upgrade extends that same native-CSS/vanilla-JS approach rather than pulling in
  framer-motion, GSAP, or similar.

## Non-Goals

- No new sections, no pricing, no FAQ, no comparison table.
- No real video embed (nothing to embed).
- No fabricated customer logos, testimonials, or real traction figures.
- No changes to `frontend/app/landing/*` data-fetching or routing behavior — this is presentation-layer only.
- Not touching the console shell / portal design system (promoter, publisher, admin) — scope is the public landing page only.

## Design

### 1. Visual direction

Keep the ticket/coupon identity (it's the product's real differentiator per `DESIGN.md`'s own
rationale) but relax the "printed, not rendered" restriction specifically for the landing
page:

- **Animated hero backdrop**: a slow-moving, low-saturation gradient mesh (radial/conic
  gradients, animated via CSS `background-position`/custom-property keyframes, no JS/canvas)
  behind the hero pass, using the existing press-blue/ochre/posted-green palette at low
  opacity so it still reads as "this product's" colors, not generic purple-blue SaaS.
- **Depth**: a subtle parallax offset on the hero pass and stub (translate on scroll via a
  single scroll listener with `requestAnimationFrame`, or `animation-timeline: scroll()` where
  supported, static fallback otherwise).
- **Glass accents**: light `backdrop-filter` blur permitted now, used sparingly — e.g. behind
  the sticky nav on scroll, and as a soft highlight edge on the activity board — not as a
  wholesale glassmorphism reskin.
- Everything else in `DESIGN.md` (three-ink rule, typography, layout grid, perforation
  geometry) stays as the visual foundation; this is additive richness, not a rebrand.

### 2. Journey centerpiece (replaces "promo video")

New component in the "One scan, four coupons" section: an animated flow diagram that plays out
as the user scrolls through the four `LEGS` coupons already in `Landing.tsx`.

- A connecting path (SVG `<path>` with `stroke-dasharray`/`stroke-dashoffset`) links four
  waypoints: QR/print icon → phone/scan icon → publisher/signup icon → ledger/coin icon.
- Path draw progress and per-waypoint activation are driven by scroll position of the
  `.lp-strip` section (`IntersectionObserver` per coupon, matching the existing `ScanStub`
  gating pattern — no new observer pattern invented).
- When a waypoint activates, a small coin/token glyph animates along the path to it, and the
  corresponding coupon card gets a highlighted state (border/ink accent already defined by the
  three-ink rule — blue for scan/validate, green for the ledger post).
- Fully legible with motion off: all four coupons render complete and readable with no
  animation, same guarantee the current hero press-run sequence already makes.
- This is the "show, don't tell" journey visualization that stands in for a promo video,
  reusable as a self-contained component (`JourneyFlow.tsx`) so it's testable/adjustable independent of copy.

### 3. Motion inventory

| Element | Motion | Trigger |
|---|---|---|
| Hero gradient mesh | slow ambient drift | always-on (loop), paused off-screen |
| Hero pass / stub | parallax translate | scroll position |
| Section headings/cards | fade + rise entrance | `IntersectionObserver`, once per element |
| Journey flow diagram | path draw + waypoint activation | scroll position within section |
| Fare meters / counters | existing `<integer>` count-up, kept, made more prominent visually | existing (in-view) |
| Nav | blur-in on scroll (glass accent) | scroll position |
| Buttons/cards | hover micro-interaction (existing key-press pattern extended to more elements) | hover/focus |

All motion respects `prefers-reduced-motion: reduce` (existing pattern in `ActivityBoard.tsx`
and `ScanStub.tsx` — checked via `matchMedia` for JS-driven motion, `@media` for CSS-only). Looping
animations stop when their element leaves the viewport (existing `data-run` gating pattern in
`ScanStub.tsx` is reused, not reinvented).

### 4. Content changes

None structurally. Illustrative stats (activity board totals, fare meter numbers) get more
visual prominence — larger counters — but stay labeled "Example data" exactly as today.

### 5. Technical approach

- New file: `frontend/app/landing/JourneyFlow.tsx` (client component, mirrors `ScanStub.tsx`'s
  `IntersectionObserver` pattern) + supporting styles appended to `landing.css`.
- Extend `landing.css` with the gradient-mesh, parallax, and entrance-animation rules; extend
  `Landing.tsx` to mount `JourneyFlow` inside the four-coupon section and to add the
  scroll-entrance class hooks to existing sections.
- A single shared `useInView` hook (or small utility) may be extracted if the same
  `IntersectionObserver`-gating logic is needed in 3+ places, to avoid copy-pasting it — this
  is the one abstraction this upgrade justifies, since the pattern already exists twice
  (`ScanStub`, `ActivityBoard`) and would go to 4+ places.
- No new npm packages. No changes outside `frontend/app/landing/` and `frontend/DESIGN.md`
  (which gets updated to reflect the loosened landing-page-specific rules — see below).

### 6. DESIGN.md update

`DESIGN.md` currently states rules ("no gradients, no glass", "motion is one authored event")
as system-wide. Since this upgrade intentionally loosens them for the landing page, the spec
implementation should add a short note in `DESIGN.md` scoping those specific rules to the
console shell (portal) surfaces, and documenting the landing page's own richer-motion allowance
— so the design doc stays accurate rather than silently wrong.

## Testing / Verification

- Manual: `pnpm --filter qrreward-frontend dev`, view landing page, verify:
  - All content renders and is readable with animations disabled (OS-level reduced-motion) and with JS disabled (SSR content).
  - Scroll-linked effects fire correctly across breakpoints (desktop, ~1000px, ~720px, ~480px — the existing responsive breakpoints in `landing.css`).
  - No layout shift / CLS introduced by entrance animations (elements reserve their layout space before animating in).
- No automated test suite exists for this frontend beyond backend's own tests; this stays a manual-verification UI change per repo convention.
