-- First open becomes its own stage, and the fingerprint gets more than two signals.
--
-- Two problems this fixes, both in the probabilistic (iOS) path:
--
-- 1. Matching happened at signup. The fingerprint window therefore had to span install +
--    onboarding + registration. At 60 minutes it missed nearly every real install; widened
--    far enough to catch them it would have been matching strangers on the same NAT. The
--    `installs` table below moves the match to first open, minutes after the scan, and lets
--    signup arrive whenever it arrives.
--
-- 2. The fingerprint was hashed IP + platform and nothing else. On carrier-grade NAT, a
--    coffee shop or a corporate VPN that is not an identity, it is a postcode. `tz` and
--    `screen` are collected by the iOS interstitial and re-presented by the SDK at first
--    open; how many of them agree is what `confidence` now records.
--
-- Nullable and no backfill throughout: scans recorded before this migration were never
-- offered an interstitial, and installs did not exist as a concept. A default would be a
-- fabricated signal, and this is the one table where a fabricated signal spends money.

-- ---------- extra fingerprint signals on the scan ----------
ALTER TABLE "scans" ADD COLUMN "tz"     TEXT;
ALTER TABLE "scans" ADD COLUMN "screen" TEXT;

-- Both are compared with `=` against a value the publisher's server supplies, and both are
-- rendered in fraud review. Shape is enforced in the API; this is the floor under it, so a
-- malformed value can never become a permanent unmatchable row.
ALTER TABLE "scans" ADD CONSTRAINT "scans_tz_check"
  CHECK ("tz" IS NULL OR "tz" ~ '^[A-Za-z0-9_+/-]{1,64}$');
ALTER TABLE "scans" ADD CONSTRAINT "scans_screen_check"
  CHECK ("screen" IS NULL OR "screen" ~ '^[0-9]{2,5}x[0-9]{2,5}@[0-9]{1,2}(\.[0-9]{1,2})?$');

-- ---------- the install stage ----------
CREATE TABLE "installs" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "scan_id"          UUID NOT NULL,
    "campaign_id"      UUID NOT NULL,
    "publisher_org_id" UUID NOT NULL,
    "match_method"     TEXT NOT NULL,
    "confidence"       INTEGER NOT NULL,
    "device_hash"      TEXT,
    "risk"             JSONB NOT NULL DEFAULT '{}',
    "redeemed"         BOOLEAN NOT NULL DEFAULT false,
    "first_open_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "installs_pkey" PRIMARY KEY ("id")
);

-- One install per scan, enforced here rather than in the handler: this is the constraint that
-- stops one poster scan being sold to two installs, and it must hold under concurrency.
CREATE UNIQUE INDEX "installs_scan_id_key" ON "installs"("scan_id");

ALTER TABLE "installs" ADD CONSTRAINT "installs_match_method_check"
  CHECK ("match_method" IN ('referrer','fingerprint'));
-- A confidence outside 0–100 means the scoring table and this column disagree about their
-- units, which would silently move the accept/reject line for every probabilistic match.
ALTER TABLE "installs" ADD CONSTRAINT "installs_confidence_check"
  CHECK ("confidence" BETWEEN 0 AND 100);
-- Deterministic is 100 by definition. If a referrer match ever scores lower, the claim id
-- stopped being the match key and the whole audit story changes — fail loudly instead.
ALTER TABLE "installs" ADD CONSTRAINT "installs_referrer_is_certain_check"
  CHECK ("match_method" <> 'referrer' OR "confidence" = 100);

ALTER TABLE "installs" ADD CONSTRAINT "installs_scan_id_fkey"
  FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "installs_campaign_id_device_hash_first_open_at_idx"
  ON "installs"("campaign_id", "device_hash", "first_open_at" DESC);
CREATE INDEX "installs_publisher_org_id_idx" ON "installs"("publisher_org_id");

-- ---------- signup points back at the install ----------
ALTER TABLE "redemptions" ADD COLUMN "install_id" UUID;
-- Existing rows arrived on the single-call path and have no install to point at. NULL is the
-- honest value; a synthesised install row would claim a first-open we never observed.
CREATE UNIQUE INDEX "redemptions_install_id_key" ON "redemptions"("install_id");
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_install_id_fkey"
  FOREIGN KEY ("install_id") REFERENCES "installs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 100 is right for the backfill and only because of what the old code did: it paid on an
-- exact referrer match, or on IP+platform, and the second of those is now scored at 55 and
-- refused. Old rows are not comparable to new ones — read them alongside `match_method`.
ALTER TABLE "redemptions" ADD COLUMN "confidence" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_confidence_check"
  CHECK ("confidence" BETWEEN 0 AND 100);
