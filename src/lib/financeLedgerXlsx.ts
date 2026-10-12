/**
 * The Finance page's list as a spreadsheet: every row the screen lists for the period, branch and
 * filters on screen (all pages, not just the one showing), with the same columns — dentist, their
 * rate and commission, the clinic's net, how it was paid and the amount — then the totals and what
 * came in by each way of paying.
 *
 * The page hands over the rows already worded (titles, names, method in plain words), so the file
 * says what the screen says. Totals are real SUM formulas with the figure cached beside them.
 *
 * Uses xlsx-js-style; imported dynamically by the page so it only reaches a browser on Export.
 */

import XLSX from "xlsx-js-style";

type Style = NonNullable<XLSX.CellObject["s"]>;
type Cell = XLSX.CellObject | null;

export type FinanceXlsxRow = {
  /** yyyy-mm-dd */
  date: string;
  /** Money in (payments, other income) or out (expenses, staff pay). */
  direction: "in" | "out";
  details: string;
  category: string;
  patient: string;
  dentist: string;
  /** The dentist's rate in percent; null when the row carries none. */
  rate: number | null;
  commission: number | null;
  commissionPaid: number | null;
  commissionPending: number | null;
  clinicNet: number | null;
  /** In plain words ("Cash", "فيزا"); empty when none was recorded. */
  method: string;
  /** Positive; the direction says which way it went. */
  amount: number;
};

export type FinanceXlsxInput = {
  rows: FinanceXlsxRow[];
  byMethod: { label: string; amount: number }[];
  start: string;
  end: string;
  branchName?: string;
  isAr: boolean;
};

const COL_WIDTHS = [12, 9, 44, 18, 24, 18, 9, 12, 12, 12, 12, 12, 13];
const COLS = COL_WIDTHS.length;
const DATE = "dd/mm/yyyy";
/** Plain figures; "#,##0.##" leaves "40,400." on whole numbers. */
const MONEY = "General";
const BORDER = { bottom: { style: "thin", color: { rgb: "D0D0D0" } } } as const;
const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } }) as const;

const STYLE = {
  title: { font: { sz: 14, bold: true } } satisfies Style,
  muted: { font: { color: { rgb: "666666" } } } satisfies Style,
  head: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: fill("1F2937"), alignment: { horizontal: "center", vertical: "center", wrapText: true } } satisfies Style,
  text: { border: BORDER, alignment: { vertical: "top", wrapText: true } } satisfies Style,
  center: { border: BORDER, alignment: { horizontal: "center", vertical: "top" } } satisfies Style,
  num: { border: BORDER, numFmt: MONEY, alignment: { vertical: "top" } } satisfies Style,
  in: { border: BORDER, numFmt: MONEY, font: { bold: true, color: { rgb: "047857" } }, alignment: { vertical: "top" } } satisfies Style,
  out: { border: BORDER, numFmt: MONEY, font: { bold: true, color: { rgb: "B91C1C" } }, alignment: { vertical: "top" } } satisfies Style,
  totalLabel: { font: { bold: true }, fill: fill("F3F4F6") } satisfies Style,
  totalMoney: { font: { bold: true }, fill: fill("F3F4F6"), numFmt: MONEY } satisfies Style,
  heading: { font: { sz: 12, bold: true } } satisfies Style,
};

const s = (v: string, style: Style = {}): XLSX.CellObject => ({ v, t: "s", s: style });
const n = (v: number, style: Style): XLSX.CellObject => ({ v, t: "n", s: style });
const f = (formula: string, value: number, style: Style): XLSX.CellObject => ({ f: formula, v: value, t: "n", s: style });
const round2 = (x: number) => Math.round(x * 100) / 100;
const optional = (v: number | null, style: Style): Cell => (v == null ? s("", style) : n(v, style));

