// Who may put a patient's payment on a day that has already closed (lib/pastDayLock), and that the
// ledger route asks before it writes.
//
// The failures that matter: the lock refusing an Owner or Admin, or anyone at a clinic that never
// turned it on (every live clinic, on the day this ships); the edit dialog's re-sent date and
// amount reading as a change, so fixing last week's note is refused; a move ONTO today from a
// closed day slipping through; and the route's UTC default date refusing a payment taken just
// after midnight in Cairo.
//
// Run with tsx: npm run test:past-day-lock
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { refusesPastPayment, refusesPastPaymentEdit } from "../src/lib/pastDayLock";
import { parseDiscountSettings } from "../src/lib/priceLists";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const today = "2026-10-24";
const on = { locked: true, today };

// --- 1. The setting: off unless the clinic turns it on ----------------------------------------------
{
  eq(parseDiscountSettings(null).lockPastPaymentsNonAdmin, false, "a clinic that never opened the screen: off");
  eq(parseDiscountSettings({ maxDiscountPercentNonAdmin: 20 }).lockPastPaymentsNonAdmin, false, "an existing policy doc without the field: off");
  eq(parseDiscountSettings({ lockPastPaymentsNonAdmin: "yes" }).lockPastPaymentsNonAdmin, false, "only a real true turns it on");
  eq(parseDiscountSettings({ lockPastPaymentsNonAdmin: true }).lockPastPaymentsNonAdmin, true, "on");
}

// --- 2. A new payment ------------------------------------------------------------------------------
{
  eq(refusesPastPayment({ ...on, role: "Receptionist", date: "2026-10-21" }), true, "the desk, an earlier day, lock on: refused");
  eq(refusesPastPayment({ ...on, role: "Receptionist", date: today }), false, "today: fine");
  eq(refusesPastPayment({ ...on, role: "Receptionist", date: "2026-10-25" }), false, "a later day is not a closed one");
  eq(refusesPastPayment({ ...on, role: "Receptionist", date: "" }), false, "no date sent: the server dates it, not the desk");
  eq(refusesPastPayment({ ...on, role: "Owner", date: "2026-10-21" }), false, "an Owner may");
  eq(refusesPastPayment({ ...on, role: "Admin", date: "2026-10-21" }), false, "an Admin may");
  eq(refusesPastPayment({ locked: false, today, role: "Receptionist", date: "2026-10-21" }), false, "lock off: as before");
}

// --- 3. An edit ------------------------------------------------------------------------------------
{
  const desk = { ...on, role: "Receptionist" };
  const ten = { date: today, paid: 10000, amount: 10000 };
  // DENT INN, 24 Oct: entered today, then its date changed to the 21st.
  eq(refusesPastPaymentEdit({ ...desk, before: ten, patch: { date: "2026-10-21", paid: 10000 } }), true, "moving today's payment onto a closed day: refused");
  eq(refusesPastPaymentEdit({ ...desk, role: "Admin", before: ten, patch: { date: "2026-10-21", paid: 10000 } }), false, "an Admin may move it");
  eq(refusesPastPaymentEdit({ ...desk, locked: false, before: ten, patch: { date: "2026-10-21" } }), false, "lock off: as before");

  const old = { date: "2026-10-21", paid: 1500, amount: 1500 };
  eq(refusesPastPaymentEdit({ ...desk, before: old, patch: { date: today } }), true, "moving a closed day's payment onto today: refused too (the 21st loses it)");
  eq(refusesPastPaymentEdit({ ...desk, before: old, patch: { paid: 1200 } }), true, "changing the amount on a closed day: refused");
  eq(refusesPastPaymentEdit({ ...desk, before: old, patch: { date: "2026-10-21", paid: 1500 } }), false, "the edit dialog re-sends date and amount unchanged: not a change");
  eq(refusesPastPaymentEdit({ ...desk, before: { date: "2026-10-21T18:30:00.000Z", paid: 1500 }, patch: { date: "2026-10-21", paid: "1500.00" } }), false, "a stored timestamp and a re-sent string amount are still the same day and figure");
  eq(refusesPastPaymentEdit({ ...desk, before: old, patch: {} }), false, "a note or the link to a treatment: fine");
  eq(refusesPastPaymentEdit({ ...desk, before: { date: "2026-10-21", amount: 1500 }, patch: { paid: 1500 } }), false, "an old row with only `amount`: compared against it");
  eq(refusesPastPaymentEdit({ ...desk, before: ten, patch: { paid: 9000 } }), false, "changing today's amount: fine");
  eq(refusesPastPaymentEdit({ ...desk, before: ten, patch: { date: "2026-10-26" } }), false, "today to a later day: neither side is closed");
}

// --- 4. Wiring: the route asks before it writes -----------------------------------------------------
{
  const route = readFileSync(new URL("../src/app/api/finance/ledger/route.ts", import.meta.url), "utf8");
  eq(/const sentDate = [^\n]+body\.date[^\n]+: "";/.test(route) && /refusesPastPayment\(\{ locked, role: actor\.role, today: clinicToday\(\), date: sentDate \}\)/.test(route), true,
    "create-payment checks only a date the screen sent, never the route's UTC default");
  eq(/const clinicToday = \(\) => ymdInTimeZone\(clinicTimeZone\(\)\);/.test(route), true, "today is the clinic's day, not UTC");
  eq(/if \(type === "payment" && refusesPastPaymentEdit\(\{ locked: pastDayLocked, role: actor\.role, today, before, patch: update \}\)\) \{\s+throw new Error\(PAST_DAY_LOCKED\);/.test(route), true,
    "update checks inside the transaction, against the stored row");
  eq(route.indexOf("refusesPastPaymentEdit(") < route.indexOf("const beforeProcedureId"), true, "before anything is computed for the write");
  eq(/case PAST_DAY_LOCKED:\s+return bad\(PAST_DAY_LOCKED_MESSAGE, 403\);/.test(route), true, "the refusal reaches the screen as a sentence");
  eq(/if \(isFullAccessRole\(actor\.role\)\) return false;/.test(route), true, "an Owner or Admin's write never pays for the settings read");
  const screen = readFileSync(new URL("../src/components/settings/PriceListSettings.tsx", import.meta.url), "utf8");
  eq(/checked=\{settings\.lockPastPaymentsNonAdmin\}/.test(screen), true, "the switch is on the discount policy screen");
}

console.log(`past day lock: ${checks} checks passed`);
