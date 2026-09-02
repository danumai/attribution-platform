# DEMO.md — the manual walkthrough

**NovoAir** prints a QR on a boarding pass. **BanglaReels** is the short-video app it wants
passengers to install. This platform sits between them, decides who earned what, and moves the
money. This file is every step of that, by hand, in order.

Nothing here is scripted. Each step says **who** you are, **where** you do it, **what to do**,
and **what you should see**. Do them in order — each one leaves the state the next one needs.

> Want the whole thing built for you instead of by hand? `pnpm run seed` does exactly this and
> prints the logins, keys and scan URLs at the end. Read that as the executable version of this
> file. **Check which database it will hit first** — see step 0.

| Cast | Who they are | How they act |
|---|---|---|
| **NovoAir** | promoter — the airline. Pays for users. | dashboard + a server API key |
| **BanglaReels** | publisher — the app. Gets paid for users. | dashboard + a server API key |
| **Super admin** | the platform operator | `/admin` |
| **The passenger** | scans the boarding pass | a browser window |

**The one sentence to open with:** *the QR code unlocks nothing.* It carries no coupon and no
token. It opens an app-store listing, and the install is tied back to the scan afterwards,
server to server — the way ad networks do it. Every rule below follows from that.

---

## 0. Before you start

**Check which database you are about to demo against.** This bites:

```bash
grep '^DATABASE_URL' .env
```

If that is a hosted URL (Railway, Neon, RDS), then `pnpm dev`, `pnpm seed` and `pnpm test` all
write to it — including the e2e suite, which offboards tenants and floods the rate limiter. For
a local demo, point `.env` at the container and keep the hosted URL in `.env.production`:

```
DATABASE_URL=postgresql://qrreward:qrreward@localhost:5436/qrreward
```

Then bring it up:

```bash
pnpm check     # lint, typecheck, unit tests — must pass before you demo anything
pnpm run dev   # db + api + web, one terminal, Ctrl-C stops all of it
```

You should have:

| | |
|---|---|
| API | http://localhost:4000 (Swagger at `/docs`) |
| Web | http://localhost:3000 |
| Admin | `admin@qrreward.local` / `admin12345` — seeded at boot, never through signup |

Keep a terminal open for the two machine calls. Set these once:

```bash
API=http://localhost:4000
ANDROID='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
```

**Use two browser profiles** (or one normal + one private). NovoAir and BanglaReels are logged
in at the same time throughout, and a single profile makes you log out and back in constantly.

---

## Act 1 — Two companies sign up

### Step 1.1 · BanglaReels creates its account

**Who:** BanglaReels **Where:** http://localhost:3000/login → *Create an account*

| Field | Value |
|---|---|
| Account type | **Publisher** — an app that gets paid for new users |
| Company | `BanglaReels` |
| Email | `banglareels@demo.com` |
| Password | `password123` |
| Web fallback | `http://localhost:3000/publisher-sim` |

**You see:** a one-time screen showing a `pk_…` **API key**. This is shown once, ever.

**Copy it now.** Call it `PUB_KEY`. In your terminal:

```bash
PUB_KEY=pk_...paste...
```

> **Say this:** that key is how BanglaReels' *server* talks to us. It asks one question —
> "was this new user attributable?" — and it is what earns the fee. It is never in the app,
> never in a browser, never in the QR.

If you lose it: Dashboard → **Settings** → *Rotate API key*. The old one dies instantly.

### Step 1.2 · The admin approves BanglaReels

**Who:** Super admin **Where:** log in at `/login` → you land on `/admin` → **Organizations**

Find BanglaReels. Status reads **pending**. Click **Approve**.

> **Say this:** a publisher *receives money*, so in production a human looks first. Until
> approved it is hidden from the directory and cannot be partnered with — so it can never be
> paid. (In dev, `AUTO_APPROVE_PUBLISHERS=true` does this for you and the status is already
> active. Show the screen anyway; it is the production gate.)

### Step 1.3 · NovoAir creates its account

**Who:** NovoAir **Where:** second browser profile → `/login` → *Create an account*

