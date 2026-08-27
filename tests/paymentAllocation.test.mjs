// How much of a payment may be pointed at one treatment.
//
// The case this exists for, from a real patient's file: TOTAL TREATMENT 1,400, TOTAL PAID 2,600,
// BALANCE −1,200. A duplicate treatment and its duplicate payment had been entered and cleaned up,
// but the surviving 1,200 was settling the 200 EGP consultation — so a 200 EGP charge read
// "paid 1,400", and the patient appeared to be owed 1,200 they were never given.
//
// Four screens took payments and none of them agreed: the quick-payment modal refused, the
// appointment side panel asked "continue?" and allowed it, the patient ledger checked nothing, and
// the server — the only one that cannot be bypassed — checked nothing either. So the loosest screen
// decided what the books could say.
import assert from "node:assert/strict";
import {
  allocationMessage,
  allocationMessageAr,
  chargeAmount,
  checkAllocation,
  overAllocation,
} from "../src/lib/paymentAllocation.ts";

// --- the case that started this ----------------------------------------------------------------
// A 200 EGP consultation, already settled in full, being handed another 1,200.
{
  const verdict = checkAllocation({ cost: 200, otherPaymentsTotal: 200, amount: 1200 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.remaining, 0);
  assert.equal(verdict.excess, 1200);

  const message = allocationMessage(verdict, "كشف");
  assert.match(message, /already paid in full/);
  assert.match(message, /1,200 EGP over/);
  // It has to say what to do with the money, not just refuse it.
  assert.match(message, /payment on account/);
  assert.match(allocationMessageAr(verdict, "كشف"), /تحت الحساب/);
}

// The same charge with nothing paid yet: 1,200 still does not fit inside 200.
{
  const verdict = checkAllocation({ cost: 200, otherPaymentsTotal: 0, amount: 1200 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.remaining, 200);
  assert.equal(verdict.excess, 1000);
  assert.match(allocationMessage(verdict, "كشف"), /Only 200 EGP is still owed/);
  // And it names the figure they should have typed.
  assert.match(allocationMessage(verdict, "كشف"), /Record 200 EGP against it/);
}

// --- what must keep working --------------------------------------------------------------------
// Settling a charge exactly.
assert.equal(checkAllocation({ cost: 1200, otherPaymentsTotal: 0, amount: 1200 }).ok, true);
// Paying it off in instalments.
assert.equal(checkAllocation({ cost: 1200, otherPaymentsTotal: 900, amount: 300 }).ok, true);
// The last instalment, to the half-cent.
assert.equal(checkAllocation({ cost: 100.1, otherPaymentsTotal: 50.05, amount: 50.05 }).ok, true);

// Two instalments that are each under the remaining balance but together exceed the charge. This
// is the version a per-payment check misses, which is why the rule compares against the whole.
assert.equal(checkAllocation({ cost: 1000, otherPaymentsTotal: 800, amount: 300 }).ok, false);

// A payment on account settles no particular treatment, so nothing bounds it. The caller expresses
// that by not consulting this at all, but a zero-cost call must not accidentally refuse.
assert.equal(checkAllocation({ cost: 0, otherPaymentsTotal: 0, amount: 5000 }).ok, true);

// A charge with no price on it yet. `remaining` would be zero and every payment refused; an
// unpriced treatment is a different problem and blocking the till over it is the worse failure.
assert.equal(checkAllocation({ cost: 0, otherPaymentsTotal: 200, amount: 500 }).ok, true);

// --- repairing what is already in the books ----------------------------------------------------
// The whole point of this exercise: the 1,400 sitting on a 200 EGP charge has to be fixable. An
// edit that moves the figure down is allowed even though the result is still over.
{
  const verdict = checkAllocation({
    cost: 200,
    otherPaymentsTotal: 0,
    amount: 1400,
    previousAmount: 1400,
  });
  assert.equal(verdict.ok, true, "no-op edit of an over-allocated row must not be refused");
}
{
  const verdict = checkAllocation({
    cost: 200,
    otherPaymentsTotal: 0,
    amount: 900,
    previousAmount: 1400,
  });
  assert.equal(verdict.ok, true, "dragging an over-allocation down must be allowed");
}
// Dragging it up is not.
{
  const verdict = checkAllocation({
    cost: 200,
    otherPaymentsTotal: 0,
    amount: 1600,
    previousAmount: 1400,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.excess, 1400);
}
// And the leniency belongs to the row's own history, not to any row. Moving a 1,400 payment onto a
// charge it was never on is a fresh over-allocation, so the caller passes previousAmount: null.
{
  const verdict = checkAllocation({
    cost: 200,
    otherPaymentsTotal: 0,
    amount: 1400,
    previousAmount: null,
  });
  assert.equal(verdict.ok, false);
}

// --- reporting the ones already there ----------------------------------------------------------
assert.equal(overAllocation(200, 1400), 1200);
assert.equal(overAllocation(1200, 1200), 0);
assert.equal(overAllocation(1200, 400), 0);
// Half-cent rounding must not invent an overpayment badge on a fully-settled charge.
assert.equal(overAllocation(100.1, 100.1), 0);

// --- what a charge is worth, across three generations of row shape -----------------------------
// A row this app writes today: both fields, in agreement.
assert.equal(chargeAmount({ cost: 1200, amount: 1200 }), 1200);
// A row old enough to predate `cost`. Pricing this at zero would wave every payment against it
// through the guard, so the check would stop applying to exactly the oldest records.
assert.equal(chargeAmount({ amount: 800 }), 800);
// A row carrying `amount: 0` as a placeholder beside a real cost. Reading `amount` first would
// report every payment against it as an overpayment.
assert.equal(chargeAmount({ cost: 500, amount: 0 }), 500);
// Genuinely unpriced.
assert.equal(chargeAmount({ cost: 0, amount: 0 }), 0);
assert.equal(chargeAmount({}), 0);

console.log("paymentAllocation: all assertions passed");
