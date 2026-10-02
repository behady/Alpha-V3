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
