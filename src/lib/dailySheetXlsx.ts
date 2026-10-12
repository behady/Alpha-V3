/**
 * The daily sheet as the clinic kept it in Excel: right to left, a numbered line per patient,
 * banded rows, bold centred figures, then the totals and what came in by each way of paying.
 *
 * The page hands over the lines already worded (company names, "File", Cash/Insta/VC), so the file
 * says exactly what the screen says. Totals are real SUM formulas with the figure cached beside them.
 *
 * Uses xlsx-js-style (fills, fonts, borders); imported dynamically by the page so it only reaches a
 * browser when somebody presses Export.
 */

import XLSX from "xlsx-js-style";

type Style = NonNullable<XLSX.CellObject["s"]>;
type Cell = XLSX.CellObject | null;

export type DailySheetXlsxLine = {
  n: number;
  /** yyyy-mm-dd */
  date: string;
  file: string;
  patient: string;
  method: string;
  total: number;
  paid: number;
  remaining: number;
};

export type DailySheetXlsxInput = {
  lines: DailySheetXlsxLine[];
  byMethod: { label: string; paid: number }[];
  start: string;
  end: string;
  /** The branch the figures belong to, when the clinic has branches. */
  branchName?: string;
  isAr: boolean;
};

const COLS = 8;
const COL_WIDTHS = [7, 14, 13, 30, 12, 13, 13, 13];
const MONEY = "#,##0.##";
const DATE = "dd/mm/yyyy";

const WHITE = { style: "thin", color: { rgb: "FFFFFF" } } as const;
const GRID = { top: WHITE, bottom: WHITE, left: WHITE, right: WHITE };
const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } }) as const;
const CENTER = { horizontal: "center", vertical: "center" } as const;
/** The two bands of the clinic's own sheet, a light and a deeper rose. */
const BANDS = ["F2DCDB", "E6B8B7"];

const STYLE = {
  title: { font: { sz: 14, bold: true } } satisfies Style,
  muted: { font: { color: { rgb: "666666" } } } satisfies Style,
  head: { font: { sz: 13, bold: true, color: { rgb: "FFFFFF" } }, fill: fill("963634"), border: GRID, alignment: CENTER } satisfies Style,
  totalLabel: { font: { sz: 13, bold: true, color: { rgb: "FFFFFF" } }, fill: fill("963634"), border: GRID, alignment: CENTER } satisfies Style,
  totalMoney: { font: { sz: 13, bold: true, color: { rgb: "FFFFFF" } }, fill: fill("963634"), border: GRID, alignment: CENTER, numFmt: MONEY } satisfies Style,
  methodLabel: { font: { bold: true }, fill: fill("F2F2F2"), border: GRID, alignment: CENTER } satisfies Style,
  methodMoney: { font: { bold: true }, fill: fill("F2F2F2"), border: GRID, alignment: CENTER, numFmt: MONEY } satisfies Style,
};

const band = (i: number, extra: Style = {}): Style => ({
  font: { sz: 13, bold: true },
  fill: fill(BANDS[i % 2]),
  border: GRID,
  alignment: CENTER,
  ...extra,
});

const s = (v: string, style: Style = {}): XLSX.CellObject => ({ v, t: "s", s: style });
const n = (v: number, style: Style): XLSX.CellObject => ({ v, t: "n", s: style });
const f = (formula: string, value: number, style: Style): XLSX.CellObject => ({ f: formula, v: value, t: "n", s: style });
const ref = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const round2 = (x: number) => Math.round(x * 100) / 100;

/** A real Excel date from the calendar day, not through a JS Date, so no time zone moves it. */
function dateCell(ymd: string, style: Style): XLSX.CellObject {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return s(ymd || "—", style);
  const serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { v: serial, t: "n", z: DATE, s: { ...style, numFmt: DATE } };
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

const LABELS = {
  en: {
    title: "Daily sheet",
    period: (a: string, b: string) => (a === b ? a : `${a} to ${b}`),
    head: ["#", "Date", "File", "Patient", "Method", "Total", "Paid", "Remaining"],
    total: "Total",
    byMethod: "Paid by method",
    empty: "No patients in this period.",
    sheet: "Daily sheet",
  },
  ar: {
    title: "اليومية",
    period: (a: string, b: string) => (a === b ? a : `من ${a} إلى ${b}`),
    head: ["م", "التاريخ", "الملف", "اسم المريض", "طريقة الدفع", "الإجمالي", "المدفوع", "المتبقي"],
    total: "الإجمالي",
    byMethod: "المدفوع حسب طريقة الدفع",
    empty: "مفيش مرضى في الفترة دي.",
    sheet: "اليومية",
  },
};

export function dailySheetWorkbook(input: DailySheetXlsxInput): XLSX.WorkBook {
  const L = input.isAr ? LABELS.ar : LABELS.en;
  const rows: Cell[][] = [];

  const heading = [L.title, input.branchName].filter(Boolean).join(" — ");
  rows.push([s(heading, STYLE.title)]);
  rows.push([s(L.period(dayLabel(input.start), dayLabel(input.end)), STYLE.muted)]);
  rows.push(Array<Cell>(COLS).fill(null));
  rows.push(L.head.map((h) => s(h, STYLE.head)));

  if (input.lines.length === 0) {
    rows.push([s(L.empty, STYLE.muted)]);
  } else {
    const first = rows.length;
    input.lines.forEach((line, i) => {
      rows.push([
        n(line.n, band(i)),
        dateCell(line.date, band(i)),
        s(line.file, band(i)),
        s(line.patient, band(i)),
        s(line.method, band(i)),
        n(line.total, band(i, { numFmt: MONEY })),
        n(line.paid, band(i, { numFmt: MONEY })),
        n(line.remaining, band(i, { numFmt: MONEY })),
      ]);
    });
    const last = rows.length - 1;
    const sum = (c: number, value: number) => f(`SUM(${ref(first, c)}:${ref(last, c)})`, value, STYLE.totalMoney);
    rows.push([
      s(L.total, STYLE.totalLabel), s("", STYLE.totalLabel), s("", STYLE.totalLabel), s("", STYLE.totalLabel), s("", STYLE.totalLabel),
      sum(5, round2(input.lines.reduce((t, l) => t + l.total, 0))),
      sum(6, round2(input.lines.reduce((t, l) => t + l.paid, 0))),
      sum(7, round2(input.lines.reduce((t, l) => t + l.remaining, 0))),
    ]);
  }

  if (input.byMethod.length > 0) {
    rows.push(Array<Cell>(COLS).fill(null));
    rows.push([s(L.byMethod, { font: { bold: true } })]);
    for (const m of input.byMethod) {
      rows.push([null, null, null, null, s(m.label, STYLE.methodLabel), null, n(m.paid, STYLE.methodMoney)]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
  ws["!rows"] = rows.map((_, i) => (i >= 3 ? { hpt: 22 } : {}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, L.sheet);
  // Right to left like the clinic's own sheet (the number on the right), in either language.
  // The only switch this library writes: a sheet's own `!views` is dropped on save.
  wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

export function dailySheetFileName(start: string, end: string): string {
  return start === end ? `daily-sheet-${start}.xlsx` : `daily-sheet-${start}-to-${end}.xlsx`;
}
