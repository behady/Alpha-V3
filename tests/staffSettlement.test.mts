/**
 * Staff settlements: payouts and deductions poured over a dentist's earnings, oldest first.
 *
 *   npm run test:staff-settlement
 */
import assert from "node:assert/strict";
import { owedBefore, parseSettlement, settleEarnings, settledInPeriod, unpaidBefore, type Earning, type StaffSettlement } from "../src/lib/staffSettlement";

const earnings: Earning[] = [
  { key: "pay-b", date: "2026-09-10", amount: 300 },
  { key: "pay-a", date: "2026-09-02", amount: 500 },
  { key: "claim1#2", date: "2026-10-07", amount: 161 },
  { key: "pay-c", date: "2026-10-01", amount: 200 },
];
const s = (id: string, kind: "payout" | "deduction", amount: number, date: string): StaffSettlement => ({ id, staffId: "s1", kind, amount, date, note: "", method: kind === "payout" ? "Cash" : null, ledgerId: null });

// --- nothing settled -------------------------------------------------------------------------------
{
  const r = settleEarnings(earnings, []);
  assert.equal(r.earned, 1161);
  assert.equal(r.owed, 1161);
  assert.deepEqual(r.byKey.get("pay-a"), { paid: 0, deducted: 0, remaining: 500 });
}

// --- one payout covers the oldest lines first, and part of the next ------------------------------
{
  const r = settleEarnings(earnings, [s("x1", "payout", 700, "2026-10-05")]);
  assert.deepEqual(r.byKey.get("pay-a"), { paid: 500, deducted: 0, remaining: 0 }, "oldest line fully paid");
  assert.deepEqual(r.byKey.get("pay-b"), { paid: 200, deducted: 0, remaining: 100 }, "next line half paid");
  assert.deepEqual(r.byKey.get("pay-c"), { paid: 0, deducted: 0, remaining: 200 });
  assert.equal(r.paid, 700);
  assert.equal(r.owed, 461);
  assert.equal(r.ahead, 0);
}

// --- a deduction is taken the same way, and the line says which part was cash -------------------
{
  const r = settleEarnings(earnings, [s("x1", "payout", 450, "2026-09-20"), s("x2", "deduction", 100, "2026-09-25")]);
  assert.deepEqual(r.byKey.get("pay-a"), { paid: 450, deducted: 50, remaining: 0 });
  assert.deepEqual(r.byKey.get("pay-b"), { paid: 0, deducted: 50, remaining: 250 });
  assert.equal(r.deducted, 100);
  assert.equal(r.owed, 611, "1161 − 450 − 100");
}

// --- paid beyond the work: owed goes negative rather than the money vanishing ----------------------
{
  const r = settleEarnings(earnings, [s("x1", "payout", 1500, "2026-10-08")]);
  assert.equal(r.ahead, 339);
  assert.equal(r.owed, -339);
  assert.equal(r.byKey.get("claim1#2")?.remaining, 0);
}

// --- what a period inherits, and what was settled inside it ---------------------------------------
{
  const pool = [s("x1", "payout", 600, "2026-09-30"), s("x2", "payout", 100, "2026-10-03"), s("x3", "deduction", 50, "2026-10-04")];
  const r = settleEarnings(earnings, pool);
  assert.equal(owedBefore(r, earnings, "2026-10-01"), 50, "800 of September work, 750 settled: 50 carried into October");
  assert.deepEqual(settledInPeriod(pool, { start: "2026-10-01", end: "2026-10-31" }), { paid: 100, deducted: 50 });
  // The carried figure is never a bare number: the lines behind it, oldest first, fully paid ones left out.
  assert.deepEqual(unpaidBefore(r, earnings, "2026-10-01"), [{ key: "pay-b", date: "2026-09-10", remaining: 50 }]);
  assert.deepEqual(unpaidBefore(r, earnings, "2026-09-01"), [], "nothing dated before September");
}

// --- an insurance line dated before the period is listed, not just added to the carried total ----
{
  const work: Earning[] = [{ key: "claim9#0", date: "2026-09-14", amount: 590 }];
  const r = settleEarnings(work, []);
  assert.equal(owedBefore(r, work, "2026-10-01"), 590);
  assert.deepEqual(unpaidBefore(r, work, "2026-10-01"), [{ key: "claim9#0", date: "2026-09-14", remaining: 590 }]);
}

// --- settlement order decides cash vs deduction on a shared line, never the total ----------------
{
  const a = settleEarnings([{ key: "k", date: "2026-09-01", amount: 100 }], [s("p", "payout", 60, "2026-09-02"), s("d", "deduction", 60, "2026-09-03")]);
  assert.deepEqual(a.byKey.get("k"), { paid: 60, deducted: 40, remaining: 0 });
  assert.equal(a.ahead, 20);
  assert.equal(a.owed, -20);
}

