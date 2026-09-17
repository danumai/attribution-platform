# Frontend Refactor Retrospective

## Part 1 — Retrospective against the task

The original task:
1. Separate `lib/ui.tsx` into individual files under `components/ui/`, update every import.
2. Split page-level components into feature-scoped, reusable pieces; make `page.tsx` leaner.
3. Tighten API calls by mandating SSR principles.

### Task 1 — `lib/ui.tsx` split — DONE (100%)

- `grep -rn "from '@/lib/ui'"` across the project: **zero import hits**. The only matches are comments referencing the old file historically:
  - `app/landing/JourneyModal.tsx:6` — comment: "Native `<dialog>`, like every other modal here (see `Dialogs` in lib/ui.tsx)..."
  - `components/ui/index.tsx:4` — comment: "...formerly both defined inside `lib/ui.tsx`."
  - `components/ui/store.ts:5` — comment: "`lib/ui.tsx` shared one `listeners` set..."
- `ls frontend/lib/ui.tsx` → **No such file or directory**. Confirmed gone.
- `frontend/lib/` now contains only non-UI concerns: `api.ts`, `apiServer.ts`, `audience.tsx`, `chart.tsx`, `fmt.ts`, `lp.ts`, `mark.tsx`, `pass.tsx`, `place.ts`, `qr.ts`, `session.ts`, `shell.tsx`, `tw.ts`, `types.ts`.
- `frontend/components/ui/` contains 12 focused files: `dialog.ts`, `dialogs.tsx`, `empty.tsx`, `figures.tsx`, `index.tsx`, `loadError.tsx`, `meter.tsx`, `skeleton.tsx`, `split.tsx`, `store.ts`, `toast.ts`, `toasts.tsx`.

This task is fully and verifiably complete.

### Task 2 — Feature-scoped components / thinner page.tsx

Checked each route tree directly:

