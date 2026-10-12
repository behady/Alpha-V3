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
import type { DailyFinanceReport } from "@/lib/reports/dailyFinanceReport";

type Style = NonNullable<XLSX.CellObject["s"]>;

const W = 11;
/** Logical column (1 = rightmost, "م") → 0-based sheet column. */
const C = (c: number) => W - c;
const WIDTHS = [14, 13, 13, 24, 22, 14, 13, 12, 12, 11, 13];

const WHITE = { style: "thin", color: { rgb: "FFFFFF" } } as const;
const GRID = { top: WHITE, bottom: WHITE, left: WHITE, right: WHITE };
const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } }) as const;
const CENTER = { horizontal: "center", vertical: "center", wrapText: true } as const;
const RIGHT = { horizontal: "right", vertical: "center", readingOrder: 2 } as const;
const BANDS = ["F2DCDB", "E6B8B7"];
const NUM = "General";
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
    summaryHead: ["الفرع", "عدد", "المطلوب", "المدفوع", "المتبقي", "نصيب الأطباء"],
    head: ["م", "التاريخ", "المصدر", "اسم المريض", "الإجراء", "الطبيب", "طريقة الدفع", "المطلوب", "المدفوع", "المتبقي", "نصيب الطبيب"],
    clinic: "العيادة",
    branch: (name: string) => `فرع ${name}`,
    branchTotal: (name: string) => `إجمالي فرع ${name}`,
    total: "الإجمالي",
    grand: "الإجمالي الكلي",
    empty: "مفيش حركة فلوس في اليوم ده.",
    note: "المتبقي = المطلوب − المدفوع.   ملف = مريض العيادة (بدون تأمين).   مع التأمين، المطلوب هو نصيب المريض بس.   نصيب الطبيب = النسبة المسجلة على كل علاج اتعمل في اليوم.",
    sheet: "التقرير اليومي",
  },
  en: {
    title: "Daily report",
    summary: "Summary",
    details: "Details",
    summaryHead: ["Branch", "Patients", "Due", "Paid", "Remaining", "Dentists' share"],
    head: ["#", "Date", "Source", "Patient", "Procedure", "Dentist", "Method", "Due", "Paid", "Remaining", "Dentist share"],
    clinic: "Clinic",
    branch: (name: string) => name,
    branchTotal: (name: string) => `${name} total`,
    total: "Total",
    grand: "Grand total",
    empty: "No money moved on this day.",
    note: "Remaining = Due − Paid.   File = the clinic's own patient.   With insurance, Due is the patient's part only.   Dentist share = the rate recorded on each treatment done that day.",
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
      numCell(row, 8, line.total, s);
      numCell(row, 9, line.paid, s);
      formula(row, 10, `${ref(row, 8)}-${ref(row, 9)}`, line.remaining, s);
      numCell(row, 11, line.dentistShare, s);
      height(row, 22);
      row += 1;
    });
    const last = row - 1;
    mergeRow(row, 1, 7, section.branchId ? L.branchTotal(name) : `${L.total} — ${name}`, TOTAL);
    const t = section.totals;
    const sums: [number, number][] = [[8, t.total], [9, t.paid], [10, t.remaining], [11, t.dentistShare]];
    for (const [c, v] of sums) formula(row, c, `SUM(${ref(first, c)}:${ref(last, c)})`, v, TOTAL);
    height(row, 24);
    subtotalRows.push({ r: row, first, last });
    row += 2;
  }

  if (report.sections.length > 1) {
    mergeRow(row, 1, 7, L.grand, BANNER);
    const t = report.totals;
    const grand: [number, number][] = [[8, t.total], [9, t.paid], [10, t.remaining], [11, t.dentistShare]];
    for (const [c, v] of grand) formula(row, c, subtotalRows.map((s) => ref(s.r, c)).join("+"), v, BANNER);
    height(row, 24);
    row += 2;
  }
  mergeRow(row, 1, W, L.note, { font: { name: "Arial", sz: 9, italic: true } });

  // --- the summary lines point at each branch's total row ---
  report.sections.forEach((section, i) => {
    const r = summaryFirst + i;
    const sub = subtotalRows[i];
    const s = BAND(i);
    str(r, 1, section.name || L.clinic, s);
    formula(r, 2, `COUNTA(${ref(sub.first, 4)}:${ref(sub.last, 4)})`, section.totals.patients, s);
    const cols: [number, number, number][] = [[3, 8, section.totals.total], [4, 9, section.totals.paid], [5, 10, section.totals.remaining], [6, 11, section.totals.dentistShare]];
    for (const [c, from, v] of cols) formula(r, c, ref(sub.r, from), v, s);
    height(r, 22);
  });
  str(summaryTotal, 1, L.total, TOTAL);
  const t = report.totals;
  const totalCols: [number, number][] = [[2, t.patients], [3, t.total], [4, t.paid], [5, t.remaining], [6, t.dentistShare]];
  for (const [c, v] of totalCols) formula(summaryTotal, c, `SUM(${ref(summaryFirst, c)}:${ref(summaryTotal - 1, c)})`, v, TOTAL);
  height(summaryTotal, 24);

  return finish();

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

