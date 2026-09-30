// The Excel backup a clinic Owner/Admin downloads from Settings → System → Backup.
//
// Not the migration importer (tests/backupImport.test.mts): that restores a v2 file into v3. This
// is the human-readable export — twelve sheets, bilingual headers, real numbers in money columns.
// The builder is pure (src/lib/backup/buildClinicWorkbook.ts) so it is tested here with fixtures
// and no emulator; the loader and the route are checked by the About-sheet counts and by source
// assertions, the repo's pattern for routes.
//
//   npm run test:excel-backup

import assert from "node:assert/strict";
import { BACKUP_TEXT, bi } from "../src/lib/backup/backupText";

// --- 1. Every label has both languages ---------------------------------------------------------
for (const [key, v] of Object.entries(BACKUP_TEXT)) {
  assert.ok(v.en.trim() && v.ar.trim(), `${key} is missing a language`);
  assert.ok(/[؀-ۿ]/.test(v.ar), `${key}.ar is not Arabic`);
  // Headers and sheet names are split on " - " by nothing, but a reader might; keep them clean.
  if (/^(sheet|col)_/.test(key)) assert.ok(!v.en.includes(" - "), `${key}.en contains the bilingual separator`);
}
assert.equal(bi("sheet_patients"), "Patients - المرضى");
assert.equal(bi("type_expense"), "Expense - مصروف");
console.log("clinicBackup: text table ok");

// --- 2. The workbook: About, Patients, Appointments, Ledger, Expenses ----------------------------
import * as XLSX from "xlsx";
import { fixture, TODAY } from "./fixtures/clinicBackup.fixture";
import { buildClinicWorkbook, workbookToBuffer } from "../src/lib/backup/buildClinicWorkbook";
import type { BackupTextKey } from "../src/lib/backup/backupText";

type Row = unknown[];
const rows = (wb: XLSX.WorkBook, name: string): Row[] => {
  const ws = wb.Sheets[name];
  assert.ok(ws, `sheet "${name}" is missing`);
  // defval keeps empty cells as "" so a missing value is visible as "", not undefined.
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: "", blankrows: false });
};
const colIndex = (table: Row[], key: BackupTextKey): number => {
  const i = (table[0] as string[]).indexOf(bi(key));
  assert.ok(i >= 0, `header ${bi(key)} not found in ${JSON.stringify(table[0])}`);
  return i;
};
const find = (table: Row[], key: BackupTextKey, value: unknown): Row => {
  const i = colIndex(table, key);
  const row = table.find((r, n) => n > 0 && r[i] === value);
  assert.ok(row, `no row with ${bi(key)} = ${String(value)}`);
  return row;
};

const wb = buildClinicWorkbook(fixture, { language: "ar", today: TODAY });

assert.deepEqual(wb.SheetNames.slice(0, 5), [
  "About - نبذة", "Patients - المرضى", "Appointments - المواعيد", "Ledger - السجل المالي", "Expenses - المصروفات",
]);

// Patients: bilingual header, balances as the Reports Center computes them, every patient present.
const patients = rows(wb, "Patients - المرضى");
assert.equal(patients[0][1], "Name - الاسم");
assert.equal(patients.length - 1, fixture.patients.length);
const amira = find(patients, "col_patients_name", "أميرة سعيد");
assert.equal(amira[colIndex(patients, "col_patients_charged")], 3000);
assert.equal(amira[colIndex(patients, "col_patients_paid")], 1350);   // 1000 + the placeholder-zero 350; the deleted 500 is not counted
assert.equal(amira[colIndex(patients, "col_patients_owed")], 1650);
assert.equal(amira[colIndex(patients, "col_patients_visits")], 2);    // 09-10 and 09-15; the deleted 09-16 row is not a visit
assert.equal(amira[colIndex(patients, "col_patients_first_visit")], "2026-09-10");
const empty = find(patients, "col_patients_name", "No Rows");
assert.equal(empty[colIndex(patients, "col_patients_visits")], 0);
assert.equal(empty[colIndex(patients, "col_patients_charged")], 0);
assert.equal(empty[colIndex(patients, "col_patients_first_visit")], "");
assert.equal(empty[colIndex(patients, "col_patients_gender")], "");
// Sorted by name.
assert.deepEqual(patients.slice(1).map((r) => r[1]), [...fixture.patients.map((p) => p.name)].sort((a, b) => a.localeCompare(b)));

