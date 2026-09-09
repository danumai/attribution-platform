# QR Reward Platform — Client Overview

A high-level introduction to what the platform does, who it is for, and how the pieces
fit together. No code, no infrastructure detail — the technical companion documents
([README.md](README.md), [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), [USER_GUIDE.md](USER_GUIDE.md))
cover those.

---

## In one sentence

A brand pays an app for real users. A QR code is the bridge — the scan is tied back to
the install afterwards, server-to-server, and the brand only pays when the acquisition
(or repeat purchase) is proven.

---

## The problem it solves

Brands (airlines, retailers, event organisers) want to drive installs and repeat purchases
into partner apps (streaming services, marketplaces, publishers). Two things get in the way:

1. **App store rules.** Neither Apple nor Google allow a QR code to hand the phone anything
   redeemable. The reward has to be granted after the fact.
2. **Trust.** The brand will not pay for installs it cannot verify. The app will not accept a
   deal it cannot audit.

The platform sits between the two parties and answers a single question honestly:
**was this install (or purchase) the result of that scan?** When the answer is yes, it moves
money — once, in one direction, with a full audit trail.

---

## Who uses it

| Role | What they do on the platform |
|---|---|
| **Promoter** (the brand paying) | Runs campaigns, prints QR codes, funds a budget, sees where scans convert |
| **Publisher** (the app being paid) | Approves partnerships, integrates one API call, receives payouts |
| **End user** | Scans a QR, lands on the app's store listing, installs, signs up — no account on the platform itself |
| **Super admin** (platform operator) | Approves publishers, releases payouts, resolves disputes, audits the ledger |

---

## Two campaign modes

A campaign is one of two types, chosen at creation and fixed for its lifetime.

### Acquisition — pay per new user

The classic use case: a poster in an airport, a flyer at an event, a code on packaging.
Anyone can scan it, and the promoter pays once per new user who signs up in the publisher's
app.

- Two-tier pricing: a **guest rate** paid on install, and a higher **full rate** released
  once the user completes the publisher's own verification.
- One payout per user per campaign, ever — enforced at the database, not by convention.

### Engagement — pay per transaction

For repeat purchases: a code on every boarding pass, receipt, or in-app confirmation. Each
code is minted by the promoter's own system, single-use, and pays a fixed rate on redemption.

- One payout per issued code.
- Works for known customers, not just new ones.

A promoter can run both campaign types side-by-side. The reporting keeps them separate.

---

## Core deliverables

What the client receives as part of the platform.

### 1. Promoter portal (web)
- Signup, login, organisation profile.
- Partnership requests to publishers.
- Campaign creation (acquisition or engagement mode), funding, pause, archive.
- QR designer with live preview: colours, size, quiet zone, error correction, logo,
  print-ready SVG and PNG export.
- Per-code controls: expiry, usage cap, void.
- Analytics: scans, installs, verified conversions, spend, budget remaining.

### 2. Publisher portal (web)
- Signup, login, organisation profile (admin-approved before going live).
- Partnership approval and rate negotiation.
- API key issuance and rotation.
- Earnings dashboard, pending clawback window, withdrawal requests and history.

### 3. Super admin portal (web)
- Cross-tenant view of every organisation, partnership, campaign, QR code, scan, redemption,
  and payout.
- Publisher approval queue.
- Withdrawal approval queue.
- Organisation suspension, API key rotation, campaign kill switch, code override.
- Ledger integrity view; every admin action written to an audit log.

### 4. Attribution API (server-to-server)
- Public scan redirect endpoint (`GET /r/:code`).
- Attribution claim endpoint for publishers (`POST /v1/attribution/claim`).
- Guest-tier confirmation endpoint (`POST /v1/attribution/:id/confirm`).
- Engagement code issue endpoint for promoters (`POST /v1/issue`).
- Payment provider webhook for funding (`POST /v1/payments/webhook`).
- Swagger UI at `/docs`, generated from live controllers.

### 5. Attribution engine
- Server-to-server matching of scan ↔ install via opaque claim id.
- Android: Play install referrer.
- iOS: App Clip shared container or pasteboard.
- Per-user-per-campaign uniqueness enforced at the database.
- Fraud controls: rate limits, per-IP and per-account throttles, code voiding.

### 6. Ledger and money movement
- Double-entry ledger; every movement is two matching rows.
- Automated integrity sweep every 10 minutes with webhook alerting on drift.
- Configurable platform fee, snapshotted per partnership.
- Configurable settlement (clawback) window before withdrawals release.
- Payment provider integration contract (checkout + signed idempotent webhook).

### 7. Publisher simulator
- Stand-in publisher app for end-to-end testing without a real integration partner.
- Used in the demo walkthrough and the automated test suite.

### 8. Documentation
- `README.md` — run, deploy, configure.
- `SYSTEM_DESIGN.md` — engineering view, architecture, data model, security.
- `SYSTEM_FLOW.md` — product narrative, publisher integration guide, security model.
- `USER_GUIDE.md` — role-by-role portal walkthrough.
- `DEMO.md` — scripted end-to-end walkthrough.
- `CLIENT_OVERVIEW.md` — this document.

