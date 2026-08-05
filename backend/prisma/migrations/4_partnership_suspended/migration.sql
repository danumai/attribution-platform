-- `pending` meant two different things at once: "the publisher has not accepted yet", and
-- "an admin paused this relationship". The publisher's own `POST /v1/partnerships/:id/accept`
-- sets a partnership to `active` — so the second meaning was a control the counterparty could
-- lift in one call, silently restarting scans and payouts against a suspended agreement.
--
-- Splitting the states is what makes the suspension stick: `accept` only ever moves a row out
-- of `pending`, and nothing in the portal can leave `suspended`.
ALTER TABLE "partnerships" DROP CONSTRAINT "partnerships_status_check";
ALTER TABLE "partnerships" ADD CONSTRAINT "partnerships_status_check"
  CHECK ("status" IN ('pending','active','suspended'));
