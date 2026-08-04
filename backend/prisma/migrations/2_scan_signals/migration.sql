-- Reporting dimensions on a scan.
--
-- Why: a scan row could already say *that* it happened and roughly which device shape it came
-- from, because those two facts are what the iOS fingerprint match needs. Neither answers the
-- question a promoter actually buys this platform to answer — which placement, which country,
-- which channel is worth reprinting. These columns carry that, and nothing else: they are
-- filled from request headers the redirect already receives, so no new data is collected from
-- the person scanning. The IP itself is still only ever stored as the truncated hash above.
--
-- All nullable, no backfill: scans recorded before this migration genuinely have no answer,
-- and a default would invent one. Every reader groups NULL as "unknown" instead.

ALTER TABLE "scans" ADD COLUMN "country"      TEXT;
ALTER TABLE "scans" ADD COLUMN "city"         TEXT;
ALTER TABLE "scans" ADD COLUMN "language"     TEXT;
ALTER TABLE "scans" ADD COLUMN "referer_host" TEXT;
ALTER TABLE "scans" ADD COLUMN "os"           TEXT;
ALTER TABLE "scans" ADD COLUMN "browser"      TEXT;
ALTER TABLE "scans" ADD COLUMN "device_type"  TEXT;

-- Country is grouped and filtered on in every breakdown, so a malformed value is a permanent
-- extra bucket in every report. The API validates too; this is the floor under it.
ALTER TABLE "scans" ADD CONSTRAINT "scans_country_check"
  CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
ALTER TABLE "scans" ADD CONSTRAINT "scans_device_type_check"
  CHECK ("device_type" IS NULL OR "device_type" IN ('mobile','tablet','desktop'));

-- Every breakdown is "one campaign, a recent window, grouped by something". This index serves
-- the range scan; the grouping itself happens over the rows it returns, which is cheap next to
-- the sequential scan of the whole table it replaces.
CREATE INDEX "scans_campaign_id_scanned_at_idx" ON "scans"("campaign_id", "scanned_at" DESC);
