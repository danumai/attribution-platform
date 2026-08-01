# QR Reward Platform — How It Works

A guide to the whole system, in plain language, with the exact rules the code enforces.

---

## The Idea in One Sentence

A brand pays for people to sign up on a content app, using a QR code as the bridge — and
coins get paid out automatically, safely, with no double-paying.

---

## The People Involved

| Who | Example | What they want | How they log in |
|---|---|---|---|
| **Promoter** | An airline running a promo | New signups on a partner app | Email + password |
| **Publisher** | A content app (movies, shows) | New users, paid per signup | Email + password, **plus** an API key for their server |
| **End user** | Someone with a phone | Scan a code, sign up, get free coins | Nothing — never touches this platform directly |
| **Super admin** | The platform owner | Oversight, overrides, a trail of both | Email + password, seeded from env on first boot |

One login per company (`orgs` table). A publisher's API key is shown **once** at signup and
stored only as a SHA-256 hash — rotating it invalidates the old one immediately.

---

## Figure 1: The Big Picture

```
   PROMOTER                    PUBLISHER
  (pays coins)              (hosts signups)
       │                          │
       │   1. Partnership: rates  │
       │      agreed & accepted   │
       └──────────┬───────────────┘
                  │
          2. Promoter creates a
             campaign and funds it
                  │
                  ▼
          3. QR code generated,
             styled, printed
                  │
                  ▼
          ┌───────────────┐
          │   END USER    │
          │ scans with    │
          │ their phone   │
          └───────┬───────┘
                  │
          4. Redirected to the publisher's
             landing page, carrying a
             15-minute scan token
                  │
                  ▼
          5. User signs up; the publisher's
             server calls the Partner API
             with that token
                  │
                  ▼
          6. Coins move: campaign budget → publisher,
             in one transaction, exactly once
                  │
                  ▼
          Dashboards update on next load
```

---

## Figure 2: The Lifecycle, Step by Step

```
 STEP 1               STEP 2               STEP 3
┌──────────┐ request ┌──────────┐ accept  ┌─────────────┐
│ Promoter │────────►│Publisher │────────►│ Partnership │
│ proposes │  rates  │ reviews  │         │  is active  │
└──────────┘         └──────────┘         └──────┬──────┘
                                                 │
 STEP 5                                    STEP 4│
 Promoter funds the campaign  ◄─────────────┌────▼──────┐
 (ledger credit; PSP in production)         │  Campaign │
        │                                   │  created  │
        ▼                                   └───────────┘
 STEP 6
 QR code created — 30-day expiry by default,
 optional max-uses, fully styleable, SVG/PNG
        │
        ▼
 STEP 7              STEP 8               STEP 9
┌──────────┐ scans  ┌───────────┐ signs   ┌────────────┐
│ Someone  │───────►│ Publisher │ up      │   Coins    │
│ scans it │  /r/…  │  landing  │────────►│ paid out   │
└──────────┘        │  page     │ Partner │            │
                    └───────────┘ API     └────────────┘
```

**Step 1 sets three numbers**, and they are the whole commercial deal:

| Setting | Default | Meaning |
|---|---|---|
| `coin_rate` | 50 | Coins for a **verified** signup (the full price) |
| `guest_rate` | 10 | Coins paid immediately for an **unverified guest** |
| `grace_days` | 7 | How long the guest has to verify and claim the difference |

`guest_rate` can never exceed `coin_rate` — the database enforces it.

---

## Figure 3: What Happens on a Scan

The scan path (`GET /r/:code`) is the hot path, and it fails **closed**: anything unclear
turns the user away with an explanation rather than a broken page.

```
  Scan ──► rate limit? (30 scans/min per IP) ──► rate_limited
       ──► code exists?                       ──► invalid
       ──► code voided?                       ──► voided
       ──► campaign active?                   ──► paused / ended
       ──► budget left?                       ──► budget
       ──► claim one use, atomically:
             not expired AND uses < max_uses  ──► expired / used_up
       ──► record scan (IP stored hashed, UA truncated)
       ──► sign a 15-minute, single-use scan token
       ──► redirect to publisher landing page ?st=<token>
```

