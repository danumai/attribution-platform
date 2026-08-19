# Demo & test script

Everything needed to rehearse a demo and to check the system actually works before giving one.
`pnpm seed` builds the world; the sections below are the walkthrough and the checklist.

- [1. Start](#1-start) · [2. What the seed builds](#2-what-the-seed-builds) · [3. The 12-minute demo](#3-the-12-minute-demo)
- [4. Test checklist](#4-test-checklist) — the things to verify yourself, with expected results
- [5. Server-to-server calls](#5-server-to-server-calls) · [5b. Seeding a deployed environment](#5b-seeding-a-deployed-environment) · [6. Reset & troubleshooting](#6-reset--troubleshooting)

---

## 1. Start

```bash
pnpm install          # once
pnpm dev              # postgres + redis + API (:4000) + web (:3000)
pnpm seed             # in a second terminal — prints logins, API keys and scan URLs
```

Keep the seeder's output on screen: the QR codes it prints are new on every run.

| | |
|---|---|
| Portal | http://localhost:3000/login |
| API docs (Swagger) | http://localhost:4000/docs |
| Promoter | `promoter@demo.com` / `password123` — Air Dhaka |
| Publisher | `publisher@demo.com` / `password123` — DramaBox |
| Super admin | `admin@qrreward.local` / `admin12345` |
| Second promoter / publisher | `promoter2@demo.com`, `publisher2@demo.com` — same password |

The publisher's API key is pinned in `.env` (`pk_devdev…`) so it survives a reset. The
promoter's key is minted by the seeder and printed once — copy it if you want to mint
transaction codes by hand.

---

## 2. What the seed builds

A month of history, generated through the real HTTP API — every scan is a real redirect with
real headers, every payout is the Partner API answering for real.

**Tenants** — 2 promoters, 2 publishers. DramaBox has a Play package, an App Store id, a web
fallback and an App Link registered, so all four scan destinations are live.

**Partnerships**

| Deal | Status | Rates |
|---|---|---|
| Air Dhaka → DramaBox | **active** | 50 full / 10 guest / 7 grace / 20 per purchase |
| Air Dhaka → ReelKotha | pending | waiting on the publisher |
| Chaldal Fresh → DramaBox | pending | **accept this one live in the demo** |

There is also an **open repricing** on the live deal (65 / 15 proposed). The rates in force are
still 50 / 10 — that is the point of it, and the publisher rules on it during the demo.

**Campaigns** (all under Air Dhaka → DramaBox)

| Campaign | Mode | Status | Funded |
|---|---|---|---|
| Inflight entertainment — Q3 | acquisition | active | 9,000 |
| Eid getaway — airport standees | acquisition | **paused** | 2,500 |
| Ramadan teaser (finished) | acquisition | **ended** | 700 |
| Boarding pass rewards | engagement | active | 6,000 via a signed PSP webhook |

Plus one **pending checkout** (4,000) that the PSP never confirmed — what an abandoned card
page looks like in the admin console.

**Traffic** — ~142 scans across six printed codes from ten handset shapes and ten cities,
of which ~50 became installs, ~46 became paid signups (about 27 Android-deterministic, 19 iOS
fingerprint), ~15 are guests still inside their grace window and ~12 were upgraded after
verification. Ten repeat purchases were paid on boarding-pass codes, one traveller three times.
Six issued codes are printed and not yet scanned — the seeder prints one of them to scan live.

**Money** — one code voided mid print run, one withdrawal request waiting for an admin, and a
double-entry ledger that sums to zero.

> Timestamps are spread across the last 30 days by a SQL pass at the end of the seed, so the
> charts have a shape. `ledger_entries` is append-only (enforced by a trigger) and is left
> dated today — the only place the seeded history is not internally consistent.

---

## 3. The 12-minute demo

### Act 1 — the promoter (3 min) · `promoter@demo.com`

1. **Overview** — budgets, scans, signups, fees. The per-day chart is the month of history.
2. **Campaigns → Inflight entertainment — Q3 → open it.**
   - *Performance*: scans → installs → signups, and the budget draining.
   - *Audience*: country, city, language, device, OS, browser (Instagram and TikTok webviews
     show up as their own channel), screen, timezone, appearance, connection, and **QR code** —
     one row per placement, which is the panel that decides the next print run.
   - *Design studio*: change a colour, the error correction, drop a logo in the centre, then
     download SVG or PNG. This is print-ready artwork, not a screenshot.
3. **Say the compliance line while the QR is on screen**: the code is a measurement artifact.
   It resolves to a store listing — no token, nothing spendable, nothing to type in.
4. **Partnerships** — show the open repricing (65 / 15 proposed, 50 / 10 still paying out).

### Act 2 — the scan (3 min) · your phone or a private window

Open the **acquisition** scan URL the seeder printed (`/r/…`), ideally by scanning the QR from
the promoter's screen with a real phone.

- **On Android** you land on the Play listing. Look at the URL: the only thing that travelled is
  an opaque `qrm_claim` inside Play's `referrer` parameter.
- **On iPhone** you get a ~1s hand-off screen first, then the App Store. That screen is the only
  moment this handset's timezone, screen geometry and locale can ever be read — it is what makes
  iOS attribution work, and it deliberately shows no code to type in.
- **On a laptop** you land on the publisher's own page.

Now be the publisher's app. Open http://localhost:3000/publisher-sim, paste the publisher API
key, sign up with any email, leave *verified* unticked:

- The account is created, the promoter is charged the **guest rate (10)**, and 40 is held back.
- Tick **Confirm this user is verified** → the held-back 40 is released, total 50.
- Sign up a second time with a different email and no referrer → `attributed: false`,
  `no_match`. Say the line: **an unattributed install is a normal answer, not an error.**

### Act 3 — repeat purchases (2 min)

This is the second product: the airline pays for a returning customer, not a new one.

Open the **engagement** scan URL the seeder printed. Your phone is sent to the publisher's App
Link carrying `qrm_code` — in the demo that lands on the publisher-sim page, which stands in for
the app. Enter a customer id and continue: **`kind: "engagement"`, `match_method: "code"`,
confidence 100, fee 20, nothing held back.**

Then say what the seeded data already proves: one traveller in the seed was paid three times,
because a code is minted per ticket sold and the guarantee is one reward per *code*, not one per
user, ever.

### Act 4 — the publisher (2 min) · `publisher@demo.com`

1. **Partnerships** — accept Chaldal Fresh's pending request live. Then rule on Air Dhaka's
   repricing: accept it and the rate changes; decline and the agreed rates stand.
2. **Earnings** — what has been earned, campaign by campaign, and the withdrawal already queued.
3. **Settings** — the destinations every scan follows, and *Rotate key*: the old key stops
   earning the moment it lands.

### Act 5 — the admin (2 min) · `admin@qrreward.local`

1. **Overview** — 17 aggregates, platform revenue (the retained cut), `ledger_balanced: true`
   and `balances_reconciled: true`. Those two are the "the books are not lying" check.
2. **Notifications** — everything the tenants did: funding, repricing, a voided code, the
   withdrawal request. Acknowledge them; the audit log keeps them forever regardless.
3. **Withdrawals** — pay the queued request. Watch it move through the ledger.
4. **Campaigns → kill** a campaign to show it ends and voids every code in one shot (do this on
   *Eid getaway*, not the live one, if you still need the demo afterwards).

---

## 4. Test checklist

Run through this before demoing. Each row is a thing to do and what should happen. The scan
URLs are the ones the seeder printed; `$PUB` is the publisher API key, `$PRO` the promoter's.

### Automated first

```bash
pnpm test          # backend unit + frontend unit + the full e2e suite against the running stack
```

`./e2e-test.sh` alone is the end-to-end business loop — 100+ assertions over real HTTP.

### Scans

| Do | Expect |
|---|---|
| Open the acquisition `/r/…` on Android | 302 to `play.google.com/…&referrer=…qrm_claim=…` |
| Open it on an iPhone | hand-off screen for ~1s, then the App Store — no code shown anywhere |
| Open it on a laptop | 302 to the publisher's landing page |
| Open the **voided** code the seeder printed | `/campaign-ended?reason=voided` |
| Find a code on the **paused** campaign (Eid) and scan it | `reason=paused` |
| Same on the **ended** campaign (Ramadan teaser) | `reason=ended` |
| Reload one scan URL 31 times inside a minute | `reason=rate_limited` on the last few |
| View source on the hand-off screen | one inline script under a nonce; no token, no code |

### Attribution (publisher-sim, or curl from §5)

| Do | Expect |
|---|---|
| Sign up with the referrer from an Android scan | `attributed: true`, `match_method: "referrer"`, `confidence: 100` |
| Sign up again with the **same** referrer | `attributed: false`, `already_claimed` — one install per scan |
| Sign up with **no** referrer and no signals | `attributed: false`, `no_match` (or `low_confidence`) |
| Guest signup, then Confirm | `fee: 10` then `fee_added: 40` → total 50 |
| Confirm the same attribution twice | second call: `status: "already_full"` — idempotent, not an error |
| Claim the same `publisher_user_ref` twice on one campaign | `replay: true`, and **no** second ledger entry |
| Claim an engagement code twice as the same user | `replay: true` |
| Claim that code as a **different** user | `attributed: false`, `already_claimed` — a forwarded screenshot is not a retry |
| Claim an engagement `code` against an acquisition campaign | `not_engagement` |

### Money

| Do | Expect |
|---|---|
| Admin overview | `ledger_balanced: true`, `balances_reconciled: true` |
| Sum the ledger in psql (§6) | exactly `0` |
| Promoter → fund a campaign twice with the same idempotency key | budget moves **once** |
| Publisher → request more than `withdrawable` | 400 naming what is actually available |
| Admin → pay the queued withdrawal | publisher balance drops, `external:payouts` credited, audited |
| Drain a campaign's budget, then scan its code | `reason=budget`; a signup mid-drain answers `budget_exhausted` and **does not** burn the scan |

### Isolation

| Do | Expect |
|---|---|
| Log in as `promoter2@demo.com` | sees none of Air Dhaka's campaigns, scans or fees |
| Call `/v1/issue` with the **publisher's** key | 401 — the two keys are not interchangeable |
| Call `/v1/attribution/claim` with the **promoter's** key | 401 |
| Rotate the publisher key, then reuse the old one | 401 immediately |
| Admin → suspend an org, then try to log in as it | `account suspended`, session dies on next request |

---

## 5. Server-to-server calls

The publisher's backend and the promoter's booking system, as curl. `pnpm seed` prints both keys.

```bash
PUB=pk_devdevdevdevdevdevdevdevdevdevdevdevdevdevdevdev   # publisher — earns fees
PRO=pk_…                                                   # promoter — mints transaction codes
API=http://localhost:4000
```

**Android, the deterministic path.** Scan, grab the referrer out of the redirect, then bind the
install and claim the signup:

```bash
CODE=…                       # from the seeder output
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' \
  -H 'user-agent: Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36' \
  -H 'x-forwarded-for: 203.0.113.9' "$API/r/$CODE")
REF=$(printf '%s' "$LOC" | sed -n 's/.*referrer=//p' | python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))')

INSTALL=$(curl -s -XPOST $API/v1/attribution/first-open -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' -d "{\"install_referrer\":\"$REF\",\"platform\":\"android\"}")
echo "$INSTALL"          # → install_id, confidence 100, match_method referrer

ID=$(printf '%s' "$INSTALL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["install_id"])')
curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' \
  -d "{\"install_id\":\"$ID\",\"publisher_user_ref\":\"user_demo_1\",\"identified\":false}"
# → fee 10, pending_fee 40, confirm_deadline …
```

**Release the held-back part:**

```bash
curl -s -XPOST $API/v1/attribution/<attribution_id>/confirm -H "Authorization: Bearer $PUB"
# → fee_added 40, status confirmed
```

**Mint a transaction code (the promoter's booking system), then reward the purchase:**

```bash
CAMP=…   # the engagement campaign id, from the portal or GET /v1/campaigns
curl -s -XPOST $API/v1/issue -H "Authorization: Bearer $PRO" -H 'content-type: application/json' \
  -d "{\"campaign_id\":\"$CAMP\",\"issued_ref\":\"PNR-DEMO-1\"}"
# → code, scan_url, replay:false. Call it again with the same issued_ref → replay:true, same code.

curl -s -XPOST $API/v1/attribution/claim -H "Authorization: Bearer $PUB" \
  -H 'content-type: application/json' -d '{"code":"<code>","publisher_user_ref":"traveller_9"}'
# → kind engagement, match_method code, fee 20, pending_fee 0
```

(The code has to have been scanned at least once — open its `scan_url` first.)

---

## 5b. Seeding a deployed environment

`pnpm seed` targets `http://localhost:4000` unless told otherwise. Pointing it at a deployment
works, and four things change — the seeder handles each, but it needs telling:

```bash
API=https://api.yourhost.com \
WEB=https://app.yourhost.com \
SEED_CONFIRM=api.yourhost.com \
ADMIN_EMAIL=… ADMIN_PASSWORD=… \
PAYMENT_WEBHOOK_SECRET=… \
SEED_DB_URL=postgres://user:pass@host:5432/db \
pnpm seed
```

| Why each one | |
|---|---|
| `SEED_CONFIRM` | It refuses any non-localhost target until you name the host back. This writes ~200 rows into a live system and does not delete anything. |
| `WEB` | The publisher's landing page and App Link. A localhost URL here means every scan from a real phone dies. |
| `ADMIN_*` | Production gates publishers (`AUTO_APPROVE_PUBLISHERS` off). The seeder logs in as admin and approves the two it creates; without this it stops before the partnership step. |
| `PAYMENT_WEBHOOK_SECRET` | Production turns off direct funding (`ALLOW_SELF_FUNDING`), so budgets arrive the way they really do: a checkout row completed by a signed webhook. Without it there is no budget and nothing pays. |
| `SEED_DB_URL` | Optional. Backdating is SQL, run through the local `qrreward-db` container's psql against whatever URL you give it. Omit and every row is dated today. |

Two differences to expect in the data:

- **Slower.** Your `X-Forwarded-For` is not trusted behind a load balancer, so all this traffic
  arrives from one address and the real ceilings apply — 30 scans/min. The seeder paces itself
  to ~2.5s per scan (`SEED_GAP_MS` to tune), so a full run is ~6 minutes.
- **No iOS fingerprint matches.** The scan is stored against the address the API saw (yours),
  while first-open reports the simulated handset's — two different hashes. Remote runs convert
  on the Android referrer path only, and the iOS scans stay honestly unconverted.

---

## 6. Reset & troubleshooting

```bash
pnpm db:reset && pnpm seed     # clean world, new codes, same logins
```

| Symptom | Cause |
|---|---|
| `no API at http://localhost:4000` | `pnpm dev` is not running |
| Seeder says it could not backdate | Docker/psql unreachable — data is fine, every row is just dated today |
| A scan answers `rate_limited` | 30 scans/min per IP. Wait a minute, or scan from another device |
| A scan answers `no_destination` | the publisher has no Play package / App Store id / landing URL registered |
| Re-running `pnpm seed` | adds a second set of campaigns; reset first for a clean walkthrough |

Useful psql:

```bash
docker exec qrreward-db psql -U qrreward -tAc "select coalesce(sum(amount),0) from ledger_entries"      # must be 0
docker exec qrreward-db psql -U qrreward -tAc "select account, balance from account_balances order by 1"
docker exec qrreward-db psql -U qrreward -tAc "select kind, match_method, count(*) from redemptions group by 1,2"
```
