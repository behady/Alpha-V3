// Which month a contract company's sheet lists each PROCEDURE on: the month it finished, or the
// month the clinic picked for it.
//
//   npm run test:company-sheet
import assert from "node:assert/strict";
import { buildInsuranceStatement } from "../src/lib/insuranceStatement";
import {
  buildCompanySheets,
  cardChildren,
  companyStatement,
  nextMonth,
  placeCharges,
  scopeSheets,
  sendRefusal,
  sheetChargeIds,
  unsendRefusal,
  type MonthSheet,
  type SentMonth,
  type SheetCard,
  type SheetCharge,
} from "../src/lib/insurance/companySheet";
import { parseFinishLog, patientRows, pickerMonths, serviceState, serviceStory } from "../src/lib/insurance/sheetPatients";

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

type Months = Record<string, string>;
function run(charges: SheetCharge[], cards: SheetCard[], months: Months = {}, sent: SentMonth[] = [], through = "2026-12") {
  const sheets = buildCompanySheets({ charges, cards, months, sent, payerId: "gasco", through });
  return (month: string) => {
    const s = sheets.find((x) => x.month === month);
    assert.ok(s, `sheet for ${month}`);
    return s;
  };
}
const ids = (xs: { charges: SheetCharge[] }) => xs.charges.map((c) => c.id);
const printedIds = (s: MonthSheet) => s.printed.flatMap(ids);
const heldIds = (s: MonthSheet) => s.held.flatMap(ids);

check("a finished procedure prints on the month it finished", () => {
  const sheet = run([charge("c1", "p1", "2026-11-05", "n1")], [card("n1", "Completed", "2026-11-05", "2026-11-05")]);
  assert.deepEqual(sheet("2026-11").printed.map((p) => p.patientId), ["p1"]);
  assert.deepEqual(sheet("2026-11").held, []);
  assert.equal(sheet("2026-11").sent, null);
  assert.deepEqual(sheet("2026-12").printed, []);
});

