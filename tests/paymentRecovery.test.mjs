// Fixture test for the Recover Payments list. Run with tsx so the TS module loads directly.
//
// This is the arithmetic a clinic reads down a phone line to a patient, so every case below is a
// shape confirmed against real clinic data rather than an invented one.
import assert from "node:assert/strict";
import { buildRecoveryList } from "../src/lib/paymentRecovery.ts";

// Frozen so "90 days ago" means the same thing whatever day this test runs.
const NOW = Date.parse("2026-08-12T09:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const ledger = [
  // Ali: charged 1000, paid 400 → owes 600.
  { id: "L1", patientId: "p_ali", type: "procedure", amount: 1000, date: daysAgo(120), description: "Crown" },
  { id: "L2", patientId: "p_ali", type: "payment", paid: 400, date: daysAgo(90) },

  // Sara: fully settled → must NOT appear.
  { id: "L3", patientId: "p_sara", type: "procedure", amount: 500, date: daysAgo(200), description: "Filling" },
  { id: "L4", patientId: "p_sara", type: "payment", paid: 500, date: daysAgo(200) },

  // Omar owes 300 and was seen 5 days ago. The AI audit ignores debts under 45 days old; this
  // list must NOT — a clinic chasing money wants everyone who owes, fresh debts included.
  { id: "L5", patientId: "p_omar", type: "procedure", amount: 300, date: daysAgo(5), description: "Filling" },

  // Clinic overhead — never a patient debt.
  { id: "L6", patientId: "p_ali", type: "expense", cost: 900, date: daysAgo(10) },

  // Legacy payment shape: `amount` left at 0 as a placeholder, real value in `paid`. Reading
  // `amount` here would report Hana as owing 800 when she owes 300.
  { id: "L7", patientId: "p_hana", type: "procedure", amount: 800, date: daysAgo(20), description: "Bridge" },
  { id: "L8", patientId: "p_hana", type: "payment", amount: 0, paid: 500, date: daysAgo(15) },

  // Nour overpaid by 200. A credit is not a debt, and must not net off anyone else's arrears.
  { id: "L9", patientId: "p_nour", type: "procedure", amount: 300, date: daysAgo(30), description: "Scaling" },
  { id: "L10", patientId: "p_nour", type: "payment", paid: 500, date: daysAgo(30) },

  // Mona: the case this detection exists for, taken from a real patient's file. A 200 EGP
  // consultation and a 1,200 EGP root canal, both settled — and a second 1,200 payment, left over
  // from a duplicate treatment that was deleted, sitting on the consultation. Her totals read
  // TREATMENT 1,400 / PAID 2,600 / BALANCE −1,200, and she appears on no report anywhere.
  { id: "L11", patientId: "p_mona", type: "procedure", amount: 200, cost: 200, date: daysAgo(3), description: "كشف" },
  { id: "L12", patientId: "p_mona", type: "payment", paid: 200, procedureId: "L11", date: daysAgo(3) },
  { id: "L13", patientId: "p_mona", type: "payment", paid: 1200, procedureId: "L11", date: daysAgo(3) },
  { id: "L14", patientId: "p_mona", type: "procedure", amount: 1200, cost: 1200, date: daysAgo(3), description: "حشو عصب" },
  { id: "L15", patientId: "p_mona", type: "payment", paid: 1200, procedureId: "L14", date: daysAgo(3) },

  // Tarek: the other shape. The charge his payment settled was deleted and the payment stayed.
  { id: "L16", patientId: "p_tarek", type: "payment", paid: 750, procedureId: "L_deleted", date: daysAgo(9) },

  // Youssef: an unpriced charge. Every payment against it would look like an overpayment if the
  // scan compared against zero, so it must be left alone.
  { id: "L17", patientId: "p_youssef", type: "procedure", amount: 0, date: daysAgo(2), description: "Follow-up" },
  { id: "L18", patientId: "p_youssef", type: "payment", paid: 400, procedureId: "L17", date: daysAgo(2) },
];

const notes = [
  // Billed correctly — carries a ledgerId, so it is not unbilled work.
  { id: "N1", patientId: "p_ali", procedure: "Crown", cost: 1000, ledgerId: "L1", date: daysAgo(120) },

  // Treated, never invoiced. Karim owes nothing on the ledger and would be invisible without this.
  { id: "N2", patientId: "p_karim", procedure: "Root Canal", cost: 1200, date: daysAgo(10) },

  // Zero-cost note — a follow-up or comped visit, not money anyone forgot to collect.
  { id: "N3", patientId: "p_karim", procedure: "Check-up", cost: 0, date: daysAgo(3) },

  // Unbilled work for a patient who ALSO has a ledger balance — both must be counted, separately.
  { id: "N4", patientId: "p_omar", procedure: "X-Ray", cost: 100, date: daysAgo(5) },
];

const patients = [
  { id: "p_ali", name: "Ali Hassan", phone: "01001234567" },
  { id: "p_sara", name: "Sara Fouad", phone: "01009876543" },
  { id: "p_omar", name: "Omar Nabil", mobile: "01111111111" },
  { id: "p_hana", name: "Hana Adel", phone: "01222222222", whatsappOptOut: true },
  { id: "p_nour", name: "Nour Ibrahim", phone: "01333333333" },
  // Deliberately no phone field: the UI has to be able to say "no phone on file".
  { id: "p_karim", name: "Karim Saad" },
  { id: "p_mona", name: "Mona Adel", phone: "01444444444" },
  { id: "p_tarek", name: "Tarek Zaki", phone: "01555555555" },
  { id: "p_youssef", name: "Youssef Amin", phone: "01666666666" },
];

