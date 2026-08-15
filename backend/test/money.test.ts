// Self-check for the platform's cut of every payout. No DB dependency.
//
// `splitFee` is the one place the business model is arithmetic rather than policy, and it sits
// inside a double-entry transaction — so the property that actually matters is not any single
// split but that the three ledger rows still sum to zero for EVERY input. A cut that rounds
// independently of the net is a book that silently stops balancing.
// Run: npm run test:unit --workspace backend
import { strict as assert } from 'assert';
import { splitFee, validateRates } from '../src/common/rates';

// The headline case: a 50-credit signup at a 10% take rate.
assert.deepEqual(splitFee(50, 1000), { net: 45, cut: 5 });
// A 20-credit repeat purchase at the same rate.
assert.deepEqual(splitFee(20, 1000), { net: 18, cut: 2 });

// A launch promotion: the platform takes nothing and the publisher is paid in full.
assert.deepEqual(splitFee(50, 0), { net: 50, cut: 0 });
// The other end of the CHECK constraint. Legal, if commercially strange.
assert.deepEqual(splitFee(50, 10_000), { net: 0, cut: 50 });

// Rounding favours the publisher: 7 * 10% = 0.7, floored to 0. The party doing the work keeps
// the odd credit — and, more importantly, `cut` can never round UP past what was collected.
assert.deepEqual(splitFee(7, 1000), { net: 7, cut: 0 });
assert.deepEqual(splitFee(1, 9_999), { net: 1, cut: 0 }, 'a 1-credit fee cannot be split');

// THE invariant. Every payout writes -gross to the campaign, +net to the publisher and +cut to
// the platform under one ref; if these two do not reconstitute `gross` exactly, that ref does
// not sum to zero and `ledger_balanced` on the admin overview goes false.
for (let gross = 0; gross <= 500; gross++)
  for (const bps of [0, 1, 250, 999, 1000, 3333, 5000, 9999, 10_000]) {
    const { net, cut } = splitFee(gross, bps);
    assert.equal(net + cut, gross, `conservation broke at gross=${gross} bps=${bps}`);
    assert.ok(net >= 0 && cut >= 0, `negative component at gross=${gross} bps=${bps}`);
    // The account_balances floor rejects a negative balance outright, so a cut larger than the
    // gross would not merely be wrong — it would abort the whole payout transaction.
    assert.ok(cut <= gross, `cut exceeded gross at gross=${gross} bps=${bps}`);
  }

// The take rate is snapshotted per partnership and never re-read at payout time, so a large
// value must still behave. 10000 bps on a max-sized fee is the worst case the CHECK allows.
assert.deepEqual(splitFee(100_000, 10_000), { net: 0, cut: 100_000 });

// ---------- the negotiated rates, unchanged by the platform cut ----------
// The take rate is the platform's own side of the deal and is deliberately NOT part of the
// four numbers the two counterparties agree, so `validateRates` must not have grown one.
const r = validateRates({});
assert.deepEqual(r, { coin_rate: 50, guest_rate: 10, grace_days: 7, engagement_rate: 20 });
assert.ok(!('platform_fee_bps' in r), 'the take rate is not a negotiated rate');

// The pair rule still holds: the guest tier is a *part* of the coin rate, so it cannot exceed
// it — that is what makes the held-back delta at /confirm impossible to drive negative.
assert.throws(() => validateRates({ coin_rate: 50, guest_rate: 80 }), /cannot exceed/);
assert.equal(validateRates({ coin_rate: 50, guest_rate: 50 }).guest_rate, 50, 'equal is allowed');
// Resolved against the current row, so moving one number is judged against the other in force.
assert.throws(() => validateRates({ coin_rate: 5 }, { coin_rate: 50, guest_rate: 10, grace_days: 7, engagement_rate: 20 }), /cannot exceed/);

console.log('money self-check passed');
