// The insurance claim statement: one insurer, one month, in the insurer's own layout.
//
// Built for the first prospect (DENT INN), whose receptionist retypes every month's cases into the
// sheet kept at docs/samples/insurance-statement-nextcare-2026-02.xlsx. The fixture reproduces its
// first three cases; the assertions below are the sample's own numbers, so a wrong line text or a
// moved subtotal is caught against something the insurer has already accepted.
//
// What matters is not crashes but money: a case merged with the next one, a row of another insurer
// counted, a deleted row paid for twice. And the file itself — a merge off by one row prints a name
// against the wrong services.
//
//   npm run test:insurance-statement

import assert from "node:assert/strict";
import {
  buildInsuranceStatement,
  caseLabel,
  insurerToothLabel,
  statementLineText,
} from "../src/lib/insuranceStatement";
import { rows, memberNumbers, EXPECTED_SUBTOTALS } from "./fixtures/insuranceStatement.fixture";

// --- 1. Tooth numbers the way the clinic writes them to the insurer --------------------------------
assert.equal(insurerToothLabel(14), "4");
assert.equal(insurerToothLabel(36), "6");
assert.equal(insurerToothLabel(11), "1");
assert.equal(insurerToothLabel(48), "8");
assert.equal(insurerToothLabel(55), "E");   // primary: quadrant 5–8, position 1–5 → A–E
assert.equal(insurerToothLabel(51), "A");
assert.equal(insurerToothLabel(85), "E");
assert.equal(insurerToothLabel(0), "");
assert.equal(insurerToothLabel(NaN), "");
assert.equal(insurerToothLabel(99), "");    // not a tooth

// --- 2. Line text ------------------------------------------------------------------------------------
assert.equal(statementLineText({ id: "a", serviceName: "حشو كمبوزيت", description: "حشو كمبوزيت (T: 15,16) | 560*2=1120", unitsCount: 2, pricingMode: "per_tooth" }), "2حشو كمبوزيت رقم 5-6");
assert.equal(statementLineText({ id: "b", serviceName: "كشف", description: "كشف (T: Gen) | 30*1=30", unitsCount: 1 }), "كشف");
assert.equal(statementLineText({ id: "c", serviceName: "تنظيف جير", description: "تنظيف جير (T: Gen) | 550", unitsCount: 2, pricingMode: "flat" }), "تنظيف جير");
assert.equal(statementLineText({ id: "d", description: "Scaling + Polish (T: 11) | 100=100" }), "Scaling + Polish رقم 1");
assert.equal(statementLineText({ id: "e", serviceName: "حشو عصب اطفال", description: "حشو عصب اطفال (T: 55) | 1000*1=1000" }), "حشو عصب اطفال رقم E");
assert.equal(statementLineText({ id: "f", description: "" }), "—");   // never an empty cell
assert.equal(statementLineText({ id: "g", serviceName: "  كشف  ", description: "x (T: ) | 1" }), "كشف");

