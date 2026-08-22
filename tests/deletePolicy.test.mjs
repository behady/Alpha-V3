// Fixture test for the one delete rule. Run with tsx so the TS module loads directly.
//
// Before this existed the same procedure could be deleted from three screens with three different
// outcomes. The case that matters most is the finance page's: it warned that payments existed and
// then cascaded through them anyway, leaving the patient's balance short by whatever had been
// collected. That scenario is the last block below.
import assert from "node:assert/strict";
import { buildDeleteContext, evaluateDelete } from "../src/lib/deletePolicy.ts";

// A crown, charged and half paid; a filling, charged and untouched; rent, which belongs to nobody.
const ledgerRows = [
  { id: "L_crown", type: "procedure", clinicalNoteId: "N_crown" },
  { id: "P1", type: "payment", procedureId: "L_crown" },
  { id: "P2", type: "payment", procedureId: "L_crown" },
  { id: "L_filling", type: "procedure", clinicalNoteId: "N_filling" },
  { id: "L_rent", type: "expense" },
  { id: "P_general", type: "payment", procedureId: null },
];

const context = buildDeleteContext(ledgerRows);

// --- indexing --------------------------------------------------------------------------------
assert.deepEqual(context.paymentsByProcedureId.get("L_crown"), ["P1", "P2"]);
assert.equal(context.paymentsByProcedureId.get("L_filling"), undefined);
assert.deepEqual(context.ledgerRowsByClinicalNoteId.get("N_crown"), ["L_crown"]);
assert.equal(context.ledgerRowTypes.get("L_rent"), "expense");

// --- a charge with money against it cannot go -------------------------------------------------
const paidProcedure = evaluateDelete({ kind: "ledger-procedure", id: "L_crown" }, context);
assert.equal(paidProcedure.allowed, false);
assert.equal(paidProcedure.reason, "HAS_PAYMENTS");
assert.deepEqual(paidProcedure.blockingPaymentIds, ["P1", "P2"]);
assert.deepEqual(paidProcedure.cascade, [], "a refusal must propose no writes at all");
assert.match(paidProcedure.message, /2 payments/, "the message must say how many stand in the way");

// --- an unpaid charge takes its clinical note with it ------------------------------------------
const unpaidProcedure = evaluateDelete({ kind: "ledger-procedure", id: "L_filling" }, context);
assert.equal(unpaidProcedure.allowed, true);
assert.deepEqual(
  unpaidProcedure.cascade.map((c) => `${c.collection}:${c.id}`).sort(),
  ["clinical_notes:N_filling", "ledger:L_filling"],
  "the charge and the treatment record are one thing and must go together"
);

// --- deleting from the clinical timeline reaches the same verdict -------------------------------
const noteWithPayments = evaluateDelete({ kind: "clinical-note", id: "N_crown" }, context);
assert.equal(noteWithPayments.allowed, false, "the timeline used not to check at all");
assert.equal(noteWithPayments.reason, "HAS_PAYMENTS");

const noteWithout = evaluateDelete({ kind: "clinical-note", id: "N_filling" }, context);
assert.equal(noteWithout.allowed, true);
assert.deepEqual(
  noteWithout.cascade.map((c) => `${c.collection}:${c.id}`).sort(),
  ["clinical_notes:N_filling", "ledger:L_filling"]
);

// The legacy link direction: a note pointing at its row via note.ledgerId rather than the row
// carrying clinicalNoteId. Both must be followed, or a charge is left behind with no treatment.
const legacyLinked = evaluateDelete(
  { kind: "clinical-note", id: "N_orphan", ledgerIds: ["L_filling"] },
  context
);
assert.equal(legacyLinked.allowed, true);
assert.deepEqual(
  legacyLinked.cascade.map((c) => `${c.collection}:${c.id}`).sort(),
  ["clinical_notes:N_orphan", "ledger:L_filling"]
);

// A note whose legacy pointer reaches a PAID charge is blocked just the same.
const legacyPaid = evaluateDelete({ kind: "clinical-note", id: "N_x", ledgerIds: ["L_crown"] }, context);
assert.equal(legacyPaid.allowed, false);
assert.equal(legacyPaid.reason, "HAS_PAYMENTS");

// --- payments are always removable, and always trigger a rebalance ------------------------------
const payment = evaluateDelete({ kind: "ledger-payment", id: "P1", procedureId: "L_crown" }, context);
assert.equal(payment.allowed, true);
assert.deepEqual(payment.cascade, [{ collection: "ledger", id: "P1" }]);
assert.deepEqual(
  payment.resyncProcedureIds,
  ["L_crown"],
  "the lab fee sits on the earliest payment, so removing one may move it"
);

// A general payment settles nothing, so there is nothing to rebalance.
const generalPayment = evaluateDelete({ kind: "ledger-payment", id: "P_general" }, context);
assert.equal(generalPayment.allowed, true);
assert.deepEqual(generalPayment.resyncProcedureIds, []);

// --- clinic overheads ---------------------------------------------------------------------------
const rent = evaluateDelete({ kind: "ledger-entry", id: "L_rent" }, context);
assert.equal(rent.allowed, true);
assert.deepEqual(rent.cascade, [{ collection: "ledger", id: "L_rent" }]);
assert.deepEqual(rent.resyncProcedureIds, []);

// --- the finance page's old behaviour, now refused ------------------------------------------------
// It found every row sharing a clinicalNoteId and deleted them all — including the payments —
// after a confirm dialog. The patient's recorded balance moved by whatever had been collected,
// and nothing on any screen explained why.
const financePageScenario = evaluateDelete({ kind: "clinical-note", id: "N_crown" }, context);
assert.equal(financePageScenario.allowed, false);
assert.ok(
  !financePageScenario.cascade.some((c) => c.id === "P1" || c.id === "P2"),
  "no verdict may ever propose deleting a payment as collateral"
);

console.log("✓ deletePolicy: a charge with payments against it cannot be deleted from any screen");
