-- Loosen redemptions.install_id from the default RESTRICT to SET NULL, so an install row can
-- be removed (a data-retention sweep, a support correction) without orphaning the paid
-- redemption behind it — the redemption is the financial record and must survive.
--
-- History note: this migration originally shipped as `20260806185934_yes`, a timestamped name
-- that sorts lexicographically BEFORE `2_balance_floor` — so a fresh `migrate deploy` ran it
-- third, against an `installs` table that did not exist yet, and every new environment failed
-- to bootstrap. Renamed to sort where it belongs; written defensively so a database that
-- already applied it under the old name can apply it again as a no-op.
-- Databases that recorded the old name: `prisma migrate resolve --applied 9a_redemption_install_fk`
-- is NOT needed — re-running this SQL is harmless.

ALTER TABLE "redemptions" DROP CONSTRAINT IF EXISTS "redemptions_install_id_fkey";

ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_install_id_fkey"
  FOREIGN KEY ("install_id") REFERENCES "installs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
