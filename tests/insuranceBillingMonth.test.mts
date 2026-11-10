// Which month an insurance approval belongs to.
//
// DENT INN sends each insurer one monthly closing sheet. An approval issued on 20/10 and finished on
// 5/11 belongs on November's. These checks pin the rules: each service has its own done date, an
// approval is finished on its LAST done date once nothing is left open, a deleted service stops
// holding it open, and an approval saved before any of this reads exactly as it did.
import assert from "node:assert/strict";
import { insuranceTreatmentRows, parseClaim, type InsuranceClaim } from "../src/lib/insurance/claims";
import {
  billingFields,
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

console.log("insuranceBillingMonth: all checks passed");
