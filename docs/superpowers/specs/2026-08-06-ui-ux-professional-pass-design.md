# UI/UX professional pass — landing, portals, auth

Date: 2026-08-06
Status: approved design, ready for planning

## Problem

The frontend is stranded mid-migration. `globals.css`, `tw.ts`, `shell.tsx`, `pass.tsx` and
`layout.tsx` were converted to a modern light-SaaS system (neutral surfaces, real elevation,
Inter, one accent). The landing page never came with them, and the signed-in console was
restyled without ever being reworked.

Three separate problems, one pass:

1. **The landing page still wears a skin that was deleted.** It references design tokens that
   are now `none` and a font that is no longer loaded.
2. **The console's visual system is good; its workflows are not.** Creation forms are permanent
   page furniture, a spend product shows no time dimension, and loading/empty states are
   one-size.
3. **Auth is the least finished surface in the product**, and it holds the single irrecoverable
   moment in the whole system (the publisher API key, shown once).

## Decisions taken

| Decision | Choice |
|---|---|
| Landing direction | Convert to the portals' modern-SaaS language. Keep the argument, drop the press metaphor. |
| Portal scope | Full redesign — workflows, not just paint. |
| Dark mode | Out of scope, but all hardcoded colour is tokenised so it becomes a later flip rather than a rewrite. |
| Charts | Hand-rolled inline SVG. No charting dependency. |
| Design system | Keep and extend `tw.ts`. No component library. |
| Backend | No changes. Every chart and state below is feedable from the current API. |

## Non-goals

- Dark mode implementation.
- Replacing `tw.ts` with shadcn/Radix or any component library.
- Rewriting the generic `Table<T>` in `app/admin/page.tsx`.
- Any backend or API change.
- Password reset. **No such endpoint exists** (`backend/src/modules/auth/auth.controller.ts`
  exposes only `signup` and `login`), so no "Forgot password?" affordance may be added.

---

## 1. Foundation — token hygiene

`globals.css` keeps its structure. The work is removing the residue of the deleted paper world
so colour and type are single-sourced.

### Delete

- `--grain`, `--fibre`, `--distress`, `--guilloche` in `globals.css` `:root`. All are `none`.
  Every utility that reads them paints nothing:
  - `lp.stocked` (`lib/lp.ts:19`) — a no-op `::before` on 6 landing elements
  - `lp.stub`'s security tint (`lib/lp.ts:137`)
  - `lp.fareStamp`'s `[mask-image:var(--distress)]` (`lib/lp.ts:305`)
- `--font-display` (`globals.css:54`) and every `[font-stretch:…]` in `lib/lp.ts` (lines 116,
  216, 299). Archivo was removed from `app/layout.tsx`; Inter has no width axis, so these are
  no-ops that read as design intent.
- `--shadow-notch` (`globals.css:79`), once the notches go (§2).
- `Perf()` in `lib/pass.tsx:78` — returns `null`. Remove the component and its call sites in
  `app/login/page.tsx`, `app/not-found.tsx`, `app/campaign-ended/page.tsx`.

### Replace with tokens

| Hardcoded value | Location | Becomes |
|---|---|---|
| `rgba(26,23,18,…)` ×4 | `lib/lp.ts:118, 146, 254, 293` | `--color-ink`-derived shadow tokens |
| `#2a2113` dialog backdrop | `lib/ui.tsx:245` | `--color-ink` via `color-mix` |
| `bg-white` | `lib/tw.ts:322`, `lib/lp.ts:145` | `bg-card` |
| `rgba(255,255,255,…)` letterpress | `lib/lp.ts:118, 121, 218` | deleted outright (§2) |

Acceptance: `grep -rn 'rgba(26,23,18\|#2a2113\|font-stretch\|--fibre\|--distress\|--guilloche\|--grain' frontend/lib frontend/app` returns nothing.

### Add

A shared display type scale in `@theme`, so landing and console stop each spelling `clamp()`
inline. Landing uses the top of the scale, console the bottom — one scale, two ranges.

---

## 2. Landing page

**Keep:** the headline ("Pay for signups, not for scans"), the lede, the four-step story, the
two-rate explanation, the controls list, `ActivityBoard`, and the scroll-driven motion in
`landing.css` (`animation-timeline: view()` — modern, cheap, and already reduced-motion
guarded).