| Field | Value |
|---|---|
| Account type | **Promoter** — a brand that pays for new users |
| Company | `NovoAir` |
| Email | `novoair@demo.com` |
| Password | `password123` |

**You see:** a `pk_…` key again. Copy it:

```bash
PRO_KEY=pk_...paste...
```

> **Say this:** the airline gets a key too, and it is the *opposite* credential. BanglaReels'
> key asks to be paid. NovoAir's key mints one code per ticket sold and *spends*. Neither
> opens the other's door — swap them and you get a 401.

No approval step: promoters pay in, so they gate themselves with their own budget.

---

## Act 2 — BanglaReels says where scans go, and what it gives people

**Who:** BanglaReels **Where:** Dashboard → **Settings**

### Step 2.1 · Where scans go

| Field | Value |
|---|---|
| Google Play package | `com.banglareels.app` |
| App Store id | `1571484032` |
| Web fallback | `http://localhost:3000/publisher-sim` |
| App link (repeat-purchase campaigns) | `http://localhost:3000/publisher-sim` |

Click **Save**.

> **Say this:** these are the publisher's own destinations. A scan goes straight to the store
> listing. On a repeat-purchase campaign it goes to the App Link instead, so the *operating
> system* opens the app when it is installed and falls back to the store when it isn't — that
> is a question no server can answer, and both platforms already answer it correctly, offline.

*(The **App Clip** block below it is the iPhone carrier. Skip it for a first demo; mention that
Android carries attribution across an install by itself and iPhone needs either an App Clip or
the clipboard hand-off.)*

### Step 2.2 · What BanglaReels gives the user

Under **What you give the user**, add two offers:

| Wording | Kind | Value | Unit | Granted on |
|---|---|---|---|---|
| `100 free coins` | `coins` | `100` | `coins` | acquisition |
| `7 days of premium` | `subscription` | `7` | `days` | engagement |

**Save.**

> **Say this, it is the compliance argument:** the platform never issues or fulfils these.
> BanglaReels grants them, out of its own pocket, under its own new-user policy. We record the
> wording so the artwork can print it, and we echo the kind back so their app knows what to
> grant. There is no code path here that could unlock anything inside their app.

---

## Act 3 — The deal

### Step 3.1 · NovoAir asks

**Who:** NovoAir **Where:** Dashboard → **Partnerships** → *Request a partnership*

| Field | Value | Means |
|---|---|---|
| Publisher | BanglaReels | from the approved directory |
| Coins per verified signup | `50` | a signup the app vouched for |
| Coins per guest signup | `10` | unverified — paid up front |
| Grace days | `7` | how long the held-back `40` can still be claimed |
| Coins per repeat purchase | `20` | its own price, unrelated to the two above |

**You see:** status **pending**. Nothing can spend yet.

### Step 3.2 · BanglaReels accepts

**Who:** BanglaReels **Where:** Dashboard → **Partnerships** → **Accept**

**You see:** status **active**, on both dashboards.

> **Say this:** rates are a two-sided agreement. The airline can *propose* a change later, but
> nothing pays out at proposed numbers — the live rates keep paying until the publisher
> accepts. The platform's cut (10% by default) is snapshotted onto this row right now, so
> changing the global rate later never reprices a deal already agreed.

---

## Act 4 — Campaign one: paying for new passengers

**Who:** NovoAir **Where:** Dashboard → **Campaigns** → *New campaign*

| Field | Value |
|---|---|
| Partnership | BanglaReels — 50 coins/signup |
| Campaign name | `Inflight entertainment — Q3` |
| What this campaign pays for | **New signups — one payout per person, ever** |
| The reward this campaign promises | tick **100 free coins** |
| Starting budget | `5000` |

**Create campaign.**

> **Say this:** the reward list is the publisher's, and the promoter picks which of them *this*
> campaign advertises. A poster selling coins should not also be promising a free month of
> premium that nobody agreed to fulfil.

> **And this:** a campaign with no budget refuses every scan — the scanner is told the offer is
> claimed. We fail closed. The airline can never accidentally owe money it hasn't funded.

