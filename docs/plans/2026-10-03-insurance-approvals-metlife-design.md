# Insurance approvals — MetLife reader, claims register and the MetLife statement — design

**Date:** 2026-10-03
**Status:** decisions taken in chat with the owner on 2026-10-03; this is the write-up to build from.
**Samples:** `C:\Users\PC\Downloads\METLIFE APPROVAL.pdf` (one scanned MetLife pre-approval, 2 pages, page 2
blank) and `C:\Users\PC\Downloads\metlife 2-2026.xlsx` (the prospect's real February 2026 statement to
MetLife: 44 cases, 89,520 EGP approved). **They stay out of the repo**: both hold real patient names, policy
and certificate numbers, and the repo is public. Tests use invented names and numbers in the same shapes;
the layout facts below (widths, heights, fonts, fills, merges) were measured from the real sheet on
2026-10-03 and are the contract. (The Nextcare sample committed on 2026-10-02 under `docs/samples/` has
the same problem and should be removed from the repo and its history before the next push — see memory
`security-posture-2026-09`.)
**Builds on:** branch `claude/insurance-statement` (the Nextcare statement tab, the per-patient member
number, `xlsx-js-style`), merged to `main` first. Its design is
`docs/plans/2026-10-02-insurance-statement-design.md`.

## What this is

The second of the prospect's two conditions (memory `first-prospect-insurance-dentist`): the receptionist
uploads the insurer's approval document, the system reads it, logs it as a claim against the right patient,
and the monthly Excel to the insurer is built from those claims in the insurer's own layout.

Insurers are done **one at a time, from a real sample each**. This round is **MetLife only**. Nextcare's
approval reader is the next round; no "generic insurer" read is built now.

## Decisions taken (2026-10-03)

| Question | Answer |
| --- | --- |
| Where does the monthly sheet get its rows? | **From the saved approvals**, not from the ledger. The requested/approved split, the policy and certificate numbers and the approval number live only on the paper. The ledger still records the treatment as today; the two are not merged. |
| Where does the dentist upload? | **A new Insurance page** (`/insurance`): drop zone for one or many files, a confirm card per file, the claims list below, the Excel button there. The Reports → Insurance statement tab stays and links here. |
| Which insurers? | Only ones the owner hands a sample for. MetLife now. |
| Is the clinic charged AI credits for a read? | **No.** The prospect said no to AI; the reader is sold as part of insurance. The Gemini cost (≈ $0.003 a page) is logged under `ai_usage_log` with `feature: "insurance_read"` so the superadmin Costs tab sees it, but `creditsUsed` is not incremented. |

## What the MetLife paper carries (from the sample)

Header block, left column: Pre-Approval ID (`D6000001` — `D` + 7 digits), Policy Number
(`6481234567 - EXAMPLE TRAVEL EGYPT`: number, dash, employer), Certificate Number (`987`), Dependent Code
(`1`), Patient Name (Latin capitals, `NADER MAGED SALEM`), Termination Date (`9999-12-31`), Patient ID
(blank), Estimated Cost (`1,260.0`), Diagnosis Code ICD-9 (`525.9-Dental`), Pre-Existing Conditions,
Referral Hospital. Right column: Provider code (`DNC8144 - DR. AHMED ROSHDY - DENTAL`), Physician Name,
Approval Submission date (`03/10/2026`, **dd/mm/yyyy**), Expected Admission Date, Expected Number Of Days,
File Attachments, Approval Scenario (`Dental`).

`Status : AUTO APPROVED` line. Then the service table: Service Code (CPT, `D0120`), Description, submitted
units and gross per unit and gross for CPT, approved units, Patient Share, Metlife Approved Amount, Comment.
A Total row. A "Previous Public Comment" box. `Note : Kindly collect the patient share of EGP 0.0`.

