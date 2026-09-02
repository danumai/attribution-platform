-- The campaign says which of the publisher's offers it advertises.
--
-- The publisher declares its offers once, in settings (`orgs.bonuses`). Until now a campaign
-- implicitly promised *all* of them that matched its mode, which is wrong the moment a
-- publisher runs more than one: a poster for a coins campaign was also promising the free
-- month of premium, and the app granted whatever the claim response happened to list.
--
-- So the promoter picks, at creation, out of what that publisher grants for that mode. Slugs
-- rather than ids or positions: `bonuses` is JSONB with no keys of its own, and `type` is
-- already the key the publisher's own app switches on (now unique per publisher, enforced in
-- the API). An offer the publisher later withdraws simply stops resolving — the list is read
-- live everywhere, never snapshotted.
--
-- Empty is not "no reward": it is every eligible offer, so every campaign that already exists
-- keeps promising exactly what it promised yesterday and needs no backfill.

ALTER TABLE "campaigns" ADD COLUMN "bonus_types" TEXT[] NOT NULL DEFAULT '{}';

-- Same shape floor as `orgs.bonuses`: the API checks every entry against the publisher's list,
-- this is the bound a reader gets without asking, and the cap on what one PATCH can print.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_bonus_types_check"
  CHECK (array_length("bonus_types", 1) IS NULL OR array_length("bonus_types", 1) <= 20);
