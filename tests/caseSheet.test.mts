// The case sheet: one line per treatment, filtered, totalled and paged.
//
// This is the report the others get checked against, which is exactly why its arithmetic has to be
// boring and its edges have to be pinned. The failures that matter are not crashes:
//
//   - money attached to the wrong case, which makes a paid case look outstanding and sends
//     somebody to chase a patient who has already paid;
//   - totals that describe the period while the rows on screen describe a filter, which everybody
//     reads as the filtered figure, once, and is wrong every time;
//   - a page number that survives a filter, showing an empty table that looks like "no results".
//
// Run with tsx: npm run test:cases
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_FILTERS,
  buildCaseSheet,
  filterCases,
  foldForSearch,
  optionsFor,
  pageOf,
  serviceLabel,
  settlementOf,
  sumCases,
} from "../src/lib/caseSheet";

const REPO = join(import.meta.dirname, "..");
let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const PROCEDURES = [
  {
    id: "c1", type: "procedure", date: "2026-09-18", payerId: "axa", payerName: "AXA",
    patientId: "p1", patientName: "Ahmed Hassan", serviceName: "Composite Filling",
    doctorId: "d1", doctorName: "Mostafa", cost: 600, labFee: 0,
  },
  {
    id: "c2", type: "procedure", date: "2026-09-20", payerId: "private", payerName: "Private",
    patientId: "p1", patientName: "Ahmed Hassan", serviceName: "Zirconia Crown",
    doctorId: "d2", doctorName: "Hana", cost: 5000, labFee: 1000,
  },
  {
    // No payer, no dentist: the pre-payers world, and a treatment the clinic did rather than a person.
    id: "c3", type: "procedure", date: "2026-09-19", patientId: "p2", patientName: "أحمد فتحي",
    procedures: ["Scaling", "Polish"], cost: 800,
  },
];

const PAYMENTS = [
  { type: "payment", procedureId: "c1", paid: 600, doctorCommissionAmount: 90 },
  { type: "payment", procedureId: "c2", paid: 2000, doctorCommissionAmount: 400 },
  // Money on account: names no treatment, so it belongs to no row on this sheet.
  { type: "payment", paid: 5000, doctorCommissionAmount: 0 },
  // An expense in the same period must never be read as a payment against a case.
  { type: "expense", procedureId: "c1", paid: 999, amount: 999 },
];

// --- 1. Each case carries its own money, and only its own -------------------------------------
{
  const rows = buildCaseSheet(PROCEDURES, PAYMENTS);
  eq(rows.length, 3, "one row per treatment, and advance payments add none");
  eq(rows.map((r) => r.id), ["c2", "c3", "c1"], "newest first, then by patient");

  const c1 = rows.find((r) => r.id === "c1")!;
  eq(c1.paid, 600, "a payment naming its treatment settles that treatment");
  eq(c1.share, 90, "and carries the commission stamped on it");
  ok(c1.paid !== 1599, "an expense against the same id must not be counted as money in");

  const c2 = rows.find((r) => r.id === "c2")!;
  eq(c2.paid, 2000, "a part-paid case shows only what was actually received");
  eq(c2.price, 5000, "and its full price beside it");

  const c3 = rows.find((r) => r.id === "c3")!;
  eq(c3.paid, 0, "a case with no payment shows nothing paid");
  eq(c3.share, 0, "and nothing earned — this clinic pays on collection");
  eq(c3.payerName, "Private", "an unstamped case reads as private");
  eq(c3.doctorName, "General", "a case with no dentist is named, not left blank");
  eq(c3.service, "Scaling + Polish", "a multi-treatment case keeps both names");
}

// --- 2. What the treatment is called -----------------------------------------------------------
{
  eq(serviceLabel({ serviceName: "Consultation" }), "Consultation", "the service name wins");
  eq(serviceLabel({ procedures: ["A", "B"] }), "A + B", "then what was typed");
  eq(
    serviceLabel({ description: "Zirconia Crown (T: 11) | 1x5000=5000" }),
    "Zirconia Crown",
    "then the description, stripped of the tooth and the formula the ledger appends"
  );
  eq(serviceLabel({}), "—", "and something rather than an empty cell");
}

// --- 3. Settlement, which is what a clinic scans this sheet for --------------------------------
{
  const paid = { price: 600, paid: 600 } as never;
  const part = { price: 5000, paid: 2000 } as never;
  const none = { price: 800, paid: 0 } as never;
  eq(settlementOf(paid), "paid", "fully settled");
  eq(settlementOf(part), "partly", "part paid");
  eq(settlementOf(none), "unpaid", "nothing paid");
  eq(
    settlementOf({ price: 100, paid: 99.995 } as never),
    "paid",
    "a rounding tail must not make a settled case look outstanding"
  );
  eq(settlementOf({ price: 100, paid: 150 } as never), "paid", "an overpayment is settled, not partly");
}