**What the February sheet proves about how the clinic uses it:** the sheet's date column is the approval
submission date (10 cases on 2026-01-28, spread over 26 Jan – 27 Feb for a "2-2026" file), so MetLife
approvals are issued at the visit and the statement is "approvals in a date range", not strictly a calendar
month. The same certificate recurs with dependent codes 1, 2, 3 — a family — so **a MetLife patient is
identified by certificate number + dependent code**, and the policy number is the employer group. Requested
and approved amounts differ on 29 of 216 lines (a 2,700 crown approved at 500; a 50 exam at 45), which is
why the sheet has both columns.

## The flow

1. **Drop.** `/insurance` has a drop zone taking PDF, JPG, PNG, up to 8 MB each, many at once. Each file
   is uploaded by the browser to Storage at `clinics/{clinicId}/insurance_docs/{docId}/{filename}` (new
   helper in `storagePaths.ts`, covered by `tests/storagePaths.test.mjs`), then `POST /api/insurance/read`
   with `{ clinicId, payerId, docPath }`.
2. **Read.** The server downloads the file itself (never a client URL), sends it to `gemini-flash-latest`
   as inline `application/pdf` or image with the MetLife prompt and a strict JSON response schema, runs
   the checks below, and returns `{ extraction, checks, patientMatch, duplicate }`. Nothing is written to
   Firestore by this route except the usage log row.
3. **Confirm.** A card per file: the document on one side (a PDF in an `<object>` from its Storage
   download URL, an image in an `<img>`; no new dependency), the fields on the other, every field editable.
   Fields that failed a check are outlined and explained. The patient picker is preselected from the match
   (or offers "create new patient" prefilled). A "treated on" date defaults to the approval date; an
   "approved, not treated yet" switch holds the claim out of the statement. **Save** is disabled while a
   hard check fails (see below).
4. **Save.** `POST /api/insurance/claims` writes the claim with the Admin SDK. The document id is
   `metlife_<approvalNumber>` (lower-case, non-alphanumerics stripped), so the same approval can never
   be saved twice from two tabs — the route answers 409 with the existing claim's id and saved date, and
   the card shows "already saved on … — open". The route also creates the patient when asked, and writes
   `patients/{id}.insurance.metlife` (see below) when it is missing or different (different → a soft
   warning on the card first; the confirm overrides).
5. **List.** Below the drop zone, the claims of the chosen insurer in the chosen date range: approval
   number, patient, approval date, treated date, approved total, patient share, status. Row actions:
   open the PDF, mark treated / not treated, mark sent, delete (recycle bin). Filters: insurer (MetLife
   only for now, the select exists for the next round) and a from–to date range defaulting to the
   current month.
6. **Excel.** One button, builds the MetLife statement from the listed claims whose status is `treated` or
   `sent` and whose **approval date** is in the range. Claims still `approved` are counted above the button
   ("3 approvals not yet marked treated — not on the sheet"). After download the user can press
   **Mark all as sent**.

## Data

### `clinics/{clinicId}/insurance_claims/{claimId}` — server-written, clinic-read

```
payerId: "metlife"                       // the payer id in settings/payers
insurer: "metlife"                       // which reader produced it; the layout key
approvalNumber: "D6000001"
approvalDate: "2026-10-03"               // yyyy-mm-dd, from the submission date
status: "approved" | "treated" | "sent" | "cancelled"
treatedDate: "2026-10-03" | null         // set when status becomes treated; printed nowhere, kept for reports
sentAt: Timestamp | null
patientId: string
patientName: string                      // the clinic's name for the patient, snapshotted (what the sheet prints)
paperPatientName: "NADER MAGED SALEM"   // as printed by the insurer
metlife: {
  policyNumber: "6481234567", employer: "EXAMPLE TRAVEL EGYPT",
  certificateNumber: "987", dependentCode: "1",
  providerCode: "DNC8144", physician: "DR. AHMED ROSHDY - DENTAL",
  statusText: "AUTO APPROVED", diagnosisCode: "525.9-Dental",
  estimatedCost: 1260, patientShareTotal: 0, approvedTotal: 1260,
  terminationDate: "9999-12-31" | null, comment: string
}
lines: [{ code: "D0120", description: "EXAMINATION / ORAL EVALUATION", unitsRequested: 1,
          grossPerUnit: 60, grossTotal: 60, unitsApproved: 1, patientShare: 0, approvedAmount: 60,
          comment: "" }]
totals: { requested: 1260, approved: 1260, patientShare: 0 }
doc: { path: "clinics/…/insurance_docs/…/x.pdf", contentType, bytes, pages }
read: { model, raw: <the JSON the model returned>, checks: [...], at: Timestamp }
createdAt, createdBy, updatedAt, updatedBy
```

