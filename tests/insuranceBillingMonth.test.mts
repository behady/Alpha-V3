// Which month an insurance approval belongs to.
//
// DENT INN sends each insurer one monthly closing sheet. An approval issued on 20/10 and finished on
// 5/11 belongs on November's. These checks pin the rules: each service has its own done date, an
// approval is finished on its LAST done date once nothing is left open, a deleted service stops
// holding it open, and an approval saved before any of this reads exactly as it did.
import assert from "node:assert/strict";
import { insuranceTreatmentRows, parseClaim, type InsuranceClaim } from "../src/lib/insurance/claims";
import { insurancePendingShare, insuranceWorkByStaff, unassignedLines } from "../src/lib/staffInsurance";
import { claimProgress } from "../src/lib/insurance/appointments";
import { buildMetlifeStatement } from "../src/lib/insuranceStatementMetlife";
import { buildNextcareStatement } from "../src/lib/insuranceStatementNextcare";
import {
  billingFields,
  billingFieldsToStore,
  claimFinishedDate,
  claimWorkMonths,
  inSheetRange,
  isLineRemoved,
  lineDatesAfterStates,
  movesSentMonth,
  lineDateOf,
  monthsBetween,
  sheetDate,
} from "../src/lib/insurance/billingMonth";

const line = (code: string) => ({
  code,
  description: code,
  unitsRequested: 1,
  grossPerUnit: 100,
  grossTotal: 100,
  unitsApproved: 1,
  patientShare: 0,
  approvedAmount: 100,
  comment: "",
  confidence: 1,
});

const rawDoc = (extra: Record<string, unknown> = {}) => ({
  payerId: "metlife",
  insurer: "metlife",
  approvalNumber: "A-1001",
  approvalDate: "2026-10-20",
  status: "treated",
  treatedDate: "2026-10-20",
  patientId: "p1",
  patientName: "Test Patient",
  paperPatientName: "Test Patient",
  metlife: {},
  lines: [line("D1"), line("D2"), line("D3")],
  doc: { path: "", contentType: "", bytes: 0, pages: null },
  ...extra,
});

const claim = (extra: Record<string, unknown> = {}): InsuranceClaim => {
  const c = parseClaim("c1", rawDoc(extra));
  assert.ok(c, "the fixture is a claim");
  return c!;
};

// --- 1. the 20/10 -> 5/11 approval --------------------------------------------------------------------
const split = claim({ lineDates: { 0: "2026-10-20", 1: "2026-10-20", 2: "2026-11-05" } });
assert.equal(lineDateOf(split, 2), "2026-11-05");
assert.equal(lineDateOf(split, 0), "2026-10-20");
assert.equal(claimFinishedDate(split), "2026-11-05", "finished on the day its last service was done");
assert.deepEqual(claimWorkMonths(split), ["2026-10", "2026-11"], "work was done in both months");
assert.deepEqual(billingFields(split), { finishedDate: "2026-11-05", workMonths: ["2026-10", "2026-11"] });

// --- 2. a service still open holds the approval open ------------------------------------------------------
const open = claim({ lineDates: { 0: "2026-10-20", 1: "2026-10-20" }, lineStatus: { 2: "Planned" } });
assert.equal(claimFinishedDate(open), null, "one Planned service: not finished");
assert.deepEqual(claimWorkMonths(open), ["2026-10"], "the done services still count for their month");
const ongoing = claim({ lineStatus: { 1: "Ongoing" } });
assert.equal(claimFinishedDate(ongoing), null, "Ongoing is not done either");

