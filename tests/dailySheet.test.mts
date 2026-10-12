// The Finance page's daily sheet: one line per patient per day, the patient's money only.
//
// The failures that matter: an insurer's cheque read as the patient's payment, an approval's
// insurer part read as the patient's bill, two visits on one day split across two lines, or the
// Excel file disagreeing with the lines it was built from.
//
// Run with tsx: npm run test:daily-sheet
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { companyCharge, dailySheet, patientCharge, sheetDay, sheetMethodLabel, type SheetLedgerRow } from "../src/lib/dailySheet";
import { dailySheetFileName, dailySheetWorkbook } from "../src/lib/dailySheetXlsx";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const D = "2026-10-07";
const at = (ms: number) => ({ toMillis: () => ms });

// --- 1. What the patient is charged on a treatment ---------------------------------------------
{
  eq(patientCharge({ id: "a", type: "procedure", cost: 900 }), 900, "an ordinary treatment: its price after discount");
  eq(patientCharge({ id: "a", type: "procedure", cost: 0, amount: 500 }), 500, "older rows priced on `amount`");
  eq(patientCharge({ id: "a", type: "procedure", cost: 1000, claimId: "c1", insurerCovered: 800 }), 200, "an approval: the patient's share only");
  eq(patientCharge({ id: "a", type: "procedure", cost: 1000, claimId: "c1", insurerCovered: 5000 }), 0, "never below zero");
  // Owner, 2026-10-12: a GASCO patient owes nothing — GASCO does.
  eq(patientCharge({ id: "a", type: "procedure", cost: 1000, payerId: "gasco", insurerCovered: 800 }), 0, "a contract company with no approval: the patient owes nothing");
  eq(patientCharge({ id: "a", type: "procedure", cost: 1000, payerId: "private" }), 1000, "a private treatment: the patient owes it");
  eq(companyCharge({ id: "a", type: "procedure", cost: 1000, payerId: "gasco" }), 1000, "the contract company owes the whole price");
  eq(companyCharge({ id: "a", type: "procedure", cost: 1000, payerId: "gasco" }, 300), 700, "less what the patient paid on it");
  eq(companyCharge({ id: "a", type: "procedure", cost: 1000, claimId: "c1", insurerCovered: 800 }), 800, "an approval: the approved part");
  eq(companyCharge({ id: "a", type: "procedure", cost: 1000, payerId: "private" }), 0, "a private treatment: nothing on any company");
}

