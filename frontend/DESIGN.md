---
name: QR Reward Platform
description: A two-sided QR reward platform dressed as printed ticket stock — coupons, tear lines and stamped fields.
colors:
  paper: "#e7ddc9"
  stock: "#faf6ee"
  stock-sunk: "#f3ecdd"
  thermal-ink: "#1a1712"
  ink-soft: "#4e483a"
  ink-mute: "#6f6757"
  rule: "#d8cbb2"
  rule-soft: "#e6dcc7"
  press-blue: "#1c39bb"
  press-blue-lit: "#2a4ae0"
  press-blue-deep: "#142a8c"
  held-ochre: "#a35c00"
  held-ochre-strong: "#8a4e00"
  held-wash: "#f6ecd8"
  held-edge: "#e3c893"
  posted-green: "#0a6b4a"
  posted-wash: "#e4f0e9"
  posted-edge: "#b6d8c8"
  plate-white: "#ffffff"
  checker: "#eeeeee"
  scrim: "#2a2113"
typography:
  display:
    fontFamily: "Archivo, var(--font-sans), sans-serif"
    fontSize: "clamp(40px, 6.2vw, 80px)"
    fontWeight: 800
    lineHeight: 0.94
    letterSpacing: "-0.036em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Archivo, var(--font-sans), sans-serif"
    fontSize: "clamp(28px, 3.6vw, 42px)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 108"
  page-title:
    fontFamily: "Archivo, var(--font-sans), sans-serif"
    fontSize: "clamp(24px, 3vw, 30px)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.028em"
  auth-title:
    fontFamily: "Archivo, var(--font-sans), sans-serif"
    fontSize: "clamp(26px, 5vw, 34px)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.028em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  control:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  figure:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  figure-compact:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.006em"
  lede:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "-0.006em"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
  micro:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0"
  printed:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.01em"
rounded:
  chip: "4px"
  code: "6px"
  control: "8px"
  panel: "12px"
  pass: "14px"
  notch: "50%"
  track: "999px"
spacing:
  field: "4px"
  tight: "10px"
  snug: "16px"
  rule: "24px"
  block: "32px"
  panel: "40px"
  section: "100px"
components:
  button-primary:
    backgroundColor: "{colors.press-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "11px 20px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.press-blue-lit}"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.thermal-ink}"
    rounded: "{rounded.control}"
    padding: "11px 20px"
  button-ghost-hover:
    backgroundColor: "{colors.stock-sunk}"
    textColor: "{colors.thermal-ink}"
  pass:
    backgroundColor: "{colors.stock}"
    rounded: "{rounded.pass}"
    padding: "44px 42px 40px"
  chip-held:
    backgroundColor: "{colors.held-wash}"
    textColor: "{colors.held-ochre-strong}"
    rounded: "{rounded.chip}"
    padding: "3px 9px"
    typography: "{typography.label}"
  chip-posted:
    backgroundColor: "{colors.posted-wash}"
    textColor: "{colors.posted-green}"
    rounded: "{rounded.chip}"
    padding: "3px 9px"
    typography: "{typography.label}"
---

# Design System: QR Reward Platform

## Overview

**Creative North Star: "The Printed Instrument"**

A QR reward code is not a marketing asset. It is a spending instrument that leaves the building — printed on a boarding pass, a receipt, a seatback card — and cannot be recalled once it is in the world. This system dresses the product as the thing it actually is: ticket stock. Buff card, thermal-black ink, a perforated tear line, a stub that gets scanned, and stamped caps labels over monospace values. Every surface is a coupon, and every number that matters is printed rather than styled.

The palette does the product's accounting. Process blue is validation — the act of a scan being checked and accepted. Ochre is value held back, the guest-tier remainder waiting on a publisher's word. Green is value posted, money that has actually moved. A promoter reading any screen should be able to tell those three states apart without reading a label, because the system never uses one of those inks for another one's meaning.

The rejected alternative was the category default: a dark SaaS gradient hero, a row of identical icon cards, and a logo strip of customers this product does not yet have. That page would have claimed trust. This one demonstrates a mechanism instead.

**Key Characteristics:**
- The stock is a material, not a colour: laid fibre in the card, an uneven wash on the desk, letterpress relief in the display line
- Printed, not rendered — the artifact is a physical ticket, so no gradients, no glass, no glow
- Three inks with fixed jobs: validation, held, posted
- Monospace for every printed field; caps labels stamped above their values
- Perforation and notch as the system's signature geometry
- Motion is one authored event, not decoration