const twoCharges = [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-06", "n2")];

check("each procedure alone: the finished one prints, the unfinished one is on no sheet", () => {
  const sheet = run(twoCharges, [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Ongoing", "2026-11-06")]);
  assert.deepEqual(printedIds(sheet("2026-11")), ["c1"]);
  assert.equal(sheet("2026-11").printed[0].value, 100);
  assert.equal(sheet("2026-11").held[0].reason, "not_finished");
  assert.deepEqual(heldIds(sheet("2026-11")), ["c2"]);
  assert.deepEqual(printedIds(sheet("2026-12")), []);
  assert.deepEqual(heldIds(sheet("2026-12")), ["c2"]);
});

check("started in November, finished in December: only that procedure goes on December", () => {
  const sheet = run(twoCharges, [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-11-06", "2026-12-03")]);
  assert.deepEqual(printedIds(sheet("2026-11")), ["c1"]);
  assert.deepEqual(printedIds(sheet("2026-12")), ["c2"]);
  assert.deepEqual(sheet("2026-11").held, []);
});

check("the month picker moves one procedure and leaves the other", () => {
  const cards = [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-11-06", "2026-11-06")];
  const sheet = run(twoCharges, cards, { c2: "2026-12" });
  assert.deepEqual(printedIds(sheet("2026-11")), ["c1"]);
  assert.deepEqual(printedIds(sheet("2026-12")), ["c2"]);
});

check("the picker can place a procedure that is not finished", () => {
  const sheet = run([charge("c1", "p1", "2026-11-05", "n1")], [card("n1", "Ongoing", "2026-11-05")], { c1: "2026-11" });
  assert.deepEqual(printedIds(sheet("2026-11")), ["c1"]);
  assert.deepEqual(sheet("2026-11").held, []);
});

check("a picked month that is not a month, or before the start, is ignored", () => {
  const cards = [card("n1", "Completed", "2026-11-05", "2026-11-05")];
  for (const bad of ["2026-13", "soon", "2026-10"]) {
    const sheet = run([charge("c1", "p1", "2026-11-05", "n1")], cards, { c1: bad });
    assert.deepEqual(printedIds(sheet("2026-11")), ["c1"], bad);
  }
});

check("returning patient: only the new work", () => {
  const sheet = run(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c3", "p1", "2026-12-10", "n3")],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n3", "Completed", "2026-12-10", "2026-12-10")],
  );
  assert.deepEqual(printedIds(sheet("2026-11")), ["c1"]);
  assert.deepEqual(printedIds(sheet("2026-12")), ["c3"]);
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
  assert.deepEqual(printedIds(sheet("2026-11")), ["c1", "c2", "c3"]);
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
  assert.deepEqual(buildCompanySheets({ charges: [], cards: [], months: {}, sent: [], payerId: "gasco", through: "2026-10" }), []);
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
const sentRun = (charges: SheetCharge[], cards: SheetCard[], sent: SentMonth[], months: Months = {}) =>
  buildCompanySheets({ charges, cards, months, sent, payerId: "gasco", through: "2026-12" });
const sheetOf = (sheets: MonthSheet[], m: string) => sheets.find((s) => s.month === m) as MonthSheet;
const sentNov: SentMonth = { month: "2026-11", chargeIds: ["c1"] };
const doneN1 = card("n1", "Completed", "2026-11-05", "2026-11-05");

check("sent month is frozen against a reopened treatment", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [card("n1", "Ongoing", "2026-11-05")], [sentNov]);
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-11")), ["c1"]);
  assert.notEqual(sheetOf(sheets, "2026-11").sent, null);
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-12")), []);
  assert.deepEqual(heldIds(sheetOf(sheets, "2026-12")), []);
});

check("sent month is frozen against the month picker", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [doneN1], [sentNov], { c1: "2026-12" });
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-11")), ["c1"]);
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-12")), []);
});

check("a procedure finished into a sent month goes on the next open month, and the sent month says so", () => {
  const sheets = sentRun(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-20", "n2")],
    [doneN1, card("n2", "Completed", "2026-11-20", "2026-11-20")],
    [sentNov],
  );
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-11")), ["c1"]);
  assert.deepEqual(heldIds(sheetOf(sheets, "2026-11")), ["c2"]);
  assert.equal(sheetOf(sheets, "2026-11").held[0].reason, "moved");
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-12")), ["c2"]);
});

check("moved charge stays on its sent month", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-12-02", "n1")], [doneN1], [sentNov]);
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-11")), ["c1"]);
  assert.deepEqual(sheetOf(sheets, "2026-12").printed, []);
});

check("deleted charge drops off a sent month", () => {
  const sheets = sentRun(
    [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-06", "n1", { status: "deleted" })],
    [doneN1],
    [{ month: "2026-11", chargeIds: ["c1", "c2"] }],
  );
  assert.deepEqual(printedIds(sheetOf(sheets, "2026-11")), ["c1"]);
});

check("sent month outside the walked range still keeps its charges off the other sheets", () => {
  const sheets = sentRun([charge("c1", "p1", "2026-11-05", "n1")], [doneN1], [{ month: "2027-03", chargeIds: ["c1"] }]);
  assert.deepEqual(sheetOf(sheets, "2026-11").printed, []);
  assert.deepEqual(sheetOf(sheets, "2026-12").printed, []);
});

check("sendRefusal", () => {
  const open = sentRun([charge("c1", "p1", "2026-11-05", "n1"), charge("c9", "p9", "2026-12-05", "n9")], [doneN1, card("n9", "Completed", "2026-12-05", "2026-12-05")], []);
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

// ---- placeCharges ----
check("placement says where a procedure goes and why", () => {
  const charges = [charge("c1", "p1", "2026-11-05", "n1"), charge("c2", "p1", "2026-11-06", "n2"), charge("c3", "p1", "2026-11-20", "n3")];
  const cards = [doneN1, card("n2", "Ongoing", "2026-11-06"), card("n3", "Completed", "2026-11-20", "2026-11-21")];
  const placed = placeCharges({ charges, cards, months: { c3: "2027-01" }, sent: [sentNov], payerId: "gasco" });
  assert.deepEqual(placed.get("c1"), { month: "2026-11", auto: "2026-11", picked: "", sent: true, moved: false, done: true, finishDate: "2026-11-05" });
  assert.deepEqual(placed.get("c2"), { month: "", auto: "", picked: "", sent: false, moved: false, done: false, finishDate: "" });
  assert.deepEqual(placed.get("c3"), { month: "2027-01", auto: "2026-11", picked: "2027-01", sent: false, moved: false, done: true, finishDate: "2026-11-21" });
});

check("nextMonth rolls the year", () => {
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth("2026-09"), "2026-10");
});

// ---- companyStatement -------------------------------------------------------------------------
const doneAll = [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Completed", "2026-11-12", "2026-11-12")];
function stmt(charges: SheetCharge[], cards: SheetCard[], range: { start: string; end: string }, keep?: (c: SheetCharge) => boolean) {
  return companyStatement({
    charges,
    cards,
    months: {},
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

check("statement: the branch filter keeps only that branch's procedures", () => {
  const { statement, sheets } = stmt(
    [charge("c1", "p1", "2026-11-05", "n1", { branchId: "A" }), charge("c2", "p1", "2026-11-06", "n2", { branchId: "B" })],
    [card("n1", "Completed", "2026-11-05", "2026-11-05"), card("n2", "Ongoing", "2026-11-06")],
    { start: "2026-11-01", end: "2026-11-30" },
    (c) => c.branchId === "A",
  );
  assert.deepEqual(statement.cases.map((c) => c.lines.map((l) => l.rowId)), [["c1"]]);
  assert.deepEqual(sheets[0].held, []);
});

check("statement: an unfinished procedure prints nothing", () => {
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
    months: {},
    sent: [],
    payerId: "gasco",
    through: "2026-11",
  });
  const scoped = scopeSheets(sheets, (c) => c.branchId === "A");
  assert.deepEqual(scoped[0].held, []);
  assert.equal(sheets[0].held.length, 1);
});

// ---- the patient list, each procedure's line, the history --------------------------------------
check("patient rows: on this sheet, sent, waiting, later, earlier", () => {
  const charges = [
    charge("s", "samar", "2026-11-05", "ns"),
    charge("a1", "ahmed", "2026-11-04", "na1"),
    charge("a2", "ahmed", "2026-11-04", "na2"),
    charge("h", "hoda", "2026-11-10", "nh"),
    charge("w", "wael", "2026-11-12", "nw"),
    charge("y", "youssef", "2026-11-03", "ny"),
  ];
  const cards = [
    card("ns", "Completed", "2026-11-05", "2026-11-05"),
    card("na1", "Completed", "2026-11-04", "2026-11-04"),
    card("na2", "Ongoing", "2026-11-04"),
    card("nh", "Completed", "2026-11-10", "2026-12-03"),
    card("nw", "Ongoing", "2026-11-12"),
    card("ny", "Completed", "2026-11-03", "2026-11-03"),
  ];
  const inputs = { charges, cards, months: {}, sent: [{ month: "2026-11", chargeIds: ["y"] }], payerId: "gasco" };
  // November is sent with only Youssef on it, so the others finished in November roll on to December.
  const placed = placeCharges(inputs);
  const dec = new Map(patientRows(charges, placed, "2026-12", "2026-12").map((r) => [r.patientId, r]));
  assert.deepEqual(dec.get("samar")?.standing, { kind: "on_sheet", month: "2026-12", sent: false });
  assert.deepEqual(dec.get("ahmed")?.standing, { kind: "on_sheet", month: "2026-12", sent: false });
  assert.deepEqual(ids(dec.get("ahmed") as { charges: SheetCharge[] }), ["a1"]);
  assert.deepEqual((dec.get("ahmed")?.all ?? []).map((c) => c.id), ["a1", "a2"]);
  assert.deepEqual(dec.get("wael")?.standing, { kind: "waiting" });
  assert.deepEqual(dec.get("youssef")?.standing, { kind: "earlier", month: "2026-11" });
  const nov = new Map(patientRows(charges, placed, "2026-11", "2026-11").map((r) => [r.patientId, r]));
  assert.deepEqual(nov.get("youssef")?.standing, { kind: "on_sheet", month: "2026-11", sent: true });
  assert.deepEqual(nov.get("hoda")?.standing, { kind: "later", month: "2026-12" });
  assert.equal(nov.get("wael")?.value, 100);
  const order = patientRows(charges, placed, "2026-12", "2026-12").map((r) => r.patientId);
  assert.deepEqual(order, ["ahmed", "hoda", "samar", "wael", "youssef"]);
});

check("story: started, visits, changes made on the sheet, finished, sent — in order", () => {
  const cards = [
    { ...card("r", "Completed", "2026-11-02", "2026-11-14"), doctor: "Dr. Ahmed" },
    {
      ...card("v", "Completed", "2026-11-09", "2026-11-14", "r"),
      doctor: "Ahmed",
      finishLog: [
        { day: "2026-11-15", kind: "date", byName: "Mona", from: "2026-11-13", to: "2026-11-14" },
        { junk: 1 },
        { day: "2026-11-16", kind: "month", byName: "Mona", from: "", to: "2026-12" },
        { day: "2026-11-16", kind: "start", byName: "Mona", from: "2026-11-03", to: "2026-11-02" },
      ],
    },
  ];
  const map = new Map(cards.map((c) => [c.id, c]));
  const story = serviceStory(charge("c1", "p1", "2026-11-02", "r"), map, cardChildren(cards), [{ month: "2026-12", chargeIds: ["c1"], sentAt: "2027-01-01", sentByName: "Sara" }]);
  assert.deepEqual(
    story.map((e) => [e.date, e.kind, e.by ?? ""]),
    [
      ["2026-11-02", "started", "Ahmed"],
      ["2026-11-09", "visit", "Ahmed"],
      ["2026-11-14", "finished", ""],
      ["2026-11-15", "date_changed", "Mona"],
      ["2026-11-16", "month_changed", "Mona"],
      ["2026-11-16", "start_changed", "Mona"],
      ["2027-01-01", "sent", "Sara"],
    ],
  );
  assert.equal(story[3].from, "2026-11-13");
  assert.equal(story[4].to, "2026-12");
  assert.equal(story[6].month, "2026-12");
});

check("story: an undo then a finish on the same day stay in the order they were made", () => {
  const cards = [
    {
      ...card("n", "Completed", "2026-11-09", "2026-11-18"),
      finishLog: [
        { day: "2026-11-18", kind: "reopened", byName: "Sara", from: "2026-11-09" },
        { day: "2026-11-18", kind: "finished", byName: "Sara" },
      ],
    },
  ];
  const story = serviceStory(charge("c1", "p1", "2026-11-09", "n"), new Map(cards.map((c) => [c.id, c])), cardChildren(cards), []);
  assert.deepEqual(story.map((e) => e.kind), ["started", "reopened", "marked_finished"]);
});

check("story: no card = started and finished on the charge date", () => {
  const story = serviceStory(charge("c1", "p1", "2026-11-02"), new Map(), new Map(), []);
  assert.deepEqual(story.map((e) => e.kind), ["started", "finished"]);
});

check("serviceState: dates, the card acted on, the dentist", () => {
  const cards = [
    { ...card("r", "Completed", "2026-11-02", "2026-11-03"), doctor: "Dr. Karim" },
    { ...card("v", "Ongoing", "2026-11-09", undefined, "r"), doctor: "Dr. Karim" },
  ];
  const map = new Map(cards.map((c) => [c.id, c]));
  assert.deepEqual(serviceState(charge("c1", "p1", "2026-11-02", "r"), map, cardChildren(cards)), {
    noteId: "v",
    done: false,
    startDate: "2026-11-02",
    finishDate: "",
    lastVisit: "2026-11-09",
    nextVisit: "2026-11-09",
    dentist: "Karim",
  });
  const solo = serviceState(charge("c2", "p1", "2026-11-05", undefined, { doctorName: "Dr. Mona" } as Partial<SheetCharge>), new Map(), new Map());
  assert.deepEqual([solo.noteId, solo.done, solo.finishDate, solo.nextVisit, solo.dentist], ["", true, "2026-11-05", "", "Mona"]);
});

check("parseFinishLog keeps only well-formed lines", () => {
  assert.deepEqual(parseFinishLog("x"), []);
  assert.deepEqual(parseFinishLog([{ day: "2026-11-15", kind: "reopened", byName: " Mona ", from: "2026-11-13" }, { day: "", kind: "date" }, { day: "2026-11-15", kind: "other" }]), [
    { day: "2026-11-15", kind: "reopened", byName: "Mona", from: "2026-11-13", to: "" },
  ]);
});

check("the picker offers twelve months, never before the start", () => {
  const early = pickerMonths("2026-11-21", "2026-11");
  assert.equal(early.length, 12);
  assert.equal(early[0], "2026-11");
  assert.equal(early[11], "2027-10");
  const later = pickerMonths("2027-09-02", "2026-11");
  assert.deepEqual([later[0], later[6], later[11]], ["2027-03", "2027-09", "2028-02"]);
});

console.log(failed ? `companySheet: ${failed} failed, ${passed} passed` : `companySheet: all ${passed} checks passed`);
if (failed) process.exit(1);