// --- 2. The day's lines -------------------------------------------------------------------------
{
  const rows: (SheetLedgerRow & Record<string, unknown>)[] = [
    // Samir: one big private treatment, paid in cash in two payments.
    { id: "p1", type: "procedure", date: D, patientId: "samir", patientName: "سمير مصطفى", cost: 40400, createdAt: at(1) },
    { id: "y1", type: "payment", date: D, patientId: "samir", patientName: "سمير مصطفى", paid: 40000, amount: 0, method: "Cash", createdAt: at(2) },
    { id: "y2", type: "payment", date: D, patientId: "samir", patientName: "سمير مصطفى", paid: 400, method: "cash", createdAt: at(3) },
    // Shaimaa: a NextCare approval — 665 is her share, she paid 600; the insurer paid its part the same day.
    { id: "p2", type: "procedure", date: D, patientId: "shaimaa", patientName: "شيماء جمال", payerId: "nextcare", payerName: "NEXT", claimId: "c9", cost: 2665, insurerCovered: 2000, createdAt: at(10) },
    { id: "y3", type: "payment", date: D, patientId: "shaimaa", patientName: "شيماء جمال", paid: 600, method: "Cash", procedureId: "p2", payerId: "nextcare", createdAt: at(11) },
    { id: "y4", type: "payment", date: D, patientId: "shaimaa", patientName: "شيماء جمال", paid: 2000, method: "Insurance", procedureId: "p2", payerId: "nextcare", createdAt: at(12) },
    // Hend: paid an old balance by InstaPay, no treatment today.
    { id: "y5", type: "payment", date: D, patientId: "hend", patientName: "هند مصطفى", paid: 600, method: "InstaPay", createdAt: at(20) },
    // Mohamed: a card payment and a deleted treatment that must not count.
    { id: "p3", type: "procedure", date: D, patientId: "mohamed", patientName: "محمد الشلقاني", cost: 2400, createdAt: at(30) },
    { id: "p4", type: "procedure", date: D, patientId: "mohamed", patientName: "محمد الشلقاني", cost: 999, status: "deleted", createdAt: at(31) },
    { id: "y6", type: "payment", date: D, patientId: "mohamed", patientName: "محمد الشلقاني", paid: 2400, method: "Visa", createdAt: at(32) },
    // Not patient money: an expense, and a zero payment.
    { id: "e1", type: "expense", date: D, cost: 300, description: "Gloves", createdAt: at(40) },
    { id: "y7", type: "payment", date: D, patientId: "ghost", patientName: "Ghost", paid: 0, method: "Cash", createdAt: at(41) },
    // The day before, listed first even though it arrives last.
    { id: "p5", type: "procedure", date: "2026-10-06", patientId: "asmaa", patientName: "اسماء صبحي", payerId: "metlife", payerName: "Metlife", claimId: "c2", cost: 1360, insurerCovered: 1000, createdAt: at(99) },
  ];
  const { lines, totals } = dailySheet(rows);

  eq(lines.map((l) => [l.n, l.date, l.patientName]), [
    [1, "2026-10-06", "اسماء صبحي"],
    [2, D, "سمير مصطفى"],
    [3, D, "شيماء جمال"],
    [4, D, "هند مصطفى"],
    [5, D, "محمد الشلقاني"],
  ], "oldest day first, then in the order patients came; no line for the expense or the zero payment");

  const by = (id: string) => lines.find((l) => l.patientId === id)!;
  eq([by("samir").total, by("samir").paid, by("samir").remaining], [40400, 40400, 0], "two payments on one line");
  eq(by("samir").methods, ["Cash"], "'Cash' and 'cash' are one method");
  eq(by("samir").payerIds, [], "a private patient: the clinic's own file");

  eq([by("shaimaa").total, by("shaimaa").paid, by("shaimaa").remaining], [665, 600, 65], "an approval patient: their share, their cash, 65 left");
  eq(by("shaimaa").payerIds, ["nextcare"], "the insurer behind the work");
  eq(by("shaimaa").payerNames, ["NEXT"], "its stored name");
  eq(by("shaimaa").methods, ["Cash"], "the insurer's payment is not a method the patient used");

  eq([by("hend").total, by("hend").paid, by("hend").remaining], [600, 600, 0], "an old balance settled: the total is what was paid");
  eq(by("hend").methods, ["InstaPay"], "InstaPay folded");

  eq([by("mohamed").total, by("mohamed").paid, by("mohamed").remaining], [2400, 2400, 0], "a deleted treatment does not count");
  eq(by("mohamed").methods, ["Card"], "Visa is the card machine");

  eq([by("asmaa").total, by("asmaa").paid, by("asmaa").remaining], [360, 0, 360], "nothing paid yet: all of it remains");

  eq([totals.total, totals.paid, totals.remaining], [44425, 44000, 425], "the totals add the lines");
  eq(totals.byMethod, [
    { method: "Cash", paid: 41000 },
    { method: "InstaPay", paid: 600 },
    { method: "Card", paid: 2400 },
  ], "what came in by each method, the insurer's 2000 not among it");
}

// --- 3. A patient with no id (older rows) is grouped by name; one with neither is skipped -------
{
  const { lines } = dailySheet([
    { id: "a", type: "payment", date: D, patientName: "Walk-in", paid: 100, method: "Cash" },
    { id: "b", type: "payment", date: D, patientName: "Walk-in", paid: 50, method: "Bank transfer" },
    { id: "c", type: "payment", date: D, paid: 70, method: "Cash" },
  ]);
  eq(lines.length, 1, "no patient at all: not a line");
  eq([lines[0].paid, lines[0].methods], [150, ["Cash", "Bank transfer"]], "by name, and an unlisted method kept as written");
}

