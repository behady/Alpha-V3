/**
 * One dentist's commission for a period, as a spreadsheet the owner can pay from or hand over.
 *
 * Mirrors the two tables on the team page, in one sheet: private work first (payment by payment,
 * the rate stamped when the patient paid), then insurance work (line by line, the share on the
 * approved amount), then the two added together. Both halves are what the page shows, read off the
 * same `StaffCommission` / `StaffInsuranceWork` values, so the file can never disagree with the
 * screen it was downloaded from.
 *
 * The columns line up across the two halves on purpose: E is the amount the rate applies to, F the
 * rate, G their share. Totals are real SUM formulas with the figure cached beside them.
 *
 * Uses xlsx-js-style (bold headings, number formats); imported dynamically by the page so it only
 * reaches a browser when somebody presses the button.
 */

import XLSX from "xlsx-js-style";
import type { StaffCommission } from "./staffCommission";
import type { StaffInsuranceWork } from "./staffInsurance";

type Style = NonNullable<XLSX.CellObject["s"]>;
type Cell = XLSX.CellObject | null;

export type CommissionSheetInput = {
  dentistName: string;
  start: string;
  end: string;
  commission: StaffCommission;
  insurance: StaffInsuranceWork;
  isAr: boolean;
};

const COLS = 7;
const COL_WIDTHS = [13, 26, 32, 16, 13, 8, 14];
const MONEY = "#,##0.00";
const DATE = "dd/mm/yyyy";

const BORDER = { bottom: { style: "thin", color: { rgb: "D0D0D0" } } } as const;
const STYLE = {
  title: { font: { sz: 14, bold: true } } satisfies Style,
  muted: { font: { color: { rgb: "666666" } } } satisfies Style,
  heading: { font: { sz: 12, bold: true } } satisfies Style,
  head: { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "EFEFEF" } }, border: BORDER } satisfies Style,
  headNum: { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: "EFEFEF" } }, border: BORDER, alignment: { horizontal: "right" } } satisfies Style,
  text: { border: BORDER } satisfies Style,
  date: { border: BORDER, numFmt: DATE, alignment: { horizontal: "left" } } satisfies Style,
  money: { border: BORDER, numFmt: MONEY } satisfies Style,
  pct: { border: BORDER, alignment: { horizontal: "right" } } satisfies Style,
  total: { font: { bold: true } } satisfies Style,
  totalMoney: { font: { bold: true }, numFmt: MONEY } satisfies Style,
  grand: { font: { sz: 12, bold: true } } satisfies Style,
  grandMoney: { font: { sz: 12, bold: true }, numFmt: MONEY } satisfies Style,
};

const s = (v: string, style: Style = {}): XLSX.CellObject => ({ v, t: "s", s: style });
const n = (v: number, style: Style): XLSX.CellObject => ({ v, t: "n", s: style });
const f = (formula: string, value: number, style: Style): XLSX.CellObject => ({ f: formula, v: value, t: "n", s: style });
const ref = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * A real Excel date, worked out from the calendar day rather than through a JS Date, so no time
 * zone can move it to the day before. A string that is not a day is written as it came.
 */
