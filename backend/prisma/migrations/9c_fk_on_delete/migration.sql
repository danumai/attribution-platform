-- Referential behaviour for the four foreign keys Prisma's differ had left at its defaults.
--
-- Written to CONVERGE on the target state rather than to assert the starting one. `migrate
-- deploy` runs against databases whose history you do not fully control — a `migrate dev` run
-- against a shared database leaves a migration in `_prisma_migrations` that never reaches the
-- repo, and it may already have done some of this work. A bare `DROP CONSTRAINT` then raises
-- 42704 (constraint does not exist), the migration is recorded as failed, and `migrate deploy`
-- refuses to apply anything ever again — which is exactly what happened here: every deploy
-- blocked on a migration whose entire remaining work was a no-op.
--
-- `IF EXISTS` on every drop, and a drop before every add, so this is safe to re-run and lands
-- the same shape whether it starts from a fresh 9b schema or one already converted.

-- Dropped and not re-added: `payments.campaign_id` carries no relation in schema.prisma, so
-- the differ would fight this back every time. Ownership of the campaign is proved in the
-- handler before a checkout row is written (see payments.controller.ts).
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_campaign_id_fkey";

ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_org_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ponytail: SET NULL is Prisma's default for an optional relation, and it is inert here —
-- nothing in the API deletes a qr_code, and the CHECK tying `kind` to `qr_code_id` would
-- reject the nulled row anyway. Declare `onDelete: Restrict` on the relation if a delete
-- path is ever added.
ALTER TABLE "redemptions" DROP CONSTRAINT IF EXISTS "redemptions_qr_code_id_fkey";
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_qr_code_id_fkey"
  FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "withdrawals" DROP CONSTRAINT IF EXISTS "withdrawals_publisher_org_id_fkey";
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_publisher_org_id_fkey"
  FOREIGN KEY ("publisher_org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