Each turn-away reason renders its own message on `/campaign-ended` — a dead end looks like
a broken sticker, so the user always learns which of these happened.

Claiming the use is a single conditional `UPDATE`, so two simultaneous scans can never both
take the last use of a code.

---

## Figure 4: Two Reward Tiers

Reward first, identify second. The guest keeps what they earned and is nudged, not gated.

```
  Publisher's server ──► POST /v1/redemptions/verify
                          { scan_token, publisher_user_ref, identified }
                                       │
              identified: true ────────┴──────── identified: false / absent
                     │                                    │
                     ▼                                    ▼
             pays coin_rate (50)                  pays guest_rate (10)
                                                  40 held back, deadline = now + grace_days
                                                          │
                                        user verifies later; publisher calls
                                        POST /v1/redemptions/:id/upgrade
                                                          │
                                                          ▼
                                        remaining 40 released (idempotent;
                                        refused after the deadline)
```

Absent an explicit `identified: true`, the guest tier applies — the promoter never pays full
price for a scan nobody vouched for.

---

## Figure 5: What Makes It Safe

```
  ✔  One reward per user per campaign
      — a UNIQUE (campaign_id, publisher_user_ref) constraint, so it holds under a race,
        not just under a check

  ✔  One redemption per scan
      — the scan token is JWT-signed, expires in 15 minutes, and is marked consumed
        inside the paying transaction

  ✔  A campaign can never overspend
      — the budget row is locked FOR UPDATE and the payout refused if it falls short

  ✔  Every coin movement is double-entry
      — each transfer writes two rows with a shared ref that sums to zero, so nothing
        appears or vanishes silently

  ✔  Suspension takes effect now
      — every authenticated request re-checks the org, so a suspended tenant loses access
        without waiting out its 12-hour session

  ✔  Publisher landing URLs are validated
      — https only (http for localhost), no javascript:/data:, no embedded credentials,
        because that redirect is where a scan token leaves our origin

  ✔  Every admin override is written to the audit log
      — who, what, why, when
```

---

## Figure 6: The Money Flow

Three kinds of ledger account, and every transfer touches exactly two of them:

```
        external:funding                 (the outside world)
               │
               │  fund:{campaign}:{ts}    -1000 / +1000
               ▼
        campaign:{id}                     "CAMPAIGN BUDGET" (e.g. 5,000 coins)
               │
               │  redemption:{id}          -50 / +50
               │  upgrade:{id}             -40 / +40   (guest → verified top-up)
               ▼
        publisher:{org_id}                "PUBLISHER EARNINGS"

  Balances live in account_balances and are updated in the same transaction as the
  ledger rows — the ledger is the truth, the balance is the fast read.

  When the budget hits zero the QR stops redirecting and sends people to
  /campaign-ended?reason=budget instead.
```

Admins can also adjust a budget by hand (goodwill credit, or clawing back a mis-funded
campaign). It moves through the same ledger, can never push a balance below zero, and is
audited.

---

## Figure 7: Who Sees What

```
┌────────────────────────────────────────────────┐
│  PROMOTER                                       │
│  • request partnerships, set the three rates    │
│  • create, fund, pause and end campaigns        │
│  • design QR codes (colors, size, quiet zone,   │
│    error correction, center logo) and download  │
│    print-ready SVG or PNG                       │
│  • void a code whose print run went astray      │
│  • scans / redemptions / coins / budget left    │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  PUBLISHER                                      │
│  • accept or ignore partnership requests        │
│  • see and rotate their Partner API key         │
│  • set the landing URL scans redirect to        │
│  • what they've earned, campaign by campaign    │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  SUPER ADMIN                                    │
│  • overview, orgs, partnerships, campaigns,     │
│    scans, redemptions, QR codes, ledger         │
│  • suspend or offboard an org, rotate its key   │
│  • kill a campaign (ends it and voids every     │
│    code in one shot)                            │
│  • loosen a code's expiry or use limit          │
│  • adjust a budget — every one of these lands   │
│    in the audit log                             │
└────────────────────────────────────────────────┘

Every portal query is scoped to the caller's org. Nobody sees another company's numbers.
```