// --- 3. The statement --------------------------------------------------------------------------------
const s = buildInsuranceStatement({ rows, payerId: "nextcare", payerName: "Nextcare", month: "2026-02", memberNumbers });
assert.equal(s.payerName, "Nextcare");
assert.equal(s.month, "2026-02");
assert.deepEqual(s.cases.map((c) => c.serial), [1, 2, 3, 4, 5]);
assert.equal(caseLabel(s.cases[0]), "(A1B2)كريم يوسف سعيد");
assert.deepEqual(s.cases[0].lines.map((l) => [l.text, l.amount]), [["2طربوش زركونيا رقم 4-5", 4800], ["علاج لثه صديديه", 28]]);
assert.deepEqual(s.cases[1].lines.map((l) => l.text), ["كشف", "اشعه عاديه"]);
assert.deepEqual(s.cases[2].lines.map((l) => l.text), ["كشف", "اشعه عاديه", "خلع ضرس عقل مدفون كليا"]);
assert.deepEqual(s.cases.map((c) => c.subtotal), EXPECTED_SUBTOTALS);
assert.equal(s.total, EXPECTED_SUBTOTALS.reduce((a, b) => a + b, 0));
// The same patient twice in a month is two cases, in date order, each with its own serial.
assert.equal(s.cases[3].patientId, s.cases[2].patientId);
assert.ok(s.cases[3].date > s.cases[2].date);
assert.deepEqual(s.cases[3].lines.map((l) => l.text), ["3حشو كمبوزيت رقم 3-4-5"]);
// Rows of another payer, another month or a deleted row are not there and do not move the total.
const allRowIds = s.cases.flatMap((c) => c.lines.map((l) => l.rowId));
for (const left of ["other-payer", "last-month", "deleted"]) assert.ok(!allRowIds.includes(left), left);
// A patient with no member number still appears, name alone, and is listed as missing.
assert.equal(caseLabel(s.cases[4]), "Layla Samir");
assert.deepEqual(s.cases[4].lines.map((l) => l.text), ["Consultation", "تنظيف جير", "حشو عصب اطفال رقم E"]);
assert.deepEqual(s.missingMemberNumber, [{ patientId: "pat-nomember", patientName: "Layla Samir" }]);
assert.equal(caseLabel({ memberNumber: "", patientName: "X" }), "X");
// Rows without an appointment group by patient and day.
assert.equal(s.cases[4].lines.length, 3);
// An empty month is an empty statement, not a crash.
const empty = buildInsuranceStatement({ rows, payerId: "nextcare", payerName: "Nextcare", month: "2025-12", memberNumbers });
assert.deepEqual(empty.cases, []);
assert.equal(empty.total, 0);
console.log("insuranceStatement: model ok");

// --- 4. The workbook, in the insurer's layout ----------------------------------------------------------
import XLSX from "xlsx-js-style";
import { statementFileName, statementToWorkbook } from "../src/lib/insuranceStatementXlsx";

