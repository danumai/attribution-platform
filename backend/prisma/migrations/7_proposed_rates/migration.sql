-- Repricing a live partnership is the publisher's business as much as the promoter's: the
-- coin rate is what the publisher gets paid per signup. Until now a promoter could only set
-- rates at creation time, so the only way to reprice was an admin patch behind both parties.
--
-- These two columns are the proposal, not the price. Every payout keeps reading `coin_rate`
-- and `guest_rate`, so an unaccepted proposal changes nothing that spends money — the
-- publisher's `accept` is what copies them across. Nullable as a pair: NULL means no open
-- proposal, and the CHECK below refuses half a pair rather than letting a proposal exist with
-- a guest rate above the coin rate it would be paid against.
ALTER TABLE "partnerships"
  ADD COLUMN "proposed_coin_rate"  INTEGER,
  ADD COLUMN "proposed_guest_rate" INTEGER;

ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_proposed_rates_check" CHECK (
  ("proposed_coin_rate" IS NULL) = ("proposed_guest_rate" IS NULL)
  AND ("proposed_coin_rate" IS NULL OR (
    "proposed_coin_rate" BETWEEN 1 AND 100000
    AND "proposed_guest_rate" BETWEEN 0 AND "proposed_coin_rate"
  ))
);
