# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four roles, all served by this Next.js app:

- **Promoters** (airlines, brands) — fund campaigns, design/print QR codes, watch scans/redemptions/budget drawdown against a coin budget.
- **Publishers** (e.g. BanglaReels, DramaBox) — sign up for a partnership, verify their own end users, receive coin-funded redemptions their subscribers can spend on premium content.
- **End users** — scan a promoter's printed QR, land on the publisher's signup surface, get coins. No dashboard of their own.
- **Super admin** — cross-tenant oversight: every org/partnership/campaign/QR/scan/redemption, ledger integrity, suspend/reinstate orgs, override coin rates and budgets (with audit log).

## Product Purpose

A two-sided reward platform connecting promoters (who want scan-driven engagement) to publishers (who want funded rewards for their subscribers). A promoter prints a QR, a scan routes to a publisher's signup flow, and a successful signup credits coins the end user redeems for content on the publisher's side — all funded from the promoter's campaign budget and tracked in a double-entry ledger. Success = accurate, fraud-resistant coin movement from promoter budget to verified end-user reward, with full auditability for admin and both tenants.

## Positioning

The mechanism a plain "print a QR that links to a landing page" or a generic loyalty SaaS can't replicate: a **publisher network with two-tier rewards**. Promoters don't reward anonymous scans — they fund redemptions that only convert to coins through a publisher's own signup/verification step, with a lower guest-tier payout that upgrades to full value once the publisher confirms the user verified (within a grace window). That two-sided funding + guest/identified tiering, backed by an append-only ledger, is the product's real moat over either a static QR code or a single-sided rewards tool.

## Operating Context

- **Promoter portal**: QR designer with live preview (colors, size, quiet zone, error correction, logo) exporting print-ready SVG; campaign/QR CRUD; dashboard of scans, redemptions, budget.
- **Publisher-sim**: stand-in publisher signup surface (`/publisher-sim`) that an end user lands on after scanning, using a seeded publisher API key.
- **Admin portal**: tabbed cross-tenant view (orgs, campaigns, scans, ledger) plus destructive/override actions, all audited.
- Codes are time-bound (default 30 days) and optionally usage-bound; promoters can only tighten their own codes, never loosen — loosening requires an audited admin override.
- A blocked scan redirects to `/campaign-ended?reason=…` with the specific reason shown, not a dead end.

## Capabilities and Constraints

- Reward tiers: `identified: boolean` on redemption verify — omitted means guest tier (promoter never pays full price for an unverified scan); guest redemptions carry `pending_coins` + `upgrade_deadline`, released once idempotently via an upgrade call.
- Money-critical paths (balance locks, atomic QR use-claim, admin aggregates) are raw SQL by design — the query builder can't express the row locks/column comparisons the correctness argument depends on.
- Suspension/offboarding kills live sessions immediately, not at JWT expiry.
- Deliberately not built yet (see README "What the design doc has that this build doesn't" and CoinGate epics): Redis-backed rate limiting, BullMQ/webhooks, HMAC request signing, PSP checkout, settlement statements, multi-user org RBAC, geo-targeting, scratch-card artwork, notifications, consent/DPA flows, lookalike-domain monitoring, sponsorship marketplace.
- No design system beyond Next.js defaults yet — `frontend/app/globals.css` and `frontend/lib/ui` are the current implementation, not a documented system.

## Brand Commitments

None binding yet. "QR Reward Platform" (used in README and page metadata) is a working title, not a committed name — future visual work should not treat it as fixed brand identity.

## Evidence on Hand

Real product with early real promoters/publishers, but no specific customer names, logos, or case studies have been provided. Future design work must not fabricate customer logos, testimonials, or traction numbers. Demo/seed data (promoter, publisher, funded campaign, QR) exists via `pnpm run seed` for local development only — not real evidence to display.

## Product Principles

1. Money correctness over convenience — redemption/ledger paths favor raw, auditable SQL and idempotency over ORM ergonomics.
2. Tighten-only self-service — tenants can restrict their own controls freely; loosening a money-relevant control always routes through an audited admin action.
3. No dead ends on a blocked scan — every failure path names its reason to the end user.
4. Two-sided trust — publisher verification, not the promoter or the platform, is the source of truth for "identified" status.
