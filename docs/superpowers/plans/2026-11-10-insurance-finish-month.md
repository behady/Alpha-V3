# Insurance Finish-Month Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An insurance approval is billed in the month its last service was done, each service carries its own editable "Done on" date (which also decides the dentist's month), and a not-yet-done service can be deleted from the approval.

**Architecture:** Four new fields on the claim doc (`lineDates`, `removedLines`, and the server-derived `finishedDate` / `workMonths`). One pure module (`src/lib/insurance/billingMonth.ts`) owns every date rule; the claims route, the visit sync, payroll, the statements and the screens all call it. All writes stay in `/api/insurance/claims` PATCH.

**Tech Stack:** Next.js app router, TypeScript, Firestore (client listeners + firebase-admin in routes), tsx test scripts, Firestore emulator for route tests.

**Spec:** `docs/superpowers/specs/2026-11-10-insurance-finish-month-design.md`

## Global Constraints

- Work in the worktree `C:\Users\PC\Downloads\alpha-insurance-month` (branch `claude/insurance-finish-month`, cut from origin/main). Never edit the shared Downloads checkout.
- Repo stores CRLF: edit with the Edit tool, never a script that rewrites whole files with LF.
- Firestore rejects `undefined`: every write goes through `stripUndefined` or omits the key.
- Dates are `yyyy-mm-dd` on the clinic clock: `ymdInTimeZone(clinicTimeZone())` server-side, `cairoToday()` client-side.
- A claim with no `lineDates` entry for a line reads exactly as today: `lineDates[i] ?? treatedDate ?? approvalDate`. Old claims must not change month in pay or on any sheet.
- Payroll still counts only `treated` / `sent` claims (`countsForPayroll` unchanged). *(Corrects the spec's "any status but cancelled": an `approved` claim's lines default to Completed, so that would pay for work never done.)*
- Removed lines never print, never earn, never get a treatment row. A Completed line cannot be removed (set it back to Planned first).
- No push, no Firestore index/rules deploy, no backfill `--apply` without the owner's explicit OK.
- Each sheet's printed columns stay exactly as today (MetLife prints the approval date; NextCare/AXA print what they print now). Only which approvals appear changes.

## Review Focus

1. A line edited to a date before the approval date or after today → 400, nothing written (Task 3 test).
2. A visit dated before the approval date (old misread approvals) → the sync skips the line date instead of failing the visit save (Task 2 test).
3. An approval whose remaining line is deleted becomes finished on its latest done date, and restoring that line un-finishes it (Task 4 test).
4. Editing an approval's paper (`lines` patch → rebuild) with fewer lines drops `lineDates` / `removedLines` for indexes that no longer exist (Task 3 test).
5. Status back to `approved` clears `finishedDate` and `workMonths`, so a not-treated approval leaves every sheet and every pay month (Task 3 test).

---

### Task 1: Claim fields and the billing-month rules

**Files:**
- Create: `src/lib/insurance/billingMonth.ts`
- Modify: `src/lib/insurance/claims.ts` (type `InsuranceClaim`, `parseClaim`, `claimFromExtraction`)
- Test: `tests/insuranceBillingMonth.test.mts` (new script `test:insurance-billing-month` in package.json, plus a `_comment_test_insurance_billing_month` line in the house style)

**Interfaces:**
- Produces, in `claims.ts`:
  - `InsuranceClaim` gains `lineDates: Record<number, string>`, `removedLines: Record<number, RemovedLine>`, `finishedDate: string | null`, `workMonths: string[]`.
  - `export type RemovedLine = { at: string; by: string }`
  - `export function parseLineDates(raw: unknown, lineCount: number): Record<number, string>` (drops non-ISO and out-of-range)
  - `export function parseRemovedLines(raw: unknown, lineCount: number): Record<number, RemovedLine>`
  - `claimFromExtraction` returns `lineDates: {}`, `removedLines: {}`, `finishedDate: null`, `workMonths: []`.