Rules: `allow read: if hasClinicRole(clinicId); allow write: if false;` — added to the server-only list in
`firestore.rules` beside `xray_reports`. Recycle bin: `insurance_claims` registered in `recycleBin.ts`
with permission `patients.edit`, `refFields: ["patientId"]`, and the Storage file deleted with the record
when the bin empties (same as `patient_media`).

### Patient: `patients/{id}.insurance.metlife`

The branch stores `{ memberNumber }` per payer. MetLife extends it:
`{ memberNumber: "987/1", certificateNumber: "987", dependentCode: "1", policyNumber: "6481234567" }`.
`memberNumber` stays the display/match key so the existing statement code and the patient modal keep
working; it is derived as `certificate/dependent`. `patientInsurance.ts` gains `metlifeMemberNumber(cert,
dep)` and the modal shows the two MetLife boxes instead of one free text when the payer is MetLife.

### Payer: `settings/payers` entries gain `providerCode?: string`

Typed once in Settings → Payers for MetLife (`DNC8144`). A paper whose provider code differs gets a soft
warning ("this approval names provider DNC9999, yours is DNC8144"). Not a hard stop: the owner may run two
provider codes.

### Wording table: `settings/insurance_wording` — `{ metlife: { [code]: { ar: string } } }`

The sheet prints Arabic service names (`كشف`, `حشو كمبوزيت`, `بطانه كالسيوم`), the paper prints CPT codes
and English. One line per code; prefilled on first use from the 12 names in the February sheet matched to
the codes on the sample (`D0120 → كشف`, `D0270 → اشعه عاديه`, `D2650 → حشو كمبوزيت`, `D3120 → بطانه
كالسيوم`, `D4220 → علاج لثه صديديه`; the remaining 7 names — `تنظيف جير`, `خلع عادي`, `خلع جراحي`, `خلع ضرس
عقل مدفون كليا`, `حشو عصب روتاري`, `دعامه معدنيه`, `طربوش زوكونيوم` — wait for their codes to appear).
An unknown code shows a "what do you call this on the sheet?" box on the confirm card, prefilled with the
paper's English description, and the answer is saved to the table by the claims route with the claim.
Admin-write-only like every `settings/*`; the claims route writes it with the Admin SDK on behalf of the
confirming user, which is the one exception, limited to adding a missing code.

## The reader (`src/lib/insurance/metlife.ts`, pure, tested) and the route

- `METLIFE_SCHEMA`: the Gemini response schema (`responseMimeType: application/json`), fields as in the
  data section, all strings, numbers as numbers, `confidence` 0–1 per header field and per line.
- `buildMetlifePrompt(language)`: tells the model it is reading a scanned MetLife Egypt dental
  pre-approval, that pages may be skewed, that dates are dd/mm/yyyy, that `9999-12-31` means no end,
  that `-` and blank mean empty, to copy the service table row by row, and to return `null` for anything
  it cannot read rather than guessing.
- `normalizeMetlife(raw)`: trims, uppercases codes, parses `1,260.0` → 1260, `03/10/2026` → `2026-10-03`,
  splits policy `6481234567 - EXAMPLE TRAVEL EGYPT` into number + employer, splits provider
  `DNC8144 - DR. AHMED ROSHDY - DENTAL` into code + physician.
