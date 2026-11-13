# Company Sheet: Finished Month Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contract company's monthly sheet (GASCO) lists each patient once, in the month all his waiting treatments were finished, with a per-patient switch and a sent lock.

**Architecture:** One pure library walks a patient's company charges month by month and decides what prints and what waits; every screen that prints the sheet calls it. The dentist's switches and the sent locks live in `settings/company_sheet_*` documents written only by one new route. No ledger row or treatment card is changed.

**Tech Stack:** Next.js app router, TypeScript, Firestore (client listeners + Admin SDK in routes), `tsx` test scripts under `tests/`, Firestore emulator for route tests.

**Spec:** `docs/superpowers/specs/2026-11-13-company-sheet-finished-month-design.md`

## Global Constraints

- Start month is `2026-11`. Charges dated before `2026-11-01` never enter the walk; ranges before it print exactly as today (`buildInsuranceStatement` with `range`, one case per visit).
- A contract company is a payer that is not `PRIVATE_PAYER_ID` and whose `format` fails `isInsurerFormat`. Approval insurers are untouched everywhere.
- An unfinished patient (any waiting treatment Planned or Ongoing today) is never printed. No switch overrides it.
- Money, collections, dentist shares, `insuranceStatementGascoXlsx.ts`: not touched.
- No Firestore rules change, no index, no migration. Writes only through `POST /api/insurance/company-sheet`.
- Route permission is `patients.edit`, add-on `insurance` (as `api/insurance/claims`).
- Every user-facing string in English and Arabic, in `src/components/insurance/text.ts`. The owner says تقفيلة for the sheet, never الكشف, in new strings.
- The repo stores CRLF. Edit existing files with the Edit tool only; never rewrite a whole existing file from a script.
- Web app only. Do not touch `android/`.
- Commit locally after each task. Never push.

## Review Focus

