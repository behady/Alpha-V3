// The owner's nightly money sheet on WhatsApp: per branch, one line per patient, what was done,
// by whom, what they owed and paid, and the dentist's share of the work.
//
// The failures that matter: a branch's money landing in the other branch or dropping out of the
// total, the dentist's share counted twice (once on the treatment, again on its payment), the file
// disagreeing with the Finance page's daily sheet, and the sheet reading left to right in a viewer
// that ignores Excel's RTL switch.
//
// Run with tsx: npm run test:daily-finance-report
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import XLSX from "xlsx-js-style";
import { dailySheet } from "../src/lib/dailySheet";
import { PRIVATE_PAYER, type Payer } from "../src/lib/payers";
import {
  buildDailyFinanceReport,
  dailyFinanceReportFileName,
  dailyFinanceReportText,
  procedureName,
  type ReportLedgerRow,
} from "../src/lib/reports/dailyFinanceReport";
import { dailyFinanceReportBytes, dailyFinanceReportWorkbook } from "../src/lib/reports/dailyFinanceReportXlsx";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const D = "2026-10-12";
const at = (ms: number) => ({ toMillis: () => ms });
const payers: Payer[] = [PRIVATE_PAYER, { id: "metlife", name: "Metlife", nameAr: "ميتلايف", active: true } as Payer, { id: "nextcare", name: "NEXT", active: true } as Payer];
const branches = [
  { id: "nasr", name: "مدينة نصر" },
  { id: "maadi", name: "المعادي" },
];

const rows: ReportLedgerRow[] = [
  // Nasr City — Samir: a private implant, paid in full. The payment carries its own copy of the
  // commission, which must NOT be added to the treatment's.
  { id: "p1", type: "procedure", date: D, branchId: "nasr", patientId: "samir", patientName: "سمير", serviceName: "زرعة", doctorName: "د. أحمد", cost: 40400, doctorCommissionAmount: 12120, createdAt: at(1) },
  { id: "y1", type: "payment", date: D, branchId: "nasr", patientId: "samir", patientName: "سمير", paid: 40400, method: "Cash", doctorName: "د. أحمد", doctorCommissionAmount: 12120, createdAt: at(2) },
  // Nasr City — Shaimaa: a NEXT approval; 665 is her part, she paid 600. Two treatments, two dentists.
  { id: "p2", type: "procedure", date: D, branchId: "nasr", patientId: "shaimaa", patientName: "شيماء", payerId: "nextcare", payerName: "NEXT", claimId: "c1", cost: 2665, insurerCovered: 2000, description: "علاج عصب (T: 36) | 1x2665=2665", doctorName: "د. أحمد", doctorCommissionAmount: 540, createdAt: at(10) },
  { id: "p3", type: "procedure", date: D, branchId: "nasr", patientId: "shaimaa", patientName: "شيماء", payerId: "nextcare", payerName: "NEXT", claimId: "c1", cost: 0, serviceName: "أشعة", doctorName: "د. سارة", doctorCommissionAmount: 0, createdAt: at(11) },
  { id: "y2", type: "payment", date: D, branchId: "nasr", patientId: "shaimaa", patientName: "شيماء", paid: 600, method: "Card", createdAt: at(12) },
  // The insurer's own cheque is not the patient's money.
  { id: "y3", type: "payment", date: D, branchId: "nasr", patientId: "shaimaa", patientName: "شيماء", paid: 2000, method: "Insurance", createdAt: at(13) },
  // A deleted treatment counts for nothing.
  { id: "p4", type: "procedure", date: D, branchId: "nasr", patientId: "samir", patientName: "سمير", serviceName: "تنظيف", cost: 500, doctorCommissionAmount: 150, status: "deleted", createdAt: at(14) },
  // Maadi — Tamer: a private root canal, paid 1500 of 2500 by InstaPay.
  { id: "p5", type: "procedure", date: D, branchId: "maadi", patientId: "tamer", patientName: "تامر", serviceName: "علاج عصب", doctorName: "د. يوسف", cost: 2500, doctorCommissionAmount: 875, createdAt: at(20) },
  { id: "y4", type: "payment", date: D, branchId: "maadi", patientId: "tamer", patientName: "تامر", paid: 1500, method: "Instapay", createdAt: at(21) },
  // Maadi — Rana: a Metlife patient settling an old balance; no treatment today.
  { id: "y5", type: "payment", date: D, branchId: "maadi", patientId: "rana", patientName: "رنا", paid: 300, method: "Cash", payerId: "metlife", payerName: "Metlife", createdAt: at(30) },
  // A row from before the clinic had branches, and one on another day.
  { id: "y6", type: "payment", date: D, patientId: "old", patientName: "قديم", paid: 100, method: "Cash", createdAt: at(40) },
  { id: "y7", type: "payment", date: "2026-10-11", branchId: "nasr", patientId: "samir", patientName: "سمير", paid: 999, method: "Cash", createdAt: at(50) },
  // An ISO timestamp still belongs to its day.
  { id: "y8", type: "payment", date: `${D}T18:30:00.000Z`, branchId: "maadi", patientId: "tamer", patientName: "تامر", paid: 500, method: "Cash", createdAt: at(22) },
];

