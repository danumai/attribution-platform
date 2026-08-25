# QR Reward Platform — User Guide

**Read this if you want to use, test, or demo every part of the system end to end.**
Plain language, one flow at a time, with the exact thing to click or curl and the exact
answer you should get back. The last chapter, [Part F](#part-f--system-core-engine-structure),
opens the engine up and shows how it actually works inside.

- [0. The mental model](#0-the-mental-model-read-this-once)
- [1. Get it running](#1-get-it-running)
- [2. The 10-minute happy path](#2-the-10-minute-happy-path)
- [Part A — Every flow, step by step](#part-a--every-flow-step-by-step)
- [Part B — Test every feature (checklists)](#part-b--test-every-feature)
- [Part C — Curl cookbook](#part-c--curl-cookbook)
- [Part D — Reason codes & troubleshooting](#part-d--reason-codes--troubleshooting)
- [Part E — Configuration reference](#part-e--configuration-reference)
- [Part F — System core engine structure](#part-f--system-core-engine-structure)

---

## 0. The mental model (read this once)

### What the business does

An **airline** (promoter) prints a QR code on a boarding pass. A **passenger** scans it.
They land on a **streaming app's** store listing (publisher). They install and sign up.
The airline pays the publisher a **marketing fee** for that new user. The platform keeps a
cut (default 10%).

That's it. Three parties, one fee, one direction of money.

```
   PROMOTER                  PLATFORM                    PUBLISHER
   (airline, brand)          (this system)               (app, DramaBox)
        |                         |                            |
        |  1. funds a budget      |                            |
        |------------------------>|                            |
        |                         |                            |
        |  2. prints QR codes     |                            |
        |                         |                            |
   [ passenger scans ] ---------->| 3. redirect to store       |
                                  |    (nothing spendable)     |
                                  |                            |
                                  |<-- 4. "did this install    |
                                  |     come from a scan?" ----|
                                  |                            |
                                  | 5. YES -> pay the fee      |
                                  |    budget -> publisher     |
                                  |    budget -> platform cut  |
```

### The one rule that shapes everything

**The QR code unlocks nothing.** It opens an app-store listing. It carries no token, no
coupon, no code you can type in. The install is tied back to the scan *afterwards*,
server-to-server, the way every mobile ad network does it.

Why: App Store rule 3.1.1 forbids apps using QR codes to unlock content or currency.
So the QR is a **measurement** artifact, not a key. If you ever find yourself thinking
"where's the reward code in the URL?" — there isn't one, on purpose.

### Two products, priced separately

| | **Acquisition** | **Engagement** |
|---|---|---|
| What is bought | A brand-new user | A repeat purchase |
| Campaign `mode` | `acquisition` | `engagement` |
| Paid | Once per person, per campaign, ever | Once per **issued code** |
| Rate field | `coin_rate` / `guest_rate` | `engagement_rate` |
| Code comes from | The QR studio (poster, standee) | `POST /v1/issue` (one per ticket sold) |
| So a frequent flyer… | is paid for **once** | is paid for **every flight** |

### Two tiers inside acquisition

Everyone gets attributed. Only a **verified** user is worth full price.

| Tier | What the publisher says | Fee paid |
|---|---|---|
| Guest | `identified: false` (or omitted) | `guest_rate` now, the rest held back |
| Identified | `identified: true` | `coin_rate`, in one go |
| Guest upgraded | `POST /v1/attribution/:id/confirm` inside the grace window | the held-back delta is released |

### Who is who

| Role | Signs in at | Credential | Can |
|---|---|---|---|
| **Promoter** | `/login` → `/dashboard` | email + password (session JWT, 12h) | fund budgets, create campaigns, design & print QR codes, propose rates |
| **Promoter's server** | — | `pk_…` API key | `POST /v1/issue` — mint one code per transaction |
| **Publisher** | `/login` → `/dashboard` | email + password | accept partnerships, rule on rates, set destinations, request payouts |
| **Publisher's server** | — | `pk_…` API key | `POST /v1/attribution/*` — ask "was this attributable?", get paid |
| **Super admin** | `/login` → `/admin` | seeded from env, never signup | see everything, override anything, pay withdrawals |

### Vocabulary

| Word | Means |
|---|---|
| **Partnership** | The agreement between one promoter and one publisher. Holds the four rates. Nothing spends until it's `active`. |
| **Campaign** | A budget + a mode, spending against one partnership. |
| **QR code** | One printed placement. Has an expiry, a use limit, and artwork. |
| **Scan** | One `GET /r/:code`. Creates a pending attribution claim. |
| **Install** | First app open, tied back to a scan. Nothing is paid yet. |
| **Redemption** | The payout row. This is when money actually moves. |
| **Claim id** | Opaque id riding inside Play's install referrer. Names a scan. Useless without the publisher's API key. |
| **Coins / credits** | The platform's internal unit of money. Integers. |

---

## 1. Get it running

You need **Node 20+**, **pnpm 11+**, and **Docker**.

```bash
cp .env.example .env      # dev defaults work as-is
pnpm install              # both workspaces
pnpm dev                  # Postgres + Redis + API (:4000) + web (:3000)
```

`pnpm dev` waits for the database, applies pending Prisma migrations, then runs both
servers in one terminal. Ctrl-C stops everything.

In a **second terminal**:

```bash
pnpm seed                 # minimal demo data — prints logins, keys and scan URLs
```

**Keep the seeder's output on screen.** The QR codes it prints are new on every run.

### Where things live

| | URL |
|---|---|
| Portal (all three roles sign in here) | http://localhost:3000/login |
| Marketing landing page | http://localhost:3000 |
| API | http://localhost:4000 |
| Swagger / API reference | http://localhost:4000/docs |
| Publisher simulator (stands in for the app) | http://localhost:3000/publisher-sim |
| Postgres | localhost:**5436** |
| Redis | localhost:**6380** (6379 is usually taken) |

### Logins after `pnpm seed`

| Role | Email | Password | Org |
|---|---|---|---|
| Promoter | `promoter@demo.com` | `password123` | Air Dhaka |
| Publisher | `publisher@demo.com` | `password123` | DramaBox |
| Super admin | `admin@qrreward.local` | `admin12345` | — |

The publisher's API key is pinned in `.env` (`pk_devdev…`) so it survives a reset.
The promoter's key is minted by the seeder and printed **once**.

### Every command

| Command | What it does |
|---|---|
| `pnpm dev` | Full stack: db + api + web |
| `pnpm seed` | Minimal demo data: two tenants, one campaign per mode. Re-running adds a *second* set — reset first for a clean run |
| `pnpm check` | Lint + typecheck + unit tests. No database needed. Run before every push |
| `pnpm test` | `pnpm check` plus the full end-to-end suite (**needs `pnpm dev` already running**) |
| `pnpm run db:reset` | Wipe the database volume and start clean |
| `pnpm run db:migrate` | Create a migration after editing `schema.prisma` |
| `pnpm run db:studio` | Browse the database in Prisma Studio |
| `pnpm run build` | Compile both workspaces |
| `pnpm start` | Run the compiled build |

---

## 2. The 10-minute happy path

Do this once before anything else. It touches every core piece.

**1. Sign in as the promoter** — `promoter@demo.com` / `password123`.
You land on the Overview: budgets, scans, signups, fees, a month-long chart.

**2. Open a campaign** — Campaigns → *Inflight entertainment — Q3*.
You get three things on one page: Performance (scans → installs → signups, budget draining),
Audience (country, city, device, OS, browser, screen, per-QR-code), and the Design studio.

**3. Design a QR** — change a colour, drop a logo in the centre, download the SVG.
That is print-ready artwork, not a screenshot.

**4. Scan it.** Open the acquisition scan URL the seeder printed — `http://localhost:4000/r/{code}` —
in a private window, or point a real phone at the QR on screen.

- **Android** → you land on the Play listing. The only thing that travelled is an opaque
  `qrm_claim` inside Play's `referrer` parameter.
- **iPhone** → a ~1-second hand-off screen, then the App Store. That screen is the only
  moment the handset's timezone, screen size and locale can ever be read. It shows no code.
- **Laptop** → the publisher's own web page.

**5. Be the publisher's app.** Open http://localhost:3000/publisher-sim, paste the publisher
API key, sign up with any email, leave *verified* unticked.

→ Account created, promoter charged the **guest rate (10)**, 40 held back.

**6. Tick "Confirm this user is verified"** → the held-back 40 is released. Total 50.

**7. Sign up again with a different email and no referrer** → `attributed: false`, `no_match`.
**This is a normal answer, not an error.** Most installs are organic.

**8. Repeat purchases.** Open the *engagement* scan URL the seeder printed. Enter a customer
id and continue → `kind: "engagement"`, `match_method: "code"`, confidence 100, fee 20,
nothing held back.

**9. Both dashboards now show it** — the scan, the redemption, the budget drawdown.
Sign in as `publisher@demo.com` to see the other side.

**10. Sign in as admin** (`admin@qrreward.local` / `admin12345`) → Overview shows
`ledger_balanced: true` and `balances_reconciled: true`. Those two lines are the
"the books are not lying" check.

**Acceptance criteria — the whole loop**

- [ ] All three roles sign in and land on their own surface (`/dashboard`, `/dashboard`, `/admin`).
- [ ] An Android scan reaches Play with `qrm_claim` in the `referrer`; an iPhone scan shows the hand-off screen and reaches the App Store; a laptop scan reaches the publisher's landing page.
- [ ] A guest signup charges `10` and holds `40`; Confirm releases the `40` for a total of `50`.
- [ ] A signup with no referrer answers `attributed: false` with `no_match` — and that is a pass, not a failure.
- [ ] An engagement claim answers `kind: "engagement"`, `match_method: "code"`, `confidence: 100`, `fee: 20`, `pending_fee: 0`.
- [ ] Both dashboards show the same scan, the same redemption and the same budget drawdown.
- [ ] Admin Overview shows `ledger_balanced: true` and `balances_reconciled: true`.

---

# Part A — Every flow, step by step

Each flow says **who** does it, **where**, the **steps**, and **what you should see**, and
closes with **Acceptance criteria** — the pass/fail bar for that flow. Every box ticks, the
flow is done; one doesn't, that's the bug report. [Part B](#part-b--test-every-feature) is the
same bar rearranged into flat checklists once you know the system.

---

## A1. Sign up and sign in

### Sign up (building the world by hand)

**Where:** http://localhost:3000/login → the *Sign up* tab.

| Field | Notes |
|---|---|
| Account type | `promoter` or `publisher`. Admin can never be created here. |
| Organization name | e.g. "Air Dhaka" |
| Landing URL | **Publishers only.** Where desktop scans go. Use `http://localhost:3000/publisher-sim` in dev. |
| Email | Must look like an address. Shape-checked only — nothing sends mail. |
| Password | 8 characters minimum, 72 **bytes** maximum. |

**On success you get three things:** a session token (12 hours), your org, and — shown
**once** — your `pk_…` API key. The browser stores it in `localStorage` so the Settings page
and the publisher-sim can find it. **Copy it now.** Only a rotation ever issues another.

> **Publishers in production are not usable immediately.** `AUTO_APPROVE_PUBLISHERS` is off,
> so the signup answers `approval_pending: true`. Until an admin approves you, you are hidden
> from the promoter directory and cannot enter a partnership. In dev it's on, so you're
> approved instantly.

### Sign in

`POST /v1/auth/login` → session token. Where you land depends on your role: admins go to
`/admin`, everyone else to `/dashboard`.

**Things that are deliberately true here:**

| Do | Expect | Why |
|---|---|---|
| Log in with a wrong password | 401 `invalid credentials` | — |
| Log in with an email that doesn't exist | 401 `invalid credentials`, and it takes the **same time** | A fast "no such user" is a reliable way to enumerate who is registered |
| Log in 21 times from one IP in a minute | 401 `too many attempts` | Per-IP bucket (20/min) |
| Attack one account from many IPs | 401 after 10 tries | Per-account bucket (10/min) |
| Log in as a suspended org | 401 `account suspended` | And any existing session dies on its next request |

### Password reset

There is no mailer. An admin issues the token:

```bash
POST /v1/admin/orgs/:id/reset-token     # admin only -> { reset_token, expires_at }
POST /v1/auth/reset                     # { token, password } -> { reset: true }
```

Single-use, expires in an hour, stored hashed, and the issuing is audited.

**Acceptance criteria**

- [ ] Signup returns a session token, the org, and a `pk_…` key shown **exactly once**.
- [ ] A wrong password and an email that does not exist both answer 401 `invalid credentials`, in comparable time.
- [ ] 21 logins from one IP in a minute, or 11 against one account, answer `too many attempts`.
- [ ] A suspended org gets 401 `account suspended`, and a session it already held dies on its next request.
- [ ] An admin-issued reset token works once and never after an hour; the issuing is in the audit log.
- [ ] With `AUTO_APPROVE_PUBLISHERS=false`, a new publisher signup answers `approval_pending: true` and is absent from the promoter directory.

---

## A2. Publisher setup — do this first or nothing works

**Who:** publisher. **Where:** Dashboard → **Settings**.

A publisher with no destination registered **redirects nobody**. Every scan of every campaign
pointed at you dies at `no_destination`, silently, forever. The dashboard shows a warning
banner until you fix it.

| Field | What it is | Example |
|---|---|---|
| `android_package` | Your Play listing id, reverse-DNS | `com.dramabox.app` |
| `ios_app_id` | The numeric App Store adam id | `1234567890` |
| `landing_url` | Web fallback for desktop scans and app-less publishers | `http://localhost:3000/publisher-sim` |
| `deeplink_url` | **Engagement only.** An https origin you have claimed as an Android App Link / iOS Universal Link | `http://localhost:3000/publisher-sim` |
| `bonus_label` | What *you* call your own joining bonus. A label for reporting and artwork — never an instruction from this platform | `100 free coins` |

**Rules enforced:** every URL must be absolute and **https** (http is allowed only for
localhost), must not embed credentials, and must not use a `javascript:` or `data:` scheme.
An empty string `""` **clears** a field; omitting the field leaves it alone.

**Where each one is used:**

```
scan arrives at /r/:code
        |
        +-- Android + android_package  -> play.google.com/...&referrer=qrm_claim=...
        +-- iOS + ios_app_id           -> hand-off screen -> apps.apple.com/app/id...
        +-- anything else              -> landing_url
        +-- engagement + deeplink_url  -> your App Link, carrying qrm_code + qrm_fallback
        +-- none of the above          -> /campaign-ended?reason=no_destination
```

**Acceptance criteria**

- [ ] All five fields save and read back from Settings.
- [ ] A non-localhost `http://` URL, a `javascript:` or `data:` scheme, and a URL with embedded credentials are each rejected with 400.
- [ ] Sending `""` clears a field; omitting the field leaves it unchanged.
- [ ] With all three destinations cleared, every scan on your partnerships answers `reason=no_destination` and the dashboard shows the warning banner.
- [ ] With them set, each device path resolves to the destination the table above predicts.

---

## A3. API keys

Both tenant types hold one, and they are **opposites**:

| Key | Endpoint it opens | Effect |
|---|---|---|
| Publisher `pk_…` | `POST /v1/attribution/*` | Asks whether a signup or purchase is attributable. **Earns** fees. |
| Promoter `pk_…` | `POST /v1/issue` | Mints one code per transaction. **Spends** budget when redeemed. |

They are **not interchangeable** — using a publisher key on `/v1/issue` is a 401, and
vice versa.

**Rotate:** Dashboard → Settings → *Rotate API key*, or `POST /v1/api-keys/rotate`.
The old key stops working **the moment this lands**. It is audited (never the key itself,
only that it happened). An admin can also rotate on your behalf via
`POST /v1/admin/orgs/:id/rotate-key` — the support path for a leaked key.

Keys never expire on their own. The only things that end access are a rotation, a suspension,
or an offboard.

**Per-key rate limit:** 600 requests/minute. Generous enough that no honest signup flow
touches it.

**Acceptance criteria**

- [ ] A publisher key on `POST /v1/issue` is 401; a promoter key on `POST /v1/attribution/*` is 401.
- [ ] Rotation kills the old key on its very next request, and the audit entry records that it happened without the key material.
- [ ] An admin rotation on the tenant's behalf has the same effect and is audited.
- [ ] 601 requests in a minute on one key answers 429.

---

## A4. Partnership: request → accept

**Who requests:** the promoter. **Who accepts:** the publisher. Nothing spends until it is
`active`.

### Promoter side

Dashboard → **Partnerships** → *Request partnership*.

| Field | Default | Means |
|---|---|---|
| Publisher | — | Only approved, non-suspended publishers appear. Ones with no destination are flagged `(no app registered yet)` |
| `coin_rate` | 50 | Coins per **verified** signup |
| `guest_rate` | 10 | Coins paid up front for an unverified one; the rest is held back |
| `grace_days` | 7 | How long a guest has to verify and release the remainder |
| `engagement_rate` | 20 | Coins per repeat purchase (engagement campaigns only) |

**Rules:** `guest_rate` ≤ `coin_rate` (checked in code *and* as a database CHECK).
`engagement_rate` is deliberately **not** bounded against the others — a returning customer
is a different thing being bought and may honestly cost more than a signup.

At creation, the current `PLATFORM_FEE_BPS` is **snapshotted onto the partnership**. Changing
the platform default later never reprices a deal that both parties already agreed to.

The status starts at `pending`. One partnership per promoter/publisher pair, ever.

### Publisher side

Dashboard → **Partnerships** → the pending row carries a badge → *Accept*.

`POST /v1/partnerships/:id/accept` only moves `pending → active`. It cannot lift an admin's
`suspended` — otherwise "accept" would be an undo button for a platform control.

### The three statuses

| Status | Scans | Payouts | Set by |
|---|---|---|---|
| `pending` | ✗ (campaign can't even be created) | ✗ | created that way |
| `active` | ✓ | ✓ | the publisher accepting |
| `suspended` | ✗ → `partnership_inactive` | ✗ (including guest upgrades) | **admin only** |

**Acceptance criteria**

- [ ] The publisher picker lists only approved, non-suspended publishers, and flags the ones with no destination.
- [ ] `guest_rate` above `coin_rate` is refused with 400 — and refused again by the database CHECK if you try it in SQL.
- [ ] The partnership stores a `platform_fee_bps` snapshot; changing `PLATFORM_FEE_BPS` afterwards does not move it.
- [ ] A second request for the same promoter/publisher pair answers 400 `partnership already exists`.
- [ ] `accept` moves `pending → active` only; on an admin-suspended partnership it answers 404.
- [ ] Nothing spends while the partnership is `pending` or `suspended` — the campaign cannot even be created.

---

## A5. Repricing a live partnership

The coin rate is what the *publisher* is paid, so the promoter cannot simply set it — and
the money must not stop while the two sides talk.

**Promoter:** Partnerships → *Propose rates* → `PATCH /v1/partnerships/:id/rates`.
The proposal lands in separate `proposed_*` columns. **Payouts keep reading the agreed rates
the whole time.** That is the point.

**Publisher:** the row shows the proposal → *Accept* or *Decline*.

| Action | Result |
|---|---|
| Accept | `proposed_*` is copied over the live rates, then cleared. New rate in force. |
| Decline | Proposal cleared. Agreed rates stand. The promoter can ask again. |
| Promoter revises while you look at it | Your click gets `the proposal changed — reload and look again` (compare-and-set on all three numbers) |
| Admin overrides the rate meanwhile | Your proposal is **discarded**, and the audit entry says `proposal_cleared: true` |

Only `active` partnerships can be repriced. A `pending` one has no agreed price yet; a
`suspended` one is an admin hold that new terms must not quietly work around.

**Acceptance criteria**

- [ ] A proposal lands in `proposed_*` and the live rates are untouched.
- [ ] A payout taken **during** an open proposal is priced at the agreed rates, not the proposed ones.
- [ ] Accept copies the three numbers over and clears the proposal; decline clears it and leaves the agreed rates standing.
- [ ] A revised proposal makes the publisher's stale click answer `the proposal changed — reload and look again`.
- [ ] An admin rate override clears the open proposal and the audit entry says `proposal_cleared: true`.
- [ ] Repricing a `pending` or `suspended` partnership is refused.

---

## A6. Create a campaign

**Who:** promoter. **Where:** Dashboard → Campaigns → *New campaign*.

| Field | Notes |
|---|---|
| Partnership | Must be **active**. |
| Name | Up to 120 chars. |
| Mode | `acquisition` (new signups) or `engagement` (repeat purchases). |

> **`mode` is fixed at creation. There is no endpoint to change it.** It selects which payout
> guarantee the campaign's rows live under, and those are partial unique indexes over rows
> that already exist. Flipping the mode would leave a run of rows under a rule they were never
> checked against. Running both is two campaigns — they can share one partnership.

### Campaign statuses

| Status | Scans | New payouts | Notes |
|---|---|---|---|
| `active` | ✓ | ✓ | |
| `paused` | ✗ → `reason=paused` | ✗ | Reversible. Topping up mid-pause is fine. |
| `ended` | ✗ → `reason=ended` | ✗ | **Permanent.** Cannot be funded through checkout. |

Status is re-checked at **every** stage — the redirect, first-open, and both claim paths.
Pausing a campaign stops spending *now*, not "eventually". An install bound while it was
live cannot keep drawing on the budget afterwards.

**Acceptance criteria**

- [ ] A campaign on a `pending` or `suspended` partnership is refused with 400.
- [ ] No endpoint anywhere accepts a change of `mode`.
- [ ] `paused` answers `reason=paused` and `ended` answers `reason=ended` at the redirect — **and** both refuse at first-open and at both claim paths.
- [ ] An install bound while the campaign was live cannot draw on the budget after a pause.
- [ ] Renaming an ended campaign changes the name and leaves the status `ended`.

---

## A7. Funding a campaign

Money enters the system in exactly one of two ways depending on the environment.

### Dev: direct funding

Campaigns → *Edit* → set a Budget, or "how many more signups to cover". Behind that:

```
POST /v1/campaigns/:id/fund   { coins, idempotency_key }
```

Two ledger entries land in one transaction:

```
external:funding   -coins
campaign:{id}      +coins
```

**Idempotency:** send an `idempotency_key` and a retried request (double-clicked button,
proxy retry, at-least-once job) collides on `UNIQUE (account, ref)` and credits nothing twice.
Without a key, every request is a new credit.

This route is **off in production** (`ALLOW_SELF_FUNDING=false`) — left on, any promoter could
mint the budget that pays publishers real money.

### Production: checkout + signed webhook

```
1.  POST /v1/payments/checkout    { campaign_id, coins }   -> { payment_id, status: "pending" }
2.  Hand payment_id to your PSP as metadata. Customer pays.
3.  The PSP's webhook adapter POSTs the result, HMAC-signed:

    POST /v1/payments/webhook
    x-payment-signature: <hex hmac-sha256 of the RAW body, keyed on PAYMENT_WEBHOOK_SECRET>
    { "payment_id": "...", "provider_ref": "ch_123", "status": "succeeded" }
```

| Guarantee | How |
|---|---|
| A webhook redelivered 10× credits **once** | `status` is flipped by the same UPDATE that tests it, and the ledger ref `fund:{payment_id}` collides on UNIQUE |
| One PSP charge completes at most one payment | Partial unique index on `provider_ref` |
| An unsolicited "payment succeeded" for an id we never minted | 404, not a credit |
| A wrong signature | 401 `bad signature`, compared in constant time |
| **No `PAYMENT_WEBHOOK_SECRET` set at all** | The route **404s**. Money-in is off. That is the correct default for an endpoint that credits budgets. |

`GET /v1/payments` shows your funding history. Rows still `pending` are checkouts the PSP
never confirmed — what an abandoned card page looks like.

### Reading a budget

`GET /v1/campaigns` and `GET /v1/campaigns/:id/stats` both return `budget` / `budget_remaining`,
read from `account_balances`.

**When the budget runs dry:** the scan redirect answers `reason=budget`. A signup arriving
mid-drain answers `budget_exhausted` and — critically — **does not burn the scan**. Top the
budget back up and that same user is still attributable.

**Acceptance criteria**

- [ ] Funding writes exactly two entries in one transaction — `external:funding -coins`, `campaign:{id} +coins` — that sum to zero.
- [ ] The same `idempotency_key` twice moves the budget once; no key means every call is a new credit.
- [ ] A correctly signed webhook credits once, a redelivery answers `replay: true`, a bad signature is 401, an unknown `payment_id` is 404.
- [ ] With `PAYMENT_WEBHOOK_SECRET` unset, the webhook route answers 404 — money-in is off.
- [ ] With `ALLOW_SELF_FUNDING=false`, `POST /v1/campaigns/:id/fund` is refused.
- [ ] `budget_remaining` matches `account_balances`; an empty budget answers `reason=budget` at the scan and `budget_exhausted` mid-signup, **without burning the scan** — top up and the same user still attributes.

---

## A8. QR codes and the design studio

**Who:** promoter. **Where:** Campaigns → open one → the studio on the right.

### Create a code

```
POST /v1/campaigns/:id/qr-codes   { style?, expires_in_days?, max_uses? }
```

| Control | Default | Range |
|---|---|---|
| `expires_in_days` | 30 | 0–3650. **`0` = never expires** |
| `max_uses` | `null` (unlimited) | any positive integer. `1` = single-use |

The response includes `scan_url` — `${BASE_URL}/r/{code}`. That URL is what gets encoded into
the image.

### The studio, panel by panel

| Panel | What you can change |
|---|---|
| **Style** | Presets, module shape, eye frame shape, eye centre shape, quiet zone (0–10 modules), error correction (L/M/Q/H) |
| **Colour** | Flat fill or gradient (linear/radial + angle), background, transparent background, separate finder-eye frame and centre colours |
| **Logo** | Upload a PNG/JPEG/SVG data URL (max ~220KB), scale (10–30% of width), backdrop plate + padding. **Uploading a logo forces ECC to `H`** — the logo covers modules, so it needs maximum error correction |
| **Frame** | A printed frame and call-to-action caption beneath the code, with its own colours |
| **Export** | Raster size, download **SVG** or **PNG**, see the scan destination, and the **Danger zone → Void** |

Live preview: the editor **posts** the style to `POST /v1/qr-codes/:id/preview` rather than
encoding it into a URL, because a logo data URL is far past what a query string can carry.
Rendering is debounced ~220ms so dragging a slider doesn't fire a render per pixel.

The studio warns you about **contrast problems** before you print something unscannable.
Try a very light module colour on white — it tells you.

**PNG vs SVG:** the flat PNG encoder cannot express shapes, gradients, logos or frames.
Those are SVG-only server-side; the studio rasterises them in the browser for PNG export.

### Voiding a code

Export panel → *Void*, or `POST /v1/qr-codes/:id/void`. Use it for a lost or stolen print run.
The code answers `reason=voided` from that instant. **It is audited** — killing a code is the
one QR action worth an admin's attention, because the support call arrives before anyone
thinks to check a log.

A promoter can **kill** a code but cannot **extend** its life. Loosening a limit
(`expires_at`, `max_uses`) is an admin override, so it lands in the audit log:
`PATCH /v1/admin/qr-codes/:id`.

### The image endpoint

`GET /v1/qr-codes/:id/image?format=png|svg&style={json}` is **public** — the QR only encodes a
public URL. It is CPU-bound, so it has its own budget: 120 requests/minute per IP.

**Acceptance criteria**

- [ ] The response's `scan_url` is `${BASE_URL}/r/{code}`, and that is exactly what the image encodes.
- [ ] `expires_in_days: 0` never expires; `max_uses: 1` gives `reason=used_up` on the second scan.
- [ ] Uploading a logo forces ECC to `H`; a file past ~220KB is rejected.
- [ ] The preview is a `POST` (a logo data URL never appears in a URL), and a low-contrast module/background pair raises the warning.
- [ ] Void takes effect on the next scan (`reason=voided`) and writes an audit entry.
- [ ] A promoter cannot extend `expires_at` or `max_uses`; only `PATCH /v1/admin/qr-codes/:id` can, and it is audited.
- [ ] The image endpoint serves without auth and answers 429 on the 121st request in a minute from one IP.

---

## A9. The scan — every path and every refusal

**Endpoint:** `GET /r/:code`. This is the hot path, and it does a lot in order.

### The order of checks

```
1.  Rate limit          30 scans/min per IP  -> ?reason=rate_limited
2.  Code exists?                             -> ?reason=invalid
3.  Voided?                                  -> ?reason=voided
4.  Campaign active?                         -> ?reason=paused | ended
5.  Partnership active?                      -> ?reason=partnership_inactive
6.  Budget > 0?                              -> ?reason=budget
7.  Resolve a destination                    -> ?reason=no_destination
8.  Claim ONE use, atomically                -> ?reason=expired | used_up
    (+ write the scan row in the same transaction)
9.  Redirect (or show the iOS hand-off first)
```

Step 7 before step 8 is deliberate: a publisher who has registered nothing would otherwise
eat the print run's uses redirecting nobody.

Step 8 is one `UPDATE ... WHERE uses < max_uses RETURNING uses` — that single statement **is**
the expiry check and the use-limit check, so two simultaneous scans can never both take the
last use.

Every refusal redirects to `${FRONTEND_URL}/campaign-ended?reason=...`, which is a real,
friendly page — a dead end looks like a broken QR.

### The four device paths

| Device | What happens | What travels |
|---|---|---|
| **Android** + Play package | 302 straight to the Play listing | `referrer=utm_source=qrmarketer&utm_medium=qr&qrm_claim={id}` — Play's install-referrer channel, which survives the install |
| **iPhone** + App Store id | ~1s **hand-off screen**, then the App Store | Nothing. The screen reads the browser's timezone / screen / locale and posts them to `/go/:claimId` |
| **Desktop**, or a publisher with no app | 302 to `landing_url` | Nothing |
| **Engagement scan** + deeplink | 302 to your App Link carrying `qrm_code` and `qrm_fallback` | The transaction code (inert without your API key) |

### Why iOS needs a hand-off screen

iOS has no install-referrer channel. There is no way to hand a value through the App Store.
So the match has to be made on **device signals**, and the *only* moment those can be read is
in a browser, before the App Store takes over.

The page is the only thing in this API that runs script, so it is also the only thing with a
relaxed CSP — one inline script under a nonce. It fails safe three ways:

| Situation | What happens |
|---|---|
| Script runs | Signals collected, then `location.replace` after a short hold |
| Script blocked or errors | `<meta refresh>` at 3 seconds, no signals — the match then correctly falls back to IP + platform and is **refused as too weak** |
| Both fail | The "Continue" key is a real anchor to a real URL |

**View source on that page.** There is no token and no code on it. That is the compliance
argument, visible.

### Engagement deep links

There is deliberately **no "is the app installed" check**, anywhere. Both platforms answer
that offline, on the handset, before the request ever leaves it:

- **Installed** → the OS opens the app with `qrm_code`, and we never see the request.
- **Not installed** → the browser loads the publisher's page, which forwards to `qrm_fallback`
  — a store URL **we** built, so its Play referrer cannot be assembled wrong by a third party.

On iOS the fallback is `/i/:claimId` (the hand-off screen) rather than the bare App Store
listing: a traveller without the app is about to become an acquisition too, and those signals
are only readable here.

**Acceptance criteria**

- [ ] Every one of the nine checks is reachable and answers with its own named reason.
- [ ] Destination resolution happens **before** a use is claimed: a `no_destination` scan leaves `uses` unchanged.
- [ ] Two simultaneous scans of a `max_uses: 1` code produce exactly one redirect and one scan row.
- [ ] Android carries `qrm_claim` inside Play's `referrer`; desktop goes to `landing_url` carrying nothing.
- [ ] View-source on the iOS hand-off screen shows no code and no token — one inline script under a nonce.
- [ ] With script blocked, the `<meta refresh>` still lands on the App Store, and the resulting IP+platform match is correctly **refused** as too weak.
- [ ] Every refusal lands on a real `/campaign-ended` page, never a dead URL or a stack trace.

---

## A10. Attribution — the two-stage path (recommended)

This is the money path. Called **server-to-server** by the publisher's backend, with the
publisher's `pk_…` key. Never from a device.

### Why two stages

First open is **minutes** after the scan — same network, same timezone, same device.
Signup is whenever the user gets round to it, routinely the next day.
One window covering both is what made the fingerprint path useless: short enough to be honest
meant it matched almost nothing.

```
   SCAN  ------ minutes ------>  FIRST OPEN  ------ hours or days ------>  SIGNUP
                                 (match here)                              (pay here)
                                 window: 60 min (iOS)                      window: 30 days
                                         30 days (Android)
```

### Stage 1 — first open

```http
POST /v1/attribution/first-open
Authorization: Bearer pk_…
{
  "install_referrer": "<raw string from Play's Install Referrer API>",   // Android
  "claim_id":         "<the id alone, if your SDK stored it>",           // same path
  "ip":               "203.0.113.9",                                     // iOS path
  "platform":         "ios",
  "tz":               "Asia/Dhaka",
  "screen":           "393x852@3",
  "language":         "en-us",
  "cores":            6,
  "dark":             true,
  "emulator": false, "rooted": false, "vpn": false
}
```

**Nothing is paid here.** The scan is consumed — the claim is bound — but no ledger entry
exists until somebody signs up.

**Success:**
```json
{ "attributed": true, "install_id": "…", "campaign_id": "…", "campaign_name": "…",
  "match_method": "referrer", "confidence": 100,
  "signup_deadline": "2026-09-23T…", "bonus_label": "100 free coins" }
```

**Bank the `install_id`.** It is idempotent by construction: a second call finds the scan
already consumed and answers `no_match`. Your SDK must persist it, not re-derive it.

### Stage 2 — the signup

```http
POST /v1/attribution/claim
Authorization: Bearer pk_…
{ "install_id": "…", "publisher_user_ref": "user_123",
  "identified": false, "is_new_user": true }
```

**Success:**
```json
{ "attributed": true, "attribution_id": "…", "campaign_id": "…", "campaign_name": "…",
  "match_method": "referrer", "confidence": 100, "identified": false,
  "fee": 10, "publisher_net": 9, "platform_fee": 1,
  "pending_fee": 40, "confirm_deadline": "2026-08-31T…",
  "bonus_label": "…", "replay": false }
```

| Field | Means |
|---|---|
| `fee` | **Gross** — what the campaign budget spent |
| `publisher_net` | What actually landed in your account (fee minus the platform cut) — **book revenue on this** |
| `platform_fee` | The retained cut |
| `pending_fee` | Held back until verification. 0 for identified users |
| `confirm_deadline` | Last moment `/confirm` will release the delta |
| `replay` | `true` means this call moved no money; you are seeing the original answer again |

### Stage 3 — releasing the held-back part

```http
POST /v1/attribution/{attribution_id}/confirm
Authorization: Bearer pk_…
```
→ `{ "fee": 50, "fee_added": 40, "identified": true, "status": "confirmed" }`

| Situation | Answer |
|---|---|
| Called twice | `status: "already_full"` — idempotent, **not** an error |
| Past the grace window | 409 `grace_period_expired` |
| Partnership suspended meanwhile | 409 `partnership_not_active` |
| Budget can't cover the delta | 409 `budget_exhausted` |
| On an engagement redemption | `already_full` — engagement settles in one step, there is nothing to release |

### `is_new_user` — the one you must send

```json
{ "install_id": "…", "publisher_user_ref": "…", "is_new_user": false }
```
→ `attributed: false`, `not_a_new_user`, **and the install is not spent.**

The fee buys an *acquisition*. An existing account signing in again is not one. Only you can
know that. The unique index catches the same ref twice; this catches what an index cannot
see — a returning user handed a fresh ref.

Omitting the field keeps the old behaviour (attributable), so publishers integrated before
this existed are unaffected. Only `false` acts.

**Acceptance criteria**

- [ ] `first-open` writes **no ledger entry**: an install row appears, the scan is consumed, no money moves.
- [ ] A second `first-open` on the same scan answers `no_match`.
- [ ] `claim` returns `fee`, `publisher_net` and `platform_fee` where net + platform fee == fee, and `pending_fee` is the held-back remainder for a guest (0 for `identified: true`).
- [ ] `confirm` releases the delta once; a second call answers `status: "already_full"` (200, not an error).
- [ ] Past `confirm_deadline` → 409 `grace_period_expired`; partnership suspended meanwhile → 409 `partnership_not_active`; budget short → 409 `budget_exhausted`.
- [ ] `is_new_user: false` answers `not_a_new_user` **and leaves the install unspent**; omitting the field behaves as before.
- [ ] The same `publisher_user_ref` twice on one campaign answers `replay: true` with no second ledger entry.
- [ ] An install older than 30 days answers `install_expired`; `emulator: true` at first-open answers `device_integrity`.
- [ ] The iOS fingerprint window is 60 minutes and the Android referrer window is 30 days.

---

## A11. Attribution — the legacy single-call path

Kept working for publishers already integrated. Match and pay in one request, no install row:

```http
POST /v1/attribution/claim
{ "publisher_user_ref": "user_9", "install_referrer": "…",
  "ip": "203.0.113.9", "user_agent": "…", "platform": "android",
  "tz": "…", "screen": "…", "language": "…", "identified": false }
```

It runs the **same scored matcher**, so a bare IP + platform scores 55, falls under the floor
of 70, and is **refused**. This path used to pay on that. It no longer does — an IP is a
postcode, not an identity.

Irrelevant on Android (the referrer names the scan exactly). On iOS this is why the path
barely attributed anything: the fingerprint window had to stretch across onboarding.

**Acceptance criteria**

- [ ] A bare IP + platform scores 55, falls under the floor of 70, and is refused — this path no longer pays on it.
- [ ] The full signal set from the same device inside the window attributes with `match_method: "fingerprint"` and a confidence at or above 70.
- [ ] A publisher integrated on this path needs no change: the response shape and the fee split are the same as the two-stage `claim`.
- [ ] Nothing here can pay twice alongside the two-stage path — the scan is consumed either way.

---

## A12. Engagement — the repeat-purchase flow

The second product. The airline pays for a **returning customer**, not a new one.

### Step 1 — the promoter's booking system mints a code

Called by a machine, per transaction, with the **promoter's** key:

```http
POST /v1/issue
Authorization: Bearer pk_<promoter>
{ "campaign_id": "…", "issued_ref": "PNR-XYZ-9", "expires_in_days": 30 }
```
→ `{ id, code, expires_at, issued_ref, scan_url, replay: false }`

| Rule | Behaviour |
|---|---|
| Same `issued_ref` twice | Returns the **same code**, `replay: true`. A booking webhook that fires twice must not hand one traveller two rewards |
| Campaign is `acquisition` mode | 404 `no active engagement campaign with that id` — a code minted against the wrong mode scans fine, pays a signup fee once, then silently never pays a purchase reward |
| Another tenant's campaign | 404, not 403 — an existence oracle across tenants is itself a leak |
| Publisher's key | 401 |

Every issued code is `max_uses: 1` — one code, one purchase, one scan.

### Step 2 — the traveller scans it

`GET /r/{code}` → the publisher's App Link carrying `qrm_code` (and `qrm_fallback` for the
app-less case).

### Step 3 — the publisher claims the purchase

```http
POST /v1/attribution/claim
Authorization: Bearer pk_<publisher>
{ "code": "<the transaction code>", "publisher_user_ref": "traveller_9" }
```
→
```json
{ "attributed": true, "kind": "engagement", "match_method": "code", "confidence": 100,
  "fee": 20, "publisher_net": 18, "platform_fee": 2,
  "pending_fee": 0, "confirm_deadline": null, "replay": false }
```

The `code` is **always explicit** — never read out of `install_referrer` implicitly, even
though an engagement referrer carries both. They are different payouts on different terms,
and one call quietly picking between them is an accounting surprise to reconcile by hand.

### The engagement rules, precisely

| Do | Expect | Why |
|---|---|---|
| Claim the same code, **same user**, twice | `replay: true`, no second ledger entry | The response was lost; replay the original answer |
| Claim the same code as a **different user** | `attributed: false`, `already_claimed` | A forwarded screenshot is not a retry |
| Claim a code that was never scanned | `no_match` | The code must have been scanned at least once |
| Claim a code from an `acquisition` campaign | `not_engagement` | That campaign never agreed a repeat-purchase price |
| Claim an unknown / voided / another publisher's code | `no_match` (all four look identical) | Telling them apart lets a publisher probe which codes exist platform-wide |
| Same traveller, **second ticket, second code** | **Paid again** | This is the whole reason the mode exists |

### There is no guest tier here

`identified` splits an acquisition fee because a new account is worth less until somebody
vouches for it. A repeat customer already transacted with the promoter — a harder fact than
any verification the publisher could apply. Engagement settles in one step.

### One scan can pay twice

A traveller who scans a boarding pass, has no app yet, installs, signs up **and** has bought a
ticket is honestly both an acquisition and an engagement. Both are payable, on the same scan.
They use different guards (`scans.consumed` vs a partial unique index on `qr_code_id`), so
they never race each other.

**Acceptance criteria**

- [ ] `POST /v1/issue` with the promoter's key mints a `max_uses: 1` code and returns a `scan_url`.
- [ ] The same `issued_ref` twice returns the **same code** with `replay: true`.
- [ ] An acquisition campaign answers 404, another tenant's campaign answers 404 (not 403), and the publisher's key answers 401.
- [ ] The scan redirects to the publisher's App Link carrying `qrm_code` and `qrm_fallback`.
- [ ] A claim answers `kind: "engagement"`, `match_method: "code"`, `confidence: 100`, `fee` == `engagement_rate`, `pending_fee: 0`, `confirm_deadline: null`.
- [ ] Same code + same user → `replay: true`; different user → `already_claimed`; never scanned → `no_match`; acquisition code → `not_engagement`; unknown, voided and another publisher's code all answer the identical `no_match`.
- [ ] `confirm` on an engagement redemption answers `already_full`.
- [ ] The same traveller's second code pays again, and one scan can produce one acquisition **and** one engagement redemption, both paid.

---

## A13. Analytics and audience

**Where:** Campaigns → open one → *Audience*. Admin sees the same numbers platform-wide under
the *Audience* tab — literally the same function, so the two can never disagree.

`GET /v1/campaigns/:id/analytics?days=30`

### Totals

| Number | Means |
|---|---|
| `scans` | Total in the window |
| `devices` | Distinct hashed IPs — the closest thing to "people" this data supports |
| `conversions` / `conversion_rate` | Scans that became a payout |
| `coins` | What was spent |
| `repeat_scans` | Scans beyond the first from one device |
| `geo_known` | How many scans the CDN resolved a country for. **0 means geo simply isn't wired up** |
| `handset_known` | How many carry hand-off-screen detail. This is also the honest **ceiling on how many iOS installs can ever be matched** |

### Dimensions

`country`, `city`, `device_type`, `os`, `browser`, `language`, `platform`, `referer_host`,
`screen`, `tz`, `theme`, `network`, `qr_code`, `campaign`, `hour`, `weekday`, `day`.

Two worth calling out:

- **`qr_code`** — one row per printed placement. This is the panel that decides the next print run.
- **`referer_host`** — `direct` is the interesting bucket: **that is what a real camera scan
  looks like.** Anything else means the URL was clicked on a page. In-app webviews (Instagram,
  TikTok) show up as their own browser, which is your channel signal.

Everything here is read off the request the redirect already receives. A QR code carries
nothing about whoever scanned it. There is no name, email, phone, or precise location
anywhere in this system.

**Acceptance criteria**

- [ ] Totals and every dimension render for a 30-day window without an error on an empty bucket.
- [ ] The promoter's campaign numbers and the admin's, filtered to the same campaign, are identical.
- [ ] `conversion_rate` equals `conversions / scans` for the window shown.
- [ ] `geo_known: 0` reads as "geo isn't wired up", not as a failure.
- [ ] A real camera scan lands in the `direct` bucket of `referer_host`.
- [ ] No name, email, phone or precise location appears anywhere in the response.

---

## A14. Redemptions and reconciliation

**Where:** Dashboard → Redemptions. Both sides see the same rows for campaigns they are on.

`GET /v1/redemptions?limit=100`

| Column | Means |
|---|---|
| `fee` / `coins` | **Gross** — what the promoter's budget was charged |
| `publisher_net` | What landed in the publisher's account |
| `platform_fee` | The retained cut |
| `identified` | Full tier or guest |
| `kind` | `acquisition` or `engagement` |
| `match_method` | `referrer` (deterministic) / `fingerprint` (probabilistic) / `code` (a purchase) |
| `confidence` | 0–100, stored at decision time so a review months later sees what it was decided on |
| `upgraded_at` | When a guest was confirmed |

> **Publishers: reconcile on `publisher_net`, not `coins`.** Summing `coins` over-reports your
> own revenue by the platform's cut on every single row. `publisher_net` is recomputed from
> the snapshotted bps through the exact same function the payout used, so the two cannot drift.

**Fraud sampling:** filter for `match_method: fingerprint`. Those are the probabilistic ones.
`referrer` and `code` matches are deterministic and auditable.

**Acceptance criteria**

- [ ] Promoter and publisher see the same rows for a campaign they share.
- [ ] On every row, `publisher_net` + `platform_fee` == `fee`.
- [ ] The sum of `publisher_net` matches the publisher's `earnings` on `GET /v1/orgs/me`.
- [ ] `confidence` and `match_method` are the values stored at decision time, unchanged by a later rate override.
- [ ] `upgraded_at` is set exactly when a guest was confirmed, and null otherwise.
- [ ] Filtering `match_method: fingerprint` returns only the probabilistic matches.

---

## A15. Withdrawals — getting paid

**Who:** publisher. **Where:** Dashboard → Redemptions → *Request payout*.

### What you can actually withdraw

```
withdrawable  =  balance
               - everything earned inside the last SETTLEMENT_DELAY_DAYS (default 14)
               - anything already queued in a `requested` withdrawal
```

That holdback is the **clawback window**. It is what makes fraud review a control rather than
advice: no coin earned recently can leave while a review might still run. Only credits are
held — an earlier withdrawal never extends the wait on what remains.

`GET /v1/orgs/me` returns both `earnings` (everything you've ever earned) and `withdrawable`
(the part that has cleared). The dialog caps you at the second and refuses to open if it's zero.

### The flow

```
publisher: POST /v1/withdrawals { coins }      -> status "requested". NO money moves.
admin:     POST /v1/admin/withdrawals/:id/pay  -> ledger moves:
                                                    publisher:{org}    -coins
                                                    external:payouts   +coins
           POST /v1/admin/withdrawals/:id/reject { note }
```

| Do | Expect |
|---|---|
| Request more than `withdrawable` | 400 naming exactly what is available |
| Two requests at once | They serialise — the second is judged against a pool the first already claimed from |
| Two admins click *pay* at once | The money moves **once** (status flipped by the same UPDATE that tests it) |
| Publisher balance dropped between request and approval | 400 `publisher balance no longer covers this withdrawal` |

**Neither the promoter nor the publisher can move money on their own say-so.** Money in
requires a signed PSP webhook. Money out requires an admin.

**Acceptance criteria**

- [ ] `withdrawable` equals balance minus credits inside `SETTLEMENT_DELAY_DAYS` minus anything already `requested`.
- [ ] The dialog caps the amount at `withdrawable` and refuses to open when it is zero.
- [ ] Requesting more than `withdrawable` answers 400 naming what is actually available.
- [ ] A request moves **no** money; only the admin's pay does, writing `publisher:{org} -coins` / `external:payouts +coins`, audited.
- [ ] Two admins paying the same withdrawal at once move the money once.
- [ ] A balance that dropped between request and approval answers 400 `publisher balance no longer covers this withdrawal`.
- [ ] An earlier withdrawal does not extend the holdback on what remains.

---

## A16. The super admin portal

**Where:** sign in at `/login` with the admin account → you land on `/admin`.

Seeded on every boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. **Never through signup.**
In production it is seeded on first boot only, so rotating the password in-app is not
reverted by the next deploy.

Eleven tabs, in three groups.

### Overview — "does the money add up, and what is waiting on you"

27 aggregates in one query. The two that matter most:

| Field | Must be | If not |
|---|---|---|
| `ledger_balanced` | `true` | The whole book doesn't sum to zero. Something wrote a one-sided entry. |
| `balances_reconciled` | `true` | A cached `account_balances` row disagrees with the entries behind it. **Stop spending and reconcile** — every money path locks and reads that row. |

Also here: promoters, publishers, suspended orgs, partnerships (and pending), campaigns
(active, engagement), redemptions split by kind and by tier, scans (and last 24h), QR codes,
voided codes, coins granted, total funded, **platform revenue** (the retained cut — the number
the business runs on), total paid out, open withdrawals, unapproved publishers, pending
payments, and open notifications.

A background sweep runs the same two integrity checks **every 10 minutes** regardless of
whether anyone has the dashboard open, and pushes anything it finds to `ALERT_WEBHOOK_URL`.
Alerts always reach the structured log too.

### Accounts group

| Tab | What you can do |
|---|---|
| **Organizations** | Search all tenants. **Approve** a publisher (the production gate). **Suspend** / reinstate. Rename. Fix a publisher's destinations. **Rotate key** (shown once). **Issue a reset token** (shown once, 1 hour). **Offboard** — suspends, kills the API key, and ends every campaign in one transaction. |
| **Partnerships** | Override any of the four rates. Set `platform_fee_bps` per partnership (**admin-only** — the take rate is the platform's own side of the deal). Set status `pending` / `active` / `suspended`. Any rate override **clears an open proposal**, so a tenant cannot undo an admin decision by clicking accept on a stale one. |
| **Campaigns** | Change status. **Kill** — ends the campaign *and* voids every code it ever issued, in one call. **Adjust** the budget (positive goodwill credit or negative clawback; still double-entry; never below zero; supports an idempotency key). |

### Traffic group

| Tab | What you get |
|---|---|
| **Audience** | The same breakdowns as a promoter's campaign page, platform-wide or filtered to one campaign |
| **Scans** | Every scan, newest first: hashed IP, UA, platform, country, city, language, referer host, OS, browser, device type, **and the four fingerprint signals** (tz, screen, cores, dark) plus the full `client` blob. This is what support needs to read a disputed attribution. `coins` is **summed** — a scan that was both an acquisition and a purchase cost the budget both |
| **Redemptions** | Every payout across all tenants |
| **QR codes** | Every issued code, its limits, its uses, and its state |

### Money group

| Tab | What you get |
|---|---|
| **Ledger** | Every account balance and the entries behind them. Filter by account |
| **Notifications** | The admin inbox: everything a **tenant** did that nobody has acknowledged — a funded budget, a repriced partnership, a voided code, a withdrawal request. Acknowledge to clear. It is not a second table: an audit entry with a tenant behind it *is* a notification |
| **Audit log** | Every privileged override, forever. Acknowledging never removes anything from here |

**Acceptance criteria**

- [ ] `ledger_balanced` and `balances_reconciled` are both `true`, and `select sum(amount) from ledger_entries` is exactly `0`.
- [ ] Every one of the eleven tabs loads, and admin Audience matches the promoter's numbers for the same campaign.
- [ ] Any non-admin hitting `/v1/admin/*` gets 403 `super admin only`.
- [ ] Every privileged action (approve, suspend, rotate, reset token, rate override, kill, budget adjust, offboard, pay, reject) writes an audit entry.
- [ ] Acknowledging a notification clears the inbox row and removes nothing from the audit log.
- [ ] The integrity sweep runs every 10 minutes with nobody watching, and anything it finds reaches `ALERT_WEBHOOK_URL` and the structured log.
- [ ] A negative budget adjustment that would go below zero answers 400.

---

## A17. Suspension, approval, offboarding

| Action | Effect | Reversible |
|---|---|---|
| **Approve** a publisher | It appears in the promoter directory and can be partnered with | Yes (un-approve) |
| **Suspend** an org | Cannot log in (`account suspended`); existing sessions die on the next request; API key stops working; scans on its partnerships fail | Yes |
| **Suspend** a partnership | Scans → `partnership_inactive`. All payouts stop, **including guest upgrades** | Yes (admin only — `accept` cannot lift it) |
| **Kill** a campaign | Ended + every code voided | No |
| **Offboard** an org | Suspend + API key deleted + every campaign ended, in one transaction | No (key is gone) |

Sessions are checked against the database on **every request**, not just at issue. That one
primary-key lookup is what makes suspension instant rather than "whenever their 12-hour JWT
happens to expire".

**Acceptance criteria**

- [ ] Approve, un-approve, suspend and reinstate are all reversible; kill and offboard are not.
- [ ] Suspending an org blocks login, kills a live session on its **next** request, and stops its API key.
- [ ] A suspended partnership stops scans (`partnership_inactive`) and every payout, **including guest upgrades**.
- [ ] Kill ends the campaign and voids every code it ever issued, in one transaction.
- [ ] Offboard suspends, deletes the API key and ends every campaign, in one transaction.
- [ ] Nothing in this list can be undone by a tenant clicking `accept` on something stale.

---

# Part B — Test every feature

## B0. Run the automated suite first

```bash
pnpm check       # lint + typecheck + unit tests. No database, no server.
pnpm test        # the above, plus the full e2e suite. NEEDS `pnpm dev` running.
./e2e-test.sh    # just the end-to-end business loop, 160+ assertions over real HTTP
```

The e2e suite covers, in order: setup and partnership rules, repricing, campaign lifecycle,
the acquisition loop, the iOS two-hop flow, the fingerprint floor, device integrity, the whole
engagement product, cross-mode isolation, **simultaneous claims** (the only place the row locks
are actually exercised), input validation, budget exhaustion, admin overrides, and ledger
integrity.

Everything below is what to check **by hand**.

## B1. Scans

| Do | Expect |
|---|---|
| Open the acquisition `/r/…` on Android | 302 to `play.google.com/…&referrer=…qrm_claim=…` |
| Same on an iPhone | Hand-off screen ~1s, then the App Store — **no code shown anywhere** |
| Same on a laptop | 302 to the publisher's landing page |
| View source on the hand-off screen | One inline script under a nonce. No token, no code |
| Open the **voided** code the seeder printed | `/campaign-ended?reason=voided` |
| Pause the acquisition campaign, then scan one of its codes | `reason=paused` |
| End it, then scan again | `reason=ended` |
| Reload one scan URL 31 times in a minute | `reason=rate_limited` on the last few |
| Suspend the partnership (as admin), then scan | `reason=partnership_inactive` |
| Clear the publisher's three destination fields, then scan | `reason=no_destination` |
| Create a code with `max_uses: 1`, scan it twice | Second → `reason=used_up` |
| Create a code with `expires_in_days: 1`, backdate it, scan | `reason=expired` |

## B2. Attribution

| Do | Expect |
|---|---|
| Sign up with the referrer from an Android scan | `attributed: true`, `match_method: "referrer"`, `confidence: 100` |
| Sign up again with the **same** referrer | `attributed: false`, `already_claimed` — one install per scan |
| Sign up with **no** referrer and no signals | `attributed: false`, `no_match` or `low_confidence` |
| Present only an IP + platform (no tz/screen/lang) | Refused — scores 55 against a floor of 70 |
| Guest signup, then Confirm | `fee: 10`, then `fee_added: 40` → total 50 |
| Confirm the same attribution twice | Second: `status: "already_full"` — idempotent, not an error |
| Confirm after `grace_days` | 409 `grace_period_expired` |
| Claim the same `publisher_user_ref` twice on one campaign | `replay: true`, and **no second ledger entry** |
| Claim with `is_new_user: false` | `not_a_new_user`, and the install is **not** spent |
| Send `emulator: true` at first open | `attributed: false`, `device_integrity` |
| First-open twice on one scan | Second → `no_match` (idempotent by construction) |
| Claim an `install_id` more than 30 days old | `install_expired` |
| Pause the campaign, then claim a bound install | `campaign_not_active` |

## B3. Engagement

| Do | Expect |
|---|---|
| `POST /v1/issue` twice with the same `issued_ref` | Same code, `replay: true` |
| `POST /v1/issue` against an acquisition campaign | 404 `no active engagement campaign with that id` |
| `POST /v1/issue` with the **publisher's** key | 401 |
| Claim an engagement code twice as the same user | `replay: true` |
| Claim it as a **different** user | `attributed: false`, `already_claimed` |
| Claim an engagement `code` against an acquisition campaign | `not_engagement` |
| Claim a code nobody has scanned yet | `no_match` |
| Same traveller, second ticket, second code | **Paid again** — this is the point of the mode |
| A boarding-pass scan by someone with no app: sign up **and** claim the code | Two redemptions on one scan, both paid |

## B4. Money

| Do | Expect |
|---|---|
| Admin Overview | `ledger_balanced: true`, `balances_reconciled: true` |
| Sum the ledger in psql (see below) | exactly `0` |
| Fund a campaign twice with the same idempotency key | Budget moves **once** |
| Send the payment webhook twice | `replay: true` on the second, credited once |
| Send the payment webhook with a wrong signature | 401 `bad signature` |
| Unset `PAYMENT_WEBHOOK_SECRET` and POST the webhook | 404 |
| Request more than `withdrawable` | 400 naming what is actually available |
| Admin pays the queued withdrawal | Publisher balance drops, `external:payouts` credited, audited |
| Drain a budget, then scan | `reason=budget` |
| Drain a budget mid-signup | `budget_exhausted`, and the scan is **not** burned — top up and it still works |
| Admin adjusts a budget below zero | 400 `adjustment would push budget below zero` |

```bash
docker exec qrreward-db psql -U qrreward -tAc "select coalesce(sum(amount),0) from ledger_entries"   # must be 0
docker exec qrreward-db psql -U qrreward -tAc "select account, balance from account_balances order by 1"
docker exec qrreward-db psql -U qrreward -tAc "select kind, match_method, count(*) from redemptions group by 1,2"
```

## B5. Isolation and security

| Do | Expect |
|---|---|
| Sign up a second promoter at `/signup` and log in | Sees **none** of Air Dhaka's campaigns, scans or fees |
| Call `/v1/issue` with the **publisher's** key | 401 |
| Call `/v1/attribution/claim` with the **promoter's** key | 401 |
| Rotate the publisher key, then reuse the old one | 401 immediately |
| Admin suspends an org, then it tries to log in | `account suspended`, and its live session dies on the next request |
| Read another tenant's campaign by id | **404**, not 403 — an existence oracle is itself a leak |
| Promoter tries `PATCH /v1/orgs/me` | 403 `publishers only` |
| Publisher tries `POST /v1/campaigns` | 400 `no active partnership with that id` |
| Non-admin hits any `/v1/admin/*` | 403 `super admin only` |
| Set a `landing_url` to `javascript:alert(1)` | 400 — must use https |
| Send a 300-char `publisher_user_ref` | 400 — rejected loudly, never truncated silently |
| Fire 301 requests of anything from one IP in a minute | 429 with `Retry-After: 60` |

## B6. Partnership and campaign rules

| Do | Expect |
|---|---|
| Set `guest_rate` above `coin_rate` | 400 `guest_rate cannot exceed coin_rate` |
| Request a partnership with the same publisher twice | 400 `partnership already exists` |
| Request a partnership pointed at another **promoter** | 400 `no such publisher` |
| Publisher accepts an admin-**suspended** partnership | 404 — accept only lifts `pending` |
| Propose the rates already in force | 400 `those are the rates already in force` |
| Promoter revises a proposal while the publisher is looking at it | Publisher's click → `the proposal changed — reload and look again` |
| Create a campaign on a `pending` partnership | 400 |
| Rename an ended campaign | Name changes, status **stays** ended |
| Try to change a campaign's `mode` | No endpoint exists. Create a second campaign |

---

# Part C — Curl cookbook

```bash
API=http://localhost:4000
PUB=pk_devdevdevdevdevdevdevdevdevdevdevdevdevdevdevdev   # publisher — earns fees
PRO=pk_…                                                  # promoter — mints codes (seeder prints it)
```

### Sign in and get a session token

```bash
TOKEN=$(curl -s -XPOST $API/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"promoter@demo.com","password":"password123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
```

### Android — the deterministic path, end to end

```bash
CODE=…   # from the seeder output

# 1. Scan, and pull the referrer out of the redirect
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' \
  -H 'user-agent: Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36' \
  -H 'x-forwarded-for: 203.0.113.9' "$API/r/$CODE")
REF=$(printf '%s' "$LOC" | sed -n 's/.*referrer=//p' \
  | python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))')

# 2. First open — binds the install. Nothing is paid.
INSTALL=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' \
  -d "{\"install_referrer\":\"$REF\",\"platform\":\"android\"}")
echo "$INSTALL"     # -> install_id, confidence 100, match_method referrer

ID=$(printf '%s' "$INSTALL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["install_id"])')

# 3. Signup — the fee is earned
curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' \
  -d "{\"install_id\":\"$ID\",\"publisher_user_ref\":\"user_demo_1\",\"identified\":false,\"is_new_user\":true}"
# -> fee 10, pending_fee 40, confirm_deadline …

# 4. Release the held-back part
curl -s -XPOST $API/v1/attribution/<attribution_id>/confirm -H "Authorization: Bearer $PUB"
# -> fee_added 40, status confirmed
```

### iOS — the two-hop flow

```bash
# 1. Scan on an iPhone UA -> you get HTML, not a 302
curl -s -H 'user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1' \
  -H 'x-forwarded-for: 203.0.113.50' "$API/r/$CODE" | grep -o '/go/[A-Za-z0-9_-]*'

# 2. What the page's script posts back
CLAIM=…   # the id from that /go/ link
curl -s -o /dev/null -w '%{redirect_url}\n' \
  "$API/go/$CLAIM?tz=Asia/Dhaka&sc=393x852@3&lang=en-US&cores=6&dark=1"
# -> apps.apple.com/app/id…

# 3. First open, minutes later, presenting the same signals
curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' -d '{
    "ip":"203.0.113.50","platform":"ios","tz":"Asia/Dhaka",
    "screen":"393x852@3","language":"en-us","cores":6,"dark":true }'
```

### Engagement — mint, scan, claim

```bash
CAMP=…   # the engagement campaign id

curl -s -XPOST $API/v1/issue -H "Authorization: Bearer $PRO" -H 'content-type: application/json' \
  -d "{\"campaign_id\":\"$CAMP\",\"issued_ref\":\"PNR-DEMO-1\"}"
# -> code, scan_url, replay:false.  Same issued_ref again -> replay:true, same code.

curl -s "$API/r/<code>" -o /dev/null          # the code must be scanned at least once

curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' \
  -d '{"code":"<code>","publisher_user_ref":"traveller_9"}'
# -> kind engagement, match_method code, fee 20, pending_fee 0
```

### Fund a campaign through the signed webhook

```bash
SECRET=dev-payment-webhook-secret-change-me

PAY=$(curl -s -XPOST $API/v1/payments/checkout -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "{\"campaign_id\":\"$CAMP\",\"coins\":5000}")
PID=$(printf '%s' "$PAY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["payment_id"])')

BODY="{\"payment_id\":\"$PID\",\"provider_ref\":\"ch_test_1\",\"status\":\"succeeded\"}"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.* //')

curl -s -XPOST $API/v1/payments/webhook -H "x-payment-signature: $SIG" \
  -H 'content-type: application/json' -d "$BODY"
# -> status completed, replay:false.  Send it again -> replay:true, credited once.
```

### Admin

```bash
ADMIN=$(curl -s -XPOST $API/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@qrreward.local","password":"admin12345"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s $API/v1/admin/overview -H "Authorization: Bearer $ADMIN" | python3 -m json.tool
curl -s "$API/v1/admin/ledger?account=platform:fees" -H "Authorization: Bearer $ADMIN"
curl -s -XPOST $API/v1/admin/withdrawals/<id>/pay -H "Authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"note":"paid via bank ref 998"}'
```

---

# Part D — Reason codes & troubleshooting

## Scan refusals (`/campaign-ended?reason=…`)

| Reason | Means | Fix |
|---|---|---|
| `rate_limited` | 30 scans/min from this IP | Wait a minute, or scan from another device |
| `invalid` | No such code | Mistyped, or not a genuine code |
| `voided` | The promoter cancelled this batch | — |
| `expired` | Past `expires_at` | Issue new codes |
| `used_up` | `max_uses` reached | — |
| `paused` | Campaign is paused | Promoter reactivates it |
| `ended` | Campaign is ended (permanent) | Create a new campaign |
| `partnership_inactive` | Admin suspended the relationship | Admin action |
| `budget` | Budget is at zero | Fund the campaign |
| `no_destination` | Publisher has no Play package, App Store id **or** landing URL | Publisher → Settings |

## Attribution refusals (`attributed: false`, HTTP **200**)

An unattributed install is a **normal answer, not an error**. Most installs are organic. Your
signup flow must never treat a `false` here as a failure.

| Reason | Means |
|---|---|
| `no_match` | No claimable scan. The referrer named a scan that is gone, already claimed, or belongs to another publisher — or there were simply no candidates |
| `low_confidence` | The network narrowed it to some scans and **no** device signal agreed. An IP is a postcode |
| `ambiguous` | Two scans fit the evidence **equally well**. Picking one would be inventing a fact and paying one publisher for another's scan |
| `already_claimed` | One install per scan; one reward per engagement code |
| `campaign_not_active` | Paused or ended between the scan and now |
| `budget_exhausted` | The budget can't cover the fee. **The scan is released** — top up and it works |
| `duplicate_device` | The same handset shape already installed for this campaign inside `DEVICE_DEDUPE_DAYS` |
| `device_integrity` | The SDK asserted `emulator: true` — the shape of every install farm |
| `install_expired` | Past `SIGNUP_WINDOW_DAYS` since first open |
| `not_a_new_user` | You told us `is_new_user: false` |
| `not_engagement` | You sent a `code` to an acquisition campaign |

## Confirm errors (these **are** errors)

| Code | Means |
|---|---|
| 404 `attribution not found` | Wrong id, or not yours |
| 409 `grace_period_expired` | Past `grace_days` |
| 409 `partnership_not_active` | Admin suspended it |
| 409 `budget_exhausted` | Can't cover the delta |
| 200 `already_full` | Already identified. **Not an error** |

## Rate limits (all per minute)

| Bucket | Limit |
|---|---|
| Global, every route, per IP | 300 |
| Scan `/r/:code`, `/i/`, `/go/` | 30 |
| QR image / preview | 120 |
| Login per IP | 20 |
| Login per account | 10 |
| Signup, password reset | 10 |
| Partner API key | 600 |

`/healthz` and `/metrics` are exempt — throttling a health check turns a traffic spike into a
pulled-from-rotation outage.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `no API at http://localhost:4000` | `pnpm dev` isn't running |
| Every scan dies at `no_destination` | Publisher has registered nothing. Dashboard → Settings |
| Attribution rate is 0% on iOS | The hand-off screen's signals never arrived, or the publisher reports a different IP than the scan saw |
| Attribution rate is 0% on Android | The referrer is being assembled or read wrong. Log the raw Install Referrer string |
| Everything answers 401 after a deploy | `JWT_SECRET` changed — every session token is now invalid |
| A code scans but never pays | Check `mode`. An engagement code on an acquisition campaign pays a signup fee once, then nothing, silently |
| Re-running `pnpm seed` | Adds a **second** set of campaigns. `pnpm db:reset` first |
| Charts are one column | Backdating failed — see above |
| Rate limits feel 2× too loose | More than one replica with no `REDIS_URL`. Counters are per-process |
| `req.ip` is always the proxy | Set `TRUST_PROXY=1` behind a load balancer |

### Reset

```bash
pnpm db:reset && pnpm seed     # clean world, new codes, same logins
```

---

# Part E — Configuration reference

Everything lives in `.env`. Values are validated **at import time**, so a bad one fails before
the first request rather than on the path that needs it.

## The ones that refuse to boot in production

The API **refuses to start** — rather than start up subtly broken — if:

- `JWT_SECRET` is still the default (total auth bypass)
- `BASE_URL`, `FRONTEND_URL` or `ADMIN_*` are unset
- any of those URLs is not `https://`
- `ADMIN_PASSWORD` is under 12 characters
- `PAYMENT_WEBHOOK_SECRET` is the shipped dev value, or under 16 characters
- `TRUST_PROXY=true` (that trusts `X-Forwarded-For` from **any** client, letting one attacker
  present as unlimited IPs and collapsing every per-IP limit)

## Deployment

| Setting | Why it matters |
|---|---|
| `BASE_URL` | Encoded into every QR as `${BASE_URL}/r/{code}`. **A wrong value is a reprint, not a redeploy.** Set it before printing anything |
| `FRONTEND_URL` | CORS allowlist, comma-separated. The first entry is used for scan redirects |
| `JWT_SECRET` | Signs session tokens. `openssl rand -hex 32` |
| `DATABASE_URL` | Append `?sslmode=require` for managed Postgres |
| `REDIS_URL` | Where rate limits are counted. Unset = in-process, correct for **exactly one replica**. Two replicas without it = 2× every security limit |
| `TRUST_PROXY` | `1` behind one load balancer, or the proxy subnet. Never `true` |
| `METRICS_TOKEN` | Bearer token for `GET /metrics`. Unset in production = the endpoint 404s |
| `ENABLE_DOCS` | Swagger at `/docs`. Off in production — it enumerates every route in one page |
| `NEXT_PUBLIC_API_URL` | Baked into the browser bundle at **build** time. Setting it at runtime does nothing |
| `ALERT_WEBHOOK_URL` | Slack-compatible sink for ledger drift and budgets running dry |

## The attribution engine

| Setting | Default | Range | What it decides |
|---|---|---|---|
| `REFERRER_WINDOW_DAYS` | 30 | 1–90 | How long a Play install referrer stays claimable. Play retains it ~90 days |
| `FINGERPRINT_WINDOW_MIN` | 60 | 1–1440 | How long an iOS install can be device-matched. **Shorter = fewer false matches under carrier NAT** |
| `SIGNUP_WINDOW_DAYS` | 30 | 1–180 | How long a bound install stays convertible into a paid signup |
| `MIN_CONFIDENCE` | 70 | 60–100 | The accept/reject line for a probabilistic match. IP + platform alone scores **55**, so 70 refuses it. Raise toward 80 to demand a screen match. **There is no honest value below 60** |
| `DEVICE_DEDUPE_DAYS` | 7 | 0–90 | How far back the repeat-device check looks. `0` disables it |

## The business layer

| Setting | Default | What it decides |
|---|---|---|
| `PLATFORM_FEE_BPS` | `1000` (10%) | The platform's cut. **Snapshotted onto each partnership at creation**, so changing it never reprices an agreed deal |
| `SETTLEMENT_DELAY_DAYS` | `14` | How long earnings stay unwithdrawable — the clawback window that makes fraud review a control rather than advice |
| `PAYMENT_WEBHOOK_SECRET` | unset | HMAC-SHA256 secret. **Unset means money-in is off** (the route 404s) |
| `AUTO_APPROVE_PUBLISHERS` | off in prod | A publisher receives money, so a human approves it first |
| `ALLOW_SELF_FUNDING` | off in prod | Direct funding with no payment behind it. Demo only |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Seeded on **first boot only** in production, so an in-app rotation survives the next deploy |

## Deploying

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export JWT_SECRET=$(openssl rand -hex 32)
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at least 12 chars'
export BASE_URL=https://api.example.com FRONTEND_URL=https://app.example.com
docker compose -f docker-compose.prod.yml up --build -d
```

Or without Docker: `pnpm run build && NODE_ENV=production pnpm start`.

**Operational notes.** `GET /healthz` checks the database and is what the load balancer should
poll. `SIGTERM` drains in-flight requests and closes the pool before exit, so a redeploy cannot
tear down a half-written attribution. Demo tenants are skipped entirely when
`NODE_ENV=production`.

---

# Part F — System core engine structure

Everything above is *how to use it*. This is *how it works*.

## F1. The shape of the thing

```
┌───────────────────────────────────────────────────────────────────────────┐
│  BROWSERS                                                                  │
│  /login  /dashboard  /campaigns/[id]  /admin  /publisher-sim  /landing     │
│  Next.js 15 app router · session JWT in localStorage · one fetch wrapper   │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ HTTPS, CORS-allowlisted
┌───────────────────────────────▼───────────────────────────────────────────┐
│  API — NestJS on Express, one module, seven controllers                    │
│                                                                            │
│  middleware, in this exact order:                                          │
│    requestContext ──> /metrics (token-gated) ──> securityHeaders           │
│      ──> globalRateLimit ──> json({limit:'1mb', verify: keep raw bytes})    │
│                                                                            │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │  Public  │   Auth   │  Portal  │ Partner  │ Issuance │ Payments │Admin │
│  │  /r/:code│ /v1/auth │   /v1    │ /v1/attr │ /v1/issue│ /v1/pay  │/v1/  │
│  │  no auth │ no auth  │ session  │  API key │ API key  │ hmac+sess│admin │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘      │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
┌───────────────┐      ┌─────────────────┐     ┌──────────────────┐
│  PostgreSQL   │      │  Redis          │     │  Outbound        │
│  Prisma 7     │      │  rate limits    │     │  ALERT_WEBHOOK   │
│  raw SQL on   │      │  (optional —    │     │  PSP webhook in  │
│  money paths  │      │   in-process    │     │  /metrics scrape │
│               │      │   fallback)     │     │                  │
└───────────────┘      └─────────────────┘     └──────────────────┘
```

**Why one Nest module:** none of these controllers have providers to scope, so a feature
module each would be five files of `@Module({ controllers: [...] })` and nothing else.

**Why Prisma *and* raw SQL:** the query builder cannot express row locks (`FOR UPDATE`),
column-to-column comparisons (`uses < max_uses`), or partial-index-aware lookups. Those are
exactly the paths where the SQL **is** the correctness argument, so they stay raw. Everything
else uses the typed client.

## F2. Four authentication surfaces, on purpose

| Surface | Credential | Checked by | Notes |
|---|---|---|---|
| Portal | Session JWT, HS256, 12h | `AuthGuard` | Algorithm **pinned**, never inferred from the token's own header. Then one DB lookup per request so suspension is instant and a role demotion takes effect immediately — the DB is trusted over the token |
| Admin | Same JWT + `type === 'admin'` | `AdminGuard` | |
| Partner / Issuance | `pk_…` API key, sha256-hashed at rest | `orgFromKey(auth, type)` | One function, not two — two copies of an auth check is two places to forget `suspended: false` |
| Payment webhook | HMAC-SHA256 over the **raw bytes** | constant-time compare | Re-serialising the parsed body is not what was signed. That's why the JSON parser stashes `rawBody` |

## F3. The scan engine

`GET /r/:code` — the hot path. Its whole job is: decide fast, write one fact, redirect.

```
rate limit ─> load code+campaign+partnership+publisher in ONE query
           ─> six status gates (see A9)
           ─> resolve destination BEFORE burning a use
           ─> ┌ ONE TRANSACTION ────────────────────────────────────┐
              │ UPDATE qr_codes SET uses = uses + 1                  │
              │   WHERE NOT voided                                   │
              │     AND (expires_at IS NULL OR expires_at > now())   │
              │     AND (max_uses IS NULL OR uses < max_uses)        │
              │   RETURNING uses          <- 0 rows = lost the race  │
              │ INSERT INTO scans (claim_id, platform, ip_hash, …)   │
              └──────────────────────────────────────────────────────┘
           ─> redirect, or render the iOS hand-off first
```

Two design points worth understanding:

- **The conditional UPDATE is the whole concurrency story.** Expiry, single-use and the race
  are one statement. Two simultaneous scans can never both take the last use.
- **The two writes are one fact.** A use claimed without a matching scan row burns a use of a
  physical print run that can then never be attributed — the scanner installs the app and the
  publisher is told `no_match`.

The `claim_id` is `randomBytes(16)` base64url. It is **deliberately not a signed token**: a
token is a bearer credential the device could spend. This is an opaque lookup key whose only
power is to name a scan that the publisher's *server* must then claim with its API key.

## F4. The attribution engine

This is the cleverest part of the system. Its job: decide whether an install came from a scan,
and **refuse when it can't tell.**

### Two paths, and no falling between them

```
                          claim_id present?
                          /              \
                       YES                NO
                        |                  |
              ┌─────────▼────────┐   ┌─────▼──────────────────────┐
              │ DETERMINISTIC    │   │ PROBABILISTIC              │
              │ Play referrer    │   │ hashed IP + platform       │
              │ names ONE scan   │   │ narrows to <=20 candidates │
              │ confidence = 100 │   │ then SCORE them            │
              │ window: 30 days  │   │ window: 60 minutes         │
              └─────────┬────────┘   └─────┬──────────────────────┘
                        │                  │
                 found? ──no──> no_match   └──> decide()
```

**A failed deterministic lookup never falls back to the fingerprint.** If a claim id was
presented and didn't resolve, the referrer named a scan that is gone, already claimed, or
belongs to a different publisher. Quietly re-matching that device on IP would turn a failed
exact lookup into a guess — the one thing this path must never do.

### The scoring model

Hashed IP + platform is the **filter**, not the evidence. Behind carrier-grade NAT, café wifi
or a corporate VPN that can be dozens of unrelated handsets.

```
BASE (hashed IP + platform)              55     <- deliberately BELOW any legal MIN_CONFIDENCE
  + screen matches   {short}x{long}@{dpr} 22    <- the only signal with real entropy
  + timezone matches  IANA zone            8
  + language matches  primary subtag       7
  + cores matches     logical CPU count    5    <- splits generations the screen can't
  + dark matches      appearance           3    <- one bit, and it earns its keep as a tiebreaker
  ─────────────────────────────────────────
  = 100 maximum, so a score reads as a percentage
```

`MIN_CONFIDENCE` defaults to **70**, so the base alone is refused. At least one signal that
actually *describes the handset* has to agree before anyone is paid.

**Screen outweighs timezone + language combined** because it is the only one with real entropy:
a whole country shares a timezone and a language, while screen geometry splits it by model.

### The two refusals are the design, not error handling

| Refusal | When | Why refusing is correct |
|---|---|---|
| `low_confidence` | Best candidate scores under the floor | "Somebody on this postcode installed something" is not evidence about who scanned the poster |
| `ambiguous` | Two candidates score **exactly** equal | Newest-first would resolve it — and that is exactly the temptation to refuse. Picking one would invent a fact and pay one publisher for another's scan |

Candidates arrive newest-first and the sort is stable, so equal evidence still orders by
recency — which is precisely the tie the next line then declines to act on.

### Signals must survive a browser → native crossing

Two sides have to produce **byte-identical strings**: a mobile browser at scan time, and a
native SDK at first open, minutes later. Everything is normalised for that crossing:

| Signal | Browser | Native | Normalisation |
|---|---|---|---|
| `tz` | `Intl…timeZone` | `TimeZone.current` | IANA string, charset-bounded |
| `screen` | CSS px | points (`UIScreen.bounds`, `dp`) | **Orientation-normalised** `{short}x{long}@{dpr}` — a phone held sideways at scan and upright at first open is the same phone. `3.0` and `3` are the same ratio |
| `language` | `navigator.language` | locale | Primary subtag, lowercased |
| `cores` | `hardwareConcurrency` | `activeProcessorCount` | Integer, bounded 1–512 |
| `dark` | `prefers-color-scheme` | `userInterfaceStyle` | Tri-state — `null` is "never measured", which is **not** the same fact as "light" |

Anything that does *not* survive that crossing — UA string, browser version, engine, fonts,
canvas — is **worse than useless**: it doesn't merely fail to match, it drags a real match
below the acceptance line. So it isn't collected as evidence at all.

**IP hashing** is where two spellings of one address are reconciled: a dual-stack socket reports
every IPv4 client as `::ffff:203.0.113.7` while the publisher sends `203.0.113.7`, and
`2001:db8::1` and `2001:0db8:0:0:0:0:0:1` are the same host. Both sides go through `ipHash()`,
which unwraps the mapped form and canonicalises IPv6 through the WHATWG URL parser before
hashing. Get this wrong and the symptom is an attribution rate of zero **with no error anywhere**.

### Why installs are a separate table

```
   SCAN ────────── minutes ──────────> FIRST OPEN ───── days ─────> SIGNUP
   consumed=true                       install row               redemption row
   (claim bound)                       redeemed=false            MONEY MOVES
```

Matching at signup time meant the iOS fingerprint window had to cover install + onboarding +
registration, which no honest window can — so it either missed every real install or was wide
enough to match strangers. Binding at first open keeps the window tight; the signup can then
take as long as it likes.

The scan is **deliberately not re-matched** at signup. Re-running the matcher there would
reintroduce exactly the bug the install stage exists to fix.

### Device integrity is graded, not trusted uniformly

The SDK *asserts* these; we never observe them.

| Signal | Action | Why |
|---|---|---|
| `emulator` | **Blocks** | The shape of every install farm, and cheap to act on |
| `rooted` | Recorded only | The honest population is large enough that refusing them would deny real users a real reward |
| `vpn` | Recorded only | Barely a fraud signal — a VPN changes the address between scan and open, so the fingerprint just fails to match. Recording it is what *explains* a `no_match` rate instead of leaving the matcher looking broken |

All three are stored on **accepted** installs too: the pattern worth finding is the one that
got paid.

## F5. The money engine

### Double-entry, append-only

```
ledger_entries       every entry has (account, amount, ref). Positive = credit.
                     Entries sharing a ref sum to ZERO. So the whole book sums to zero.
                     UPDATE / DELETE / TRUNCATE all RAISE (a database trigger).
                     Corrections are posted as compensating entries.

account_balances     the materialised sum per account. Locked FOR UPDATE on every spend.
```

**Accounts:**

| Account | Meaning |
|---|---|
| `campaign:{id}` | A campaign's remaining budget |
| `publisher:{org_id}` | What a publisher has earned |
| `platform:fees` | The platform's revenue — every retained cut |
| `external:funding` | Money entering the system (always negative) |
| `external:payouts` | Money leaving to publishers (always positive) |

### Every payout, in three entries under one ref

```
payout(tx, campaignId, publisherId, gross, feeBps, ref):

    campaign:{id}       -gross      the promoter's budget spends the agreed rate
    publisher:{org}     +net        what the publisher actually earns
    platform:fees       +cut        the platform's revenue
                        ─────
                          0
```

**Every payout routes through this one function**, so the split cannot be applied on one path
and forgotten on another. `splitFee` floors the cut, so rounding always favours the publisher —
the party being paid. One rounding rule, one place: two call sites rounding differently is a
ledger that fails to sum to zero.

### The locking discipline

Every path that **spends** takes `lockedBalance()` — a `SELECT balance … FOR UPDATE` — so two
concurrent debits cannot both pass the same `>= 0` check.

But **rendering** a balance on a dashboard deliberately does not lock. `FOR UPDATE` is an
exclusive row lock, and every attribution payout to a publisher updates that same row — so a
polled dashboard was blocking the money path to display a figure nothing then spends against.
That's the `lock` parameter on `withdrawable()`.

### Fail closed, then roll back

A signup that arrives one credit short must **not burn the install**. But the guard
(`redeemed` / `consumed`) is flipped *before* the fee is known, because the fee depends on
`identified`. Returning normally would commit that flip — permanently unattributable, even
after the promoter tops the budget back up, with the user's account already created.

So the budget refusal is **thrown** (`class Rollback`) and the whole transaction is undone.
The caller still gets a `200` with `budget_exhausted`. The rollback *is* the guard.

### Why the `ledger()` helper seeds at zero

```sql
INSERT INTO account_balances (account, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING;
UPDATE account_balances SET balance = balance + $2 WHERE account = $1;
```

Not an `upsert`, and the reason is subtle: Postgres checks CHECK constraints against the tuple
an `INSERT … ON CONFLICT DO UPDATE` *proposes*, **before** it detects the conflict. So
`create: { balance: -10 }` is tested as a standalone `-10` row and rejected by the
non-negative constraint even when the account holds 100. Seeding at 0 first means the floor is
only ever checked against the value that actually lands.

### The full money map

```
   MONEY IN                                                       MONEY OUT
   ────────                                                       ─────────
   POST /v1/payments/checkout          (promoter, session)
        │  creates a `pending` payment row
        ▼
   POST /v1/payments/webhook           (PSP, HMAC-signed)
        │  external:funding  -coins
        │  campaign:{id}     +coins        ref: fund:{payment_id}
        ▼
   ╔═══════════════════════╗
   ║   campaign:{id}       ║ ◄── admin adjust (± , audited, never below 0)
   ╚═══════┬═══════════════╝
           │ every attribution / purchase payout
           ▼
   ╔═══════════════════════╗      ╔═══════════════════╗
   ║  publisher:{org}      ║      ║  platform:fees    ║  <- the business's revenue
   ╚═══════┬═══════════════╝      ╚═══════════════════╝
           │ POST /v1/withdrawals  (a REQUEST — no money moves)
           │ ...SETTLEMENT_DELAY_DAYS must have passed...
           │ POST /v1/admin/withdrawals/:id/pay  (an admin decision)
           ▼
   ╔═══════════════════════╗
   ║   external:payouts    ║
   ╚═══════════════════════╝
```

Neither counterparty can move money on their own say-so. In requires a signed webhook.
Out requires an admin.

## F6. Where every guarantee is actually enforced

This is the table to read before changing anything in the money path. **Almost none of these
live in application code**, on purpose — code can be bypassed by the next endpoint somebody adds.

| Guarantee | Enforced by |
|---|---|
| One payout per user, per acquisition campaign, ever | `UNIQUE (campaign_id, publisher_user_ref) WHERE kind = 'acquisition'` — **partial** |
| One acquisition payout per scan | `UNIQUE (scan_id) WHERE kind = 'acquisition'` — **partial** |
| One engagement payout per issued code | `UNIQUE (qr_code_id) WHERE kind = 'engagement'` — **partial** |
| A retried credit never doubles money | `UNIQUE (account, ref)` on `ledger_entries` |
| One PSP charge completes at most one payment | Partial unique index on `payments.provider_ref` |
| One transaction, one issued code | `UNIQUE (campaign_id, issued_ref)` (NULLs are distinct, so studio codes are unaffected) |
| The ledger can never be rewritten | A trigger — UPDATE, DELETE and TRUNCATE all raise |
| A balance can never go negative | `account_balances_non_negative_check` |
| `guest_rate <= coin_rate` | CHECK constraint (plus a friendly message in `validateRates`) |
| Valid statuses / org types / modes | CHECK constraints |
| One partnership per promoter/publisher pair | `UNIQUE (promoter_org_id, publisher_org_id)` |
| One install per scan | `scans.consumed`, flipped by the same UPDATE that tests it |
| One signup per install | `installs.redeemed`, same trick |
| No double scan on the last use | The conditional `UPDATE … WHERE uses < max_uses` |
| No two concurrent debits both passing | `SELECT … FOR UPDATE` on the balance row |
| No two claims queuing on one scan | `FOR UPDATE OF s SKIP LOCKED` — the loser **skips** and answers unattributed, which is correct |

> **The partial indexes are load-bearing.** Declaring the first one as a plain `@@unique` in
> `schema.prisma` would create a *total* index and re-impose "one payout per user ever" on the
> engagement rows the whole mode exists to allow. That is why those, and the CHECK constraints,
> live in the migration SQL — Prisma's differ ignores CHECKs, so they survive future
> `migrate dev` runs instead of being dropped as drift. Always look them up with `findFirst`,
> never `findUnique`.

## F7. Idempotency and replay, everywhere

Retries are normal. A lost response is the usual reason a caller calls twice. So the answer is
never a 409 that makes a correctly-recorded fact look like something to reconcile by hand.

| Path | Replay behaviour |
|---|---|
| `POST /v1/issue` | Same `issued_ref` → the **same code**, `replay: true` |
| `POST /v1/attribution/claim` (acquisition) | Same user, same campaign → the original answer replayed verbatim, `replay: true`, **no** second ledger entry |
| `POST /v1/attribution/claim` (engagement) | Same code + **same** user → replay. Same code + **different** user → `already_claimed`. A forwarded screenshot is not a retry |
| `POST /v1/attribution/:id/confirm` | Second call → `already_full` |
| `POST /v1/payments/webhook` | Redelivered → `replay: true`, credited once |
| `POST /v1/campaigns/:id/fund` | With an `idempotency_key` → credited once |
| `POST /v1/admin/campaigns/:id/adjust` | Same |
| `POST /v1/attribution/first-open` | Second call → `no_match` (the scan is already consumed). Persist the `install_id` |

The replay answer is always reconstructed from the **stored row**, never guessed — the
platform fee is recomputed from the snapshotted bps through the same `splitFee` the payout used.

## F8. Observability and self-defence

| Piece | What it does |
|---|---|
| `requestContext` | First middleware, so every log line and every 429 carries a request id |
| `recordDecision()` | **One record per attribution decision, refused or paid.** This is the series that makes a misconfigured store target visible — it produces no errors and writes no rows, so without it the only symptom is a publisher quietly earning nothing |
| `GET /metrics` | Prometheus text format, token-gated in production. The refusal rates describe this platform's payout behaviour to anyone who asks |
| `startReconciliation()` | Every 10 minutes: ledger sum ≠ 0, and cached balances vs their entries. Runs once at boot too — a deploy is exactly when drift is worth catching |
| `budgetLow()` | Fires when a campaign's remaining budget drops below 10× the last fee. The promoter's print run is live and about to start bouncing |
| `alert()` | Structured `error` log **always**, plus a Slack-compatible POST when `ALERT_WEBHOOK_URL` is set. A failing alert channel never takes the money path with it |
| `PrismaExceptionFilter` | Turns a driver error (a malformed uuid in a URL, most often) into the 4xx it actually is instead of an unhandled 500 |
| `SIGTERM` handler | Drains in-flight requests, closes the pool and Redis, then exits — so a redeploy cannot tear down a half-written attribution |

## F9. Privacy posture

The ceiling on what this system knows is **whatever the redirect hop already receives**.

| Stored | Not stored |
|---|---|
| Truncated sha256 of the IP (16 hex chars) | The IP itself |
| Coarse geo from CDN headers (country, city) | Precise location |
| UA-derived OS / browser / device type | Any identifier the user typed |
| Normalised tz, screen, language, cores, dark | Name, email, phone |
| `publisher_user_ref` — **the publisher's own opaque id** | Anything that resolves it to a person |

Response headers on every route: `default-src 'none'` CSP, `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer` (so a store listing never learns which code sent the visitor),
`Cross-Origin-Resource-Policy: same-site`, and HSTS in production.

## F10. Data model

```
                        ┌──────────┐
                        │   Org    │  promoter | publisher | admin
                        └────┬─────┘  api_key_hash, approved, suspended,
                             │        landing_url, android_package, ios_app_id,
              promoter ──────┤        deeplink_url, bonus_label
              publisher ─────┤
                        ┌────▼────────────┐
                        │  Partnership    │  coin_rate, guest_rate, grace_days,
                        │                 │  engagement_rate, proposed_*,
                        │  UNIQUE(pro,pub)│  platform_fee_bps (SNAPSHOT), status
                        └────┬────────────┘
                             │
                        ┌────▼────────┐
                        │  Campaign   │  mode (fixed at creation), status
                        └────┬────────┘
                             │
                   ┌─────────┴─────────┐
              ┌────▼─────┐        ┌────▼─────┐
              │  QrCode  │───────>│   Scan   │  claim_id UNIQUE, ip (hashed),
              │ code UQ  │        │          │  platform, consumed,
              │ expires  │        │          │  tz/screen/cores/dark, client JSON
              │ max_uses │        └────┬─────┘
              │ issued_  │             │ 1:1
              │  ref     │        ┌────▼─────┐
              └────┬─────┘        │ Install  │  match_method, confidence,
                   │              │          │  device_hash, risk, redeemed,
                   │              └────┬─────┘  expires_at
                   │                   │
                   └──────┐    ┌───────┘
                       ┌──▼────▼──────┐
                       │  Redemption  │  kind, coins, identified, match_method,
                       │              │  confidence, upgraded_at
                       │  3 PARTIAL   │
                       │  UNIQUE idx  │
                       └──────────────┘

   Money:   LedgerEntry (append-only) ──sums to──> AccountBalance (locked)
            Payment (checkout -> webhook)     Withdrawal (request -> admin decision)
   Trail:   AuditLog (actor, action, target, detail, acknowledged_at)
```

**One scan can carry two redemptions** — at most one acquisition and one engagement, never two
of a kind. A boarding pass scanned by somebody with no app yet is honestly both.

Field names are deliberately `snake_case` and identical to the column names: the API returns
rows straight to the frontend, so camelCasing in the schema would rename every JSON key.

## F11. File map — where to look for what

| Path | What lives there |
|---|---|
| `backend/src/config.ts` | Every setting, validated at import. Production boot guards |
| `backend/src/main.ts` | Middleware order, Swagger, metrics, graceful shutdown |
| `backend/src/common/attribution.ts` | **The matcher's brain** — signal normalisation, weights, `score()`, `decide()`, store URL building |
| `backend/src/common/rates.ts` | `validateRates()` and `splitFee()`. One money rule, one implementation |
| `backend/src/common/security.ts` | Rate limiting, `ipHash`, `str()` bounds, URL validation, security headers |
| `backend/src/common/signals.ts` | Reporting-only signals (geo, UA parsing, client hints) — kept apart from matching signals on purpose |
| `backend/src/common/qr.ts` | Style validation and SVG/PNG rendering |
| `backend/src/common/alerts.ts` | Reconciliation sweep, budget-low alerts |
| `backend/src/common/obs.ts` | Structured logging, counters, `recordDecision`, metrics rendering |
| `backend/src/database/ledger.ts` | **The money engine** — `ledger`, `payout`, `lockedBalance`, `withdrawable`, `audit` |
| `backend/src/database/analytics.ts` | Every breakdown in one `UNION ALL` over one CTE |
| `backend/src/modules/public/` | `/r/:code`, the iOS hand-off, QR images |
| `backend/src/modules/partner/` | `/v1/attribution/*` (the money path) and `/v1/issue` |
| `backend/src/modules/portal/` | Everything a signed-in tenant does |
| `backend/src/modules/admin/` | Cross-tenant reads and every override |
| `backend/src/modules/payments/` | Checkout + the signed, idempotent funding webhook |
| `backend/prisma/schema.prisma` | The data model |
| `backend/prisma/migrations/0_init/` | **The money invariants** — CHECKs, partial unique indexes, the append-only trigger |
| `frontend/app/dashboard/` | Promoter + publisher console (5 sections) |
| `frontend/app/campaigns/[id]/` | Campaign page: Performance, Audience, QR studio (5 panels) |
| `frontend/app/admin/` | Super admin console (11 tabs) |
| `frontend/app/publisher-sim/` | Stand-in publisher app; `app/api/sim-signup` is its backend |
| `e2e-test.sh` | 160+ assertions over real HTTP. The executable spec |
| `seed.mjs` | Builds the minimal demo world **through the real HTTP API** |

## F12. Deliberate ceilings (known, bounded, upgradeable)

Marked in the code as `ponytail:` comments. None of them are bugs; all are the honest limit of
a simple choice.

| Ceiling | Where | Upgrade path |
|---|---|---|
| 20 fingerprint candidates per lookup | `partner.controller.ts` | Raise, or narrow the window, if a deployment measures matches being *lost* rather than merely ambiguous |
| Ledger drift check aggregates the whole book | `admin.controller.ts`, `alerts.ts` | Move to an incremental check keyed on recent refs when a sweep is slow enough to notice |
| HS256 shared JWT secret | `tokens.ts` | ES256 + KMS |
| In-process per-key rate ceiling | `api-key.ts` | The shared Redis limiter, once >1 instance runs |
| `device_hash` is a device *shape*, not a device | `partner.controller.ts` | Which is exactly why the check it feeds **refuses an install** rather than banning anything, and why `DEVICE_DEDUPE_DAYS` can be turned off |
| Geo from edge headers only | `signals.ts` | MaxMind GeoLite2 + a refresh job |

## F13. If you change one thing, know this

- **`BASE_URL` after printing** → every printed code points at the wrong host. A reprint, not a redeploy.
- **`PLATFORM_FEE_BPS`** → only affects *future* partnerships. Existing ones carry a snapshot.
- **A partial unique index** → read F6 first. Making one total silently breaks a whole product mode.
- **`MIN_CONFIDENCE` below 60** → you are paying for "somebody on this NAT installed something".
- **Adding a replica without `REDIS_URL`** → every per-IP security limit doubles.
- **`TRUST_PROXY`** → get it wrong and either every limit collapses into one bucket, or one attacker becomes unlimited IPs.
- **A new money path** → route it through `payout()`. That function existing in one place is why the split cannot be forgotten on one branch.

---

**Further reading in this repo:** `README.md` (setup + deployment), `DEMO.md` (the 12-minute
demo script), `SYSTEM_DESIGN.md` (the full design document), Swagger at `/docs` (generated from
the live controllers), and `e2e-test.sh` — which is the executable version of Part B.