// --- 3. deleting the leftover service finishes it ---------------------------------------------------------
const removed = claim({
  lineDates: { 0: "2026-10-20", 1: "2026-10-20" },
  lineStatus: { 2: "Planned" },
  removedLines: { 2: { at: "2026-11-10", by: "u1" } },
});
assert.equal(isLineRemoved(removed, 2), true);
assert.equal(isLineRemoved(removed, 0), false);
assert.equal(claimFinishedDate(removed), "2026-10-20", "the deleted service no longer holds it open");
assert.deepEqual(claimWorkMonths(removed), ["2026-10"]);
const allRemoved = claim({
  removedLines: { 0: { at: "2026-11-10", by: "u1" }, 1: { at: "2026-11-10", by: "u1" }, 2: { at: "2026-11-10", by: "u1" } },
});
assert.equal(claimFinishedDate(allRemoved), null, "nothing left on it: there is nothing to bill");
assert.deepEqual(claimWorkMonths(allRemoved), []);

// --- 4. an approval saved before any of this reads as it did --------------------------------------------
const old = claim();
assert.deepEqual(old.lineDates, {});
assert.deepEqual(old.removedLines, {});
assert.equal(old.finishedDate, null);
assert.deepEqual(old.workMonths, []);
assert.equal(lineDateOf(old, 1), "2026-10-20", "no line date: the treated date, as before");
assert.equal(claimFinishedDate(old), "2026-10-20", "old claim: finished on its treated date");
assert.deepEqual(claimWorkMonths(old), ["2026-10"]);
const noTreated = claim({ treatedDate: null, status: "sent" });
assert.equal(lineDateOf(noTreated, 0), "2026-10-20", "no treated date either: the approval date");

// --- 5. only treated and sent approvals are billed ---------------------------------------------------------
const approved = claim({ status: "approved", treatedDate: null });
assert.equal(claimFinishedDate(approved), null, "approved: nothing has been done yet");
assert.deepEqual(claimWorkMonths(approved), []);
const cancelled = claim({ status: "cancelled" });
assert.equal(claimFinishedDate(cancelled), null);
assert.deepEqual(claimWorkMonths(cancelled), []);

// --- 6. which sheet it lands on -----------------------------------------------------------------------------
assert.equal(sheetDate(split, "approval"), "2026-10-20");
assert.equal(sheetDate(split, "finish"), "2026-11-05");
assert.equal(inSheetRange(split, "finish", "2026-11-01", "2026-11-30"), true, "by finish date: November");
assert.equal(inSheetRange(split, "finish", "2026-10-01", "2026-10-31"), false);
assert.equal(inSheetRange(split, "approval", "2026-11-01", "2026-11-30"), false);
assert.equal(inSheetRange(split, "approval", "2026-10-01", "2026-10-31"), true, "by approval date: October");
assert.equal(inSheetRange(open, "finish", "2026-10-01", "2026-12-31"), false, "not finished: on no sheet by finish date");
assert.equal(inSheetRange(approved, "approval", "2026-10-01", "2026-10-31"), false, "not treated: on no sheet");
assert.equal(inSheetRange(split, "finish", "2026-11-05", "2026-11-05"), true, "the range is inclusive");

// --- 7. months of a range -----------------------------------------------------------------------------------
assert.deepEqual(monthsBetween("2026-10-15", "2027-01-02"), ["2026-10", "2026-11", "2026-12", "2027-01"]);
assert.deepEqual(monthsBetween("2026-11-01", "2026-11-30"), ["2026-11"]);
assert.deepEqual(monthsBetween("2026-12-01", "2026-11-30"), [], "a backwards range has no months");
assert.deepEqual(monthsBetween("junk", "2026-11-30"), []);

// --- 8. the stored fields are read defensively -------------------------------------------------------------
const messy = claim({
  lineDates: { 0: "2026-10-20", 7: "2026-10-21", 1: "junk" },
  removedLines: { 2: { at: "2026-11-10", by: "u1" }, 9: { at: "2026-11-10", by: "u1" }, 1: "junk" },
  finishedDate: "2026-11-05",
  workMonths: ["2026-10", 5, "nope", "2026-11"],
});
assert.deepEqual(messy.lineDates, { 0: "2026-10-20" }, "junk and out-of-range dates are dropped");
assert.deepEqual(messy.removedLines, { 2: { at: "2026-11-10", by: "u1" } });
assert.equal(messy.finishedDate, "2026-11-05");
assert.deepEqual(messy.workMonths, ["2026-10", "2026-11"]);
assert.equal(claim({ finishedDate: "junk" }).finishedDate, null);

