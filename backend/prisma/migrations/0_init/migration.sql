-- Baseline schema. Replaces the hand-rolled src/schema.sql that used to run on every boot.
--
-- Existing databases created by that script are already at this shape: baseline them with
--   npx prisma migrate resolve --applied 0_init
-- instead of running it. Fresh databases get it via `prisma migrate deploy`.

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "orgs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "api_key_hash" TEXT,
    "landing_url" TEXT,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partnerships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promoter_org_id" UUID NOT NULL,
    "publisher_org_id" UUID NOT NULL,
    "coin_rate" INTEGER NOT NULL DEFAULT 50,
    "guest_rate" INTEGER NOT NULL DEFAULT 10,
    "grace_days" INTEGER NOT NULL DEFAULT 7,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partnerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partnership_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "style" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "qr_code_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "publisher_user_ref" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "identified" BOOLEAN NOT NULL DEFAULT true,
    "upgraded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balances" (
    "account" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("account")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_org_id" UUID,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_email_key" ON "orgs"("email");

-- CreateIndex
CREATE INDEX "orgs_api_key_hash_idx" ON "orgs"("api_key_hash");

-- CreateIndex
CREATE INDEX "partnerships_promoter_org_id_idx" ON "partnerships"("promoter_org_id");

-- CreateIndex
CREATE INDEX "partnerships_publisher_org_id_idx" ON "partnerships"("publisher_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "partnerships_promoter_org_id_publisher_org_id_key" ON "partnerships"("promoter_org_id", "publisher_org_id");

-- CreateIndex
CREATE INDEX "campaigns_partnership_id_idx" ON "campaigns"("partnership_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_code_key" ON "qr_codes"("code");

-- CreateIndex
CREATE INDEX "qr_codes_campaign_id_idx" ON "qr_codes"("campaign_id");

-- CreateIndex
CREATE INDEX "scans_campaign_id_idx" ON "scans"("campaign_id");

-- CreateIndex
CREATE INDEX "scans_scanned_at_idx" ON "scans"("scanned_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "redemptions_scan_id_key" ON "redemptions"("scan_id");

-- CreateIndex
CREATE INDEX "redemptions_created_at_idx" ON "redemptions"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "redemptions_campaign_id_publisher_user_ref_key" ON "redemptions"("campaign_id", "publisher_user_ref");

-- CreateIndex
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries"("account");

-- CreateIndex
CREATE INDEX "ledger_entries_ref_idx" ON "ledger_entries"("ref");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_promoter_org_id_fkey" FOREIGN KEY ("promoter_org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_publisher_org_id_fkey" FOREIGN KEY ("publisher_org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_partnership_id_fkey" FOREIGN KEY ("partnership_id") REFERENCES "partnerships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_org_id_fkey" FOREIGN KEY ("actor_org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- CHECK constraints ----------
-- Not expressible in schema.prisma, so they are declared here. Prisma's differ ignores
-- CHECK constraints, so `migrate dev` will not report these as drift or try to drop them.

ALTER TABLE "orgs" ADD CONSTRAINT "orgs_type_check"
  CHECK ("type" IN ('promoter','publisher','admin'));

ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_status_check"
  CHECK ("status" IN ('pending','active'));

-- The money invariant: a guest redemption can never pay more than an identified one, so the
-- held-back upgrade delta is never negative.
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_guest_rate_check"
  CHECK ("guest_rate" >= 0 AND "guest_rate" <= "coin_rate");

ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_grace_days_check"
  CHECK ("grace_days" >= 0 AND "grace_days" <= 365);

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_status_check"
  CHECK ("status" IN ('active','paused','ended'));