### 9. Operational tooling
- Docker Compose for local dev and production.
- Prisma migration history (schema is source of truth, no boot-time DDL).
- Seed script for demo data (skipped in production).
- Health check endpoint for load balancers.
- Graceful shutdown draining in-flight attributions.
- Rate limiting backed by Redis when configured, in-process otherwise.

### 10. Test suite
- Unit tests + typecheck + lint (`pnpm check`) — no database, no server, safe to run pre-push.
- 167-assertion end-to-end suite covering full loop, reward tiers, code bounds, security,
  fraud, ledger integrity, admin portal.

---

## The end-to-end flow

```
Promoter designs QR   →   Prints or embeds it   →   End user scans
                                                            ↓
                                             Redirect to app store / app
                                                            ↓
                                             User installs and signs up
                                                            ↓
                                     Publisher's app tells the platform
                                                            ↓
                     Platform matches scan ↔ install, moves the money
                                                            ↓
                             Both sides see it on their dashboard
```

Everything from "user scans" to "money moves" is server-to-server. The user's phone never
carries anything spendable — the app store rules and the money rules are both respected
because of this.

---

## What the promoter gets

- **Campaign portal** — create, fund, pause, or archive campaigns.
- **QR designer** — colours, size, logo, error correction, print-ready SVG or PNG.
- **Live analytics** — scans, installs, verified conversions, spend, budget remaining.
- **Budget controls** — top up when needed; the platform refuses to overspend.
- **Code controls** — set expiry, cap the number of uses, void a lost or stolen print run.

## What the publisher gets

- **One API endpoint** to integrate — every scan resolves to the same call.
- **Approval workflow** — the publisher chooses which promoters to partner with.
- **Payout dashboard** — earnings, pending clawback window, withdrawal history.
- **Withdrawals on demand** — request a payout; the platform releases funds after the
  settlement window.

## What the admin gets

- **Cross-tenant view** — every organisation, partnership, campaign, scan, and payout.
- **Ledger integrity checks** — automated, every ten minutes, alerts on any drift.
- **Overrides** — suspend an organisation, rotate an API key, adjust a budget, kill a
  campaign, extend a code — each action audited.
- **Approvals** — new publishers and withdrawal requests both pass through admin.

---

## How trust is built in

- **Double-entry ledger.** Every money movement is two matching rows — funds in, funds out —
  and it is impossible for the totals to disagree. A background sweep verifies this every
  ten minutes.
- **Settlement window.** Payouts stay unwithdrawable for a configurable period (default 14
  days), giving fraud review time to work.
- **Neither party can move money alone.** Money in requires a signed webhook from the
  payment provider. Money out requires an admin to release it.
- **Per-user, per-campaign uniqueness.** A new user can only be paid for once per campaign,
  enforced at the database, not in application code.
- **Full audit trail.** Every admin override, every code change, every payout is recorded
  and queryable.

---

## What the platform does *not* do

- It does not hold the end user's identity — that lives with the publisher.
- It does not process card payments directly — it integrates with a payment provider.
- It does not decide what the reward is inside the publisher's app — it only proves the
  attribution and pays the marketing fee.
- The QR code itself carries nothing valuable. Reprinting a lost sheet is cheap; a leaked
  print run cannot be redeemed against a different campaign.

---

## The money model

- Promoter tops up a campaign budget through a payment provider.
- Each proven install or transaction debits the campaign budget and credits the publisher.
- The platform takes a configurable percentage (default 10%) of each payout as its fee.
- Publisher withdrawals are released by the admin after the settlement window closes.
- All rates on a partnership are locked in at the time of agreement — a platform-wide fee
  change never reprices a deal already in flight.

---

## What integration looks like for a publisher

One HTTP call, one API key. The publisher's backend tells the platform:

> "This user just signed up (or made a purchase) after scanning this code."

The platform responds with whether the attribution counted, and how much was paid. If the
signup was a guest tier, a follow-up call confirms the full-tier release once the publisher
verifies the user's identity themselves.

Full integration detail is in the publisher integration guide (see SYSTEM_FLOW.md Part II).

---

## Deployment model

- Self-hosted or managed. Runs as a set of containers: web portal, API, database.
- Standard requirements: PostgreSQL, HTTPS, a payment provider account.
- Horizontal scaling supported; rate limits and attribution locks work correctly across
  multiple instances.
- Health check endpoint, graceful shutdown, and alert webhook wiring built in.

---

## Where to go next

| You want to… | Read |
|---|---|
| Run the platform locally | [README.md](README.md) |
| Walk through the product as a user | [DEMO.md](DEMO.md) and [USER_GUIDE.md](USER_GUIDE.md) |
| Understand the engineering | [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) |
| Integrate as a publisher | SYSTEM_FLOW.md Part II |
