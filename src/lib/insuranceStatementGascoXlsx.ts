/**
 * A contract company's monthly statement (GASCO and the like) as the company's own spreadsheet.
 *
 * A company with no approval paper is billed from the treatments the desk charged to it. Its clerk
 * accepts one sheet, which DENT INN retyped by hand every month (the sample stays outside the repo;
 * it holds real patient names). This reproduces that sheet: three pink header lines across A:E, the
 * darker title row, one block per visit with the serial and the name merged down the block, a
 * `2X880` working beside every counted line with the value as the matching formula, a shaded
 * الاجمالي row with a real SUM, and a five-row footer holding the grand total. Right-to-left,
 * Arial bold throughout, at the sample's sizes.
 *
 * The cases themselves come from `buildInsuranceStatement`, the same grouping and wording as the
 * insurers' statements; only the layout differs. The sample's helper column F (the subtotals retyped)
 * is not reproduced; the formulas make it unnecessary.
 */

import XLSX from "xlsx-js-style";
import type { Statement } from "./insuranceStatement";
import { caseLabel } from "./insuranceStatement";
import { box, cellRef, centered, f, fillOf, font, n, s, type Cell, type Style, type StatementHeader } from "./insuranceStatementXlsx";

/** The sample's two fills: the light header band and the darker title/total rows. */
const LIGHT = fillOf("F2DCDB");
const DARK = fillOf("D99694");
const SHEET = "Sheet1";
const COLS = 5;
/** Column widths, row heights and the title text, from the sample (its spelling, which the clerk knows). */
const COL_WIDTHS = [17.25, 40, 53.75, 32.63, 47.13];
const HEADER_HEIGHTS = [54.75, 26.25, 26.25];
const TITLE_HEIGHT = 35.25;
const LINE_HEIGHT = 30;
const SUBTOTAL_HEIGHT = 35.25;
const TITLES = ["المسلسل", "اسم الحاله", "بيان الخدمه", "", "قيمه الخدمه"];
const TOTAL_LABEL = "الاجمالي";
const FOOTER_ROWS = 5;

const STYLE = {
  headerLine: { font: font(20), fill: LIGHT, alignment: { ...centered, wrapText: true }, border: box("thin") } satisfies Style,
  titleSmall: { font: font(26), fill: DARK, alignment: centered, border: box("thin") } satisfies Style,
  title: { font: font(28), fill: DARK, alignment: centered, border: box("thin") } satisfies Style,
  line: { font: font(24), alignment: { ...centered, wrapText: true }, border: box("thin") } satisfies Style,
  subtotal: { font: font(28), fill: DARK, alignment: centered, border: box("thin") } satisfies Style,
  footer: { font: font(72), fill: DARK, alignment: centered, border: box("thin") } satisfies Style,
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The working the clerk writes beside a counted line: `2X880` and the formula `2*880`. Only when the
 * units really multiply out to the line's value; otherwise (a discount, a flat price) the line shows
 * its value alone, as the sample does.
 */
export function lineWorking(amount: number, units: number): { text: string; formula: string } | null {
  if (!Number.isInteger(units) || units < 2 || !(amount > 0)) return null;
  const unit = round2(amount / units);
  if (round2(unit * units) !== round2(amount)) return null;
  return { text: `${units}X${unit}`, formula: `${units}*${unit}` };
}

/**
 * The whole statement as cells, merges and sizes. `units` is the count of each counted line, by
 * ledger row id (rows billed once are simply absent). Rows are 0-based here; Excel shows them +1.
 */
export function gascoStatementToWorkbook(statement: Statement, header: StatementHeader, units: ReadonlyMap<string, number>): XLSX.WorkBook {
  const rows: Cell[][] = [];
  const heights: number[] = [];
  const merges: XLSX.Range[] = [];
  const blank = (): Cell[] => Array.from({ length: COLS }, () => null);
  const mergeDown = (c: number, r0: number, r1: number) => merges.push({ s: { r: r0, c }, e: { r: r1, c } });

  [header.line1, header.line2, header.line3].forEach((line, i) => {
    rows.push([s(line, STYLE.headerLine), null, null, null, null]);
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: COLS - 1 } });
    heights.push(HEADER_HEIGHTS[i]);
  });
  rows.push(TITLES.map((t, c) => s(t, c < 2 ? STYLE.titleSmall : STYLE.title)));
  heights.push(TITLE_HEIGHT);

  const subtotalCells: string[] = [];
  for (const c of statement.cases) {
    const first = rows.length;
    c.lines.forEach((line, i) => {
      const working = lineWorking(line.amount, units.get(line.rowId) ?? 1);
      rows.push([
        i === 0 ? n(c.serial, STYLE.line) : null,
        i === 0 ? s(caseLabel(c), STYLE.line) : null,
        s(line.text, STYLE.line),
        working ? s(working.text, STYLE.line) : s("", STYLE.line),
        working ? f(working.formula, line.amount, STYLE.line) : n(line.amount, STYLE.line),
      ]);
      heights.push(LINE_HEIGHT);
    });
    const last = rows.length - 1;
    const subtotalRow = rows.length;
    rows.push([
      null,
      null,
      s(TOTAL_LABEL, STYLE.subtotal),
      s("", STYLE.subtotal),
      f(`SUM(${cellRef(first, 4)}:${cellRef(last, 4)})`, c.subtotal, STYLE.subtotal),
    ]);
    heights.push(SUBTOTAL_HEIGHT);
    // The serial and the name span the visit's lines and its subtotal, as in the sample.
    mergeDown(0, first, subtotalRow);
    mergeDown(1, first, subtotalRow);
    subtotalCells.push(cellRef(subtotalRow, 4));
  }

  const footTop = rows.length;
  rows.push([
    s(TOTAL_LABEL, STYLE.footer),
    null,
    null,
    null,
    subtotalCells.length ? f(`SUM(${subtotalCells.join(",")})`, statement.total, STYLE.footer) : n(0, STYLE.footer),
  ]);
  for (let i = 1; i < FOOTER_ROWS; i++) rows.push(blank());
  merges.push({ s: { r: footTop, c: 0 }, e: { r: footTop + FOOTER_ROWS - 1, c: 3 } });
  mergeDown(4, footTop, footTop + FOOTER_ROWS - 1);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
  ws["!rows"] = heights.map((hpt) => ({ hpt }));
  // Merged cells other than the anchor are left empty by aoa_to_sheet; give them the anchor's style
  // so the block reads as one shaded, bordered box, the way the sample does.
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
  // The only right-to-left switch this library writes: a sheet's own `!views` is dropped on save.
  wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

/** ASCII only: `gasco-2026-08.xlsx` for a whole month, else the two dates. */
export function gascoFileName(payerName: string, start: string, end: string): string {
  const name = payerName.replace(/[^a-z0-9_-]+/gi, "").toLowerCase() || "company";
  const wholeMonth = start.endsWith("-01") && end === monthEnd(start);
  return wholeMonth ? `${name}-${start.slice(0, 7)}.xlsx` : start === end ? `${name}-${start}.xlsx` : `${name}-${start}_${end}.xlsx`;
}

function monthEnd(start: string): string {
  const [y, m] = start.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