// --- 9. a state change dates the service --------------------------------------------------------------------
const today = "2026-11-10";
assert.deepEqual(lineDatesAfterStates(open, { 2: "Completed" }, today), { 0: "2026-10-20", 1: "2026-10-20", 2: today }, "marked done by hand: done today");
assert.deepEqual(lineDatesAfterStates(split, { 2: "Planned" }, today), { 0: "2026-10-20", 1: "2026-10-20" }, "back to Planned: its day goes");
assert.deepEqual(lineDatesAfterStates(split, { 1: "Ongoing" }, today), { 0: "2026-10-20", 2: "2026-11-05" }, "Ongoing has no day either");
assert.deepEqual(lineDatesAfterStates(old, { 0: "Completed" }, today), {}, "already Completed (an old claim): nothing is stamped");
assert.deepEqual(
  lineDatesAfterStates({ ...open, lineDates: { ...open.lineDates, 2: "2026-11-04" } }, { 2: "Completed" }, today),
  { 0: "2026-10-20", 1: "2026-10-20", 2: "2026-11-04" },
  "a day already on the service is kept",
);

// --- 10. an approval already sent keeps its month --------------------------------------------------------
const sent = claim({ status: "sent", lineDates: { 0: "2026-10-20", 1: "2026-10-20", 2: "2026-10-25" } });
assert.equal(movesSentMonth(sent, { ...sent, lineDates: { ...sent.lineDates, 2: "2026-10-27" } }), false, "same month: allowed");
assert.equal(movesSentMonth(sent, { ...sent, lineDates: { ...sent.lineDates, 2: "2026-11-03" } }), true, "another month: locked");
assert.equal(movesSentMonth(sent, { ...sent, lineStatus: { 2: "Planned" } }), true, "reopening it: locked");
assert.equal(movesSentMonth(sent, { ...sent, status: "treated", lineDates: { ...sent.lineDates, 2: "2026-11-03" } }), false, "marked not sent in the same edit: allowed");
assert.equal(movesSentMonth({ ...sent, status: "treated" }, { ...sent, status: "treated", lineStatus: { 2: "Planned" } }), false, "never sent: nothing to protect");
const sentOpen = claim({ status: "sent", lineStatus: { 2: "Planned" } });
assert.equal(movesSentMonth(sentOpen, { ...sentOpen, lineStatus: {} }), false, "sent while still open: finishing it is allowed");

// --- 11. the rows an approval writes into the patient's file --------------------------------------------
// Each service's treatment row is dated the day THAT service was done, and a deleted service has none.
const rowsOf = (c: InsuranceClaim) =>
  insuranceTreatmentRows({ claimId: c.id, claim: c, payerName: "MetLife", wording: {}, actor: { uid: "u1", name: "Desk", role: "Admin" } }).map((r) => [r.lineIndex, r.charge.date, r.note.date]);
assert.deepEqual(rowsOf(split), [[0, "2026-10-20", "2026-10-20"], [1, "2026-10-20", "2026-10-20"], [2, "2026-11-05", "2026-11-05"]]);
assert.deepEqual(rowsOf(removed), [[0, "2026-10-20", "2026-10-20"], [1, "2026-10-20", "2026-10-20"]], "a deleted service writes no row");
assert.deepEqual(rowsOf(old).map((r) => r[1]), ["2026-10-20", "2026-10-20", "2026-10-20"], "an old claim's rows are dated as before");

// --- 12. a deleted service is not part of the approval's money ---------------------------------------------
assert.deepEqual(old.totals, { requested: 300, approved: 300, patientShare: 0 });
assert.deepEqual(removed.totals, { requested: 200, approved: 200, patientShare: 0 }, "totals leave the deleted service out");