function dateCell(ymd: string): XLSX.CellObject {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return s(ymd || "—", STYLE.center);
  const serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { v: serial, t: "n", z: DATE, s: { ...STYLE.center, numFmt: DATE } };
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

const LABELS = {
  en: {
    title: "Finance",
    period: (a: string, b: string) => (a === b ? a : `${a} to ${b}`),
    head: ["Date", "Type", "Details", "Category", "Patient", "Dentist", "Dentist %", "Commission", "Paid commission", "Pending commission", "Clinic net", "Method", "Amount"],
    in: "In",
    out: "Out",
    income: "Total in",
    expenses: "Total out",
    net: "Net",
    byMethod: "Money in by method",
    empty: "Nothing in this period.",
    sheet: "Finance",
  },
  ar: {
    title: "الماليات",
    period: (a: string, b: string) => (a === b ? a : `من ${a} إلى ${b}`),
    head: ["التاريخ", "النوع", "التفاصيل", "التصنيف", "المريض", "الطبيب", "نسبة الطبيب", "عمولة الطبيب", "عمولة اتدفعت", "عمولة معلّقة", "صافي العيادة", "طريقة الدفع", "المبلغ"],
    in: "داخل",
    out: "خارج",
    income: "إجمالي الداخل",
    expenses: "إجمالي الخارج",
    net: "الصافي",
    byMethod: "الداخل حسب طريقة الدفع",
    empty: "مفيش حركة في الفترة دي.",
    sheet: "الماليات",
  },
};

export function financeWorkbook(input: FinanceXlsxInput): XLSX.WorkBook {
  const L = input.isAr ? LABELS.ar : LABELS.en;
  const rows: Cell[][] = [];
  const AMOUNT = COLS - 1;

  rows.push([s([L.title, input.branchName].filter(Boolean).join(" — "), STYLE.title)]);
  rows.push([s(L.period(dayLabel(input.start), dayLabel(input.end)), STYLE.muted)]);
  rows.push(Array<Cell>(COLS).fill(null));
  rows.push(L.head.map((h) => s(h, STYLE.head)));

  if (input.rows.length === 0) {
    rows.push([s(L.empty, STYLE.muted)]);
  } else {
    const first = rows.length;
    for (const r of input.rows) {
      const out = r.direction === "out";
      rows.push([
        dateCell(r.date),
        s(out ? L.out : L.in, STYLE.center),
        s(r.details, STYLE.text),
        s(r.category, STYLE.text),
        s(r.patient, STYLE.text),
        s(r.dentist, STYLE.text),
        r.rate == null ? s("", STYLE.center) : s(`${r.rate}%`, STYLE.center),
        optional(r.commission, STYLE.num),
        optional(r.commissionPaid, STYLE.num),
        optional(r.commissionPending, STYLE.num),
        optional(r.clinicNet, STYLE.num),
        s(r.method, STYLE.center),
        // Money out is negative, so one SUM over the column is the net.
        n(out ? -r.amount : r.amount, out ? STYLE.out : STYLE.in),
      ]);
    }
    const last = rows.length - 1;
    const col = XLSX.utils.encode_col(AMOUNT);
    const range = `${col}${first + 1}:${col}${last + 1}`;
    const totalIn = round2(input.rows.filter((r) => r.direction === "in").reduce((t, r) => t + r.amount, 0));
    const totalOut = round2(input.rows.filter((r) => r.direction === "out").reduce((t, r) => t + r.amount, 0));
    const pad = (label: string) => [s(label, STYLE.totalLabel), ...Array.from({ length: AMOUNT - 1 }, () => s("", STYLE.totalLabel))];
    rows.push(Array<Cell>(COLS).fill(null));
    rows.push([...pad(L.income), f(`SUMIF(${range},">0")`, totalIn, STYLE.totalMoney)]);
    rows.push([...pad(L.expenses), f(`-SUMIF(${range},"<0")`, totalOut, STYLE.totalMoney)]);
    rows.push([...pad(L.net), f(`SUM(${range})`, round2(totalIn - totalOut), STYLE.totalMoney)]);
  }

  if (input.byMethod.length > 0) {
    rows.push(Array<Cell>(COLS).fill(null));
    rows.push([s(L.byMethod, STYLE.heading)]);
    for (const m of input.byMethod) {
      rows.push([...Array<Cell>(AMOUNT - 1).fill(null), s(m.label, STYLE.center), n(m.amount, STYLE.num)]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, L.sheet);
  // The only right-to-left switch this library writes: a sheet's own `!views` is dropped on save.
  if (input.isAr) wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

export function financeFileName(start: string, end: string): string {
  return start === end ? `finance-${start}.xlsx` : `finance-${start}-to-${end}.xlsx`;
}
