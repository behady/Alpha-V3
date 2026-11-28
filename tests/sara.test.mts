// Sara's ready-made answers and the limits around them.
//
// What these pin, each one a way the assistant could quietly do the wrong thing:
//
//   1. Telling someone money they cannot see on their own screens (the read policy).
//   2. Pulling hundreds of full records into the model for one question (the read budget).
//   3. Returning an empty reply, charging for it, and feeding the "…" back as history.
//   4. A money summary that disagrees with the Finance page (placeholder zeros, treatment rows).
//   5. A debt list that disagrees with the Outstanding Balances report.
//   6. A report digest that carries the whole table instead of its first rows.
//
// Run with tsx: npm run test:sara
import assert from "node:assert/strict";
import { readDenial, seesMoney, withoutPayFields } from "../src/lib/sara/readPolicy";
import { NORMAL_LIMITS, DEEP_LIMITS, DEEP_SEARCH_CREDITS, ReadBudget, rowsFor, slimDoc } from "../src/lib/sara/readBudget";
import { isEmptyReply, needsRescue, noAnswerText, withoutEmptyTurns } from "../src/lib/sara/turnOutcome";
import { buildMoneyDay, moneyDayDigest, moneyDayPdfSections } from "../src/lib/sara/cashAnswer";
import { buildDebts, creditLines, debtsDigest, debtsPdfSections } from "../src/lib/sara/debts";
import { digestReportDoc, docToPdfSections } from "../src/lib/sara/reportDigest";
import type { ReportDoc } from "../src/lib/reports/documents";

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. Who may read what ---------------------------------------------------------------------------

const RECEPTION = ["access.patients", "access.appointments", "finance.add"];
const ACCOUNTANT = ["access.finance", "access.reports"];

ok(readDenial("ledger", undefined, "Receptionist", RECEPTION) !== null, "a receptionist cannot read the clinic's ledger");
ok(readDenial("expenses", undefined, "Receptionist", RECEPTION) !== null, "nor its expenses");
eq(readDenial("ledger", { whereField: "patientId", whereOperator: "==", whereValue: "p1" }, "Receptionist", RECEPTION), null, "one patient's account is the patient file, which she can open");
ok(readDenial("ledger", { whereField: "patientId", whereOperator: ">", whereValue: "" }, "Receptionist", RECEPTION) !== null, "a patientId filter that is not an exact match is still the whole ledger");
ok(readDenial("ledger", { whereField: "patientId", whereOperator: "==", whereValue: "  " }, "Receptionist", RECEPTION) !== null, "an empty patient id is not a patient");
eq(readDenial("ledger", undefined, "Accountant", ACCOUNTANT), null, "finance access reads the ledger");
eq(readDenial("ledger", undefined, "Admin", []), null, "an admin reads everything");
eq(readDenial("staff", undefined, "Owner", []), null, "and so does the owner");
eq(readDenial("patients", undefined, "Receptionist", RECEPTION), null, "a receptionist reads patients");
ok(readDenial("clinical_notes", undefined, "Receptionist", RECEPTION) !== null, "but not clinical notes");
ok(readDenial("inventory", undefined, "Receptionist", RECEPTION) !== null, "nor stock");
ok(readDenial("patients", undefined, "Accountant", ACCOUNTANT) !== null, "an accountant without the patients tick cannot read patients");
eq(readDenial("services", undefined, "Receptionist", []), null, "the price list is open to all staff");
eq(readDenial("staff", undefined, "Receptionist", RECEPTION), null, "staff names are open; pay is stripped separately");
eq(readDenial("clinical_notes", undefined, "Receptionist", RECEPTION, "reception"), null, "the appointment panel keeps its own hand-made allowlist");
ok(readDenial("ledger", undefined, "Receptionist", RECEPTION, "reception") !== null, "but even there the whole ledger needs finance access");
eq(readDenial("ledger", { whereField: "patientId", whereOperator: "==", whereValue: "p1" }, "Receptionist", [], "reception"), null, "the panel reads the account of the patient on screen");
ok(/money/.test(readDenial("ledger", undefined, "Receptionist", RECEPTION) || ""), "the refusal tells the model what to say");

ok(seesMoney("Admin", []) && seesMoney("Accountant", ACCOUNTANT) && !seesMoney("Receptionist", RECEPTION), "seesMoney is the Finance page's permission");

eq(
  withoutPayFields({ name: "Dr Omar", role: "Dentist", baseSalary: 9000, commissionPercentage: 40, overtimeMultiplier: 1.5, paidDaily: true, phone: "0100" }),
  { name: "Dr Omar", role: "Dentist", phone: "0100" },
  "a staff row loses every pay field",
);

// --- 2. How much may be read ----------------------------------------------------------------------