- Produces, in `billingMonth.ts`:
  - `export type SheetDateMode = "approval" | "finish"`
  - `export type BillingClaim = Pick<InsuranceClaim, "status" | "lines" | "lineStatus" | "lineDates" | "removedLines" | "treatedDate" | "approvalDate">`
  - `export function isLineRemoved(c: Pick<InsuranceClaim, "removedLines">, i: number): boolean`
  - `export function lineDateOf(c: BillingClaim, i: number): string` → `lineDates[i] ?? treatedDate ?? approvalDate`
  - `export function claimFinishedDate(c: BillingClaim): string | null` → null unless status is `treated`/`sent` and every non-removed line is Completed (and at least one is); else the max `lineDateOf` over non-removed lines
  - `export function claimWorkMonths(c: BillingClaim): string[]` → sorted unique `yyyy-mm` of Completed non-removed lines; `[]` unless `treated`/`sent`
  - `export function billingFields(c: BillingClaim): { finishedDate: string | null; workMonths: string[] }`
  - `export function sheetDate(c: BillingClaim, mode: SheetDateMode): string | null` → approval mode: `approvalDate`; finish mode: `claimFinishedDate(c)`
  - `export function inSheetRange(c: BillingClaim, mode: SheetDateMode, from: string, to: string): boolean` → `treated`/`sent` and `sheetDate` within `[from, to]`
  - `export function monthsBetween(from: string, to: string): string[]` (inclusive `yyyy-mm` list)

- [ ] **Step 1: Write the failing test** — `tests/insuranceBillingMonth.test.mts` with the repo's `check(label, cond)` pattern. Fixture: a claim approved `2026-10-20`, treated `2026-10-20`, three lines.
  - all lines Completed, `lineDates {0:"2026-10-20",1:"2026-10-20",2:"2026-11-05"}` → `claimFinishedDate === "2026-11-05"`, `claimWorkMonths` deep-equals `["2026-10","2026-11"]`
  - line 2 Planned → `claimFinishedDate === null`, `claimWorkMonths` deep-equals `["2026-10"]`
  - line 2 Planned but `removedLines {2:…}` → finished `"2026-10-20"`
  - all lines removed → `null`
  - no `lineDates` at all → finished = `treatedDate` (old claims unchanged)
  - status `approved` → finished `null`, months `[]`
  - `inSheetRange(c,"finish","2026-11-01","2026-11-30") === true` and `("approval", same range) === false`; `("approval","2026-10-01","2026-10-31") === true`
  - `monthsBetween("2026-10-15","2027-01-02")` deep-equals `["2026-10","2026-11","2026-12","2027-01"]`
  - `parseClaim` of a doc with `lineDates: {0:"2026-10-20", 7:"2026-10-21", 1:"junk"}` on a 3-line claim → `{0:"2026-10-20"}`; a doc with none of the new fields parses with `{}`, `{}`, `null`, `[]`

- [ ] **Step 2: Run, expect FAIL** — `npx tsx tests/insuranceBillingMonth.test.mts` → module not found.
- [ ] **Step 3: Implement** the fields in `claims.ts` and the module `billingMonth.ts` (pure, no Firestore).
- [ ] **Step 4: Run, expect PASS**; also `npm run typecheck` (fix every `InsuranceClaim` literal the new required fields break — test fixtures included).
- [ ] **Step 5: Commit** `Insurance: per-service done dates and the finished-month rule`.

### Task 2: A finished visit dates its service, not the whole approval

**Files:**
- Modify: `src/lib/insurance/appointments.ts` (`LineSyncPatch`, `lineSyncPatch`)
- Modify: `src/components/insurance/api.ts` (`ClaimPatch` gains `lineDates?: Record<number, string | null>`)
- Test: `tests/claimLinks.test.mts` (extend)

**Interfaces:**
- Consumes: `InsuranceClaim.lineDates` (Task 1).
- Produces: `LineSyncPatch = { lineStatus?; dentists?; lineDates?: Record<number, string> }` — no `treatedDate` key any more.

