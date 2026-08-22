// Fixture test for the one place a ledger row is built. Run with tsx so the TS module loads.
//
// This arithmetic decides what a dentist is paid. Two of the four screens that took payments used
// to skip it entirely, so every case here is a shape that reached production.
import assert from "node:assert/strict";
import {
  buildManualEntryRow,
  buildPaymentRow,
  firstPaymentIdFor,
  recalcProcedurePayments,
  resolveDoctorForPayment,
  sumPayments,
} from "../src/lib/ledgerWrite.ts";

const staff = [
  { id: "d_ahmed", name: "Dr. Ahmed", commissionPercentage: 30 },
  { id: "d_sara", name: "Dr. Sara", commissionPercentage: 50 },
  { id: "d_zero", name: "Dr. Locum", commissionPercentage: 0 },
];

const actor = { uid: "u1", name: "Reception" };

// --- resolving the dentist ---------------------------------------------------------------------

assert.equal(resolveDoctorForPayment({ id: "p1", doctorId: "d_ahmed" }, staff)?.id, "d_ahmed");

// A legacy procedure with only the display name still finds the staff record.
assert.equal(resolveDoctorForPayment({ id: "p1", doctorName: "Dr. Sara" }, staff)?.id, "d_sara");
// ...including the older `doctor` field, and case-insensitively.
assert.equal(resolveDoctorForPayment({ id: "p1", doctor: "  dr. sara " }, staff)?.id, "d_sara");

// A name matching nobody must return null rather than guessing — a wrong attribution moves real
// money on a payroll report.
assert.equal(resolveDoctorForPayment({ id: "p1", doctorName: "Dr. Nobody" }, staff), null);

// A dentist who has left keeps their identity but earns no percentage we can invent.
const departed = resolveDoctorForPayment({ id: "p1", doctorId: "d_gone", doctorName: "Dr. Gone" }, staff);
assert.equal(departed?.id, "d_gone");
assert.equal(departed?.commissionPercentage, 0);

// No procedure at all → nobody to attribute to.
assert.equal(resolveDoctorForPayment(null, staff), null);

// --- a payment against a procedure ---------------------------------------------------------------

const crown = { id: "L_crown", doctorId: "d_ahmed", labFee: 400, description: "Crown" };

const first = buildPaymentRow({
  patientId: "pat1", patientName: "Mona",
  amount: 1000, date: "2026-08-01", description: "Payment for Crown",
  procedure: crown, appliedLabFee: 400, staff, actor,
});

assert.equal(first.type, "payment");
assert.equal(first.procedureId, "L_crown");
assert.equal(first.doctorId, "d_ahmed");
assert.equal(first.doctorName, "Dr. Ahmed");
assert.equal(first.labFee, 400);
assert.equal(first.doctorCommissionPercentage, 30);
// The lab is paid first; the dentist's share is of what remains.
assert.equal(first.doctorCommissionAmount, 180, "(1000 - 400) * 30%");
assert.equal(first.clinicProfit, 420, "1000 - 180 - 400");
assert.equal(first.paid, 1000);
assert.equal(first.amount, 1000, "amount must mirror paid, not sit at 0 like the legacy shape");
assert.equal(first.cost, 0);
assert.equal(first.category, "Treatment Payment");
assert.equal(first.receivedBy, "Reception");

// The second instalment carries no lab fee — it is charged once, on the earliest payment.
const second = buildPaymentRow({
  patientId: "pat1", amount: 1000, date: "2026-08-20", description: "Payment for Crown",
  procedure: crown, appliedLabFee: 0, staff, actor,
});
assert.equal(second.labFee, 0);
assert.equal(second.doctorCommissionAmount, 300, "full 30% once the lab is already paid");
assert.equal(second.clinicProfit, 700);

// --- the bug this module exists to prevent -------------------------------------------------------

// The appointment side panel used to write a payment with no attribution at all. The same call now
// resolves the dentist from the procedure without the caller having to know how.
const fromSidePanel = buildPaymentRow({
  patientId: "pat1", amount: 500, date: "2026-08-02", description: "Payment",
  procedure: crown, appliedLabFee: 0, staff, actor,
});
assert.equal(fromSidePanel.doctorId, "d_ahmed", "a payment must never lose its dentist");
assert.equal(fromSidePanel.doctorCommissionAmount, 150);
assert.notEqual(fromSidePanel.clinicProfit, 500, "the clinic must not keep the dentist's share");

// --- a general payment ----------------------------------------------------------------------------