// --- 13. the dentist is paid for each service in the month THAT service was done -------------------------
const drA = (share: number) => ({ staffId: "s1", name: "Dr A", rate: 10, share });
const OCT = { start: "2026-10-01", end: "2026-10-31" };
const NOV = { start: "2026-11-01", end: "2026-11-30" };
const paidSplit = { ...split, dentists: { 0: drA(10), 2: drA(10) } };
const entriesOf = (claims: InsuranceClaim[], period?: { start: string; end: string }) =>
  (insuranceWorkByStaff(claims, {}, period).get("s1")?.entries ?? []).map((e) => [e.lineIndex, e.date]);
assert.deepEqual(entriesOf([paidSplit], OCT), [[0, "2026-10-20"]], "the service done on 20/10 is October's pay");
assert.deepEqual(entriesOf([paidSplit], NOV), [[2, "2026-11-05"]], "the one done on 5/11 is November's");
assert.equal(insuranceWorkByStaff([paidSplit], {}, OCT).get("s1")?.total, 10);
assert.deepEqual(entriesOf([paidSplit]), [[0, "2026-10-20"], [2, "2026-11-05"]], "no period: every done service, each on its own day");
const paidOpen = { ...open, dentists: { 0: drA(10), 2: drA(10) } };
assert.deepEqual(entriesOf([paidOpen], OCT), [[0, "2026-10-20"]], "an approval still open already pays the work that was done");
assert.deepEqual(entriesOf([paidOpen], NOV), [], "a Planned service earns nothing yet");
const paidGone = { ...paidSplit, removedLines: { 2: { at: "2026-11-10", by: "u1" } } };
assert.deepEqual(entriesOf([paidGone], NOV), [], "a deleted service earns nothing");
const paidOld = { ...old, dentists: { 0: drA(10), 2: drA(10) } };
assert.deepEqual(entriesOf([paidOld], OCT), [[0, "2026-10-20"], [2, "2026-10-20"]], "an old claim pays in its treated month, as before");
assert.deepEqual(entriesOf([paidOld], NOV), []);
assert.deepEqual(entriesOf([{ ...paidSplit, status: "approved" as const }], OCT), [], "an approval nobody treated earns nothing");

// services done with nobody on them yet
assert.deepEqual(unassignedLines([paidSplit]), { count: 1, approved: 100 });
assert.deepEqual(unassignedLines([{ ...paidSplit, removedLines: { 1: { at: "2026-11-10", by: "u1" } } }]), { count: 0, approved: 0 }, "a deleted service is nobody's unassigned work");

// the dentists' share still unpaid on the work of a period (Finance)
const partPaid = { ...split, dentists: { 0: { ...drA(10), paid: 4 }, 2: { ...drA(10), deducted: 1 } } };
assert.equal(insurancePendingShare([partPaid], OCT), 6, "October: 10 earned, 4 paid");
assert.equal(insurancePendingShare([partPaid], NOV), 9, "November: 10 earned, 1 deducted");
assert.equal(insurancePendingShare([{ ...partPaid, removedLines: { 2: { at: "2026-11-10", by: "u1" } } }], NOV), 0);
assert.equal(insurancePendingShare([{ ...partPaid, status: "approved" as const }], OCT), 0);

// --- 14. the monthly sheets: same sheet, the date mode only picks who is on it ----------------------------
const metSheet = (claims: InsuranceClaim[], p: { start: string; end: string }, mode?: "approval" | "finish") =>
  buildMetlifeStatement({ claims, from: p.start, to: p.end, wording: {}, ...(mode ? { mode } : {}) });
const nextSheet = (claims: InsuranceClaim[], p: { start: string; end: string }, mode?: "approval" | "finish") =>
  buildNextcareStatement({ claims, payerId: "metlife", payerName: "Insurer", from: p.start, to: p.end, wording: {}, ...(mode ? { mode } : {}) });

