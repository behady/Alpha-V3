/**
 * The nightly money sheet as an Excel file, in the clinic's own look: rose bands, bold centred
 * figures, a summary at the top (one line per branch), then each branch under its own bar with its
 * own total, then the grand total.
 *
 * Right to left by LAYOUT, not by the sheet's RTL switch. The switch is honoured by desktop Excel
 * only; the WhatsApp preview, Google Sheets and most phone viewers ignore it and showed the owner a
 * left-to-right sheet. So column 1 of the report ("م") is written into the rightmost sheet column and
 * the switch is left off — the file reads the same way in every viewer.
 *
 * Totals are real SUM formulas with the figure cached beside them, so a viewer that does not
 * calculate still shows the number.
 */

import XLSX from "xlsx-js-style";
import { lateNote, type DailyFinanceReport } from "@/lib/reports/dailyFinanceReport";
import { paymentMethodLabel } from "@/lib/dailySheet";

type Style = NonNullable<XLSX.CellObject["s"]>;

const W = 14;
/** Logical column (1 = rightmost, "م") → 0-based sheet column. */
const C = (c: number) => W - c;
const WIDTHS = [14, 13, 13, 24, 30, 18, 13, 12, 12, 12, 12, 11, 13, 14];

const WHITE = { style: "thin", color: { rgb: "FFFFFF" } } as const;
const GRID = { top: WHITE, bottom: WHITE, left: WHITE, right: WHITE };
const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } }) as const;
const CENTER = { horizontal: "center", vertical: "center", wrapText: true } as const;
const RIGHT = { horizontal: "right", vertical: "center", readingOrder: 2 } as const;
const BANDS = ["F2DCDB", "E6B8B7"];
const NUM = "General";
/** An account balance: a negative one is money the clinic holds for the patient, and says so. */
const BALANCE_NUM = { ar: 'General;"له "General;0', en: 'General;"credit "General;0' };
const DATE = "dd/mm/yyyy";

const cellStyle = (bg: string, color = "000000", sz = 12): Style => ({
  font: { name: "Arial", sz, bold: true, color: { rgb: color } },
  fill: fill(bg),
  border: GRID,
  alignment: CENTER,
});
const BAND = (i: number) => cellStyle(BANDS[i % 2]);
const HEAD = cellStyle("963634", "FFFFFF");
const TOTAL = cellStyle("C0504D", "FFFFFF");
const BANNER = cellStyle("632523", "FFFFFF", 13);

const LABELS = {
  ar: {
    title: "التقرير اليومي",
    summary: "الملخص",
    details: "التفاصيل",
    summaryHead: ["الفرع", "عدد", "قيمة الشغل", "على الشركة", "المطلوب", "المدفوع", "المتبقي", "نصيب الأطباء", "المستحق على الحسابات"],
    head: ["م", "التاريخ", "المصدر", "اسم المريض", "الإجراء", "الطبيب", "طريقة الدفع", "قيمة الشغل", "على الشركة", "المطلوب", "المدفوع", "المتبقي", "نصيب الطبيب", "رصيد الحساب"],
    late: "دفعات اتسجلت في اليوم ده على أيام تانية",
    lateHead: ["م", "التاريخ", "الفرع", "اسم المريض", "اللي حصل", "سجلها", "طريقة الدفع", "المبلغ"],
    clinic: "العيادة",
    branch: (name: string) => `فرع ${name}`,
    branchTotal: (name: string) => `إجمالي فرع ${name}`,
    total: "الإجمالي",
    grand: "الإجمالي الكلي",
    empty: "مفيش حركة فلوس في اليوم ده.",
    note: "قيمة الشغل = سعر كل العلاج اللي اتعمل.   على الشركة = اللي شركة التأمين أو الشركة المتعاقدة هتدفعه.   المطلوب = نصيب المريض.   المتبقي = المطلوب − المدفوع في اليوم ده.   رصيد الحساب = كل اللي على المريض لحد آخر اليوم − كل اللي دفعه، يعني بيحسب المدفوع مقدماً (له = فلوس مقدمة للمريض).   ملف = مريض العيادة.   نصيب الطبيب = النسبة المسجلة على كل علاج.",
    sheet: "التقرير اليومي",
  },
  en: {
    title: "Daily report",
    summary: "Summary",
    details: "Details",
    summaryHead: ["Branch", "Patients", "Work done", "Company owes", "Patient owes", "Paid", "Remaining", "Dentists' share", "Owed on accounts"],
    head: ["#", "Date", "Source", "Patient", "Procedure", "Dentist", "Method", "Work done", "Company owes", "Patient owes", "Paid", "Remaining", "Dentist share", "Account balance"],
    late: "Payments recorded on this day for other days",
    lateHead: ["#", "Date", "Branch", "Patient", "What happened", "By", "Method", "Amount"],
    clinic: "Clinic",
    branch: (name: string) => name,
    branchTotal: (name: string) => `${name} total`,
    total: "Total",
    grand: "Grand total",
    empty: "No money moved on this day.",
    note: "Work done = the full price of every treatment.   Company owes = what the insurance or contract company pays.   Patient owes = the patient's part.   Remaining = Patient owes − Paid on this day.   Account balance = everything the patient owes up to the end of the day − everything they have paid, earlier payments included (credit = money held for the patient).   File = the clinic's own patient.   Dentist share = the rate recorded on each treatment.",
    sheet: "Daily report",
  },
};

