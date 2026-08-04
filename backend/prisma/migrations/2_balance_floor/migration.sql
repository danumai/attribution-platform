-- A campaign budget can never go negative.
--
-- Three code paths already lock the balance row and compare before spending — claim, confirm
-- and the admin adjustment. That is three hand-written copies of one invariant, and the fourth
-- path (whoever writes it next) is the one that forgets. Nothing would notice either: the
-- admin overview's `ledger_balanced` flag checks the *global* sum, which stays zero whether or
-- not one account went below zero.
--
-- `external:funding` is the one account that must go negative: it is the source every credit
-- is drawn from, so its balance is minus the total ever funded, by design.
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_non_negative_check"
  CHECK ("balance" >= 0 OR "account" = 'external:funding');