// MetLife
assert.equal(metSheet([split], OCT).cases.length, 1, "no mode given: by approval date, as before");
assert.equal(metSheet([split], OCT, "approval").cases.length, 1);
assert.equal(metSheet([split], NOV, "approval").cases.length, 0);
assert.equal(metSheet([split], NOV, "finish").cases.length, 1, "by finish date: on November's sheet");
assert.equal(metSheet([split], OCT, "finish").cases.length, 0, "and not on October's");
assert.equal(metSheet([split], NOV, "finish").cases[0].date, "2026-10-20", "the approval date printed never changes");
assert.equal(metSheet([split], NOV, "finish").cases[0].lines.length, 3);
assert.equal(metSheet([open], OCT, "finish").cases.length + metSheet([open], NOV, "finish").cases.length, 0, "not finished: on no sheet by finish date");
assert.equal(metSheet([open], OCT, "finish").heldBack, 1, "and counted as held back");
assert.equal(metSheet([removed], OCT, "finish").cases[0].lines.length, 2, "a deleted service is not printed");
assert.equal(metSheet([removed], OCT, "finish").cases[0].subtotal, 200);
assert.equal(metSheet([removed], OCT, "approval").cases[0].lines.length, 2, "in either mode");
assert.equal(metSheet([allRemoved], OCT, "approval").cases.length, 0, "nothing left on it: no case");
assert.equal(metSheet([old], OCT, "finish").cases.length, 1, "an old approval is finished on its treated day");

// NextCare
assert.equal(nextSheet([split], OCT).cases.length, 1, "no mode given: by treated date, as before");
assert.equal(nextSheet([split], NOV).cases.length, 0);
assert.equal(nextSheet([split], NOV, "finish").cases.length, 1, "by finish date: on November's sheet");
assert.equal(nextSheet([split], OCT, "finish").cases.length, 0);
assert.equal(nextSheet([split], OCT, "approval").cases.length, 1, "by approval date: on October's");
assert.equal(nextSheet([split], NOV, "finish").cases[0].date, "2026-10-20", "its date column still prints the treated date");
assert.equal(nextSheet([open], OCT, "finish").cases.length + nextSheet([open], NOV, "finish").cases.length, 0);
assert.deepEqual(nextSheet([removed], OCT, "finish").cases[0].lines.map((l) => l.rowId), ["c1#0", "c1#1"], "a deleted service is not printed");
assert.equal(nextSheet([removed], OCT).cases[0].lines.length, 2, "with or without a mode");
assert.equal(nextSheet([{ ...split, status: "approved" as const }], OCT, "approval").cases.length, 0, "not treated: on no sheet");

// --- 15. "2 of 3 done" counts only the services still on the approval ------------------------------------
assert.deepEqual(claimProgress(open, []), { total: 3, done: 2, booked: 0 });
assert.deepEqual(claimProgress(removed, []), { total: 2, done: 2, booked: 0 }, "a deleted service is not waiting to be done");
assert.deepEqual(
  claimProgress(removed, [{ id: "a1", claimId: "c1", claimLine: 2, status: "Scheduled", date: "2026-11-20", time: "10:00 AM" }]),
  { total: 2, done: 2, booked: 0 },
  "nor is a visit once booked for it counted",
);

// --- 16. the backfill: what an approval saved before all this must have stored ---------------------------
assert.deepEqual(billingFieldsToStore(old), { finishedDate: "2026-10-20", workMonths: ["2026-10"] }, "an old treated approval: finished on its treated day");
assert.deepEqual(billingFieldsToStore(claim({ status: "sent" })), { finishedDate: "2026-10-20", workMonths: ["2026-10"] }, "an old sent one stays in the month it was treated");
assert.equal(billingFieldsToStore(claim({ finishedDate: "2026-10-20", workMonths: ["2026-10"] })), null, "already stored: nothing to write");
assert.equal(billingFieldsToStore(approved), null, "not treated: nothing to store");
assert.deepEqual(billingFieldsToStore(open), { finishedDate: null, workMonths: ["2026-10"] }, "still open: its work months, no finish day");
assert.deepEqual(billingFieldsToStore(claim({ finishedDate: "2026-09-01", workMonths: ["2026-09"] })), { finishedDate: "2026-10-20", workMonths: ["2026-10"] }, "a stale stored value is corrected");

console.log("insuranceBillingMonth: all checks passed");
