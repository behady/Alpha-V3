// Fixture test for the historical payment repair. Run with tsx so the TS module loads directly.
//
// This decides whether a past payment gets rewritten. The owner's constraint is the point of the
// whole file: commission figures on this ledger have been corrected by hand, and a repair that
// recomputed everything from the dentist's standing rate would silently reverse those decisions.
// So the first two assertions matter more than all the rest — they are the ones that say "leave it
// alone".
import assert from "node:assert/strict";
import {
  classifyAllPayments,
  classifyPayment,
  hasAttribution,
  hasCommissionRecorded,
} from "../src/lib/repairPaymentAttribution.ts";

const staff = [
  { id: "d_ahmed", name: "Dr. Ahmed", commissionPercentage: 30 },
  { id: "d_sara", name: "Dr. Sara", commissionPercentage: 50 },
];

// --- what counts as "somebody has already decided this" -----------------------------------------

assert.equal(hasCommissionRecorded({ id: "x", doctorCommissionAmount: 180 }), true);
assert.equal(hasCommissionRecorded({ id: "x", doctorCommissionPercentage: 40 }), true);
// A stored ZERO counts. Writing zero is a statement that someone worked it out and the answer was
// nothing — a locum on no commission — and re-deriving it would invent a payout nobody agreed to.
assert.equal(hasCommissionRecorded({ id: "x", doctorCommissionPercentage: 0 }), true);
assert.equal(hasCommissionRecorded({ id: "x", doctorCommissionAmount: 0 }), true);
assert.equal(hasCommissionRecorded({ id: "x", commissionSetManually: true }), true);
// Genuinely never computed: no commission fields at all.
assert.equal(hasCommissionRecorded({ id: "x", paid: 500 }), false);

assert.equal(hasAttribution({ id: "x", doctorId: "d_ahmed" }), true);
assert.equal(hasAttribution({ id: "x", doctor: "Dr. Ahmed" }), true);
assert.equal(hasAttribution({ id: "x", paid: 100 }), false);

// --- THE ONE THAT MATTERS: a hand-corrected row is never touched ---------------------------------

// Dr. Ahmed is on 30%, but somebody agreed 40% for this case and typed it in. The formula would
// say 300; the row says 400. It must survive untouched.
const handCorrected = classifyPayment(
  {
    id: "P_hand", type: "payment", paid: 1000, date: "2026-03-01", procedureId: "L1",
    doctorId: "d_ahmed", doctorCommissionPercentage: 40, doctorCommissionAmount: 400, clinicProfit: 600,
    patientName: "Mona",
  },
  { siblings: [], procedure: { id: "L1", doctorId: "d_ahmed", labFee: 0 }, staff }
);
assert.equal(handCorrected.class, "MANUAL_OR_OK");
assert.equal(handCorrected.proposal, undefined, "a row we will not touch must carry no proposal at all");

// The same protection with the explicit marker the payout screen now writes.
const marked = classifyPayment(
  {
    id: "P_marked", type: "payment", paid: 1000, date: "2026-03-01", procedureId: "L1",
    doctorId: "d_ahmed", commissionSetManually: true, doctorCommissionAmount: 250,
  },
  { siblings: [], procedure: { id: "L1", doctorId: "d_ahmed", labFee: 0 }, staff }
);
assert.equal(marked.class, "MANUAL_OR_OK");
assert.match(marked.reason, /set by hand/);

// --- the rows this exists to fix ------------------------------------------------------------------

// Written by the appointment side panel: the amount and nothing else.
const stripped = classifyPayment(
  { id: "P_bare", type: "payment", paid: 1000, date: "2026-03-01", procedureId: "L1", patientName: "Mona" },
  { siblings: [{ id: "P_bare", date: "2026-03-01" }], procedure: { id: "L1", doctorId: "d_ahmed", labFee: 400 }, staff }
);
assert.equal(stripped.class, "AUTO_FIXABLE");
assert.equal(stripped.proposal.doctorId, "d_ahmed");
assert.equal(stripped.proposal.doctorCommissionPercentage, 30);
assert.equal(stripped.proposal.labFee, 400, "the only payment for this procedure carries the lab fee");
assert.equal(stripped.proposal.doctorCommissionAmount, 180, "(1000 - 400) * 30%");
assert.equal(stripped.proposal.clinicProfit, 420);

// A later instalment must not pick the lab fee up a second time.
const siblings = [
  { id: "P_first", date: "2026-03-01", paid: 1000, labFee: 400, doctorCommissionAmount: 180 },
  { id: "P_second", date: "2026-04-01", paid: 1000 },
];
const second = classifyPayment(
  { id: "P_second", type: "payment", paid: 1000, date: "2026-04-01", procedureId: "L1" },
  { siblings, procedure: { id: "L1", doctorId: "d_ahmed", labFee: 400 }, staff }
);
assert.equal(second.class, "AUTO_FIXABLE");
assert.equal(second.proposal.labFee, 0, "the lab is paid once, on the earliest payment");
assert.equal(second.proposal.doctorCommissionAmount, 300, "full 30% once the lab is settled");

// --- the row-local rule: never change a row we are not repairing -----------------------------------