// --- 4. Filtering, including the Arabic name nobody can otherwise find -------------------------
{
  const rows = buildCaseSheet(PROCEDURES, PAYMENTS);

  eq(filterCases(rows, EMPTY_FILTERS).length, 3, "no filters means everything");
  eq(filterCases(rows, { ...EMPTY_FILTERS, payerId: "axa" }).length, 1, "by company");
  eq(filterCases(rows, { ...EMPTY_FILTERS, doctorId: "d2" }).length, 1, "by dentist");
  eq(filterCases(rows, { ...EMPTY_FILTERS, service: "Zirconia Crown" }).length, 1, "by service");
  eq(filterCases(rows, { ...EMPTY_FILTERS, settled: "unpaid" }).map((r) => r.id), ["c3"], "by settlement");
  eq(
    filterCases(rows, { ...EMPTY_FILTERS, payerId: "axa", doctorId: "d2" }).length,
    0,
    "filters combine rather than widen"
  );

  eq(filterCases(rows, { ...EMPTY_FILTERS, patient: "ahmed" }).length, 2, "the patient search ignores case");
  eq(filterCases(rows, { ...EMPTY_FILTERS, patient: "hassan" }).length, 2, "and matches anywhere in the name");
  /**
   * The one that fails silently. "احمد" and "أحمد" are the same name to everyone except a string
   * comparison, and a search that finds nothing reads as "we have no record of that patient".
   */
  eq(
    filterCases(rows, { ...EMPTY_FILTERS, patient: "احمد" }).map((r) => r.id),
    ["c3"],
    "an Arabic name written without the hamza still finds the patient written with it"
  );
  eq(foldForSearch("أحمد"), foldForSearch("احمد"), "the two spellings fold together");
  eq(foldForSearch("  Ahmed   Hassan "), "ahmed hassan", "and spacing is normalised");
}

// --- 5. Totals describe the rows on screen, never the period -----------------------------------
{
  const rows = buildCaseSheet(PROCEDURES, PAYMENTS);
  const all = sumCases(rows);
  eq(all.cases, 3, "three cases");
  eq(all.price, 6400, "charged");
  eq(all.paid, 2600, "collected");
  eq(all.share, 490, "dentists' share");
  eq(all.outstanding, 3800, "and what is still owed");

  const axa = sumCases(filterCases(rows, { ...EMPTY_FILTERS, payerId: "axa" }));
  eq(axa.cases, 1, "filtered to one insurer, the totals are that insurer's");
  eq(axa.paid, 600, "and its money only");
  eq(axa.outstanding, 0, "with nothing outstanding");

  eq(
    sumCases(filterCases(rows, { ...EMPTY_FILTERS, patient: "nobody" })),
    { cases: 0, price: 0, paid: 0, share: 0, outstanding: 0 },
    "an empty filter result totals zero rather than falling back to everything"
  );
  // An overpayment must not subtract from what other cases still owe.
  eq(
    sumCases([{ price: 100, paid: 500 } as never, { price: 100, paid: 0 } as never]).outstanding,
    100,
    "an overpaid case contributes nothing to outstanding, it does not offset another case"
  );
}

// --- 6. Paging, and the page number that must not survive a filter ----------------------------
{
  const many = Array.from({ length: 57 }, (_, i) => ({ id: `r${i}` }));
  const first = pageOf(many, 1, 25);
  eq([first.rows.length, first.pages, first.from, first.to], [25, 3, 1, 25], "the first page");
  const last = pageOf(many, 3, 25);
  eq([last.rows.length, last.from, last.to], [7, 51, 57], "the last page is a short one");

  eq(
    pageOf(many, 9, 25).page,
    3,
    "a page past the end clamps to the last — otherwise narrowing a filter shows an empty table that reads as 'no results'"
  );
  eq(pageOf(many, 0, 25).page, 1, "and a page before the start clamps to the first");
  eq(pageOf([], 4, 25), { rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0 }, "no rows is page 1 of 1, showing 0");
  eq(pageOf(many, 1, 0).rows.length, 25, "an unusable page size falls back rather than dividing by zero");
}

// --- 7. The dropdowns offer what is present, and nothing else ---------------------------------
{
  const rows = buildCaseSheet(PROCEDURES, PAYMENTS);
  eq(optionsFor(rows, "payer").map((o) => o.label), ["AXA", "Private"], "companies, sorted");
  eq(optionsFor(rows, "doctor").map((o) => o.label), ["General", "Hana", "Mostafa"], "dentists, including General");
  eq(
    optionsFor(rows, "service").map((o) => o.label),
    ["Composite Filling", "Scaling + Polish", "Zirconia Crown"],
    "and the services actually done in the period"
  );
}

// --- 8. The screen keeps the promises the library makes ---------------------------------------
{
  const ui = readFileSync(join(REPO, "src/components/reports/CaseSheetReport.tsx"), "utf8");
  ok(
    /sumCases\(rows\)/.test(ui),
    "the totals are computed from the FILTERED rows — a footer showing the period's totals under filtered rows is read as the filtered figure by everyone"
  );
  ok(
    /exportToExcel\(\s*rows\.map/.test(ui),
    "export takes the filtered rows; an export that widened back to everything would be a different document from the one on screen"
  );
  ok(/pageOf\(rows, page, size\)/.test(ui), "the table pages the filtered rows");
  const page = readFileSync(join(REPO, "src/app/(dashboard)/reports/page.tsx"), "utf8");
  ok(/id: "cases"/.test(page) && /CaseSheetReport/.test(page), "the tab is registered and rendered");
}

console.log(`caseSheet: ${checks} checks passed`);
