-- The ledger's two promises, enforced by the database rather than by convention.
--
-- Both were true of the code and only of the code: `ledger()` never updates or deletes an
-- entry, and every money-in path happened to build a distinct `ref`. Neither is something the
-- *next* writer — a support script, a psql session, a migration, a compromised app credential
-- — is bound by, and the whole value of a double-entry book is that it cannot be edited after
-- the fact. An invariant a reviewer has to re-derive from every call site is not an invariant.

-- ---------- append-only ----------
-- Corrections go in as a compensating entry, which is how a ledger is supposed to be fixed:
-- the mistake and its reversal both stay visible. Silently rewriting history is what makes a
-- balance impossible to defend in a dispute.
CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (attempted %); post a compensating entry instead', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

-- Row-level triggers never see TRUNCATE, which would empty the book without firing the above.
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();

-- ---------- one entry per account per ref ----------
-- Makes any deterministic `ref` replay-safe by construction: a retried credit collides instead
-- of doubling the money. `fund` and the admin adjustment currently key their ref on
-- `Date.now()`, so a double-submitted request lands twice — this is the floor that lets them
-- take a caller-supplied idempotency key instead, and it is the same floor a PSP webhook will
-- need when it keys on the payment intent id.
--
-- Every ref today already holds exactly two entries on two different accounts (campaign +
-- publisher, or external:funding + campaign), so this holds on existing data. If it fails to
-- build, the database really does contain a duplicated credit — investigate, do not drop it.
CREATE UNIQUE INDEX "ledger_entries_account_ref_key" ON "ledger_entries"("account", "ref");

-- Redundant now: `(account)` is a prefix of the index above, which serves every lookup the
-- old one did. One less index to maintain on the fastest-growing table in the system.
DROP INDEX "ledger_entries_account_idx";

