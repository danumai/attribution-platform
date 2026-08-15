-- The business layer: the platform's own revenue, real money-in, real money-out, and the two
-- account controls (vetting, recovery) a platform holding other companies' money cannot ship
-- without.
--
-- Everything above this migration moves the promoter's coins to the publisher at 1:1 — a
-- ledger with perfect integrity and zero revenue. This adds the missing counterparty: the
-- platform itself.

-- ---------- platform fee ----------
-- Basis points of every payout retained by the platform. Snapshotted per partnership at
-- creation (from PLATFORM_FEE_BPS) rather than read live from config, so changing the platform
-- default never silently reprices a deal both parties already agreed to. Admin-patchable per
-- partnership like the other four rates.
ALTER TABLE "partnerships" ADD COLUMN "platform_fee_bps" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_platform_fee_bps_check"
  CHECK ("platform_fee_bps" BETWEEN 0 AND 10000);

-- ---------- publisher vetting ----------
-- An unapproved publisher is invisible to the directory and cannot enter a partnership — which
-- is what stops "sign up, look legitimate, receive money" being a single unauthenticated flow.
-- Backfilled true for existing publishers: they were operating before the gate existed, and
-- retroactively suspending live partnerships is an admin decision, not a migration's.
ALTER TABLE "orgs" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false;
UPDATE "orgs" SET "approved" = true WHERE "type" = 'publisher';

-- ---------- password recovery ----------
-- Single-use, admin-issued, one hour. Stored hashed for the same reason the API key is: a
-- database read must never yield a usable credential.
ALTER TABLE "orgs" ADD COLUMN "reset_token_hash" TEXT,
                   ADD COLUMN "reset_token_expires" TIMESTAMPTZ;

-- ---------- money in ----------
-- One row per intended funding. The PSP webhook completes it; `fund:{payment_id}` is the
-- ledger ref, so a webhook redelivered ten times credits once — the same UNIQUE (account, ref)
-- floor 6_ledger_integrity laid for exactly this caller.
CREATE TABLE "payments" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id"  UUID NOT NULL,
  "org_id"       UUID NOT NULL,
  "coins"        INTEGER NOT NULL,
  -- pending | completed | failed
  "status"       TEXT NOT NULL DEFAULT 'pending',
  -- the PSP's own id for the charge (payment intent, transaction id) — the audit bridge
  -- between this ledger and the processor's records
  "provider_ref" TEXT,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id"),
  CONSTRAINT "payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id"),
  CONSTRAINT "payments_coins_check"  CHECK ("coins" BETWEEN 1 AND 10000000),
  CONSTRAINT "payments_status_check" CHECK ("status" IN ('pending','completed','failed'))
);
CREATE INDEX "payments_campaign_id_idx" ON "payments"("campaign_id");
CREATE INDEX "payments_org_id_created_at_idx" ON "payments"("org_id", "created_at" DESC);
-- One PSP charge can complete at most one payment, however many times its webhook fires or
-- however the payload is replayed against a different payment id.
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments"("provider_ref")
  WHERE "provider_ref" IS NOT NULL;

-- ---------- money out ----------
-- A withdrawal is a request until an admin pays or rejects it. The ledger only moves on `paid`
-- (publisher debit, external:payouts credit) — so the requested state holds no money and a
-- rejected request needs no compensating entry.
CREATE TABLE "withdrawals" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "publisher_org_id" UUID NOT NULL,
  "coins"            INTEGER NOT NULL,
  -- requested | paid | rejected
  "status"           TEXT NOT NULL DEFAULT 'requested',
  -- admin's note on a rejection, or payout reference on a payment
  "note"             TEXT,
  "requested_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at"       TIMESTAMPTZ(6),
  CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "withdrawals_publisher_org_id_fkey" FOREIGN KEY ("publisher_org_id") REFERENCES "orgs"("id"),
  CONSTRAINT "withdrawals_coins_check"  CHECK ("coins" >= 1),
  CONSTRAINT "withdrawals_status_check" CHECK ("status" IN ('requested','paid','rejected'))
);
CREATE INDEX "withdrawals_publisher_org_id_requested_at_idx"
  ON "withdrawals"("publisher_org_id", "requested_at" DESC);
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- external:payouts joins external:funding as the second account allowed below zero… it is not:
-- payouts only ever accumulate credits (money leaving the platform), so the existing floor
-- stands. Asserted here so the assumption is written down where the constraint lives.