function dateSerial(ymd: string): number | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function dailyFinanceReportWorkbook(report: DailyFinanceReport, clinicName: string, isAr: boolean): XLSX.WorkBook {
  const L = isAr ? LABELS.ar : LABELS.en;
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];
  const heights: XLSX.RowInfo[] = [];
  let row = 0;

  const put = (r: number, c: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r, c: C(c) })] = cell;
  };
  const str = (r: number, c: number, v: string, s: Style) => put(r, c, { t: "s", v, s });
  const numCell = (r: number, c: number, v: number, s: Style) => put(r, c, { t: "n", v, s: { ...s, numFmt: NUM } });
  const balanceFmt = isAr ? BALANCE_NUM.ar : BALANCE_NUM.en;
  const formula = (r: number, c: number, f: string, v: number, s: Style) => put(r, c, { t: "n", f, v, s: { ...s, numFmt: NUM } });
  const ref = (r: number, c: number) => XLSX.utils.encode_cell({ r, c: C(c) });
  /** Merge logical columns a..b (a < b) on one row; the text lives in the merge's left anchor. */
  const mergeRow = (r: number, a: number, b: number, v: string, s: Style) => {
    for (let c = a; c <= b; c++) str(r, c, c === b ? v : "", { ...s, alignment: RIGHT });
    merges.push({ s: { r, c: C(b) }, e: { r, c: C(a) } });
  };
  const height = (r: number, hpt: number) => (heights[r] = { hpt });

  const [y, m, d] = report.date.split("-");
  mergeRow(row, 1, W, `${clinicName} — ${L.title} ${d}/${m}/${y}`, { font: { name: "Arial", sz: 16, bold: true } });
  height(row, 26);
  row += 2;

  if (report.sections.length === 0) {
    mergeRow(row, 1, W, L.empty, { font: { name: "Arial", sz: 12, italic: true, color: { rgb: "666666" } } });
    row += 2;
    lateBlock();
    return finish();
  }

  // --- summary: filled after the details are laid out, since its cells point at their totals ---
  mergeRow(row, 1, W, L.summary, { font: { name: "Arial", sz: 13, bold: true } });
  row += 1;
  L.summaryHead.forEach((h, i) => str(row, i + 1, h, HEAD));
  height(row, 30);
  const summaryFirst = row + 1;
  const summaryTotal = summaryFirst + report.sections.length;
  row = summaryTotal + 3;

  // --- details ---
  mergeRow(row - 1, 1, W, L.details, { font: { name: "Arial", sz: 13, bold: true } });
  L.head.forEach((h, i) => str(row, i + 1, h, HEAD));
  height(row, 30);
  row += 1;

  const subtotalRows: { r: number; first: number; last: number }[] = [];
  for (const section of report.sections) {
    const name = section.name || L.clinic;
    // A real branch reads "فرع X"; the catch-all for rows with no branch is already worded.
    const bar = section.branchId ? L.branch(name) : name;
    if (section.name) {
      mergeRow(row, 1, W, bar, BANNER);
      height(row, 24);
      row += 1;
    }
    const first = row;
    section.lines.forEach((line, i) => {
      const s = BAND(i);
      numCell(row, 1, i + 1, s);
      const serial = dateSerial(line.date);
      if (serial === null) str(row, 2, line.date, s);
      else put(row, 2, { t: "n", v: serial, z: DATE, s: { ...s, numFmt: DATE } });
      str(row, 3, line.source, s);
      str(row, 4, line.patient, s);
      str(row, 5, line.procedures, s);
      str(row, 6, line.dentists, s);
      str(row, 7, line.methods, s);
      numCell(row, 8, line.work, s);
      numCell(row, 9, line.company, s);
      numCell(row, 10, line.total, s);
      numCell(row, 11, line.paid, s);
      formula(row, 12, `MAX(0,${ref(row, 10)}-${ref(row, 11)})`, line.remaining, s);
      numCell(row, 13, line.dentistShare, s);
      if (line.balance === null) str(row, 14, "—", s);
      else put(row, 14, { t: "n", v: line.balance, z: balanceFmt, s: { ...s, numFmt: balanceFmt } });
      // Wrapped text needs a taller row: Excel does not grow a row whose height the file sets.
      const lines = Math.max(...([[3, line.source], [4, line.patient], [5, line.procedures], [6, line.dentists], [7, line.methods]] as [number, string][])
        .map(([c, t]) => Math.ceil(t.length / Math.max(1, WIDTHS[c - 1] - 2))));
      height(row, Math.max(22, 17 * lines + 6));
      row += 1;
    });
    const last = row - 1;
    mergeRow(row, 1, 7, section.branchId ? L.branchTotal(name) : `${L.total} — ${name}`, TOTAL);
    const t = section.totals;
    const sums: [number, number][] = [[8, t.work], [9, t.company], [10, t.total], [11, t.paid], [12, t.remaining], [13, t.dentistShare]];
    for (const [c, v] of sums) formula(row, c, `SUM(${ref(first, c)}:${ref(last, c)})`, v, TOTAL);
    // What is owed, not the net: one patient's credit does not pay another's debt.
    formula(row, 14, `SUMIF(${ref(first, 14)}:${ref(last, 14)},">0")`, t.owed, TOTAL);
    height(row, 24);
    subtotalRows.push({ r: row, first, last });
    row += 2;
  }

  if (report.sections.length > 1) {
    mergeRow(row, 1, 7, L.grand, BANNER);
    const t = report.totals;
    const grand: [number, number][] = [[8, t.work], [9, t.company], [10, t.total], [11, t.paid], [12, t.remaining], [13, t.dentistShare]];
    for (const [c, v] of grand) formula(row, c, subtotalRows.map((s) => ref(s.r, c)).join("+"), v, BANNER);
    formula(row, 14, subtotalRows.map((s) => ref(s.r, 14)).join("+"), t.owed, BANNER);
    height(row, 24);
    row += 2;
  }
  lateBlock();
  mergeRow(row, 1, W, L.note, { font: { name: "Arial", sz: 9, italic: true } });

  // --- the summary lines point at each branch's total row ---
  report.sections.forEach((section, i) => {
    const r = summaryFirst + i;
    const sub = subtotalRows[i];
    const s = BAND(i);
    str(r, 1, section.name || L.clinic, s);
    formula(r, 2, `COUNTA(${ref(sub.first, 4)}:${ref(sub.last, 4)})`, section.totals.patients, s);
    const st = section.totals;
    const cols: [number, number, number][] = [[3, 8, st.work], [4, 9, st.company], [5, 10, st.total], [6, 11, st.paid], [7, 12, st.remaining], [8, 13, st.dentistShare], [9, 14, st.owed]];
    for (const [c, from, v] of cols) formula(r, c, ref(sub.r, from), v, s);
    height(r, 22);
  });
  str(summaryTotal, 1, L.total, TOTAL);
  const t = report.totals;
  const totalCols: [number, number][] = [[2, t.patients], [3, t.work], [4, t.company], [5, t.total], [6, t.paid], [7, t.remaining], [8, t.dentistShare], [9, t.owed]];
  for (const [c, v] of totalCols) formula(summaryTotal, c, `SUM(${ref(summaryFirst, c)}:${ref(summaryTotal - 1, c)})`, v, TOTAL);
  height(summaryTotal, 24);

  return finish();

  /** The payments recorded on the day for another day, under their own bar, with their total. */
  function lateBlock() {
    if (report.late.length === 0) return;
    mergeRow(row, 1, W, L.late, BANNER);
    height(row, 24);
    row += 1;
    L.lateHead.forEach((h, i) => str(row, i + 1, h, HEAD));
    height(row, 30);
    row += 1;
    const first = row;
    report.late.forEach((l, i) => {
      const s = BAND(i);
      numCell(row, 1, i + 1, s);
      const serial = dateSerial(l.date);
      if (serial === null) str(row, 2, l.date, s);
      else put(row, 2, { t: "n", v: serial, z: DATE, s: { ...s, numFmt: DATE } });
      str(row, 3, l.branch || "—", s);
      str(row, 4, l.patient || "—", s);
      str(row, 5, lateNote(l, isAr), s);
      str(row, 6, l.by || "—", s);
      str(row, 7, paymentMethodLabel(l.method, isAr) || "—", s);
      numCell(row, 8, l.amount, s);
      height(row, 22);
      row += 1;
    });
    mergeRow(row, 1, 7, L.total, TOTAL);
    formula(row, 8, `SUM(${ref(first, 8)}:${ref(row - 1, 8)})`, report.lateTotal, TOTAL);
    height(row, 24);
    row += 2;
  }

  function finish(): XLSX.WorkBook {
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(row, 1), c: W - 1 } });
    ws["!merges"] = merges;
    ws["!cols"] = WIDTHS.map((_, i) => ({ wch: WIDTHS[W - 1 - i] }));
    ws["!rows"] = heights;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, L.sheet);
    return wb;
  }
}

/** The file's bytes, compressed (an uncompressed sheet is about four times bigger). */
export function dailyFinanceReportBytes(report: DailyFinanceReport, clinicName: string, isAr: boolean): Uint8Array {
  const wb = dailyFinanceReportWorkbook(report, clinicName, isAr);
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