### Step 4.1 · Design the QR that goes on the boarding pass

Open the campaign → **Studio**. Change colours, size, quiet zone, error correction, drop in a
logo. Export **SVG** or **PNG** — that is the print-ready artwork.

**Copy the scan URL** shown with the code:

```bash
ACQ=http://localhost:4000/r/...paste-the-code...
```

---

## Act 5 — A passenger installs the app

This is the acquisition path end to end. Do it in a **third** window (private), as the passenger.

### Step 5.1 · The scan

A real Android phone scanning the poster gets redirected to the Play listing with an install
referrer attached. To see that from your desk, ask for the redirect as an Android phone:

```bash
curl -s -o /dev/null -w '%{redirect_url}\n' -A "$ANDROID" "$ACQ"
```

**You see:** a `https://play.google.com/store/apps/details?id=com.banglareels.app&referrer=…` URL.

Pull the referrer out of it — this is the only thing that crosses the install:

```bash
curl -s -o /dev/null -w '%{redirect_url}' -A "$ANDROID" "$ACQ" \
  | node -e "let u='';process.stdin.on('data',d=>u+=d).on('end',()=>console.log(new URL(u.trim()).searchParams.get('referrer')))"
```

**You see:** `utm_source=qrmarketer&utm_medium=qr&qrm_claim=<opaque id>`. Copy the whole thing,
`utm_` parts included — that is exactly the string Play hands the app.

> **Say this:** that is the entire payload. An opaque id naming a scan. It is not a coupon and
> it is worth nothing to the person holding it — it can only be spent by BanglaReels' server,
> using BanglaReels' key, once.