- `checkMetlife(claim)` returns `{ hard: Check[], soft: Check[] }`:
  - hard: approval number matches `/^D\d{7}$/`; approval date parses and is not in the future by more
    than a day; at least one line; every line's `grossTotal === unitsRequested × grossPerUnit` (±0.01);
    sum of `grossTotal` equals the printed requested total; sum of `approvedAmount` equals the printed
    approved total; sum of `patientShare` equals the printed patient share and the "Kindly collect"
    figure when both read; certificate and dependent present.
  - soft: `statusText` is not `AUTO APPROVED` / `APPROVED`; provider code differs from the payer's;
    any field with confidence < 0.7; a line with `unitsApproved < unitsRequested` or `approvedAmount <
    grossTotal` (true on 29 of 216 sample lines — shown, not blocked); patient name on the paper does not
    resemble the matched patient's name.
  - A hard failure disables Save until the user edits the field; edits re-run the checks in the browser
    (the same pure function).
- `matchPatient(extraction, patients)` (pure): exact on `insurance.metlife.certificateNumber +
  dependentCode`; else candidates by name similarity between the paper's Latin name and each patient's
  name and `nameLatin` if present, using a transliteration-tolerant compare (`arabicToLatinKey()`:
  strip diacritics, map letters to a Latin skeleton, compare token sets); returns `{ exact } | {
  candidates: top 3 with scores } | { none }`. Creating a new patient uses the Latin name as typed on the
  paper for `name` (the receptionist corrects it to Arabic on the card if she wants), and stores
  `insurance.metlife` immediately.
- `POST /api/insurance/read`: `requireStaffUser` + `patients.edit`; `clinicHasFeature(clinicId,
  "insurance")`; `payerId` must be an active non-private payer; file read from Storage by path after
  checking it is under this clinic's `insurance_docs/`; ≤ 8 MB; ≤ 4 pages (first 4 of a longer PDF);
  80 s timeout; `createUsageMeter` + `logAiCreditUsage({ feature: "insurance_read", credits: 0, usage })`;
  on model failure 502 with a plain message and the file kept so the user can retry or type it in by hand
  (the confirm card also opens empty on "type it myself").
- `POST /api/insurance/claims`: create (as above), and `PATCH` for `{ status, treatedDate, patientId,
  lines, metlife, …}` edits by the same permission; every write stamps `updatedBy`; `status: "sent"` also
  stamps `sentAt`; a claim already `sent` warns before edits (soft, in the UI only).

## The MetLife statement (`src/lib/insuranceStatementMetlife.ts` + `insuranceStatementMetlifeXlsx.ts`, pure, tested)

