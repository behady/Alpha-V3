/**
 * The MetLife statement as MetLife's spreadsheet.
 *
 * Reproduces the insurer's sample sheet cell for cell (the sample stays outside the repo; it holds real
 * patient names): three header lines across A:K, the brown title row, one block per approval with the
 * serial, patient, policy, certificate, dependent, approval number and date merged down the block and one
 * row per service beside them, a shaded subtotal row with a real SUM, and a three-row footer holding the
 * grand total. Right-to-left, Arial throughout.
 *
 * The page is meant to print A4 portrait, but the xlsx writer has no page-setup support, so the clerk's
 * Excel picks the paper; the sheet itself is sized to the sample's columns.
 *
 * Column L of the sample (the receptionist's retyped subtotals) is not reproduced; the formulas make it
 * unnecessary. The helpers are the Nextcare writer's, so the two sheets stay one family. Imported
 * dynamically by the page so the xlsx build only reaches a browser when somebody presses Excel.
 */

import XLSX from "xlsx-js-style";
import type { MetlifeStatement } from "./insuranceStatementMetlife";
import { box, cellRef, centered, f, fillOf, font, n, s, type Cell, type StatementHeader, type Style } from "./insuranceStatementXlsx";

const SHEET = "Sheet1";
const BROWN = "938953";
const CREAM = "EEECE1";
const COL_WIDTHS = [18.8, 35.5, 26.2, 27.8, 19.2, 23.6, 26.0, 40.0, 21.0, 26.1, 29.8];
const HEADER_HEIGHTS = [79.5, 30.75, 31.5];
const TITLE_HEIGHT = 27.75;
const ROW_HEIGHT = 26.25;
const FOOTER_ROWS = 3;
const LAST_COL = COL_WIDTHS.length - 1; // K
const LINE_COL = 7; // H: where a case's service lines start (A-G are merged down the block)
/** Days from Excel's day 0 (1899-12-30) to the Unix epoch. */
const EXCEL_EPOCH_DAYS = 25569;
const TOTAL_LABEL = "الاجمالي";

export const METLIFE_TITLES = [
  "المسلسل",
  "اسم المريض",
  "رقم الوثيقة",
  "رقم الشهادة الفردية",
  "المعال",
  "رقم الموافقة",
  "التاريخ",
  "بيان الخدمة",
  "العدد",
  "القيمة المطلوبة",
  "الموافق عليه",
];

/** Built per workbook: the writer rewrites colour strings in place, so a style object must never outlive the sheet it was made for. */
const makeStyles = () => {
  const brown = () => fillOf(BROWN);
  return {
    headerLine: { font: font(22), alignment: { ...centered, wrapText: true }, border: box("thin") } satisfies Style,
    title: { font: font(22), fill: brown(), alignment: centered, border: box("thin") } satisfies Style,
    serial: { font: font(24), fill: fillOf(CREAM), alignment: centered, border: box("thin") } satisfies Style,
    caseCell: { font: font(24), alignment: centered, border: box("thin") } satisfies Style,
    line: { font: font(20), alignment: centered, border: box("thin") } satisfies Style,
    subtotal: { font: font(20), fill: brown(), alignment: centered, border: box("thin") } satisfies Style,
    gap: { alignment: centered, border: box("thin") } satisfies Style,
    footerLabel: { font: font(48), fill: brown(), alignment: centered, border: box("thin") } satisfies Style,
    footerFill: { fill: brown(), alignment: centered, border: box("thin") } satisfies Style,
    footerTotal: { font: font(24), fill: brown(), alignment: centered, border: box("thin") } satisfies Style,
  };
};

/** Policy, certificate and dependent are numbers on the sample; anything with a letter or a dash stays text. */
const idCell = (v: string, style: Style): XLSX.CellObject => (/^\d+$/.test(v) ? n(Number(v), style) : s(v, style));
/**
 * A real date shown as mm-dd-yy, like the sample; a value that is not a plain ISO date stays text.
 * Written as the day number Excel itself stores (a `t: "d"` Date goes through the writer's local-time maths and
 * lands as a fraction of a day, a day early west of Greenwich), so the cell is the same on every machine.
 */