const general = buildPaymentRow({
  patientId: "pat1", amount: 250, date: "2026-08-03", description: "On account",
  procedure: null, staff, actor,
});
assert.equal(general.procedureId, null);
assert.equal(general.doctorId, null);
// Explicit zeroes, not absent fields: "attributed, nothing owed" must be distinguishable from
// "nobody ever worked this out". The repair script relies on exactly that difference.
assert.equal(general.doctorCommissionPercentage, 0);
assert.equal(general.doctorCommissionAmount, 0);
assert.equal(general.labFee, 0);
assert.equal(general.clinicProfit, 250);
assert.equal(general.category, "Advance Payment");

// A lab fee cannot attach to a payment that settles no procedure.
const strayLab = buildPaymentRow({
  patientId: "pat1", amount: 250, date: "2026-08-03", description: "On account",
  procedure: null, appliedLabFee: 400, staff, actor,
});
assert.equal(strayLab.labFee, 0);

// A dentist on 0% is attributed but earns nothing — different from being unattributed.
const locum = buildPaymentRow({
  patientId: "pat1", amount: 300, date: "2026-08-04", description: "Payment",
  procedure: { id: "L2", doctorId: "d_zero" }, staff, actor,
});
assert.equal(locum.doctorId, "d_zero");
assert.equal(locum.doctorCommissionAmount, 0);
assert.equal(locum.clinicProfit, 300);

// --- refusals --------------------------------------------------------------------------------------

assert.throws(() => buildPaymentRow({ patientId: "p", amount: 0, date: "2026-08-01", description: "x" }), /positive/);
assert.throws(() => buildPaymentRow({ patientId: "p", amount: -5, date: "2026-08-01", description: "x" }), /positive/);
assert.throws(() => buildPaymentRow({ patientId: "", amount: 10, date: "2026-08-01", description: "x" }), /patient/);
assert.throws(() => buildPaymentRow({ patientId: "p", amount: 10, date: "01/08/2026", description: "x" }), /YYYY-MM-DD/);

// --- clinic income and expense ------------------------------------------------------------------------

const expense = buildManualEntryRow({
  type: "expense", amount: 1200, description: "Rent", category: "Overheads",
  date: "2026-08-01", isRecurring: true, actor,
});
assert.equal(expense.cost, 1200, "the finance dashboard reads an expense from cost");
assert.equal(expense.paid, 0);
assert.equal(expense.amount, 1200);
assert.equal(expense.isRecurring, true);
assert.equal(expense.patientId, null, "clinic money belongs to no patient");

const income = buildManualEntryRow({
  type: "income", amount: 800, description: "Equipment sale", date: "2026-08-01", actor,
});
assert.equal(income.paid, 800, "the finance dashboard reads income from paid");
assert.equal(income.cost, 0);
assert.equal(income.isRecurring, false, "only an expense can recur");

assert.throws(() => buildManualEntryRow({ type: "expense", amount: 0, description: "x", date: "2026-08-01" }), /positive/);

// --- rebalancing a procedure's payments ----------------------------------------------------------------

const payments = [
  { id: "b", date: "2026-08-20", paid: 1000 },
  { id: "a", date: "2026-08-01", paid: 1000 },
  { id: "c", date: "2026-08-20", paid: 500 },  // same date as b — id breaks the tie
];

assert.equal(firstPaymentIdFor(payments), "a");
assert.equal(firstPaymentIdFor([]), null);
assert.equal(sumPayments(payments), 2500);
// The legacy shape: real value in `paid`, `amount` left at 0 as a placeholder.
assert.equal(sumPayments([{ amount: 0, paid: 700 }]), 700);

const rebalanced = recalcProcedurePayments({ payments, labFee: 400, commissionPct: 30 });
const byId = Object.fromEntries(rebalanced.map((r) => [r.id, r]));

assert.equal(byId.a.labFee, 400, "the earliest payment carries the lab fee");
assert.equal(byId.b.labFee, 0);
assert.equal(byId.c.labFee, 0);
assert.equal(byId.a.doctorCommissionAmount, 180, "(1000 - 400) * 30%");
assert.equal(byId.b.doctorCommissionAmount, 300);
assert.equal(byId.c.doctorCommissionAmount, 150);

// Deleting the earliest payment must move the lab fee onto the next one, not lose it.
const afterDeletingA = recalcProcedurePayments({
  payments: payments.filter((p) => p.id !== "a"),
  labFee: 400,
  commissionPct: 30,
});
const afterById = Object.fromEntries(afterDeletingA.map((r) => [r.id, r]));
assert.equal(afterById.b.labFee, 400, "the lab fee must follow the new earliest payment");
assert.equal(afterById.c.labFee, 0);
assert.equal(
  afterDeletingA.reduce((s, r) => s + r.labFee, 0),
  400,
  "the lab is paid exactly once, however the payments change"
);

console.log("✓ ledgerWrite: every payment carries its dentist, and the lab fee is charged exactly once");