## Colors

Warm buff stock under thermal-black ink, with three saturated inks that each carry one financial meaning and never trade jobs.

### Primary
- **Press Blue Deep** (`{colors.press-blue-deep}`): the printed edge under a press-blue control. It exists only as the 1px bottom edge and contact shade of the primary button, so the button reads as a key seated in the card; it is never a fill or a text colour.
- **Press Blue** (`{colors.press-blue}`): validation ink. The scan sweep across the code, the coupon numerals, the primary action, and any border marking a verified state. It is the ink of "this was checked and accepted."

### Secondary
- **Held Ochre** (`{colors.held-ochre}`): value held back. The guest-tier amount, the partial meter, and the `guest` chip. It reads as warm and provisional against the cool certainty of press blue. Use `held-ochre-strong` for small text — the base tone falls under 4.5:1 at label sizes.
- **Posted Green** (`{colors.posted-green}`): value that has actually moved. Redemption amounts on the board, the verified fare's number and full meter, and the `redeemed` status. Never used for a pending or projected figure.

### Neutral
- **Paper** (`{colors.paper}`): the desk the tickets lie on. Page ground and the fill of every punched notch, so the notch reads as a real hole.
- **Stock** (`{colors.stock}`): the ticket itself. Every pass, panel, strip and board.
- **Stock Sunk** (`{colors.stock-sunk}`): a recessed area on the card — table headers, code chips, ghost-button hover.
- **Thermal Ink** (`{colors.thermal-ink}`): all primary text and printed field values.
- **Ink Soft** (`{colors.ink-soft}`): body copy, descriptions, and any secondary text sitting on the buff ground.
- **Ink Mute** (`{colors.ink-mute}`): stamped caps labels and de-emphasized notes on stock only.
- **Rule** / **Rule Soft** (`{colors.rule}` / `{colors.rule-soft}`): perforations and card edges / internal dividers.

### Named Rules

**The Three Inks Rule.** Blue validates, ochre holds, green posts. A number rendered in the wrong ink is a factual error, not a style choice — a posted amount printed in validation blue tells the reader the money is still in flight.

**The Buff Ground Rule.** `ink-mute` is only legible on `stock` (5.19:1), not on `paper` (4.15:1). Any muted text that sits directly on the page ground steps up to `ink-soft`.

**The Committed Stock Rule.** This world does not follow the OS theme. Surfaces built in it set `color-scheme: light` and restate any inherited token, because a half-inherited dark palette produces invisible text on printed stock.

## Typography

**Display Font:** Archivo (variable, `wdth` axis) with the body stack as fallback
**Body Font:** Inter
**Label/Mono Font:** `ui-monospace` / SF Mono / Menlo

**Character:** Archivo is a grotesque built for high-impact print headlines, run expanded (112% width, weight 800) so headlines read as pressed onto the card rather than set on a screen. Inter carries all reading text. Monospace is reserved for printed field values — codes, amounts, endpoints, durations — which is measurement, not decoration.

### Hierarchy
- **Display** (800, `clamp(40px, 6.2vw, 80px)`, 0.94): the page's single thesis line. One per surface. Drops to 34px below 720px so an authored line break still lands.
- **Headline** (800, `clamp(28px, 3.6vw, 42px)`, 1.04): section openers. Always `text-wrap: balance`.
- **Title** (650, 17px, 1.3): coupon and panel headings.
- **Lede** (400, 16.5px, 1.62): the opening paragraph that carries the mechanism. Capped at 52ch.
- **Body** (400, 15px, 1.6): all explanatory copy. Capped at 66ch.
- **Label** (700, 10px, 0.14em, uppercase): the stamped field name above every printed value.
- **Printed** (mono, 13px): the value under a label, and every code, amount, duration and endpoint.

### Named Rules

**The Stamped Field Rule.** A fact with a name is a field: a 10px uppercase label at 0.14em tracking, and its value in monospace directly beneath. Never a sentence, never a colon.

**The One Display Line Rule.** Exactly one Display-sized line per surface. A second one means neither is the thesis.

## Layout

Content sits in a 1160px measure, inset 48px from the viewport (32px below 720px). Sections are separated by 100px of ground, with the section heading's own block closing 40px above its content — always more space above a heading than below it.