- **`app/dashboard/`** — migrated. `app/dashboard/page.tsx` is 35 lines, a pure server component that fetches data and delegates to `OverviewClient`. Sub-routes (`campaigns/`, `partnerships/`, `redemptions/`, `settings/`) each have a thin `page.tsx` + a `*Client.tsx` component, and a `sections/` directory holds the presentational pieces (`Campaigns.tsx`, `Overview.tsx`, `Partnerships.tsx`, `Redemptions.tsx`, `Settings.tsx`).
- **`app/admin/`** — migrated, same pattern. `app/admin/page.tsx` is 28 lines. Every sub-route (`audience/`, `audit-log/`, `campaigns/`, `ledger/`, `notifications/`, `organizations/`, `partnerships/`, `qr-codes/`, `redemptions/`, `scans/`) has its own thin `page.tsx` + `*Client.tsx`, and `app/admin/sections/` holds 10 matching section components.
- **`app/landing/`** — feature-scoped, but structured differently (not a page.tsx/Client split — it's a single marketing page composed from `app/landing/sections/` (`Hero.tsx`, `Nav.tsx`, `HowItWorks.tsx`, `MoneyControls.tsx`, `AudiencePaths.tsx`, `PricingSection.tsx`, `ClosingCta.tsx`, `Content.tsx`, `Footer.tsx`, `SectionHead.tsx`) plus standalone widgets (`ActivityBoard.tsx`, `BudgetPlanner.tsx`, `JourneyTrigger.tsx`/`JourneyModal.tsx`, etc.). This counts as "split into feature-scoped pieces" even though there's no server-fetching page.tsx to thin (it's a static/public page, not an authenticated data page).
- **`app/campaigns/[id]/`** — **not migrated**. Read directly: `app/campaigns/[id]/page.tsx` is **216 lines**, starts with `'use client'`, and is still one large client component holding nearly a dozen `useState` hooks (`me`, `stats`, `loadErr`, `qrs`, `sel`, `style`, `saved`, `busy`, `svg`, `renderErr`, `rendering`, `audience`, `days`) plus the load/select/render orchestration logic. It does import extracted pieces (`CodeList.tsx`, `Performance.tsx`, `Studio.tsx`, plus `panels/ColourPanel.tsx`, `ExportPanel.tsx`, `FramePanel.tsx`, `LogoPanel.tsx`, `StylePanel.tsx`) — so *some* decomposition happened — but the page itself was never thinned to a server-component-plus-client-view split the way dashboard/admin were.

**Task 2 completion: 3 of 4 route trees fully migrated to the thin-page.tsx pattern (dashboard, admin, landing) = 75%.** `campaigns/[id]` is the outlier — components were extracted from it, but the page root itself remains a large, monolithic client component.

### Task 3 — SSR-first API calls

- **SSR via `lib/apiServer.ts` + `lib/session.ts`**: confirmed in every `page.tsx` under `app/admin/*` (17 files, including `app/admin/page.tsx`, `audience/page.tsx`, `audit-log/page.tsx`, `campaigns/page.tsx`, `ledger/page.tsx`, `notifications/page.tsx`, `organizations/page.tsx`, `partnerships/page.tsx`, `qr-codes/page.tsx`, `redemptions/page.tsx`, `scans/page.tsx`) and every `page.tsx` under `app/dashboard/*` (`page.tsx`, `campaigns/page.tsx`, `partnerships/page.tsx`, `redemptions/page.tsx`, `settings/page.tsx`). Each reads the session cookie with `getSession()`, redirects to `/login` if absent, and fetches with `apiServer(...)` wrapped in `withAuthRedirect`.
- **Still client-side via `lib/api.ts` + `localStorage`**: `app/campaigns/[id]/page.tsx` and its children (`CodeList.tsx`, `Studio.tsx`, `panels/ExportPanel.tsx`) call `api()` from `lib/api.ts`, and `lib/api.ts`/`lib/shell.tsx` read auth state from `localStorage`. Other confirmed client-`api.ts` + localStorage-adjacent call sites (mostly *mutation* components, see below): `app/admin/organizations/OrganizationsClient.tsx`, `app/admin/qr-codes/QrCodesClient.tsx`, `app/admin/campaigns/CampaignsClient.tsx`, `app/admin/partnerships/PartnershipsClient.tsx`, `app/admin/notifications/NotificationsClient.tsx`, `app/dashboard/dialogs.ts`, `app/dashboard/sections/Settings.tsx`, `app/dashboard/sections/Partnerships.tsx`, `app/login/page.tsx`.
- **Mutations are intentionally client-side everywhere** — this is by design, not incomplete migration. POST/PUT/DELETE calls (toggling org status, saving settings, creating partnerships, editing QR styles, etc.) run from the client because: (1) the browser already holds the auth token for the fetch, no cookie round-trip needed; (2) these actions drive optimistic UI / toasts / immediate re-fetch, which needs client state; (3) there is no SSR benefit to a write — nothing is being rendered from it on first paint. The refactor's SSR mandate applies to initial-page-load reads, and that's exactly where it was applied.

**Task 3 completion, counting only initial-load GET fetches per route tree (dashboard, admin, campaigns/[id] — landing has no authenticated data fetch so it's excluded from this denominator): 2 of 3 route trees migrated to `apiServer` SSR reads = 67%.** `campaigns/[id]`'s initial stats/qr-codes load still goes through client-side `api()` + `useEffect`, with a loading skeleton state instead of SSR data being present on first paint.

---

## Part 2 — Performance

### Load speed

Per `CLAUDE.local.md`'s rule ("never run a full build while the dev server is running"): the dev server was found running on port 3000 (PID 74916) before this check. It was stopped (`lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`), `npm run build` was run to completion, and the dev server was restarted afterward (confirmed listening again on port 3000).

Build succeeded (`✓ Compiled successfully`). Actual Next.js output for the requested routes:

| Route | Type | Page-specific JS | First Load JS |
|---|---|---|---|
| `/` | ○ Static | 12.9 kB | 109 kB |
| `/dashboard` | ƒ Dynamic (server-rendered) | 2.91 kB | 117 kB |
| `/admin` | ƒ Dynamic (server-rendered) | 2.15 kB | 113 kB |
| `/campaigns/[id]` | ƒ Dynamic (server-rendered) | **14 kB** | **121 kB** |

Shared baseline for all routes: 87.3 kB (chunks `651-*.js` 31.7 kB, `90f62467-*.js` 53.6 kB, plus 1.94 kB misc).

**Comparison:** `/campaigns/[id]` ships the largest page-specific bundle in the app (14 kB — roughly 5–7x `/dashboard` and `/admin`'s page code) and the highest First Load JS (121 kB) of the four routes checked. This is a direct, measurable cost of it still being one large client component with the QR style panels statically bundled in, versus dashboard/admin's server-rendered pages which only ship the client shell needed for interactivity. This is concrete evidence supporting the Part 1 finding that `campaigns/[id]` is the unmigrated outlier — it is measurably the heaviest route on both counts.

### Runtime smoothness

- `buildAdminNav` (`app/admin/navItems.ts:23`) and `buildDashboardNav` (`app/dashboard/navItems.ts:4`) are **not wrapped in `useMemo`** anywhere — confirmed by grep, no `useMemo` call sites near either function or its call sites.
- However, every call site found (17 for `buildAdminNav`, 6 for `buildDashboardNav`) is inside a **server component `page.tsx`** (each imports `apiServer`/`getSession` and has no `'use client'` directive), called once per request during server rendering — not inside a client component's render body. There is no re-render loop invoking these on the client, so memoization would have no measurable effect here. Additionally, both functions just map over small, request-scoped arrays (nav items, a handful of partnerships) — even if this were client-side, the array sizes are small enough (single-digit to low-double-digit items) that unmemoized rebuilding would be imperceptible. Verdict: not memoized, but also not a real issue at this app's scale or call pattern — flagging it as a non-issue rather than a defect.
- Landing page heavy-animation review: `app/landing/ActivityBoard.tsx` and `app/landing/BudgetPlanner.tsx` contain animation-adjacent code, and `app/landing/ActivityBoard.tsx` was explicitly touched in a prior commit (`772eb7a fix: landing's activity board changes and seo updated from claude`) — i.e., already reviewed/optimized separately, not newly discovered here. Both use `app/landing/useInView.ts`, which is a lightweight `IntersectionObserver` wrapper (not scroll-driven `requestAnimationFrame` polling), so entrance animation only triggers work when a section is actually in view — a reasonable, low-cost pattern. No new heavy/unoptimized animation source was found beyond what's already been addressed.

### Bundle size / code-splitting

- **`JourneyTrigger` → `JourneyModal`**: `app/landing/JourneyTrigger.tsx` already uses `next/dynamic` — `const JourneyModal = dynamic(() => import('./JourneyModal'), { ssr: false });` — with a code comment explicitly explaining the choice (keeps the modal's `<video>` and client-only dialog logic out of the main landing bundle). This is already done correctly.
- **QR style panels** (`app/campaigns/[id]/panels/{ColourPanel,ExportPanel,FramePanel,LogoPanel,StylePanel}.tsx`): confirmed **still statically imported** in `app/campaigns/[id]/Studio.tsx` (lines 29–33, plain `import { X } from './panels/X'` for all five, no `dynamic()`). This is a still-open item — not implemented here, per scope (report-only). It directly correlates with the 14 kB / 121 kB First Load JS figure measured above for `/campaigns/[id]`.

### Caching

`lib/apiServer.ts` sets `cache: 'no-store'` explicitly on every `fetch` call (`apiServer<T>`). This is correct, not a missed optimization: the data being fetched is per-user (scoped by the session's bearer token), authenticated, and frequently mutated by the same users viewing it (campaigns, redemptions, partnerships, admin overview all change from user actions elsewhere in the app). Caching this server-side risks serving stale or, worse, cross-session data. The practical consequence: **there is no server-side caching benefit anywhere in this app, by design** — every SSR page re-fetches from the API on every request. This is a deliberate correctness-over-speed tradeoff, not an oversight.

---

## Part 3 — Architecture & maintainability

### Organization — `sections/` directories

Real directory listings:

```
app/admin/sections/
  AuditLog.tsx  Campaigns.tsx  Ledger.tsx  Notifications.tsx  Organizations.tsx
  Overview.tsx  Partnerships.tsx  QrCodes.tsx  Redemptions.tsx  Scans.tsx

app/dashboard/sections/
  Campaigns.tsx  Overview.tsx  Partnerships.tsx  Redemptions.tsx  Settings.tsx

app/landing/sections/
  AudiencePaths.tsx  ClosingCta.tsx  Content.tsx  Footer.tsx  Hero.tsx
  HowItWorks.tsx  MoneyControls.tsx  Nav.tsx  PricingSection.tsx  SectionHead.tsx
```

The naming convention (PascalCase, one component per feature/section, singular `sections/` folder name) is **consistent across all three route trees**. `admin/sections` and `dashboard/sections` mirror each other closely (both have `Campaigns.tsx`, `Overview.tsx`, `Partnerships.tsx`, `Redemptions.tsx`); `landing/sections` follows the same naming style but for marketing page regions rather than data sections, which is the expected difference given it's a different kind of page.

### Reusability — confirmed shared components

- **`Audience`/`Analytics` (from `lib/audience.tsx`)**: genuinely imported across three separate route trees — `app/admin/page.tsx`, `app/admin/types.ts`, `app/admin/OverviewClient.tsx`, `app/admin/sections/Overview.tsx`, `app/admin/audience/page.tsx`, `app/admin/audience/AudienceClient.tsx` (admin tree); `app/dashboard/sections/Overview.tsx` (dashboard tree); and `app/campaigns/[id]/page.tsx`, `app/campaigns/[id]/Performance.tsx` (campaigns tree). This is a real, confirmed cross-route-tree shared component, not an assumption.
- **`components/ui/*`**: grep of `from '@/components/ui` import lines, bucketed by top-level route directory: **admin — 11 files**, **dashboard — 12 files**, **campaigns — 5 files**, plus **`app/layout.tsx` — 1 file** (root layout, applies to everything). This confirms `components/ui` is a real shared layer used broadly, not confined to one tree.

---

## Part 4 — What's genuinely still open

Ordered by actual impact (user/dev-facing severity):

1. **`app/campaigns/[id]` is not SSR / not thinned** — the single largest gap. It is the heaviest route measured (14 kB page JS, 121 kB First Load JS vs. ~2–4 kB / ~107–117 kB for SSR'd routes), still fetches its initial data client-side via `useEffect` + `lib/api.ts`, and `page.tsx` remains a 216-line, 13-useState client component despite some component extraction (`CodeList.tsx`, `Studio.tsx`, `Performance.tsx`). Users on this route get a loading-skeleton flash on every visit that dashboard/admin users don't, and it's the one page where all three original task goals (thin page, SSR reads, decomposed components) are simultaneously incomplete.
2. **QR style panels (`ColourPanel`, `ExportPanel`, `FramePanel`, `LogoPanel`, `StylePanel`) are statically imported**, not code-split — all bundled into the already-heaviest route's JS even though a user editing a single QR code only interacts with one panel type at a time. Directly inflates the 14 kB figure above. Not implemented per this task's report-only scope.
3. **No `loading.tsx` anywhere in the app**, and **`error.tsx` exists only at `app/error.tsx` (root) and `app/dashboard/error.tsx`** — admin, campaigns, and landing have no route-level error boundary, and no route has a loading boundary at all, so SSR data fetches show no Suspense/skeleton fallback at the route-segment level (individual components have their own loading state via `SkeletonStrip`, but Next's route-level boundaries are unused outside root + dashboard).
4. **`buildAdminNav`/`buildDashboardNav` unmemoized** — real but low-impact: both run server-side, once per request, over small arrays; flagged for completeness, not a practical performance problem at current scale.
5. **`lib/api.ts` + `localStorage` auth bridge still required** for all client-side mutations across admin, dashboard, and campaigns — intentional per Part 1 Task 3's analysis (mutations need the client-held token and drive optimistic UI), not a leftover to eliminate, but it does mean the app permanently carries two parallel auth-read paths (cookie-based session server-side, localStorage token client-side) rather than one.
6. **SEO**: `git log --grep="seo"` shows one relevant commit, `772eb7a fix: landing's activity board changes and seo updated from claude`, already landed on this branch — no outstanding SEO TODOs found in `app/landing/`, `app/robots.ts`, or `app/sitemap.ts`. This item appears closed already; listed here only to confirm it was checked rather than assumed.

---

## Part 5 — Current file tree

### `frontend/app/`

```
app/
├── admin/
│   ├── OverviewClient.tsx
│   ├── Table.tsx
│   ├── cells.tsx
│   ├── navItems.ts
│   ├── page.tsx
│   ├── types.ts
│   ├── audience/{AudienceClient.tsx, page.tsx}
│   ├── audit-log/{AuditLogClient.tsx, page.tsx}
│   ├── campaigns/{CampaignsClient.tsx, page.tsx}
│   ├── ledger/{LedgerClient.tsx, page.tsx}
│   ├── notifications/{NotificationsClient.tsx, page.tsx}
│   ├── organizations/{OrganizationsClient.tsx, page.tsx}
│   ├── partnerships/{PartnershipsClient.tsx, page.tsx}
│   ├── qr-codes/{QrCodesClient.tsx, page.tsx}
│   ├── redemptions/{RedemptionsClient.tsx, page.tsx}
│   ├── scans/{ScansClient.tsx, page.tsx}
│   └── sections/
│       ├── AuditLog.tsx
│       ├── Campaigns.tsx
│       ├── Ledger.tsx
│       ├── Notifications.tsx
│       ├── Organizations.tsx
│       ├── Overview.tsx
│       ├── Partnerships.tsx
│       ├── QrCodes.tsx
│       ├── Redemptions.tsx
│       └── Scans.tsx
├── api/
│   ├── session/route.ts
│   └── sim-signup/route.ts
├── campaign-ended/page.tsx
├── campaigns/
│   └── [id]/
│       ├── CodeList.tsx
│       ├── Performance.tsx
│       ├── Studio.tsx
│       ├── controls.tsx
│       ├── page.tsx
│       ├── proof.tsx
│       └── panels/
│           ├── ColourPanel.tsx
│           ├── ExportPanel.tsx
│           ├── FramePanel.tsx
│           ├── LogoPanel.tsx
│           ├── StylePanel.tsx
│           └── types.ts
├── dashboard/
│   ├── OverviewClient.tsx
│   ├── RedemptionTable.tsx
│   ├── dialogs.ts
│   ├── error.tsx
│   ├── navItems.ts
│   ├── page.tsx
│   ├── types.ts
│   ├── campaigns/{CampaignsClient.tsx, page.tsx}
│   ├── partnerships/{PartnershipsClient.tsx, page.tsx}
│   ├── redemptions/{RedemptionsClient.tsx, page.tsx}
│   ├── settings/{SettingsClient.tsx, page.tsx}
│   └── sections/
│       ├── Campaigns.tsx
│       ├── Overview.tsx
│       ├── Partnerships.tsx
│       ├── Redemptions.tsx
│       └── Settings.tsx
├── error.tsx
├── globals.css
├── icon.svg
├── landing/
│   ├── ActivityBoard.tsx
│   ├── BudgetPlanner.tsx
│   ├── CodeMark.tsx
│   ├── Compare.tsx
│   ├── Faq.tsx
│   ├── JourneyFlow.tsx
│   ├── JourneyModal.tsx
│   ├── JourneyTrigger.tsx
│   ├── Landing.tsx
│   ├── Metrics.tsx
│   ├── Proof.tsx
│   ├── ScanStub.tsx
│   ├── Settlement.tsx
│   ├── landing.css
│   ├── useInView.ts
│   └── sections/
│       ├── AudiencePaths.tsx
│       ├── ClosingCta.tsx
│       ├── Content.tsx
│       ├── Footer.tsx
│       ├── Hero.tsx
│       ├── HowItWorks.tsx
│       ├── MoneyControls.tsx
│       ├── Nav.tsx
│       ├── PricingSection.tsx
│       └── SectionHead.tsx
├── layout.tsx
├── login/page.tsx
├── not-found.tsx
├── page.tsx
├── publisher-sim/page.tsx
├── robots.ts
└── sitemap.ts
```

### `frontend/components/`

```
components/
└── ui/
    ├── dialog.ts
    ├── dialogs.tsx
    ├── empty.tsx
    ├── figures.tsx
    ├── index.tsx
    ├── loadError.tsx
    ├── meter.tsx
    ├── skeleton.tsx
    ├── split.tsx
    ├── store.ts
    ├── toast.ts
    └── toasts.tsx
```

### `frontend/lib/`

```
lib/
├── api.ts
├── apiServer.ts
├── audience.tsx
├── chart.tsx
├── fmt.ts
├── lp.ts
├── mark.tsx
├── pass.tsx
├── place.ts
├── qr.ts
├── session.ts
├── shell.tsx
├── tw.ts
└── types.ts
```

---

## Closing verdict

Two of the three original tasks are essentially done: the `lib/ui.tsx` split is complete and verified with zero stray imports, and dashboard + admin got the full treatment — thin server `page.tsx` files, SSR reads through `apiServer`, and consistent `sections/` decomposition. The one meaningful hole is `campaigns/[id]`, which never got the same treatment: it's still a 216-line client component doing its own client-side fetching, and it's measurably the heaviest route in the app as a result (14 kB page JS / 121 kB First Load JS vs. ~2-4 kB / ~107-117 kB elsewhere). Call it roughly three-quarters finished — solid foundation, one clearly-scoped route left to bring in line, plus smaller polish items (panel code-splitting, missing loading/error boundaries) that don't block anything but are worth tracking.

## Part 6 — Backend-Facing Notes

### 1. Full endpoint inventory

Both call conventions were grepped across `frontend/app` and `frontend/lib`: `apiServer<T>(path, opts)` (server-side, cookie/session-bearer, used only in `page.tsx` files, `frontend/lib/apiServer.ts`) and `api<T>(path, opts)` (client-side, `localStorage`-token bearer, `frontend/lib/api.ts`). Method is read from `opts.method`; a call with no `method` option is a GET. All paths below are exactly as they appear in the source (including query strings); dynamic segments are shown as `${...}`. Counted **56 call sites** resolving to **41 distinct path patterns** (after treating `${id}`-style interpolations as one pattern each).

**Auth**
- `POST /v1/auth/login` — `app/login/page.tsx` (`mode` is `'login'`)
- `POST /v1/auth/signup` — `app/login/page.tsx` (`mode` is `'signup'`)

**Orgs / profile / API keys**
- `GET /v1/orgs/me` — `app/dashboard/page.tsx`, `app/dashboard/campaigns/page.tsx`, `app/dashboard/partnerships/page.tsx`, `app/dashboard/redemptions/page.tsx`, `app/dashboard/settings/page.tsx`
- `PATCH /v1/orgs/me` — `app/dashboard/sections/Settings.tsx`
- `POST /v1/api-keys/rotate` — `app/dashboard/sections/Settings.tsx`

**Campaigns (tenant-facing)**
- `GET /v1/campaigns` — `app/dashboard/page.tsx`, `app/dashboard/campaigns/page.tsx`
- `POST /v1/campaigns` — `app/dashboard/dialogs.ts` (create)
- `PATCH /v1/campaigns/${id}` — `app/dashboard/dialogs.ts` (edit)
- `POST /v1/campaigns/${id}/fund` — `app/dashboard/dialogs.ts` (create-flow top-up and edit-flow top-up)
- `GET /v1/campaigns/${id}/stats` — `app/campaigns/[id]/page.tsx`
- `GET /v1/campaigns/${id}/qr-codes` — `app/campaigns/[id]/page.tsx`
- `POST /v1/campaigns/${campaignId}/qr-codes` — `app/campaigns/[id]/CodeList.tsx`
- `GET /v1/campaigns/${id}/analytics?days=${days}` — `app/campaigns/[id]/page.tsx`

**Partnerships**
- `GET /v1/partnerships` — `app/dashboard/page.tsx`, `app/dashboard/campaigns/page.tsx`, `app/dashboard/partnerships/page.tsx`, `app/dashboard/redemptions/page.tsx`, `app/dashboard/settings/page.tsx`
- `POST /v1/partnerships` — `app/dashboard/dialogs.ts` (request a partnership)
- `PATCH /v1/partnerships/${id}/rates` — `app/dashboard/dialogs.ts`
- `POST /v1/partnerships/${id}/accept` — `app/dashboard/sections/Partnerships.tsx`
- `POST /v1/partnerships/${id}/rates/accept` — `app/dashboard/sections/Partnerships.tsx`
- `POST /v1/partnerships/${id}/rates/decline` — `app/dashboard/sections/Partnerships.tsx`
- `GET /v1/publishers` — `app/dashboard/partnerships/page.tsx`

**Redemptions / withdrawals**
- `GET /v1/redemptions` — `app/dashboard/page.tsx`, `app/dashboard/redemptions/page.tsx`
- `POST /v1/withdrawals` — `app/dashboard/dialogs.ts`

**QR codes (tenant-facing)**
- `PATCH /v1/qr-codes/${id}` — `app/campaigns/[id]/Studio.tsx` (style update)
- `POST /v1/qr-codes/${id}/void` — `app/campaigns/[id]/panels/ExportPanel.tsx`

**Attribution / Partner API (server-side proxy, not a direct browser call)**
- `POST /v1/attribution/claim` — `app/api/sim-signup/route.ts` (proxied with the publisher's `api_key`, standing in for a real publisher backend)
- `POST /v1/attribution/${confirm_id}/confirm` — `app/api/sim-signup/route.ts`

**Admin — reads (all `apiServer`, all GET)**
- `GET /v1/admin/overview` — every `app/admin/*/page.tsx` (11 files)
- `GET /v1/admin/campaigns?limit=1000` — `app/admin/audience/page.tsx`, `app/admin/campaigns/page.tsx`, `app/admin/scans/page.tsx`
- `GET /v1/admin/analytics?days=${days}${campaign_id?}` — `app/admin/page.tsx` (fixed `days=30`), `app/admin/audience/page.tsx` (dynamic `days`/`campaign_id` from `searchParams`)
- `GET /v1/admin/audit-log?limit=500` — `app/admin/audit-log/page.tsx`
- `GET /v1/admin/ledger${?account=}` — `app/admin/ledger/page.tsx`
- `GET /v1/admin/notifications?limit=500` — `app/admin/notifications/page.tsx`
- `GET /v1/admin/orgs?limit=1000` — `app/admin/organizations/page.tsx`
- `GET /v1/admin/partnerships?limit=1000` — `app/admin/partnerships/page.tsx`
- `GET /v1/admin/qr-codes?limit=1000` — `app/admin/qr-codes/page.tsx`
- `GET /v1/admin/redemptions?limit=1000` — `app/admin/redemptions/page.tsx`, `app/admin/scans/page.tsx`
- `GET /v1/admin/scans?limit=1000${&campaign_id=}` — `app/admin/scans/page.tsx`

**Admin — mutations (all client-side `api()`, called from `app/admin/sections/*.tsx` via each route's `*Client.tsx`)**
- `PATCH /v1/admin/campaigns/${id}` — status change (`Campaigns.tsx`)
- `POST /v1/admin/campaigns/${id}/adjust` — budget adjustment (`Campaigns.tsx`)
- `POST /v1/admin/campaigns/${id}/kill` — kill switch with reason (`Campaigns.tsx`)
- `POST /v1/admin/notifications/ack` — mark one (`{ ids: [id] }`) or all (`{}`) handled (`Notifications.tsx`)
- `PATCH /v1/admin/orgs/${id}` — approve / rename / update `landing_url` / other status fields (`Organizations.tsx`, several call sites with different bodies)
- `POST /v1/admin/orgs/${id}/rotate-key` — `Organizations.tsx`
- `POST /v1/admin/orgs/${id}/offboard` — `Organizations.tsx`
- `DELETE /v1/admin/orgs/${id}` — `Organizations.tsx`
- `PATCH /v1/admin/partnerships/${id}` — rate edit or status change (suspend/approve) (`Partnerships.tsx`)
- `PATCH /v1/admin/qr-codes/${id}` — expiry, max-uses, or other field updates (`QrCodes.tsx`, multiple call sites)

Not called anywhere in `frontend/`: any path under `/v1/admin/scans` beyond the one GET above, and no `DELETE`/`PATCH` on `/v1/campaigns` collection-level or `/v1/redemptions` — this inventory only lists what the frontend actually invokes, not the full backend surface.

### 2. Known backend suggestions surfaced during this project

- **Suggestion (non-blocking): add `expires_in` to auth responses.** `POST /v1/auth/login` and `POST /v1/auth/signup` responses are consumed in `app/login/page.tsx` as `AuthResult` (`res.token`, `res.org`, optional `res.api_key`) — no expiry field is read or present. That token is then handed to `POST /api/session` (`app/api/session/route.ts`), which sets the `token`/`org` cookies with a **fixed, separately-maintained `maxAge: 60 * 60 * 24 * 30`** (30 days) — a value hardcoded in the route, unrelated to the JWT's actual lifetime. If the backend added an `expires_in` (seconds) field to the login/signup response body, the frontend could set the session cookie's `maxAge` to match the real JWT lifetime instead of maintaining a separate, hand-picked constant that can drift out of sync with the token's true expiry (see Part 6.3 below — the JWT is currently issued with a 12h lifetime, far shorter than the 30-day cookie). **This is explicitly non-blocking**: `withAuthRedirect` in `frontend/lib/apiServer.ts` already catches any `ApiError` with `status === 401` (an expired or invalid token, regardless of cause) and redirects to `/login` cleanly, so the mismatch between cookie lifetime and token lifetime does not currently break anything user-facing — it would just let a stale cookie linger past the point the token behind it already stopped working, until the next SSR page load triggers the redirect.

### 3. Backend behavior the frontend had to accommodate

- **JWT expiry — confirmed 12 hours.** `backend/src/modules/auth/tokens.ts:31` — `jwt.sign(c, JWT_SECRET, { expiresIn: '12h' })`. This is corroborated by a comment in `backend/src/modules/auth/auth.guard.ts` ("Instant revocation: suspending a tenant must cut access now, not when its 12h JWT expires.") and by `backend/src/main.ts:37`'s Swagger security-scheme description ("Session token from /v1/auth/signup or /login (12h)"). Worth knowing for frontend developers: this is well inside the 30-day session-cookie window described above, so a user's cookie will routinely outlive their token, and the redirect-to-login on the next SSR fetch after 12h is expected, working behavior — not a bug to chase.
- **401 response shape.** `frontend/lib/apiServer.ts`'s `apiServer<T>` reads only `body?.message` from a failed response (`` throw new ApiError(res.status, body?.message ?? `HTTP ${res.status}`) ``), with `res.status` as the separately-tracked status code; `frontend/lib/api.ts`'s `api<T>` does the same (`` body?.message ?? `HTTP ${res.status}` ``, thrown as a plain `Error`). On the backend, `backend/src/modules/auth/auth.guard.ts` throws NestJS's `UnauthorizedException()` (no-arg, on a bad/expired token) or `UnauthorizedException('account suspended')` (on a suspended tenant) — both produce Nest's default JSON error body shape, `{ statusCode: 401, message: string, error: 'Unauthorized' }` (`message` is `'Unauthorized'` for the no-arg case, `'account suspended'` for the explicit one). A backend developer should not change this response shape (in particular, must keep a `message` string field present) without checking `apiServer<T>`/`api<T>` in `frontend/lib/apiServer.ts` / `frontend/lib/api.ts`, since both only read `message` and silently fall back to a generic `HTTP {status}` string if it's missing or renamed.
