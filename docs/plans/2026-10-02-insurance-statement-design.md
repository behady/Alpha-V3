# Insurance claim statement (Nextcare layout) — design

**Date:** 2026-10-02
**Status:** decisions taken in chat with the owner; this is the write-up to build from.
**Sample:** `docs/samples/insurance-statement-nextcare-2026-02.xlsx` — the prospect's real February 2026
statement to Nextcare (40 cases, 85,931 EGP). The export must look like this file.

## What this is

Reports → **Insurance statement** tab. Pick an insurer (payer) and a month, see the cases on screen, press
**Excel** and get a workbook in the insurer's statement layout: one block per visit (serial, member code +
patient name, one line per service with its price, a subtotal), and a grand total. The clinic sends this
file to the insurer to get paid.

It is the first of the prospect's two conditions (see memory `first-prospect-insurance-dentist`); the
approval-document reader is the second and is not part of this.

## Decisions taken (2026-10-02)

| Question | Answer |
| --- | --- |
| The 4-char code before the name, e.g. `(A1B2)` | The patient's member number with that insurer. One per patient per insurer. To be confirmed with the receptionist; only a label changes if wrong. |
| Library | `xlsx-js-style` 1.2.0 (2.7 MB), the styled fork of the `xlsx` already used. exceljs rejected (22 MB, 9 deps). Probe confirmed: fonts, fills, borders, merges, widths, row heights, SUM formulas and workbook RTL all survive a write. |
| Placement | A new Reports tab, not a button on the Payer report. |
| Order | Statement export first; approvals second. |

## Assumptions (change here if wrong)

- Prices on the statement are the row's charged amount (`amount`, net of discount), which is already the
  insurer's tariff because the treatment was priced from the insurer's price list.
- A **case** = one visit: the procedure rows of one patient sharing an `appointmentId`; rows with no
  appointment group by patient + date instead.
- Tooth numbers on the statement are written the way the clinic writes them to the insurer: the tooth's
  position within its quadrant (FDI 14 → `4`, 36 → `6`), primary teeth as letters (FDI 55 → `E`, 51 → `A`).
  Teeth come from the ledger description `(T: 14,15)` via `parseLedgerProcedureDescription`.
- The three header lines (clinic + doctor, address, phones) are typed once in the tab, prefilled from the
  clinic profile (`clinicName`, `address`, `phone`), and remembered in the browser (`localStorage`, keyed
  by clinic id). No new settings document: the reports page is open to non-admins and `settings/*` is
  admin-write-only. Upgrade later if a clinic has several receptionists on several machines.
- Web only now. The member-number field is a patient-record field; the Android patient editor must get it
  too (standing rule) — scoped as the last task and may ship with the next APK.
- Deleted/cancelled ledger rows are excluded (same filter as every report).

## Data

**New patient field** (web edit modal; Android later):
```
patients/{id}.insurance: { [payerId]: { memberNumber: string } }
```
Written with the patient's other fields by the same `updateDoc`; `patients.edit` already covers it (no
field allowlist in the rules). Rendered as one text input per active non-private payer, labelled with the
payer's name. Blank entries are not written (never `undefined` — see `firestore-undefined-rejects-writes`).

**Statement rows**: ledger `type === "procedure"`, `payerId === chosen`, `date` within the month, status
not deleted/cancelled. The reports page already loads this for its date range; the tab sets the page range
to the chosen month.

## The model (pure, tested)

`src/lib/insuranceStatement.ts`

```ts
export type StatementLine = { text: string; amount: number; rowId: string };
export type StatementCase = { serial: number; patientId: string; patientName: string; memberNumber: string; date: string; lines: StatementLine[]; subtotal: number };
export type Statement = { payerId: string; payerName: string; month: string /* yyyy-mm */; cases: StatementCase[]; total: number };

export function buildInsuranceStatement(args: {
  rows: StatementRowLite[];            // ledger procedure rows (already filtered to the month)
  payerId: string; payerName: string; month: string;
  memberNumbers: Map<string, string>;  // patientId → member number for this payer
}): Statement;

export function insurerToothLabel(fdi: number): string;           // 14 → "4", 55 → "E", 0/NaN → ""
export function statementLineText(row: StatementRowLite): string;  // "2حشو كمبوزيت رقم 5-6"
```

