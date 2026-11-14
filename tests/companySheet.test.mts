// Which month a contract company's sheet lists each patient on: the month he FINISHED.
//
//   npm run test:company-sheet
import assert from "node:assert/strict";
import { buildInsuranceStatement } from "../src/lib/insuranceStatement";
import {
  buildCompanySheets,
  companyStatement,
  scopeSheets,
  markKey,
  sendRefusal,
  sheetChargeIds,
  unsendRefusal,
  type MonthSheet,
  type SentMonth,
  type SheetCard,
  type SheetCharge,
  type SheetChoice,
} from "../src/lib/insurance/companySheet";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${(e as Error).message}`);
  }
}

const charge = (id: string, patientId: string, date: string, noteId?: string, extra: Partial<SheetCharge> = {}): SheetCharge => ({
  id,
  type: "procedure",
  payerId: "gasco",
  patientId,
  patientName: patientId,
  date,
  cost: 100,
  clinicalNoteId: noteId,
  ...extra,
});
const card = (id: string, status: string, date: string, completedDate?: string, continuedFromNoteId?: string): SheetCard => ({
  id,
  status,
  date,
  completedDate,
  continuedFromNoteId,
});

function run(charges: SheetCharge[], cards: SheetCard[], marks: Record<string, SheetChoice> = {}, through = "2026-12") {
  const sheets = buildCompanySheets({ charges, cards, marks, sent: [], payerId: "gasco", through });
  return (month: string) => {
    const s = sheets.find((x) => x.month === month);
    assert.ok(s, `sheet for ${month}`);
    return s;
  };
}
const ids = (xs: { charges: SheetCharge[] }) => xs.charges.map((c) => c.id);

check("finished patient prints in his month", () => {
  const sheet = run([charge("c1", "p1", "2026-11-05", "n1")], [card("n1", "Completed", "2026-11-05", "2026-11-05")]);
  assert.deepEqual(sheet("2026-11").printed.map((p) => p.patientId), ["p1"]);
  assert.deepEqual(sheet("2026-11").held, []);
  assert.equal(sheet("2026-11").sent, null);
});

const twoCharges = [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-06", "n2")];

check("unfinished is held and carries old and new work together", () => {
  const sheet = run(twoCharges, [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Ongoing", "2026-11-06")]);
  assert.deepEqual(sheet("2026-11").printed, []);
  assert.equal(sheet("2026-11").held[0].reason, "not_finished");
  assert.deepEqual(ids(sheet("2026-11").held[0]), ["c1", "c2"]);
  assert.deepEqual(ids(sheet("2026-12").held[0]), ["c1", "c2"]);
});

const lateCards = [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-11-06", "2026-12-03")];

check("finished after the month: held late, printed next month with everything", () => {
  const sheet = run(twoCharges, lateCards);
  assert.equal(sheet("2026-11").held[0].reason, "finished_late");
  assert.deepEqual(ids(sheet("2026-12").printed[0]), ["c1", "c2"]);
  assert.equal(sheet("2026-12").printed[0].value, 200);
});

check("include cannot override not finished", () => {
  const sheet = run(twoCharges, [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Ongoing", "2026-11-06")], {
    [markKey("p1", "2026-11")]: "include",
  });
  assert.equal(sheet("2026-11").held[0].reason, "not_finished");
});

check("late tick pulled in by the switch", () => {
  const sheet = run(twoCharges, lateCards, { [markKey("p1", "2026-11")]: "include" });
  assert.deepEqual(ids(sheet("2026-11").printed[0]), ["c1", "c2"]);
  assert.equal(sheet("2026-11").printed[0].choice, "include");
  assert.deepEqual(sheet("2026-12").printed, []);
  assert.deepEqual(sheet("2026-12").held, []);
});

check("hold carries a finished patient", () => {
  const sheet = run([charge("c1", "p1", "2026-11-05", "n1")], [card("n1", "Completed", "2026-11-05", "2026-11-05")], {
    [markKey("p1", "2026-11")]: "hold",
  });
  assert.equal(sheet("2026-11").held[0].reason, "moved");
  assert.deepEqual(ids(sheet("2026-12").printed[0]), ["c1"]);
});

check("returning patient: only the new work", () => {
  const sheet = run(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c3", "p1", "2026-12-10", "n3")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n3", "Completed", "2026-12-10", "2026-12-10")],
  );
  assert.deepEqual(ids(sheet("2026-11").printed[0]), ["c1"]);
  assert.deepEqual(ids(sheet("2026-12").printed[0]), ["c3"]);
});

check("the continuation decides", () => {
  const sheet = run(
    [charge("c1", "p1", "2026-11-05", "n1")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n1b", "Ongoing", "2026-11-20", undefined, "n1")],
  );
  assert.equal(sheet("2026-11").held[0].reason, "not_finished");
});

check("a continuation wins a same-day tie", () => {
  const sheet = run(
    [charge("c1", "p1", "2026-11-05", "n1")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n1b", "Ongoing", "2026-11-05", undefined, "n1")],
  );
  assert.equal(sheet("2026-11").held[0].reason, "not_finished");
});

check("no card, deleted card, card with no status all count as done on the charge date", () => {
  const sheet = run(
    [charge("c1", "p1", "2026-11-05"), charge("c2", "p1", "2026-11-05", "gone"), charge("c3", "p1", "2026-11-05", "n3")],
    [card("n3", "", "2026-11-05")],
  );
  assert.deepEqual(ids(sheet("2026-11").printed[0]), ["c1", "c2", "c3"]);
});

check("start month and filters", () => {
  const done = [card("n1", "Completed", "2026-11-05", "2026-11-05")];
  const sheet = run(
    [
      charge("old", "p1", "2026-10-31", "n1"),
      charge("del", "p2", "2026-11-05", "n1", { status: "deleted" }),
      charge("can", "p3", "2026-11-05", "n1", { status: "cancelled" }),
      charge("oth", "p4", "2026-11-05", "n1", { payerId: "other" }),
      charge("pay", "p5", "2026-11-05", "n1", { type: "payment" }),
    ],
    done,
  );
  for (const m of ["2026-11", "2026-12"]) {
    assert.deepEqual(sheet(m).printed, []);
    assert.deepEqual(sheet(m).held, []);
  }
});

check("through before the start gives no sheets", () => {
  assert.deepEqual(buildCompanySheets({ charges: [], cards: [], marks: {}, sent: [], payerId: "gasco", through: "2026-10" }), []);
});

check("order: earliest charge date, then name; value rounds to 2 places", () => {
  const done = [card("n1", "Completed", "2026-11-05", "2026-11-05")];
  const sheet = run(
    [charge("a", "zed", "2026-11-02", "n1"), charge("b", "amy", "2026-11-02", "n1"), charge("c", "bob", "2026-11-01", "n1", { cost: 10.005 })],
    done,
  );
  assert.deepEqual(sheet("2026-11").printed.map((p) => p.patientId), ["bob", "amy", "zed"]);
  assert.equal(sheet("2026-11").printed[0].value, 10.01);
});

// ---- the sent lock ----
const sentRun = (
  charges: SheetCharge[],
  cards: SheetCard[],
  sent: SentMonth[],
  marks: Record<string, SheetChoice> = {},
) => buildCompanySheets({ charges, cards, marks, sent, payerId: "gasco", through: "2026-12" });
const sheetOf = (sheets: MonthSheet[], m: string) => sheets.find((s) => s.month === m) as MonthSheet;
const sentNov: SentMonth = { month: "2026-11", chargeIds: ["c1"] };
const doneN1 = card("n1", "Completed", "2026-11-05", "2026-11-05");

check("sent month is frozen against a reopened treatment", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [card("n1", "Ongoing", "2026-11-05")], [sentNov]);
  assert.deepEqual(sheetOf(sheets, "2026-11").printed.flatMap(ids), ["c1"]);
  assert.notEqual(sheetOf(sheets, "2026-11").sent, null);
  assert.ok(!sheetOf(sheets, "2026-12").printed.some((p) => p.patientId === "p1"));
  assert.ok(!sheetOf(sheets, "2026-12").held.some((p) => p.patientId === "p1"));
});

check("sent month is frozen against a switch", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [doneN1], [sentNov], { [markKey("p1", "2026-11")]: "hold" });
  assert.deepEqual(sheetOf(sheets, "2026-11").printed.flatMap(ids), ["c1"]);
});

check("back-dated charge waits for the next month", () => {
  const sheets = sentRun(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-20", "n2")],
    [doneN1, card("n2", "Completed", "2026-11-20", "2026-11-20")],
    [sentNov],
  );
  assert.deepEqual(sheetOf(sheets, "2026-11").printed.flatMap(ids), ["c1"]);
  assert.deepEqual(sheetOf(sheets, "2026-11").held.flatMap(ids), ["c2"]);
  assert.deepEqual(sheetOf(sheets, "2026-12").printed.flatMap(ids), ["c2"]);
});

check("moved charge stays on its sent month", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-12-02", "n1")], [doneN1], [sentNov]);
  assert.deepEqual(sheetOf(sheets, "2026-11").printed.flatMap(ids), ["c1"]);
  assert.deepEqual(sheetOf(sheets, "2026-12").printed, []);
});

check("deleted charge drops off a sent month", () => {
  const sheets = sentRun(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-06", "n1", { status: "deleted" })],
    [doneN1],
    [{ month: "2026-11", chargeIds: ["c1", "c2"] }],
  );
  assert.deepEqual(sheetOf(sheets, "2026-11").printed.flatMap(ids), ["c1"]);
});

check("sent month outside the walked range still keeps its charges off the waiting lists", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [doneN1], [{ month: "2027-03", chargeIds: ["c1"] }]);
  assert.deepEqual(sheetOf(sheets, "2026-11").printed, []);
  assert.deepEqual(sheetOf(sheets, "2026-12").printed, []);
});

check("sendRefusal", () => {
  const open = sentRun([charge("c1", "p1", "2026-11-05", "n1"), charge("c9", "p9", "2026-12-05", "n1")], [doneN1], []);
  assert.equal(sendRefusal(open, "2026-12"), "earlier_open");
  assert.equal(sendRefusal(open, "2026-11"), null);
  const empty = sentRun([], [], []);
  assert.equal(sendRefusal(empty, "2026-11"), "empty");
  const sent = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [doneN1], [sentNov]);
  assert.equal(sendRefusal(sent, "2026-11"), "already_sent");
  assert.equal(sendRefusal(sent, "2026-12"), "empty");
});

check("unsendRefusal", () => {
  const sheets = sentRun(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c3", "p3", "2026-12-05", "n1")],
    [doneN1],
    [sentNov, { month: "2026-12", chargeIds: ["c3"] }],
  );
  assert.equal(unsendRefusal(sheets, "2026-11"), "later_sent");
  assert.equal(unsendRefusal(sheets, "2026-12"), null);
  assert.equal(unsendRefusal(sentRun([], [], []), "2026-11"), "not_sent");
});

check("sheetChargeIds lists every printed charge", () => {
  const sheets = sentRun(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-06", "n1"), charge("c3", "p2", "2026-11-07", "n1")],
    [doneN1],
    [],
  );
  assert.deepEqual(sheetChargeIds(sheetOf(sheets, "2026-11")), ["c1", "c2", "c3"]);
});

// ---- companyStatement -------------------------------------------------------------------------
const doneAll = [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-11-12", "2026-11-12")];
function stmt(
  charges: SheetCharge[],
  cards: SheetCard[],
  range: { start: string; end: string },
  keep?: (c: SheetCharge) => boolean,
) {
  return companyStatement({
    charges,
    cards,
    marks: {},
    sent: [],
    payerId: "gasco",
    payerName: "GASCO",
    range,
    memberNumbers: new Map([["p1", "M1"]]),
    keep,
  });
}

check("statement: one case per patient per month", () => {
  const { statement } = stmt(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-12", "n2")],
    doneAll,
    { start: "2026-11-01", end: "2026-11-30" },
  );
  assert.equal(statement.cases.length, 1);
  assert.equal(statement.cases[0].lines.length, 2);
  assert.equal(statement.cases[0].subtotal, 200);
  assert.equal(statement.cases[0].date, "2026-11-05");
  assert.equal(statement.cases[0].memberNumber, "M1");
  assert.equal(statement.total, 200);
  assert.equal(statement.month, "2026-11");
});

check("statement: a partial range prints the whole month", () => {
  const { statement } = stmt(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-12", "n2")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-11-12", "2026-11-20")],
    { start: "2026-11-01", end: "2026-11-15" },
  );
  assert.equal(statement.cases.length, 1);
  assert.equal(statement.cases[0].lines.length, 2);
});

check("statement: two months touched, serials run through", () => {
  const { statement, sheets } = stmt(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p2", "2026-12-05", "n2")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-12-05", "2026-12-05")],
    { start: "2026-11-01", end: "2026-12-31" },
  );
  assert.deepEqual(statement.cases.map((c) => c.serial), [1, 2]);
  assert.deepEqual(sheets.map((s) => s.month), ["2026-11", "2026-12"]);
  assert.deepEqual(statement.missingMemberNumber.map((m) => m.patientId), ["p2"]);
});

check("statement: legacy months print exactly as before", () => {
  const rows = [charge("a", "p1", "2026-10-10"), charge("b", "p1", "2026-10-10"), charge("c", "p1", "2026-10-20")];
  const range = { start: "2026-10-01", end: "2026-10-31" };
  const { statement, sheets } = stmt(rows, [], range);
  const old = buildInsuranceStatement({
    rows,
    payerId: "gasco",
    payerName: "GASCO",
    month: "2026-10",
    range,
    memberNumbers: new Map([["p1", "M1"]]),
  });
  assert.deepEqual(statement.cases, old.cases);
  assert.deepEqual(statement, old);
  assert.deepEqual(sheets, []);
});

check("statement: a range across the start is legacy first, then November", () => {
  const { statement, sheets } = stmt(
    [charge("a", "p1", "2026-10-10"), charge("b", "p1", "2026-10-20"), charge("c1", "p2", "2026-11-05", "n1")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05")],
    { start: "2026-10-15", end: "2026-11-30" },
  );
  assert.deepEqual(statement.cases.map((c) => c.date), ["2026-10-20", "2026-11-05"]);
  assert.deepEqual(statement.cases.map((c) => c.serial), [1, 2]);
  assert.deepEqual(sheets.map((s) => s.month), ["2026-11"]);
  assert.equal(statement.month, "2026-10");
});

check("statement: the branch filter applies after the walk", () => {
  const { statement, sheets } = stmt(
    [charge("c1", "p1", "2026-11-05", "n1", { branchId: "A" }), charge("c2", "p1", "2026-11-06", "n2", { branchId: "B" })],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Ongoing", "2026-11-06")],
    { start: "2026-11-01", end: "2026-11-30" },
    (c) => c.branchId === "A",
  );
  assert.deepEqual(statement.cases, []);
  assert.equal(sheets[0].held.length, 1);
  assert.deepEqual(ids(sheets[0].held[0]), ["c1"]);
});

check("statement: held prints nothing", () => {
  const { statement } = stmt(
    [charge("c1", "p1", "2026-11-05", "n1")],
    [card("n1", "Ongoing", "2026-11-05")],
    { start: "2026-11-01", end: "2026-11-30" },
  );
  assert.deepEqual(statement.cases, []);
  assert.equal(statement.total, 0);
});

check("statement: keep also filters legacy rows", () => {
  const { statement } = stmt(
    [charge("a", "p1", "2026-10-10", undefined, { branchId: "A" }), charge("b", "p2", "2026-10-11", undefined, { branchId: "B" })],
    [],
    { start: "2026-10-01", end: "2026-10-31" },
    (c) => c.branchId === "A",
  );
  assert.deepEqual(statement.cases.map((c) => c.patientId), ["p1"]);
});

check("statement: a backwards range is empty", () => {
  const { statement, sheets } = stmt([charge("c1", "p1", "2026-11-05", "n1")], doneAll, { start: "2026-12-01", end: "2026-11-01" });
  assert.deepEqual(statement.cases, []);
  assert.deepEqual(sheets, []);
});

check("scopeSheets drops a held patient left with no charges", () => {
  const sheets = buildCompanySheets({
    charges: [charge("c1", "p1", "2026-11-05", "n1", { branchId: "B" })],
    cards: [card("n1", "Ongoing", "2026-11-05")],
    marks: {},
    sent: [],
    payerId: "gasco",
    through: "2026-11",
  });
  const scoped = scopeSheets(sheets, (c) => c.branchId === "A");
  assert.deepEqual(scoped[0].held, []);
  assert.equal(sheets[0].held.length, 1);
});

console.log(failed ?`companySheet: ${failed} failed, ${passed} passed` : `companySheet: all ${passed} checks passed`);
if (failed) process.exit(1);
