// The Finance page filter: every field set must hold (AND); an empty filter keeps everything.
import assert from "node:assert/strict";
import { applyFinanceFilters, EMPTY_FINANCE_FILTER, type FinanceFilter } from "../src/lib/financeFilters";

type R = { id: string } & Record<string, unknown>;
const rows: R[] = [
  { id: "ch1", type: "procedure", cost: 1584, amount: 1584, paid: 800, payerId: "gasco", doctorId: "d1", patientName: "ليلى هاني", patientPhone: "01001112222", description: "Crown" },
  { id: "ch2", type: "procedure", cost: 500, amount: 500, paid: 500, payerId: "private", doctorId: "d2", patientName: "Omar Said", patientPhone: "01200000000", description: "Filling" },
  { id: "pay1", type: "payment", paid: 500, amount: 500, method: "Cash", payerId: "gasco", doctorId: "d1", patientName: "ليلى هاني", receiptNumber: "HEL-0007", receivedBy: "Desk Hel", category: "Treatment Payment" },
  { id: "pay2", type: "payment", paid: 300, amount: 300, method: "Insurance", payerId: "gasco", doctorId: "d1", patientName: "ليلى هاني", receiptNumber: "TAG-0002", receivedBy: "Owner", category: "Treatment Payment" },
  { id: "pay3", type: "payment", paid: 500, amount: 500, method: "Card", payerId: "private", doctorId: "d2", patientName: "Omar Said", receiptNumber: "HEL-0008", receivedBy: "Desk Hel", category: "Treatment Payment" },
  { id: "inc1", type: "income", amount: 800, paid: 800, method: "Cash", category: "Rental", receivedBy: "Owner" },
  { id: "exp1", type: "expense", cost: 640, amount: 640, category: "Rent", method: "Cash" },
];
const ids = (f: Partial<FinanceFilter>) => applyFinanceFilters(rows, { ...EMPTY_FINANCE_FILTER, ...f }).map((r) => r.id);

assert.deepEqual(ids({}), rows.map((r) => r.id), "the empty filter returns every row");
assert.deepEqual(ids({ kind: "payment" }), ["pay1", "pay2", "pay3"]);
assert.deepEqual(ids({ kind: "income" }), ["inc1"]);
assert.deepEqual(ids({ kind: "expense" }), ["exp1"]);
assert.deepEqual(ids({ kind: "payment", method: "Cash" }), ["pay1"], "kind and method are ANDed");
assert.deepEqual(ids({ method: "Cash" }), ["pay1", "inc1", "exp1"]);
assert.deepEqual(ids({ payerId: "gasco" }), ["ch1", "pay1", "pay2"]);
assert.deepEqual(ids({ payerId: "private" }), ["ch2", "pay3"]);
assert.deepEqual(ids({ doctorId: "d2" }), ["ch2", "pay3"]);
assert.deepEqual(ids({ category: "Rent" }), ["exp1"]);
assert.deepEqual(ids({ receivedBy: "Owner" }), ["pay2", "inc1"]);
assert.deepEqual(ids({ receiptQuery: "hel-" }), ["pay1", "pay3"], "receipt is a case-insensitive substring");
assert.deepEqual(ids({ receiptQuery: "0007" }), ["pay1"]);

// patientQuery: name or phone, case and Arabic-spelling insensitive.
assert.deepEqual(ids({ patientQuery: "ليلى" }), ["ch1", "pay1", "pay2"]);
assert.deepEqual(ids({ patientQuery: "ليلي" }), ["ch1", "pay1", "pay2"], "ى and ي are one letter");
assert.deepEqual(ids({ patientQuery: "omar" }), ["ch2", "pay3"]);
assert.deepEqual(ids({ patientQuery: "OMAR sa" }), ["ch2", "pay3"]);
assert.deepEqual(ids({ patientQuery: "0120" }), ["ch2"], "matches the phone");
assert.deepEqual(ids({ patientQuery: "   " }), rows.map((r) => r.id), "blank query is no filter");

// Amounts use the row's cash value (a charge counts what has been paid on it).
assert.deepEqual(ids({ amountMin: 600 }), ["ch1", "inc1", "exp1"]);
assert.deepEqual(ids({ amountMax: 400 }), ["pay2"]);
assert.deepEqual(ids({ amountMin: 500, amountMax: 640 }), ["ch2", "pay1", "pay3", "exp1"], "both ends inclusive");

// Only outstanding: charges with something left; payments and settled charges drop out.
assert.deepEqual(ids({ onlyOutstanding: true }), ["ch1"]);

// Two filters at once are ANDed; clearing them restores every row.
assert.deepEqual(ids({ payerId: "gasco", kind: "payment", method: "Insurance" }), ["pay2"]);
assert.deepEqual(ids({ patientQuery: "ليلى", doctorId: "d2" }), []);
assert.deepEqual(ids({ ...EMPTY_FINANCE_FILTER }), rows.map((r) => r.id));

// Work that names no payer is the clinic's own: it answers to Private; manual entries answer to nobody.
{
  const old = [
    { id: "o1", type: "procedure", cost: 100, paid: 100 },
    { id: "o2", type: "payment", paid: 50 },
    { id: "o3", type: "expense", cost: 10 },
  ];
  const got = applyFinanceFilters(old, { ...EMPTY_FINANCE_FILTER, payerId: "private" }).map((r) => r.id);
  assert.deepEqual(got, ["o1", "o2"]);
}

// The input is never mutated and the result is a new array.
assert.notEqual(applyFinanceFilters(rows, EMPTY_FINANCE_FILTER), rows);
assert.equal(rows.length, 7);

console.log("financeFilters: all cases pass");