const header = { line1: "DENT INN dental clinic\nد.أحمد رشدي أبو النجا", line2: "برج القاهرة للمبيعات - ميدان السبع عمارات - مصر الجديدة", line3: "01093888153 - 22907666" };
const wb = statementToWorkbook(s, header);
const ws = wb.Sheets.Sheet1;
assert.deepEqual(wb.SheetNames, ["Sheet1"]);
assert.equal(ws.A1.v, header.line1);
assert.equal(ws.A2.v, header.line2);
assert.equal(ws.A3.v, header.line3);
assert.deepEqual([ws.A4.v, ws.B4.v, ws.C4.v, ws.D4.v], ["المسلسل", "اسم الحالة", "بيان الخدمة", "قيمة الخدمة"]);
// Case 1 occupies rows 5-7: two lines and a subtotal with a real SUM.
assert.equal(ws.A5.v, 1);
assert.equal(ws.B5.v, "(A1B2)كريم يوسف سعيد");
assert.equal(ws.C5.v, "2طربوش زركونيا رقم 4-5");
assert.equal(ws.D5.v, 4800);
assert.equal(ws.C6.v, "علاج لثه صديديه");
assert.equal(ws.C7.v, "الاجمالي");
assert.equal(ws.D7.f, "SUM(D5:D6)");
// Case 2 starts right after: rows 8-10.
assert.equal(ws.A8.v, 2);
assert.equal(ws.D10.f, "SUM(D8:D9)");
// Styles: the sample's fonts, fill and borders.
assert.equal(ws.A1.s.font.name, "Arial");
assert.equal(ws.A1.s.font.sz, 36);
assert.equal(ws.A1.s.font.bold, true);
assert.equal(ws.A1.s.border.top.style, "medium");
assert.equal(ws.A1.s.alignment.wrapText, true);
assert.equal(ws.A4.s.fill.fgColor.rgb, "938953");
assert.equal(ws.A4.s.font.sz, 36);
assert.equal(ws.A5.s.fill.fgColor.rgb, "938953");   // the serial cell is shaded
assert.equal(ws.B5.s.fill, undefined);               // the name is not
assert.equal(ws.C5.s.font.sz, 20);
assert.equal(ws.C5.s.border.top.style, "thin");
assert.equal(ws.C7.s.font.sz, 22);
assert.equal(ws.C7.s.fill.fgColor.rgb, "938953");
assert.equal(ws.D7.s.fill.fgColor.rgb, "938953");
// Merges: the header lines across A:D, and A/B over each case's rows.
const merges = (ws["!merges"] as XLSX.Range[]).map((m) => XLSX.utils.encode_range(m));
for (const m of ["A1:D1", "A2:D2", "A3:D3", "A5:A7", "B5:B7", "A8:A10", "B8:B10"]) assert.ok(merges.includes(m), `missing merge ${m}: ${merges.join(" ")}`);
// Footer: four rows, A:C merged with الاجمالي in 36pt, D merged with a SUM of every subtotal.
const last = XLSX.utils.decode_range(ws["!ref"] as string).e.r;
const footTop = last - 3;
assert.ok(merges.includes(XLSX.utils.encode_range({ s: { r: footTop, c: 0 }, e: { r: last, c: 2 } })), "footer A:C merge");
assert.ok(merges.includes(XLSX.utils.encode_range({ s: { r: footTop, c: 3 }, e: { r: last, c: 3 } })), "footer D merge");
const footLabel = ws[XLSX.utils.encode_cell({ r: footTop, c: 0 })];
assert.equal(footLabel.v, "الاجمالي");
assert.equal(footLabel.s.font.sz, 36);
const totalCell = ws[XLSX.utils.encode_cell({ r: footTop, c: 3 })];
assert.equal(totalCell.f, "SUM(D7,D10,D14,D16,D20)");
// Widths and heights from the sample; RTL at workbook level (the only place the writer honours).
assert.deepEqual((ws["!cols"] as XLSX.ColInfo[]).map((c) => c.wch), [19.1, 45, 63.9, 44.3]);
assert.deepEqual((ws["!rows"] as XLSX.RowInfo[]).slice(0, 3).map((r) => r.hpt), [90, 45.8, 35.2]);
assert.equal(wb.Workbook?.Views?.[0]?.RTL, true);
// And all of it survives being written: read the bytes back.
const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
assert.equal(back.Workbook?.Views?.[0]?.RTL, true);
assert.equal(back.Sheets.Sheet1.D7.f, "SUM(D5:D6)");
assert.equal(back.Sheets.Sheet1.B5.v, "(A1B2)كريم يوسف سعيد");
assert.equal((back.Sheets.Sheet1["!merges"] as XLSX.Range[]).length, merges.length);
assert.equal(statementFileName(s), "statement-nextcare-2026-02.xlsx");
// An empty statement still writes a valid sheet: header, column titles, a footer totalling nothing.
const emptyWs = statementToWorkbook(empty, header).Sheets.Sheet1;
assert.equal(emptyWs.A4.v, "المسلسل");
assert.equal(emptyWs.A5.v, "الاجمالي");
assert.equal(emptyWs.D5.v, 0);
console.log("insuranceStatement: workbook ok");

// --- 5. The member number on the patient record ----------------------------------------------------------
import { readMemberNumbers, writeInsurance } from "../src/lib/patientInsurance";

assert.deepEqual(readMemberNumbers({ insurance: { nextcare: { memberNumber: " A1B2 " }, axa: {}, bad: "x" } }), { nextcare: "A1B2" });
assert.deepEqual(readMemberNumbers({}), {});
assert.deepEqual(readMemberNumbers({ insurance: null }), {});
assert.deepEqual(writeInsurance({ nextcare: " A1B2 ", axa: "   ", "Not A Payer": "1" }), { nextcare: { memberNumber: "A1B2" } });
assert.deepEqual(writeInsurance({}), {});
console.log("insuranceStatement: patient member numbers ok");
