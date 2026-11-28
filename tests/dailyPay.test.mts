/**
 * Paid-daily dentists: the automatic day's share, worked out from the payment rows.
 *
 *   npm run test:daily-pay
 */
import assert from "node:assert/strict";
import { dailyPayDocId, dailyPayLedgerId, dailyPayStart, dailyShares, planDailyPay, type DailyShare } from "../src/lib/dailyPay";
import type { StaffSettlement } from "../src/lib/staffSettlement";

const STAFF = { id: "ehab", name: "Mohamed Ehab" };
const pay = (id: string, date: string, share: number, extra: Record<string, unknown> = {}) => ({
  id, type: "payment", date, doctorId: "ehab", doctorName: "Mohamed Ehab", paid: share * 2, amount: share * 2, doctorCommissionAmount: share, ...extra,
});
const auto = (date: string, amount: number, paymentIds: string[], branchId: string | null = null): StaffSettlement => ({
  id: dailyPayDocId("ehab", date, branchId), staffId: "ehab", kind: "payout", amount, date, note: "", method: "Cash",
  ledgerId: dailyPayLedgerId("ehab", date, branchId), auto: "daily", paymentIds, ...(branchId ? { branchId } : {}),
});

// --- ids are fixed, so re-running is always safe ------------------------------------------------
assert.equal(dailyPayDocId("ehab", "2026-11-01", null), "daily_ehab_2026-11-01_all");
assert.equal(dailyPayDocId("ehab", "2026-11-01", "b2"), "daily_ehab_2026-11-01_b2");
assert.equal(dailyPayLedgerId("ehab", "2026-11-01", null), "dailypay_ehab_2026-11-01_all");

// --- the switch -------------------------------------------------------------------------------
assert.equal(dailyPayStart({ paidDaily: true, paidDailyFrom: "2026-05-22" }), "2026-05-22");
assert.equal(dailyPayStart({ paidDaily: false, paidDailyFrom: "2026-05-22" }), null, "off: nothing is maintained");
assert.equal(dailyPayStart({ paidDaily: true }), null, "on without a start date: nothing is maintained");
assert.equal(dailyPayStart({ paidDaily: "yes", paidDailyFrom: "2026-05-22" }), null, "only a real true counts");
assert.equal(dailyPayStart({}), null);
assert.equal(dailyPayStart(null), null);

// --- one line per day (and branch), summing that day's shares --------------------------------------
{
  const rows = [
    pay("p1", "2026-11-01", 700),
    pay("p2", "2026-11-01", 300),
    pay("p3", "2026-11-02", 250, { branchId: "b2" }),
    pay("p4", "2026-11-02", 50),
    pay("p5", "2026-11-03", 0), // a payment that earned nothing makes no line
    { id: "t1", type: "procedure", date: "2026-11-01", doctorId: "ehab", doctorCommissionAmount: 999 }, // treatments never count
    pay("p6", "2026-11-04", 400, { claimId: "c1" }), // insurance work is not taken from the payment
  ];
  const shares = dailyShares(rows, STAFF);
  assert.deepEqual([...shares.keys()].sort(), ["daily_ehab_2026-11-01_all", "daily_ehab_2026-11-02_all", "daily_ehab_2026-11-02_b2"]);
  assert.deepEqual(shares.get("daily_ehab_2026-11-01_all"), { id: "daily_ehab_2026-11-01_all", date: "2026-11-01", branchId: null, amount: 1000, paymentIds: ["p1", "p2"] });
  assert.deepEqual(shares.get("daily_ehab_2026-11-02_b2"), { id: "daily_ehab_2026-11-02_b2", date: "2026-11-02", branchId: "b2", amount: 250, paymentIds: ["p3"] });
}

// --- the plan: create, update, delete, leave alone ----------------------------------------------
{
  const staff = { paidDaily: true, paidDailyFrom: "2026-11-01" };
  const shares = new Map<string, DailyShare>([
    ["daily_ehab_2026-11-01_all", { id: "daily_ehab_2026-11-01_all", date: "2026-11-01", branchId: null, amount: 1000, paymentIds: ["p1", "p2"] }],
    ["daily_ehab_2026-11-02_all", { id: "daily_ehab_2026-11-02_all", date: "2026-11-02", branchId: null, amount: 50, paymentIds: ["p4"] }],
    ["daily_ehab_2026-10-31_all", { id: "daily_ehab_2026-10-31_all", date: "2026-10-31", branchId: null, amount: 90, paymentIds: ["p0"] }],
  ]);
  const existing = [
    auto("2026-11-01", 1000, ["p1", "p2"]), // unchanged
    auto("2026-11-02", 80, ["p4", "p9"]), // p9 was deleted
    auto("2026-11-03", 120, ["p7"]), // the day's payments all went away
  ];

  const all = planDailyPay({ staff, shares, existing, dates: "all" });
  assert.deepEqual(all, [
    { kind: "upsert", share: shares.get("daily_ehab_2026-11-02_all") },
    { kind: "delete", id: "daily_ehab_2026-11-03_all" },
  ], "the 31 Oct share is before the start date, so it is not touched");

  // Only the touched days are worked on.
  assert.deepEqual(planDailyPay({ staff, shares, existing, dates: ["2026-11-03"] }), [{ kind: "delete", id: "daily_ehab_2026-11-03_all" }]);
  assert.deepEqual(planDailyPay({ staff, shares, existing, dates: ["2026-11-01"] }), [], "nothing changed that day");

  // A brand-new day.
  const fresh = new Map(shares);
  fresh.set("daily_ehab_2026-11-05_all", { id: "daily_ehab_2026-11-05_all", date: "2026-11-05", branchId: null, amount: 30, paymentIds: ["p8"] });
  assert.deepEqual(planDailyPay({ staff, shares: fresh, existing, dates: ["2026-11-05"] }), [{ kind: "upsert", share: fresh.get("daily_ehab_2026-11-05_all") }]);

  // Same total, different payments: still re-written, so the line names the right payments.
  const swapped = new Map([["daily_ehab_2026-11-01_all", { id: "daily_ehab_2026-11-01_all", date: "2026-11-01", branchId: null, amount: 1000, paymentIds: ["p1", "p3"] }]]);
  assert.equal(planDailyPay({ staff, shares: swapped, existing, dates: ["2026-11-01"] }).length, 1);
}

// --- switched off: every existing line is frozen, nothing new is made --------------------------
{
  const shares = new Map<string, DailyShare>([["daily_ehab_2026-11-09_all", { id: "daily_ehab_2026-11-09_all", date: "2026-11-09", branchId: null, amount: 10, paymentIds: ["x"] }]]);
  assert.deepEqual(planDailyPay({ staff: { paidDaily: false, paidDailyFrom: "2026-11-01" }, shares, existing: [auto("2026-11-03", 120, ["p7"])], dates: "all" }), []);
}

console.log("daily pay: all checks passed");