eq(rowsFor(undefined, NORMAL_LIMITS), 20, "no number asked: twenty rows, not a hundred");
eq(rowsFor(1000, NORMAL_LIMITS), 50, "a big number is capped");
eq(rowsFor(5, NORMAL_LIMITS), 5, "a small number is honoured");
eq(rowsFor("abc", NORMAL_LIMITS), 20, "nonsense falls back to the default");
eq(rowsFor(1000, DEEP_LIMITS), 200, "a deep search reads more, still capped");
ok(DEEP_LIMITS.ceilingChars > NORMAL_LIMITS.ceilingChars && DEEP_LIMITS.maxRounds > NORMAL_LIMITS.maxRounds, "deep raises the ceilings");
eq(DEEP_SEARCH_CREDITS, 10, "the owner set the deep search at ten credits");

const fat = {
  id: "p1",
  name: "Mariam",
  teethData: { 11: { status: "crown" }, 12: { status: "filling" } },
  photos: ["a", "b"],
  avatar: "data:image/png;base64,AAAA",
  notes: "x".repeat(900),
  visits: Array.from({ length: 30 }, (_, i) => i),
  address: { city: "Cairo" },
  nested: { deep: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v".repeat(50)])) },
};
const slim = slimDoc(fat);
ok(!("teethData" in slim) && !("photos" in slim), "the tooth chart and photos never reach the model");
ok(!("avatar" in slim), "an inline image is dropped");
ok(String(slim.notes).length <= 401, "a long text is cut");
eq((slim.visits as unknown[]).length, 21, "a long list keeps twenty items and a count of the rest");
eq(slim.address, { city: "Cairo" }, "small nested objects survive");
eq((slim.nested as Record<string, unknown>).deep, "[left out: too large]", "a large nested blob is replaced by a marker");
eq(slim.name, "Mariam", "ordinary fields are untouched");

const budget = new ReadBudget({ defaultRows: 20, maxRows: 50, ceilingChars: 100, maxRounds: 5 });
const small = { id: "a", n: 1 }; // 16 characters
const first = budget.fit([small, small, small]);
eq(first.docs.length, 3, "rows under the ceiling all fit");
ok(!budget.hit, "and the ceiling is not hit");
const second = budget.fit(Array.from({ length: 10 }, () => small));
eq(second.docs.length, 3, "only what still fits is returned");
eq(second.leftOut, 7, "the rest is counted");
ok(budget.hit, "leaving anything out marks the ceiling as hit");
eq(budget.fit([small]).docs.length, 0, "once full, nothing more fits");

// --- 3. Never an empty answer ---------------------------------------------------------------------

ok(isEmptyReply("") && isEmptyReply("   ") && isEmptyReply("...") && isEmptyReply("…") && isEmptyReply(null), "nothing, spaces and dots are all empty");
ok(!isEmptyReply("42 patients owe 61,300."), "a sentence is not");
ok(needsRescue("", false), "an empty reply needs the last call");
ok(needsRescue("Let me check", true), "so does a turn still asking for a tool");
ok(!needsRescue("Done.", false), "a finished answer does not");
ok(/[؀-ۿ]/.test(noAnswerText("مين عليه فلوس؟")), "an Arabic question gets an Arabic apology");
ok(/not charged/.test(noAnswerText("Who owes us?")), "an English one says it was not charged");

const history = [
  { role: "user", content: "How much today?" },
  { role: "assistant", content: "4,200 EGP." },
  { role: "user", content: "Who owes us money?" },
  { role: "assistant", content: "..." },
  { role: "user", content: "??" },
  { role: "assistant", content: "…" },
];
eq(
  withoutEmptyTurns(history),
  [
    { role: "user", content: "How much today?" },
    { role: "assistant", content: "4,200 EGP." },
  ],
  "a silent answer leaves the history together with its question",
);
eq(withoutEmptyTurns([{ role: "model", parts: [{ text: "..." }] }]).length, 0, "the Gemini turn shape is understood too");
eq(withoutEmptyTurns(history.slice(0, 2)).length, 2, "a clean history is unchanged");

// --- 4. Money for a period -----------------------------------------------------------------------

const ledger = [
  // The inline-payment shape: placeholder amount 0, the money in `paid`.
  { id: "1", type: "payment", date: "2026-11-28", patientName: "Mariam", amount: 0, paid: 1500, method: "cash", addedBy: "Nour", doctorCommissionAmount: 600, labFee: 100, branchId: "b1" },
  { id: "2", type: "payment", date: "2026-11-28", patientName: "Omar", paid: 800, method: "Visa", receivedBy: "Salma", branchId: "b2" },
  { id: "3", type: "payment", date: "2026-11-28", patientName: "Hana", paid: 400, method: "Instapay", addedBy: "Nour", branchId: "b1" },
  { id: "4", type: "income", date: "2026-11-28", description: "Sold a kit", paid: 100, method: "" },
  // A treatment is a plan, not cash, even with something paid on it.
  { id: "5", type: "procedure", date: "2026-11-28", patientName: "Mariam", cost: 5000, paid: 1500 },
  // The manual-expense shape: placeholder paid 0, the money in `cost`.
  { id: "6", type: "expense", date: "2026-11-28", category: "Supplies", description: "Gloves", paid: 0, cost: 300, method: "Cash", addedBy: "Salma", branchId: "b1" },
  { id: "7", type: "expense", date: "2026-11-28", category: "Rent", description: "November", cost: 2000, method: "Bank transfer" },
  { id: "8", type: "payment", date: "2026-11-28", patientName: "Deleted", paid: 999, status: "deleted" },
  { id: "9", type: "payment", date: "2026-11-27", patientName: "Yesterday", paid: 50 },
];
const day = buildMoneyDay({ rows: ledger, startDate: "2026-11-28", endDate: "2026-11-28", branches: [{ id: "b1", name: "Nasr City" }, { id: "b2", name: "Maadi" }] });
eq(day.collected, 2800, "collected = payments and other income, read from the non-zero field");
eq(day.expenses, 2300, "expenses read from cost when paid is a placeholder zero");
eq(day.dentistShare, 600, "the dentist's share rides on the payment");
eq(day.labFees, 100, "and so does the lab fee");
eq(day.net, -200, "net = collected - expenses - dentist share - lab");
eq(day.byMethod.map((m) => [m.name, m.total]), [["Cash", 1600], ["Card", 800], ["InstaPay", 400]], "methods are folded into the report's buckets");
eq(day.byCollector.map((c) => [c.name, c.total]), [["Nour", 1900], ["Salma", 800], ["Not recorded", 100]], "who collected, from addedBy or receivedBy");
eq(day.byBranch.find((b) => b.name === "Nasr City"), { name: "Nasr City", collected: 1900, expenses: 300 }, "branches by their names");
eq(day.drawer, { cashIn: 1600, cashOut: 300, left: 1300 }, "the drawer is cash in minus cash out");
eq(day.payments.length, 4, "every payment line is kept (not the deleted one, not yesterday's, not the treatment)");
eq(day.expenseLines.map((l) => l.who), ["Rent", "Supplies"], "expense lines carry their category, biggest first within a day");

const digest = moneyDayDigest(day, 2);
eq(digest.payments.lines.length, 2, "the model sees the first lines only");
eq(digest.payments.count, 4, "and how many there are");
ok(digest.moreInPdf, "and that the rest is in the PDF");
ok("byBranch" in digest, "branches appear when there is more than one");
ok(!("byBranch" in moneyDayDigest(buildMoneyDay({ rows: ledger.filter((r) => r.branchId === "b1"), startDate: "2026-11-28", endDate: "2026-11-28" }))), "and not for a single one");

const pdf = moneyDayPdfSections(day, false);
eq(pdf.find((s) => s.heading === "Payments")?.rows?.length, 4, "the PDF has every payment");
ok(moneyDayPdfSections(day, true).some((s) => s.heading === "المدفوعات"), "and Arabic headings in Arabic");

// --- 5. Who owes --------------------------------------------------------------------------------

const TODAY = "2026-11-28";
const patients = [
  { id: "p1", name: "Mariam Adel", phone: "+201000000001" },
  { id: "p2", name: "Omar Said", phone: "+201000000002" },
  { id: "p3", name: "Hana Fathy", phone: "+201000000003" },
  { id: "p4", name: "Karim Nabil", phone: "+201000000004" },
];
const book = [
  { id: "a", type: "procedure", patientId: "p1", patientName: "Mariam", cost: 5000, date: "2026-06-01" },
  { id: "b", type: "payment", patientId: "p1", amount: 0, paid: 1000, date: "2026-06-01" },
  { id: "c", type: "procedure", patientId: "p2", cost: 900, date: "2026-11-20" },
  { id: "d", type: "payment", patientId: "p2", paid: 400, date: "2026-11-20" },
  { id: "e", type: "procedure", patientId: "p3", cost: 300, date: "2026-11-01" },
  { id: "f", type: "payment", patientId: "p3", paid: 1000, date: "2026-11-01" },
  { id: "g", type: "procedure", patientId: "p4", cost: 700, date: "2026-11-10" },
  { id: "h", type: "payment", patientId: "p4", paid: 700, date: "2026-11-10" },
  { id: "i", type: "expense", cost: 9999, date: "2026-11-10" },
];
const base = { ledger: book, patients, today: TODAY };

const everyone = buildDebts({ ...base, filter: "all" });
eq(everyone.lines.map((l) => [l.name, l.amount]), [["Mariam Adel", 4000], ["Omar Said", 500]], "who owes, biggest first, with the name from the patient file");
eq(everyone.total, 4500, "and the total");
eq(everyone.clinic, { owed: 4500, patients: 2, credit: 700, creditPatients: 1 }, "the clinic-wide sums include the credit held");

eq(buildDebts({ ...base, filter: "top", limit: 1 }).lines.map((l) => l.name), ["Mariam Adel"], "top N");
eq(buildDebts({ ...base, filter: "older", days: 90 }).lines.map((l) => l.name), ["Mariam Adel"], "older than three months, by the oldest unpaid treatment");
eq(buildDebts({ ...base, filter: "today", todayPatientIds: new Set(["p2", "p4"]) }).lines.map((l) => l.name), ["Omar Said"], "of today's patients, only the ones who owe");
eq(buildDebts({ ...base, filter: "patient", patientId: "p2" }).total, 500, "one patient");
ok(/owes nothing/.test(buildDebts({ ...base, filter: "patient", patientId: "p4" }).note), "a settled patient is said to owe nothing");
ok(/holds 700/.test(buildDebts({ ...base, filter: "patient", patientId: "p3" }).note), "a patient in credit is told what the clinic holds");
eq(buildDebts({ ...base, filter: "credit" }).lines.map((l) => [l.name, l.amount]), [["Hana Fathy", 700]], "paid in advance");
eq(creditLines(book, patients).length, 1, "creditLines alone agrees");
eq(buildDebts({ ...base, filter: "finished", openTreatmentPatientIds: new Set(["p1"]) }).lines.map((l) => l.name), ["Omar Said"], "finished = owes, and nothing planned or ongoing");

const debtDigest = debtsDigest(buildDebts({ ...base, filter: "all" }), 1);
eq(debtDigest.lines.length, 1, "the model sees the first names only");
ok(debtDigest.moreInPdf && debtDigest.patients === 2, "and is told there are more");
eq(debtsPdfSections(everyone, false).find((s) => s.heading === "Who owes")?.rows?.length, 2, "the PDF lists everyone");
ok(debtsPdfSections(buildDebts({ ...base, filter: "patient", patientId: "p4" }), false).some((s) => /owes nothing/.test(s.note || "")), "an empty list prints its reason");

// --- 6. A report, digested -----------------------------------------------------------------------

const doc: ReportDoc = {
  id: "discounts",
  title: "Discounts",
  hint: "",
  range: { start: "2026-11-01", end: "2026-11-28", label: "1–28 Nov 2026" },
  allTime: false,
  figures: [{ label: "Given away", value: "12,400 EGP", delta: { pct: 20, text: "▲ 20% (+2,000)", bad: true } }],
  sections: [
    {
      type: "table",
      title: "Every discount",
      columns: [
        { key: "patient", label: "Patient" },
        { key: "discount", label: "Discount", kind: "money" },
        { key: "pct", label: "Share", kind: "pct" },
      ],
      rows: Array.from({ length: 25 }, (_, i) => ({ _patientId: `p${i}`, patient: `Patient ${i}`, discount: 1000.4 + i, pct: 12.345 })),
      total: { patient: "25", discount: 25310 },
    },
    { type: "bars", title: "By dentist", rows: [{ label: "Dr Omar", value: 9000, text: "9,000" }] },
    { type: "statement", title: "P&L", lines: [{ label: "Income", value: 1000, kind: "plus" }, { label: "Costs", value: 400, kind: "minus" }] },
    { type: "note", text: "  " },
  ],
};
const d = digestReportDoc(doc, 10);
eq(d.figures, [{ label: "Given away", value: "12,400 EGP", change: "▲ 20% (+2,000)" }], "figures carry their change");
const table = d.sections[0] as { rows: string[][]; rowCount: number; shown: number; total?: string[]; columns: string[] };
eq(table.rows.length, 10, "ten rows of a table, not twenty-five");
eq([table.rowCount, table.shown], [25, 10], "with the true count beside them");
eq(table.rows[0], ["Patient 0", "1,000", "12.3%"], "cells are formatted by kind, and the hidden patient id is gone");
eq(table.total, ["25", "25,310", ""], "the total row comes along");
ok(d.moreInPdf, "more rows than shown is flagged");
eq(d.sections.length, 3, "an empty note is dropped");
eq((d.sections[2] as { lines: { value: string }[] }).lines.map((l) => l.value), ["1,000", "−400"], "a statement keeps its minus signs");
ok(JSON.stringify(d).length < 1500, "the whole digest stays small");

const sections = docToPdfSections(doc);
eq(sections[0].rows?.[0], ["Given away", "12,400 EGP  (▲ 20% (+2,000))"], "the PDF opens with the figures");
eq(sections[1].rows?.length, 26, "then every row of the table plus its total");

console.log(`sara: ${checks} checks passed`);
