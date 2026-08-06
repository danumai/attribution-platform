-- Repeat rewards: the same person, paid again for the next purchase.
--
-- Everything above this migration prices one thing — an *acquisition*. A person installs the
-- app once, signs up once, and `UNIQUE (campaign_id, publisher_user_ref)` makes sure nobody is
-- ever paid for them twice. That constraint is exactly right for what it was built for and
-- exactly wrong for an airline: a traveller who flies eleven times a year is eleven purchases,
-- and a shop's regular is a purchase a week.
--
-- So campaigns get a `mode`, and it selects which guarantee applies:
--
--   acquisition   one payout per user per campaign, forever. Unchanged, and the partial index
--                 below is the same constraint it always was, now scoped to this mode.
--   engagement    one payout per *issued code*. The promoter mints one code per real
--                 transaction, so "one per code" is "one per purchase" — and the same user
--                 collecting a hundred of them over a year is the feature, not the leak.
--
-- The two are not alternatives on one scan. A traveller with no app yet scans a boarding pass,
-- installs, signs up and buys a ticket in the same motion — that is genuinely an acquisition
-- AND a purchase, and both are payable off the one scan. `scans.consumed` stays the acquisition
-- guard (one install per scan) and the engagement guard is its own index, so the two facts are
-- recorded independently instead of racing for the same flag.

-- ---------- which kind of campaign this is ----------
ALTER TABLE "campaigns" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'acquisition';
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_mode_check"
  CHECK ("mode" IN ('acquisition','engagement'));

-- ---------- what a repeat purchase is worth ----------
-- Its own rate because it is its own product. `coin_rate` is the price of a person who was not
-- a user before; a returning customer is worth real money to the publisher but not that, and
-- pricing them the same would either overpay every repeat or underprice every acquisition.
-- Deliberately unrelated to `coin_rate` — no pair rule — because the two answer different
-- questions and a partnership may reasonably price a repeat above a signup or far below it.
ALTER TABLE "partnerships"
  ADD COLUMN "engagement_rate"          INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "proposed_engagement_rate" INTEGER;

ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_engagement_rate_check"
  CHECK ("engagement_rate" BETWEEN 0 AND 100000);

-- The proposal was a pair and is now a triple. Same rule as before — all of it or none of it,
-- so a half-written proposal can never be accepted into a price nobody agreed to.
ALTER TABLE "partnerships" DROP CONSTRAINT "partnerships_proposed_rates_check";
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_proposed_rates_check" CHECK (
  ("proposed_coin_rate" IS NULL) = ("proposed_guest_rate" IS NULL)
  AND ("proposed_coin_rate" IS NULL) = ("proposed_engagement_rate" IS NULL)
  AND ("proposed_coin_rate" IS NULL OR (
    "proposed_coin_rate" BETWEEN 1 AND 100000
    AND "proposed_guest_rate" BETWEEN 0 AND "proposed_coin_rate"
    AND "proposed_engagement_rate" BETWEEN 0 AND 100000
  ))
);

-- ---------- a code minted against one real transaction ----------
-- The promoter's own reference for the purchase: a PNR, an order number, a receipt line. Not
-- read by anything here — it exists so the mint is idempotent. A booking webhook that fires
-- twice, a retried job, an at-least-once queue: the second attempt collides on this index and
-- returns the code the first one made, instead of handing one traveller two rewards.
ALTER TABLE "qr_codes" ADD COLUMN "issued_ref" TEXT;
-- Postgres treats NULLs as distinct in a unique index, so every code the promoter portal has
-- ever made (all of which have no issued_ref) stays legal and unaffected.
CREATE UNIQUE INDEX "qr_codes_campaign_id_issued_ref_key"
  ON "qr_codes" ("campaign_id", "issued_ref");

-- ---------- the payout, and which guarantee it lives under ----------
-- Denormalised off the campaign for the same reason `installs.publisher_org_id` is: the two
-- partial indexes below are the money invariant, and an index cannot reach through a join.
ALTER TABLE "redemptions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'acquisition';
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_kind_check"
  CHECK ("kind" IN ('acquisition','engagement'));

ALTER TABLE "redemptions" ADD COLUMN "qr_code_id" UUID;
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_qr_code_id_fkey"
  FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An engagement payout names a code rather than a device, so it is neither a referrer match
-- nor a fingerprint one. It is the most deterministic path in the system — the code was minted
-- against one transaction and scanned once — which is why it also scores 100.
ALTER TABLE "redemptions" DROP CONSTRAINT "redemptions_match_method_check";
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_match_method_check"
  CHECK ("match_method" IN ('referrer','fingerprint','code'));
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_code_is_certain_check"
  CHECK ("match_method" <> 'code' OR "confidence" = 100);

-- An engagement row must name the code it was paid against, and an acquisition row must not:
-- without this the `kind` column and the indexes below could disagree about which rule a row
-- is actually living under, and the one that matters is whichever the index happened to apply.
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_kind_qr_code_check"
  CHECK (("kind" = 'engagement') = ("qr_code_id" IS NOT NULL));

-- The swap. Same constraint, same columns, now carrying the predicate that says which rows it
-- speaks for. Acquisition behaviour is bit-for-bit what it was; engagement rows are simply not
-- in this index, which is the entire mechanism by which one traveller gets paid twice.
DROP INDEX "redemptions_campaign_id_publisher_user_ref_key";
CREATE UNIQUE INDEX "redemptions_campaign_id_publisher_user_ref_key"
  ON "redemptions" ("campaign_id", "publisher_user_ref")
  WHERE "kind" = 'acquisition';

-- And the guarantee that replaces it. One reward per issued code, held by the database rather
-- than by the handler, so two simultaneous claims for one boarding pass pay once. This is also
-- the key a retry replays against — the publisher resends the code, not a user ref.
CREATE UNIQUE INDEX "redemptions_qr_code_id_key"
  ON "redemptions" ("qr_code_id")
  WHERE "kind" = 'engagement';

-- One scan, two payouts — the case that forces this index to be partial too.
--
-- A traveller with no app scans their boarding pass, installs, signs up, and has also bought a
-- ticket. That single scan is honestly both an acquisition and a purchase, and both are owed.
-- A total UNIQUE on scan_id made the second one impossible: whichever call arrived second was
-- refused, and which one that was depended on the publisher's call ordering.
--
-- Scoped to acquisitions it means exactly what it always meant — one signup per scan. The
-- engagement side needs no equivalent, because `redemptions_qr_code_id_key` above is strictly
-- stronger: one reward per code, however many scans an admin's raised `max_uses` allows.
DROP INDEX "redemptions_scan_id_key";
CREATE UNIQUE INDEX "redemptions_scan_id_key"
  ON "redemptions" ("scan_id")
  WHERE "kind" = 'acquisition';

-- ---------- where an engagement scan is sent ----------
-- An https URL the publisher has registered as an Android App Link / iOS Universal Link. The
-- OS resolves it: app installed, it opens and never touches the network; not installed, the
-- browser loads the publisher's own page and follows the store URL we hand it alongside.
--
-- That is the whole reason there is no "is the app installed" check anywhere in this codebase.
-- The platforms already answer that question, correctly, offline, and no server can.
ALTER TABLE "orgs" ADD COLUMN "deeplink_url" TEXT;