Model: `buildMetlifeStatement({ claims, from, to, wording, header })` → cases ordered by approval date then
approval number, serial from 1; each case = one claim; lines in the paper's order; line text = wording
table entry for the code, else the paper's description; `count = unitsApproved`; `requested =
grossTotal`; `approved = approvedAmount`; case subtotal = sum of approved; grand total = sum of subtotals.
`missingWording: code[]` listed above the button.

Workbook, reproducing `insurance-statement-metlife-2026-02.xlsx` cell for cell:

- Columns A–K, widths 18.8 / 35.5 / 26.2 / 27.8 / 19.2 / 23.6 / 26.0 / 40.0 / 21.0 / 26.1 / 29.8. Sheet
  `Sheet1`, view RTL, A4 portrait.
- Rows 1–3: the three header lines (clinic + doctor, address, phones — the same localStorage header the
  Nextcare tab keeps), each merged A:K, Arial 22 bold, centered, row 1 wraps; heights 79.5 / 30.75 / 31.5.
- Row 4 (height 27.75): `المسلسل | اسم المريض | رقم الوثيقة | رقم الشهادة الفردية | المعال | رقم الموافقة
  | التاريخ | بيان الخدمة | العدد | القيمة المطلوبة | الموافق عليه`, Arial 22 bold, fill `938953`, thin border.
- Per case, rows of height 26.25: A–G merged down the block (serial, patient name, policy number as a
  number, certificate number as a number, dependent code as a number, approval number, date as a real
  date with format `mm-dd-yy`), Arial 24 bold, A filled `EEECE1`; one row per line in H–K (text, count,
  requested, approved) Arial 20 bold; then a subtotal row: H `الاجمالي`, K `=SUM(Kstart:Kend)`, H–K filled
  `938953`, Arial 20 bold. Thin borders, centered, throughout.
- Footer: `الاجمالي` merged A:F over 3 rows, Arial 48 bold, fill `938953`; K merged over the same 3 rows
  with `=SUM(` of every subtotal cell `)`, Arial 24 bold, fill `938953`; G–J of those rows filled, empty.
- Column L of the sample (the receptionist's retyped subtotals) is not reproduced.
- File name `statement-metlife-<from>-<to>.xlsx`.

The sample's two fills are theme colour 3 at tint 0 and −0.25; the resolved RGBs above are what Excel
renders for the default Office theme (the Nextcare writer already uses `938953` for the darker one).

## The page (`src/app/(dashboard)/insurance/page.tsx` + `src/components/insurance/*`)

- Gated by the new add-on `insurance` (featureCatalog, group `modules`, labels "Insurance approvals" /
  "موافقات التأمين") through `FeatureGate`, and by `patients.edit` through `PermissionGuard`. Nav entry
  in `(dashboard)/layout.tsx` beside Reports, hidden when the add-on is off.
- Components: `ApprovalDropZone` (upload + progress per file), `ApprovalConfirmCard` (viewer + fields +
  checks + patient picker + wording boxes + Save), `ClaimsTable` (list + row actions), `ClaimsExportBar`
  (range, counts, Excel, mark all sent). Arabic/English via the page's `TEXT` table, as the branch does.
- The confirm card keeps unsaved extractions in component state only; a refresh loses them but the file
  is already in Storage and listed under "uploaded, not saved" at the top of the page (query
  `insurance_docs` for files with no claim — a small `insurance_docs` collection written by the read
  route: `{ path, uploadedAt, uploadedBy, claimId|null }`), so a crash mid-stack costs a re-read, not a
  re-scan.
- The Reports → Insurance statement tab gets one line: "MetLife statements are built from approvals on
  the Insurance page" with a link.

## Testing

- `tests/insuranceMetlife.test.mts` (`npm run test:insurance-metlife`): normalize (every field shape in the
  sample, `1,260.0`, dd/mm/yyyy, the policy and provider splits, nulls); checks (each hard rule failing on
  purpose, each soft rule firing, the sample passing clean); matchPatient (exact by certificate+dependent,
  the Latin→Arabic name candidates for `NADER MAGED SALEM` against `نادر ماجد سالم` and two decoys, none);
  the statement model (ordering, serials, wording fallback, missing wording, range filter, status filter);
  the workbook read back (merges per case, the two formulas, fonts and fills on the four cell kinds, the
  date cell type and format, RTL, widths, heights) and a fixture reproducing the sample's first three
  cases value for value.
- `tests/storagePaths.test.mjs` extended for the new path; `tests/permissions`, `test:insurance-statement`,
  `test:settings`, `test:recyclebin` still green; `tsc` clean; eslint clean on new files.
- Route tests are not unit-testable (Admin SDK); covered by a script `scripts/probe-insurance-read.mjs`
  that runs the sample PDF through the live route on the demo clinic with a minted token and prints the
  extraction and the checks — the model's reading of the real sample must pass every hard check.
- Manual: generated February file opened beside the real one in Excel; a plain-language checklist for the
  owner: drop the sample, see the card, save, see the row, mark treated, press Excel.

## Out of scope (this round)

Nextcare's reader (next round, same register, `insurer: "nextcare"`, its own `lib/insurance/nextcare.ts`
and checks; the Nextcare statement then switches from ledger rows to claims); a generic reader for an
insurer with no sample; Android (the claims list and "mark treated" are owed under the parity rule and
noted in `android-parity-gaps`); charging credits; emailing the statement; reconciling what MetLife
actually paid against what was claimed; linking a claim to the ledger procedure rows.