`statementLineText`: `count + name + " رقم " + teeth`, where count = `unitsCount` when > 1 and
`pricingMode !== "flat"` (else ""), name = `serviceName` else the parsed procedure line, teeth = the parsed
teeth mapped through `insurerToothLabel` and joined with `-`; no ` رقم …` when there are no teeth or they
are `Gen`. Whitespace is a single space; the count has no space after it, matching his sheet.

Cases are ordered by date, then patient name; serials start at 1. Subtotal = sum of line amounts, rounded
to 2 dp; total = sum of subtotals.

## The workbook (pure, tested)

`src/lib/insuranceStatementXlsx.ts` — `statementToWorkbook(statement, header: { line1, line2, line3 }): WorkBook`
with `xlsx-js-style`. Layout reproduces the sample exactly:

- Columns A–D, widths 19.1 / 45 / 63.9 / 44.3. Workbook view RTL. Sheet name `Sheet1`.
- Rows 1–3: header lines, each merged A:D, Arial 36 bold, centered, wrap on row 1, medium border, heights
  90 / 45.8 / 35.2.
- Row 4: `المسلسل | اسم الحالة | بيان الخدمة | قيمة الخدمة`, Arial 36 bold, fill `938953`, medium border.
- Per case: A (serial, fill `938953`) and B (`(member) name`) merged over the case's rows; one row per
  line in C/D; then a subtotal row `الاجمالي` in C with `=SUM(Dstart:Dend)` in D, both fill `938953`,
  Arial 22 bold. Line rows Arial 20 bold. All thin borders, centered.
- Footer: `الاجمالي` merged A:C over 4 rows, Arial 36 bold, fill `938953`; D merged over the same rows with
  `=SUM(` of every subtotal cell `)`. (The sample stores the number; a formula is strictly better.)
- Columns E/F of the sample (manual helper subtotals) are not reproduced.
- Portrait A4.

File name: `statement-<payer>-<yyyy-mm>.xlsx` (ASCII). The library is loaded with a dynamic `import()` so
its 2.7 MB only ships to the browser when someone presses the button.

## The tab

`src/components/reports/InsuranceStatementReport.tsx`, registered in `reports/page.tsx` as id
`insurance`, label "Insurance statement" / "كشف حساب التأمين", icon `FileSpreadsheet`, placed after
`payers`. Props: `procedures`, `allPatients`, `payers`, `startDate`, `endDate`, `onPickMonth(yyyy-mm)`,
`isAr`. Contents: payer select (active, non-private; empty state says to add an insurer in Settings →
Payers), `<input type="month">` (default: the page range's month; picking calls `onPickMonth`, which sets
the page range to the full month), the three header inputs, a preview table (serial, member + name,
lines, subtotal; grand total row), a count of patients with no member number for this insurer (with a
link to each patient), and the Excel button. Nothing is written to Firestore from this tab.

## Testing

- `tests/insuranceStatement.test.mts` (`npm run test:insurance-statement`): tooth labels (permanent,
  primary, `Gen`, junk); line text for every shape (count, no count, flat, no teeth, no serviceName);
  grouping by appointment and by date; serial order; subtotal and total; member number present/absent;
  rows of another payer or outside the month are not included; the workbook: merges per case, the
  formula strings, header cells' font/fill/border, RTL after write+read, sheet name, widths.
- `npm run test:excel-backup`, `test:settings`, `test:permissions` still green; `tsc` clean; eslint clean on
  new files.
- Manual: the owner's clinic has no insurer rows yet; the test fixture reproduces the sample's first three
  cases byte-for-value, and the file is opened in Excel to compare against the sample side by side.

## Out of scope

Approval-document reader; a per-insurer wording for service names (uses the service's name as typed);
emailing the statement; Android member-number editor (scoped, may ship with the next APK); any
"paid/received from insurer" tracking.
