-- The publisher's own reward becomes a list.
--
-- `bonus_label` was one line of free text, so it could describe exactly one offer. A publisher
-- runs several — coins on signup, a free week of premium on a repeat purchase — and those two
-- are paid on different events this schema already distinguishes (`redemptions.kind`).
--
-- JSONB rather than a `bonus_types` table: nothing here is ever joined, aggregated, or
-- constrained against money, because this platform never issues or fulfils any of it. The list
-- is read whole, per publisher, and echoed back at claim time — the same reason `qr_codes.style`
-- and `scans.client` are JSONB. A table would mean a migration per new kind of offer, which is
-- exactly what "whatever the publisher wants to give" rules out.

ALTER TABLE "orgs" ADD COLUMN "bonuses" JSONB NOT NULL DEFAULT '[]';

-- Backfill: the old single label becomes one entry granted on both events, which is what one
-- undifferentiated label always implicitly meant.
UPDATE "orgs"
   SET "bonuses" = jsonb_build_array(
         jsonb_build_object('type', 'custom', 'label', "bonus_label", 'on', 'both'))
 WHERE "bonus_label" IS NOT NULL AND "bonus_label" <> '';

ALTER TABLE "orgs" DROP COLUMN "bonus_label";

-- Shape floor. Every entry is validated in the API; this is the guarantee a reader can iterate
-- the column without checking, and the cap that stops one PATCH bloating a row every claim
-- response renders.
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_bonuses_check"
  CHECK (jsonb_typeof("bonuses") = 'array' AND jsonb_array_length("bonuses") <= 20);
