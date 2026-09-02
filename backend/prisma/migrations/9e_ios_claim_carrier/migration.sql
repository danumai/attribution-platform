-- The iOS fingerprint path, removed.
--
-- Apple's Developer Program License Agreement forbids deriving data from a device for the
-- purpose of uniquely identifying it, and names "properties of a user's web browser and its
-- configuration, the user's device and its configuration" as examples. The scored match this
-- platform ran on iOS — hashed IP + timezone + screen geometry + locale + core count +
-- appearance — was exactly that, so it is deleted rather than tuned.
--
-- What replaces it carries the SAME opaque `claim_id` Play's install referrer already carries
-- on Android, by two deterministic routes: an App Clip (shared App Group container) and the
-- pasteboard. Both land on the referrer branch that already existed. See `attribution.ts`.

-- 1. The stored fingerprint dimensions. Dropped, not deprecated: retaining device configuration
--    collected for matching is the thing being stopped, so the columns go with the code.
DROP INDEX IF EXISTS "scans_ip_platform_consumed_scanned_at_idx";
ALTER TABLE "scans"
  DROP COLUMN IF EXISTS "ip",
  DROP COLUMN IF EXISTS "tz",
  DROP COLUMN IF EXISTS "screen",
  DROP COLUMN IF EXISTS "cores",
  DROP COLUMN IF EXISTS "dark";

-- The reporting bag rode along with the fingerprint kit and carried device configuration of its
-- own (platform, memory, colour depth, touch points, network, viewport). Only the two keys that
-- describe the hand-off screen's own behaviour survive; the rest are stripped from history too.
UPDATE "scans"
   SET "client" = NULLIF(
         (COALESCE("client", '{}'::jsonb) - 'viewport' - 'utc_offset' - 'touch_points'
            - 'languages' - 'network' - 'memory_gb' - 'color_depth' - 'platform'
            - 'standalone' - 'reduced_motion'),
         '{}'::jsonb)
 WHERE "client" IS NOT NULL;

-- 2. The repeat-device check went with it: it hashed the same signals, so there is nothing left
--    to hash. One install per scan is still guaranteed by `scans.consumed`.
DROP INDEX IF EXISTS "installs_campaign_id_device_hash_first_open_at_idx";
ALTER TABLE "installs" DROP COLUMN IF EXISTS "device_hash";

-- 3. Every match method is now deterministic, so every confidence is 100.
--    `fingerprint` stays in the CHECK as a HISTORICAL value only — rows written before this
--    migration are the record of decisions actually made, and rewriting them would falsify an
--    audit trail. Nothing writes it any more.
ALTER TABLE "installs" DROP CONSTRAINT IF EXISTS "installs_match_method_check";
ALTER TABLE "installs" ADD CONSTRAINT "installs_match_method_check"
  CHECK ("match_method" IN ('referrer','appclip','pasteboard','fingerprint'));
ALTER TABLE "installs" DROP CONSTRAINT IF EXISTS "installs_referrer_confidence_check";
ALTER TABLE "installs" ADD CONSTRAINT "installs_referrer_confidence_check"
  CHECK ("match_method" = 'fingerprint' OR "confidence" = 100);

ALTER TABLE "redemptions" DROP CONSTRAINT IF EXISTS "redemptions_match_method_check";
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_match_method_check"
  CHECK ("match_method" IN ('referrer','appclip','pasteboard','code','fingerprint'));
ALTER TABLE "redemptions" DROP CONSTRAINT IF EXISTS "redemptions_code_confidence_check";
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_code_confidence_check"
  CHECK ("match_method" = 'fingerprint' OR "confidence" = 100);

-- 4. What a publisher registers to get the App Clip carrier, and the campaign-link cross-check.
ALTER TABLE "orgs"
  ADD COLUMN IF NOT EXISTS "slug"               TEXT,
  ADD COLUMN IF NOT EXISTS "ios_appclip_id"     TEXT,
  ADD COLUMN IF NOT EXISTS "ios_provider_token" TEXT;

-- The slug is a path segment in the App Clip invocation URL (`/c/:slug/:code`), which App Store
-- Connect registers as that publisher's URL prefix. Two publishers sharing one would hand each
-- other's scans to the wrong clip, so the database refuses it rather than the validator alone.
CREATE UNIQUE INDEX IF NOT EXISTS "orgs_slug_key" ON "orgs"("slug");
ALTER TABLE "orgs" DROP CONSTRAINT IF EXISTS "orgs_slug_check";
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_slug_check"
  CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$');

-- `TEAMID.bundle.id.Clip`, as it appears in the AASA `appclips.apps` array. Shape-checked here
-- because this string is served to every iPhone that scans anything: a malformed entry
-- invalidates the whole file and silently breaks App Clip invocation for every publisher.
ALTER TABLE "orgs" DROP CONSTRAINT IF EXISTS "orgs_ios_appclip_id_check";
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_ios_appclip_id_check"
  CHECK ("ios_appclip_id" IS NULL OR "ios_appclip_id" ~ '^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,180}$');

ALTER TABLE "orgs" DROP CONSTRAINT IF EXISTS "orgs_ios_provider_token_check";
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_ios_provider_token_check"
  CHECK ("ios_provider_token" IS NULL OR "ios_provider_token" ~ '^[0-9]{4,20}$');