1. A treatment continued into a later visit (second card, `continuedFromNoteId`): the newest card decides Done, so a finished first card with an open continuation must hold the patient. Test in Task 1.
2. A charge with no treatment card, a deleted card, or a card with no `status`: must print (Done on the charge's date), never wait forever. Test in Task 1.
3. A charge whose id is in a sent list but whose date was later moved to another month: stays on the sent month, appears nowhere else. Test in Task 2.
4. One branch on screen while the patient's open treatment is in another branch: he is still held; the branch filter runs after the walk. Test in Task 3.
5. Two people pressing "Mark as sent" at once, or a stale screen sending a switch for a month that was just sent: second send answers 409, switch answers 409 `sent_locked`. Test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/insurance/companySheet.ts` (new) | Pure: the walk, the sent lock, branch scoping, the statement for a date range. |
| `src/lib/server/companySheetData.ts` (new) | Admin SDK: read one company's charges, cards, marks, sent months. |
| `src/app/api/insurance/company-sheet/route.ts` (new) | `mark`, `send`, `unsend`. |
| `src/components/insurance/useCompanySheet.ts` (new) | Browser: live cards, marks and sent months for a company's charges. |
| `src/components/insurance/CompanySheetPanel.tsx` (new) | The month blocks, switches, sent buttons. |
| `src/components/insurance/api.ts`, `text.ts` | Three client calls; strings. |
| `src/components/finance/InsurerTab.tsx` | Statement from the library; panel slot. |
| `src/app/(dashboard)/insurance/page.tsx` | Turns the panel on. |
| `src/components/reports/InsuranceStatementReport.tsx` | Contract company's statement from the library. |
| `src/lib/reports/documents.ts`, `src/app/api/reports/route.ts` | Phone "insurance" document follows. |

---

### Task 1: The walk

**Files:**
- Create: `src/lib/insurance/companySheet.ts`
- Test: `tests/companySheet.test.mts`
- Modify: `package.json` (script `"test:company-sheet": "npx tsx tests/companySheet.test.mts"`), `.github/workflows/ci.yml` (a step after the `test:insurance-statement-gasco` step, same form)

**Interfaces:**
- Consumes: `StatementRowLite` from `@/lib/insuranceStatement`; `monthsBetween` from `@/lib/insurance/billingMonth`.
- Produces:

```ts
export const COMPANY_SHEET_START = "2026-11";
export type SheetChoice = "include" | "hold";
export type SheetCharge = StatementRowLite & { clinicalNoteId?: unknown; branchId?: unknown };
export type SheetCard = { id: string; status?: unknown; date?: unknown; completedDate?: unknown; continuedFromNoteId?: unknown };
export type SentMonth = { month: string; chargeIds: string[]; sentAt?: string; sentByName?: string };
export type HeldReason = "not_finished" | "finished_late" | "moved";
export type SheetPatient = { patientId: string; patientName: string; charges: SheetCharge[]; value: number; choice: SheetChoice | null };
export type HeldPatient = SheetPatient & { reason: HeldReason };
export type MonthSheet = { month: string; printed: SheetPatient[]; held: HeldPatient[]; sent: SentMonth | null };
export type SheetInputs = { charges: readonly SheetCharge[]; cards: readonly SheetCard[]; marks: Readonly<Record<string, SheetChoice>>; sent: readonly SentMonth[] };

export function markKey(patientId: string, month: string): string;            // `${patientId}__${month}`
/** Done state of the treatment behind a charge: newest card of its chain; no card / no status = done on the charge date. */
export function chargeDone(charge: SheetCharge, cards: ReadonlyMap<string, SheetCard>, children: ReadonlyMap<string, SheetCard[]>): { done: boolean; date: string };
/** One MonthSheet per month from COMPANY_SHEET_START to `through` (yyyy-mm), inclusive; [] when `through` is earlier. */
export function buildCompanySheets(inputs: SheetInputs & { payerId: string; through: string }): MonthSheet[];
```

Rules the body must follow (spec "The rule"):
- In scope: `type === "procedure"`, `payerId` matches, status not `deleted`/`cancelled`, date `>= 2026-11-01`. Charge month = `date.slice(0, 7)`.
- `value` and line amounts: `Number(cost) || Number(amount) || 0`, rounded to 2 places.
- Newest card of a chain: latest `date`; on a tie the continuation wins (as `buildTreatmentStatus`). Done date = `completedDate`, else the card's `date`.
- Per patient per month: add the month's charges to waiting; if any waiting charge is not done → held `not_finished`; else mark `hold` → held `moved`; else mark `include` → printed; else any done date after the month's last day → held `finished_late`; else printed. Printed empties the waiting list.
- `printed` ordered by earliest charge date, then name. `held` the same.
- This task ignores `sent` (always `sent: null`); Task 2 adds it.

- [ ] **Step 1: Write the failing tests**

`tests/companySheet.test.mts`, same harness style as `tests/insuranceBillingMonth.test.mts` (plain `assert`, a `check(name, fn)` counter, exit code 1 on failure). Helpers: `charge(id, patientId, date, noteId?, extra?)` building `{ id, type: "procedure", payerId: "gasco", patientId, patientName: patientId, date, cost: 100, clinicalNoteId: noteId }`, and `card(id, status, date, completedDate?, continuedFromNoteId?)`. `sheet(month)` picks one month out of `buildCompanySheets({ ..., payerId: "gasco", through: "2026-12" })`.

```ts
// finished patient prints in his month
{ charges: [charge("c1","p1","2026-11-05","n1")], cards: [card("n1","Completed","2026-11-05","2026-11-05")] }
  → sheet("2026-11").printed ids == ["p1"], held == []

// unfinished is held, and carries with old + new work together
{ charges: [charge("c1","p1","2026-11-05","n1"), charge("c2","p1","2026-11-06","n2")],
  cards: [card("n1","Completed","2026-11-05","2026-11-05"), card("n2","Ongoing","2026-11-06")] }
  → Nov: printed [], held[0].reason == "not_finished", held[0].charges ids == ["c1","c2"]
  → Dec: held[0].charges ids == ["c1","c2"]
// same, n2 Completed with completedDate 2026-12-03
  → Nov: held "finished_late"; Dec: printed[0].charges ids == ["c1","c2"], value == 200

// "include" cannot override not finished
marks { "p1__2026-11": "include" } on the Ongoing case → Nov held "not_finished"

// late tick pulled in by the switch
n2 Completed 2026-12-03 + marks { "p1__2026-11": "include" } → Nov printed ["c1","c2"]; Dec has no p1

// "hold" carries a finished patient
finished case + marks { "p1__2026-11": "hold" } → Nov held "moved"; Dec printed ["c1"]

// returning patient: only the new work
c1 done in Nov, c3 charged 2026-12-10 done 2026-12-10 → Nov printed ["c1"]; Dec printed ["c3"]

// continuation decides (Review Focus 1)
n1 Completed 2026-11-05; card("n1b","Ongoing","2026-11-20",undefined,"n1") → Nov held "not_finished"

// no card, deleted card, card with no status (Review Focus 2)
charge("c1","p1","2026-11-05") ; charge("c2","p1","2026-11-05","gone") ; card("n3", "", "2026-11-05")
  → all three printed in Nov

// start month and filters
charge dated 2026-10-31 → in no sheet; status "deleted" → in no sheet; payerId "other" → in no sheet
through "2026-10" → []
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --silent test:company-sheet`
Expected: FAIL, cannot find module `companySheet`.

- [ ] **Step 3: Implement the types and functions above in `src/lib/insurance/companySheet.ts`**

Pure, no Firebase, no React. File header comment states the rule in the spec's words.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run --silent test:company-sheet`
Expected: every check passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insurance/companySheet.ts tests/companySheet.test.mts package.json .github/workflows/ci.yml
git commit -m "Company sheet: a patient prints in the month he finished"
```

---

### Task 2: The sent lock in the walk

**Files:**
- Modify: `src/lib/insurance/companySheet.ts`
- Test: `tests/companySheet.test.mts`

**Interfaces:**
- Consumes: Task 1's `buildCompanySheets`, `SentMonth`.
- Produces:

```ts
/** Why `month` cannot be marked sent, or null when it can. */
export function sendRefusal(sheets: readonly MonthSheet[], month: string): "empty" | "earlier_open" | "already_sent" | null;
/** Why `month` cannot be marked not sent, or null when it can. */
export function unsendRefusal(sheets: readonly MonthSheet[], month: string): "not_sent" | "later_sent" | null;
/** The charge ids a `send` stores: every printed charge of the month. */
export function sheetChargeIds(sheet: MonthSheet): string[];
```

Walk changes (spec "The sent lock"):
- A charge whose id is in any sent list belongs to that sent month only: it never joins a waiting list, whatever its date or state.
- A sent month's `printed` = the listed charges still in scope (not deleted/cancelled), grouped by patient; `sent` = the `SentMonth`. No computed printing in a sent month: every patient with waiting charges there is `held` (reason as usual) and carries.
- `earlier_open`: an earlier month has `printed.length > 0` and `sent === null`.

- [ ] **Step 1: Write the failing tests**

```ts
// frozen against a reopened treatment
c1 in sent {month:"2026-11", chargeIds:["c1"]}, its card now "Ongoing" → Nov printed ["c1"], sent != null; Dec has no p1
// frozen against a switch
same + marks {"p1__2026-11":"hold"} → Nov printed ["c1"]
// back-dated charge waits for the next month
sent Nov ["c1"]; c2 dated 2026-11-20 done 2026-11-20 → Nov printed ["c1"], Nov held has c2; Dec printed ["c2"]
// moved charge stays on its sent month (Review Focus 3)
sent Nov ["c1"]; c1's date now 2026-12-02 → Nov printed ["c1"]; Dec printed []
// deleted charge drops off
sent Nov ["c1","c2"]; c2 status "deleted" → Nov printed charges ["c1"]
// refusals
sendRefusal: empty month → "empty"; Dec while Nov printed and unsent → "earlier_open"; sent month → "already_sent"; else null
unsendRefusal: unsent → "not_sent"; Nov while Dec sent → "later_sent"; else null
sheetChargeIds(Nov sheet with p1[c1,c2], p2[c3]) → ["c1","c2","c3"]
```

- [ ] **Step 2: Run to verify it fails** — `npm run --silent test:company-sheet`, new checks FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify it passes** — all checks pass.
- [ ] **Step 5: Commit** — `git commit -am "Company sheet: a sent month is frozen"`

---

### Task 3: The statement for a date range

**Files:**
- Modify: `src/lib/insurance/companySheet.ts`
- Test: `tests/companySheet.test.mts`

**Interfaces:**
- Consumes: `buildInsuranceStatement`, `statementLineText`, `Statement`, `StatementCase` from `@/lib/insuranceStatement`; `monthsBetween`.
- Produces:

```ts
/** Sheets with only the charges `keep` accepts; a patient left with none is dropped. */
export function scopeSheets(sheets: readonly MonthSheet[], keep: (charge: SheetCharge) => boolean): MonthSheet[];

/**
 * The company's statement for [start, end]: today's per-visit cases for the part of the range
 * before 2026-11-01, then one case per printed patient for each month the range touches from
 * 2026-11 on. Serials run through; `total` is the sum.
 */
export function companyStatement(args: SheetInputs & {
  payerId: string; payerName: string;
  range: { start: string; end: string };
  memberNumbers: ReadonlyMap<string, string>;
  keep?: (charge: SheetCharge) => boolean;   // the branch on screen; applied after the walk
}): { statement: Statement; sheets: MonthSheet[] };   // sheets: the touched months, scoped
```

- Legacy part: `buildInsuranceStatement({ rows: charges filtered by keep, payerId, payerName, month, range: { start, end: min(end, "2026-10-31") }, memberNumbers })`, only when `start < "2026-11-01"`. Rows are passed as given (no amount remapping), so old months print exactly as today.
- Sheet part: a case per `SheetPatient`: `date` = earliest charge date, `lines` = `{ text: statementLineText(charge), amount: cost||amount, rowId: charge.id }` in charge-date order, `subtotal` = sum.
- `statement.month` = `range.start.slice(0, 7)`. `missingMemberNumber` covers both parts, each patient once.

- [ ] **Step 1: Write the failing tests**

```ts
// one case per patient per month, old + new together
p1 with c1 (Nov 5) and c2 (Nov 12), both done → range Nov 1–30: statement.cases.length == 1, lines.length == 2, subtotal == 200
// partial range prints the whole month
range 2026-11-01..2026-11-15 with c2 done Nov 20 → cases.length == 1, lines.length == 2
// two months touched
range Nov 1–Dec 31, p1 printed Nov, p2 printed Dec → cases serials [1,2], sheets.map(month) == ["2026-11","2026-12"]
// legacy untouched
charges dated 2026-10-10 and 2026-10-10 (same patient, same day) + 2026-10-20, range Oct 1–31
  → deepEqual to buildInsuranceStatement(...).cases for the same rows and range; sheets == []
// range across the start
range 2026-10-15..2026-11-30 → legacy cases first (dates ≥ Oct 15), then November's
// branch filter after the walk (Review Focus 4)
p1: c1 branch "A" done, c2 branch "B" Ongoing; keep = branch "A" → Nov cases == [], sheets[0].held.length == 1 with charges ["c1"]
// held prints nothing
unfinished p1 → statement.cases == [], total == 0
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify it passes**, and `npm run --silent test:insurance-statement` and `test:insurance-statement-gasco` still pass.
- [ ] **Step 5: Commit** — `git commit -am "Company sheet: the statement for a date range"`

---

### Task 4: Server reads

**Files:**
- Create: `src/lib/server/companySheetData.ts`

**Interfaces:**
- Consumes: `adminClinicCollection`, `adminClinicDoc` from `@/lib/adminClinicDb`; Task 1 types.
- Produces:

```ts
export const marksDocId = (payerId: string) => `company_sheet_${payerId}`;
export const sentDocId = (payerId: string, month: string) => `company_sheet_${payerId}_${month}`;
/** Everything the walk needs for one company, read with the Admin SDK. */
export async function loadCompanySheetInputs(clinicId: string, payerId: string): Promise<SheetInputs>;
```

- Charges: `ledger` where `payerId ==` and `type == "procedure"` (the two-equality query `InsurerTab` already uses, no index), then `date >= "2026-11-01"` in memory.
- Cards: `clinical_notes` by document id for each charge's `clinicalNoteId` (`getAll`, chunks of 100), plus continuations: `where("continuedFromNoteId", "in", chunk)` in chunks of 30, repeated on the newly found ids until none are new (cap 5 rounds).
- Marks: `settings/company_sheet_<payerId>` → `marks` (keep only `"include"`/`"hold"` values).
- Sent: `settings` documents whose id is in `[sentDocId(payerId, "0000-00"), sentDocId(payerId, "9999-99")]` (document-id range), each parsed to `SentMonth`; skip one whose `payerId` field differs (a payer id that is a prefix of another).

No test of its own: Task 5's emulator test runs it through the route.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit -p .` Expected: no new errors.
- [ ] **Step 3: Commit** — `git add src/lib/server/companySheetData.ts && git commit -m "Company sheet: server reads"`

---

### Task 5: The route

**Files:**
- Create: `src/app/api/insurance/company-sheet/route.ts`
- Test: `tests/companySheetRoute.test.mts`
- Modify: `package.json` (`"test:company-sheet-route": "npx tsx tests/companySheetRoute.test.mts"`), `.github/workflows/ci.yml` (an `emulators:exec` step next to `test:insurance-line-dates-route`, same form)

**Interfaces:**
- Consumes: `loadCompanySheetInputs`, `marksDocId`, `sentDocId`; `buildCompanySheets`, `sendRefusal`, `unsendRefusal`, `sheetChargeIds`, `markKey`, `COMPANY_SHEET_START`; `requireStaffPermission`, `clinicHasFeature`, `findPayer`, `parsePayers`, `isInsurerFormat`, `PRIVATE_PAYER_ID`; `logActivityServer` from `@/lib/server/systemLog`; `clinicTimeZone`, `ymdInTimeZone`.
- Produces: `POST` with body `{ clinicId, action: "mark" | "send" | "unsend", payerId, month, patientId?, choice? }`.

| Case | Answer |
|---|---|
| missing/invalid field, `month` not `yyyy-mm` or `< 2026-11`, `month` after the clinic's current month | 400 |
| not staff / no `patients.edit` | the `requireStaffPermission` response |
| add-on off | 403 `{ reason: "feature_locked" }` |
| payer missing, inactive, private, or has a document format | 400 |
| `mark` on a sent month | 409 `{ reason: "sent_locked" }` |
| `mark` `"include"` while the patient has a waiting treatment not done | 409 `{ reason: "not_finished" }` |
| `send` refused | 409 `{ reason: "empty" \| "earlier_open" \| "already_sent" }` |
| `unsend` refused | 409 `{ reason: "not_sent" \| "later_sent" }` |
| done | 200 `{ ok: true }` |

- `mark`: `choice` is `"include"`, `"hold"` or `null`. Write `marks.<key>` with `set(..., { merge: true })`; `null` uses `FieldValue.delete()`. Stamp `updatedAt`, `updatedBy`.
- `send`: recompute with `through = month`; write the sent document with `.create()` (a second concurrent send fails → 409 `already_sent`): `{ payerId, month, chargeIds, cases, total, sentAt: serverTimestamp, sentBy, sentByName }`.
- `unsend`: delete the sent document.
- One `logActivityServer` row per successful action, naming the company, the month and (for `mark`) the patient.
- Errors go through `reportServerError`; the handler never throws.

- [ ] **Step 1: Write the failing test**

Harness copied from `tests/insuranceLineDatesRoute.test.mts` (fake auth lookup server, `idToken`, emulator env, project `demo-company-sheet`). Seed clinic `C1`: an admin staff user; `settings/payers` with contract payer `gasco` (active, no format) and `metlife` (with a format); the `insurance` feature on; ledger charges and cards, all dated 2026-11, for p1 (one treatment, done 2026-11-05) and p2 (one done, one Ongoing). The fixed month `2026-11` is never after the clinic's current month, so the "future month" 400 does not interfere.

```ts
mark hold p1 2026-11            → 200; settings/company_sheet_gasco marks["p1__2026-11"] == "hold"
mark null p1 2026-11            → 200; key absent
mark include p2 2026-11         → 409 not_finished
mark on payer metlife           → 400
mark month "2026-10"            → 400
send 2026-11                    → 200; settings/company_sheet_gasco_2026-11.chargeIds == [p1's charge id] (server's own list)
send 2026-11 again              → 409 already_sent                      (Review Focus 5)
mark hold p1 2026-11            → 409 sent_locked                       (Review Focus 5)
unsend 2026-11                  → 200; document gone
send on a month with no printed → 409 empty
no token                        → 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx firebase-tools@13 emulators:exec --only firestore "npm run --silent test:company-sheet-route"` (locally the cached emulator jar via `java` works too; see the header of `tests/insuranceLineDatesRoute.test.mts`).
Expected: FAIL, route module missing.

- [ ] **Step 3: Implement the route.**
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add src/app/api/insurance/company-sheet tests/companySheetRoute.test.mts package.json .github/workflows/ci.yml
git commit -m "Company sheet: route for the switch and the sent lock"
```

---

### Task 6: Browser data, panel, Insurance page and Finance tab

**Files:**
- Create: `src/components/insurance/useCompanySheet.ts`, `src/components/insurance/CompanySheetPanel.tsx`
- Modify: `src/components/insurance/api.ts`, `src/components/insurance/text.ts`, `src/components/finance/InsurerTab.tsx`, `src/app/(dashboard)/insurance/page.tsx`

**Interfaces:**
- Consumes: `companyStatement`, `SheetInputs`, `MonthSheet`, `SheetChoice`; `rowInScope` from `@/lib/branchAccess`; the existing `call()` in `api.ts`.
- Produces:

```ts
// useCompanySheet.ts
/** Live cards, marks and sent months for a company's charges. `charges`: every charge of the company, all branches. */
export function useCompanySheet(clinicId: string | null, payerId: string, charges: readonly SheetCharge[] | null): { inputs: SheetInputs | null; failed: boolean };
/** Every procedure charge of one company, live (for screens that do not already hold them). */
export function useCompanyCharges(payerId: string): SheetCharge[] | null;

// api.ts — each resolves to null on success, else the refusal's `reason` (or "failed")
export async function markCompanySheet(clinicId: string, payerId: string, patientId: string, month: string, choice: SheetChoice | null): Promise<string | null>;
export async function sendCompanySheet(clinicId: string, payerId: string, month: string): Promise<string | null>;
export async function unsendCompanySheet(clinicId: string, payerId: string, month: string): Promise<string | null>;

// CompanySheetPanel.tsx
export default function CompanySheetPanel(props: { clinicId: string; payerId: string; payerName: string; sheets: MonthSheet[] }): JSX.Element | null;
```

- `useCompanySheet`: cards by `onSnapshot` on `clinical_notes` where `documentId() in chunk` and where `continuedFromNoteId in chunk` (chunks of 30, the `livePayments` pattern in `InsurerTab`), growing the id set with newly found continuations until stable; marks by `onSnapshot` on `settings/company_sheet_<payerId>`; sent months by `onSnapshot` on the `settings` document-id range of Task 4. Only charges dated `>= 2026-11-01` are looked up. `inputs` is null until all three have answered once. The clinic id is passed in (a clinic switch re-subscribes).
- `InsurerTab`: the `statement` memo becomes `companyStatement({ ...inputs, charges: backlog (not deleted/cancelled, all branches, mapped `amount: cost || amount` as today), payerId, payerName, range: statementPeriod, memberNumbers: new Map(), keep: (c) => rowInScope(c, scopeBranchId) }).statement`; while `inputs` is null the Excel button is disabled. If the backlog listener failed (`backlogFailed`), fall back to today's `buildInsuranceStatement` call unchanged. New prop `sheetPanel?: boolean`: when true and `statementPeriod` is set, render `<CompanySheetPanel sheets={…the same call's sheets…} />` above the figures.
- Insurance page: pass `sheetPanel` on the contract company's `InsurerTab`. Finance page: no change (no panel, same Excel).
- Panel, per `MonthSheet`: month title; "Sent on {date} by {name}" + **Mark not sent**, or **Mark as sent** (through `useUI().confirm`); list "On this month's sheet" (name linking to the patient file, treatments joined with " + ", value, switch); list "Waiting" (same columns + the reason; switch only for `finished_late` and `moved`); "Automatic" link when `choice !== null`. Everything disabled on a sent month. Buttons and switches only inside `<Protect permission="patients.edit">`. A refusal's reason maps to a toast string. Empty month: one muted line. Follow the page's existing look (`rounded-3xl border border-line bg-surface`, `font-figure` for money, `max-lg:min-h-10` tap targets); rows stack below `lg`.
- Strings (EN / AR) added to `text.ts`: sheet title (`{month} sheet` / `تقفيلة {month}`), on-sheet heading, waiting heading, `This month` / `الشهر ده`, `Next month` / `الشهر الجاي`, `Not finished` / `لسه مخلصش`, `Finished after the month` / `خلص بعد الشهر`, `Moved by the dentist` / `الدكتور أجّله`, `Automatic` / `تلقائي`, `Mark as sent`, `Mark not sent` (reuse the existing keys' wording), sent-on line, confirm text, and one toast per refusal reason (`sent_locked`, `not_finished`, `empty`, `earlier_open`, `later_sent`, `failed`).

- [ ] **Step 1: Implement `api.ts` calls, `useCompanySheet.ts`, strings.**
- [ ] **Step 2: Implement `CompanySheetPanel.tsx`.**
- [ ] **Step 3: Wire `InsurerTab` and the Insurance page.**
- [ ] **Step 4: Typecheck and lint** — `npx tsc --noEmit -p .` and `npm run lint`. Expected: no new errors.
- [ ] **Step 5: Check in the browser on the demo clinic** (memory notes "demo-clinic" and "worktree-preview-in-browser-pane"): add a contract payer if the demo clinic has none, charge two treatments to it for one patient (one Done, one Planned) and one Done treatment for another. Expected: second patient on November's sheet, first under Waiting "Not finished" with no switch; mark the Planned one Done → he moves onto the sheet; switch him to Next month → Waiting "Moved by the dentist", Excel count drops by one; Mark as sent → switches disabled; Mark not sent → back. Check at phone width and in Arabic. Screenshot the panel.
- [ ] **Step 6: Commit** — `git add -A src && git commit -m "Company sheet: panel with the switch and the sent lock on the Insurance page"`

---

### Task 7: Reports tab and the phone document

**Files:**
- Modify: `src/components/reports/InsuranceStatementReport.tsx`, `src/lib/reports/documents.ts`, `src/app/api/reports/route.ts`
- Test: `tests/reportDocuments.test.mts`

**Interfaces:**
- Consumes: `companyStatement`, `SheetInputs`; `useCompanyCharges`, `useCompanySheet`; `loadCompanySheetInputs`.
- Produces: `ReportInputs.companySheets?: Record<string, SheetInputs>` (by payer id).

- `InsuranceStatementReport`: when the picked payer is a contract company, `statement = companyStatement({ ...inputs, charges, payerId, payerName, range: { start: `${month}-01`, end: lastDayOf(month) }, memberNumbers }).statement` from the two hooks; a loading line until `inputs` arrives. Approval insurers keep `buildInsuranceStatement`. The Excel layout is unchanged.
- `api/reports/route.ts`: when `meta.id === "insurance"`, load `loadCompanySheetInputs` for each active contract payer and pass them as `companySheets`.
- `documents.ts`, case `"insurance"`: for a payer with an entry in `input.companySheets`, `st = companyStatement({ ...entry, payerId, payerName, range, memberNumbers }).statement`; otherwise today's call. The table and totals code below it is unchanged.

- [ ] **Step 1: Write the failing test** in `tests/reportDocuments.test.mts`, next to the existing insurance-document checks:

```ts
// contract company follows the sheet
inputs.companySheets = { gasco: { charges: [done c1 for p1, Ongoing c2 for p2, both 2026-11], cards: [...], marks: {}, sent: [] } }
range 2026-11-01..2026-11-30 → the gasco table has p1's line only; its total == c1's cost
// no entry → unchanged
same inputs without companySheets → the gasco table equals today's output (both patients)
```

- [ ] **Step 2: Run to verify it fails** — `npm run --silent test:report-docs`.
- [ ] **Step 3: Implement the three changes.**
- [ ] **Step 4: Run** `npm run --silent test:report-docs` and `npx tsc --noEmit -p .`. Expected: pass, no new errors.
- [ ] **Step 5: Browser check**: Reports → Insurance statement, the contract company, November: same cases as the Insurance page's panel.
- [ ] **Step 6: Commit** — `git commit -am "Company sheet: Reports tab and the phone report follow it"`

---

### Task 8: Whole-branch check

- [ ] **Step 1:** Run `npm run --silent test:company-sheet`, `test:insurance-statement`, `test:insurance-statement-gasco`, `test:report-docs`, `test:insurer-ledger`, and the route test on the emulator. Expected: all pass.
- [ ] **Step 2:** `npx tsc --noEmit -p .` and `npm run lint`. Expected: no new errors against `origin/main`.
- [ ] **Step 3:** Read-only check against DENT INN's live data (clinic `eaByOyGzC5iA17CjKMui`, a script in the scratchpad that calls `loadCompanySheetInputs` + `buildCompanySheets` and prints counts only): November's printed and held patient counts for each contract payer, and that the legacy statement for October equals `buildInsuranceStatement` for October. Writes nothing.
- [ ] **Step 4:** Report to the owner: what changed, the DENT INN November numbers, the screenshots. Ask before any push (live-clinics safety gate).
