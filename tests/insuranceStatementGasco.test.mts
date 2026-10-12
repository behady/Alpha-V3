// A contract company's monthly statement (GASCO's sheet layout), from the Finance → company tab.
//
// The real sheet stays outside the repo (it holds real patient names); these patients are invented.
// What matters: each visit is one block with its serial and name merged down to its own الاجمالي,
// a counted line carries `2X880` beside the matching formula, the subtotal and the grand total are
// real SUMs over the right cells, and the file opens right-to-left.
//
//   npm run test:insurance-statement-gasco

import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { buildInsuranceStatement, type StatementRowLite } from "../src/lib/insuranceStatement";
import { gascoFileName, gascoStatementToWorkbook, lineWorking } from "../src/lib/insuranceStatementGascoXlsx";

// --- 1. The working beside a counted line ----------------------------------------------------------
assert.deepEqual(lineWorking(1760, 2), { text: "2X880", formula: "2*880" });
assert.deepEqual(lineWorking(264, 4), { text: "4X66", formula: "4*66" });
assert.equal(lineWorking(880, 1), null);          // one unit: the value alone
assert.equal(lineWorking(1000, 3), null);         // does not multiply out (a discount): the value alone
assert.equal(lineWorking(0, 2), null);

// --- 2. The statement --------------------------------------------------------------------------------
const rows: StatementRowLite[] = [
  { id: "a1", type: "procedure", payerId: "gasco", patientId: "p1", patientName: "سلمى عادل", date: "2026-08-03", appointmentId: "v1", serviceName: "كشف", description: "كشف 132*1=132 | (T: Gen)", amount: 132 },
  { id: "a2", type: "procedure", payerId: "gasco", patientId: "p1", patientName: "سلمى عادل", date: "2026-08-03", appointmentId: "v1", serviceName: "حشو كمبوزيت", description: "حشو كمبوزيت (T: 15,16) | 880*2=1760", unitsCount: 2, pricingMode: "per_tooth", amount: 1760 },
  { id: "b1", type: "procedure", payerId: "gasco", patientId: "p2", patientName: "مروان فتحي", date: "2026-08-10", serviceName: "خلع ضرس", description: "خلع ضرس (T: 26) | 924*1=924", amount: 924 },
  // Another company, another month, a deleted row: none of them on the sheet.
  { id: "x1", type: "procedure", payerId: "other", patientId: "p3", patientName: "غير", date: "2026-08-10", serviceName: "كشف", amount: 132 },
  { id: "x2", type: "procedure", payerId: "gasco", patientId: "p3", patientName: "غير", date: "2026-09-01", serviceName: "كشف", amount: 132 },
  { id: "x3", type: "procedure", payerId: "gasco", patientId: "p3", patientName: "غير", date: "2026-08-12", serviceName: "كشف", amount: 132, status: "deleted" },
];
const statement = buildInsuranceStatement({
  rows,
  payerId: "gasco",
  payerName: "Gasco",
  month: "2026-08",
  range: { start: "2026-08-01", end: "2026-08-31" },
  memberNumbers: new Map(),
});
assert.equal(statement.cases.length, 2);
assert.equal(statement.total, 2816);

const header = { line1: "عيادة تجربة\nد. اسم الطبيب", line2: "عنوان تجربة", line3: "0100000000" };
const wb = gascoStatementToWorkbook(statement, header, new Map([["a2", 2]]));
const ws = wb.Sheets.Sheet1;
const v = (ref: string) => ws[ref]?.v;

// Header across A:E, then the titles in the sample's spelling.
assert.equal(v("A1"), header.line1);
assert.equal(v("A3"), header.line3);
assert.deepEqual(["A4", "B4", "C4", "E4"].map(v), ["المسلسل", "اسم الحاله", "بيان الخدمه", "قيمه الخدمه"]);

// Visit 1: rows 5–7 (two lines + total).
assert.equal(v("A5"), 1);
assert.equal(v("B5"), "سلمى عادل");
assert.equal(v("C5"), "كشف");
assert.equal(v("E5"), 132);
assert.equal(v("C6"), "2حشو كمبوزيت رقم 5-6");
assert.equal(v("D6"), "2X880");
assert.equal(ws.E6.f, "2*880");
assert.equal(v("E6"), 1760);
assert.equal(v("C7"), "الاجمالي");
assert.equal(ws.E7.f, "SUM(E5:E6)");
assert.equal(v("E7"), 1892);

// Visit 2: rows 8–9.
assert.equal(v("A8"), 2);
assert.equal(v("D8"), "");                       // one unit: no working
assert.equal(ws.E9.f, "SUM(E8:E8)");

// Footer: the grand total over the subtotals only, five rows tall.
assert.equal(v("A10"), "الاجمالي");
assert.equal(ws.E10.f, "SUM(E7,E9)");
assert.equal(v("E10"), 2816);

const merges = (ws["!merges"] ?? []).map((m) => XLSX.utils.encode_range(m));
for (const m of ["A1:E1", "A2:E2", "A3:E3", "A5:A7", "B5:B7", "A8:A9", "B8:B9", "A10:D14", "E10:E14"]) {
  assert.ok(merges.includes(m), `merge ${m}`);
}

// Survives a write and a read, right-to-left, with the fills and Arial bold.
const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellStyles: true });
assert.equal(back.Workbook?.Views?.[0]?.RTL, true);
assert.equal(back.Sheets.Sheet1.E10.f, "SUM(E7,E9)");
assert.equal((back.Sheets.Sheet1.A4.s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb, "D99694");
assert.ok(String(ws.A1.s?.fill?.fgColor?.rgb).endsWith("F2DCDB")); // the writer prefixes the alpha in place
assert.equal(ws.C5.s?.font?.name, "Arial");
assert.equal(ws.C5.s?.font?.bold, true);

// An empty month still writes a sheet with a zero total.
const empty = buildInsuranceStatement({ rows: [], payerId: "gasco", payerName: "Gasco", month: "2026-08", memberNumbers: new Map() });
assert.equal(gascoStatementToWorkbook(empty, header, new Map()).Sheets.Sheet1.E5.v, 0);

// --- 3. File name --------------------------------------------------------------------------------
assert.equal(gascoFileName("Gasco", "2026-08-01", "2026-08-31"), "gasco-2026-08.xlsx");
assert.equal(gascoFileName("Gasco", "2026-02-01", "2026-02-28"), "gasco-2026-02.xlsx");
assert.equal(gascoFileName("Gasco", "2026-10-12", "2026-10-12"), "gasco-2026-10-12.xlsx");
assert.equal(gascoFileName("جاسكو", "2026-08-01", "2026-08-15"), "company-2026-08-01_2026-08-15.xlsx");

console.log("insurance statement (gasco layout): all assertions passed");
