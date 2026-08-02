# Publisher Integration Guide

How to connect your app to the QR Reward Platform, end to end, in production.

**Audience:** the backend engineer at a publisher (a content app, a game, a wallet) who wants
promoters to drive real signups and get paid per signup.

**Time to integrate:** ~1 hour on Android, ~30 minutes more for iOS.

---

## 1. What this platform actually does

A promoter (an airline, a bank, a retailer) prints a QR code. Someone scans it, lands on your
store listing, installs your app, and signs up. This platform tells you **whether that signup
traces back to a promoter's QR code** — and if it does, moves a marketing fee from the
promoter's funded budget to your account.

Two things this platform deliberately does **not** do:

- **It never tells your app to give a user coins.** You decide what a new user gets, under
  your own new-user policy, funded by your own free-grant allowance. The `bonus_label` field
  is just a label describing *your* bonus, echoed back for your logs and the promoter's QR
  artwork. It is never an instruction.
- **It never puts anything spendable on the device.** A scan hands the phone one thing: a
  store listing URL. No token, no code, no claim the app could read and redeem.

That second point is structural, not cosmetic, and it is why this integration is safe to ship:

> App Store Review Guideline 3.1.1 forbids apps using "their own mechanisms to unlock content
> or functionality, such as license keys, augmented reality markers, QR codes". Google Play
> restricts virtual currency to the app it was bought in.

Because attribution happens server-to-server *after* the install — exactly like any mobile
measurement partner — there is no code path where a QR code unlocks anything in your app.

### The money vocabulary

| Term | Means |
|---|---|
| **fee** | Platform credits paid **to you** by the promoter, per attributed signup. This is your revenue. |
| **coins / bonus** | Whatever *you* give the end user. This platform never moves these and never sees them. |
| **coin_rate** | The full fee for an identified signup. Agreed per partnership. |
| **guest_rate** | The smaller fee paid up front when the signup is not yet identified. |
| **grace_days** | How long you have to confirm an identification and collect the remainder. |

---

## 2. The flow, in one picture

```
  Promoter prints QR ──► user scans
                            │
                            ▼
              GET /r/{code}  (our server)
                            │
             ┌──────────────┴──────────────┐
             │                             │
        Android                          iOS
   Play listing +                   App Store listing
   referrer=…qrm_claim=X            (no payload exists)
             │                             │
             ▼                             ▼
        user installs, opens your app, signs up
             │                             │
             ▼                             ▼
    your app reads the            your server notes the
    Play Install Referrer         device IP at first open
             │                             │
             └──────────────┬──────────────┘
                            ▼
        YOUR SERVER ──► POST /v1/attribution/claim
                            │
                            ▼
              { attributed: true, fee: 50, … }
                            │
                            ▼
              you grant your own new-user bonus
              (your decision, your policy)
```

---

## 3. One-time setup

### 3.1 Create your publisher account

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

### 3.2 What each field controls

| Field | Effect |
|---|---|
| `android_package` | Android scans → `play.google.com/store/apps/details?id=<this>`. Required for the deterministic match path. |
| `ios_app_id` | iOS scans → `apps.apple.com/app/id<this>`. Numeric App Store id only. |
| `landing_url` | Fallback for desktop scans and platforms you have not registered. HTTPS only. |
| `bonus_label` | Free text describing *your own* joining bonus, e.g. `"100 free coins"`. Appears on promoter QR artwork and in your logs. |

Change any of them later with `PATCH /v1/orgs/me` (session token, not API key).

### 3.3 Accept a partnership

A promoter proposes terms; you accept. Nothing runs until you do.

```bash
# See what's waiting
curl https://api.example.com/v1/partnerships -H "Authorization: Bearer $SESSION_TOKEN"

# Accept — check coin_rate / guest_rate / grace_days first
curl -X POST https://api.example.com/v1/partnerships/$ID/accept \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

The promoter then creates campaigns, funds them, and prints QR codes. You do nothing further
until users start arriving.

---

## 4. Android — the deterministic path

Play's Install Referrer survives the install, so the claim id rides along in it and the match
is exact. **Always prefer this path when a referrer is available.**

### 4.1 In your app: read the referrer at first open

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

### 4.2 On your server: claim at signup

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

---

## 5. iOS — the fingerprint fallback

There is no install-referrer channel on iOS. Nothing can survive the App Store transition, so
the match is necessarily probabilistic: the coarse device signals seen at scan time are
re-presented at first open and matched inside a short window.

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

Window: `FINGERPRINT_WINDOW_MIN`, default **60 minutes**. Short on purpose — under
carrier-grade NAT a whole neighbourhood can share one address, and the window is the main
control on false matches. Call `/claim` promptly at signup rather than batching it overnight.

**Expect a lower match rate on iOS than Android.** That is inherent to the platform, not a bug
in the integration.

---

## 6. The response

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

Note that **`attributed: false` never means "reject this signup"**. The user signed up; that
happened regardless of who gets paid for it.

---

## 7. The two-tier payout

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

---

## 8. Retries and idempotency

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

---

## 9. Production checklist

**Never call this API from the app.** The key must live server-side only. A key in a binary is
a key an attacker extracts and a payout an attacker controls.

- [ ] **API key in a secret manager**, not in source, not in an env file in the repo.
- [ ] **Rotate on any suspicion** — `POST /v1/api-keys/rotate` invalidates the old key instantly.
- [ ] **Never block signup on this call.** Wrap it in a try/catch and a short timeout (2–3s).
      If it fails, the user still signs up; enqueue the claim and retry. Your conversion funnel
      must not depend on our uptime.
- [ ] **Retry with backoff** on 5xx and timeouts. Retries are safe (§8).
- [ ] **Call at signup, not in a nightly batch.** The iOS fingerprint window is 60 minutes.
- [ ] **Pass the real client IP** on iOS (§5).
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

---

## 10. Testing the integration

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

Things worth asserting in your own test suite:

- A second `/claim` with the same `publisher_user_ref` returns `replay: true` and the same
  `attribution_id`.
- An unknown referrer returns `attributed: false, reason: "no_match"` — and your signup still
  completes.
- A `401` does not break signup.

`e2e-test.sh` in this repo runs the full loop, including both match paths, against a local
stack if you want a reference implementation.

---

## 11. Endpoint reference

Full schemas: `openapi.yaml`, or the live Swagger UI at `/docs`.

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

## 12. Support

- End-to-end narrative of the whole system: `SYSTEM_FLOW.md`
- Machine-readable spec: `openapi.yaml` · live at `/docs`
- Health probe: `GET /healthz`
