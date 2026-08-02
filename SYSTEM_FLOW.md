# QR Reward Platform — How It Works

A guide to the whole system, in plain language, with the exact rules the code enforces.

---

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

## Figure 5: What Makes It Safe

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

3.  Register where scans should send people
    PATCH /v1/orgs/me   { android_package, ios_app_id, landing_url, bonus_label }
    auth: Bearer <token>
    (landing_url is the web fallback for desktop scans; bonus_label describes the
     publisher's OWN joining bonus and is a label for reporting, never an instruction)

4.  --- a user scans, lands on the store listing, installs, and signs up in the app.
        Nothing from the scan reached the app. The publisher's *server* now asks us
        whether that install was attributable ---

5.  Claim the install
    POST /v1/attribution/claim
      Android: { install_referrer, publisher_user_ref, identified }
               (install_referrer is the raw string from Play's Install Referrer API)
      iOS:     { ip, user_agent, publisher_user_ref, identified }
               (the first-open request's own signals — iOS has no referrer channel)
    → 200 { attributed: true, attribution_id, campaign_name, match_method, fee,
            pending_fee, confirm_deadline, bonus_label, replay }
      or  { attributed: false, reason }   ← organic install; nothing charged, not an error
    auth: Bearer pk_<api_key>                                          (server-to-server only)

    The publisher grants its own joining bonus here, under its own policy. This response
    does not tell it to, and does not say how much.

6.  Later, once the user clears the publisher's own verification bar
    POST /v1/attribution/:id/confirm
    → 200 { fee, fee_added, status: "confirmed" }                      auth: Bearer pk_<api_key>

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

## What's Not Built Yet (On Purpose)

A working system, not a finished product. These are simplified deliberately and flagged in
the code as `ponytail:` comments so nobody mistakes them for bugs:

- **Real payment processing** — funding a campaign credits the ledger directly; production
  would put a PSP checkout in front of it
- **One login per company** — no teams, roles or invitations yet (login *is* the org)
- **In-process rate limiting** — correct on one instance; needs Redis behind more than one
- **HS256 shared secret** for tokens — fine here, ES256 + KMS for production
- **Automated fraud alerts** to a team's Slack or email
- **SKAdNetwork / AdAttributionKit** as a third iOS signal — today the iOS path is a
  two-signal fingerprint (hashed IP + platform) inside a short window

None of it touches the core promise: **fees can't be duplicated, lost, or paid out twice —
and nothing this platform issues can unlock anything inside an app.**

---

## The One-Minute Pitch

> A brand pays into a campaign. A QR code goes out into the world. Every scan either opens
> the publisher's store listing or gets safely turned away with a reason. The install is
> matched back server-to-server — never by anything the phone carried — and the money only
> ever moves once, in the right direction, with a double-entry trail behind it.