The recurring structure is the pass: a CSS grid of `minmax(0, 1fr) 30px 320px` — coupon, perforation column, stub. Below 1000px it collapses to a single column and the perforation rotates to horizontal, keeping its notches on the left and right edges. Below 720px the stub's contents stack and both call-to-action buttons go full width. Below 480px the navigation drops its secondary action rather than letting the wordmark wrap.

Multi-item runs are one bordered container subdivided by perforations (four coupons at desktop, two at 1000px, one at 720px), never a grid of separate cards.

## Materials

The world is printed, so its surfaces carry the properties of print rather than of screens. Four materials do that work, and each is tied to a fact about the product.

- **Laid fibre** (`--fibre`): a fractal-noise tile at 5.5% opacity, multiplied, on every surface cut from stock — passes, strips, fare cards, the posting board. It sits on a `z-index: -1` pseudo-element inside an isolated stacking context so it tints the card and never the type. Card only; the desk has its own grain.
- **Letterpress relief**: display and section headings carry a white 1px shadow below and a thermal-ink 1px shadow above, so the type reads as struck into the stock under a light from above. It is a relief, never a glow, and never coloured.
- **Guilloché security tint**: two fine repeating-radial rosettes in press blue at 13% opacity, radially masked, under the stub only. It marks the stub as the part of the instrument that carries value, the way a real ticket prints a ground a photocopier cannot hold. It never appears on a coupon.
- **Distressed stamp** (`--distress`): a turbulence alpha mask over a 2px outlined, rotated caps word, at 34% opacity. Reserved for the two financial states — `Held` in ochre, `Posted` in green — struck into the card's own whitespace, never over reading text.

**Press furniture.** Registration crop marks (13px hairline brackets, `rule`, 21px outside the trim) frame a full pass at desktop and are dropped below 1180px where there is no bleed room. Every section opens on a trim rule: a 1px line at 26% thermal ink with its first 26px struck in press blue as the registration tick. The trim rule carries no text — a label above a heading is an eyebrow, and this world does not have those.

### Named Rules

**The Rule-on-Ground Rule.** `rule` is 1.19:1 on the buff ground. Any hairline that must be seen on `paper` rather than on `stock` is drawn at 26% thermal ink instead.

## Elevation & Depth

Paper does not float. Depth comes from the ground being darker than the card, from the punched notch showing ground through the card, and from a single tight cast shadow that reads as a ticket lying on a desk. There is no elevation ramp and no hover lift.

### Shadow Vocabulary
- **Lying on the desk** (`0 1px 0 #fff inset, 0 -1px 0 rgba(26,23,18,.05) inset, 0 1px 2px rgba(26,23,18,.05), 0 10px 18px -14px rgba(26,23,18,.3), 0 44px 64px -42px rgba(26,23,18,.55)`): the pass and the coupon strip. Two inset hairlines give the card a lit top edge and a shaded bottom one; the tight pair is contact and the long, heavily negative-spread cast is the card's shadow on the desk. Never a lift.
- **Seated key** (`0 1px 0 {colors.press-blue-deep}` plus a tinted contact shade): the primary button only. On press the printed edge collapses to zero and the button translates down 1px.

### Named Rules

**The Contact Shadow Rule.** One shadow, on the ticket only. Panels, chips, buttons and boards are flat and rely on a 1px rule for their edge. A glowing or colored shadow belongs to a different world.

## Shapes

Corners are printed-stock radii: 14px on a full pass, 12px on panels and strips, 8px on controls, 6px on the code plate, 4px on chips. The signature geometry is the perforation — a 2px repeating dashed rule (5px on, 6px off) terminated at both ends by a 22px circle filled with the page ground, so the card reads as physically punched. Chips are rectangles with 4px corners because printed fields are rectangular; the pill is not part of this vocabulary.

## Components

### Buttons
- **Shape:** slightly softened rectangle (8px), 11px/20px padding; large variant 14px/26px
- **Primary:** press blue on white text, flat, no shadow
- **Hover / Focus:** hover lifts to `press-blue-lit`; active translates down 1px like a key press; focus is a 2px press-blue outline at 3px offset
- **Ghost:** transparent with an `ink-mute` border — a `rule`-colored border is only 1.19:1 on the buff ground and reads as no border at all — filling to `stock-sunk` on hover

### Chips
- **Style:** 4px rectangle, wash background, matching ink, 1px border, 10.5px uppercase at 700
- **State:** `held` uses ochre on `held-wash`; `posted` uses green on `posted-wash`. The chip states are financial, not decorative.