- [ ] **Step 1: Failing tests** in `claimLinks.test.mts`:
  - a done visit on `2026-11-05` linked to line 2 of a claim treated `2026-10-20` → patch `lineDates` deep-equals `{2:"2026-11-05"}` and `"treatedDate" in patch === false`
  - same, but the claim already has `lineDates {2:"2026-11-04"}` (typed by hand) → no `lineDates` in the patch
  - a visit dated `2026-10-01` on a claim approved `2026-10-20` → no `lineDates` entry for that line (status still moves to Completed)
  - a `sent` claim still gets the line date (the warning is the UI's job; the server decides nothing about sent here)
- [ ] **Step 2: Run** `npm run test:claimlinks`, expect FAIL.
- [ ] **Step 3: Implement** — drop the `treatedDate` branch from `lineSyncPatch`; for each linked line add `lineDates[i] = visitDate` when the visit date is valid, `>= claim.approvalDate`, and `claim.lineDates[i]` is unset. Update the function's doc comment (the old "visit date becomes the approval's treatment date" paragraph is now wrong).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Visit sync: date the service the visit did, stop moving the approval's date`.

### Task 3: The claims route keeps line dates, re-dates rows per line, and stores the derived fields

**Files:**
- Modify: `src/app/api/insurance/claims/route.ts` (`PATCH_KEYS`, PATCH validation + transaction, POST save, `writeTreatmentRows`)
- Modify: `src/lib/insurance/claims.ts` (`TreatmentRowArgs.claim` adds `lineDates`, `removedLines`; `insuranceTreatmentRows` skips removed lines and dates each row `lineDateOf(claim, i)`)
- Test: `tests/insuranceLineDatesRoute.test.mts` (new, emulator harness copied from `tests/approvalDateRoute.test.mts`; script `test:insurance-line-dates-route`; add a CI step beside `test:approval-teeth-route` in `.github/workflows/ci.yml`)

**Interfaces:**
- Consumes: `lineDateOf`, `billingFields`, `isLineRemoved` (Task 1).
- Produces: PATCH accepts `lineDates: { "<i>": "yyyy-mm-dd" | null }`. Every PATCH and the POST save write `finishedDate` and `workMonths` from `billingFields` of the claim as it will be after the write.

Rules inside the PATCH transaction:
- Validate each `lineDates` value: ISO date, `>= approvalDate` (after any approval-date edit in the same patch), `<= today`; `null` clears. Bad key/value → 400 before the transaction.
- `lineStatus` → `Completed` with no `lineDates` sent for that line and none stored → `lineDates[i] = today`. → `Planned`/`Ongoing` → `lineDates[i]` removed.
- Any line whose `lineDateOf` changes and that has live rows → its charge and note get `date` = the new `lineDateOf` (never its payments), audited with `recordMoneyChange` `action: "Procedure Moved"`, `via: "insurance/claims:line-date"`. The existing whole-approval `redate` now only moves lines with no `lineDates` entry.
- A `lines` edit (rebuild) drops `lineDates` / `removedLines` keys `>= lines.length` (same `onLines` filter as `lineStatus`).
- Status `approved` / `cancelled` → `billingFields` gives `null` / `[]` naturally (keep that, test it).

- [ ] **Step 1: Failing emulator tests** (seed helper like `approvalDateRoute`, three lines, treated `2026-10-20`, rows dated `2026-10-20`; the test sets "today" by only using past dates):
  - `PATCH {lineDates:{2:"2026-11-05"}}` → 200; line 2 charge + note dated `2026-11-05`, lines 0–1 still `2026-10-20`; claim `finishedDate === "2026-11-05"`, `workMonths` deep-equals `["2026-10","2026-11"]`; one `ledger_audit` row for line 2's charge
  - `PATCH {lineStatus:{2:"Planned"}}` → `lineDates[2]` gone, line 2 rows back to `2026-10-20`, `finishedDate === null`
  - `PATCH {lineStatus:{2:"Completed"}}` with no date → `lineDates[2] ===` today
  - `lineDates` before approval date → 400; a date after today → 400; `"5/11/2026"` → 400; nothing changed after each
  - `PATCH {status:"approved"}` → `finishedDate === null`, `workMonths` deep-equals `[]`
  - rebuild with 2 lines on a claim that had `lineDates {2:…}` and no money → `lineDates` has no key 2
  - an old claim seeded with none of the new fields, patched `{lineStatus:{0:"Completed"}}` (already Completed by default) → gains `finishedDate` = its `treatedDate` and no `lineDates[0]`... except the auto-date rule: assert `lineDates[0]` is NOT set when the line was already Completed before the patch (only a real change to Completed stamps today)
- [ ] **Step 2: Run** — start the cached emulator jar (`~/.jdks/jdk21/bin/java.exe -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar --host 127.0.0.1 --port 8085`, background), then `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/insuranceLineDatesRoute.test.mts` → FAIL ("Unknown field: lineDates").
- [ ] **Step 3: Implement** the rules above. In POST, add `...billingFields(claim)` to the created doc.
- [ ] **Step 4: Run** the new test, `test:approval-date-route` and `test:approval-teeth-route` → all PASS.
- [ ] **Step 5: Commit** `Claims route: per-service done dates, rows dated per service, finished month stored`.

### Task 4: Delete and restore a service

**Files:**
- Modify: `src/app/api/insurance/claims/route.ts`
- Modify: `src/components/insurance/api.ts` (`ClaimPatch` gains `removeLine?: number; restoreLine?: number`)
- Test: `tests/insuranceLineDatesRoute.test.mts` (extend)

**Interfaces:**
- Produces: PATCH keys `removeLine: number` and `restoreLine: number`, each only alone in a patch (400 otherwise). Outcomes `line_done` (409, "Set this service back to Planned before deleting it."), `rows_paid` (409, existing message), `bad_line` (400).

Rules:
- `removeLine i`: line exists, not already removed, not Completed. If it has rows and its charge has `paid > 0` → `rows_paid`. Delete its charge + note, drop `ledgerIds[i]`, drop `lineDates[i]`, set `removedLines[i] = { at: today, by: authz.uid }`. Audit `"Procedure Deleted"`, `via: "insurance/claims:line-removed"`. Restamp settlements for that line's dentist.
- `restoreLine i`: removed → drop `removedLines[i]`; if the claim is `treated`/`sent`, write that one line's rows via `writeTreatmentRows(..., only: i)` (add an optional `only?: number` filter), merge into `ledgerIds`. Counts as `writesMoney` for the branch check.
- Both recompute `billingFields`.

- [ ] **Step 1: Failing tests:** remove a Planned line 2 (lines 0–1 Completed) → 200, its charge + note deleted, `finishedDate === "2026-10-20"`; remove a Completed line → 409 `line_done`; remove a Planned line whose charge has `paid: 50` → 409 and nothing deleted; `removeLine` together with `lineStatus` → 400; restore line 2 → new charge + note exist dated `2026-10-20`, `finishedDate === null` (line 2 Planned again); `status:"treated"` re-write on a claim with a removed line writes no row for it.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all three route tests, expect PASS.**
- [ ] **Step 5: Commit** `Claims route: delete and restore a service on an approval`.

### Task 5: Dentist pay per service date

**Files:**
- Modify: `src/lib/staffInsurance.ts` (`insuranceWorkByStaff`, `InsuranceWorkEntry.date` doc)
- Modify: `src/app/(dashboard)/team/page.tsx:165-200` (third listener)
- Test: `tests/insuranceBillingMonth.test.mts` (extend)

**Interfaces:**
- Consumes: `lineDateOf`, `isLineRemoved`, `monthsBetween` (Task 1).

- [ ] **Step 1: Failing tests:** the Task 1 fixture with a dentist on lines 0 and 2 → period Oct: dentist has one entry (line 0) dated `2026-10-20`; period Nov: one entry (line 2) dated `2026-11-05`; with line 2 removed → Nov has none; a claim with no `lineDates` → its lines dated `treatedDate` (unchanged).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — period filter and entry `date` both use `lineDateOf(claim, i)` per line; skip removed lines. Team page: add `onSnapshot(query(..., where("workMonths", "array-contains-any", months)))` into a third map merged by `publishClaims`, only when `1 <= months.length <= 30` (`months = monthsBetween(range.start, range.end)`); keep both existing listeners for claims saved before `workMonths` existed. Update the comment above them.
- [ ] **Step 4: Run** the test and `npm run test:staff-settlement` → PASS.
- [ ] **Step 5: Commit** `Team pay: each insurance service counts on the day it was done`.

### Task 6: Sheets pick approvals by the chosen date

**Files:**
- Modify: `src/lib/insuranceStatementMetlife.ts` (`buildMetlifeStatement`)
- Modify: `src/lib/insuranceStatementNextcare.ts` (`buildNextcareStatement`)
- Test: `tests/insuranceStatement.test.mts` and `tests/insuranceNextcare.test.mts` (extend)

**Interfaces:**
- Both builders take `mode?: SheetDateMode`. Defaults keep today's output: MetLife `"approval"`, NextCare `"finish"` (equal to today's `treatedDate` rule for every claim without `lineDates`).
- Selection uses `inSheetRange(c, mode, from, to)`; removed lines are skipped when building case lines. Printed `date` fields unchanged (MetLife `approvalDate`; NextCare keeps `treatedDate || approvalDate`). MetLife's `heldBack` in finish mode = claims passed in that are `approved`, or `treated` with `claimFinishedDate === null`.

