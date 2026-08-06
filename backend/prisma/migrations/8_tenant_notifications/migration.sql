-- A promoter topping up a campaign budget was already recorded here, and that was the whole
-- problem: it went into a 500-row log of *admin overrides* and nothing said a tenant had moved
-- money. The admin found out by scrolling.
--
-- Rather than a second table that would have to be written next to every audit call and drift
-- from it, the audit log becomes the notification stream. One rule decides what needs an
-- admin's eye: the actor is a tenant, so the platform did not do this itself. `acknowledged_at`
-- is the read mark — NULL means it is still in the admin's inbox. Anything a tenant does in
-- future is a notification the day it starts being audited, without a second place to add it.
ALTER TABLE "audit_log" ADD COLUMN "acknowledged_at" TIMESTAMPTZ;

-- The inbox reads exactly this slice and nothing else reads it, so the index carries the
-- predicate: unacknowledged rows only, which is the short end of the table forever.
CREATE INDEX "audit_log_unacknowledged_idx"
  ON "audit_log" ("created_at" DESC)
  WHERE "acknowledged_at" IS NULL;