**Cut:**

| Element | Location | Why |
|---|---|---|
| `cropped` crop marks | `lib/lp.ts:29` | press registration furniture with no press |
| `perf` / `notchTop` / `notchBottom` | `lib/lp.ts:44-55` | a tear line with nothing torn — `--perf-*` is now a flat hairline, so it renders as two circles on a straight rule |
| letterpress `text-shadow` | `lib/lp.ts:118, 121, 218` | emboss on a flat `#f7f8fa` ground reads as blur |
| `fareStamp` rotated distressed stamps | `lib/lp.ts:302` | ticket furniture; the meters already carry the state |
| `footPress` "Stock 04 · Press 01" | `lib/lp.ts:356`, `Landing.tsx:310` | fictional press marks |
| `stocked` | `lib/lp.ts:19` | paints nothing (§1) |

**Copy changes** — the metaphor leaves the words too:

- "One scan, four coupons." → "One scan, four checkpoints."
- `Coupon 01`…`Coupon 04` → `01`…`04`
- "Two fares for the same seat." → "Two rates for the same signup."
- "Fare rules, printed on the back." → "The controls on a code you can't recall."
- `LEGS`/`RULES`/fare naming in `Landing.tsx` stays as internal identifiers; only user-visible
  strings change.

**Add — the audience split.** The page is promoter-first; the publisher appears only as a
footnote in the closing panel (`Landing.tsx:295-304`). Publishers are half the marketplace. A
new two-column section gives each role its own path, sitting between the two-rate section and
the controls list.

**Structural result:** `lib/lp.ts` stops being a parallel design system and becomes a thin
editorial layer over `lib/tw.ts` — importing `btn`, `card`, `pill` and the shared type scale
rather than redefining them (`lp.btn`/`lp.btnGhost` at `lib/lp.ts:79-92` currently duplicate
`tw.btn`/`tw.btnGhost` with different geometry).

---

## 3. Console — shared primitives

Added once to `lib/tw.ts` / `lib/ui.tsx` rather than per page. Each replaces something
currently spelled inline and inconsistently.

### `Meter`

A capacity/burn bar. Colour comes from the state logic already written at
`app/dashboard/page.tsx:436` (`bad` at zero, `warn` under 10, `ink` otherwise) — that logic
moves into the primitive so it stops being per-call-site.

### `Spark`

Inline SVG sparkline, ~40 lines. Takes `number[]`, renders a polyline in `--color-accent` with
a soft area fill. No axes, no tooltip — a trend mark, not a chart.

### `Split`

Stacked horizontal bar for guest vs verified. Two segments, `warn-lit` and `ok`, matching the
colours the landing page already assigns those two states.

### `Empty`

Mark + line + optional action. Replaces the bare `empty` class string (`lib/tw.ts:142`) used at
6 call sites, each currently rendering one sentence in a box with no action.

### `SkeletonTable` / `SkeletonStrip` / `SkeletonCard`

Replaces the single `Loading` component (`app/dashboard/page.tsx:44`), which currently shimmers
identically whether the thing arriving is a table, a stat strip, or a form. Each variant mirrors
the shape of what it stands in for.

### `formDialog`

Extends the existing module-level dialog store in `lib/ui.tsx` (which already backs
`confirmDialog` and `promptDialog`) to accept a field list. This is what lets creation forms
stop being permanent page furniture.

---

## 4. Console — data & workflow

### Chart feasibility

Verified against `lib/types.ts`. No backend change required.

| Chart | Source | Exactness |
|---|---|---|
| Campaign burn-down | `CampaignStats.coins_granted + budget_remaining` = funded total | exact |
| Scans / redemptions over time | bucket `created_at` client-side | **capped** — `/v1/redemptions` returns newest 100 |
| Guest vs verified | `Redemption.identified`; admin uses `AdminOverview.identified_redemptions` / `guest_redemptions` | exact on admin, derived on dashboard |
| Conversion | `AdminOverview.conversion_rate`; `CampaignStats.scans` vs `redemptions` | exact |

**Honesty constraint.** Anything derived from `/v1/redemptions` is a floor, not a total. The
codebase already has this instinct (`app/dashboard/page.tsx:193-195` prints `100+` and `≥`
rather than overstating). Every chart fed from that endpoint must carry the same qualifier.