- [ ] **Step 1: Failing tests:** the 20/10 → 5/11 claim: MetLife finish mode Nov lists it, Oct does not; approval mode Oct lists it; NextCare finish mode Nov lists it with the removed line absent from `lines`; an unfinished claim appears in neither month in finish mode; existing assertions unchanged.
- [ ] **Step 2: Run** `npm run test:insurance-statement && npm run test:insurance-nextcare`, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Insurance sheets: by approval date or by finish date, deleted services left off`.

### Task 7: Insurance page — the date switch and the Finished column

**Files:**
- Modify: `src/components/insurance/useClaims.ts` (`useClaims(clinicId, payerId, from, to, field: "approvalDate" | "finishedDate" = "approvalDate")`)
- Modify: `src/app/(dashboard)/insurance/page.tsx` (mode state, counts query, drop the 62-day `nextcareBillable` load, pass `mode` down)
- Modify: `src/components/insurance/ClaimsExportBar.tsx` (prop `mode: SheetDateMode`; both builders get it; `statementClaims` prop removed; `toSend` uses `inSheetRange`)
- Modify: `src/components/insurance/ClaimsTable.tsx` (column `colFinished` after `colTreatedDate`, mobile card line too)
- Modify: `src/components/insurance/text.ts` (strings below)
- Modify: `firestore.indexes.json` (composite `payerId ASC, finishedDate ASC` on `insurance_claims`)

Strings (en / ar): `dateModeApproval` "By approval date" / "بتاريخ الموافقة"; `dateModeFinish` "By finish date" / "بتاريخ الانتهاء"; `colFinished` "Finished" / "اتقفلت"; `notFinished` "Not finished" / "لسه مخلصتش". `sentWarning` becomes insurer-neutral: "This was already sent to the company — continue?" / "دي اتبعتت للشركة خلاص — تكمل؟".

- [ ] **Step 1:** Mode lives in `useState<SheetDateMode>` initialised from `localStorage["insurance.sheetDateMode"]` (try/catch, default `"finish"`), saved on change. A two-button segmented switch sits with the From/To pickers in `ClaimsExportBar`. The list, counts and sheet all follow it. `highlightId` jump (page.tsx:298) uses `sheetDate(claim, mode) ?? claim.approvalDate`.
- [ ] **Step 2:** `npm run typecheck && npm run lint` clean for touched files.
- [ ] **Step 3:** Commit `Insurance page: choose the sheet by approval or finish date`.

### Task 8: "Done on" and Delete on every service, in both places

**Files:**
- Create: `src/components/insurance/LineDoneControls.tsx` — exports `LineDoneDate` (shows the date; tap → `<input type="date" min={approvalDate} max={today}>`; saves `{lineDates:{[i]: v}}`), `LineRemoveButton` (trash icon, confirm, `{removeLine: i}`), `LineRestoreButton` (`{restoreLine: i}`), and `useLineEdit(clinicId)` returning `(claim, patch) => Promise<boolean>` that asks `sentWarning` first when `claim.status === "sent"` and toasts errors (reuse the `InsuranceCallError` handling in `PatientInsuranceTab.setLineState`).
- Modify: `src/components/appointments/booking/InsuranceApprovals.tsx` — desktop table (from line 563): new column "Done on" / "اتعمل يوم" before the action column showing `LineDoneDate` on Completed lines; action column shows `LineRemoveButton` beside "Use for this visit" on open lines; removed lines render greyed + struck through with `LineRestoreButton` and no status select; mobile cards (≈ line 469) get the same. Header line 449: `· Finished {date}` / `· اتقفلت {date}` when `claimFinishedDate(c)` else `· Not finished`; `approvalFigures` skips removed lines.
- Modify: `src/components/insurance/PatientInsuranceTab.tsx` — same three controls in its line table (line 531 block).
- Modify: `src/components/insurance/ClaimsTable.tsx` — a "Services ▾" toggle per row expanding a compact line list (name, status text, `LineDoneDate`, remove/restore) so the Insurance page can do the same edits.

- [ ] **Step 1:** Build the shared file, then wire the three screens.
- [ ] **Step 2:** `npm run typecheck && npm run lint` clean.
- [ ] **Step 3: Browser check** on the dev server with the demo clinic (`?clinic=` per the screenshots memory): book a visit on an approval, complete one service → date appears in pop-up and on the patient tab and Insurance page; edit it to next month → Team page moves that service; delete the last Planned service → header says Finished and the Insurance page "By finish date" lists it; restore → it leaves. Screenshot each.
- [ ] **Step 4:** Commit `Approvals: Done-on date and delete on every service`.

### Task 9: Backfill for old approvals (dry-run by default)

**Files:**
- Create: `scripts/backfill-insurance-finish.mts` (run with `npx tsx`; credentials from `.env.local` like `scripts/backfill-lead-interest.mjs`; `--apply` writes; `--clinic-id=` limits)
- Test: `tests/insuranceLineDatesRoute.test.mts` (extend: run the script's exported `planBackfill(claim)` on seeded docs)

**Interfaces:**
- `export function planBackfill(c: InsuranceClaim): { finishedDate: string | null; workMonths: string[] } | null` — the `billingFields` of the claim as stored (no `lineDates` written, so every line keeps its fallback date); for `sent` claims `finishedDate` is forced to `treatedDate ?? approvalDate` when not null-by-rule; returns null when the stored fields already match.

- [ ] **Step 1: Failing test:** an old treated claim with all lines Completed → `{finishedDate: treatedDate, workMonths:[month of treatedDate]}`; a sent one with a Planned line → `finishedDate` = `treatedDate` (it stays in the month it was sent); an already-backfilled claim → `null`.
- [ ] **Step 2–4:** implement, run, pass. Dry run prints one line per claim: id, approval no., old → new month.
- [ ] **Step 5: Commit** `Backfill: finished month for approvals saved before per-service dates`.

### Task 10: Whole-branch verification

- [ ] `npm run typecheck`, `npm run lint`, every `test:insurance-*`, `test:claimlinks`, `test:staff-settlement`, and the three route tests on the emulator → all PASS; paste the counts.
- [ ] Prove the new route test discriminates: run it against a detached worktree of origin/main → it FAILS.
- [ ] Final review of the branch diff (superpowers:requesting-code-review).
- [ ] Report to the owner in plain language, then ask before: push, index deploy (`firestore:default`), backfill `--apply` on live data.
