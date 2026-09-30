# Excel Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Owner/Admin presses one button in Settings and downloads a readable, bilingual `.xlsx` of the whole clinic: patients with balances, appointments, ledger, expenses, lab orders/payments/balances, staff, prices, attendance and payroll.

**Architecture:** A pure workbook builder (`ClinicBackupData → XLSX.WorkBook`, tested with fixtures) fed by an Admin-SDK loader that pages through every clinic collection, served by one admin-only API route, and triggered from a new Settings section. No new formulas: balances come from `rollupPatients`, cash from `ledgerCashValue`, lab balances from `labAccounts`, payroll from `buildHrSection`.

**Tech Stack:** Next.js App Router route (`runtime = "nodejs"`), firebase-admin, `xlsx` 0.18.5 (already a dependency), tsx tests with `node:assert/strict`.

**Spec:** `docs/plans/2026-09-30-excel-backup-design.md` — read it first; the sheet/column lists there are the contract.

## Global Constraints

- Web app only. No Android work (owner decision 2026-09-30).
- Headers and enum cells are bilingual, written as `English - العربية` (space, hyphen, space). Sheet names use the same separator (a `/` is illegal in a sheet name).
- Missing values are empty cells. Never write the strings `undefined`, `null` or `NaN`.
- Money and counts are numbers; dates and times stay the stored strings (`yyyy-mm-dd`, `HH:mm`).
- The builder (`src/lib/backup/buildClinicWorkbook.ts`) and text table must not import Firebase or React.
- The repo stores CRLF line endings; new files must be CRLF too (`git config core.autocrlf` handles it on this machine; check `git diff --stat` shows only your lines).
- Tests are `npx tsx tests/<name>.test.mts` scripts using `node:assert/strict`, one npm script each. There is no vitest/jest.
- Route auth: `requireAdminUser(request, clinicId, { allowInactive: true })`; the `allowInactive` list in `tests/permissions.test.mts` must be updated.
- Commit after each task; push to `origin live` when the whole plan is verified (memory: always push when done; stage only this feature's files, another session edits this checkout).

## Review Focus

1. A ledger `payment` row storing `amount: 0, paid: 350` (the inline side-panel shape) must count 350 in Cash in and in the patient's paid total. Test in Task 2.
2. A ledger row with `status: "deleted"` must still appear on the Ledger sheet (with Status filled) but must not move a patient's balance. Test in Task 2.
3. A patient document with fields missing (`gender`, `dateOfBirth`, `medicalHistory` absent) must produce empty cells, not `undefined`. Test in Task 2.
4. A clinic with more than 1000 documents in one collection must export all of them — the loader pages; no `limit()` cap. Manual check in Task 5 against the owner's clinic and a synthetic count assertion in the About sheet.
5. A price list that is inactive must still get a column (old rows priced from it). Test in Task 3.

---

### Task 1: Types and the bilingual text table

**Files:**
- Create: `src/lib/backup/types.ts`
- Create: `src/lib/backup/backupText.ts`
- Create: `tests/clinicBackup.test.mts`
- Modify: `package.json` (scripts: add `"test:excel-backup": "npx tsx tests/clinicBackup.test.mts"` next to `test:backup`, with a `_comment_test_excel_backup` line saying it is the human-readable Excel export, not the migration importer)

**Interfaces:**
- Produces `ClinicBackupData` (in `types.ts`):
  ```ts
  export type BackupPatient = { id: string; fileId: string; name: string; phone: string; gender: string; dateOfBirth: string; address: string; branchName: string; source: string; medicalHistory: string; allergies: string; status: string; createdAt: string /* yyyy-mm-dd or "" */ };
  export type BackupAppointment = { id: string; date: string; time: string; patientId: string; patientName: string; patientPhone: string; doctor: string; treatment: string; status: string; duration: number; branchName: string; roomName: string; source: string; cost: number | null; notes: string };
  export type BackupLedgerRow = LedgerRow & { payerName: string; status: string; notes: string };   // LedgerRow from src/lib/automation/briefing/data.ts
  export type BackupStaff = StaffRecord & { email: string; phone: string; active: boolean; isDentist: boolean };  // StaffRecord from the same file
  export type BackupService = { id: string; name: string; category: string; pricingMode: string; requiresLab: boolean; estimatedLabFee: number | null; price: number | null; prices: Record<string, number> };
  export type ClinicBackupData = {
    clinic: { id: string; name: string; timeZone: string };
    generatedAt: string;          // ISO
    generatedBy: string;          // display name
    patients: BackupPatient[];
    appointments: BackupAppointment[];
    ledger: BackupLedgerRow[];
    labCases: LabCase[];          // src/lib/labCases
    labPayments: LabPayment[];    // src/lib/labAccounts
    labs: Array<{ id: string; name: string }>;
    staff: BackupStaff[];
    services: BackupService[];
    priceLists: PriceList[];      // src/lib/priceLists
    punches: PunchRecord[];       // src/lib/automation/briefing/data
  };
  ```
- Produces `BACKUP_TEXT` (in `backupText.ts`): `Record<string, { en: string; ar: string }>` keyed by a stable id for every sheet name, every column header, the About-sheet sentences, the four ledger types (`type_procedure`, `type_payment`, `type_income`, `type_expense`), `yes`, `no`. Plus `export function bi(key: string): string` returning `"${en} - ${ar}"`, and `export function biRaw(en: string, ar: string): string`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test** in `tests/clinicBackup.test.mts`:

```ts
import assert from "node:assert/strict";
import { BACKUP_TEXT, bi } from "../src/lib/backup/backupText";

// Every label has both languages, non-blank, and no stray separator that would break "en - ar".
for (const [key, v] of Object.entries(BACKUP_TEXT)) {
  assert.ok(v.en.trim() && v.ar.trim(), `${key} is missing a language`);
  assert.ok(/[؀-ۿ]/.test(v.ar), `${key}.ar is not Arabic`);
}
assert.equal(bi("sheet_patients"), "Patients - المرضى");
assert.equal(bi("type_expense"), "Expense - مصروف");
console.log("clinicBackup: text table ok");
```

- [ ] **Step 2: Run it, expect failure** — `npm run test:excel-backup` → "Cannot find module".
- [ ] **Step 3: Create `types.ts` and `backupText.ts`** with every key the spec's twelve sheets need (sheet names `sheet_about` … `sheet_payroll`; one key per column named `col_<sheet>_<field>`; the About sentences `about_cash`, `about_charged`, `about_balance`, `about_expenses_note`, `about_not_restore`, `about_generated_at`, `about_generated_by`, `about_rows`). Arabic must be real clinic Arabic, not transliteration; copy existing terms from `settingsText.ts` and `appointmentStages.ts` where they exist (e.g. "السجل المالي", "المعامل").
- [ ] **Step 4: Run it, expect pass.**
- [ ] **Step 5: Commit** — `git add src/lib/backup tests/clinicBackup.test.mts package.json && git commit -m "Excel backup: data types and bilingual labels"`

---

### Task 2: Workbook builder — About, Patients, Appointments, Ledger, Expenses

**Files:**
- Create: `src/lib/backup/buildClinicWorkbook.ts`
- Create: `tests/fixtures/clinicBackup.fixture.ts` (a small `ClinicBackupData` with 3 patients, 4 appointments, 6 ledger rows covering: paid procedure, unpaid procedure, placeholder-zero payment, income, expense, and a `status: "deleted"` payment; one patient with no rows at all)
- Modify: `tests/clinicBackup.test.mts`

**Interfaces:**
- Produces: `export function buildClinicWorkbook(data: ClinicBackupData, opts: { language: "en" | "ar" }): XLSX.WorkBook` and `export function workbookToBuffer(wb: XLSX.WorkBook): Buffer` (`XLSX.write(wb, { type: "buffer", bookType: "xlsx" })`).
- Internal helpers (same file, exported for tests): `activeLedgerRows(rows)` (drops `status` in `{deleted, cancelled}`), `patientBalances(data)` returning `Map<patientId, PatientRollup>` via `rollupPatients` from `src/lib/reportPatients.ts` (procedures = active rows with `type === "procedure"`, payments = active rows with type in `{payment, income}`), `ledgerCashValue` from `src/lib/reportHelpers.ts`.
- Consumes: Task 1 types and `bi()`.

- [ ] **Step 1: Write failing tests** (append to `tests/clinicBackup.test.mts`; read sheets back with `XLSX.utils.sheet_to_json(ws, { header: 1 })`):

```ts
const wb = buildClinicWorkbook(fixture, { language: "ar" });
assert.deepEqual(wb.SheetNames.slice(0, 5), ["About - نبذة", "Patients - المرضى", "Appointments - المواعيد", "Ledger - السجل المالي", "Expenses - المصروفات"]);
// bilingual header
const patients = rows(wb, "Patients - المرضى");
assert.equal(patients[0][1], "Name - الاسم");
// balances agree with rollupPatients, computed on active rows only
const amira = patients.find(r => r[1] === "أميرة سعيد")!;
assert.equal(amira[colIndex(patients, "col_patients_charged")], 3000);
assert.equal(amira[colIndex(patients, "col_patients_paid")], 1350);   // 1000 + 350 placeholder-zero row; the deleted 500 is NOT counted
assert.equal(amira[colIndex(patients, "col_patients_owed")], 1650);
// a patient with no rows appears with zeros and blank dates
const empty = patients.find(r => r[1] === "No Rows")!;
assert.equal(empty[colIndex(patients, "col_patients_visits")], 0);
assert.equal(empty[colIndex(patients, "col_patients_first_visit")], "");
// missing fields are empty cells
assert.equal(empty[colIndex(patients, "col_patients_gender")], "");
// ledger: placeholder-zero payment is cash in; expense is cash out; deleted row still present with status
const ledger = rows(wb, "Ledger - السجل المالي");
assert.equal(ledger.length - 1, fixture.ledger.length);
const ph = ledger.find(r => r[colIndex(ledger, "col_ledger_row_id")] === "pay-placeholder")!;
assert.equal(ph[colIndex(ledger, "col_ledger_cash_in")], 350);
assert.equal(ph[colIndex(ledger, "col_ledger_cash_out")], "");
const exp = ledger.find(r => r[colIndex(ledger, "col_ledger_row_id")] === "exp-1")!;
assert.equal(exp[colIndex(ledger, "col_ledger_cash_out")], 640);
assert.equal(exp[colIndex(ledger, "col_ledger_type")], "Expense - مصروف");
const del = ledger.find(r => r[colIndex(ledger, "col_ledger_row_id")] === "pay-deleted")!;
assert.equal(del[colIndex(ledger, "col_ledger_status")], "deleted");
// expenses sheet has exactly the expense rows
assert.equal(rows(wb, "Expenses - المصروفات").length - 1, 1);
// appointments: unknown status written as-is, sorted oldest first
const appts = rows(wb, "Appointments - المواعيد");
assert.ok(appts[1][0] <= appts[2][0]);
assert.equal(appts.find(r => r[colIndex(appts, "col_appointments_id")] === "apt-odd")![colIndex(appts, "col_appointments_status")], "Weird Status");
// RTL follows language; frozen header; widths set
assert.equal(wb.Sheets["Patients - المرضى"]["!views"]?.[0]?.rightToLeft, true);
assert.equal(buildClinicWorkbook(fixture, { language: "en" }).Sheets["Patients - المرضى"]["!views"], undefined);
assert.ok(wb.Sheets["Patients - المرضى"]["!cols"]!.length > 5);
// no "undefined"/"null"/"NaN" anywhere
for (const name of wb.SheetNames) for (const r of rows(wb, name)) for (const c of r) assert.ok(!["undefined","null","NaN"].includes(String(c)), `${name}: ${c}`);
// buffer is a real xlsx (PK zip header)
assert.equal(workbookToBuffer(wb).subarray(0, 2).toString(), "PK");
```
`rows(wb, name)` and `colIndex(rows, textKey)` (finds the header equal to `bi(textKey)`) are tiny test helpers in the test file.

- [ ] **Step 2: Run, expect failure** (`buildClinicWorkbook` not found).
- [ ] **Step 3: Implement** the five sheets per the spec column lists. Use `XLSX.utils.aoa_to_sheet`. The community `xlsx` 0.18.5 writer ignores cell styles and frozen panes, so do not spend time on bold or freeze; readability comes from `!cols` widths (longest of header and first 200 values, capped at 60) and the header text. Set `ws["!views"] = [{ rightToLeft: true }]` only when `language === "ar"` (the existing `reportExcelUtils.ts` does the same). Dates: use the row's stored string. About sheet: clinic name, generated at formatted in `data.clinic.timeZone`, generated by, then one row per sheet `[sheetName, rowCount]`, then the sentences. Patient "Registered on" = `createdAt`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `git commit -m "Excel backup: builder for About, Patients, Appointments, Ledger, Expenses"`

---

### Task 3: Workbook builder — Lab orders, Lab payments, Labs, Staff, Prices

**Files:**
- Modify: `src/lib/backup/buildClinicWorkbook.ts`
- Modify: `tests/fixtures/clinicBackup.fixture.ts` (2 labs, 3 lab cases incl. one `remakeOfCode`, 2 lab payments, 2 staff with `attendanceSchedule` and one without, 3 services, 2 price lists one `active: false`)
- Modify: `tests/clinicBackup.test.mts`

**Interfaces:**
- Consumes: `labAccounts(labs, cases, payments)` from `src/lib/labAccounts.ts`; `statusLabel(id, language)`, `workTypeLabel(id, language)` from `src/lib/labCases.ts` (call each twice and join with ` - ` for the bilingual cell); `LAB_PAYMENT_METHODS` for method labels; `formatStaffRoleLabel` from `src/lib/staffRoles.ts` if it takes `(member, isAr)` — read the file; otherwise write the raw role.
- Produces: sheets 6–10 in spec order.

- [ ] **Step 1: Write failing tests:**

```ts
assert.deepEqual(wb.SheetNames.slice(5, 10), ["Lab orders - طلبات المعمل", "Lab payments - مدفوعات المعامل", "Labs - المعامل", "Staff - الفريق", "Prices - الأسعار"]);
const labs = rows(wb, "Labs - المعامل");
const madina = labs.find(r => r[0] === "Madina Lab")!;
assert.equal(madina[colIndex(labs, "col_labs_balance")], labAccounts(fixture.labs, fixture.labCases, fixture.labPayments)[0].outstanding);
const orders = rows(wb, "Lab orders - طلبات المعمل");
assert.equal(orders.find(r => r[0] === "MAD-0003")![colIndex(orders, "col_laborders_remake_of")], "MAD-0001");
assert.equal(orders[1][colIndex(orders, "col_laborders_teeth")], "14, 15");
const staff = rows(wb, "Staff - الفريق");
assert.equal(staff[1][colIndex(staff, "col_staff_working_days")], "Sun 10:00-18:00; Mon 10:00-18:00");
assert.equal(staff[2][colIndex(staff, "col_staff_working_days")], "");
assert.equal(staff[1][colIndex(staff, "col_staff_base_salary")], 8000);
const prices = rows(wb, "Prices - الأسعار");
assert.ok(prices[0].includes("Standard"));
assert.ok(prices[0].includes("AXA (inactive)"));
const crown = prices.find(r => r[0] === "Crown")!;
assert.equal(crown[prices[0].indexOf("AXA (inactive)")], 2500);
assert.equal(crown[prices[0].indexOf("Standard")], "");   // no override → blank, base price column holds 3000
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement** the five sheets. Working-days string: iterate keys 0–6 of `schedule`, `active` only, weekday short names Sun..Sat. Price-list column header = `list.nameAr ? \`${list.name} - ${list.nameAr}\` : list.name`, plus ` (inactive)` when `!active`. Lab balances via `labAccounts`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `git commit -m "Excel backup: lab, staff and price sheets"`

---

### Task 4: Workbook builder — Attendance and Payroll

**Files:**
- Modify: `src/lib/backup/buildClinicWorkbook.ts`
- Modify: `tests/fixtures/clinicBackup.fixture.ts` (punches across two months for two staff)
- Modify: `tests/clinicBackup.test.mts`

**Interfaces:**
- Consumes: `buildHrSection` from `src/lib/automation/briefing/hr.ts` with the exact signature shown in the spec (`staff, punches, startDate, endDate, today, nowMinutes, timeZone, geofenceRadiusM, monthStart`). `geofenceRadiusM` is irrelevant to pay; pass `0`. `today` = `ymdInTimeZone(timeZone)` computed once by the builder's caller and passed in `opts.today` (add `today: string` to the builder options so tests are deterministic). `nowMinutes` = `24 * 60` so no open shift is judged "active now".
- Produces: sheets 11–12. Export `export function payrollMonths(punches: PunchRecord[], today: string): Array<{ month: string; start: string; end: string }>` (months = distinct `date.slice(0,7)` in punches, sorted; `end` = last day of that month, or `today` when the month is today's month).

- [ ] **Step 1: Write failing tests:**

```ts
assert.deepEqual(wb.SheetNames.slice(10), ["Attendance - الحضور", "Payroll - الرواتب"]);
assert.deepEqual(payrollMonths(fixture.punches, "2026-09-30").map(m => m.month), ["2026-08", "2026-09"]);
assert.equal(payrollMonths(fixture.punches, "2026-09-30")[1].end, "2026-09-30");   // current month ends today
assert.equal(payrollMonths(fixture.punches, "2026-09-30")[0].end, "2026-08-31");
const att = rows(wb, "Attendance - الحضور");
assert.equal(att.length - 1, fixture.punches.length);
assert.equal(att[1][colIndex(att, "col_attendance_check_in")], "09:05");   // clinic-zone HH:mm
const pay = rows(wb, "Payroll - الرواتب");
const expected = buildHrSection({ staff: fixture.staff, punches: fixture.punches.filter(p => p.date.startsWith("2026-09")), startDate: "2026-09-01", endDate: "2026-09-30", today: "2026-09-30", nowMinutes: 1440, timeZone: "Africa/Cairo", geofenceRadiusM: 0, monthStart: "2026-09-01" }).section.staff[0];
const sep = pay.find(r => r[0] === "2026-09" && r[1] === expected.name)!;
assert.equal(sep[colIndex(pay, "col_payroll_estimated_pay")], expected.estimatedPay);
assert.equal(sep[colIndex(pay, "col_payroll_hours")], Math.round(expected.minutesWorked / 60 * 100) / 100);
```

- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement.** Attendance times via `Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })`. Payroll: one `buildHrSection` call per month from `payrollMonths`, one row per staff row returned; hours = minutes/60 rounded to 2 dp.
- [ ] **Step 4: Run, expect pass.** Also `npm run test:briefing` still passes (nothing there changed yet, sanity).
- [ ] **Step 5: Commit** — `git commit -m "Excel backup: attendance and payroll sheets"`

---

### Task 5: Loader — every clinic collection, paged, into `ClinicBackupData`

**Files:**
- Modify: `src/lib/automation/briefing/data.ts` — export `mapAppointment`, `mapLedger`, and extract the inline staff and punch normalisers into `export function mapStaff(id, d): StaffRecord` and `export function mapPunch(id, d): PunchRecord` (behaviour unchanged; `loadBriefingData` calls them).
- Create: `src/lib/backup/loadClinicBackupData.ts`

**Interfaces:**
- Produces: `export async function loadClinicBackupData(args: { clinicId: string; generatedBy: string }): Promise<ClinicBackupData>` and `export async function readAllDocs(ref: CollectionReference, pageSize = 1000): Promise<Array<{ id: string; data: Record<string, unknown> }>>` (orders by `FieldPath.documentId()`, `startAfter(lastDoc)`, loops until a short page).
- Consumes: `adminClinicCollection`, `adminClinicDoc` from `src/lib/adminClinicDb.ts`; `getClinicProfileAdmin` from `src/lib/clinicProfileServer.ts` (name); `clinicTimeZone()` from `src/lib/clinicDate.ts`; `parsePriceLists` (`settings/price_lists`), `parseDentalLabs` (`settings/labs`, `LABS_SETTINGS_DOC`); `LAB_CASES_COLLECTION`, `LAB_PAYMENTS_COLLECTION`.

- [ ] **Step 1: Refactor `data.ts`** (export the four mappers), run `npm run test:briefing` → passes unchanged. Commit: `"Briefing loader: export the row mappers for reuse"`.
- [ ] **Step 2: Write `readAllDocs` and `loadClinicBackupData`.** Collections: `patients`, `appointments`, `ledger`, `lab_cases`, `lab_payments`, `staff`, `services`, `attendance` (keep only docs with non-empty `userId`, as the briefing loader does). Patient mapping per `BackupPatient` (`source` falls back to `referral`; `createdAt` Timestamp → `yyyy-mm-dd` via `toDate` then `ymdInTimeZone`). Appointment mapping = `mapAppointment` plus the extra fields. Ledger = `mapLedger` plus `payerName`, `status`, `notes`. Staff = `mapStaff` plus `email`, `phone`, `active` (`d.active !== false`), `isDentist`. Read the collections with `Promise.all`; `readAllDocs` itself is sequential per collection.
- [ ] **Step 3: Verify by script, not by test** (needs credentials): `npx tsx -e "..."` is not wired; instead do it through the route in Task 6. Note in the commit that this file has no unit test; the About-sheet counts are the check.
- [ ] **Step 4: Commit** — `git commit -m "Excel backup: paged loader for every clinic collection"`

---

### Task 6: The API route

**Files:**
- Create: `src/app/api/records/backup/route.ts`
- Modify: `tests/permissions.test.mts` — add `"src/app/api/records/backup/route.ts"` to the `allowInactive` list (around line 574) with the comment: *a lapsed clinic must still be able to take its own data out*.
- Modify: `tests/clinicBackup.test.mts` — source-text assertions on the route (the repo's pattern for routes).

**Interfaces:**
- `GET /api/records/backup?clinicId=<id>&lang=en|ar`. Response 200: xlsx bytes with headers from the spec. 401/403 from `requireAdminUser`. 500 `{ ok:false, error }`.
- Consumes: `requireAdminUser` (`src/lib/apiStaffAuth.ts`), `resolveUserClinicId`, `loadClinicBackupData`, `buildClinicWorkbook`, `workbookToBuffer`, `logActivityServer` (`src/lib/server/systemLog.ts`, `action: "backup.download"`, `module: "finance"` or whatever `LogModule` value fits — read the union), `reportServerError`.

- [ ] **Step 1: Write failing source assertions:**

```ts
const route = readFileSync("src/app/api/records/backup/route.ts", "utf8");
assert.ok(route.includes("requireAdminUser("));
assert.ok(route.includes("allowInactive: true"));
assert.ok(route.includes('export const maxDuration = 300'));
assert.ok(route.includes('export const runtime = "nodejs"'));
assert.ok(route.includes("Content-Disposition"));
assert.ok(route.includes("logActivityServer("));
assert.ok(!route.includes(".limit("));
```

- [ ] **Step 2: Run** `npm run test:excel-backup` → fails (file missing); `npm run test:permissions` → fails on the unlisted `allowInactive` route once the route exists.
- [ ] **Step 3: Implement the route.** Filename `alpha-backup-${ymdInTimeZone(tz)}.xlsx`. Return `new Response(buffer, { status: 200, headers })`. `lang` defaults to `en`. `today` for the builder = `ymdInTimeZone(clinicTimeZone())`.
- [ ] **Step 4: Run** `npm run test:excel-backup` and `npm run test:permissions` → both pass.
- [ ] **Step 5: Smoke it locally:** `npm run dev`, then in the browser console on a logged-in admin tab:
  ```js
  const t = await firebase.auth().currentUser.getIdToken(); // or from the app's auth import via a temporary window hook
  const r = await fetch("/api/records/backup?clinicId=SmtW6r6jKaFhfRWYcxsG&lang=ar", { headers: { Authorization: `Bearer ${t}` } });
  console.log(r.status, r.headers.get("content-disposition"), (await r.blob()).size);
  ```
  Expect 200, the filename header, and a size above 10 KB. Open the file: About counts must equal each sheet's row count.
- [ ] **Step 6: Commit** — `git commit -m "Excel backup: admin-only download route"`

---

### Task 7: Settings section, panel, client call

**Files:**
- Modify: `src/config/settingsRegistry.ts` — add after `recently_deleted`:
  ```ts
  { id: "backup", route: "/settings/backup", group: "system", labelEn: "Backup", labelAr: "النسخ الاحتياطي",
    writes: [{ kind: "readOnly", reads: "every clinic collection, through /api/records/backup on the Admin SDK; the route is Admin/Owner-only" }],
    view: ADMIN, edit: ADMIN }
  ```
- Modify: `src/config/settingsText.ts` — add `backup: { title, sub, includesTitle, notRestore, button, preparing, done, failed, sheet_1 … sheet_12 }` with EN/AR.
- Modify: `src/components/settings/panels.tsx` — icon `DatabaseBackup` (lucide) in `SETTINGS_ICONS`, and `backup: panel(() => import("@/components/settings/BackupSettings"))`.
- Create: `src/lib/backupApi.ts` — `export async function downloadClinicBackup(clinicId: string, language: "en" | "ar"): Promise<void>`; bearer token like `recycleBinApi.ts`; on non-OK parse JSON for `error` and throw `new Error(message)`; on OK `response.blob()` → object URL → temporary `<a download="alpha-backup-<yyyy-mm-dd>.xlsx">` → click → revoke.
- Create: `src/components/settings/BackupSettings.tsx` — default export, props `SettingsPanelProps`; uses `useSettingsText("backup")`, `useClinic()` for `clinicId`, `useLanguage()` for language, `useUI().showToast`. Renders title/sub, the twelve-sheet list, the not-a-restore-file note, and the button (disabled + spinner while running, `preparing` text under it). Follow the surface/ink/line class vocabulary used in `RecentlyDeleted.tsx`; no new colours.

- [ ] **Step 1: Run** `npm run test:settings` → fails (section without icon/panel, or text missing) once the registry line is added first.
- [ ] **Step 2: Implement** the four files.
- [ ] **Step 3: Run** `npm run test:settings` and `npx tsx tests/translations.test.mjs` → pass. `npx tsc --noEmit` → clean for the new files.
- [ ] **Step 4: Verify in the browser** (`npm run dev`, admin login): Settings → System shows "Backup"; click → panel; press the button → file downloads; open it in Excel: Arabic headers readable, RTL when the app is in Arabic, numbers are numbers (sum a money column). Log in as a non-admin (or a Dentist test user) → section absent from the list and `/settings/backup` shows the locked screen. Screenshot the panel and the opened workbook's Patients sheet.
- [ ] **Step 5: Commit** — `git commit -m "Excel backup: Settings section and download button"`

---

### Task 8: Full verification and ship

- [ ] **Step 1:** Run every affected suite: `npm run test:excel-backup`, `test:settings`, `test:permissions`, `test:briefing`, `test:ledgercash`, `npx tsx tests/translations.test.mjs`, then `npm run build`. All must pass; paste the tail of each into the final message.
- [ ] **Step 2:** Download the owner's real clinic (`SmtW6r6jKaFhfRWYcxsG`) once and confirm the About row counts against the Patients page total and the Finance page row count.
- [ ] **Step 3:** `git push origin live` (check `git status -sb` first; the checkout tracks `origin/main` and another session edits it — stage only the files this plan names).
- [ ] **Step 4:** Report in plain language: where the button is, what the file contains, what is deliberately not in it (clinical notes, treatment plans, leads, chats, bin), and the three test steps the owner should do himself.
