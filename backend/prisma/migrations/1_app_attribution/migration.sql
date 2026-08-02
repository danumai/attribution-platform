-- Scan-to-install attribution, replacing the scan token that used to ride in the redirect.
--
-- Why: a token in the URL is a claim the device carries into the app, which is precisely the
-- "own mechanism to unlock content" App Store 3.1.1 forbids. Scans now redirect to a store
-- listing carrying nothing spendable, and the install is tied back server-to-server.

-- ---------- publisher app targets ----------
ALTER TABLE "orgs" ADD COLUMN "android_package" TEXT;
ALTER TABLE "orgs" ADD COLUMN "ios_app_id"      TEXT;
ALTER TABLE "orgs" ADD COLUMN "bonus_label"     TEXT;

-- Validated in the API too, but enforced here as well: these values are interpolated into
-- a store URL, so a value with a '&' or '/' in it would rewrite the destination.
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_android_package_check"
  CHECK ("android_package" IS NULL OR "android_package" ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$');
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_ios_app_id_check"
  CHECK ("ios_app_id" IS NULL OR "ios_app_id" ~ '^[0-9]{6,12}$');

-- ---------- scans become attribution claims ----------
ALTER TABLE "scans" ADD COLUMN "claim_id" TEXT;
ALTER TABLE "scans" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'other';

-- Backfill: pre-existing scans predate the referrer channel and can never be matched by
-- one, but the column is the primary key of the deterministic path so it must be unique.
UPDATE "scans" SET "claim_id" = replace(gen_random_uuid()::text, '-', '') WHERE "claim_id" IS NULL;
ALTER TABLE "scans" ALTER COLUMN "claim_id" SET NOT NULL;

CREATE UNIQUE INDEX "scans_claim_id_key" ON "scans"("claim_id");

-- The fingerprint lookup, which runs on every iOS first-open: unmatched scans sharing one
-- device shape, newest first. Without this it is a sequential scan of the whole table.
CREATE INDEX "scans_ip_platform_consumed_scanned_at_idx"
  ON "scans"("ip", "platform", "consumed", "scanned_at" DESC);

ALTER TABLE "scans" ADD CONSTRAINT "scans_platform_check"
  CHECK ("platform" IN ('android','ios','other'));

-- ---------- how the match was made ----------
ALTER TABLE "redemptions" ADD COLUMN "match_method" TEXT NOT NULL DEFAULT 'referrer';
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_match_method_check"
  CHECK ("match_method" IN ('referrer','fingerprint'));
