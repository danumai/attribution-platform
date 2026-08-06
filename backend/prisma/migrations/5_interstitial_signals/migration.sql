-- What the hand-off screen measures, beyond timezone / screen / language.
--
-- Two kinds of column, and the split is the point:
--
--   cores, dark   Feed matching. Both are facts a native SDK can report as the same value at
--                 first open (`activeProcessorCount`, `userInterfaceStyle`), which is the only
--                 test a matching signal has to pass. Typed, bounded, groupable.
--
--   client        Reporting only. Viewport, touch points, network class, the full preferred
--                 language list, how long the screen was held — none of it survives the
--                 browser → native crossing, so none of it may ever be scored. JSONB because
--                 it is read as a per-scan detail in the console, never grouped, and a column
--                 each would be a migration per curiosity.
--
-- All nullable, no backfill. The screen only renders for iOS scans into a registered App Store
-- listing, and JS can be blocked even then — NULL is the honest answer for every other row.

ALTER TABLE "scans" ADD COLUMN "cores"  SMALLINT;
ALTER TABLE "scans" ADD COLUMN "dark"   BOOLEAN;
ALTER TABLE "scans" ADD COLUMN "client" JSONB;

-- `cores` is scored, so an out-of-range value is not just a bad report bucket — it is a
-- fingerprint dimension a caller could widen. The API bounds it too; this is the floor.
ALTER TABLE "scans" ADD CONSTRAINT "scans_cores_check"
  CHECK ("cores" IS NULL OR ("cores" BETWEEN 1 AND 512));
