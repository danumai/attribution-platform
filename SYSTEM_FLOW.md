# QR Reward Platform — How It Works

The whole system in one document: how it works, how a publisher integrates against it, and
what it does and does not defend against.

- **[Part I — How It Works](#part-i--how-it-works)** — the model, the flows, the money
- **[Part II — Publisher Integration](#part-ii--publisher-integration)** — wiring your backend to the Partner API
- **[Part III — Security Model](#part-iii--security-model)** — threat model, controls, and the accepted risks

Machine-readable API reference: the live **Swagger UI at `/docs`**, generated straight from
the running controllers — a new route appears there with no extra step.

---
---

# Part I — How It Works

## The Idea in One Sentence

A brand pays for people to install and sign up on a content app, using a QR code as the
bridge — and the agreed marketing fee gets paid automatically, safely, with no double-paying.

**The QR unlocks nothing.** A scan opens a store listing and carries no token, key or code
into the app; the install is tied back to the scan afterwards, server-to-server. That
separation is deliberate — see [Figure 8](#figure-8-why-the-qr-unlocks-nothing).

---

## The People Involved

| Who | Example | What they want | How they log in |
|---|---|---|---|
| **Promoter** | An airline running a promo | New signups on a partner app | Email + password |
| **Publisher** | A content app (movies, shows) | New users, paid per signup | Email + password, **plus** an API key for their server |
| **End user** | Someone with a phone | Scan a code, install the app, sign up | Nothing — never touches this platform directly |
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
             App Store / Play listing.
             NOTHING REDEEMABLE GOES WITH THEM.
                  │
                  ▼
          5. They install and sign up in the app.
             The publisher's server asks us:
             "is this install ours?"
                  │
                  ▼
          6. Fee moves: campaign budget → publisher,
             in one transaction, exactly once.
             Any joining bonus is the publisher's
             own, granted by the publisher.
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
┌──────────┐ scans  ┌───────────┐ installs┌────────────┐
│ Someone  │───────►│ App Store │ & signs │   Fee      │
│ scans it │  /r/…  │ or Play   │ up      │ paid out   │
└──────────┘        │  listing  │────────►│            │
                    └───────────┘ Partner └────────────┘
                                  API (server-to-server)
```

**Step 1 sets three numbers**, and they are the whole commercial deal:

| Setting | Default | Meaning |
|---|---|---|
| `coin_rate` | 50 | Fee for a **verified** signup (the full price) |
| `guest_rate` | 10 | Fee paid immediately for an **unverified guest** |
| `grace_days` | 7 | How long the guest has to verify and release the difference |

`guest_rate` can never exceed `coin_rate` — the database enforces it.

These are **marketing fees in platform credits**, paid promoter → publisher. They are not
user currency, they never enter an app, and nothing in this system grants a user anything.

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
       ──► resolve destination from the UA:
             android → Play, ios → App Store,
             else    → publisher web fallback ──► no_destination
       ──► claim one use, atomically:
             not expired AND uses < max_uses  ──► expired / used_up
       ──► record the pending claim
             (claim_id, platform, hashed IP, truncated UA)
       ──► 302 to the store listing
```

Two details carry the whole compliance argument:

**The destination is resolved before a use is burned.** A publisher who has registered no
app and no web fallback would otherwise eat a print run's uses redirecting nobody.

**The redirect carries nothing spendable.** On Android an opaque `qrm_claim` id rides
inside Play's `referrer` parameter — an install-attribution channel, not app content. On
iOS there is no such channel, so the URL is the bare store listing and the match happens on
device fingerprint instead. Either way the app receives no code it could redeem.

Each turn-away reason renders its own message on `/campaign-ended` — a dead end looks like
a broken sticker, so the user always learns which of these happened.

Claiming the use is a single conditional `UPDATE`, so two simultaneous scans can never both
take the last use of a code.

---

## Figure 3b: Tying the Install Back to the Scan

The phone left our control at the store listing. Getting it back is the part every mobile
measurement partner solves the same two ways, and so do we — deterministic first.

```
  ANDROID  (deterministic, window 30 days)

    scan ──► Play listing ?referrer=…&qrm_claim=Ab3x…
                  │
             user installs; Play preserves the referrer
                  │
             app reads it via the Install Referrer API
                  │
             app's OWN BACKEND ──► POST /v1/attribution/claim
                                    { install_referrer, publisher_user_ref }
                  │
             exact match on claim_id ──► attributed


  iOS  (probabilistic, window 60 minutes)

    scan ──► App Store listing            (no payload exists to carry)
                  │
             at scan time we kept: hashed IP + platform + timestamp
                  │
             user installs and opens; the app's backend reports the
             first-open IP and UA
                  │
             app's OWN BACKEND ──► POST /v1/attribution/claim
                                    { ip, user_agent, publisher_user_ref }
                  │
             newest unclaimed scan with the same device shape ──► attributed
```

An unmatched install is a **normal answer, not an error** — most installs are organic. The
call returns `200 { attributed: false, reason }`, so a publisher's signup path never breaks
over our accounting.

Both lookups take the scan row with `FOR UPDATE … SKIP LOCKED`, so two concurrent claims
can never both proceed against it; the loser comes back unattributed, which is correct.

The iOS window is short on purpose. Where a whole neighbourhood shares one carrier-grade
NAT address, hashed IP plus platform collide quickly, and the window is the main control on
how often that mis-attributes. It is `FINGERPRINT_WINDOW_MIN`, tunable per deployment.

---

## Figure 4: Two Fee Tiers

Pay something on signup, the rest once the publisher vouches for the user.

```
  Publisher's server ──► POST /v1/attribution/claim
                          { install_referrer | ip, publisher_user_ref, identified }
                                       │
              identified: true ────────┴──────── identified: false / absent
                     │                                    │
                     ▼                                    ▼
             pays coin_rate (50)                  pays guest_rate (10)
                                                  40 held back, deadline = now + grace_days
                                                          │
                                        user verifies later; publisher calls
                                        POST /v1/attribution/:id/confirm
                                                          │
                                                          ▼
                                        remaining 40 released (idempotent;
                                        refused after the deadline)
```

Absent an explicit `identified: true`, the guest tier applies — the promoter never pays full
price for an install nobody vouched for.

Calling `claim` twice for the same user is safe: the second call **replays the first
answer** with `replay: true` rather than failing. In practice a repeat means the publisher's
original call succeeded and its response was lost to a timeout or an at-least-once queue, and
a 409 there would make a correctly-recorded attribution look like something to reconcile by
hand. The UNIQUE constraint, not the handler, is what guarantees the fee was paid once.

---

## Figure 5: What Makes the Money Safe

The invariants below are enforced by the **database**, not by handler logic, so they hold
under concurrency. The wider security posture — authentication, rate limits, input bounds —
is [Part III](#part-iii--security-model).

```
  ✔  Nothing redeemable ever reaches a device
      — the scan redirect carries no token, key or code; the only identifier that leaves
        our origin is an opaque claim id inside Play's install-referrer channel, and it
        is useless without the publisher's server-side API key

  ✔  One fee per user per campaign
      — a UNIQUE (campaign_id, publisher_user_ref) constraint, so it holds under a race,
        not just under a check

  ✔  One attribution per scan
      — the scan row is taken FOR UPDATE SKIP LOCKED and marked consumed inside the paying
        transaction, so a replayed claim id attributes nothing a second time

  ✔  A campaign can never overspend
      — the budget row is locked FOR UPDATE and the payout refused if it falls short

  ✔  Every coin movement is double-entry
      — each transfer writes two rows with a shared ref that sums to zero, so nothing
        appears or vanishes silently

  ✔  A retried claim replays, it never re-pays
      — a lost response is the normal reason a publisher calls twice, so the same
        publisher_user_ref returns the original answer with replay: true rather than a
        409 someone has to reconcile by hand

  ✔  Suspension takes effect now
      — every authenticated request re-checks the org, so a suspended tenant loses access
        without waiting out its 12-hour session

  ✔  Store destinations are validated
      — package names and App Store ids are pattern-checked in the API and by a CHECK
        constraint, because they are interpolated into the store URL a scan redirects to;
        the web fallback is https-only, no javascript:/data:, no embedded credentials

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
        campaign:{id}                     "CAMPAIGN BUDGET" (e.g. 5,000 credits)
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
│  • scans / installs / fees / budget left        │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  PUBLISHER                                      │
│  • accept or ignore partnership requests        │
│  • see and rotate their Partner API key         │
│  • register the Play package and App Store id   │
│    scans redirect to, plus a web fallback       │
│  • declare their own joining bonus as a label   │
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

## Figure 8: Why the QR Unlocks Nothing

This is the constraint the architecture is built around, so it is worth stating plainly.

**The rule.** App Store Review Guideline 3.1.1 requires in-app purchase for unlocking
content or functionality, and forbids developers using "their own mechanisms to unlock
content or functionality, such as license keys, augmented reality markers, **QR codes**,
cryptocurrencies…". Google Play's payments policy similarly ties virtual currency to the
app it was purchased in.

**What would break it.** "Promoter pays → user scans a QR → coins appear in the app →
episode unlocks." That is a QR code functioning as an unlock mechanism, and no amount of
wording changes what it does.

**What this system does instead.** Three separations, each enforced by code rather than by
policy language:

```
  1. The QR is a measurement artifact, not a key.
       A scan resolves to a store listing. It carries no token, no code, no claim.
       On Android an opaque id rides in Play's install-referrer channel — the same
       channel every attribution SDK uses — and it is inert without the publisher's
       server-side API key. On iOS it carries nothing at all.
         → there is no code path by which a scan can unlock in-app content, even
           if a publisher wanted one.

  2. What moves between companies is a marketing fee, not user currency.
       The ledger transfers platform credits promoter → publisher for an acquired
       user. Nothing is credited to an end user, by anyone, anywhere in this system.
         → this is an ad network's cost-per-acquisition, not a currency marketplace.

  3. The joining bonus is the publisher's own, granted by the publisher.
       /v1/attribution/claim answers one question: "is this install attributable?"
       It returns no amount to grant and no instruction to grant anything. The
       publisher applies its own new-user policy, funded by its own free-grant
       allowance — which is exactly what it does for organic users too.
         → `bonus_label` is a description the publisher writes about itself. The
           platform stores it for reporting and never acts on it.
```

**What still has to hold on the publisher's side.** Two things this platform cannot enforce
for them, and which belong in the integration agreement:

- the app must not present a "scan a QR code for coins" flow, or any in-app scanner tied to
  this system — the QR lives on printed and physical media, and is scanned with the phone's
  own camera
- the bonus must be a genuine free grant the publisher chooses to make, not a purchase
  routed around IAP

The e2e suite asserts the first half of this structurally: a scan redirect containing
anything that looks like a spendable token fails the build.

---

## The API Surface

| Surface | Auth | Used by |
|---|---|---|
| `POST /v1/auth/signup`, `/login` | none | Anyone creating or using an account |
| `GET /r/:code` | none | Phones, on scan |
| `GET /v1/qr-codes/:id/image` | none | The QR preview and print downloads (120/min per IP) |
| `GET /healthz` | none | Load balancer — reports 503 if Postgres is unreachable |
| `/v1/*` portal routes | session JWT (12h) | Promoter and publisher dashboards |
| `/v1/attribution/*` | `pk_…` API key | The **publisher's server**, never a browser and never the app |
| `/v1/admin/*` | session JWT + admin role | Super admin console |

Every route sits under a 300/min per-IP ceiling in addition to the specific limits noted
above; `/healthz` is exempt so a flood cannot cost the process its place in the load
balancer.

---

## Role Flows, End to End

Every step below names the exact HTTP call. `Bearer <token>` is the session JWT from
signup/login; `Bearer pk_…` is the publisher's Partner API key.

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

The API calls in steps 4–6 are the integration; [Part II](#part-ii--publisher-integration)
walks through them properly, with client code and a production checklist.

```
1.  Create an account — this also mints a Partner API key, shown once
    POST /v1/auth/signup            { type: "publisher", name, email, password, landing_url }
    → 201 { token, org, api_key }                                      auth: none
    (store api_key now — it is never shown again; POST /v1/api-keys/rotate to reissue)

2.  Review and accept an incoming partnership request
    GET  /v1/partnerships                                              auth: Bearer <token>
    POST /v1/partnerships/:id/accept                                   auth: Bearer <token>

3.  Register where scans should send people
    PATCH /v1/orgs/me   { android_package, ios_app_id, landing_url, bonus_label }
    auth: Bearer <token>

4.  --- a user scans, lands on the store listing, installs, and signs up in the app.
        Nothing from the scan reached the app. The publisher's *server* now asks us
        whether that install was attributable ---

5.  Claim the install
    POST /v1/attribution/claim                                  auth: Bearer pk_<api_key>
    → 200 { attributed: true, attribution_id, fee, ... }  or  { attributed: false, reason }

6.  Later, once the user clears the publisher's own verification bar
    POST /v1/attribution/:id/confirm                            auth: Bearer pk_<api_key>

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
    → 302 to the publisher's store listing:
        Android  play.google.com/store/apps/details?id=…&referrer=…&qrm_claim=…
        iOS      apps.apple.com/app/id…            (no payload — none exists to carry)
        other    the publisher's web fallback
      or, if turned away, to /campaign-ended?reason=<rate_limited|invalid|voided|
      paused|ended|budget|expired|used_up|no_destination>

2.  Install the app and sign up inside it (publisher-owned UI, not this platform's).
    Nothing from the scan is entered, pasted or redeemed — there is nothing to redeem.

3.  The publisher's server asks us whether that install was attributable — see Publisher
    journey step 5. The fee is credited to the publisher; the user never sees this call.

4.  Any joining bonus the user receives is the publisher's own, granted by the publisher
    from its own free-grant allowance, on terms it would apply to any new user.

5.  If the publisher later confirms the user is a verified subscriber, its server calls the
    confirm endpoint (step 6 above) and the held-back part of the fee is released.
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
---

# Part II — Publisher Integration

**Audience:** the backend engineer at a publisher (a content app, a game, a wallet) who wants
promoters to drive real signups and get paid per signup.

**Time to integrate:** ~1 hour on Android, ~30 minutes more for iOS.

## 1. What you are integrating with

This platform tells you **whether a signup traces back to a promoter's QR code** — and if it
does, moves a marketing fee from the promoter's funded budget to your account.

Two things it deliberately does **not** do:

- **It never tells your app to give a user coins.** You decide what a new user gets, under
  your own policy, funded by your own free-grant allowance. `bonus_label` is just a label
  describing *your* bonus, echoed back for your logs. It is never an instruction.
- **It never puts anything spendable on the device.** A scan hands the phone one thing: a
  store listing URL. Attribution happens server-to-server afterwards.

That second point is what makes this safe to ship under App Store 3.1.1 — the reasoning is in
[Figure 8](#figure-8-why-the-qr-unlocks-nothing).

### The money vocabulary

| Term | Means |
|---|---|
| **fee** | Platform credits paid **to you** by the promoter, per attributed signup. Your revenue. |
| **coins / bonus** | Whatever *you* give the end user. This platform never moves these and never sees them. |
| **coin_rate** | The full fee for an identified signup. Agreed per partnership. |
| **guest_rate** | The smaller fee paid up front when the signup is not yet identified. |
| **grace_days** | How long you have to confirm an identification and collect the remainder. |

## 2. One-time setup

### 2.1 Create your publisher account

```bash
curl -X POST https://api.example.com/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "DramaBox",
    "email": "eng@dramabox.example",
    "password": "a-long-random-password",
    "type": "publisher",
    "android_package": "com.dramabox.app",
    "ios_app_id": "123456789",
    "landing_url": "https://dramabox.example/get",
    "bonus_label": "100 free coins"
  }'
```

```jsonc
{
  "token": "eyJhbGci…",              // 12h session JWT, for the dashboard
  "org": { "id": "…", "type": "publisher" },
  "api_key": "pk_9f2c…"              // SHOWN ONCE — store it in your secret manager now
}
```

> **The API key is shown exactly once.** It is stored only as a SHA-256 hash; we cannot
> recover it. Lost it? `POST /v1/api-keys/rotate` with your session token issues a new one and
> invalidates the old one immediately.

### 2.2 What each field controls

| Field | Effect |
|---|---|
| `android_package` | Android scans → `play.google.com/store/apps/details?id=<this>`. Required for the deterministic match path. |
| `ios_app_id` | iOS scans → `apps.apple.com/app/id<this>`. Numeric App Store id only. |
| `landing_url` | Fallback for desktop scans and platforms you have not registered. HTTPS only. |
| `bonus_label` | Free text describing *your own* joining bonus. Appears on promoter QR artwork and in your logs. |

Change any of them later with `PATCH /v1/orgs/me` (session token, not API key).

### 2.3 Accept a partnership

A promoter proposes terms; you accept. Nothing runs until you do.

```bash
# See what's waiting
curl https://api.example.com/v1/partnerships -H "Authorization: Bearer $SESSION_TOKEN"

# Accept — check coin_rate / guest_rate / grace_days first
curl -X POST https://api.example.com/v1/partnerships/$ID/accept \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

## 3. Android — the deterministic path

Play's Install Referrer survives the install, so the claim id rides along in it and the match
is exact. **Always prefer this path when a referrer is available.**

### 3.1 In your app: read the referrer at first open

```kotlin
// build.gradle: implementation "com.android.installreferrer:installreferrer:2.2"
val client = InstallReferrerClient.newBuilder(context).build()
client.startConnection(object : InstallReferrerStateListener {
    override fun onInstallReferrerSetupFinished(responseCode: Int) {
        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
            // Raw string, e.g. "utm_source=qrmarketer&utm_medium=qr&qrm_claim=Xk3nQp7wZs1a"
            val referrer = client.installReferrer.installReferrer
            // Send it to YOUR backend and store it against the device/session.
            // Do NOT call the attribution API from the app — the API key must never ship
            // in a binary, and a client-controlled call is a client-controlled payout.
            myBackend.saveReferrer(referrer)
        }
        client.endConnection()
    }
    override fun onInstallReferrerServiceDisconnected() {}
})
```

Read it **once, at first open, before signup**, and persist it. The referrer is available from
the moment the app is installed and does not depend on the user completing signup.

### 3.2 On your server: claim at signup

```bash
curl -X POST https://api.example.com/v1/attribution/claim \
  -H "Authorization: Bearer $QRM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "publisher_user_ref": "user_84213",
    "install_referrer": "utm_source=qrmarketer&utm_medium=qr&qrm_claim=Xk3nQp7wZs1a",
    "identified": false
  }'
```

Pass the referrer string **raw and whole**. We parse `qrm_claim` out of it ourselves; you do
not need to URL-decode, split, or extract anything.

Window: `REFERRER_WINDOW_DAYS`, default **30 days** from scan. Long on purpose — people scan a
poster, install that evening on wifi, and open it the next day.

## 4. iOS — the fingerprint fallback

There is no install-referrer channel on iOS. Nothing can survive the App Store transition, so
the match is necessarily probabilistic.

```bash
curl -X POST https://api.example.com/v1/attribution/claim \
  -H "Authorization: Bearer $QRM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "publisher_user_ref": "user_84214",
    "ip": "203.0.113.7",
    "platform": "ios",
    "identified": true
  }'
```

**`ip` must be the real client IP your server saw at the app's first open** — not your load
balancer's address, not a server-side egress IP. If you terminate TLS behind a proxy, read it
from `X-Forwarded-For` and pass the client entry. Getting this wrong doesn't error; it just
silently attributes nothing.

IPv4 and IPv6 are both fine, in any spelling — `::ffff:203.0.113.7`, `203.0.113.7`,
`2001:0db8::0001` and `2001:db8::1` are normalised server-side before hashing, so your
representation does not have to match ours. Raw addresses are never stored on either side.

Window: `FINGERPRINT_WINDOW_MIN`, default **60 minutes**. Call `/claim` promptly at signup
rather than batching it overnight.

**Expect a lower match rate on iOS than Android.** That is inherent to the platform, not a bug
in the integration.

## 5. The response

`200` with `attributed: true`:

```jsonc
{
  "attributed": true,
  "attribution_id": "7c1e…",         // keep this — needed for /confirm
  "campaign_id": "b93a…",
  "campaign_name": "Inflight promo",
  "match_method": "referrer",         // or "fingerprint"
  "identified": false,
  "fee": 10,                          // credits paid to you now
  "pending_fee": 40,                  // still claimable via /confirm
  "confirm_deadline": "2026-08-09T…", // null when already identified
  "bonus_label": "100 free coins",    // YOUR label, not an instruction
  "replay": false
}
```

`200` with `attributed: false` — **this is a success, not an error.** Most installs are
organic. Your signup flow must treat it as a normal outcome and carry on.

```jsonc
{ "attributed": false, "reason": "no_match", "bonus_label": "100 free coins" }
```

| `reason` | Means | What to do |
|---|---|---|
| `no_match` | Organic install, or the window expired. The common case. | Nothing. Continue signup. |
| `campaign_not_active` | The campaign was paused or ended after the scan. | Nothing. |
| `budget_exhausted` | The promoter's budget ran out. | Nothing. We fail closed rather than go negative. |
| `already_claimed` | That scan was already matched to a different user. | Nothing. |

**`attributed: false` never means "reject this signup".** The user signed up; that happened
regardless of who gets paid for it.

## 6. The two-tier payout

Split the fee so fraud has less to eat: pay a small amount at signup, the rest once the user
proves real.

```
  signup ──► /claim  { identified: false }  ──►  fee: 10   (guest_rate)
                                                 pending: 40
                       … user verifies phone / completes KYC / makes a purchase …

  verified ─► /attribution/{id}/confirm     ──►  fee_added: 40  → total 50 (coin_rate)
```

If a user is already verified at signup, send `identified: true` on the first call and collect
the full `coin_rate` immediately — no `/confirm` needed.

```bash
curl -X POST https://api.example.com/v1/attribution/$ATTRIBUTION_ID/confirm \
  -H "Authorization: Bearer $QRM_API_KEY"
```

```jsonc
{ "attribution_id": "7c1e…", "fee": 50, "fee_added": 40,
  "identified": true, "status": "confirmed" }
```

`/confirm` is idempotent — a second call returns `status: "already_full"` and moves no money.
After `grace_days` it returns `409 grace_period_expired` and the remainder is released back to
the promoter's budget.

**"Identified" means whatever your own verification bar is.** We do not define it and cannot
check it — you are asserting it. Pick a bar that is expensive to fake (verified phone number,
completed purchase, KYC) and apply it consistently.

## 7. Retries and idempotency

`publisher_user_ref` is the idempotency key. **Calling `/claim` twice for the same user is
safe and expected.**

If the first call succeeded but its response was lost — a timeout, a pod restart, an
at-least-once queue redelivering — just call again with the same `publisher_user_ref`. You get
the original answer back verbatim with `replay: true`, and no second fee is charged.

```jsonc
{ "attributed": true, "attribution_id": "7c1e…", "fee": 50, "replay": true }
```

The guarantee is a database UNIQUE constraint on `(campaign, publisher_user_ref)`, not
application logic, so it holds under concurrency: two simultaneous calls for one user pay
once. You never need to reconcile a double-payout by hand.

Use a **stable, permanent** `publisher_user_ref` — your internal user id. Not an email that
can change, not a session id, not a device id that resets on reinstall.

## 8. Production checklist

**Never call this API from the app.** The key must live server-side only. A key in a binary is
a key an attacker extracts and a payout an attacker controls.

- [ ] **API key in a secret manager**, not in source, not in an env file in the repo.
- [ ] **Rotate on any suspicion** — `POST /v1/api-keys/rotate` invalidates the old key instantly.
- [ ] **Never block signup on this call.** Wrap it in a try/catch and a short timeout (2–3s).
      If it fails, the user still signs up; enqueue the claim and retry. Your conversion funnel
      must not depend on our uptime.
- [ ] **Retry with backoff** on 5xx and timeouts. Retries are safe (§7).
- [ ] **Call at signup, not in a nightly batch.** The iOS fingerprint window is 60 minutes.
- [ ] **Pass the real client IP** on iOS (§4).
- [ ] **Log `attribution_id` and `match_method`** against your user record. `match_method`
      is your fraud signal: `referrer` is deterministic and auditable, `fingerprint` is
      probabilistic and is the population to sample when reconciling with the promoter.
- [ ] **Alert on the attributed rate dropping to zero.** A misconfigured `ip` or a wrong
      `android_package` fails silently as "everything is organic" — no errors, no payouts.
- [ ] **Reconcile daily** against `GET /v1/redemptions` (session token) and your own records.
- [ ] **Rate limit:** 600 requests/min per API key. One call per signup is far below it; a
      batch backfill is not.
- [ ] **Handle 401 as fatal, not retryable** — it means the key is wrong, rotated, or the
      account is suspended. Retrying will not help; alert a human.

### Suggested server-side shape

```js
async function attributeSignup(user, signals) {
  try {
    const res = await fetch(`${QRM}/v1/attribution/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.QRM_API_KEY}`,
                 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publisher_user_ref: user.id,          // stable, permanent
        install_referrer: signals.referrer,   // Android
        ip: signals.clientIp,                 // iOS fallback
        platform: signals.platform,
        identified: user.isVerified,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401) return alertOps('QRM key rejected');
    if (!res.ok) return retryQueue.push({ userId: user.id, signals });
    const body = await res.json();
    if (body.attributed) await db.saveAttribution(user.id, body.attribution_id);
  } catch {
    retryQueue.push({ userId: user.id, signals });   // never block signup
  }
  // Your own new-user bonus is granted here, by your own policy — independent of the above.
}
```

## 9. Testing the integration

The scan endpoint honours the `User-Agent`, so you can drive the whole loop with curl. Ask the
promoter for a test campaign with a small budget, then:

```bash
# 1. Simulate an Android scan; capture the redirect
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' \
  -A 'Mozilla/5.0 (Linux; Android 13; SM-A536E) Mobile Safari/537.36' \
  https://api.example.com/r/$CODE)
echo "$LOC"
# https://play.google.com/store/apps/details?id=com.dramabox.app&referrer=utm_source%3D…

# 2. Pull out the referrer exactly as Play would hand it to your app
REFERRER=$(printf '%s' "$LOC" | sed 's/.*&referrer=//' | python3 -c \
  'import sys,urllib.parse; print(urllib.parse.unquote(sys.stdin.read().strip()))')

# 3. Claim it
curl -s -X POST https://api.example.com/v1/attribution/claim \
  -H "Authorization: Bearer $QRM_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"publisher_user_ref\":\"test_$RANDOM\",\"install_referrer\":\"$REFERRER\"}"
```

Worth asserting in your own test suite:

- A second `/claim` with the same `publisher_user_ref` returns `replay: true` and the same
  `attribution_id`.
- An unknown referrer returns `attributed: false, reason: "no_match"` — and your signup still
  completes.
- A `401` does not break signup.

`e2e-test.sh` in this repo runs the full loop, including both match paths, as a reference.

## 10. Endpoint quick reference

Full request/response schemas: the live Swagger UI at `/docs`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/attribution/claim` | `pk_` API key | Is this signup attributable? |
| `POST` | `/v1/attribution/{id}/confirm` | `pk_` API key | Release the held-back fee |
| `GET` | `/v1/attribution/{id}` | `pk_` API key | Look up one attribution |
| `POST` | `/v1/auth/signup` · `/login` | none | Create account / get session token |
| `POST` | `/v1/api-keys/rotate` | session JWT | New API key, old one dies instantly |
| `GET` · `PATCH` | `/v1/orgs/me` | session JWT | App package, store id, landing URL, bonus label |
| `GET` | `/v1/partnerships` | session JWT | Proposed and active partnerships |
| `POST` | `/v1/partnerships/{id}/accept` | session JWT | Accept the terms |
| `GET` | `/v1/redemptions` | session JWT | Your last 100 attributions, for reconciliation |

**Two credentials, never mixed:**

- `pk_…` **API key** — server-to-server only, for `/v1/attribution/*`. Never in a browser,
  never in an app binary.
- **Session JWT** (12h) — the dashboard and settings routes. Never for the Partner API.

---
---

# Part III — Security Model

What this system defends against, how, and — just as important — what it does **not** defend
against. Every control below is enforced in code and asserted in `e2e-test.sh` or
`backend/test/`.

> **A note on "no attack is possible".** No system reaches that, and claiming it is how real
> gaps get missed. What follows is a specific threat model with specific mitigations, plus an
> honest list of residual risks in [§9](#9-residual-risks--read-this-part). Read §9 first if
> you are deciding whether to launch.

## 1. Trust boundaries

```
  ┌─ END USER'S PHONE ────────── fully untrusted ─────────────────────┐
  │  Scans a QR. Receives a store URL and nothing else. Cannot        │
  │  authenticate, cannot spend, cannot address any API but /r/:code. │
  └───────────────────────────────────────────────────────────────────┘
  ┌─ PUBLISHER'S SERVER ─────── authenticated, semi-trusted ──────────┐
  │  Holds a pk_ API key. Asserts "this user signed up" and "this     │
  │  user is identified". We cannot verify either — see §9.1.         │
  └───────────────────────────────────────────────────────────────────┘
  ┌─ PROMOTER / PUBLISHER PORTAL ── authenticated, tenant-scoped ─────┐
  │  Session JWT. Every query is filtered by org id — no route takes  │
  │  a tenant id from the client and trusts it.                       │
  └───────────────────────────────────────────────────────────────────┘
  ┌─ SUPER ADMIN ─────────────── trusted, fully audited ──────────────┐
  │  Cross-tenant reads and overrides. Every override writes an       │
  │  audit_log row naming actor, target and reason.                   │
  └───────────────────────────────────────────────────────────────────┘
```

The single most important property: **the untrusted boundary is never on the money path.**
The phone receives no token, so there is no credential for a user to steal, replay, forge or
share. Attribution is asserted server-to-server afterwards by an authenticated party.

## 2. Authentication

| Credential | Form | Lifetime | Storage |
|---|---|---|---|
| Session | JWT, HS256 | 12h | Not stored; verified by signature |
| Partner API key | `pk_` + 192 bits random | Until rotated | **SHA-256 hash only** |
| Claim id | 128 bits base64url | One use | Opaque row key, not a credential |

- **Keys are never recoverable.** Only the SHA-256 hash is stored. Rotation
  (`POST /v1/api-keys/rotate`) invalidates the previous key on the next request.
- **Revocation is immediate, not on token expiry.** `AuthGuard` re-reads the org on every
  request, so suspending a tenant kills live sessions instantly rather than up to 12h later.
  It also re-reads `type`, so a demotion takes effect at once.
- **The Partner API checks `suspended` too.** An offboarded publisher's key stops earning
  fees on the next call, not whenever someone remembers to rotate it.
- **Default secrets refuse to boot.** `JWT_SECRET` left at its dev value in production is a
  total auth bypass, so the process exits at startup instead of serving with it.

### Brute force and enumeration

- Login: 20/min per IP **and** 10/min per account — the first stops credential stuffing across
  many accounts, the second stops a distributed attack on one account.
- Signup: 10/min per IP. Partner API: 600/min per key. Scan: 30/min per IP.
- Global floor: 300/min per IP under **every** route, so a route added later is never
  accidentally unlimited. `/healthz` is exempt so a flood cannot get the process pulled from
  the load balancer.
- **User enumeration is closed:** login runs bcrypt against a dummy hash when the account does
  not exist, so a registered and an unregistered address take the same time to reject.
- Passwords are capped at 72 bytes because bcrypt silently ignores everything past that — an
  uncapped 200-character passphrase would be only its first 72 bytes, and any other string
  sharing that prefix would authenticate.

## 3. The money path

Enforced by the **database**, not by application logic, so the invariants hold under
concurrency and cannot be bypassed by a bug in a handler.

| Invariant | Enforced by |
|---|---|
| One payout per user per campaign | `UNIQUE (campaign_id, publisher_user_ref)` |
| One payout per scan | `UNIQUE (scan_id)` + `consumed` flag under a row lock |
| Ledger always balances to zero | Append-only double entry; asserted in the suite |
| Budget can never go negative | `SELECT … FOR UPDATE` on the balance row before every debit |
| `guest_rate <= coin_rate` | `CHECK` constraint in the migration |

The behavioural consequences are spelled out in
[Figure 5](#figure-5-what-makes-the-money-safe).

## 4. Tenant isolation

Every portal and partner query is scoped by the caller's org id **inside the WHERE clause**,
never by a filter applied after fetching:

```ts
// ownership is part of the query, so a wrong id is a 404, not someone else's data
await prisma.qrCode.updateMany({
  where: { id, campaign: { partnership: { promoter_org_id: orgId } } }, data,
});
```

Reads are open to both sides of a partnership; writes are promoter-only where the promoter
pays. Looking up another publisher's attribution returns `404`, not `403` — an existence
oracle is itself a leak.

## 5. Injection and rendering

- **SQL injection: not reachable.** Every raw query uses tagged-template parameters
  (`$queryRaw\`… ${value} …\``). There is no `queryRawUnsafe` anywhere in `src/`.
- **Stored XSS via QR styling: closed.** `validateStyle` rebuilds an allowlisted object rather
  than passing input through — unknown keys are dropped, colors must match a hex pattern,
  enums must match a fixed list, `frameText` is capped at 40 chars and XML-escaped into the
  SVG. Logos must be `data:image/...` URLs; `javascript:` is rejected.
- **SVG execution: blocked at the response.** The QR endpoint serves attacker-influenced SVG
  from our own origin, so it carries `Content-Security-Policy: default-src 'none'` plus
  `X-Content-Type-Options: nosniff`.
- **Open redirect: closed.** `landing_url` is validated to https (http only for localhost),
  rejecting `javascript:` and `data:` schemes and embedded credentials. `android_package` is
  anchored to a reverse-DNS pattern so it cannot smuggle a query string into a Play URL.
- **NUL bytes are rejected**, not passed to Postgres, which cannot store them in a text column
  and aborts the transaction mid-flight if one arrives.

### Response headers (all routes)

`Content-Security-Policy: default-src 'none'` · `X-Content-Type-Options: nosniff` ·
`X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` ·
`Cross-Origin-Resource-Policy: same-site` · `Strict-Transport-Security` (production) ·
`X-Powered-By` removed.

`no-referrer` matters specifically: it keeps scan URLs out of onward `Referer` headers, so a
store listing never learns which printed code sent the visitor.

## 6. Input bounds

Every untrusted string has a ceiling, and oversized input is **rejected, never truncated** — a
silently shortened `publisher_user_ref` would collide with a different user's and hand one
user's attribution to another.

| Field | Limit |
|---|---|
| `publisher_user_ref` | 200 |
| `install_referrer` | 1000 |
| `ip` | 45 (longest IPv6 text form) |
| `user_agent` | 500 |
| `name`, campaign `name` | 120 |
| `email` | 254 + shape check |
| `password` | 8–72 bytes |
| `bonus_label` | 120 |
| Request body | 1 MB |

CORS is an allowlist from `FRONTEND_URL`, not `*`. Bearer tokens are used rather than cookies,
so there is no CSRF surface.

## 7. Privacy

- **Raw IP addresses are never stored.** Both the scan and the claim sides hash through one
  shared `ipHash()` — truncated SHA-256, normalised first so the same device hashes
  identically from either side.
- User agents are truncated to 300 characters and used only for coarse platform detection.
- This platform never receives an end user's identity. `publisher_user_ref` is the publisher's
  own opaque id; we neither need nor want the person behind it.

## 8. Operations

- **Config that cannot be wrong silently.** Production refuses to boot on a default
  `JWT_SECRET`, a missing `BASE_URL`/`FRONTEND_URL`, non-https URLs, or an admin password
  under 12 characters. `BASE_URL` is printed into physical QR codes — wrong means a reprint.
- **`TRUST_PROXY=true` is refused.** It would trust `X-Forwarded-For` from any client, letting
  one attacker present as unlimited distinct IPs and defeating every per-IP control here,
  including the fingerprint match. Use the hop count (`1`) or the proxy subnet.
- **Graceful shutdown.** `SIGTERM` drains in-flight requests before exit, so a redeploy cannot
  tear down a half-written attribution.
- Schema changes go through `prisma migrate deploy` before the process serves traffic; the app
  never creates tables at boot.

## 9. Residual risks — read this part

These are **not** mitigated. They are accepted, and each has a stated reason and a lever.
Deliberate simplifications are also flagged in the code as `ponytail:` comments so nobody
mistakes them for bugs.

### 9.1 A publisher can over-report signups
The publisher asserts both "this user signed up" and "`identified: true`". Neither is
verifiable from here — we cannot see inside their app. A dishonest publisher can inflate
attributions up to the number of real scans on their campaigns.

*Levers:* the two-tier payout limits exposure until identification; `match_method` separates
deterministic (`referrer`) from probabilistic (`fingerprint`) attributions so the latter can be
sampled; campaign budgets cap total loss; every attribution is reconcilable against
`GET /v1/redemptions`. **Commercially, publishers are counterparties under contract, not
anonymous users** — this is a contractual control with technical support, not the reverse.

### 9.2 iOS fingerprint false matches
Matching on hashed IP + platform will occasionally attribute one household's install to a
neighbour's scan under carrier-grade NAT. This is inherent to iOS having no referrer channel.

*Levers:* `FINGERPRINT_WINDOW_MIN` (default 60) is the main dial. Adding
SKAdNetwork/AdAttributionKit as a third signal is the real upgrade if measured false-match
rate starts costing money.

### 9.3 The rate limiter is per-process
In-process fixed windows. Running N instances multiplies every limit by N, and a restart
clears all buckets.

*Lever:* swap for a shared Redis sliding window before scaling past one instance. Marked at
`backend/src/common/security.ts`.

### 9.4 No 2FA, no password rotation policy, no session revocation list
Single-factor login for portal accounts. A stolen password is a full account takeover until
the password changes (though an admin can suspend instantly, which cuts live sessions).

*Lever:* TOTP on the org login is the next control worth adding, ahead of anything else here.

### 9.5 No WAF, no bot detection on the scan path
`/r/:code` is public by necessity. Automated scanning burns QR uses and pollutes scan counts,
throttled only by the per-IP limit.

*Lever:* `max_uses` and `expires_in_days` bound the damage per code; a CDN or WAF in front is
the infrastructure answer.

### 9.6 HS256 shared secret
A leaked `JWT_SECRET` forges any session. Marked at `backend/src/modules/auth/tokens.ts`.

*Lever:* ES256 with a KMS-held private key.

### 9.7 Not built yet, on purpose
- **Real payment processing** — funding a campaign credits the ledger directly; production
  would put a PSP checkout in front of it
- **One login per company** — no teams, roles or invitations yet (login *is* the org)
- **Automated fraud alerts** to a team's Slack or email

None of it touches the core promise: **fees can't be duplicated, lost, or paid out twice —
and nothing this platform issues can unlock anything inside an app.**

## 10. Reporting a vulnerability

Report privately to the address on the deployment's security page. Please do not open a public
issue for anything touching the money path in §3.

---

## The One-Minute Pitch

> A brand pays into a campaign. A QR code goes out into the world. Every scan either opens
> the publisher's store listing or gets safely turned away with a reason. The install is
> matched back server-to-server — never by anything the phone carried — and the money only
> ever moves once, in the right direction, with a double-entry trail behind it.
