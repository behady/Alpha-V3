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
  accountBalances,
  buildDailyFinanceReport,
  dailyFinanceReportFileName,
  dailyFinanceReportText,
  isEmptyReport,
  latePayments,
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

  eq([shaimaa.work, shaimaa.company], [2665, 2000], "an approval line: the full work, and the insurer's approved part");
  eq(nasr.totals, { patients: 2, work: 43065, company: 2000, total: 41065, paid: 41000, remaining: 65, dentistShare: 12660, owed: 0 }, "Nasr City's totals");
  eq(maadi.totals, { patients: 2, work: 2500, company: 0, total: 2800, paid: 2300, remaining: 500, dentistShare: 875, owed: 0 }, "Maadi's totals");
  eq(report.totals, { patients: 5, work: 45565, company: 2000, total: 43965, paid: 43400, remaining: 565, dentistShare: 13535, owed: 0 }, "the grand total is every section, and yesterday is not in it");
}

// --- 2b. A contract company (GASCO): the company owes it, not the patient --------------------------
{
  // The case that was wrong on DENT INN's first real report (12 Oct 2026): 4,356 left on the patient.
  const gasco = (id: string, cost: number, com: number) =>
    ({ id, type: "procedure", date: D, patientId: "ash", patientName: "اشرف", payerId: "gasco", payerName: "Gasco", serviceName: id, doctorName: "د. أحمد", cost, doctorCommissionAmount: com, createdAt: at(1) }) as ReportLedgerRow;
  const day = [gasco("كشف", 132, 52.8), gasco("حشو", 2640, 1056), gasco("بطانة", 1584, 633.6)];
  const g = buildDailyFinanceReport({ date: D, rows: day, branches: [], payers, isAr: true }).sections[0].lines[0];
  eq([g.source, g.work, g.company, g.total, g.paid, g.remaining, g.dentistShare], ["Gasco", 4356, 4356, 0, 0, 0, 1742.4], "the whole price is on GASCO; the patient owes and has left nothing");

  const copay = [...day, { id: "y", type: "payment", date: D, patientId: "ash", patientName: "اشرف", procedureId: "حشو", paid: 356, method: "Cash", createdAt: at(2) } as ReportLedgerRow];
  const c = buildDailyFinanceReport({ date: D, rows: copay, branches: [], payers, isAr: true }).sections[0].lines[0];
  eq([c.work, c.company, c.total, c.paid, c.remaining], [4356, 4000, 356, 356, 0], "cash the patient paid on a GASCO treatment comes off GASCO's part");
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
  eq(text.includes("قيمة الشغل ٤٣٬٠٦٥ · على الشركات ٢٬٠٠٠"), true, "each block opens with the work and the companies' part");
  eq(dailyFinanceReportFileName(D, true), "التقرير-اليومي-2026-10-12.xlsx", "Arabic file name");
}