*(Open `$ACQ` in a plain desktop browser too, to show the other branch: no phone, no store, so
it falls through to the publisher's web page.)*

### Step 5.2 · The app opens, and the passenger signs up

**Where:** http://localhost:3000/publisher-sim — this page stands in for BanglaReels' app.

| Field | Value |
|---|---|
| API key | your `PUB_KEY` |
| Install referrer | the `qrm_claim=…` you just copied |
| Email | `passenger1@demo.com` |
| Verified | **leave unticked** |

**Sign up.**

**You see:** attributed, **10 coins** — the guest tier.

> **Say this:** the app has not vouched for this account yet, so the airline is charged the
> guest rate. The other 40 is held back for 7 days.

### Step 5.3 · The passenger verifies their number

Click **Confirm**.

**You see:** the remaining **40** released. Total 50.

> **Say this:** one signup, two payments, one guarantee — the partial unique index in the
> database means this user can never be paid for twice on this campaign, however many times
> either server retries.

### Step 5.4 · Show the honest answer too

Sign up again at the sim as `organic@demo.com`, with a referrer that is **well-formed but not
one of ours** — someone who found the app on their own:

```
utm_source=qrmarketer&utm_medium=qr&qrm_claim=AAAAAAAAAAAAAAAAAAAAAA
```

**You see:** `ORGANIC — this install was not attributable`, reason `no_match`.

*(Leaving the referrer box empty instead gives you a 400, not an organic answer: with no
referrer and no install id there is no question to ask, so the API refuses rather than
guessing. Worth knowing if you fat-finger it live.)*

> **Say this, it matters:** that is a **200, not an error**. The person signed up; that happened
> regardless of who gets paid. Most installs really are organic, and "we don't know" is the
> honest answer. A system that guessed here would be billing the airline for its own organic
> traffic.

---

## Act 6 — Campaign two: paying for repeat customers

The second product, and the one the airline actually cares about.

**Who:** NovoAir **Where:** Dashboard → **Campaigns** → *New campaign*

| Field | Value |
|---|---|
| Partnership | BanglaReels |
| Campaign name | `Boarding pass rewards` |
| What this campaign pays for | **Repeat purchases — one payout per transaction code you issue** |
| The reward | tick **7 days of premium** |
| Starting budget | `2000` |

Open it and copy the campaign id out of the URL:

```bash
ECAMP=...paste-the-uuid...
```

### Step 6.1 · The booking system mints a code for one ticket

This is the only step with no UI, on purpose — it is NovoAir's booking system calling us once
per ticket sold, at booking volume.

```bash
curl -s -XPOST $API/v1/issue -H "Authorization: Bearer $PRO_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"campaign_id\":\"$ECAMP\",\"issued_ref\":\"PNR-7X42QK\"}"
```

**You see:** `{ id, code, expires_at, issued_ref, scan_url, replay: false }`

```bash
TICKET1=<the scan_url>
```

> **Say this:** `issued_ref` is NovoAir's own booking reference. The only system that can know a
> purchase happened is the one that took the money — so the airline mints the proof, and pays
> when it is redeemed. The code is single-use and expires in 30 days.

### Step 6.2 · Prove a double-firing webhook cannot cost them twice

Run the **exact same command again**.

**You see:** the **same code**, `replay: true`.

> **Say this:** booking webhooks fire twice. That is normal, and it must never hand one
> passenger two rewards for one seat. A unique index in the database guarantees it — not a
> check in the handler.

### Step 6.3 · The passenger scans their boarding pass

Open `$TICKET1` in the passenger's window.

**You see:** you land on `/publisher-sim?qrm_code=…`. The code is already in the page.

Sign up / claim as **`passenger1@demo.com`** — the same person from Act 5.

**You see:** attributed, **20 coins**, kind **engagement**, match method **code**, confidence
**100**, and the **7 days of premium** offer — not the signup coins.

> **Say this:** there is no matching step here and no guessing. The code names a *purchase*,
> which is stronger evidence than any fingerprint naming a device. And no guest tier — a repeat
> customer already transacted with the airline, which is a harder fact than any verification
> the app could run.

---

## Act 7 — The headline: the same passenger flies again

Mint a code for their **next ticket** and repeat:

```bash
curl -s -XPOST $API/v1/issue -H "Authorization: Bearer $PRO_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"campaign_id\":\"$ECAMP\",\"issued_ref\":\"PNR-9M18ZZ\"}"
```

Open the new `scan_url`, claim as **`passenger1@demo.com` again**.

**You see:** attributed again. **20 more coins.** Budget 2000 → 1960.

> **Say this — this is the whole point of the demo:** acquisition pays for a person *once,
> ever*. Engagement pays per *purchase*. A passenger who flies eleven times a year earns the app
> eleven payouts, and the airline is happy to pay because each one is a ticket sold.

And show the fraud case. Claim the **same code** as a **different** person,
`someone-else@demo.com`:

**You see:** `attributed: false, reason: already_claimed`.

> **Say this:** that is a forwarded screenshot, not a retry. A retry by the same user replays the
> original answer; a second *person* gets nothing. The system can tell the difference.

---

## Act 8 — A refund

A passenger cancels. The boarding pass is already printed and the code still works.

```bash
curl -s -XPOST $API/v1/issue/void -H "Authorization: Bearer $PRO_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"campaign_id\":\"$ECAMP\",\"issued_ref\":\"PNR-9M18ZZ\"}"
```

**You see:** `voided: true`, and `redeemed: true` if it was already claimed in Act 7.

Now mint a **fresh** code, void it *before* anyone scans, then open its scan URL and try to
claim.

**You see:** `attributed: false`. Budget unchanged.

> **Say this:** a refund un-makes the purchase the code was minted against. The booking system
> knows the PNR, not our internal id, so it voids on its own reference. It is idempotent —
> refund webhooks fire twice too. And it is **not a clawback**: a code already paid stays paid,
> and we tell you so rather than letting you assume the void won the race.

Reconciliation, for the support call *"the customer says their code doesn't work"*:

```bash
curl -s "$API/v1/issue?campaign_id=$ECAMP&issued_ref=PNR-7X42QK" \
  -H "Authorization: Bearer $PRO_KEY"
```

**You see:** `voided`, `uses`, and `redeemed` — scanned? killed? already paid?

---

## Act 9 — The statistics

Now walk all three dashboards. Everything below is real, written by the steps above.

### 9.1 · NovoAir — what did the money buy?

**Dashboard → Overview:** budget across campaigns, spend, redemptions.

**Open a campaign:** scans, redemptions, coins granted, budget remaining, and the analytics
breakdown — country, city, device, OS, browser, language, referring host, over time.

> **Say this:** every one of those dimensions is read off the request at scan time. None of it
> feeds attribution — a missing value costs you a report bucket, never a payout. That
> separation is deliberate.

**Redemptions:** every payout, with how it was matched and at what confidence.

### 9.2 · BanglaReels — what did we earn?

**Dashboard → Overview:** earnings, what has cleared settlement, what is withdrawable.

**Redemptions:** the same events from the other side.

> **Say this:** earnings are not withdrawable the moment they are earned. There is a settlement
> window (14 days in production) — the clawback period that makes every accepted fraud risk
> bounded. It is set to 0 in dev so you can demo the payout.

### 9.3 · Super admin — is the platform sound?

**`/admin` → Overview:** platform-wide scans, redemptions, orgs, and **ledger integrity**.

> **Say this:** the ledger is append-only — enforced by a database trigger, not a convention.
> UPDATE and DELETE raise. Corrections are posted as compensating entries. Every payout splits
> into publisher net + platform cut and every reference sums to zero. This screen is that check,
> live.

Also worth showing: **Organizations** (suspend, approve, rotate a key, offboard),
**Notifications** (every tenant action lands here), **Audit log** (every privileged override,
with who and why), **Scans**, **Redemptions**, **QR codes**, **Ledger**.

---

## Act 10 — Money out

**Who:** BanglaReels **Where:** Dashboard → *Request payout* → request everything withdrawable.

**You see:** status **requested**. Check the admin ledger — **nothing has moved.**

**Who:** Super admin **Where:** `/admin` → **Withdrawals** → **Pay**.

**You see:** publisher debited, `external:payouts` credited, ledger still balances.

> **Close on this:** money cannot leave until the review window closes, and it leaves through
> one function that posts both sides of the entry. A new money path that forgot the platform's
> cut would have to route around that function to do it — which is why it lives in one place.

---

## If something doesn't do what this file says

| You see | It means | Do |
|---|---|---|
| `no_match` | no referrer, or the window expired | check you pasted the whole `qrm_claim=…` |
| `already_claimed` | that scan or code is already paid | mint a fresh code |
| `budget_exhausted` | campaign is out of coins | fund it — we fail closed by design |
| `campaign_not_active` | paused or ended after the scan | reactivate it |
| `not_engagement` | you sent a `code` from an acquisition campaign | use the engagement campaign id |
| `not_a_new_user` | the app said this account already existed | use a fresh email |
| 401 on `/v1/issue` | you used the publisher's key | use `PRO_KEY` |
| 401 on `/v1/attribution/*` | you used the promoter's key | use `PUB_KEY` |
| 429 anywhere | the per-IP ceiling; the e2e suite leaves it hot | wait a minute, or flush Redis |
| scan lands on `campaign-ended` | voided, expired, used up, or unfunded | the reason is in the URL |

**Start over clean:** `pnpm run db:reset` wipes the volume and re-migrates. Then either redo
this file, or run `pnpm run seed` to get the same world built for you in about four seconds.

---

## The five sentences, if you only have two minutes

1. The QR unlocks nothing — it opens a store listing, and attribution happens afterwards,
   server to server.
2. A scan is a *claim*, not a transaction.
3. Unattributed is a normal answer, and most installs are organic.
4. Acquisition pays for a person once ever; engagement pays per purchase, because only the
   airline can know a purchase happened.
5. The invariants are in the database — partial unique indexes, CHECKs, an append-only ledger
   trigger — so they hold under concurrency, not under code review.

**Further reading:** `README.md` (setup), `USER_GUIDE.md` (every flow and checklist),
`SYSTEM_DESIGN.md` (the design document), `/docs` (live Swagger), `e2e-test.sh` (all of this,
executable, as assertions).