### Cards / Containers
- **Corner Style:** 14px for a pass, 12px for a panel or strip
- **Background:** `stock` on a `paper` ground
- **Shadow Strategy:** the contact shadow on passes and strips only; panels are flat with a 1px `rule` border
- **Internal Padding:** 44px/42px on a coupon, 32px/30px on a panel, 30px/26px on a coupon in a strip

### Navigation
- Solid `paper` band, sticky, closed by a 1px `rule` bottom edge — never translucent or blurred. Wordmark with a drawn ticket glyph on the left, actions on the right. Below 480px only the primary action survives.

### The Console Shell
Every signed-in portal — promoter, publisher, admin — wears the same two-column shell: a 248px
rail on the left, the section body on the right. The rail is a stub torn off the page: `card`
ground, a perforated inner edge, the org identity stamped at the top, sections grouped under
caps labels, sign-out sitting alone at the bottom. The active item is the only `accent` surface
on the rail. Counts that need acting on ride the item as an ochre badge.

One section is on screen at a time. A portal is never a single scroll of every panel stacked
top to bottom — that is the shape this shell exists to replace. Below 900px the rail becomes a
drawer behind a menu button, over a dimmed ground.

The section body opens with a solid page header: the section title, one line saying what the
section is for, and its actions on the right. Everything below is the section's own content.

### The Pass
The system's signature component: a coupon and a stub joined by a perforation, with notches punched top and bottom. The coupon carries routing fields, the display line and the actions; the stub carries the printed code and its fields. It is used for the opening statement and the closing call, and it is the shape any new full-width surface should reach for first.

### The Posting Board
A bordered panel whose rows each carry a tier chip, a two-line description and a monospace amount. New rows arrive at the top with a short blurred rise (0.5s). Synthetic rows must be labeled in the panel header.

## Motion

**The authored moment: the pass comes off the press.** On load the hero card lands out of a short blur, the three routing fields are stamped in sequence, the display line is struck by a bottom-up wipe, the word the argument turns on arrives as the second plate of the press run (thermal ink to press blue), and the stub prints downward last. One rehearsed sequence, ~1.4s end to end, exponential ease-out, and nothing in it is hidden by default — every element is fully legible with animation off.

**The validation loop.** The scan sweep, the reader's ring on the code plate, and the `awaiting scan → redeemed` flip are one 5.2s cycle. It runs only while the stub is intersecting the viewport, gated by an observer that toggles a `data-run` attribute and never gates content.

**Scroll-linked, where scroll is the mechanism.** Reading progress feeds a press-blue rule through the nav. The coupon strip deals itself out from the tear line. The two fare meters draw to their amounts and their figures count up to meet them, via a registered `<integer>` custom property; the true figures are in the DOM, so browsers without `animation-timeline` show them outright. The tier stamps land on the fare they mark.

Everything above lives inside `prefers-reduced-motion: no-preference`. Sections do not have entrances.

## Do's and Don'ts

### Do:
- **Do** print every fact as a stamped label plus a monospace value.
- **Do** keep the three inks on their jobs: blue validates, ochre holds, green posts.
- **Do** subdivide a run of related items with perforations inside one container.
- **Do** set `color-scheme: light` and restate inherited tokens on any surface built in this world.
- **Do** step muted text up to `ink-soft` whenever it sits on the buff ground.
- **Do** give a surface exactly one authored motion event, tied to the mechanism it explains, and let everything else be feedback or scroll-linked to a real relationship.
- **Do** stop a looping animation when the element it belongs to leaves the viewport.
- **Do** label synthetic or illustrative data in the container that holds it.

### Don't:
- **Don't** use `backdrop-filter`, glass, gradients on text, or a glowing shadow. This world is printed.
- **Don't** build a grid of equally-sized icon-plus-heading cards.
- **Don't** put a kicker or eyebrow above a heading.
- **Don't** give an element a scroll entrance just because it is a section; if every section arrives the same way, none of them arrived.
- **Don't** animate something the reader will never see running — a scroll-linked effect below the fold needs `animation-timeline: view()`, not a load-time duration.
- **Don't** claim customers, logos, testimonials or traction. There are none to show yet.
- **Don't** use a pill radius for a printed field or state chip.
- **Don't** rule under a word for emphasis. At display size a full-width rule reads as a hyperlink; emphasis is the second ink.
- **Don't** let a stamp fall across reading text or clip off the card edge — it is struck into whitespace the layout reserves for it.

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