// --- 1. Treatment names ---------------------------------------------------------------------------
{
  eq(procedureName({ id: "a", serviceName: "زرعة", description: "x" }), "زرعة", "the matched service wins");
  eq(procedureName({ id: "a", description: "Root canal (T: 36) | 1x900=900" }), "Root canal", "else the description before its tooth and formula");
  eq(procedureName({ id: "a", description: "Scaling | 1x300=300" }), "Scaling", "a description with no tooth");
}

// --- 2. Sections, lines and figures --------------------------------------------------------------
const report = buildDailyFinanceReport({ date: D, rows, branches, payers, isAr: true });
{
  eq(report.sections.map((s) => s.name), ["مدينة نصر", "المعادي", "بدون فرع"], "each branch in the clinic's order, then the rows with no branch");

  const [nasr, maadi, loose] = report.sections;
  eq(nasr.lines.map((l) => l.patient), ["سمير", "شيماء"], "one line per patient, in the order they came");
  const samir = nasr.lines[0];
  eq([samir.source, samir.procedures, samir.dentists, samir.methods, samir.total, samir.paid, samir.remaining], ["ملف", "زرعة", "د. أحمد", "كاش", 40400, 40400, 0], "a private patient's line");
  eq(samir.dentistShare, 12120, "the share is the treatment's, not treatment + payment (no double count), and the deleted one is out");

  const shaimaa = nasr.lines[1];
  eq([shaimaa.source, shaimaa.procedures, shaimaa.dentists, shaimaa.methods], ["NEXT", "علاج عصب + أشعة", "د. أحمد + د. سارة", "فيزا"], "an insurance line names the company, both treatments and both dentists");
  eq([shaimaa.total, shaimaa.paid, shaimaa.remaining, shaimaa.dentistShare], [665, 600, 65, 540], "her part only; the insurer's cheque is not her payment");

  eq(maadi.lines.map((l) => [l.patient, l.total, l.paid, l.remaining]), [["تامر", 2500, 2000, 500], ["رنا", 300, 300, 0]], "Maadi's lines, the evening payment included");
  eq([maadi.lines[1].source, maadi.lines[1].procedures, maadi.lines[1].dentists], ["ميتلايف", "سداد حساب", "—"], "a payment with no treatment today reads as settling a balance");
  eq(loose.lines.map((l) => l.paid), [100], "a row with no branch is kept, not dropped");

  eq(nasr.totals, { patients: 2, total: 41065, paid: 41000, remaining: 65, dentistShare: 12660 }, "Nasr City's totals");
  eq(maadi.totals, { patients: 2, total: 2800, paid: 2300, remaining: 500, dentistShare: 875 }, "Maadi's totals");
  eq(report.totals, { patients: 5, total: 43965, paid: 43400, remaining: 565, dentistShare: 13535 }, "the grand total is every section, and yesterday is not in it");
}

// --- 3. The money matches the Finance page's daily sheet, branch by branch ------------------------
{
  for (const b of branches) {
    const sheet = dailySheet(rows.filter((r) => r.branchId === b.id && String(r.date).slice(0, 10) === D).map((r) => ({ ...r, date: String(r.date).slice(0, 10) })));
    const section = report.sections.find((s) => s.branchId === b.id)!;
    eq([section.totals.total, section.totals.paid, section.totals.remaining], [sheet.totals.total, sheet.totals.paid, sheet.totals.remaining], `${b.name}: same figures as the Finance daily sheet`);
  }
}

// --- 4. A clinic with no branches, and a quiet day -----------------------------------------------
{
  const single = buildDailyFinanceReport({ date: D, rows, branches: [], payers, isAr: false });
  eq(single.sections.length, 1, "no branches: one section");
  eq([single.sections[0].name, single.totals.patients, single.totals.paid], ["", 5, 43400], "with no branch name, and every row in it");
  eq(single.sections[0].lines[0].source, "File", "English labels");

  const quiet = buildDailyFinanceReport({ date: "2026-10-13", rows, branches, payers, isAr: true });
  eq(quiet.sections, [], "a day with nothing has no sections");
  eq(dailyFinanceReportText(quiet, "DENT INN", true).includes("مفيش حركة فلوس"), true, "and the message says so");
}

