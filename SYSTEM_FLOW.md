# QR Reward Platform — How It Works

The whole system in one document: how it works, how a publisher integrates against it, and
what it does and does not defend against.

- **[Part I — How It Works](#part-i--how-it-works)** — the model, the flows, the money
- **[Part II — Publisher Integration](#part-ii--publisher-integration)** — wiring your backend to the Partner API
- **[Part III — Security Model](#part-iii--security-model)** — threat model, controls, and the accepted risks
- **[Scope of Engagement Mode](#scope-of-engagement-mode)** — what repeat-purchase rewards do and do not cover

There are **two products** here and they share one machine: paying for a new user
(*acquisition*) and paying for a repeat purchase (*engagement*). If you only know the first,
read [Two Products, One Machine](#two-products-one-machine) before anything else — every figure
below now describes both.

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

## Two Products, One Machine

There are two things a promoter can buy here, and every table, index and endpoint below is
shared between them. A campaign's `mode` picks one at creation and it never changes.

| | `acquisition` | `engagement` |
|---|---|---|
| **Pays for** | a person who was not a user before | a repeat purchase by anyone |
| **Guarantee** | one payout per user per campaign, **ever** | one payout per **issued code** |
| **Priced at** | `coin_rate` / `guest_rate` (two tiers) | `engagement_rate` (one tier) |
| **Codes** | designed in the portal, printed, many scans | minted per transaction by the promoter's server, single-use |
| **Match** | referrer (Android) or fingerprint (iOS) | the code itself — no matching to do |
| **Stages** | scan → install → signup → reward | scan → reward |
| **Example** | a poster in an airport terminal | NovoAir printing a code on every boarding pass |

Acquisition is the original product and is unchanged. Engagement exists because
`UNIQUE (campaign_id, publisher_user_ref)` — exactly right for buying a new user — is exactly
wrong for an airline: a traveller who flies eleven times a year is eleven purchases, and a
shop's regular is a purchase a week. Both modes are described in full below;
[Figure 2b](#figure-2b-the-engagement-lifecycle) is the second lifecycle.

**They are not alternatives on a single scan.** A traveller with no app yet scans a boarding
pass, installs, signs up, *and* has bought a ticket. That one scan is honestly an acquisition
and honestly a purchase, and both are paid — see
[Figure 2c](#figure-2c-one-scan-two-payouts).

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

**Step 1 sets four numbers**, and they are the whole commercial deal:

| Setting | Default | Meaning |
|---|---|---|
| `coin_rate` | 50 | Fee for a **verified** signup (the full price) |
| `guest_rate` | 10 | Fee paid immediately for an **unverified guest** |
| `grace_days` | 7 | How long the guest has to verify and release the difference |
| `engagement_rate` | 20 | Fee for one **repeat purchase**, in an engagement campaign |

`guest_rate` can never exceed `coin_rate` — the database enforces it. `engagement_rate` is
deliberately **not** bounded against either. The guest rate is a *part* of the coin rate, which
is why the held-back delta can never be negative; a repeat purchase is not part of an
acquisition, it is a different thing being bought, and a partnership may honestly price it
above a signup or at a tenth of one.

All four are proposed and accepted as one set — see [repricing](#promoter-journey).

These are **marketing fees in platform credits**, paid promoter → publisher. They are not
user currency, they never enter an app, and nothing in this system grants a user anything.

---

## Figure 2b: The Engagement Lifecycle

The second product. Steps 1–4 are the same partnership and the same funded campaign; what
changes is where codes come from and what happens at the end.

```
 STEP 1–5   Partnership, then a campaign created with mode: "engagement",
            then funded. Identical to Figure 2.
                │
                ▼
 STEP 6   ── ONE CODE PER TRANSACTION ─────────────────────────────────
            NovoAir sells a seat. Its booking system calls
              POST /v1/issue { campaign_id, issued_ref: "PNR-7X42QK" }
              → 201 { code, scan_url }        single-use, 30-day expiry
            The code is printed on the boarding pass / emailed with the receipt.

            Idempotent on issued_ref: a booking webhook that fires twice
            gets the same code back, never a second reward for one seat.
                │
                ▼
 STEP 7   ── THE SCAN ──────────────────────────────────────────────────
            The traveller scans it. Same gauntlet as every other scan
            (rate limit, voided, active, budget, atomic single-use claim).
            The destination is the only thing that differs:

              302 → https://publisher.example/open
                       ?qrm_code=<code>
                       &qrm_fallback=<store url we built>
                │
                ├─ app installed ──► the OS intercepts the App Link /
                │                    Universal Link. The app opens with
                │                    qrm_code. We never see the request.
                │
                └─ not installed ──► the publisher's page loads and follows
                                     qrm_fallback to the store. See Figure 2c.
                │
                ▼
 STEP 8   ── THE PAYOUT ────────────────────────────────────────────────
            The app hands qrm_code to its OWN backend, which calls
              POST /v1/attribution/claim { code, publisher_user_ref }
              → 200 { attributed: true, kind: "engagement", fee: 20 }

            No install stage. No fingerprint. No window to guess inside.
            The code was minted against one named transaction and scanned
            once, so match_method is `code` and confidence is 100.
```

**Why there is no matching step.** Everything in the acquisition flow exists because a phone
walks off to a store and has to be recognised when it comes back. A boarding-pass code skips
all of it: the promoter's booking system minted it against a named purchase, the traveller
scanned that exact code, and the publisher presents that exact code back. `code` is stronger
evidence than a referrer, because it names a *purchase* rather than a device.

**Why there is no guest tier.** `identified` splits an acquisition fee because a brand-new
account is worth less until somebody vouches for it. A repeat customer already transacted with
the promoter, which is a harder fact than any verification bar the publisher could apply. An
engagement payout settles in one step, and `/confirm` has nothing to release.

**Why there is no "is the app installed" check** anywhere in this codebase: both mobile
platforms already answer that question, correctly, offline, before the request leaves the
handset. No server can. `deeplink_url` is how the publisher hands that decision to the OS.

---

## Figure 2c: One Scan, Two Payouts

The case that shapes three database indexes, and the reason engagement is not simply "a second
kind of campaign".

```
   A traveller with NO APP YET scans their boarding pass.

         one scan
             │
    ┌────────┴─────────┐
    │                  │
    ▼                  ▼
 they are a         they just bought
 NEW USER           A TICKET
    │                  │
    │  install,        │  the app reads qrm_code from the
    │  first-open,     │  same Play install referrer
    │  signup          │
    ▼                  ▼
 acquisition       engagement
 pays coin_rate    pays engagement_rate
 (or guest tier)
```

Both are owed. The traveller genuinely is a new user *and* genuinely bought something, and the
promoter agreed to pay for both. On Android the Play install referrer carries `qrm_claim` and
`qrm_code` together, which is what lets one scan survive an install carrying both facts.

Making that work required the guards to stop sharing a flag:

| Fact | Guard | Scope |
|---|---|---|
| one install per scan | `scans.consumed` | acquisition only |
| one signup per scan | `UNIQUE (scan_id)` | **`WHERE kind = 'acquisition'`** |
| one signup per user per campaign | `UNIQUE (campaign_id, publisher_user_ref)` | **`WHERE kind = 'acquisition'`** |
| one reward per issued code | `UNIQUE (qr_code_id)` | **`WHERE kind = 'engagement'`** |

Before this, a total `UNIQUE (scan_id)` meant whichever call arrived second was refused — and
which one that was depended on the publisher's call ordering, which is not a rule anyone can
reason about. Partial indexes make the two facts independent, which is what they always were.

**On iOS the fall-through is weaker**, and honestly so: the App Store has no referrer channel,
so `qrm_code` cannot survive an install. `qrm_fallback` points at `/i/:claim_id` — the same
interstitial an acquisition scan gets — so the *acquisition* half still works. The purchase
reward is lost unless the publisher's own web page stashes the code before sending them on.
That is inherent to iOS, not a bug in the integration.

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
       ──► resolve destination from the UA and the campaign mode:
             acquisition → android: Play, ios: App Store,
                           else:    publisher web fallback
             engagement  → the publisher's app link, carrying
                           qrm_code + qrm_fallback (see Figure 2b)
                                                    ──► no_destination
       ──► claim one use, atomically:
             not expired AND uses < max_uses  ──► expired / used_up
       ──► record the pending claim
             (claim_id, platform, hashed IP, truncated UA)
       ──► iOS with a registered App Store id?
             yes → 200, the hand-off screen (collects tz/screen/locale/cores/
                   appearance, then forwards via GET /go/:claim_id)
             no  → 302 straight to the destination
```

Every check above the destination line is identical in both modes, deliberately: budget,
status, expiry, single-use and the per-IP ceiling are money and abuse controls, and an
engagement campaign is not a reason to relax any of them. **`mode` changes where a scan is
sent and nothing else about this path.**

An engagement scan with a deep link registered also skips the iOS interstitial, for a third
reason on top of the two below: the code already names the transaction deterministically, so
there is no fingerprint to collect and the ~900ms hold would be pure conversion cost. A
traveller who turns out *not* to have the app reaches the same page anyway, via
`qrm_fallback` → `GET /i/:claim_id`, so the signals are still collected in the one case that
needs them.

**Why iOS gets an extra hop.** Android's referrer names the exact scan, so an interstitial
there would cost conversion and buy nothing — it is skipped. iOS has no referrer channel at
all, and the browser is the *only* place this device's timezone, screen geometry, locale,
core count and appearance can ever be read. Skip the hop and the match is left with hashed IP + platform, which now
scores 55 against a floor of 70 and is refused. The hop is what makes iOS attribution work.

The page holds for ~900ms, forwards itself with `location.replace`, and degrades in two
stages: a `<meta refresh>` at 4s if script is blocked, and a real anchor if both fail. It
runs the only inline script in this API, under its own nonce CSP.

`GET /go/:claim_id` writes the signals onto the still-unconsumed scan and redirects to the
store. It refuses to overwrite them once an install has been bound, so a replayed link
cannot rewrite the evidence a payment decision was made on.

Two details carry the whole compliance argument:

**The destination is resolved before a use is burned.** A publisher who has registered no
app and no web fallback would otherwise eat a print run's uses redirecting nobody.

**The redirect carries nothing spendable.** On Android an opaque `qrm_claim` id rides
inside Play's `referrer` parameter — an install-attribution channel, not app content. On
iOS there is no such channel, so the URL is the bare store listing and the match happens on
device fingerprint instead. Either way the app receives no code it could redeem.

On an **engagement** scan the app does receive `qrm_code`. That is a real difference and it is
argued honestly in [Figure 8](#figure-8-why-the-qr-unlocks-nothing) rather than glossed here:
the code is an opaque transaction reference, single-use, short-lived, and inert without the
publisher's server-side API key — the same trust model as Play's install referrer — but it is
not nothing, and it is the one place this system's compliance story needs reading twice.

The interstitial does not weaken this. It lives on our origin, never reaches the app, and
deliberately prints no reference number — it shows a timestamp instead, so there is nothing
on screen a user could mistake for a code to type in. Its own copy says so: *"No code to
enter. Nothing to copy."*

Each turn-away reason renders its own message on `/campaign-ended` — a dead end looks like
a broken sticker, so the user always learns which of these happened.

Claiming the use is a single conditional `UPDATE`, so two simultaneous scans can never both
take the last use of a code.

---

## Figure 3b: Tying the Install Back to the Scan

The phone left our control at the store listing. Getting it back is the part every mobile
measurement partner solves the same two ways, and so do we — deterministic first.

The lifecycle has **four stages, and each is its own row**. That separation is the point:

```
  Scan  ──►  Install  ──►  Signup  ──►  Reward
 (scans)   (installs)  (redemptions)  (ledger_entries)
```

### Why matching moved to first open

Matching used to happen at signup, in the same call that paid the fee. For Android that was
harmless — the referrer names the exact scan whenever it arrives. For iOS it was fatal.

A scan and a first open are minutes apart: same network, same timezone, same handset. A scan
and a *signup* are routinely a day apart, because install, onboarding and registration all sit
between them. One window cannot cover both. Set short enough to be honest it matched almost
nothing; set wide enough to catch real installs it would have been matching strangers behind
the same NAT.

So the publisher's server now calls **`first-open`** at launch, which binds the claim and
returns an `install_id`, and calls **`claim`** whenever the signup actually happens. The
short fingerprint window applies to the first leg only; the second leg has its own,
generous window (`SIGNUP_WINDOW_DAYS`, default 30). No money moves until signup.

```
  ANDROID  (deterministic, scan → first open within 30 days)

    scan ──► Play listing ?referrer=…&qrm_claim=Ab3x…
                  │
             user installs; Play preserves the referrer
                  │
             app reads it via the Install Referrer API
                  │
             app's OWN BACKEND ──► POST /v1/attribution/first-open
                                    { install_referrer, … }
                  │
             exact match on claim_id ──► install bound, confidence 100


  iOS  (probabilistic, scan → first open within 60 minutes)

    scan ──► INTERSTITIAL on our origin        ← this is the new hop
                  │
             browser reports timezone, screen, locale, cores, appearance
             (the App Store has no referrer channel; this is the only
              moment these can be read at all)
                  │
                  ▼
             App Store listing                 (still carries no payload)
                  │
             user installs and opens; the SDK re-presents the same
             signals from the native side
                  │
             app's OWN BACKEND ──► POST /v1/attribution/first-open
                              { ip, platform, tz, screen, language, cores, dark }
                  │
             candidates scored ──► best one, if it clears the floor


  BOTH, later — whenever the user actually registers

             app's OWN BACKEND ──► POST /v1/attribution/claim
                                    { install_id, publisher_user_ref }
                  │
             fee posted to the ledger ──► attributed
```

### The confidence score

An IP is not an identity. Carrier-grade NAT, café wifi, an airport and a corporate VPN all put
thousands of unrelated handsets behind one address, so "same address, both on iOS" describes a
postcode. Hashed IP + platform is therefore the **filter** that produces candidates, not the
evidence that picks one. Each candidate is scored:

| Signal | Weight | Why |
|---|---|---|
| hashed IP + platform | 55 (base) | narrows the field; never sufficient alone |
| screen geometry | +22 | the only signal with real entropy — splits a country by handset model |
| timezone | +8 | a whole country shares one |
| locale | +7 | a whole country shares one |
| CPU cores | +5 | splits handsets by generation where the screen only splits by body size |
| dark appearance | +3 | one bit, but often the only one that separates two candidates on a NAT |

The weights sum to exactly 100 with the base, which is what makes a confidence readable as a
percentage. Adding a signal therefore costs the existing ones a few points each — deliberately,
because the alternative is a scale that no longer tops out at 100.

`MIN_CONFIDENCE` (default **70**) is the accept line, so a bare IP + platform match scores 55
and is **refused**. The score is stored on the install and copied onto the redemption, so a
fraud review months later sees what the decision was actually made on rather than a bare
`referrer`/`fingerprint` label.

Two refusals are deliberate answers rather than errors:

- **`low_confidence`** — the network said "maybe" and no signal from the handset agreed.
- **`ambiguous`** — two scans fit the evidence equally well. Newest-first would break the tie,
  and that is exactly the temptation being refused: picking one invents a fact and pays one
  publisher for another's scan.

Screen geometry is comparable across the browser/native boundary because both report the same
numbers — CSS pixels in Safari, points in `UIScreen.bounds` — normalised to
`{short}x{long}@{dpr}` so a phone held sideways at scan time still matches itself upright at
first open. Anything finer (user-agent string, browser version, fonts, canvas) does *not*
survive that crossing, and would drag real matches below the accept line rather than help.

An unmatched install is a **normal answer, not an error** — most installs are organic. Both
calls return `200 { attributed: false, reason }`, so a publisher's signup path never breaks
over our accounting.

Both lookups take the scan row with `FOR UPDATE … SKIP LOCKED`, so two concurrent claims
can never both proceed against it; the loser comes back unattributed, which is correct.

### Fraud checks at first open

| Check | Behaviour |
|---|---|
| claim already consumed | refused (`already_claimed`) — one install per scan, DB-enforced |
| one install, two signups | refused (`already_claimed`) — atomic test-and-set on `redeemed` |
| same handset, same campaign | refused (`duplicate_device`), fingerprint path only, `DEVICE_DEDUPE_DAYS` |
| emulator (SDK-asserted) | refused (`device_integrity`) before any lookup runs |
| rooted / jailbroken | **recorded, not refused** — large honest population |
| VPN | **recorded, not refused** — it breaks the IP match anyway, so this explains a `no_match` |
| two publishers, one install | impossible — every query is scoped to the calling publisher |
| campaign ended or paused | refused at both stages, so ending a campaign stops spend immediately |
| budget exhausted | refused at first open too, so a scan is not burned against a budget that cannot pay |
| expiry | `installs.expires_at`; scans age out of both match windows |

The repeat-device check runs **only on the fingerprint path**. A referrer match already names
one specific scan, so two family members scanning the same poster on the same wifi are two
legitimate claim ids that must not be collapsed into one "device".

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
      — the scan redirect carries no token or key. On an acquisition scan the only
        identifier that leaves our origin is an opaque claim id inside Play's
        install-referrer channel; on an engagement scan an opaque transaction code
        travels alongside it. Neither is spendable: both are lookup keys that do nothing
        without the publisher's server-side API key. See Figure 8.

  ✔  One fee per user per campaign  (ACQUISITION)
      — UNIQUE (campaign_id, publisher_user_ref) WHERE kind = 'acquisition', so it holds
        under a race, not just under a check

  ✔  One reward per issued code  (ENGAGEMENT)
      — UNIQUE (qr_code_id) WHERE kind = 'engagement'. This is what makes "one payout per
        purchase" true: the promoter's own booking system mints one code per transaction,
        so the code IS the purchase. Two simultaneous claims for one boarding pass pay once.

  ✔  One code per transaction
      — UNIQUE (campaign_id, issued_ref) on qr_codes, so a booking webhook that fires
        twice returns the first code instead of minting a second reward for one seat

  ✔  A shared code pays its first claimant only
      — a retry by the same publisher_user_ref replays; a DIFFERENT user presenting the
        same code is refused already_claimed rather than handed the first user's reward

  ✔  One install per scan
      — the scan row is taken FOR UPDATE SKIP LOCKED and marked consumed inside the
        binding transaction, and installs.scan_id is UNIQUE, so a replayed claim id
        attributes nothing a second time

  ✔  One signup per install
      — installs.redeemed is flipped by the same UPDATE that tests it, so two simultaneous
        signups for one install cannot both proceed; the loser is told already_claimed

  ✔  The two payouts on one scan cannot race each other
      — UNIQUE (scan_id) is scoped WHERE kind = 'acquisition', and scans.consumed guards
        only the install. A boarding pass scanned by somebody with no app yet is honestly
        both an acquisition and a purchase; before this, whichever call arrived second was
        refused, and which one that was depended on the publisher's call ordering

  ✔  A campaign's mode cannot change after it has paid anything
      — there is no endpoint to change it. The guarantees above are partial indexes over
        rows that already exist, and flipping the mode would leave a run of redemptions
        living under a rule they were never checked against

  ✔  A probabilistic match is never a guess
      — hashed IP + platform scores 55 against a floor of 70, and an exact tie between two
        candidates is refused rather than resolved by recency

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
        the web fallback and the engagement deep link are https-only (http for localhost
        alone), no javascript:/data:, no embedded credentials

  ✔  Only the promoter that owns a campaign can mint codes against it
      — ownership and mode are both inside the WHERE clause on /v1/issue, so somebody
        else's campaign is a 404 rather than a permission error, and an acquisition
        campaign refuses transaction codes outright

  ✔  Every admin override is written to the audit log
      — who, what, why, when
```

---

## Figure 6: The Money Flow

Five kinds of ledger account. A funding or payout touches two of them; a payout that earns
the platform its cut touches three, and still sums to zero.

```
        external:funding                 (the outside world, money coming IN)
               │
               │  fund:{payment_id}       -1000 / +1000
               │  ...written by the PSP webhook, never by the promoter directly
               ▼
        campaign:{id}                     "CAMPAIGN BUDGET" (e.g. 5,000 credits)
               │
               │  redemption:{id}   -50  →  +45 publisher  +5 platform   (acquisition)
               │  upgrade:{id}      -40  →  +36 publisher  +4 platform   (guest top-up)
               │  redemption:{id}   -20  →  +18 publisher  +2 platform   (engagement)
               │
               ├──────────────────────────┐
               ▼                          ▼
        publisher:{org_id}          platform:fees
        "PUBLISHER EARNINGS"        "THE PLATFORM'S REVENUE"
               │                     (platform_fee_bps of every gross payout,
               │                      snapshotted per partnership at 1000 = 10%)
               │  withdrawal:{id}    -40 / +40
               ▼
        external:payouts                 (the outside world, money going OUT)

  Balances live in account_balances and are updated in the same transaction as the
  ledger rows — the ledger is the truth, the balance is the fast read.

  Both products spend from the same account under the same lock, so an engagement
  campaign can no more overspend than an acquisition one. The ledger ref shape is
  identical too -- a repeat purchase is a redemption like any other; only `kind` and
  the rate it was priced at differ.

  When the budget hits zero the QR stops redirecting and sends people to
  /campaign-ended?reason=budget instead.
```

**The take rate is the business model, and it lives in the ledger rather than in a report.**
Every payout routes through one `payout()` helper that writes all three rows under a single
ref, so a fee cannot be split on one path and forgotten on another. Rounding floors the
platform's cut, which means the odd credit always goes to the publisher — the party doing the
work — and `net + cut` reconstitutes the gross exactly, for every input. That last property is
what keeps each ref summing to zero; it is asserted exhaustively in `backend/test/money.test.ts`
and end-to-end in `e2e-test.sh` §11b.

`platform_fee_bps` is **snapshotted onto the partnership when it is created**, never read live
at payout time. Changing `PLATFORM_FEE_BPS` therefore reprices only future partnerships; an
existing deal is repriced explicitly by an admin, and that is audited. A commercial term both
counterparties are living under must not move because a config value did.

### Money in

`POST /v1/campaigns/:id/fund` credits a budget with no payment behind it and stays off in
production (`ALLOW_SELF_FUNDING`). The real path is two steps: `POST /v1/payments/checkout`
records what the promoter intends to buy and returns a `payment_id`, and the provider's
webhook confirms it. The webhook is authenticated by an HMAC-SHA256 signature over the **raw**
request body — with no secret configured the route 404s outright, because an unsigned funding
webhook mints budget for whoever finds the URL.

Redelivery is the normal case, not the exception: `status` is flipped by the same UPDATE that
tests it and the ledger ref is `fund:{payment_id}`, so ten deliveries credit once. The shape is
PSP-agnostic — swapping Stripe for bKash is an adapter, not a schema change.

### Money out

A publisher's earnings are not cash until an admin pays them. `POST /v1/withdrawals` is a
*request*: it moves nothing, and it is capped at what has cleared `SETTLEMENT_DELAY_DAYS`
(default 14) plus whatever is already queued, so the same credits cannot be promised twice.

That delay is the platform's clawback window, and it is what turns fraud review from advice
into a control. Every accepted risk in [Part III](#part-iii--security-model) — a promoter
minting codes for purchases that did not happen, a forwarded code, collusion between two
counterparties — is bounded by the same sentence: *the review runs before real money leaves.*
Without a holdback that sentence is false, and the ledger's integrity guarantees only mean the
platform can describe precisely how it was defrauded.

Admins can also adjust a budget by hand (goodwill credit, or clawing back a mis-funded
campaign). It moves through the same ledger, can never push a balance below zero, and is
audited.

---

## Figure 7: Who Sees What

```
┌────────────────────────────────────────────────┐
│  PROMOTER                                       │
│  • request partnerships, set the four rates     │
│  • create, fund, pause and end campaigns, in    │
│    either mode (acquisition | engagement)       │
│  • design QR codes (colors, size, quiet zone,   │
│    error correction, center logo) and download  │
│    print-ready SVG or PNG                       │
│  • see and rotate their OWN API key, used by    │
│    their booking system / POS to mint one       │
│    transaction code per purchase                │
│  • fund a campaign through PSP checkout         │
│  • void a code whose print run went astray      │
│  • scans / installs / fees / budget left        │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  PUBLISHER                                      │
│  • accept or ignore partnership requests        │
│  • request a payout of what has cleared the     │
│    settlement window                            │
│  • see and rotate their Partner API key         │
│  • register the Play package and App Store id   │
│    scans redirect to, plus a web fallback and   │
│    an app link for repeat-purchase campaigns    │
│  • declare their own joining bonus as a label   │
│  • what they've earned, campaign by campaign    │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│  SUPER ADMIN                                    │
│  • overview, orgs, partnerships, campaigns,     │
│    scans, redemptions, QR codes, ledger         │
│  • approve a publisher before it can be paid    │
│  • pay or reject a withdrawal request           │
│  • issue a password-reset token for a locked-   │
│    out tenant                                   │
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
       A scan resolves to a store listing or the publisher's own app link. It carries
       no token and nothing spendable. What DOES travel is an opaque lookup key —
       `qrm_claim` on an acquisition scan, and additionally `qrm_code` on an
       engagement one — and neither does anything without the publisher's
       server-side API key. On an iOS acquisition scan nothing travels at all.
         → there is no code path by which a scan can unlock in-app content, even
           if a publisher wanted one. The API returns no amount and no grant.

  2. What moves between companies is a marketing fee, not user currency.
       The ledger transfers platform credits promoter → publisher for an acquired
       user or a repeat purchase. Nothing is credited to an end user, by anyone,
       anywhere in this system.
         → this is an ad network's cost-per-acquisition and cost-per-transaction,
           not a currency marketplace.

  3. The joining bonus is the publisher's own, granted by the publisher.
       /v1/attribution/claim answers one question: "is this attributable?"
       It returns no amount to grant and no instruction to grant anything. The
       publisher applies its own policy, funded by its own free-grant allowance —
       which is exactly what it does for organic users too.
         → `bonus_label` is a description the publisher writes about itself. The
           platform stores it for reporting and never acts on it.
```

### Engagement mode is where this argument gets thinner — read this

Everything above was written for a flow where the phone receives nothing. Engagement mode puts
`qrm_code` in the app's hands, and the user-visible experience is closer to "scan a code, get
something" than any acquisition scan ever was. That is exactly the shape 3.1.1 names, so it
deserves the argument spelled out rather than assumed:

**What still holds.** The code is an opaque transaction reference, not a bearer credential. It
is single-use, short-lived, minted server-side against a purchase the promoter already took
money for, and it is worth nothing to anybody who cannot present it *with the publisher's
server-side API key*. That is the same trust model as Play's install referrer, which every
attribution SDK on both stores relies on. The API still returns no amount, no currency and no
instruction to grant; the publisher decides what a customer gets, under its own policy, from
its own allowance.

**What genuinely changed.** The user is now scanning something they were handed *because they
bought a ticket*, and something good happens in the app afterwards. Whether the store operators
read that as measurement or as an unlock mechanism is not a question this codebase can settle.
The e2e assertion that a scan redirect leaks no spendable token had to be scoped to acquisition
scans, and that scoping is the compliance surface.

**Recommendation.** Have this reviewed before shipping engagement campaigns to a store-listed
app. Keep `qrm_code` opaque, single-use and short-lived so it reads as measurement. Do not let
it become anything a user could read aloud, type in, or share as value.

**What still has to hold on the publisher's side.** Three things this platform cannot enforce
for them, and which belong in the integration agreement:

- the app must not present a "scan a QR code for coins" flow, or any in-app scanner tied to
  this system — the QR lives on printed and physical media, and is scanned with the phone's
  own camera
- the bonus must be a genuine free grant the publisher chooses to make, not a purchase
  routed around IAP
- `qrm_code` must be consumed by the app's backend and never shown to the user as a redeemable
  value — it is plumbing, not a coupon

The e2e suite asserts the first half of this structurally: an acquisition scan redirect
containing anything that looks like a spendable token fails the build.

---

## The API Surface

| Surface | Auth | Used by |
|---|---|---|
| `POST /v1/auth/signup`, `/login`, `/reset` | none | Anyone creating or using an account |
| `GET /r/:code` | none | Phones, on scan |
| `GET /go/:claim_id` | none | The iOS interstitial forwarding itself to the store (30/min per IP) |
| `GET /i/:claim_id` | none | The interstitial itself, when an engagement deep link found no app (30/min per IP) |
| `GET /v1/qr-codes/:id/image` | none | The QR preview and print downloads (120/min per IP) |
| `GET /healthz` | none | Load balancer — reports 503 if Postgres is unreachable |
| `/v1/*` portal routes | session JWT (12h) | Promoter and publisher dashboards |
| `/v1/attribution/*` | `pk_…` API key | The **publisher's server**, never a browser and never the app |
| `POST /v1/issue` | `pk_…` API key | The **promoter's server** — booking system or POS, one call per transaction |
| `POST /v1/payments/checkout`, `GET /v1/payments` | session JWT | The promoter funding a campaign through the PSP |
| `POST /v1/payments/webhook` | HMAC-SHA256 over the raw body | The **payment provider**. 404s entirely when no secret is configured |
| `POST /v1/withdrawals`, `GET /v1/withdrawals` | session JWT | The publisher asking to be paid its earnings |
| `/v1/admin/*` | session JWT + admin role | Super admin console |

Every route sits under a 300/min per-IP ceiling in addition to the specific limits noted
above; `/healthz` is exempt so a flood cannot cost the process its place in the load
balancer.

---

## Role Flows, End to End

Every step below names the exact HTTP call. `Bearer <token>` is the session JWT from
signup/login; `Bearer pk_…` is an API key — **both** tenant types get one at signup now, and
they are not interchangeable: the publisher's calls `/v1/attribution/*` and earns fees, the
promoter's calls `/v1/issue` and spends them.

### Promoter journey

```
1.  Create an account — this also mints an API key, shown once
    POST /v1/auth/signup            { type: "promoter", name, email, password }
    → 201 { token, org, api_key }                                     auth: none
    (only needed for engagement campaigns; POST /v1/api-keys/rotate reissues it)

2.  Browse publishers to partner with
    GET  /v1/publishers                                                auth: Bearer <token>

3.  Propose partnership terms — all four rates
    POST /v1/partnerships   { publisher_org_id, coin_rate, guest_rate, grace_days,
                              engagement_rate }
    → 201 partnership, status "pending"                                auth: Bearer <token>

4.  Wait for the publisher to accept (poll or reload)
    GET  /v1/partnerships                                              auth: Bearer <token>

5.  Create a campaign under the now-active partnership. `mode` is fixed here and
    there is no endpoint to change it — run both products as two campaigns.
    POST /v1/campaigns   { partnership_id, name,
                           mode: "acquisition" | "engagement" }   ← default acquisition
    → 201 campaign, budget 0                                           auth: Bearer <token>

6.  Fund it. Two paths, and only the first is enabled in production:
    POST /v1/payments/checkout      { campaign_id, coins }
    → 201 { payment_id, status: "pending" }                            auth: Bearer <token>
    Hand `payment_id` to the PSP as metadata; its webhook confirms the charge and the
    budget is credited then — never on this call. Redelivery is safe.

    POST /v1/campaigns/:id/fund     { coins, idempotency_key }
    → 201 { budget }                                                   auth: Bearer <token>
    Demo path only: credits the budget with no payment behind it. Refused unless
    ALLOW_SELF_FUNDING is on, which it is not in production.

7a. ACQUISITION — design and generate a QR code by hand, for a print run
    POST /v1/campaigns/:id/qr-codes { style, expires_in_days, max_uses }
    → 201 { code, scan_url, ... }                                      auth: Bearer <token>
    GET  /v1/qr-codes/:id/image?format=svg   (or png)   ← print-ready   auth: none

7b. ENGAGEMENT — your booking system / POS mints one code per transaction, in code.
    This is a machine call at transaction volume, not a design step.
    POST /v1/issue   { campaign_id, issued_ref: "PNR-7X42QK", expires_in_days }
    → 201 { code, scan_url, expires_at, replay }                    auth: Bearer pk_…
    Idempotent on issued_ref — a retried booking webhook returns the same code
    with replay: true rather than minting a second reward for one purchase.
    Render it however you already render a boarding pass or receipt; the QR image
    endpoint above works on these codes too.

8.  Watch it perform
    GET  /v1/campaigns/:id/stats                                       auth: Bearer <token>
    GET  /v1/redemptions                                                auth: Bearer <token>

9.  Rename it, pause, resume, or end it — either field alone, absent = unchanged
    PATCH /v1/campaigns/:id         { name, status: "paused"|"active"|"ended" }
    auth: Bearer <token> — notifies the admin

9b. Reprice the partnership. A request, not a change: the agreed rates keep paying
    out until the publisher accepts, and every campaign under it is priced on them.
    All three rates move as one proposal, even if only one of them changed.
    PATCH /v1/partnerships/:id/rates { coin_rate, guest_rate, engagement_rate }
    → 200 partnership with proposed_* set, live rates untouched    auth: Bearer <token>

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

2b. Rule on a repricing the promoter has asked for. Until this call, the rates you
    agreed to are the rates you are paid.
    POST /v1/partnerships/:id/rates/accept    ← the proposal becomes the price
    POST /v1/partnerships/:id/rates/decline   ← cleared; they can ask again
    auth: Bearer <token>

3.  Register where scans should send people
    PATCH /v1/orgs/me   { android_package, ios_app_id, landing_url, bonus_label,
                          deeplink_url }
    auth: Bearer <token>
    deeplink_url is only needed for engagement campaigns: an https origin you have
    claimed as an Android App Link / iOS Universal Link, e.g. https://you.example/open.
    Without it an engagement scan simply behaves like an acquisition one.

4.  --- a user scans, lands on the store listing, installs, and signs up in the app.
        Nothing spendable from the scan reached the app. The publisher's *server* now
        asks us whether that install was attributable ---

5.  Claim the install
    POST /v1/attribution/claim                                  auth: Bearer pk_<api_key>
    → 200 { attributed: true, attribution_id, fee, ... }  or  { attributed: false, reason }

5b. ENGAGEMENT — a returning customer opened the app from a transaction code. Your
    app read `qrm_code` off the deep link (or off the Play referrer, if they had just
    installed) and handed it to your backend. Same endpoint, different input:
    POST /v1/attribution/claim  { code, publisher_user_ref }    auth: Bearer pk_<api_key>
    → 200 { attributed: true, kind: "engagement", fee, ... }
    No first-open call, no device signals, no /confirm — it settles in one step.

6.  Later, once the user clears the publisher's own verification bar
    POST /v1/attribution/:id/confirm                            auth: Bearer pk_<api_key>
    (acquisition only — an engagement row is already full and returns already_full)

7.  Track earnings
    GET  /v1/redemptions              (each row carries `kind`)         auth: Bearer <token>
    GET  /v1/campaigns                (budget + both rates per campaign) auth: Bearer <token>
    GET  /v1/orgs/me   → { earnings, withdrawable }                     auth: Bearer <token>
    `earnings` is everything ever earned; `withdrawable` is the part that has cleared the
    settlement window and is not already queued. Book revenue on `publisher_net`, not `fee`
    — `fee` is the gross the promoter was charged, before the platform's cut.

8.  Get paid. A request, not a transfer: an admin reviews it and the ledger moves then.
    POST /v1/withdrawals   { coins }                                    auth: Bearer <token>
    GET  /v1/withdrawals                                                auth: Bearer <token>
```

### End user journey

The end user never has an account on this platform and never calls its API directly — only
their phone's browser follows redirects, and the publisher's server does the API calls on
their behalf.

```
1a. ACQUISITION — scan the printed/displayed QR code
    GET  /r/:code                                                      auth: none
    → 302 to the publisher's store listing:
        Android  play.google.com/store/apps/details?id=…&referrer=…&qrm_claim=…
        iOS      apps.apple.com/app/id…            (no payload — none exists to carry)
        other    the publisher's web fallback
      or, if turned away, to /campaign-ended?reason=<rate_limited|invalid|voided|
      paused|ended|budget|expired|used_up|no_destination|partnership_inactive>

1b. ENGAGEMENT — scan the code on your boarding pass or receipt
    GET  /r/:code                                                      auth: none
    → 302 to the publisher's app link, ?qrm_code=…&qrm_fallback=…
      Your phone's OS decides what happens next, before the request leaves it:
        app installed      it opens, and hands the code to the publisher's backend
        not installed      the publisher's page loads and follows qrm_fallback to
                           the store, where you become an acquisition as well

2.  Install the app and sign up inside it (publisher-owned UI, not this platform's).
    You type nothing and paste nothing. On an engagement scan the app receives an
    opaque transaction reference, which is plumbing between two servers — it is not
    shown to you, and it is worth nothing without the publisher's own API key.

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
    GET  /v1/admin/overview         (27 aggregates + ledger_balanced, balances_reconciled,
                                      conversion_rate)
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

4.  Override a partnership's commercial terms, or suspend it
    PATCH /v1/admin/partnerships/:id { coin_rate, guest_rate, grace_days, status,
                                       platform_fee_bps }
    status: pending | active | suspended. `suspended` stops scans and payouts and the
    publisher cannot re-accept its way out of it; `pending` is the publisher's inbox state.
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

7b. Approve a publisher before it can be partnered with or paid, review payouts, and
    recover a locked-out tenant
    PATCH /v1/admin/orgs/:id          { approved: true }
    GET   /v1/admin/withdrawals?status=requested
    POST  /v1/admin/withdrawals/:id/pay      { note }   ← the ledger moves here
    POST  /v1/admin/withdrawals/:id/reject   { note }
    POST  /v1/admin/orgs/:id/reset-token     → single-use token, shown once, 1 hour
    auth: Bearer <token> (admin) — all audited

8.  Suspend, edit, or fully offboard a tenant
    PATCH /v1/admin/orgs/:id        { suspended, name, landing_url, reason }
    POST  /v1/admin/orgs/:id/rotate-key
    POST  /v1/admin/orgs/:id/offboard { reason }   ← suspends + revokes key + ends campaigns
    auth: Bearer <token> (admin) — all audited

9.  Read what tenants have done and clear it
    GET  /v1/admin/notifications?limit=   ← the unacknowledged end of the audit log:
                                            entries whose actor is a tenant, so the
                                            platform did not do it itself
    POST /v1/admin/notifications/ack { ids }   ← omit `ids` to clear the whole inbox
    auth: Bearer <token> (admin)

10. Review the trail — everything, forever, acknowledged or not
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

Window: `REFERRER_WINDOW_DAYS`, default **30 days** from scan to **first open**. Long on
purpose — people scan a poster, install that evening on wifi, and open it the next day.

The two-call flow in §4 works on Android too, and is the recommended shape for both platforms:
one integration path, and the referrer is captured at launch where the Install Referrer API
actually hands it to you. Android tolerates the single call because the referrer names the
exact scan whenever it arrives; iOS does not.

## 4. iOS — the fingerprint fallback

There is no install-referrer channel on iOS. Nothing survives the App Store transition, so the
match is necessarily probabilistic — and it has to happen **at first open, not at signup**.

### 4.1 Call `first-open` when the app launches

```bash
curl -X POST https://api.example.com/v1/attribution/first-open \
  -H "Authorization: Bearer $QRM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "ip": "203.0.113.7",
    "platform": "ios",
    "tz": "Asia/Dhaka",
    "screen": "393x852@3",
    "cores": 6,
    "dark": true,
    "language": "en-US"
  }'
```

```json
{ "attributed": true, "install_id": "9f2c…", "match_method": "fingerprint",
  "confidence": 100, "signup_deadline": "2026-09-04T…Z" }
```

Store `install_id` on the device (Keychain) **and** against the user record once they register.
Nothing is paid at this stage. Call it once per install; a second call finds the scan already
consumed and returns `no_match`, which is why the id must be persisted rather than re-derived.

### 4.2 Call `claim` when they actually sign up

```bash
curl -X POST https://api.example.com/v1/attribution/claim \
  -H "Authorization: Bearer $QRM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "install_id": "9f2c…", "publisher_user_ref": "user_84214", "identified": true }'
```

This can be minutes or weeks later — `SIGNUP_WINDOW_DAYS`, default 30.

### 4.3 Getting the signals right

This is the whole integration on iOS. Send every field; each one you omit costs confidence,
and below the floor nothing is attributed at all.

| Field | Native source | Notes |
|---|---|---|
| `ip` | client IP **your server saw at first open** | not your load balancer, not an egress IP |
| `platform` | `"ios"` | |
| `tz` | `TimeZone.current.identifier` | IANA, e.g. `Asia/Dhaka` |
| `screen` | `UIScreen.main.bounds` + `scale` | `"{short}x{long}@{dpr}"`, e.g. `393x852@3` |
| `language` | `Locale.current.identifier` | `en-US` or `en_US`, either is fine |
| `cores` | `ProcessInfo.processInfo.activeProcessorCount` | integer, e.g. `6` |
| `dark` | `traitCollection.userInterfaceStyle == .dark` | boolean, or `"dark"` / `"light"` |

`cores` and `dark` are optional and always will be: an SDK that has not been updated simply
earns nothing for them, exactly as a missing timezone always has. Neither will ever be
*required*, because that would make upgrading the SDK the thing that decides who gets paid.

`screen` must be **orientation-normalised** — shorter dimension first — because the browser
that scanned may have been sideways. Points, not pixels: `393x852@3`, not `1179x2556@3`. Get
this wrong and it will not error, it will simply never match.

`ip` accepts IPv4 and IPv6 in any spelling — `::ffff:203.0.113.7`, `203.0.113.7`,
`2001:0db8::0001` and `2001:db8::1` all normalise server-side before hashing, so your
representation need not match ours. Raw addresses are never stored on either side.

Optionally send `emulator`, `rooted` and `vpn` booleans if your SDK detects them. `emulator`
refuses the install outright; the other two are recorded for review and do not block.

### 4.4 Confidence and refusals

| Signals agreeing | Score | Result (floor = 70) |
|---|---|---|
| IP + platform only | 55 | **refused** — `low_confidence` |
| \+ timezone | 63 | refused |
| \+ timezone, locale | 70 | attributed, on the line |
| \+ screen | 77 | attributed |
| \+ screen, timezone, locale | 92 | attributed |
| everything | 100 | attributed |

**`ip` alone is no longer enough.** It was in the previous single-call API; it is not now. An
IP is a postcode — carrier NAT, café wifi, an airport, a corporate VPN — and paying on it
attributes strangers to each other.

`ambiguous` means two scans fit equally well and neither was chosen. Both refusals are normal
answers on a 200, not errors.

### 4.5 Window

`FINGERPRINT_WINDOW_MIN`, default **60 minutes**, now measured scan → **first open** rather
than scan → signup. That is the point of the split: an install lands minutes after a scan, a
signup can land days later, and one window could never honestly cover both.

**Expect a lower match rate on iOS than Android.** That is inherent to the platform, not a bug
in the integration.

### 4.6 Migrating from the single-call API

`POST /claim` still accepts `{ ip, install_referrer, … }` without an `install_id`, so existing
integrations keep working — but that path now runs the same scored matcher at signup time, so
a bare `ip` scores 55 and is refused where it used to pay. On Android the referrer makes this
irrelevant. On iOS, move to the two-call flow or iOS attribution will drop to near zero. You
can also send `tz`/`screen`/`language`/`cores`/`dark` on the legacy single call as a stopgap.

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
| `already_claimed` | That scan, install or transaction code was already matched to a different user. | Nothing. |
| `not_engagement` | You sent a `code` from an acquisition campaign, which has no repeat-purchase price. | Fix the call — send the referrer/install_id instead. |
| `not_a_new_user` | You asserted `is_new_user: false` on an acquisition claim. | Nothing. Acquisition only. |

**`attributed: false` never means "reject this signup".** The user signed up; that happened
regardless of who gets paid for it.

## 5b. Repeat purchases (engagement campaigns)

If a promoter runs an **engagement** campaign, it mints one single-use code per transaction and
prints it on the boarding pass or receipt. Your integration for that is one call.

### What reaches your app

The scan sends the phone to the URL you registered as `deeplink_url`, with two parameters:

```
https://you.example/open?qrm_code=Ab3xKp7wZs1a&qrm_fallback=https%3A%2F%2Fplay.google.com%2F…
```

**Register `deeplink_url` as a real App Link / Universal Link.** That is the whole mechanism:
when your app is installed, the OS opens it and never makes the request; when it is not, the
browser loads that page normally.

Two things to build, both small:

1. **In the app** — read `qrm_code` off the opening URL and send it to your own backend. Never
   call our API from the app; the key must not ship in a binary.
2. **On that web page** — if it loads at all, the app was not installed. Redirect to
   `qrm_fallback` and nothing else:

   ```html
   <script>
     const f = new URLSearchParams(location.search).get('qrm_fallback');
     if (f) location.replace(f);
   </script>
   ```

   We build `qrm_fallback` for you rather than letting you assemble it, because on Android it
   contains the Play install referrer — and a referrer put together wrong is an attribution rate
   of zero with no error anywhere to tell you.

**On Android the code also survives an install.** `qrm_fallback`'s referrer carries
`qrm_claim` *and* `qrm_code`, so a customer who scanned a boarding pass without having your app
yet is both a new signup and a purchase, and you are paid for both. Read the referrer at first
open as in §3.1 and pull both out of it.

**On iOS it does not.** The App Store has no referrer channel, so a fall-through install loses
the purchase code. The acquisition half still works — `qrm_fallback` points at our interstitial,
which collects the fingerprint signals. If you want the purchase reward on that path too, stash
`qrm_code` on your web page (a cookie, a server-side session) and present it after signup.

### Claiming it

```bash
curl -X POST https://api.example.com/v1/attribution/claim \
  -H "Authorization: Bearer $QRM_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "code": "Ab3xKp7wZs1a", "publisher_user_ref": "user_84213" }'
```

```jsonc
{
  "attributed": true,
  "attribution_id": "4d8f…",
  "kind": "engagement",          // vs "acquisition"
  "match_method": "code",        // the code named the purchase outright
  "confidence": 100,
  "fee": 20,                     // engagement_rate
  "pending_fee": 0,              // no guest tier; nothing to confirm
  "confirm_deadline": null,
  "replay": false
}
```

You may pass the whole Play referrer string as `code` instead of the bare value — we parse
`qrm_code` out of it, the same way we parse `qrm_claim` out of `install_referrer`.

### The rules that differ from acquisition

- **`code` is explicit.** We never read it out of `install_referrer` implicitly, even though an
  engagement referrer carries both. The two are different payouts on different terms, and one
  call quietly deciding which you meant is an accounting surprise you reconcile by hand later.
- **The idempotency key is the code, not the user.** A retry with the same code *and the same*
  `publisher_user_ref` replays. The same code with a **different** user is refused
  `already_claimed` — that is a forwarded screenshot, not a retry, and replaying would hand a
  second person the first one's reward.
- **The same user can claim as many codes as they hold.** That is the entire point. Eleven
  flights, eleven codes, eleven payouts.
- **No `/confirm`.** An engagement row is settled on creation; confirming returns
  `already_full`.
- **`is_new_user` is ignored.** A repeat customer is not supposed to be new.

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

This whole section is **acquisition only**. There is no guest tier on a repeat purchase: the
customer already transacted with the promoter, which is a harder fact than any verification bar
you could apply.

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

**On an engagement claim the idempotency key is the `code`, not the user.** Retrying with the
same code and the same user replays; the same code with a different user is refused. Sending
the *same user* with a *different* code is not a retry at all — it is a second purchase, and it
pays again. That is the difference between the two products in one sentence.

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
- [ ] **Read `publisher_net`, not `fee`, when you book revenue.** `fee` is the gross the
      promoter's budget was charged; `publisher_net` is what actually landed in your account
      after the platform's cut, and `platform_fee` is the difference. All three are on every
      attributed response, including replays.
- [ ] **Expect a settlement delay before you can withdraw.** `GET /v1/orgs/me` returns
      `earnings` (everything you have ever earned) and `withdrawable` (what has cleared the
      review window and is not already queued). Request payouts against the second number.

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

`e2e-test.sh` in this repo runs the full loop, including both match paths and both campaign
modes, as a reference. Section 6c is the engagement flow end to end: mint two codes against one
campaign, scan both, and assert the same `publisher_user_ref` is paid twice — the assertion that
was impossible before engagement mode existed, and the one that proves it works.

## 10. Endpoint quick reference

Full request/response schemas: the live Swagger UI at `/docs`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/attribution/first-open` | `pk_` API key | Bind this install to a scan. Pays nothing. |
| `POST` | `/v1/attribution/claim` | `pk_` API key | Is this signup attributable? Pays the fee. |
| `POST` | `/v1/attribution/claim` + `code` | `pk_` API key | Is this repeat purchase attributable? Pays `engagement_rate`. |
| `POST` | `/v1/issue` | `pk_` API key (**promoter's**) | Mint one transaction code. Promoter-side, not yours. |
| `POST` | `/v1/attribution/{id}/confirm` | `pk_` API key | Release the held-back fee |
| `GET` | `/v1/attribution/{id}` | `pk_` API key | Look up one attribution |
| `POST` | `/v1/auth/signup` · `/login` | none | Create account / get session token |
| `POST` | `/v1/api-keys/rotate` | session JWT | New API key, old one dies instantly |
| `GET` · `PATCH` | `/v1/orgs/me` | session JWT | App package, store id, landing URL, app link, bonus label |
| `GET` | `/v1/partnerships` | session JWT | Proposed and active partnerships |
| `POST` | `/v1/partnerships/{id}/accept` | session JWT | Accept the terms (from `pending` only) |
| `PATCH` | `/v1/partnerships/{id}/rates` | session JWT | Promoter asks to reprice. Pays nothing until accepted |
| `POST` | `/v1/partnerships/{id}/rates/accept` · `/decline` | session JWT | Publisher rules on an open proposal |
| `GET` | `/v1/redemptions` | session JWT | Your last 100 attributions, for reconciliation |
| `POST` · `GET` | `/v1/withdrawals` | session JWT | Request a payout / your payout history |
| `POST` | `/v1/auth/reset` | none (single-use token) | Set a new password with an admin-issued token |
| `POST` | `/v1/payments/checkout` | session JWT | Promoter-side: start funding a campaign |

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
  │  On an engagement claim it asserts far less: the transaction code │
  │  is ours, minted by the promoter, and we check it ourselves.      │
  └───────────────────────────────────────────────────────────────────┘
  ┌─ PROMOTER'S SERVER ──────── authenticated, self-limiting ─────────┐
  │  Holds its own pk_ API key and mints transaction codes against    │
  │  its own campaigns. It cannot inflate anyone's earnings without   │
  │  spending its own funded budget to do it — see §9.8.              │
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
The phone receives no credential, so there is nothing for a user to steal, replay or forge.
Attribution is asserted server-to-server afterwards by an authenticated party.

On an engagement scan the phone does carry an opaque transaction code onward to the app. It
still is not a credential — it authenticates nothing, and presenting it without the publisher's
API key does nothing at all — but it is worth naming the one thing it *can* do: whoever holds
it can be the person the reward is attributed to, once. See §9.9.

## 2. Authentication

| Credential | Form | Lifetime | Storage |
|---|---|---|---|
| Session | JWT, HS256 | 12h | Not stored; verified by signature |
| Partner API key | `pk_` + 192 bits random | Until rotated | **SHA-256 hash only** |
| Claim id | 128 bits base64url | One use | Opaque row key, not a credential |
| Transaction code | 96 bits base64url | One scan, one reward | Opaque row key, not a credential |
| Password reset token | 192 bits base64url | One use, 1 hour | **SHA-256 hash only** |
| Payment webhook signature | HMAC-SHA256 over the raw body | Per request | Shared secret, never stored |

- **Keys are never recoverable.** Only the SHA-256 hash is stored. Rotation
  (`POST /v1/api-keys/rotate`) invalidates the previous key on the next request.
- **Revocation is immediate, not on token expiry.** `AuthGuard` re-reads the org on every
  request, so suspending a tenant kills live sessions instantly rather than up to 12h later.
  It also re-reads `type`, so a demotion takes effect at once.
- **The Partner API checks `suspended` too.** An offboarded publisher's key stops earning
  fees on the next call, and a suspended promoter's key stops minting codes on the next call —
  not whenever someone remembers to rotate it.
- **The two key types are not interchangeable.** `orgFromKey` takes the required `type`, so a
  publisher key on `/v1/issue` is a 401 and a promoter key on `/v1/attribution/*` is a 401.
  Asserted in the e2e suite, because "same credential format" is exactly how that kind of
  authorisation gap gets shipped.
- **Default secrets refuse to boot.** `JWT_SECRET` left at its dev value in production is a
  total auth bypass, so the process exits at startup instead of serving with it.
- **Reset tokens are single-use by construction.** The same UPDATE that matches the token
  clears it, so two submissions of one token change the password once. They are issued by an
  admin and never by an unauthenticated request — there is no "forgot password" endpoint that
  a stranger can aim at somebody else's address.
- **The payment webhook is authenticated by signature, not by secrecy of the URL.** The HMAC
  is computed over the *raw* body (the parser stashes the bytes) and compared in constant time.
  With no secret configured the route 404s rather than accepting anything — money-in is off by
  default, which is the correct failure mode for an endpoint that credits budgets.

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
| One payout per user per campaign (acquisition) | `UNIQUE (campaign_id, publisher_user_ref) WHERE kind='acquisition'` |
| One payout per issued code (engagement) | `UNIQUE (qr_code_id) WHERE kind='engagement'` |
| One code per transaction | `UNIQUE (campaign_id, issued_ref)` on `qr_codes` |
| One payout per scan (acquisition) | `UNIQUE (scan_id) WHERE kind='acquisition'` + `consumed` flag under a row lock |
| A row's `kind` matches which index guards it | `CHECK (kind='engagement') = (qr_code_id IS NOT NULL)` |
| Ledger always balances to zero | Append-only double entry; asserted in the suite |
| Budget can never go negative | `SELECT … FOR UPDATE` on the balance row before every debit |
| `guest_rate <= coin_rate` | `CHECK` constraint in the migration |
| The platform's cut never breaks a ref's zero-sum | One `payout()` helper writes all three rows; `net + cut == gross` proved exhaustively in `money.test.ts` |
| One credit per payment, however often the PSP retries | `status` flipped by the UPDATE that tests it + `UNIQUE (account, ref)` on `fund:{payment_id}` + `UNIQUE (provider_ref)` |
| A publisher cannot withdraw the same credits twice | Queued requests are subtracted from `withdrawable`, computed under the balance row lock |
| A withdrawal cannot be paid twice | `status` flipped by the UPDATE that tests it, inside the transaction that moves the money |
| Earnings cannot leave inside the review window | `SETTLEMENT_DELAY_DAYS` holdback on recent credits |
| An unvetted publisher cannot be paid at all | `approved` gates both the directory and partnership creation |

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
| `code` (engagement claim) | 1000, then matched against the issued-code shape |
| `issued_ref` | 200 |
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
  never creates tables at boot. Migration directory names must sort in apply order — a
  timestamped name mixed in with the numbered ones once sorted *before* the migrations it
  depended on, which broke every fresh deploy while leaving already-migrated databases fine.
- **Reconciliation runs on a clock, not on a page load.** A background sweep re-checks that the
  book sums to zero and that every cached balance still equals its ledger entries, at boot and
  every 10 minutes. Drift means something is spending against a wrong number, so it alerts
  rather than waiting to be noticed on a dashboard.
- **Alerts are pushed.** `ALERT_WEBHOOK_URL` (Slack-compatible) receives ledger drift, an
  unbalanced book, and campaigns whose budget is about to run dry — the last one being a
  promoter's live print run about to start bouncing. Everything also lands in the structured
  log at `level=error`, so the webhook is a convenience and never the only record.
- **Backups.** `docker-compose.prod.yml` runs a nightly `pg_dump` into a named volume, keeping
  14 days. The ledger is the one thing in this system that cannot be re-derived from anything
  else; ship those dumps off-host for durability that survives losing the machine.

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
Still probabilistic, and inherently so — iOS has no referrer channel. But the exposure is now
much narrower than "hashed IP + platform": the interstitial adds timezone, screen geometry and
locale, `MIN_CONFIDENCE` refuses anything scoring below 70, and an exact tie between two
candidates is refused outright rather than resolved by recency.

What remains: two people on one NAT, on the same handset model, in the same locale, scanning
within the same 60-minute window, both score 100 — and are then correctly refused as
`ambiguous`, which costs a real attribution rather than paying a wrong one. The system now
errs toward under-attributing. That is the right direction for a system that pays out on its
own answers, but it means **the measured match rate is not the true install rate**, and
publishers should be told so rather than left to infer a bug.

The device fingerprint is a *device shape*, not a device: identical handsets on one network
with the same locale hash identically. That is why `DEVICE_DEDUPE_DAYS` refuses a repeat
install rather than banning anything, and why it can be turned off in high-NAT markets.

*Levers:* `MIN_CONFIDENCE` (70) is now the main dial, `FINGERPRINT_WINDOW_MIN` (60) the
second. Adding SKAdNetwork/AdAttributionKit remains the real upgrade if the refused-as-
ambiguous rate ever costs more than the false matches would have.

### 9.2b The interstitial is a conversion cost
The iOS scan path now has an extra hop and a ~900ms hold before the App Store. It is the only
way to read the signals that make iOS attribution work at all, but it is not free: every
scanner who abandons on that page is an install nobody gets paid for. Nothing currently
measures that drop-off — scans and installs are counted, the hop between them is not.

*Lever:* `HOLD_MS` in `interstitial.ts`. Instrumenting `/go/:claim_id` hits against `/r/:code`
hits would turn this from a guess into a number.

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

### 9.8 A promoter can mint codes for purchases that did not happen
`/v1/issue` takes the promoter's word that a transaction occurred. We cannot see into a booking
system any more than we can see into a publisher's app.

**This one is largely self-limiting**, which is why it is not mitigated further: every code the
promoter mints is a code that, when redeemed, moves money *out of the promoter's own funded
budget* and into the publisher's. Inventing purchases means paying a publisher for nothing. The
attack that is left is collusion between the two — a promoter and publisher inflating volume
together to defraud a third party such as an investor or a rebate scheme — and no technical
control inside a two-party ledger can catch that.

*Levers:* `issued_ref` is stored on every code, so an audit can reconcile issuance against the
promoter's own transaction records; the campaign budget caps total exposure; issuance is scoped
to campaigns the promoter owns and to `engagement` mode. **Commercially, both sides are
counterparties under contract** — this is a contractual control with technical support.

**And now a technical one with teeth:** earnings are not cash for `SETTLEMENT_DELAY_DAYS`
(default 14). Collusion still cannot be *detected* inside a two-party ledger, but it can be
*undone* — the pattern surfaces in the same audit trail it always did, and the money is still
on the platform when it does. A rate that used to be discovered after the payout is now
discovered before it. See [Figure 6 — Money out](#money-out).

### 9.9 A transaction code can be forwarded
The code is printed on a boarding pass or receipt. Somebody can photograph it, forward it, or
post it. Whoever scans and claims it first is the person the reward attributes to.

Accepted because the alternatives are worse than the problem. Binding the code to a passenger
identity would require this platform to hold one, which §7 exists to avoid; requiring the
publisher to match its own user against the promoter's customer record would put personal data
across a boundary neither side wants it to cross.

What bounds it: the code is single-use, so a shared code is **one** misdirected reward and not
a faucet. A second person presenting it is refused `already_claimed` rather than paid. Expiry
(30 days by default) bounds the window. And the reward is worth `engagement_rate` — a number
the promoter chose, and one deliberately smaller than an acquisition.

*Levers:* shorten `expires_in_days` at issuance; lower `engagement_rate`; print the passenger
name beside the code so a gate agent or cashier can see a mismatch. A per-user daily cap is the
next technical control worth adding if forwarding is ever measured rather than assumed. The
settlement window applies here too: a misdirected reward spotted inside it is still recoverable.

### 9.10 No per-user cap on engagement rewards, on purpose
There is no cooldown and no daily ceiling on how many purchase rewards one
`publisher_user_ref` can collect. A frequent flyer collecting forty in a year is the product
working, not an anomaly, and any cap tight enough to catch abuse would also refuse them.

The real ceiling is upstream: **one code per transaction, minted by the party that took the
money.** Somebody who wants more rewards has to buy more tickets. The campaign budget caps
total spend regardless.

*Lever:* if static counter-stickers are ever added (see §9.11), they break that link — a code
nobody had to buy anything for — and a per-user cooldown becomes required rather than optional.
It is not needed for per-transaction issuance.

### 9.11 Not built yet, on purpose
- **A specific payment provider** — `POST /v1/payments/checkout` + the signed webhook are the
  contract, and an adapter for one named PSP (creating the charge, translating its callback)
  is the remaining work. The ledger side is done and idempotent.
- **Email delivery** — a password reset is issued by an admin and relayed out of band. The
  token flow is built; only the mailer is missing, and it calls the same endpoint.
- **One login per company** — no teams, roles or invitations yet (login *is* the org)
- **TOTP on the org login** — still the next auth control worth adding (see §9.4)
- **Static counter codes for shops with no POS integration** — deliberately deferred; see the
  scope note below
- **Bulk issuance** — `/v1/issue` is one call per transaction. A nightly batch of ten thousand
  bookings is ten thousand calls, well inside the 600/min per-key ceiling only if it is spread
  out. A batch endpoint is the obvious next addition if a partner needs it.
- **Changing a campaign's mode** — no endpoint, on purpose (see Figure 5)

None of it touches the core promise: **fees can't be duplicated, lost, or paid out twice —
and nothing this platform issues can unlock anything inside an app.**

## 10. Reporting a vulnerability

Report privately to the address on the deployment's security page. Please do not open a public
issue for anything touching the money path in §3.

---
---

# Scope of Engagement Mode

What was built, what was deliberately left out, and where the levers are. Written so the next
person to open this does not have to re-derive which omissions were decisions.

## In scope — built and covered by the suite

| Area | What landed |
|---|---|
| **Data model** | `campaigns.mode`; `partnerships.engagement_rate` + `proposed_engagement_rate`; `qr_codes.issued_ref`; `redemptions.kind` + `qr_code_id`; `orgs.deeplink_url` |
| **Guarantees** | Three partial unique indexes (see [Figure 2c](#figure-2c-one-scan-two-payouts)), one CHECK tying `kind` to `qr_code_id`, one CHECK bounding `engagement_rate` |
| **Issuance** | `POST /v1/issue`, promoter API key, idempotent on `issued_ref`, scoped to own + active + engagement campaigns |
| **Credentials** | Promoters get a `pk_` key at signup; `POST /v1/api-keys/rotate` serves both tenant types; the two key types are not interchangeable |
| **Scan path** | Engagement destination resolution (`qrm_code` + `qrm_fallback`), `qrm_code` in the Play referrer, `GET /i/:claim_id` so the iOS fall-through keeps its fingerprint |
| **Payout** | Engagement branch on `POST /v1/attribution/claim`; same budget lock, same double-entry ledger, same rollback-on-refusal; replay on retry, `already_claimed` on a different user |
| **Pricing** | `engagement_rate` through `validateRates`, so partnership creation, the promoter's proposal, the publisher's accept/decline and the admin patch all agree by construction |
| **Reporting** | `mode` and `kind` columns in the portal and admin console; engagement counts on the admin overview; analytics rewritten to a LATERAL aggregate so a two-payout scan is not counted twice |
| **Tests** | `e2e-test.sh` §6c — 20 assertions, including the two that matter most: the same `publisher_user_ref` paid twice for two tickets, and acquisition still refusing exactly that |

## Deliberately out of scope

Each of these was considered and declined for a stated reason, not overlooked.

| Left out | Why | When to add it |
|---|---|---|
| **Static counter codes** (a sticker at the till, unlimited scans) | Nothing ties a scan to a purchase, so "one per code" stops meaning "one per purchase". A corner shop with no POS is a real customer, but it is a different security model, not a smaller one. | When a partner without a POS is worth the per-user cooldown and daily cap it would require. |
| **Per-user cooldown / daily cap** | Redundant while codes are minted per transaction — the cap is already "one per purchase" and the budget bounds total spend. Any cap tight enough to catch abuse would refuse a frequent flyer. | Immediately, if static codes land. See §9.10. |
| **Binding a code to a named customer** | Would require this platform to hold an end-user identity, which §7 exists to avoid, or to put personal data across the promoter/publisher boundary. | Probably never here; print the name beside the code instead. |
| **Bulk issuance endpoint** | One call per transaction is the honest shape and fits inside the 600/min per-key ceiling for normal volume. | When a partner's nightly batch cannot be spread out. |
| **Changing a campaign's mode** | The guarantees are partial indexes over rows that already exist; flipping the mode strands a run of redemptions under a rule they were never checked against. Two campaigns is the honest answer. | Never. This is a correctness boundary, not a missing feature. |
| **A guest tier on engagement** | A repeat customer already transacted with the promoter — a harder fact than any verification bar the publisher could apply. A held-back delta would be solving a problem that does not exist here. | Never. |
| **iOS purchase-reward survival through an install** | The App Store has no referrer channel. Nothing we build changes that. | If SKAdNetwork / AdAttributionKit is ever adopted for the acquisition path, revisit. |
| **Measuring engagement deep-link drop-off** | Same gap as §9.2b: when the OS opens the app we never see the request, so "app opened" is unobservable from here. | Publisher-side instrumentation is the only place this can be counted. |

## Known limits to state plainly

- **iOS fall-through loses the purchase reward.** A traveller with no app scanning a boarding
  pass on an iPhone gets attributed as an acquisition but not as a purchase, unless the
  publisher's own web page stashes `qrm_code` before forwarding. Inherent to the platform.
- **A forwarded code pays whoever claims it first**, once. See §9.9.
- **The compliance argument is thinner than for acquisition.** `qrm_code` reaches the app. The
  reasoning is in [Figure 8](#figure-8-why-the-qr-unlocks-nothing) and the recommendation there
  is to have it reviewed before shipping to a store-listed app.
- **Deep links need publisher-side work.** `deeplink_url` only functions if the publisher has
  actually registered it as an App Link / Universal Link and their page follows
  `qrm_fallback`. Misconfigured, it fails soft — engagement scans behave like acquisition ones
  — which is safe but silent.

---

## The One-Minute Pitch

> A brand pays into a campaign, through a checkout whose webhook is signed and idempotent. A
> QR code goes out into the world. Every scan either opens the publisher's store listing or
> gets safely turned away with a reason. The install is matched back server-to-server — never
> by anything the phone carried — and the money only ever moves once, in the right direction,
> with a double-entry trail behind it. The platform keeps an agreed slice of every payout, in
> the same transaction; the publisher withdraws the rest once it has cleared a review window
> long enough to take it back if it should not have been paid.
>
> And when the brand is an airline rather than a poster, the same machine sells a second
> thing: one code per ticket, one reward per code, so the traveller who flies eleven times is
> paid eleven times — with the same ledger, the same budget lock, and the same refusal to pay
> anyone twice for one purchase.