**Denominator limit.** The dashboard campaign list receives `Campaign`, which carries `budget`
(remaining) but no funded total. A true burn-down is therefore impossible on the list. List
cards get a **capacity** meter (signups the remaining budget still covers); true burn-down
lives on the campaign detail page, where `CampaignStats` supplies both halves.

### Dashboard (`app/dashboard/page.tsx`)

- "New campaign" (`:529`) and "Request a publisher partnership" (`:297`) move out of permanent
  page furniture into `formDialog`. Both currently sit below their own list, on screen forever.
- The `actions` prop scroll-to-anchor hack (`:225`) is deleted with them — it exists only to
  reach a form that will no longer be on the page.
- Overview gains a `Spark` (redemptions over time) and a `Split` (guest vs verified), both
  labelled with the 100-row cap.
- Campaign cards gain the capacity `Meter`; the colour logic at `:436` moves into it.
- Every `Loading` call picks the variant matching its section.
- Every empty state becomes `Empty` with an action.

### Campaign detail (`app/campaigns/[id]/page.tsx`)

- Real burn-down meter from `CampaignStats`.
- Scans → redemptions funnel, using the exact conversion figure.
- The design studio (`:676`) keeps its structure; it is the most finished surface in the app.

### Admin (`app/admin/page.tsx`)

- Overview figures gain `Spark` and `Split`.
- `Table<T>` keeps its shape and gains proper `Empty` / skeleton states.
- `LedgerHealth` (`:316`) keeps its banner treatment.

---

## 5. Auth — login, signup, API key

The least finished surface, and the one holding the product's only irrecoverable moment.

### Problems

| Problem | Location |
|---|---|
| Side panel is theatre — prints `Instrument`, `Mode`, and a hardcoded fake serial `Ser. 7f3a-c19e`, restating the tab just clicked | `app/login/page.tsx:207-218` |
| Submit disabled only on `busy`, never on empty fields — an empty signup posts and returns a server error | `app/login/page.tsx:200` |
| Password minimum (8 chars, `auth.controller.ts:63`) is enforced only server-side, surfaced as a red box after failure | `app/login/page.tsx:193` |
| Promoter vs Publisher — the product's biggest fork — is a tab strip mid-form, below org name | `app/login/page.tsx:151-171` |
| Signup swells from 2 fields to 5 in the same card, lurching its height | `app/login/page.tsx:147` |
| Demo credentials silently prefill with no explanation | `app/login/page.tsx:54-55` |
| API key screen: shown once and never again, but no copy button, no download, and `Continue` is not gated on acknowledgement | `app/login/page.tsx:105-123` |

### Design

**Role first.** Signup opens on a two-card role choice — Promoter or Publisher, each stating
what that account does — and only then shows the form. This removes the mid-form tab strip and
means the form no longer changes shape under the user.

**Real side panel.** The `Stub` stops narrating the UI and carries the reason to be here: what
the product does, and what this specific role gets. The fake serial is deleted.

**Client-side validation before submit.** Required fields marked, submit disabled until valid,
password minimum stated up front rather than discovered by failing. A show/hide password toggle.

**Demo credentials labelled.** When `NODE_ENV !== 'production'` prefills the form, say so
inline. The compile-time guard at `:32` is correct and stays.

**The API key screen becomes a real handoff.** It is the one screen in the product whose content
cannot be recovered:

- Copy-to-clipboard button with confirmation
- Download as `.txt`
- `Continue` gated behind an explicit "I've stored this key" checkbox
- Explicit statement that the server holds only a hash and cannot show it again — which the
  dashboard already tells users at `app/dashboard/page.tsx:662`, too late to help

**No password reset.** The endpoint does not exist. No link is added.

---

## Acceptance

- No reference to a deleted token remains (grep in §1).
- Landing page and console share one type scale and one colour source.
- No hardcoded *theme* colour outside `globals.css`. User-chosen QR colours in `lib/qr.ts` and
  `app/campaigns/[id]/page.tsx` are data, not theme, and are exempt.
- Every chart fed by `/v1/redemptions` states the 100-row cap.
- Signup cannot be submitted empty; password minimum is stated before submit, not after.
- API key cannot be dismissed without explicit acknowledgement.
- `pnpm build` and `frontend/test/units.test.ts` pass.