// --- 6. The Excel file ---------------------------------------------------------------------------
{
  const bytes = dailyFinanceReportBytes(report, "DENT INN", true);
  eq(bytes[0] === 0x50 && bytes[1] === 0x4b, true, "a real xlsx (zip) file");
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  eq(wb.Workbook?.Views?.[0]?.RTL ?? false, false, "the RTL switch is OFF: right-to-left is done by layout so every viewer shows it");

  // Column 1 of the report ("م") is the RIGHTMOST sheet column (M); the dentist share the leftmost (A).
  const L = (c: number) => String.fromCharCode("A".charCodeAt(0) + 14 - c);
  const at = (c: number, r: number) => ws[`${L(c)}${r}`];
  const head = Array.from({ length: 14 }, (_, i) => at(i + 1, 11)?.v);
  eq(head, ["م", "التاريخ", "المصدر", "اسم المريض", "الإجراء", "الطبيب", "طريقة الدفع", "قيمة الشغل", "على الشركة", "المطلوب", "المدفوع", "المتبقي", "نصيب الطبيب", "رصيد الحساب"], "details headers read right to left");
  eq([at(1, 4).v, at(2, 4).v, at(3, 4).v, at(4, 4).v, at(8, 4).v], ["الفرع", "عدد", "قيمة الشغل", "على الشركة", "نصيب الأطباء"], "summary headers start at the right edge too");
  eq(ws.A12.v, "فرع مدينة نصر", "the branch bar's text sits in the merge's anchor, so it is visible");
  eq(at(14, 13).v, "—", "no balances were looked up: the column says so instead of showing 0");
  eq(
    [1, 2, 3, 4, 5, 8, 9, 10, 11, 13].map((c) => at(c, 13).v).concat([at(12, 13).f, at(12, 13).v]),
    [1, 46307, "ملف", "سمير", "زرعة", 40400, 0, 40400, 40400, 12120, "MAX(0,E13-D13)", 0],
    "a patient line: number, real date (12 Oct 2026), file, name, treatment, figures; remaining is a formula",
  );
  eq([at(8, 14).v, at(9, 14).v, at(10, 14).v], [2665, 2000, 665], "the approval line: work, insurer, patient");
  eq([at(8, 15).f, at(8, 15).v, at(9, 15).v, at(10, 15).v, at(13, 15).f, at(13, 15).v], ["SUM(G13:G14)", 43065, 2000, 41065, "SUM(B13:B14)", 12660], "the branch total row: formulas with the figure cached");
  eq([at(3, 5).f, at(3, 5).v, at(4, 5).v, at(5, 5).v, at(8, 5).v, at(2, 5).f, at(2, 5).v], ["G15", 43065, 2000, 41065, 12660, "COUNTA(K13:K14)", 2], "the summary line points at the branch total");
  eq([at(5, 12) === undefined || at(5, 12).v === "", at(8, 12) === undefined || at(8, 12).v === ""], [true, true], "the bar's other cells are blank");
  const grandRow = Object.keys(ws).find((k) => ws[k]?.v === "الإجمالي الكلي");
  eq(Boolean(grandRow), true, "there is a grand total row");
  const gr = Number(grandRow!.replace(/\D/g, ""));
  eq([8, 9, 10, 11, 12, 13].map((c) => at(c, gr).v), [45565, 2000, 43965, 43400, 565, 13535], "the grand total");
  eq((ws["!merges"] || []).length > 0, true, "the bars and labels are merged across");
  const looseBar = Object.keys(ws).find((k) => ws[k]?.v === "بدون فرع" && /^A\d/.test(k));
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
  // Owner, 2026-10-12: a report must not wait for clinic hours on Alpha's gateway.
  const staff = read("src/lib/staffWhatsapp.ts");
  eq((staff.match(/priority: "staff"/g) || []).length, 2, "the staff sender marks both the text and the file as staff");
  eq(/\.\.\.\(opts\.priority \? \{ priority: opts\.priority \} : \{\}\)/.test(wa) && /form\.set\("priority", priority\)/.test(wa), true, "the marker reaches the gateway on text and on files");
}