// This payment SHOULD carry the lab fee (it is the earliest), but an untouchable sibling is
// carrying it today. Applying it here would charge the lab twice across the procedure.
const wouldDoubleCharge = classifyPayment(
  { id: "P_early", type: "payment", paid: 500, date: "2026-01-01", procedureId: "L1" },
  {
    siblings: [
      { id: "P_early", date: "2026-01-01", paid: 500 },
      { id: "P_late", date: "2026-02-01", paid: 500, labFee: 400, doctorCommissionAmount: 30 },
    ],
    procedure: { id: "L1", doctorId: "d_ahmed", labFee: 400 },
    staff,
  }
);
assert.equal(wouldDoubleCharge.class, "REVIEW");
assert.match(wouldDoubleCharge.reason, /P_late/, "the report must name the row standing in the way");
assert.equal(wouldDoubleCharge.proposal, undefined);

// The mirror case: an earlier untouchable payment should carry the fee but is not carrying it.
// Repairing this one would leave the lab fee charged nowhere at all.
const feeWouldVanish = classifyPayment(
  { id: "P_later", type: "payment", paid: 500, date: "2026-02-01", procedureId: "L1" },
  {
    siblings: [
      { id: "P_earlier", date: "2026-01-01", paid: 500, doctorCommissionAmount: 150 },
      { id: "P_later", date: "2026-02-01", paid: 500 },
    ],
    procedure: { id: "L1", doctorId: "d_ahmed", labFee: 400 },
    staff,
  }
);
assert.equal(feeWouldVanish.class, "REVIEW");
assert.match(feeWouldVanish.reason, /P_earlier/);

// --- nothing to attribute to -------------------------------------------------------------------------

const onAccount = classifyPayment(
  { id: "P_acct", type: "payment", paid: 300, date: "2026-03-01", procedureId: null },
  { siblings: [], procedure: null, staff }
);
assert.equal(onAccount.class, "UNRESOLVABLE");
assert.match(onAccount.reason, /on account/);

const orphan = classifyPayment(
  { id: "P_orphan", type: "payment", paid: 300, date: "2026-03-01", procedureId: "L_gone" },
  { siblings: [], procedure: null, staff }
);
assert.equal(orphan.class, "UNRESOLVABLE");

const noDentist = classifyPayment(
  { id: "P_nodoc", type: "payment", paid: 300, date: "2026-03-01", procedureId: "L2" },
  { siblings: [], procedure: { id: "L2", labFee: 0 }, staff }
);
assert.equal(noDentist.class, "UNRESOLVABLE");

// A dentist who has left: their rate is not ours to guess.
const departed = classifyPayment(
  { id: "P_left", type: "payment", paid: 300, date: "2026-03-01", procedureId: "L3" },
  { siblings: [], procedure: { id: "L3", doctorName: "Dr. Gone" }, staff }
);
assert.equal(departed.class, "REVIEW");
assert.match(departed.reason, /not on the staff list/);

// Legacy attribution by name still resolves when the person IS on staff.
const byName = classifyPayment(
  { id: "P_name", type: "payment", paid: 1000, date: "2026-03-01", procedureId: "L4" },
  { siblings: [{ id: "P_name", date: "2026-03-01" }], procedure: { id: "L4", doctor: "Dr. Sara" }, staff }
);
assert.equal(byName.class, "AUTO_FIXABLE");
assert.equal(byName.proposal.doctorId, "d_sara");
assert.equal(byName.proposal.doctorCommissionAmount, 500);

// --- the whole-clinic pass ----------------------------------------------------------------------------

const ledger = [
  { id: "L1", type: "procedure", doctorId: "d_ahmed", labFee: 400 },
  { id: "L2", type: "procedure", doctorId: "d_sara", labFee: 0 },
  // Never attributed → fixable.
  { id: "PA", type: "payment", paid: 1000, date: "2026-03-01", procedureId: "L1", patientName: "Mona" },
  // Hand-corrected → untouchable.
  { id: "PB", type: "payment", paid: 1000, date: "2026-03-02", procedureId: "L2", doctorCommissionPercentage: 60, doctorCommissionAmount: 600 },
  // On account → nothing to do.
  { id: "PC", type: "payment", paid: 200, date: "2026-03-03", procedureId: null },
  // The legacy placeholder shape: real value in `paid`, `amount` left at 0.
  { id: "PD", type: "payment", amount: 0, paid: 600, date: "2026-03-04", procedureId: "L2" },
  // An expense must not be classified at all.
  { id: "EX", type: "expense", cost: 900, date: "2026-03-05" },
];

const report = classifyAllPayments("clinic_test", ledger, staff, new Date("2026-08-22T10:00:00Z"));

assert.equal(report.verdicts.length, 4, "only payments are classified");
assert.equal(report.counts.AUTO_FIXABLE, 2, "PA and PD");
assert.equal(report.counts.MANUAL_OR_OK, 1, "PB");
assert.equal(report.counts.UNRESOLVABLE, 1, "PC");
assert.equal(report.counts.REVIEW, 0);

// PD's real amount is in `paid`; reading `amount` would credit Dr. Sara nothing.
const pd = report.verdicts.find((v) => v.paymentId === "PD");
assert.equal(pd.amount, 600, "the legacy amount:0 placeholder must not be read as the amount");
assert.equal(pd.proposal.doctorCommissionAmount, 300, "600 * 50%");

// 180 (PA) + 300 (PD)
assert.equal(report.commissionToCredit, 480);
assert.ok(report.notes.some((n) => n.includes("indistinguishable")), "the report must say why rows were skipped");

console.log(
  `✓ repairClassifier: hand-corrected rows are never touched; ${report.counts.AUTO_FIXABLE} repairable, ` +
    `${report.commissionToCredit} EGP of commission would be credited`
);
