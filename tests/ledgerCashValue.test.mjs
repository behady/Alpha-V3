// Fixture test for ledgerCashValue, the money-per-ledger-row helper the Reports Center runs on.
// Run with tsx so the TS module loads directly.
import assert from "node:assert/strict";
import { ledgerCashValue } from "../src/lib/reportHelpers.ts";

const cases = [
  // --- The regression this helper exists for -------------------------------------------------
  // AppointmentSidePanel and the AI pending-action writer both store `amount: 0` as a placeholder
  // and put the real money in `paid`. A `?? amount` chain reads these as free, which is what made
  // every Reports Center tab show 0 income.
  ["inline appointment payment (amount placeholder)", { type: "payment", amount: 0, paid: 350 }, 350],
  ["AI-recorded payment (amount placeholder)", { type: "payment", amount: 0, paid: 1200 }, 1200],

  // --- Payment shapes that already worked, and must keep working ------------------------------
  ["QuickPaymentModal payment (both fields set)", { type: "payment", amount: 500, paid: 500, cost: 0 }, 500],
  ["PatientFinance payment (both fields set)", { type: "payment", amount: 275, paid: 275, cost: 0 }, 275],
  ["payment with only paid", { type: "payment", paid: 90 }, 90],
  ["payment with only amount", { type: "payment", amount: 90 }, 90],

  // --- Manual finance entries ------------------------------------------------------------------
  ["manual income", { type: "income", amount: 800, paid: 800, cost: 0 }, 800],
  ["manual expense", { type: "expense", amount: 640, paid: 0, cost: 640 }, 640],
  // Mirror of the payment bug on the expense side: cost left at 0, real value in amount.
  ["expense with cost placeholder", { type: "expense", cost: 0, amount: 640 }, 640],

  // --- Procedures are treatment plans, not cash -------------------------------------------------
  // A charge is only money in the drawer once something is paid against it; `cost`/`amount` here
  // are the plan total and would double-count against the payment rows that settle them.
  ["unpaid procedure", { type: "procedure", cost: 3000, amount: 3000, paid: 0 }, 0],
  ["part-paid procedure", { type: "procedure", cost: 3000, amount: 3000, paid: 1000 }, 1000],

  // --- Junk in, zero out ------------------------------------------------------------------------
  ["missing money fields", { type: "payment" }, 0],
  ["null money fields", { type: "payment", amount: null, paid: null }, 0],
  ["non-numeric money", { type: "payment", paid: "abc", amount: "xyz" }, 0],
  ["numeric string", { type: "payment", amount: 0, paid: "450" }, 450],
  ["no type at all", { amount: 0, paid: 75 }, 75],
];

let failures = 0;
for (const [label, row, expected] of cases) {
  const actual = ledgerCashValue(row);
  try {
    assert.equal(actual, expected);
    console.log(`  ok  ${label} -> ${actual}`);
  } catch {
    failures += 1;
    console.error(`FAIL  ${label}: expected ${expected}, got ${actual}`);
  }
}

// The whole-report shape: a clinic that collected 350 + 500 + 800 and spent 640, with a 3000
// treatment plan still outstanding. Income must be 1650, not 0 and not 4650.
const ledger = [
  { type: "payment", amount: 0, paid: 350 },
  { type: "payment", amount: 500, paid: 500, cost: 0 },
  { type: "income", amount: 800, paid: 800, cost: 0 },
  { type: "expense", amount: 640, paid: 0, cost: 640 },
  { type: "procedure", cost: 3000, amount: 3000, paid: 0 },
];
const income = ledger
  .filter((r) => r.type !== "expense" && r.type !== "procedure")
  .reduce((sum, r) => sum + ledgerCashValue(r), 0);
const expenses = ledger
  .filter((r) => r.type === "expense")
  .reduce((sum, r) => sum + ledgerCashValue(r), 0);

try {
  assert.equal(income, 1650);
  assert.equal(expenses, 640);
  console.log(`  ok  report totals -> income ${income}, expenses ${expenses}`);
} catch {
  failures += 1;
  console.error(`FAIL  report totals: expected income 1650 / expenses 640, got ${income} / ${expenses}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + 1} checks passed.`);