// --- 4. Labels -------------------------------------------------------------------------------------
{
  eq(["Cash", "Card", "InstaPay", "Bank transfer"].map((m) => sheetMethodLabel(m)), ["Cash", "Visa", "InstaPay", "Transfer"], "plain words");
  eq(["Card", "InstaPay"].map((m) => sheetMethodLabel(m, true)), ["فيزا", "انستاباي"], "Arabic card and InstaPay");
  eq(sheetMethodLabel("Cash", true), "كاش", "Arabic cash");
  eq(sheetDay("2026-10-07"), "07/10/2026", "day/month/year");
  eq(dailySheetFileName("2026-10-07", "2026-10-07"), "daily-sheet-2026-10-07.xlsx", "one day");
  eq(dailySheetFileName("2026-10-01", "2026-10-31"), "daily-sheet-2026-10-01-to-2026-10-31.xlsx", "a range");
}

// --- 5. The Excel file, read back from the bytes ------------------------------------------------
{
  const buf = XLSX.write(
    dailySheetWorkbook({
      lines: [
        { n: 1, date: "2026-10-07", file: "File", patient: "سمير مصطفى", method: "Cash", work: 40400, company: 0, total: 40400, paid: 40400, remaining: 0 },
        { n: 2, date: "2026-10-07", file: "NEXT", patient: "شيماء جمال", method: "Cash", work: 2665, company: 2000, total: 665, paid: 600, remaining: 65 },
      ],
      byMethod: [{ label: "Cash", paid: 41000 }],
      start: "2026-10-07",
      end: "2026-10-07",
      isAr: false,
    }),
    { type: "buffer", bookType: "xlsx" },
  );
  const wb = XLSX.read(buf, { type: "buffer", cellFormula: true, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  eq(Boolean(wb.Workbook?.Views?.[0]?.RTL), true, "right to left, like the clinic's sheet");
  eq(["A4", "B4", "C4", "D4", "E4", "F4", "G4", "H4", "I4", "J4"].map((c) => ws[c]?.v), ["#", "Date", "File", "Patient", "Method", "Work done", "Company owes", "Patient owes", "Paid", "Remaining"], "the header row");
  eq([ws.A5.v, ws.C5.v, ws.D5.v, ws.E5.v, ws.F5.v, ws.G5.v, ws.H5.v, ws.I5.v, ws.J5.v], [1, "File", "سمير مصطفى", "Cash", 40400, 0, 40400, 40400, 0], "a line");
  eq([ws.F6.v, ws.G6.v, ws.H6.v], [2665, 2000, 665], "an approval line: work, the insurer's part, the patient's part");
  eq(ws.B5.v, 46302, "the date is a real Excel date (7 Oct 2026)");
  eq([ws.F7.f, ws.F7.v, ws.G7.v, ws.H7.f, ws.H7.v, ws.J7.f, ws.J7.v], ["SUM(F5:F6)", 43065, 2000, "SUM(H5:H6)", 41065, "SUM(J5:J6)", 65], "totals are formulas with the figure cached");
  eq([ws.E10.v, ws.I10.v], ["Cash", 41000], "paid by method, under Paid");

  const ar = XLSX.read(
    XLSX.write(dailySheetWorkbook({ lines: [], byMethod: [], start: "2026-10-01", end: "2026-10-31", isAr: true }), { type: "buffer", bookType: "xlsx" }),
    { type: "buffer" },
  );
  const wsAr = ar.Sheets[ar.SheetNames[0]];
  eq([wsAr.A4.v, wsAr.D4.v, wsAr.F4.v, wsAr.G4.v, wsAr.J4.v], ["م", "اسم المريض", "قيمة الشغل", "على الشركة", "المتبقي"], "Arabic headers");
  eq(wsAr.A5.v, "مفيش مرضى في الفترة دي.", "an empty period says so");
}

console.log(`daily sheet: ${checks} checks passed`);