// Ledger: every row, cash split, deleted row present with its status.
const ledger = rows(wb, "Ledger - السجل المالي");
assert.equal(ledger.length - 1, fixture.ledger.length);
const ph = find(ledger, "col_ledger_row_id", "pay-placeholder");
assert.equal(ph[colIndex(ledger, "col_ledger_cash_in")], 350);
assert.equal(ph[colIndex(ledger, "col_ledger_cash_out")], "");
assert.equal(ph[colIndex(ledger, "col_ledger_type")], "Payment - دفعة");
const exp = find(ledger, "col_ledger_row_id", "exp-1");
assert.equal(exp[colIndex(ledger, "col_ledger_cash_out")], 640);
assert.equal(exp[colIndex(ledger, "col_ledger_cash_in")], "");
assert.equal(exp[colIndex(ledger, "col_ledger_type")], "Expense - مصروف");
const del = find(ledger, "col_ledger_row_id", "pay-deleted");
assert.equal(del[colIndex(ledger, "col_ledger_status")], "deleted");
const crown = find(ledger, "col_ledger_row_id", "proc-crown");
assert.equal(crown[colIndex(ledger, "col_ledger_cash_in")], 1350);   // a procedure's cash is what was paid against it
assert.equal(crown[colIndex(ledger, "col_ledger_discount")], 200);
assert.equal(crown[colIndex(ledger, "col_ledger_lab_fee")], 600);
// Oldest first.
const ledgerDates = ledger.slice(1).map((r) => String(r[0]));
assert.deepEqual(ledgerDates, [...ledgerDates].sort());

// Expenses: exactly the expense rows.
const expenses = rows(wb, "Expenses - المصروفات");
assert.equal(expenses.length - 1, 1);
assert.equal(expenses[1][colIndex(expenses, "col_expenses_amount")], 640);
assert.equal(expenses[1][colIndex(expenses, "col_expenses_notes")], "3 boxes");

// Appointments: oldest first; an unknown status is written as-is; a known one is bilingual.
const appts = rows(wb, "Appointments - المواعيد");
assert.equal(appts.length - 1, fixture.appointments.length);
const apptDates = appts.slice(1).map((r) => `${r[0]} ${r[1]}`);
assert.deepEqual(apptDates, [...apptDates].sort());
assert.equal(find(appts, "col_appointments_id", "apt-odd")[colIndex(appts, "col_appointments_status")], "Weird Status");
assert.equal(find(appts, "col_appointments_id", "apt-2")[colIndex(appts, "col_appointments_status")], "Completed - مكتمل");
assert.equal(find(appts, "col_appointments_id", "apt-1")[colIndex(appts, "col_appointments_cost")], "");

// About: the counts match the sheets, and the clinic name is there.
const about = rows(wb, "About - نبذة");
assert.ok(about.some((r) => r[1] === "عيادة ألفا"));
const aboutPatients = about.find((r) => r[0] === "Patients - المرضى");
assert.equal(aboutPatients?.[1], fixture.patients.length);
assert.ok(about.some((r) => String(r[0]).includes("cannot be imported back")));

// RTL follows the language; widths are set.
assert.equal((wb.Sheets["Patients - المرضى"]["!views"] as Array<{ rightToLeft?: boolean }> | undefined)?.[0]?.rightToLeft, true);
assert.equal(buildClinicWorkbook(fixture, { language: "en", today: TODAY }).Sheets["Patients - المرضى"]["!views"], undefined);
assert.ok((wb.Sheets["Patients - المرضى"]["!cols"] ?? []).length > 5);

// No "undefined"/"null"/"NaN" anywhere in any sheet.
for (const name of wb.SheetNames) {
  for (const r of rows(wb, name)) {
    for (const c of r) assert.ok(!["undefined", "null", "NaN"].includes(String(c)), `${name}: ${String(c)}`);
  }
}

// The buffer is a real xlsx (a zip: "PK").
assert.equal(workbookToBuffer(wb).subarray(0, 2).toString(), "PK");
console.log("clinicBackup: core sheets ok");