// --- 8. The account balance: DENT INN, 24 Oct 2026 -------------------------------------------------
{
  // A 1,500 deposit on the 21st as a general payment, an implant of 20,000 on the 24th, 8,500 paid
  // on the 24th, and 10,000 entered on the 24th but dated the 21st and linked to the implant. The
  // patient's file said nothing was owed; the sheet said 11,500 was. Both are now on the sheet.
  const D21 = "2026-10-21";
  const D24 = "2026-10-24";
  const P = { patientId: "imp", patientName: "مريض الزرعة", branchId: "nasr" };
  const ledger: ReportLedgerRow[] = [
    { id: "dep", type: "payment", date: D21, ...P, paid: 1500, amount: 1500, method: "Cash", procedureId: null, createdAt: at(100), addedBy: "Malak" },
    { id: "imp", type: "procedure", date: D24, ...P, serviceName: "زرعة", doctorName: "د. أحمد", cost: 20000, amount: 20000, doctorCommissionAmount: 8000, createdAt: at(200) },
    { id: "pay", type: "payment", date: D24, ...P, paid: 8500, amount: 8500, method: "Cash", procedureId: "imp", createdAt: at(300), addedBy: "Malak" },
    { id: "ten", type: "payment", date: D21, ...P, paid: 10000, amount: 10000, method: "Cash", procedureId: "imp", createdAt: at(310), addedBy: "Malak" },
    // Someone else's row and a later day are not this patient's balance at the end of the 24th.
    { id: "oth", type: "procedure", date: D24, patientId: "x", patientName: "x", cost: 999, createdAt: at(1) },
    { id: "fut", type: "payment", date: "2026-10-30", ...P, paid: 700, method: "Cash", createdAt: at(400) },
  ];
  eq(accountBalances(ledger, D24).get("imp"), 0, "the file's figure: 20,000 − 1,500 − 8,500 − 10,000");
  eq(accountBalances(ledger, D21).get("imp"), -11500, "at the end of the 21st the clinic held 11,500 for them");
  eq(accountBalances(ledger, "2026-10-30").get("imp"), -700, "a later payment counts from its own day");

  const day = ledger.filter((r) => r.date === D24);
  const plain = buildDailyFinanceReport({ date: D24, rows: day, branches, payers, isAr: true });
  eq([plain.hasBalances, plain.sections[0].lines[0].balance], [false, null], "without the patients' ledgers there is no balance, not a zero");
  eq(dailyFinanceReportText(plain, "DENT INN", true).includes("المستحق فعلاً"), false, "and the message does not claim one");

  const full = buildDailyFinanceReport({ date: D24, rows: day, branches, payers, isAr: true, accountRows: ledger });
  const line = full.sections[0].lines.find((l) => l.patient === "مريض الزرعة")!;
  eq([line.total, line.paid, line.remaining, line.balance], [20000, 8500, 11500, 0], "the day's figures stay as they were; the account says nothing is owed");
  eq(full.totals.owed, 999, "only what is really owed is totalled: the other patient's 999, not the implant's 11,500");
  const ar = dailyFinanceReportText(full, "DENT INN", true);
  eq(ar.includes("المستحق فعلاً على حساباتهم (بعد المدفوع مقدماً) ٩٩٩"), true, "the message carries the real figure");
  eq(dailyFinanceReportText(full, "DENT INN", false).includes("Still owed on their accounts (after earlier payments) 999"), true, "in English too");

  // A credit does not pay another patient's debt, and a debt carried in from before is still owed.
  const mixed: ReportLedgerRow[] = [
    { id: "a1", type: "payment", date: D21, patientId: "a", patientName: "A", paid: 3000, method: "Cash", createdAt: at(1) },
    { id: "a2", type: "procedure", date: D24, patientId: "a", patientName: "A", cost: 1000, createdAt: at(2) },
    { id: "b1", type: "procedure", date: D21, patientId: "b", patientName: "B", cost: 400, createdAt: at(3) },
    { id: "b2", type: "procedure", date: D24, patientId: "b", patientName: "B", cost: 600, createdAt: at(4) },
    { id: "b3", type: "payment", date: D24, patientId: "b", patientName: "B", paid: 100, method: "Cash", createdAt: at(5) },
  ];
  const m = buildDailyFinanceReport({ date: D24, rows: mixed.filter((r) => r.date === D24), branches: [], payers, isAr: false, accountRows: mixed });
  eq(m.sections[0].lines.map((l) => [l.patient, l.remaining, l.balance]), [["A", 1000, -2000], ["B", 500, 900]], "A is in credit, B owes the old 400 too");
  eq(m.totals.owed, 900, "owed is B's 900; A's credit does not cancel it");

  // An approval treatment: the insurer's unpaid part is the insurer's, as in the patient's file.
  const approval: ReportLedgerRow[] = [
    { id: "q1", type: "procedure", date: D24, patientId: "q", patientName: "Q", payerId: "nextcare", claimId: "c9", cost: 2665, insurerCovered: 2000, createdAt: at(1) },
    { id: "q2", type: "payment", date: D24, patientId: "q", patientName: "Q", paid: 600, method: "Card", createdAt: at(2) },
  ];
  eq(accountBalances(approval, D24).get("q"), 65, "665 is the patient's part, 600 of it paid");

  // --- the Excel file shows it ---
  const wb = XLSX.read(dailyFinanceReportBytes(full, "DENT INN", true), { type: "array", cellFormula: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const L = (c: number) => String.fromCharCode("A".charCodeAt(0) + 14 - c);
  const rowOf = (v: string) => Number(Object.keys(ws).find((k) => ws[k]?.v === v)!.replace(/\D/g, ""));
  const r = rowOf("مريض الزرعة");
  eq([ws[`${L(10)}${r}`].v, ws[`${L(11)}${r}`].v, ws[`${L(12)}${r}`].v, ws[`${L(14)}${r}`].v], [20000, 8500, 11500, 0], "the line: owed today, paid today, remaining today, account balance");
  const credit = XLSX.read(dailyFinanceReportBytes(m, "DENT INN", true), { type: "array", cellFormula: true, cellStyles: true });
  const wsc = credit.Sheets[credit.SheetNames[0]];
  const ra = Number(Object.keys(wsc).find((k) => wsc[k]?.v === "A" && /^K\d/.test(k))!.replace(/\D/g, ""));
  eq([wsc[`A${ra}`].v, wsc[`A${ra}`].z], [-2000, 'General;"له "General;0'], "a credit is stored as a negative figure that reads 'له' (held for the patient)");
  const totalRow = Object.keys(wsc).find((k) => /^A\d/.test(k) && String(wsc[k]?.f || "").startsWith("SUMIF("));
  eq([wsc[totalRow!].f, wsc[totalRow!].v], [`SUMIF(A${ra}:A${ra + 1},">0")`, 900], "the total counts only what is owed");
  eq(wsc.F4.v, "المستحق على الحسابات", "the summary has the owed column too");
}

// --- 9. Payments recorded on the day for another day -----------------------------------------------
{
  const D24 = "2026-10-24";
  const P = { patientName: "مريض الزرعة", patientId: "imp", branchId: "nasr" };
  // As the rows stand after the edits.
  const ten = { id: "ten", type: "payment", date: "2026-10-21", ...P, paid: 10000, method: "Cash", addedBy: "Malak", createdAt: at(310) } as ReportLedgerRow;
  const pay = { id: "pay", type: "payment", date: D24, ...P, paid: 8500, method: "Cash", addedBy: "Malak", createdAt: at(300) } as ReportLedgerRow;
  const imp = { id: "imp", type: "procedure", date: D24, ...P, cost: 20000, createdAt: at(200) } as ReportLedgerRow;
  const ins = { id: "ins", type: "payment", date: "2026-10-20", ...P, paid: 2000, method: "Insurance", createdAt: at(320) } as ReportLedgerRow;
  const old = { id: "old", type: "payment", date: "2026-10-05", patientName: "قديم", patientId: "o", paid: 700, method: "Instapay", addedBy: "Sara", createdAt: at(5) } as ReportLedgerRow;
  const back = { id: "back", type: "payment", date: "2026-10-10", patientName: "رجعت", patientId: "r", paid: 50, method: "Cash", createdAt: at(6) } as ReportLedgerRow;

  // The 10,000 was entered on the 24th dated the 24th, then moved to the 21st.
  const asEntered = latePayments({ date: D24, created: [ten, pay, imp, ins], moved: [], moves: [], branches });
  eq(asEntered.map((l) => [l.id, l.date, l.movedFrom, l.amount, l.branch, l.by]), [["ten", "2026-10-21", null, 10000, "مدينة نصر", "Malak"]],
    "created on the day for another day: listed; today's own payment, the treatment and the insurer's cheque are not");

  const moves = [
    { id: "ten", from: D24, to: "2026-10-21", by: "Malak" },
    { id: "old", from: "2026-10-01", to: "2026-10-03", by: "Sara" },
    { id: "old", from: "2026-10-03", to: "2026-10-05", by: "Ahmed" },
    { id: "back", from: "2026-10-10", to: "2026-10-12", by: "Sara" },
    { id: "back", from: "2026-10-12", to: "2026-10-10", by: "Sara" },
  ];
  const late = latePayments({ date: D24, created: [ten, pay, imp], moved: [ten, old, back], moves, branches });
  eq(late.map((l) => [l.id, l.date, l.movedFrom, l.by]), [["old", "2026-10-05", "2026-10-01", "Ahmed"], ["ten", "2026-10-21", D24, "Malak"]],
    "a date edit is listed from where the payment stood that morning, by whoever moved it last; moved and moved back is not listed; oldest day first");

  const moveIn = { ...back, id: "in", date: D24 } as ReportLedgerRow;
  eq(latePayments({ date: D24, created: [], moved: [moveIn], moves: [{ id: "in", from: "2026-10-20", to: D24, by: "Sara" }], branches }).map((l) => l.movedFrom), ["2026-10-20"],
    "moved INTO the day is listed too: the 20th lost that money after its report went out");

  const report = buildDailyFinanceReport({ date: D24, rows: [imp, pay], branches, payers, isAr: true, createdRows: [ten, pay, imp], movedRows: [ten, old, back], moves });
  eq([report.late.length, report.lateTotal], [2, 10700], "the report carries them, with their total");
  const ar = dailyFinanceReportText(report, "DENT INN", true);
  eq(ar.includes("⚠️ *دفعات اتسجلت النهارده على أيام تانية* (2) · ١٠٬٧٠٠"), true, "the message flags them");
  eq(ar.includes("• مريض الزرعة ١٠٬٠٠٠ · اتنقلت من 24/10/2026 لـ 21/10/2026 — Malak"), true, "each one: who, how much, where it went, who did it");
  eq(dailyFinanceReportText(report, "DENT INN", false).includes("• قديم 700 · moved from 01/10/2026 to 05/10/2026 — Ahmed"), true, "in English too");

  const many = Array.from({ length: 7 }, (_, i) => ({ ...old, id: `m${i}`, date: "2026-10-01" }) as ReportLedgerRow);
  const manyText = dailyFinanceReportText(buildDailyFinanceReport({ date: D24, rows: [], branches, payers, isAr: true, createdRows: many }), "DENT INN", true);
  eq([(manyText.match(/^• /gm) || []).length, manyText.includes("• و2 كمان في الملف")], [6, true], "five by name, then a count");

  // A day with nothing but a late entry is still sent, and says what happened.
  const onlyLate = buildDailyFinanceReport({ date: D24, rows: [], branches, payers, isAr: true, createdRows: [ten] });
  eq([onlyLate.sections.length, isEmptyReport(onlyLate)], [0, false], "not an empty day");
  eq(isEmptyReport(buildDailyFinanceReport({ date: D24, rows: [], branches, payers, isAr: true })), true, "and a day with nothing at all still is");
  const onlyText = dailyFinanceReportText(onlyLate, "DENT INN", true);
  eq(onlyText.includes("مفيش حركة فلوس النهارده.") && onlyText.includes("اتسجلت النهارده على أيام تانية"), true, "the quiet-day message still flags the late payment");

  // --- the Excel file lists them under their own bar ---
  const wb = XLSX.read(dailyFinanceReportBytes(report, "DENT INN", true), { type: "array", cellFormula: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const L = (c: number) => String.fromCharCode("A".charCodeAt(0) + 14 - c);
  const bar = Object.keys(ws).find((k) => ws[k]?.v === "دفعات اتسجلت في اليوم ده على أيام تانية");
  eq(Boolean(bar), true, "the late block has its bar");
  const r = Number(bar!.replace(/\D/g, "")) + 2;
  eq([1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws[`${L(c)}${r}`]?.v), [1, 46300, "—", "قديم", "اتنقلت من 01/10/2026", "Ahmed", "انستاباي", 700], "a late line: number, the day it is on, branch, patient, what happened, who, method, amount");
  eq(ws[`${L(5)}${r + 1}`].v, "اتنقلت من 24/10/2026", "the 10,000's line says where it came from");
  eq([ws[`${L(8)}${r + 2}`].f, ws[`${L(8)}${r + 2}`].v], [`SUM(${L(8)}${r}:${L(8)}${r + 1})`, 10700], "and the block has its total");
  const empty = XLSX.read(dailyFinanceReportBytes(onlyLate, "DENT INN", true), { type: "array" });
  const wse = empty.Sheets[empty.SheetNames[0]];
  eq(Object.keys(wse).some((k) => wse[k]?.v === "دفعات اتسجلت في اليوم ده على أيام تانية"), true, "a file with no patient lines still lists them");
}

// --- 10. Wiring: the sender looks up balances and late payments, and never fails for want of them -
{
  const sender = readFileSync(new URL("../src/lib/reports/sendStaffReport.ts", import.meta.url), "utf8");
  eq(/where\("patientId", "in", chunk\)/.test(sender) && /i \+= 30/.test(sender), true, "the day's patients' ledgers, 30 ids per query");
  eq(/where\("createdAt", ">=", start\)\.where\("createdAt", "<", end\)/.test(sender), true, "payments created on the clinic's day");
  eq(/LEDGER_AUDIT_COLLECTION\)\.where\("at", ">=", start\)\.where\("at", "<", end\)/.test(sender), true, "date edits from the audit trail");
  eq((sender.match(/console\.warn\("Daily sheet: [^"]+ unavailable:"/g) || []).length, 2, "both lookups fall back instead of failing the report");
  eq(/if \(isEmptyReport\(report\) && !args\.test\)/.test(sender), true, "a day with only a late payment is still sent");
}

console.log(`daily finance report: ${checks} checks passed`);
