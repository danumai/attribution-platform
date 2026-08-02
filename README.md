# QR Reward Platform

Promoters (airlines, brands) run QR campaigns; end users scan, land on a publisher's store
listing (BanglaReels, DramaBox), install and sign up — and the promoter pays the publisher a
per-acquisition marketing fee.

The QR carries nothing redeemable. It opens a store listing, and the install is tied back to
the scan server-to-server afterwards — by Play's install referrer on Android, by a
short-window device match on iOS. That keeps it a measurement artifact rather than an unlock
mechanism, which is what App Store 3.1.1 forbids. See
[Figure 8](SYSTEM_FLOW.md#figure-8-why-the-qr-unlocks-nothing).

- **[openapi.yaml](openapi.yaml)** — full API reference (OpenAPI 3.0); paste into
  [editor.swagger.io](https://editor.swagger.io) for an interactive view
- **[SYSTEM_FLOW.md](SYSTEM_FLOW.md)** — how it works, plus every role's end-to-end flow with endpoints
- [qr-reward-platform-design.md](qr-reward-platform-design.md) — architecture doc

## Run

Needs Node 20+, pnpm 11+, and Docker. (`corepack enable` picks up the `packageManager`
field; otherwise `npm i -g pnpm`.)

```bash
cp .env.example .env   # dev defaults work as-is
pnpm install           # installs both workspaces
pnpm dev               # starts Postgres, API (:4000), and web (:3000)
```

`pnpm run dev` waits for the database, applies pending Prisma migrations, and runs both
servers in one terminal (Ctrl-C stops everything).

| Command | What |
|---|---|
| `pnpm run dev` | Full stack: db + api + web |
| `pnpm run db:migrate` | Create a migration after editing `backend/prisma/schema.prisma` |
| `pnpm run db:studio` | Browse the database in Prisma Studio |
| `pnpm run seed` | Demo promoter, publisher, funded campaign, QR — prints logins |
| `pnpm test` | Security self-check, then the end-to-end suite: full loop, reward tiers, code bounds, security, fraud, ledger integrity, admin portal |
| `pnpm run build` | Compile both workspaces for production |
| `pnpm start` | Run the compiled build (expects a configured environment) |
| `pnpm run db:reset` | Wipe the database volume and start clean |

## Try it in the browser

Run `pnpm run seed`, then sign in with the promoter login it prints.

1. **Promoter view** — the seeded campaign has a 5000-coin budget. Open **QR codes &
   stats** to design the QR: colors, size, quiet zone, error correction, logo. Save or
   download it as print-ready SVG.
2. **End user** — open the printed scan URL (`http://localhost:4000/r/{code}`) in a
   private window, or scan the QR with your phone. You land on the publisher sim.
3. Sign up there with any email, pasting the seeded API key into the form. Coins land.
4. **Both dashboards** now show the scan, the redemption, and the budget drawdown.

To build the whole thing by hand instead, sign up as a publisher (landing URL
`http://localhost:3000/publisher-sim`), sign up as a promoter in another browser profile,
request a partnership, accept it from the publisher tab, then create and fund a campaign.

## Super admin portal

Seeded on every boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default
`admin@qrreward.local` / `admin12345`) — never through signup. Sign in at `/login` and you
land on `/admin`: platform stats and ledger integrity, every org, partnership, campaign,
QR code, scan and redemption across all tenants, plus suspend/reinstate an org, rotate a
publisher's API key, override coin rates and campaign status, and adjust campaign budgets
(clawbacks included, still double-entry).

## Deploying

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export JWT_SECRET=$(openssl rand -hex 32)
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at least 12 chars'
export BASE_URL=https://api.example.com FRONTEND_URL=https://app.example.com
docker compose -f docker-compose.prod.yml up --build -d
```

Or without Docker: `pnpm run build && NODE_ENV=production pnpm start`, with the same variables set.

**The API refuses to boot** rather than start up subtly broken, if `JWT_SECRET` is still the
default, `BASE_URL`/`FRONTEND_URL`/`ADMIN_*` are unset, any of those URLs is not https, or
`ADMIN_PASSWORD` is under 12 characters. Each of those is either an auth bypass or an
unrecoverable mistake — see below.

| Setting | Why it matters |
|---|---|
| `BASE_URL` | Encoded into every QR as `${BASE_URL}/r/{code}`. Wrong value = reprint, not a redeploy. Set it before printing anything. |
| `FRONTEND_URL` | CORS allowlist, comma-separated; the first entry is used for scan redirects. |
| `JWT_SECRET` | Signs session tokens. `openssl rand -hex 32`. |
| `REFERRER_WINDOW_DAYS` | How long a Play install referrer stays claimable. Default 30, max 90. |
| `FINGERPRINT_WINDOW_MIN` | How long an iOS install can be device-matched to a scan. Default 60. Shorter = fewer false matches under carrier NAT. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded on **first boot only** in production — rotating the password in-app is not reverted by the next deploy. |
| `DATABASE_URL` | Append `?sslmode=require` for managed Postgres. |
| `TRUST_PROXY` | Set to `1` behind a load balancer, or `req.ip` is the proxy and every per-IP rate limit collapses into one bucket. |
| `NEXT_PUBLIC_API_URL` | Baked into the browser bundle at **build** time; setting it at runtime does nothing. |

Demo promoter/publisher tenants are skipped entirely when `NODE_ENV=production`.

Operational notes: `GET /healthz` checks the database and is what the load balancer should
poll. `SIGTERM` drains in-flight requests and closes the pool before exit, so a redeploy
cannot tear down a half-written attribution. The rate limiter is per-process — running more
than one instance needs the Redis swap noted in `common/security.ts`.

## Database

Prisma owns the schema. `backend/prisma/schema.prisma` is the source of truth; every change
goes through a migration in `backend/prisma/migrations/`, and the API container runs
`prisma migrate deploy` before it starts serving. The app never creates tables at boot.

```bash
pnpm run db:migrate       # edit schema.prisma first; writes a new migration + regenerates the client
pnpm run db:reset         # dev only: wipe the volume and replay every migration
```

Money-critical queries — `SELECT ... FOR UPDATE` on a balance row, the atomic QR use-claim,
the admin overview aggregate — stay as `$queryRaw`. Those are the paths where the exact SQL
*is* the correctness argument, and the query builder cannot express row locks or
column-to-column comparisons. Everything else uses the typed client.

CHECK constraints (`guest_rate <= coin_rate`, status enums) are not expressible in
`schema.prisma`, so they live at the bottom of the `0_init` migration. Prisma's differ
ignores them, so they survive future `migrate dev` runs rather than being dropped as drift.

An existing database created by the old boot-time `schema.sql` has no migration history.
For a dev database, `pnpm run db:reset` is the clean path; anything with real data needs
`npx prisma migrate resolve --applied 0_init` plus a manual diff against `0_init`, since the
old script used different index and constraint names.

## Layout

| Path | What |
|---|---|
| `pnpm-workspace.yaml` | Workspace members + which dependency install scripts are allowed to run |
| `docker-compose.yml` | Postgres 16 on :5436 (development) |
| `docker-compose.prod.yml` | Whole stack in production mode; secrets come from the environment |
| `.env.example` | Every setting, with what breaks if it is wrong |
| `backend/prisma/schema.prisma` | Data model — tables, indexes, relations |
| `backend/prisma/migrations/` | Migration history; money invariants live here (unique + CHECK constraints, append-only ledger) |
| `backend/src/config.ts` | Externally-visible URLs + production config guards, validated at boot |
| `backend/src/database/` | Prisma client + pool, ledger/audit helpers, boot-time account seeding |
| `backend/src/common/` | Cross-cutting: rate limiting, security headers, URL validation, QR render |
| `backend/src/modules/auth/` | Signup/login, session JWT, API keys, claim ids, `AuthGuard` / `AdminGuard` |
| `backend/src/modules/partner/` | `POST /v1/attribution/claim` — the money path, one DB transaction |
| `backend/src/modules/public/` | `GET /r/:code` scan redirect + QR image render |
| `backend/src/modules/portal/` | Portal API — partnerships, campaigns, funding, QR CRUD |
| `backend/src/modules/admin/` | Admin API — cross-tenant reads + overrides, `AdminGuard` |
| `frontend/app/admin` | Super admin portal (tabbed: orgs, campaigns, scans, ledger) |
| `frontend/app/campaigns/[id]` | QR designer with live preview |
| `frontend/app/publisher-sim` | Stand-in publisher app; `app/api/sim-signup` is its backend |

## Reward tiers (guest vs identified)

Everyone can redeem; only an identified subscriber gets full value. A partnership carries a
`guest_rate`, a `coin_rate` (full tier), and `grace_days`.

- `POST /v1/attribution/claim` takes `identified: boolean` — the publisher asserting the
  user cleared *its own* verification bar. Omitted means guest tier: the promoter never pays
  full price for an unverified install.
- A guest attribution returns `pending_fee` and a `confirm_deadline`.
- `POST /v1/attribution/:id/confirm` releases the held-back delta once the user verifies.
  It is idempotent and refuses after the grace window, so nobody is paid twice.

Publishers integrating against this: see **[PUBLISHER_INTEGRATION.md](PUBLISHER_INTEGRATION.md)**.

## Code time and usage bounds

Codes are time-bound by default (30 days) and can be usage-bound per code.

| Control | Set by | Where |
|---|---|---|
| `expires_in_days` (default 30, `0` = never) | Promoter, at creation | `POST /v1/campaigns/:id/qr-codes` |
| `max_uses` (default unlimited, `1` = single-use) | Promoter, at creation | same |
| Void a code (lost/stolen print run) | Promoter | `POST /v1/qr-codes/:id/void` |
| Extend expiry, lift usage limit, un-void | **Admin only**, audited | `PATCH /v1/admin/qr-codes/:id` |
| Kill a campaign and void all its codes | Admin | `POST /v1/admin/campaigns/:id/kill` |

Promoters can tighten their own codes but never loosen them — loosening a money control is an
admin override and lands in `GET /v1/admin/audit-log`. A blocked scan redirects to
`/campaign-ended?reason=…` and the user is told which case they hit, not shown a dead end.

## Security posture

| Control | Where |
|---|---|
| Suspension/offboarding kills live sessions immediately (not at JWT expiry) | `modules/auth/auth.guard.ts` `AuthGuard` |
| `POST /v1/admin/orgs/:id/offboard` — suspend + revoke API key + end campaigns | `modules/admin/admin.controller.ts` |
| Landing URLs restricted to https (http for localhost only) — no `javascript:`/`data:` redirect XSS, no cleartext scan-token exfil | `common/security.ts` `validateLandingUrl` |
| CSP `default-src 'none'` + `nosniff` on every response, which neuters script inside rendered SVG logos | `common/security.ts` `securityHeaders` |
| Rate limits on login (per IP *and* per account), signup, scan, and QR rendering | `common/security.ts` `rateLimited` |
| Refuses to boot in production with a default `JWT_SECRET`, a weak admin password, or non-https URLs | `modules/auth/tokens.ts`, `config.ts` |
| Demo tenants never seeded, and the admin password never reset by a redeploy, in production | `database/seed.ts` `seedAccounts` |
| 96-bit unguessable codes | `modules/auth/tokens.ts` `newShortCode` |

## What the design doc has that this build doesn't

Redis (in-memory rate limiter instead), BullMQ workers + outbound webhooks, HMAC request
signing and idempotency keys on the Partner API, PSP checkout (funding is a direct ledger
credit), settlement statements, multi-user orgs with RBAC roles. Marked with `ponytail:`
comments where the shortcut is in the code.

From the CoinGate epics, deliberately **not** built: geo-targeting (Epic 6, needs a Geo-IP
dependency), scratch-card print artwork (Epic 13), notifications (Epic 12), the consent/DPA
and opt-in contact flows (Epics 15–16), lookalike-domain monitoring and SIEM (Epics 17–18
operational half), and the sponsorship marketplace. Codes are unguessable random lookups
rather than self-describing signed payloads — same tamper resistance, no key management.