// --- a paid-daily dentist: each day's automatic payout pays exactly its own payments -------------
{
  const daily = (id: string, amount: number, date: string, paymentIds: string[]): StaffSettlement => ({ ...s(id, "payout", amount, date), auto: "daily", paymentIds });
  // An older insurance line is still unpaid; the day's line must not be swallowed by it.
  const work: Earning[] = [
    { key: "claim1#0", date: "2026-09-01", amount: 400 },
    { key: "pay-1", date: "2026-10-01", amount: 300 },
    { key: "pay-2", date: "2026-10-01", amount: 200 },
    { key: "pay-3", date: "2026-10-02", amount: 100 },
  ];
  const r = settleEarnings(work, [daily("d1", 500, "2026-10-01", ["pay-1", "pay-2"]), daily("d2", 100, "2026-10-02", ["pay-3"])]);
  assert.deepEqual(r.byKey.get("pay-1"), { paid: 300, deducted: 0, remaining: 0 });
  assert.deepEqual(r.byKey.get("pay-2"), { paid: 200, deducted: 0, remaining: 0 });
  assert.deepEqual(r.byKey.get("pay-3"), { paid: 100, deducted: 0, remaining: 0 });
  assert.deepEqual(r.byKey.get("claim1#0"), { paid: 0, deducted: 0, remaining: 400 }, "the insurance line stays owed");
  assert.equal(r.owed, 400);

  // A manual payout afterwards goes oldest-first over what is still unpaid, skipping the paid days.
  const m = settleEarnings(work, [daily("d1", 500, "2026-10-01", ["pay-1", "pay-2"]), s("m1", "payout", 150, "2026-09-15")]);
  assert.deepEqual(m.byKey.get("claim1#0"), { paid: 150, deducted: 0, remaining: 250 });
  assert.deepEqual(m.byKey.get("pay-3"), { paid: 0, deducted: 0, remaining: 100 });
  assert.equal(m.paid, 650);
  assert.equal(m.owed, 350);

  // A day's line larger than its payments (a payment shrank, not re-synced yet): the extra is not lost.
  const big = settleEarnings([{ key: "pay-1", date: "2026-10-01", amount: 300 }, { key: "pay-9", date: "2026-10-05", amount: 50 }], [daily("d1", 400, "2026-10-01", ["pay-1"])]);
  assert.deepEqual(big.byKey.get("pay-1"), { paid: 300, deducted: 0, remaining: 0 });
  assert.deepEqual(big.byKey.get("pay-9"), { paid: 50, deducted: 0, remaining: 0 }, "the extra 100 is poured oldest-first like any payout");
  assert.equal(big.ahead, 50);
  assert.equal(big.owed, -50);
}

// --- stored shape ---------------------------------------------------------------------------------
{
  const auto = parseSettlement("daily_s1_2026-10-05_all", { staffId: "s1", kind: "payout", amount: 700, date: "2026-10-05", auto: "daily", paymentIds: ["p1", "p2", 7, ""] });
  assert.equal(auto?.auto, "daily");
  assert.deepEqual(auto?.paymentIds, ["p1", "p2"], "only real ids are kept");
  assert.equal(parseSettlement("x", { staffId: "s1", kind: "payout", amount: 700, date: "2026-10-05", auto: "weekly" })?.auto, undefined, "unknown auto kinds are ordinary payouts");
  assert.deepEqual(parseSettlement("id1", { staffId: "s1", kind: "payout", amount: "250.5", date: "2026-10-05", note: " cash ", ledgerId: "L1" }), {
    id: "id1", staffId: "s1", kind: "payout", amount: 250.5, date: "2026-10-05", note: "cash", method: "Cash", ledgerId: "L1",
  }, "a payout saved before methods existed reads as cash");
  assert.equal(parseSettlement("id1b", { staffId: "s1", kind: "payout", amount: 10, date: "2026-10-05", method: "InstaPay" })?.method, "InstaPay");
  assert.equal(parseSettlement("id1c", { staffId: "s1", kind: "deduction", amount: 10, date: "2026-10-05", method: "Cash" })?.method, null, "a deduction moves no cash");
  assert.equal(parseSettlement("id2", { staffId: "s1", kind: "refund", amount: 10, date: "2026-10-05" }), null, "unknown kind");
  assert.equal(parseSettlement("id3", { staffId: "s1", kind: "payout", amount: 0, date: "2026-10-05" }), null, "zero amount");
  assert.equal(parseSettlement("id4", { staffId: "s1", kind: "payout", amount: 10, date: "5/10/2026" }), null, "bad date");
  assert.equal(parseSettlement("id5", "junk"), null);
}

console.log("staff settlement: all checks passed");