// --- 5. The WhatsApp text ------------------------------------------------------------------------
{
  const text = dailyFinanceReportText(report, "DENT INN", true);
  eq(text.split("\n")[0], "📊 *DENT INN* — التقرير اليومي 12/10/2026", "the heading");
  eq(text.includes("*مدينة نصر* (2)") && text.includes("*المعادي* (2)") && text.includes("*الإجمالي* (5)"), true, "one block per branch and the total");
  eq(text.includes("المدفوع ٤١٬٠٠٠"), true, "figures in Arabic digits");
  eq(dailyFinanceReportFileName(D, true), "التقرير-اليومي-2026-10-12.xlsx", "Arabic file name");
}

// --- 6. The Excel file ---------------------------------------------------------------------------
{
  const bytes = dailyFinanceReportBytes(report, "DENT INN", true);
  eq(bytes[0] === 0x50 && bytes[1] === 0x4b, true, "a real xlsx (zip) file");
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  eq(wb.Workbook?.Views?.[0]?.RTL ?? false, false, "the RTL switch is OFF: right-to-left is done by layout so every viewer shows it");

  // Column 1 of the report ("م") is the RIGHTMOST column (K); the dentist share the leftmost (A).
  const head = ["K", "J", "I", "H", "G", "F", "E", "D", "C", "B", "A"].map((c) => ws[`${c}11`]?.v);
  eq(head, ["م", "التاريخ", "المصدر", "اسم المريض", "الإجراء", "الطبيب", "طريقة الدفع", "المطلوب", "المدفوع", "المتبقي", "نصيب الطبيب"], "details headers read right to left");
  eq([ws.K4.v, ws.J4.v, ws.I4.v], ["الفرع", "عدد", "المطلوب"], "summary headers start at the right edge too");
  eq(ws.A12.v, "فرع مدينة نصر", "the branch bar's text sits in the merge's anchor, so it is visible");
  eq(
    [ws.K13.v, ws.J13.v, ws.I13.v, ws.H13.v, ws.G13.v, ws.D13.v, ws.C13.v, ws.B13.f, ws.B13.v, ws.A13.v],
    [1, 46307, "ملف", "سمير", "زرعة", 40400, 40400, "D13-C13", 0, 12120],
    "a patient line: number, real date (12 Oct 2026), file, name, treatment, figures; remaining is a formula",
  );
  eq([ws.D15.f, ws.D15.v, ws.A15.f, ws.A15.v], ["SUM(D13:D14)", 41065, "SUM(A13:A14)", 12660], "the branch total row: formulas with the figure cached");
  eq([ws.I5.f, ws.I5.v, ws.F5.v, ws.J5.f, ws.J5.v], ["D15", 41065, 12660, "COUNTA(H13:H14)", 2], "the summary line points at the branch total");
  eq([ws.I12 === undefined || ws.I12.v === "", ws.F12 === undefined || ws.F12.v === ""], [true, true], "the bar's other cells are blank");
  const grandRow = Object.keys(ws).find((k) => ws[k]?.v === "الإجمالي الكلي");
  eq(Boolean(grandRow), true, "there is a grand total row");
  const gr = Number(grandRow!.replace(/\D/g, ""));
  eq([ws[`D${gr}`].v, ws[`C${gr}`].v, ws[`B${gr}`].v, ws[`A${gr}`].v], [43965, 43400, 565, 13535], "the grand total");
  eq((ws["!merges"] || []).length > 0, true, "the bars and labels are merged across");
  const looseBar = Object.keys(ws).find((k) => ws[k]?.v === "بدون فرع" && k.startsWith("A"));
  eq(Boolean(looseBar), true, "the no-branch bar reads 'بدون فرع', not 'فرع بدون فرع'");

  const en = dailyFinanceReportWorkbook(buildDailyFinanceReport({ date: D, rows: [], branches, payers, isAr: false }), "DENT INN", false);
  const wsEn = en.Sheets[en.SheetNames[0]];
  eq(wsEn.A3.v, "No money moved on this day.", "an empty day says so");
}

// --- 7. Wiring: the nightly tick sends it, as an Excel file, to money readers only ---------------
{
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const sender = read("src/lib/reports/sendStaffReport.ts");
  eq(/if \(kind === "dailySheet"\) return sendDailyFinanceSheet\(/.test(sender), true, "the report sender routes the sheet before the briefing path");
  eq(/spreadsheetml\.sheet/.test(sender) && /mimetype: XLSX_MIME/.test(sender), true, "the file goes out typed as Excel, not as a PDF");
  eq((sender.match(/reportAccessForRole\(role\)\.money \?/g) || []).length, 2, "both the text and the file are for people who may see money");
  const wa = read("src/lib/whatsapp.ts");
  eq(/form\.set\("mimetype", mime\)/.test(wa) && !/form\.set\("mimetype", "application\/pdf"\)/.test(wa), true, "the gateway is told the file's real type");
  eq(/mimetype: args\.mimetype/.test(read("src/lib/staffWhatsapp.ts")), true, "the staff sender passes the type through");
}

console.log(`daily finance report: ${checks} checks passed`);