function dateCell(ymd: string): XLSX.CellObject {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return s(ymd || "—", STYLE.text);
  const serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { v: serial, t: "n", z: DATE, s: STYLE.date };
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

const LABELS = {
  en: {
    title: (name: string) => `Commission — ${name}`,
    period: (a: string, b: string) => (a === b ? `Period: ${a}` : `Period: ${a} to ${b}`),
    privateWork: "Private work",
    privateNote: "The rate recorded when the patient paid.",
    privateHead: ["Date", "Patient", "Treatment", "Lab fee", "Paid", "%", "Their share"],
    noPrivate: "No private payments in this period.",
    insuranceWork: "Insurance work",
    insuranceNote: "Their share is worked out on the approved amount.",
    insuranceHead: ["Date", "Patient", "Service", "Approval no.", "Approved", "%", "Their share"],
    total: "Total",
    grand: "Total commission",
  },
  ar: {
    title: (name: string) => `عمولة ${name}`,
    period: (a: string, b: string) => (a === b ? `الفترة: ${a}` : `الفترة: من ${a} إلى ${b}`),
    privateWork: "الشغل الخاص",
    privateNote: "النسبة اللي اتسجلت وقت ما المريض دفع.",
    privateHead: ["التاريخ", "المريض", "العلاج", "مصاريف المعمل", "المدفوع", "%", "نصيبه"],
    noPrivate: "مفيش دفعات خاصة في الفترة دي.",
    insuranceWork: "شغل التأمين",
    insuranceNote: "النسبة اتحسبت على المبلغ الموافق عليه.",
    insuranceHead: ["التاريخ", "المريض", "الخدمة", "رقم الموافقة", "الموافق عليه", "%", "نصيبه"],
    total: "الإجمالي",
    grand: "إجمالي العمولة",
  },
};

const headRow = (labels: string[]): Cell[] => labels.map((l, i) => s(l, i >= 3 ? STYLE.headNum : STYLE.head));

export function commissionWorkbook(input: CommissionSheetInput): XLSX.WorkBook {
  const L = input.isAr ? LABELS.ar : LABELS.en;
  const rows: Cell[][] = [];
  const blank = () => rows.push(Array<Cell>(COLS).fill(null));

  rows.push([s(L.title(input.dentistName), STYLE.title)]);
  rows.push([s(L.period(dayLabel(input.start), dayLabel(input.end)), STYLE.muted)]);
  blank();

  // --- private work ---------------------------------------------------------------------------
  rows.push([s(L.privateWork, STYLE.heading)]);
  rows.push([s(L.privateNote, STYLE.muted)]);
  rows.push(headRow(L.privateHead));
  const totalRows: number[] = [];
  const entries = input.commission.entries;
  if (entries.length === 0) {
    rows.push([s(L.noPrivate, STYLE.muted)]);
  } else {
    const first = rows.length;
    // Oldest first, like a statement; the page lists newest first because it is read from the top.
    for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([
        dateCell(e.date),
        s(e.patientName, STYLE.text),
        s(e.serviceName, STYLE.text),
        n(e.labFee, STYLE.money),
        n(e.paid, STYLE.money),
        // A row from before rates were stamped says so rather than claiming 0%.
        e.pct == null ? s("—", STYLE.pct) : n(e.pct, STYLE.pct),
        n(e.amount, STYLE.money),
      ]);
    }
    const last = rows.length - 1;
    const paid = round2(entries.reduce((t, e) => t + e.paid, 0));
    rows.push([
      s(L.total, STYLE.total), null, null, null,
      f(`SUM(${ref(first, 4)}:${ref(last, 4)})`, paid, STYLE.totalMoney),
      null,
      f(`SUM(${ref(first, 6)}:${ref(last, 6)})`, input.commission.total, STYLE.totalMoney),
    ]);
    totalRows.push(rows.length - 1);
  }

  // --- insurance work: only when there is some, as on the page --------------------------------
  if (input.insurance.entries.length > 0) {
    blank();
    rows.push([s(L.insuranceWork, STYLE.heading)]);
    rows.push([s(L.insuranceNote, STYLE.muted)]);
    rows.push(headRow(L.insuranceHead));
    const first = rows.length;
    for (const e of input.insurance.entries) {
      rows.push([
        dateCell(e.date),
        s(e.patientName, STYLE.text),
        s(e.service, STYLE.text),
        s(e.approvalNumber, STYLE.text),
        n(e.approved, STYLE.money),
        n(e.rate, STYLE.pct),
        n(e.share, STYLE.money),
      ]);
    }
    const last = rows.length - 1;
    rows.push([
      s(L.total, STYLE.total), null, null, null,
      f(`SUM(${ref(first, 4)}:${ref(last, 4)})`, input.insurance.approved, STYLE.totalMoney),
      null,
      f(`SUM(${ref(first, 6)}:${ref(last, 6)})`, input.insurance.total, STYLE.totalMoney),
    ]);
    totalRows.push(rows.length - 1);
  }

  // --- the two together -----------------------------------------------------------------------
  blank();
  const parts = totalRows.map((r) => ref(r, 6));
  const grand = round2(input.commission.total + input.insurance.total);
  rows.push([
    s(L.grand, STYLE.grand), null, null, null, null, null,
    parts.length ? f(parts.join("+"), grand, STYLE.grandMoney) : n(0, STYLE.grandMoney),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, input.isAr ? "العمولة" : "Commission");
  // The only right-to-left switch this library writes: a sheet's own `!views` is dropped on save.
  if (input.isAr) wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

/** ASCII only, like the other downloads: an Arabic name simply drops out of the file name. */
export function commissionFileName(dentistName: string, start: string, end: string): string {
  const name = dentistName
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `commission-${name ? `${name}-` : ""}${start}-to-${end}.xlsx`;
}