Promoters may tighten their own codes (voiding one) but never loosen them — extending a
code's life is an admin action precisely because it loosens a money control.

---

## The API Surface

| Surface | Auth | Used by |
|---|---|---|
| `POST /v1/auth/signup`, `/login` | none | Anyone creating or using an account |
| `GET /r/:code` | none | Phones, on scan |
| `GET /v1/qr-codes/:id/image` | none | The QR preview and print downloads (120/min per IP) |
| `GET /healthz` | none | Load balancer — reports 503 if Postgres is unreachable |
| `/v1/*` portal routes | session JWT (12h) | Promoter and publisher dashboards |
| `/v1/redemptions/*` | `pk_…` API key | The **publisher's server**, never a browser |
| `/v1/admin/*` | session JWT + admin role | Super admin console |

Full request/response shapes for every route: **[openapi.yaml](openapi.yaml)** — an
OpenAPI 3.0 document, viewable interactively by pasting it into
[editor.swagger.io](https://editor.swagger.io).

---

## Role Flows, End to End

Every step below names the exact HTTP call. `Bearer <token>` is the session JWT from
signup/login; `Bearer pk_…` is the publisher's Partner API key. Full shapes are in
[openapi.yaml](openapi.yaml).

### Promoter journey

```
1.  Create an account
    POST /v1/auth/signup            { type: "promoter", name, email, password }
    → 201 { token, org }                                              auth: none

2.  Browse publishers to partner with
    GET  /v1/publishers                                                auth: Bearer <token>

3.  Propose partnership terms (coin_rate, guest_rate, grace_days)
    POST /v1/partnerships           { publisher_org_id, coin_rate, guest_rate, grace_days }
    → 201 partnership, status "pending"                                auth: Bearer <token>

4.  Wait for the publisher to accept (poll or reload)
    GET  /v1/partnerships                                              auth: Bearer <token>

5.  Create a campaign under the now-active partnership
    POST /v1/campaigns              { partnership_id, name }
    → 201 campaign, budget 0                                           auth: Bearer <token>

6.  Fund it (ledger credit; PSP checkout in production)
    POST /v1/campaigns/:id/fund     { coins }
    → 201 { budget }                                                   auth: Bearer <token>

7.  Design and generate a QR code
    POST /v1/campaigns/:id/qr-codes { style, expires_in_days, max_uses }
    → 201 { code, scan_url, ... }                                      auth: Bearer <token>
    GET  /v1/qr-codes/:id/image?format=svg   (or png)   ← print-ready   auth: none

8.  Watch it perform
    GET  /v1/campaigns/:id/stats                                       auth: Bearer <token>
    GET  /v1/redemptions                                                auth: Bearer <token>

9.  Pause, resume, or end the campaign as needed
    PATCH /v1/campaigns/:id         { status: "paused"|"active"|"ended" }
    auth: Bearer <token>

10. Void a code whose print run went astray (tighten only — never loosen)
    POST /v1/qr-codes/:id/void                                         auth: Bearer <token>
```

### Publisher journey

```
1.  Create an account — this also mints a Partner API key, shown once
    POST /v1/auth/signup            { type: "publisher", name, email, password, landing_url }
    → 201 { token, org, api_key }                                      auth: none
    (store api_key now — it is never shown again; POST /v1/api-keys/rotate to reissue)

2.  Review and accept an incoming partnership request
    GET  /v1/partnerships                                              auth: Bearer <token>
    POST /v1/partnerships/:id/accept                                   auth: Bearer <token>

3.  Set (or update) where scans should land
    PATCH /v1/orgs/me               { landing_url }                    auth: Bearer <token>

4.  --- a user arrives at landing_url?st=<scan_token> from a scan; user signs up on the
        publisher's own app; the publisher's *server* now calls the Partner API ---

5.  Grant the reward
    POST /v1/redemptions/verify     { scan_token, publisher_user_ref, identified }
    → 201 { redemption_id, coins, status: "granted", pending_coins, upgrade_deadline }
    auth: Bearer pk_<api_key>                                          (server-to-server only)

6.  Later, once the user clears the publisher's own verification bar
    POST /v1/redemptions/:id/upgrade
    → 201 { coins, coins_added, status: "upgraded" }                   auth: Bearer pk_<api_key>

7.  Track earnings
    GET  /v1/redemptions                                                auth: Bearer <token>
    GET  /v1/campaigns                (budget/coin_rate per campaign)   auth: Bearer <token>
```

### End user journey

The end user never has an account on this platform and never calls its API directly — only
their phone's browser follows redirects, and the publisher's server does the API calls on
their behalf.

```
1.  Scan the printed/displayed QR code
    GET  /r/:code                                                      auth: none
    → 302 to <publisher landing_url>?st=<15-min single-use scan token>
      or, if turned away, to /campaign-ended?reason=<rate_limited|invalid|voided|
      paused|ended|budget|expired|used_up>

2.  Land on the publisher's page, sign up there (publisher-owned UI, not this platform's)

3.  Publisher's server redeems the scan token server-side — see Publisher journey step 5.
    Coins are credited to the publisher's account; the user never sees this call.

4.  If the publisher later confirms the user is a verified subscriber, the publisher's
    server calls the upgrade endpoint (step 6 above) and the held-back coins are released.
```

### Super admin journey

Seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on first boot — never created via signup.

```
1.  Log in
    POST /v1/auth/login             { email, password }
    → 200 { token, org: { type: "admin" } }                            auth: none

2.  Platform health at a glance
    GET  /v1/admin/overview         (17 aggregates + ledger_balanced + conversion_rate)
    auth: Bearer <token> (admin)

3.  Cross-tenant reads — every org, partnership, campaign, code, scan, redemption
    GET  /v1/admin/orgs?q=
    GET  /v1/admin/partnerships
    GET  /v1/admin/campaigns
    GET  /v1/admin/qr-codes
    GET  /v1/admin/scans?campaign_id=
    GET  /v1/admin/redemptions
    GET  /v1/admin/ledger?account=
    auth: Bearer <token> (admin)

4.  Override a partnership's commercial terms
    PATCH /v1/admin/partnerships/:id { coin_rate, guest_rate, grace_days, status }
    auth: Bearer <token> (admin) — audited

5.  Kill a runaway campaign (ends it, voids every code it issued)
    POST /v1/admin/campaigns/:id/kill { reason }
    auth: Bearer <token> (admin) — audited

6.  Loosen a code's limits (the only role that can — extend expiry, raise/remove max_uses,
    un-void)
    PATCH /v1/admin/qr-codes/:id    { expires_at, max_uses, voided, reason }
    auth: Bearer <token> (admin) — audited

7.  Adjust a budget by hand (goodwill credit, or a clawback)
    POST /v1/admin/campaigns/:id/adjust { coins, reason }
    auth: Bearer <token> (admin) — audited

8.  Suspend, edit, or fully offboard a tenant
    PATCH /v1/admin/orgs/:id        { suspended, name, landing_url, reason }
    POST  /v1/admin/orgs/:id/rotate-key
    POST  /v1/admin/orgs/:id/offboard { reason }   ← suspends + revokes key + ends campaigns
    auth: Bearer <token> (admin) — all audited

9.  Review the trail
    GET  /v1/admin/audit-log?limit=
    auth: Bearer <token> (admin)
```

---

## What's Not Built Yet (On Purpose)

A working system, not a finished product. These are simplified deliberately and flagged in
the code as `ponytail:` comments so nobody mistakes them for bugs:

- **Real payment processing** — funding a campaign credits the ledger directly; production
  would put a PSP checkout in front of it
- **One login per company** — no teams, roles or invitations yet (login *is* the org)
- **In-process rate limiting** — correct on one instance; needs Redis behind more than one
- **HS256 shared secret** for tokens — fine here, ES256 + KMS for production
- **Automated fraud alerts** to a team's Slack or email

None of it touches the core promise: **coins can't be duplicated, lost, or paid out twice.**

---

## The One-Minute Pitch

> A brand pays into a campaign. A QR code goes out into the world. Every scan either turns
> into a paid signup or gets safely turned away with a reason — and the money only ever
> moves once, in the right direction, with a double-entry trail behind it.