const list = buildRecoveryList("clinic_test", ledger, notes, patients, NOW);
const byId = new Map(list.rows.map((r) => [r.patientId, r]));

// --- who appears at all ---
assert.ok(!byId.has("p_sara"), "a fully settled patient must not appear");
assert.ok(byId.has("p_omar"), "a fresh debt must still appear — this is not the 45-day audit");
assert.ok(byId.has("p_karim"), "unbilled work alone must put a patient on the list");
assert.ok(!byId.has("p_nour"), "a credit balance is not a debt");

// --- the money ---
assert.equal(byId.get("p_ali").balance, 600, "1000 charged minus 400 paid");
assert.equal(byId.get("p_ali").unbilled, 0, "Ali's note carries a ledgerId");
assert.equal(byId.get("p_hana").balance, 300, "legacy payment: 800 charged minus paid=500, not amount=0");
assert.equal(byId.get("p_karim").balance, 0);
assert.equal(byId.get("p_karim").unbilled, 1200, "the zero-cost check-up must not be counted");
assert.equal(byId.get("p_omar").balance, 300);
assert.equal(byId.get("p_omar").unbilled, 100);
assert.equal(byId.get("p_omar").totalOwed, 400, "balance and unbilled work add up but stay separate");

// --- contact details, the whole point of the screen ---
assert.equal(byId.get("p_ali").phone, "01001234567");
assert.equal(byId.get("p_omar").phone, "01111111111", "phone must be found under `mobile` too");
assert.equal(byId.get("p_karim").phone, "", "a patient with no phone reports an empty string, not a guess");
assert.equal(byId.get("p_hana").whatsappOptOut, true, "opt-out must reach the UI so staff call instead");
assert.equal(byId.get("p_karim").patientName, "Karim Saad", "name comes from the patient record, not the note");

// --- ordering and totals ---
assert.equal(list.rows[0].patientId, "p_karim", "biggest debt first — this is a work queue");
assert.equal(list.totals.patients, 4);
assert.equal(list.totals.balance, 600 + 300 + 300, "Ali + Hana + Omar");
assert.equal(list.totals.unbilled, 1200 + 100, "Karim + Omar");
assert.equal(list.totals.totalOwed, list.totals.balance + list.totals.unbilled);

// --- staleness ---
assert.equal(byId.get("p_ali").ageDays, 90, "measured from the most recent ledger activity");
assert.equal(byId.get("p_karim").ageDays, undefined, "no ledger rows means no dated activity to age");

// --- disclosure ---
assert.ok(
  list.notes.some((n) => n.includes("no phone number")),
  "the list must say out loud that someone on it cannot be contacted"
);

// --- payments settling a charge they do not belong to -------------------------------------------
// None of this can show on the debtors list: a credit balance is clamped to zero there, which is
// correct for a call list and means a patient whose books say she is owed 1,200 EGP she never
// received appears nowhere at all.
{
  const byProcedure = new Map(list.misallocations.map((m) => [m.procedureId, m]));

  const mona = byProcedure.get("L11");
  assert.ok(mona, "the 1,200 sitting on a 200 EGP consultation must be found");
  assert.equal(mona.kind, "over_allocated");
  assert.equal(mona.procedureCost, 200);
  assert.equal(mona.paidTotal, 1400, "200 + 1,200, both pointed at the consultation");
  assert.equal(mona.excess, 1200, "exactly the amount her balance is wrong by");
  assert.deepEqual(mona.paymentIds.sort(), ["L12", "L13"], "both payments named, so a person can pick the wrong one");
  assert.equal(mona.patientName, "Mona Adel", "the name comes from the patient record");

  assert.ok(!byProcedure.has("L14"), "the root canal is settled exactly and is not a finding");

  const tarek = byProcedure.get("L_deleted");
  assert.ok(tarek, "a payment whose charge was deleted must be found");
  assert.equal(tarek.kind, "orphaned_payment");
  assert.equal(tarek.excess, 750, "with the charge gone, the whole payment is the distortion");
  assert.equal(tarek.procedureDescription, "", "there is no row left to name it, and inventing one would be a lie");

  assert.ok(!byProcedure.has("L17"), "an unpriced charge is a different problem and must not be reported here");

  assert.equal(list.misallocatedTotal, 1950, "1,200 + 750");
  assert.equal(list.misallocations[0].excess, 1200, "biggest distortion first — this is a work queue");
  assert.ok(
    list.notes.some((n) => n.includes("do not fit")),
    "the report must say out loud that these balances are wrong, since the list above cannot show them"
  );
}

// A patient who only appears through a misallocation is still not a debtor — the two lists answer
// different questions, and merging them would put "owes 0" next to a name on a call queue.
assert.ok(!byId.has("p_mona"), "Mona owes nothing; she is on the misallocation list, not the call list");

console.log(
  `✓ paymentRecovery: ${list.rows.length} debtors, ${list.totals.totalOwed} EGP outstanding, ` +
    `${list.misallocations.length} misallocated (${list.misallocatedTotal} EGP)`
);