function dateCell(iso: string, style: Style): XLSX.CellObject {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return s(iso, style);
  const days = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 + EXCEL_EPOCH_DAYS;
  return { v: days, t: "n", z: "mm-dd-yy", s: style };
}

/** The whole statement as cells, merges and sizes. Rows are 0-based here; Excel shows them +1. */
export function metlifeStatementToWorkbook(statement: MetlifeStatement, header: StatementHeader): XLSX.WorkBook {
  const STYLE = makeStyles();
  const blank = (style: Style): XLSX.CellObject => ({ v: "", t: "s", s: style });
  const rows: Cell[][] = [];
  const heights: number[] = [];
  const merges: XLSX.Range[] = [];
  const push = (cells: Cell[], hpt: number) => {
    rows.push(cells);
    heights.push(hpt);
  };
  const mergeAcross = (r: number, c0: number, c1: number) => merges.push({ s: { r, c: c0 }, e: { r, c: c1 } });
  const mergeBlock = (r0: number, c0: number, r1: number, c1: number) => merges.push({ s: { r: r0, c: c0 }, e: { r: r1, c: c1 } });
  const empties = (count: number, style: Style): Cell[] => Array.from({ length: count }, () => blank(style));

  [header.line1, header.line2, header.line3].forEach((line, i) => {
    push([s(line, STYLE.headerLine), ...empties(LAST_COL, STYLE.headerLine)], HEADER_HEIGHTS[i]);
    mergeAcross(rows.length - 1, 0, LAST_COL);
  });
  push(METLIFE_TITLES.map((t) => s(t, STYLE.title)), TITLE_HEIGHT);

  const subtotalCells: string[] = [];
  for (const c of statement.cases) {
    const first = rows.length;
    c.lines.forEach((line, i) => {
      const lead: Cell[] =
        i === 0
          ? [
              n(c.serial, STYLE.serial),
              s(c.patientName, STYLE.caseCell),
              idCell(c.policyNumber, STYLE.caseCell),
              idCell(c.certificateNumber, STYLE.caseCell),
              idCell(c.dependentCode, STYLE.caseCell),
              s(c.approvalNumber, STYLE.caseCell),
              dateCell(c.date, STYLE.caseCell),
            ]
          : [blank(STYLE.serial), ...empties(LINE_COL - 1, STYLE.caseCell)];
      push([...lead, s(line.text, STYLE.line), n(line.count, STYLE.line), n(line.requested, STYLE.line), n(line.approved, STYLE.line)], ROW_HEIGHT);
    });
    const last = rows.length - 1;
    const subtotalRow = rows.length;
    // The case's details span its service lines only; the subtotal row beneath is its own, bordered, row.
    for (let col = 0; col < LINE_COL; col++) mergeBlock(first, col, last, col);
    push(
      [
        ...empties(LINE_COL, STYLE.gap),
        s(TOTAL_LABEL, STYLE.subtotal),
        blank(STYLE.subtotal),
        blank(STYLE.subtotal),
        f(`SUM(${cellRef(first, LAST_COL)}:${cellRef(last, LAST_COL)})`, c.subtotal, STYLE.subtotal),
      ],
      ROW_HEIGHT,
    );
    subtotalCells.push(cellRef(subtotalRow, LAST_COL));
  }

  const footTop = rows.length;
  const footEnd = footTop + FOOTER_ROWS - 1;
  for (let i = 0; i < FOOTER_ROWS; i++) {
    const total: Cell =
      i > 0
        ? blank(STYLE.footerTotal)
        : subtotalCells.length
          ? f(`SUM(${subtotalCells.join(",")})`, statement.total, STYLE.footerTotal)
          : n(0, STYLE.footerTotal);
    push(
      [i === 0 ? s(TOTAL_LABEL, STYLE.footerLabel) : blank(STYLE.footerLabel), ...empties(5, STYLE.footerLabel), ...empties(4, STYLE.footerFill), total],
      ROW_HEIGHT,
    );
  }
  mergeBlock(footTop, 0, footEnd, 5);
  mergeBlock(footTop, LAST_COL, footEnd, LAST_COL);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = COL_WIDTHS.map((wch) => ({ wch }));
  ws["!rows"] = heights.map((hpt) => ({ hpt }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET);
  wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}
