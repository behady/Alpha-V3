/**
 * The claim statement as the insurer's spreadsheet.
 *
 * Reproduces docs/samples/insurance-statement-nextcare-2026-02.xlsx cell for cell: the three
 * header lines in 36pt across A:D, the brown title row, one block per case with the serial and
 * the name merged down the block, a shaded subtotal row with a real SUM, and a four-row footer
 * holding the grand total. Right-to-left, A4 portrait, Arial throughout.
 *
 * Uses xlsx-js-style — the styled fork of the xlsx the app already uses — because the community
 * build cannot write a font, a fill, a border or a merge, and the insurer's clerk recognises the
 * sheet by exactly those. Imported dynamically by the report tab so its 2.7 MB only reaches a
 * browser when somebody presses Excel.
 *
 * The two helper columns in the sample (E, F: the receptionist's retyped subtotals) are not
 * reproduced; the formulas make them unnecessary.
 */

import XLSX from "xlsx-js-style";
import { caseLabel, type Statement } from "./insuranceStatement";

export type StatementHeader = { line1: string; line2: string; line3: string };

const FILL = "938953";
const SHEET = "Sheet1";
/** Column widths, row heights and the title text, from the sample. */
const COL_WIDTHS = [19.1, 45, 63.9, 44.3];
const HEADER_HEIGHTS = [90, 45.8, 35.2];
const TITLES = ["المسلسل", "اسم الحالة", "بيان الخدمة", "قيمة الخدمة"];
const TOTAL_LABEL = "الاجمالي";
const FOOTER_ROWS = 4;

type Style = NonNullable<XLSX.CellObject["s"]>;
type Cell = XLSX.CellObject | null;

const side = (style: "thin" | "medium") => ({ style, color: { rgb: "000000" } });
const box = (style: "thin" | "medium") => ({ top: side(style), bottom: side(style), left: side(style), right: side(style) });
const centered = { horizontal: "center", vertical: "center" } as const;
const shaded = { patternType: "solid", fgColor: { rgb: FILL } } as const;

const font = (sz: number) => ({ name: "Arial", sz, bold: true });

const STYLE = {
  headerLine: { font: font(36), alignment: { ...centered, wrapText: true }, border: box("medium") } satisfies Style,
  title: { font: font(36), fill: shaded, alignment: centered, border: box("medium") } satisfies Style,
  serial: { font: font(20), fill: shaded, alignment: centered, border: box("thin") } satisfies Style,
  line: { font: font(20), alignment: centered, border: box("thin") } satisfies Style,
  subtotal: { font: font(22), fill: shaded, alignment: centered, border: box("thin") } satisfies Style,
  footerLabel: { font: font(36), fill: shaded, alignment: centered, border: box("thin") } satisfies Style,
  footerTotal: { font: font(20), fill: shaded, alignment: centered, border: box("thin") } satisfies Style,
};

const s = (v: string, style: Style): XLSX.CellObject => ({ v, t: "s", s: style });
const n = (v: number, style: Style): XLSX.CellObject => ({ v, t: "n", s: style });
/** A formula with its computed value cached beside it: viewers that never recalculate still show the number. */
const f = (formula: string, value: number, style: Style): XLSX.CellObject => ({ f: formula, v: value, t: "n", s: style });
const cellRef = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

/** The whole statement as cells, merges and sizes. Rows are 0-based here; Excel shows them +1. */
export function statementToWorkbook(statement: Statement, header: StatementHeader): XLSX.WorkBook {
  const rows: Cell[][] = [];
  const merges: XLSX.Range[] = [];
  const mergeAcross = (r: number, c0: number, c1: number) => merges.push({ s: { r, c: c0 }, e: { r, c: c1 } });
  const mergeDown = (c: number, r0: number, r1: number) => merges.push({ s: { r: r0, c }, e: { r: r1, c } });

  for (const line of [header.line1, header.line2, header.line3]) {
    rows.push([s(line, STYLE.headerLine), null, null, null]);
    mergeAcross(rows.length - 1, 0, 3);
  }
  rows.push(TITLES.map((t) => s(t, STYLE.title)));

  const subtotalCells: string[] = [];
  for (const c of statement.cases) {
    const first = rows.length;
    c.lines.forEach((line, i) => {
      rows.push([
        i === 0 ? n(c.serial, STYLE.serial) : null,
        i === 0 ? s(caseLabel(c), STYLE.line) : null,
        s(line.text, STYLE.line),
        n(line.amount, STYLE.line),
      ]);
    });
    const last = rows.length - 1;
    const subtotalRow = rows.length;
    rows.push([
      null,
      null,
      s(TOTAL_LABEL, STYLE.subtotal),
      f(`SUM(${cellRef(first, 3)}:${cellRef(last, 3)})`, c.subtotal, STYLE.subtotal),
    ]);
    // The serial and the name span the case's lines and its subtotal, as in the sample.
    mergeDown(0, first, subtotalRow);
    mergeDown(1, first, subtotalRow);
    subtotalCells.push(cellRef(subtotalRow, 3));
  }

  const footTop = rows.length;
  rows.push([
    s(TOTAL_LABEL, STYLE.footerLabel),
    null,
    null,
    subtotalCells.length ? f(`SUM(${subtotalCells.join(",")})`, statement.total, STYLE.footerTotal) : n(0, STYLE.footerTotal),
  ]);
  for (let i = 1; i < FOOTER_ROWS; i++) rows.push([null, null, null, null]);
  merges.push({ s: { r: footTop, c: 0 }, e: { r: footTop + FOOTER_ROWS - 1, c: 2 } });
  mergeDown(3, footTop, footTop + FOOTER_ROWS - 1);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
  ws["!rows"] = HEADER_HEIGHTS.map((hpt) => ({ hpt }));
  // Merged cells other than the anchor are left empty by aoa_to_sheet; give them the border so the
  // block reads as one box, the way the sample does.
  for (const m of merges) {
    const style = ws[cellRef(m.s.r, m.s.c)]?.s;
    if (!style) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const ref = cellRef(r, c);
        if (!ws[ref]) ws[ref] = { v: "", t: "s", s: style };
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET);
  wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

/** ASCII only; the insurer's name is on the sheet, not in the file name. */
export function statementFileName(statement: Statement): string {
  const payer = statement.payerId.replace(/[^a-z0-9_-]+/gi, "").toLowerCase() || "insurer";
  return `statement-${payer}-${statement.month}.xlsx`;
}
