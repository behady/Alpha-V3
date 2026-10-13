# Activity Log v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every action in the system writes a structured, readable activity entry. A new Activity page and a patient-file tab show who touched money, who gave which discount, what happened to insurance approvals, a patient's story, and a staff member's day.

**Architecture:**
- A pure catalogue (`src/lib/activity/`) defines event keys, categories, the "worth a look" flag rule, Arabic and English sentences, and diff helpers.
- Two thin writers (client `logEvent`, server `logEventServer`) store each event alongside today's legacy fields.
- Server routes emit money and insurance events; screens emit appointment, patient, lab, team and settings events.
- One `ActivityFeed` component, driven by pure feed functions, renders the Settings page and the patient tab.

**Tech Stack:** Next.js (app router), TypeScript, Firebase JS SDK (client), firebase-admin (API routes), Tailwind, `npx tsx` tests with `node:assert/strict`, and the Firestore emulator for route tests.

**Spec:** `docs/superpowers/specs/2026-10-13-activity-log-v2-design.md`

**Where to work:** worktree `C:/Users/PC/AppData/Local/Temp/claude/C--Users-PC-Downloads-alpha-dental-system-v3/b5cd7e89-3311-47c1-9344-cb478610fe04/scratchpad/wt-logs`, branch `claude/activity-log-v2` (based on origin/main).
- Junction `node_modules` from the Downloads checkout before running anything: `cmd /c mklink /J node_modules C:\Users\PC\Downloads\alpha-dental-system-v3\node_modules`.
- Remove it with `rmdir`, never `rm -rf`.
- Never edit the Downloads checkout.

## Global Constraints

- **Legacy fields stay.** Every entry still writes `userId, userName, userRole, user, action, details, severity, module, timestamp, date`. The phone app's `loadLogs` and the MCP connector read `action`/`details`, so these must be a readable English sentence with no raw ids.
- **New fields:** `v: 2, event, categories, flag, patientId, patientName, amount, changes, reason, branchId, groupId, refs`.
- **Firestore rejects `undefined`.** Every write passes through `stripUndefined`.
- **Old entries are never rewritten.**
- **Money display:** `n.toLocaleString("en-US")`, followed by `ج` in Arabic or `EGP` in English.
- **Dates:** days and ranges are bucketed on `clinicTimeZone()` (Africa/Cairo), never on the device clock or UTC.
- **No raw ids** (20- or 28-character Firestore ids) are ever shown to a person.
- **Access:** the page and the patient tab are owner/admin only (`isAdmin` from `useClinic()`). The patient tab is also hidden in chair mode.
- **Sentences never conjugate a verb to the actor's gender.** The actor is rendered separately: **name** · sentence.
- **Style:** yellow (`bg-accent`) is a fill only; figures use `font-figure`; the slab uses `bg-ink-slab text-white`.
- **No change to how money is written:** routes change only what they log, plus returning values they already compute inside transactions.
- **CRLF:** edit existing files with targeted edits; never rewrite a whole file through a script that writes LF.
- **Emulator route tests:** start the cached jar first, then run with the env var set. The two commands are:
  - `java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar --host 127.0.0.1 --port 8085`
  - `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run <script>`

## Review Focus

1. **Old or partial records** (no `patientName`, `listPrice` 0 or missing, amount missing). The sentence must never show `undefined`, `NaN` or `null`, and the below-list flag must not fire when `listPrice` is 0 or missing. Tested in Task 1.
2. **Insurance rows** are priced from a payer list, not a cash discount. A procedure carrying `refs.claimId` is never flagged as "below list". Tested in Task 1.
3. **Removing a discount** (200 → 0) must read as `discount.removed` for 200, not "discount 0" or "discount -200". Tested in Task 3.
4. **An entry written at 23:30 Cairo on 13 Oct** (20:30Z) must land under 13 Oct in "Today" on the 13th, and in "Yesterday" on the 14th. Tested in Task 7.
5. **A no-op or notes-only autosave** writes nothing, and a status change made by a status button is logged once, not twice. Tested in Task 5.

---

### Task 1: Event catalogue and diff helpers (pure)

**Files:**
- Create: `src/lib/activity/types.ts`, `src/lib/activity/catalogue.ts`, `src/lib/activity/legacy.ts`, `src/lib/activity/diff.ts`
- Modify: `src/components/settings/ActivityLogs.tsx`. Move `ACTION_AR`, `AI_VERB_AR`, `AI_RECORD_AR`, `actionLabel`, `RAW_ID`, `readableDetails`, `MODULE_AR`, `ROLE_AR` into `legacy.ts` and export them; import them back so the page still works until Task 7.
- Test: `tests/activityCatalogue.test.mts`; add the script `"test:activity": "npx tsx tests/activityCatalogue.test.mts"`.

**Interfaces (produced, used by every later task):**
```ts
// types.ts
export type Category = "money"|"discount"|"insurance"|"appointment"|"patient"|"clinical"|"lab"|"team"|"settings"|"system";
export type Scalar = string | number | boolean | null;
export type Change = { field: string; from: Scalar; to: Scalar };
export type EventKey =
  | "procedure.added"|"procedure.edited"|"procedure.deleted"|"procedure.moved"|"procedure.continued"
  | "payment.received"|"payment.edited"|"payment.deleted"
  | "expense.added"|"expense.edited"|"expense.deleted"|"income.added"|"income.edited"|"income.deleted"
  | "commission.changed"|"labfee.corrected"
  | "staff.paid"|"staff.payout.edited"|"staff.payout.deleted"
  | "staff.deduction.added"|"staff.deduction.edited"|"staff.deduction.removed"|"staff.edited"
  | "discount.given"|"discount.changed"|"discount.removed"
  | "insurance.created"|"insurance.status"|"insurance.edited"|"insurer.collected"
  | "appointment.created"|"appointment.edited"|"appointment.status"|"appointment.moved"|"appointment.deleted"
  | "patient.created"|"patient.edited"|"patient.deleted"|"patient.restored"
  | "record.deleted"|"record.restored"|"record.purged"
  | "plan.created"|"plan.edited"|"plan.deleted"|"plan.status"|"media.uploaded"
  | "lab.created"|"lab.edited"|"lab.status"|"lab.remake"|"lab.deleted"|"lab.paid"|"lab.payment.deleted"
  | "settings.branches"|"settings.services"|"settings.insurers"|"settings.labs";
export type Refs = Partial<Record<
  "appointmentId"|"ledgerId"|"noteId"|"claimId"|"labCaseId"|"staffId"|"staffName"|"payerName"
  |"receiptNumber"|"method"|"procedure"|"date"|"time"|"doctor"|"approvalNumber"|"labName"|"status"|"count",
  string | number>>;
export interface ActivityEvent {
  event: EventKey;
  patientId?: string | null; patientName?: string | null;
  amount?: number | null;
  changes?: Change[];
  reason?: string | null;
  branchId?: string | null;
  groupId?: string | null;
  refs?: Refs;
}
export type AuditUser = { uid?: string | null; name?: string | null; role?: string | null };
/** Any system_logs doc as read back: a v2 entry or a legacy one. */
export type ActivityLogDoc = Partial<ActivityEvent> & {
  id: string; v?: 2; categories?: Category[]; flag?: boolean;
  userId?: string | null; userName?: string; user?: string; userRole?: string | null;
  action?: string; details?: string; severity?: string; module?: string; actor?: string;
  date?: string; timestamp?: { toDate?: () => Date } | Date | null;
};

// catalogue.ts
export function categoriesOf(e: ActivityEvent): Category[];
export function isFlagged(e: ActivityEvent): boolean;
export function sentence(e: ActivityEvent, lang: "ar" | "en"): string;      // actor NOT included
export function fieldLabel(field: string, lang: "ar" | "en"): string;
export function money(n: number, lang: "ar" | "en"): string;               // "1,200 ج" / "1,200 EGP"
export function storedFields(e: ActivityEvent): {                         // what both writers persist
  v: 2; categories: Category[]; flag: boolean; action: string; details: string;
  severity: "HIGH" | "MEDIUM"; module: string;
};
export function describeLog(log: ActivityLogDoc, lang: "ar" | "en"): string; // v2 → sentence; legacy → actionLabel + readableDetails
export function categoriesOfLog(log: ActivityLogDoc): Category[];            // v2 → categories; legacy → from module
export function stripUndefined<T>(value: T): T;                              // deep; drops undefined keys and array holes

// diff.ts
export function diffChanges(prev: Record<string, unknown>, next: Record<string, unknown>, fields: readonly string[]): Change[];
```

**Decisions the implementer must follow:**
- **Categories:** the base category comes from the key prefix:
  - `procedure|payment|expense|income|commission|labfee|staff.paid|staff.payout` → money
  - `staff.deduction` → money + team
  - `staff.edited` → team
  - `discount` → discount + money
  - `insurance` → insurance
  - `insurer.collected` → insurance + money
  - `appointment` → appointment
  - `patient|record` → patient
  - `plan|media` → clinical
  - `lab` → lab, and `lab.paid` → lab + money
  - `settings` → settings

  On top of that, `procedure.added|edited` also gets **discount** when below the list (rule below) or when it has a `discount` change, and **insurance** when `refs.claimId` is set.
- **Below the list:** a `price` change, or a `refs` pair, where the list price is greater than 0 and the price is lower. The list price comes from `changes` field `listPrice`, or from the change `price` `from` on add. Simplest: on `procedure.added` the route passes `changes: [{field:"listPrice", from:null, to:list}, {field:"price", from:null, to:cost}]`. Never applies when `refs.claimId` is set.
- **Flag (`isFlagged`) is true for:**
  - every `discount.*`
  - `procedure.added|edited` below the list
  - `procedure.deleted`, `payment.edited`, `payment.deleted`
  - `expense.edited|deleted`, `income.edited|deleted`
  - `commission.changed`, `labfee.corrected`
  - `staff.payout.edited|deleted`, `staff.deduction.edited|removed`
  - `insurance.status` whose `to` is `cancelled`
  - `appointment.deleted`, `patient.deleted`, `record.deleted`, `record.purged`
  - `lab.deleted`, `lab.payment.deleted`

  Everything else is false.
- **`storedFields`:** `module` is the first category, mapped as money/discount → "finance", appointment → "appointments", patient → "patients", clinical → "clinical", team → "users", lab → "system", insurance → "finance", settings → "settings". `severity` is `flag ? "HIGH" : "MEDIUM"`. `action` is a short English title such as "Discount Given" or "Payment Received". `details` is `sentence(e, "en")`.
- **Sentences:** the patient name defaults to `"مريض"` / `"a patient"`. A change with both `from` and `to` null renders as its label alone. A change renders as `label from → to`. Amounts use `money()`. Payment methods are mapped through the app's existing method labels; find them with `grep -rn "Vodafone\|InstaPay" src/lib`, and if no map exists, use `Cash→كاش, Card→فيزا, Bank Transfer→تحويل بنكي, InstaPay→انستاباي, Vodafone Cash→فودافون كاش`, otherwise the raw value.
- **`diffChanges`:**
  - Compares after normalising: Firestore `Timestamp` and `Date` → ISO date `YYYY-MM-DD`; numeric strings → numbers; `""`/`undefined`/`null` → `null`; trimmed strings.
  - Omits unchanged fields and keeps the order of `fields`.
  - Arrays and objects are compared by `JSON.stringify`, and are reported with `from`/`to` set to null (label only).

- [ ] **Step 1: Write the failing tests** in `tests/activityCatalogue.test.mts`, following the style of `tests/dayBounds.test.mts` (`assert` from `node:assert/strict`, `ok()` counter, `// --- n.` blocks). Exact assertions:
```ts
const disc = { event: "discount.given", amount: 200, patientName: "عمر حسام علي",
  refs: { procedure: "حشو كومبوزيت" }, changes: [{ field: "price", from: 1500, to: 1300 }], reason: "قريب الدكتور" } as const;
assert.equal(sentence(disc, "ar"), "خصم 200 ج لـ عمر حسام علي على حشو كومبوزيت (1,500 → 1,300) · السبب: قريب الدكتور");
assert.equal(sentence(disc, "en"), "Discount 200 EGP for عمر حسام علي on حشو كومبوزيت (1,500 → 1,300) · Reason: قريب الدكتور");
assert.equal(isFlagged(disc), true);
assert.deepEqual(categoriesOf(disc), ["discount", "money"]);
const pay = { event: "payment.received", amount: 800, patientName: "عمر حسام علي",
  refs: { method: "Cash", procedure: "حشو اطفال", receiptNumber: "R-2026-0035" } } as const;
assert.equal(sentence(pay, "ar"), "استلام 800 ج كاش من عمر حسام علي · حشو اطفال · إيصال R-2026-0035");
assert.equal(isFlagged(pay), false);
// Review focus 1: missing fields never leak
const bare = { event: "payment.deleted" } as const;
for (const lang of ["ar", "en"] as const) assert.ok(!/undefined|NaN|null/.test(sentence(bare, lang)));
// Review focus 1+2: below-list rule
const added = (list: number | null, cost: number, claimId?: string) => ({ event: "procedure.added", amount: cost,
  changes: [{ field: "listPrice", from: null, to: list }, { field: "price", from: null, to: cost }],
  refs: claimId ? { claimId } : {} }) as const;
assert.equal(isFlagged(added(1500, 1300)), true);
assert.ok(categoriesOf(added(1500, 1300)).includes("discount"));
assert.equal(isFlagged(added(0, 1300)), false);
assert.equal(isFlagged(added(null, 1300)), false);
assert.equal(isFlagged(added(1500, 900, "claim1")), false);
assert.ok(categoriesOf(added(1500, 900, "claim1")).includes("insurance"));
assert.equal(isFlagged({ event: "insurance.status", changes: [{ field: "status", from: "approved", to: "cancelled" }] }), true);
assert.equal(isFlagged({ event: "insurance.status", changes: [{ field: "status", from: "approved", to: "treated" }] }), false);
// every key renders in both languages with no leaks
for (const key of ALL_EVENT_KEYS) for (const lang of ["ar", "en"] as const)
  assert.ok(sentence({ event: key }, lang).length > 0 && !/undefined|NaN/.test(sentence({ event: key }, lang)));
// storedFields
const sf = storedFields(disc);
assert.equal(sf.v, 2); assert.equal(sf.severity, "HIGH"); assert.equal(sf.module, "finance");
assert.ok(!/[A-Za-z0-9]{20}/.test(sf.details));
// legacy fallback
assert.equal(describeLog({ id: "x", action: "Payment Received", details: "800 EGP from عمر toward n7EuTEtedn3m3QDHjpi8" }, "en"),
  "Payment Received · 800 EGP from عمر");
assert.deepEqual(categoriesOfLog({ id: "x", module: "appointments" }), ["appointment"]);
// stripUndefined
assert.deepEqual(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, undefined] } }), { a: 1, c: { e: [1] } });
// diffChanges
assert.deepEqual(diffChanges({ time: "05:00 PM", notes: "x", cost: "1500" }, { time: "06:30 PM", notes: "y", cost: 1500 }, ["time", "cost"]),
  [{ field: "time", from: "05:00 PM", to: "06:30 PM" }]);
assert.deepEqual(diffChanges({ a: "" }, { a: null }, ["a"]), []);
```
`ALL_EVENT_KEYS` is exported from `catalogue.ts` as `readonly EventKey[]`.

The legacy form is `actionLabel(action, isAr) + " · " + readableDetails(details)`, or the action label alone when the details are empty.

- [ ] **Step 2: Run** `npm run test:activity`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts`, `diff.ts`, `legacy.ts` (moved code, unchanged behaviour) and `catalogue.ts`. Point `ActivityLogs.tsx` at `legacy.ts`.
- [ ] **Step 4: Run** `npm run test:activity` → all pass. Run `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "Activity log: event catalogue, sentences and diff helpers"`

---

### Task 2: Writers

**Files:**
- Modify: `src/lib/logger.ts` (add `logEvent`), `src/lib/server/systemLog.ts` (add `logEventServer`), `src/lib/server/ledgerAudit.ts` (`recordMoneyChange` accepts `event`)
- Create: `src/lib/server/patientName.ts`
- Test: covered by the route tests in Tasks 3 and 4. This task's own check is `tsc` plus one emulator smoke check (step 1).

**Interfaces:**
- Consumes: `ActivityEvent`, `AuditUser`, `storedFields`, `stripUndefined` (Task 1).
- Produces:
```ts
// client, src/lib/logger.ts
export async function logEvent(user: AuditUser | null | undefined, e: ActivityEvent): Promise<void>;
// server, src/lib/server/systemLog.ts
export async function logEventServer(args: { clinicId: string; user: AuditUser; event: ActivityEvent }): Promise<void>;
// src/lib/server/ledgerAudit.ts — existing signature extended; when `event` is given, `action`/`details`/`severity` are ignored
export async function recordMoneyChange(args: { entry: LedgerAuditEntry; action?: string; details?: string;
  severity?: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"; event?: ActivityEvent }): Promise<void>;
// src/lib/server/patientName.ts
export async function patientNameOf(clinicId: string, patientId: string | null | undefined): Promise<string | null>;
```
- **`logEvent`:**
  - Writes the legacy fields (as `logActivity` does) plus the event and `storedFields(e)`, through `stripUndefined`.
  - If the event has no `branchId`, it uses `currentBranchId() || null`, from `src/lib/branchScope.ts`.
  - Never throws.
- **`logEventServer`:** the same, using `adminClinicCollection` and `FieldValue.serverTimestamp()`. `date` is `ymdInTimeZone(clinicTimeZone())`, from `src/lib/clinicDate.ts`; the existing writers use UTC, so do not copy that.
- **`patientNameOf`:** an admin read of `clinics/{id}/patients/{pid}` returning `name`, or null. It never throws.

- [ ] **Step 1: Write** `tests/activityWriters.test.mts`, an emulator test that copies the harness from `tests/branchMoneyRoutes.test.mts` lines 26-109. It calls `logEventServer({clinicId, user:{uid:"u1",name:"Malak",role:"Assistant"}, event: {event:"payment.received", amount: 800, patientName: "عمر", refs:{ method: "Cash" }, reason: undefined as any}})`, then reads the newest `system_logs` doc. Asserts:
  - `v===2`
  - `categories` deep-equals `["money"]`
  - `flag===false`
  - `action==="Payment Received"`
  - `details` contains `"800 EGP"`
  - `userName==="Malak"`
  - `"reason" in doc === false`
  - `date` matches `/^\d{4}-\d{2}-\d{2}$/`

  Add the script `"test:activity-writers": "npx tsx tests/activityWriters.test.mts"`.
- [ ] **Step 2: Run** with the emulator up. Expected: FAIL (`logEventServer` not exported).
- [ ] **Step 3: Implement** the four functions.
- [ ] **Step 4: Run** the test → pass. Run `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `git commit -m "Activity log: client and server event writers"`

---

### Task 3: Money events (procedures and ledger routes)

**Files:**
- Modify: `src/app/api/clinical/procedures/route.ts`, `src/app/api/finance/ledger/route.ts`, `src/lib/moneyApi.ts` (`updateLedgerRow` meta), `src/components/appointments/AppointmentMoneyTab.tsx` (`handleDiscount` sends `groupId`), `src/components/QuickPaymentModal.tsx` (delete the client log at 210-216 and its now-unused import)
- Test: `tests/activityMoneyRoutes.test.mts`; script `"test:activity-money-routes"`

**Interfaces:**
- Consumes: `recordMoneyChange({entry, event})`, `logEventServer`, `patientNameOf` (Task 2); `diffChanges` (Task 1).
- Produces: `updateLedgerRow(id: string, patch: Record<string, unknown>, clinicId?: string | null, meta?: { groupId?: string }): Promise<...>`. It posts `groupId` at the top level of the body. The ledger route `updateRow` reads `body.groupId` (a string of at most 64 characters, otherwise ignored).

**Replace each existing `recordMoneyChange` call's `action`/`details` with an `event`.** Call-site line numbers are as on origin/main 608c9243. In every case, `branchId` is the route's `branch.branchId` where present, otherwise the row's `branchId`.

| Site | Event | Fields |
|---|---|---|
| procedures create (≈489) | `procedure.added` | patientId, patientName `result.patientName`, amount `priced.pricing.cost`, changes `[listPrice null→priced.pricing.listPrice, price null→cost]`, plus `discount null→discountAmount` if > 0, reason `discountReason`, refs `{procedure: priced.displayProcedure, appointmentId, noteId: result.noteId, ledgerId: result.ledgerId, doctor: priced.doctorName, payerName: priced.payer.payerName}` (payer only when not private) |
| procedures update (≈871) | `procedure.edited` | changes `diffChanges(result.before, {procedure, cost, listPrice, discountAmount, status, payerName, date}` (values taken from `priced`), with the field list `["procedure","cost","listPrice","discountAmount","status","payerName","date"])`. Then rename field `cost` to `price` and `discountAmount` to `discount`. Patient name from `result.patientName`. If the changes are empty, write nothing. |
| procedures updateApprovalNote (≈694) | `procedure.edited` | refs `{claimId, procedure: before.procedure}`, changes from `what` as label-only entries, patientName `await patientNameOf(clinicId, before.patientId)` |
| procedures delete (≈944) | `procedure.deleted` | amount `note.cost`, patientName `charge?.data()?.patientName ?? await patientNameOf(...)`, refs `{procedure, count: cascade-1}` |
| procedures move (≈1003) / continue (≈1064) | `procedure.moved` / `procedure.continued` | patientName via `patientNameOf`, refs `{procedure, date: result.newDate}` |
| ledger createPayment (≈364) | `payment.received` | amount, patientName, refs `{method: result.row.method, receiptNumber: result.receiptNumber, procedure: description with the "Payment for " prefix stripped}` |
| ledger createEntry (≈652) | `expense.added` / `income.added` | amount `row.amount`, refs `{procedure: row.description}` |
| ledger updateRow (≈1049) | discount rule below; else `payment.edited` / `expense.edited` / `income.edited` / `procedure.edited` | changes `diffChanges(result.before, result.update, ["paid","amount","method","date","description","listPrice"])`; skip when empty |
| ledger deleteRow (≈1314) | `payment.deleted` / `expense.deleted` / `income.deleted` / `procedure.deleted` by `type` | amount `target.paid ?? target.amount`, patientName `target.patientName`, refs `{method, receiptNumber, procedure: target.description}` |
| ledger setCommission (≈1115) | `commission.changed` | changes `[{field:"commission", from: before pct, to: percent}]`, patientName `result.before.patientName` |
| ledger setLabFee (≈1207) | `labfee.corrected` | changes `[{field:"labFee", from: result.previous, to: labFee}]`, reason |
| ledger insurerCollect (≈601) | `insurer.collected` | amount `result.paid`, refs `{payerName: result.written[0]?.row.payerName, count: result.count}` |

**Discount rule in `updateRow`.** It applies when `result.type === "procedure" && "discountAmount" in result.update`:
- `old = Number(result.before.discountAmount) || 0` and `neu = Number(result.update.discountAmount) || 0`.
- `old === 0 && neu > 0` → `discount.given`, amount `neu`.
- `neu === 0 && old > 0` → `discount.removed`, amount `old`.
- Otherwise → `discount.changed`, amount `neu - old`.
- Every case gets:
  - changes `[{field:"price", from: before.cost, to: update.cost}, {field:"discount", from: old, to: neu}]`
  - reason `update.discountReason ?? before.discountReason`
  - patientName `before.patientName`
  - refs `{procedure: before.description}`
  - `groupId`

**`AppointmentMoneyTab.handleDiscount`:** when `targets.length > 1`, generate `const groupId = crypto.randomUUID()` once and pass `{ groupId }` to each `updateLedgerRow` call.

- [ ] **Step 1: Write the failing route test.** Copy the harness from `tests/branchMoneyRoutes.test.mts`; seed an Owner, one patient "عمر حسام علي", and staff D1. Read back with `system_logs` ordered by `timestamp` desc and filtered by `event`. Cases:
  1. procedures `create` with list 1500 and a fixed discount of 200 (reason "قريب") → exactly one `procedure.added`; `categories` include `"discount"`; `flag === true`; `patientName === "عمر حسام علي"`.
  2. ledger `createPayment` 800 Cash against that charge → one `payment.received` with `refs.receiptNumber` set; `details` has no 20-character id.
  3. ledger `update` with patch `{listPrice:1500, discountMode:"fixed", discountFixed:300, discountPercent:null, discountReason:"x"}` and top-level `groupId:"g1"` → `discount.changed`, `amount === 100`, `groupId === "g1"`.
  4. ledger `update` with discountFixed 0 → `discount.removed` with `amount === 300` (Review Focus 3).
  5. ledger `update` on the payment, changing only `method` → `payment.edited`, `flag === true`, `changes` deep-equals `[{field:"method", from:"Cash", to:"Card"}]`.
  6. ledger `delete` of the payment → `payment.deleted` with `amount === 800`.
- [ ] **Step 2: Run** `npm run test:activity-money-routes`. Expected: FAIL.
- [ ] **Step 3: Implement** the table above, the discount rule, `moneyApi` meta, `handleDiscount` groupId, and the QuickPaymentModal removal.
- [ ] **Step 4: Run** the new test plus `npm run test:branch-money-routes`, `npm run test:staged-once` and `npx tsc --noEmit` → all green.
- [ ] **Step 5: Commit** `git commit -m "Activity log: money and discount events from the server"`

---

### Task 4: Insurance, settlements, appointment-delete and bin events

**Files:**
- Modify: `src/app/api/insurance/claims/route.ts`, `src/app/api/staff/settlements/route.ts`, `src/app/api/appointments/delete/route.ts`, `src/app/api/records/delete/route.ts`, `src/app/api/records/restore/route.ts`, `src/app/api/records/purge/route.ts`
- Test: `tests/activityInsuranceRoutes.test.mts`; script `"test:activity-insurance-routes"`. Seeding: copy `tests/approvalTeethRoute.test.mts`, which already creates a claim through the route.

**Interfaces:** Consumes `logEventServer`, `recordMoneyChange({event})` and `patientNameOf`. Produces nothing new for later tasks.

**Changes:**
- **Claims POST:**
  - Return from the transaction `{ patientName, total: claim totals' patient+insurer sum, lineCount }`. These are already computed at ≈422/456.
  - After the save, write `insurance.created`: patientId, patientName, amount total, refs `{claimId, payerName: payer.name, approvalNumber: h.approvalNumber, status, count: lineCount}`, branchId.
  - `auditCharges` keeps writing the money rows, now as `procedure.added` with `refs.claimId` and `refs.payerName`; the categories gain insurance through Task 1's rule.
- **Claims PATCH:**
  - Return from the transaction `{ fromStatus: claim.status, patientId, patientName, payerName, approvalNumber }`.
  - When `status` is set and differs from `fromStatus`, write `insurance.status` with changes `[{field:"status", from: fromStatus, to: status}]`.
  - When any of `statePicks`, `picks` (dentists), `newPatientId`, lines or metlife changed, write `insurance.edited`. Changes are label-only entries with fields `lineStatus`, `dentists`, `patient`, `lines`, `metlife`.
  - Existing row side-effects get `refs.claimId`/`refs.payerName`.
  - The removed-rows log (≈1176) becomes `procedure.deleted`, with reason "not treated" or "replaced".
- **Settlements:**
  - `create`: `staff.paid` / `staff.deduction.added`, refs `{staffId, staffName}`, amount, reason note.
  - `update`: return `before {kind, amount, date, note, method}` from the transaction, then write `staff.payout.edited` or `staff.deduction.edited` (**new**) with `diffChanges(before, patch, ["amount","date","method","note"])`.
  - `remove`: `staff.payout.deleted` / `staff.deduction.removed`.
- **Appointments delete:** `appointment.deleted`, with patientId and patientName from `appointment`, refs `{date: appointment.date, time: appointment.time, doctor: appointment.doctor, count: notes.length}`, branchId `appointment.branchId`, and reason "with treatments" or "kept treatments". The ledger-audit `module` fix comes free with `storedFields`.
- **Records delete:** keep the aggregate line as `record.deleted` with `refs.count`. Additionally, for each validated `patients` item, write `patient.deleted` with patientName `row.data.name`.
- **Restore:** `patient.restored` for patients (`patientName: entry.label`), otherwise `record.restored`.
- **Purge:** `record.purged`, with `patientName: entry.label` when the collection is patients.

- [ ] **Step 1: Write the failing test.** Cases:
  1. POST an approval with status "approved" → one `insurance.created`, whose refs include `payerName`.
  2. PATCH status approved → treated → `insurance.status` not flagged, plus `procedure.added` rows with `refs.claimId`.
  3. PATCH treated → cancelled → `insurance.status`, `flag === true`, `changes[0]` from "treated" to "cancelled".
  4. Settlement deduction create, then update amount 100 → 150 → `staff.deduction.edited` with change amount 100→150, flagged.
  5. Appointment delete → `appointment.deleted` with `refs.date` set, `module === "appointments"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new test, plus `npm run test:approval-teeth-route`, `npm run test:bin-cascade` and `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** `git commit -m "Activity log: insurance, settlements, deletes and bin events"`

---

### Task 5: Appointment events (client)

**Files:**
- Create: `src/lib/activity/appointmentDiff.ts`, `src/lib/activity/appointmentLog.ts`
- Modify:
  - `src/lib/bookingService.ts` (create ≈462, edit ≈336, patient-in-booking ≈221-258, `updateBookingTime` ≈506)
  - `src/components/dashboard/DesktopDashboard.tsx` (`handleStatusChange` ≈788, `saveInlineEdit` ≈491, `updateBookingTime` caller ≈1630)
  - `src/components/dashboard/MobileDashboard.tsx` (`handleStatusChange` ≈686)
  - `src/components/dashboard/DentistHome.tsx` (`setStatus` ≈172)
  - `src/components/dashboard/WeeklyScheduleView.tsx` (≈263), `src/components/dashboard/RoomScheduleView.tsx` (≈211-222)
- Test: `tests/activityAppointmentDiff.test.mts`; script `"test:activity-appointments"`

**Interfaces:**
```ts
// appointmentDiff.ts (pure)
export const APPOINTMENT_FIELDS: readonly string[]; // ["date","time","duration","doctor","status","roomName","branchId","treatment","cost"]
export function appointmentEvents(prev: Record<string, unknown>, next: Record<string, unknown>,
  ctx: { patientId?: string; patientName?: string; appointmentId: string }): ActivityEvent[];
// appointmentLog.ts (client)
export async function logAppointmentStatus(user: AuditUser, appt: { id: string; patientId?: string; patientName?: string; branchId?: string; status?: string }, to: string): Promise<void>;
export async function logAppointmentEvents(user: AuditUser, events: ActivityEvent[]): Promise<void>;
// bookingService.ts
export async function updateBookingTime(id: string, newDate: string, newTime: string, user?: AuditUser): Promise<void>;
```
- **`appointmentEvents`** returns `[]` when nothing in `APPOINTMENT_FIELDS` or `discountAmount` changed. `notes`, `modifiedBy`, `updatedAt` and `waitingMood` are ignored. It produces:
  - one `appointment.edited` with the non-discount changes (if any)
  - plus one `discount.given`, `discount.changed` or `discount.removed` when `discountAmount` changed, using the same old/new rule as Task 3
- **bookingService:**
  - Create → `appointment.created`, refs `{date, time, doctor}`, plus `patient.created` first when `data.isNewPatient` (patientId `pRef.id`, refs `{count: generatedFileId}`).
  - Edit → `appointmentEvents(prev, updatePayload, …)`, replacing the "Appointment Updated" log.
  - `updateBookingTime` → `appointment.moved` with date/time changes when `moved`. All four callers pass `{uid, name, role}` from `useAuth().user`.
  - The RoomScheduleView room write logs `appointmentEvents(prev, {roomName, branchId})`.
- **Status buttons** (Desktop, Mobile, DentistHome) call `logAppointmentStatus(user, appt, nextStatus)` after the write succeeds. It writes `appointment.status` with change `status prev → next`, and skips when they are equal.
- **Desktop `saveInlineEdit`** logs `appointmentEvents(selectedAppointment, updatePayload, …)`.

- [ ] **Step 1: Write failing tests:**
```ts
assert.deepEqual(appointmentEvents({ time: "05:00 PM", notes: "a" }, { time: "05:00 PM", notes: "b" }, ctx), []);   // Review Focus 5
assert.deepEqual(appointmentEvents({}, {}, ctx), []);
const ev = appointmentEvents({ time: "05:00 PM", doctor: "محمد إيهاب" }, { time: "06:30 PM", doctor: "أحمد طارق" }, ctx);
assert.equal(ev.length, 1); assert.equal(ev[0].event, "appointment.edited");
assert.deepEqual(ev[0].changes, [{ field: "time", from: "05:00 PM", to: "06:30 PM" }, { field: "doctor", from: "محمد إيهاب", to: "أحمد طارق" }]);
const d = appointmentEvents({ discountAmount: 0, cost: 1500 }, { discountAmount: 200, cost: 1300 }, ctx);
assert.deepEqual(d.map((e) => e.event), ["appointment.edited", "discount.given"]); assert.equal(d[1].amount, 200);
```
- [ ] **Step 2: Run** `npm run test:activity-appointments` → FAIL.
- [ ] **Step 3: Implement** both modules and wire the call sites.
- [ ] **Step 4: Run** the test, plus `npm run test:autosave` and `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** `git commit -m "Activity log: appointment edits, status, drag and room events"`

---

### Task 6: Patient, plan, media, lab, team and settings events (client)

**Files (modify):**
- `src/components/NewPatientModal.tsx` (≈172-197): keep `const ref = await addDoc(...)`, then write `patient.created` with patientId `ref.id` and branchId.
- `src/app/(dashboard)/patients/[id]/page.tsx`:
  - handleUpdate ≈694-712: `patient.edited` with `diffChanges(patient, newValues, ["name","phone","address","dob","gender","status","referral"])`; skip when empty.
  - Media ≈974: `media.uploaded`.
- `src/components/patients/PatientMediaGallery.tsx` (≈286): `media.uploaded`.
- `src/components/patients/PatientTreatmentPlanTab.tsx`:
  - 872/886/916/1183 → `plan.edited` / `plan.created` / `plan.deleted`, with refs `{procedure: title}`.
  - handleSetStatus ≈931 → `plan.status` with the status change.
- Lab, logged at the call sites (each already has `useAuth` or a user name; use `useAuth().user`):
  - `src/components/lab/LabCaseModal.tsx`: ≈503 create → `lab.created` (refs `{labName, status}`, amount `agreedPrice`); ≈499 update → `lab.edited` (diff `["labName","agreedPrice","dueDate","status"]`); ≈545 delete → `lab.deleted`.
  - `src/app/(dashboard)/lab/page.tsx`: ≈245 advance → `lab.status` (status from→to); ≈279 remake → `lab.remake` (reason).
  - `src/components/lab/LabAccountsPanel.tsx`: ≈87 → `lab.paid` (amount, refs `{labName, method}`); ≈119 → `lab.payment.deleted`.
- `src/app/(dashboard)/team/page.tsx`:
  - setRate ≈415, saveBranchIds ≈435 and savePay ≈476 → `staff.edited`, refs `{staffId, staffName}`.
  - Changes: commission from→to; branches as joined branch names (via `useActiveBranch().branches`); and `diffChanges(selectedDoc, draft, ["baseSalary","commissionPercentage","overtimeMultiplier","speciality"])`.
- Settings, each adding `useAuth`:
  - `src/components/settings/LocationsSettings.tsx` handleSave ≈100 → `settings.branches`: one change per added (`null → name`), removed (`name → null`) or renamed (`old → new`) branch, matched by id.
  - `src/components/settings/PricingSettings.tsx` ≈188/191/215 → `settings.services` with service name and price from→to.
  - `src/components/settings/PayersSettings.tsx` saveDraft ≈397 and remove ≈269 → `settings.insurers` with insurer name from→to.
  - `src/components/settings/DentalLabsSettings.tsx` ≈127 → `settings.labs`, the lab-name diff by id.
- `src/components/settings/UserManagement.tsx` ≈133: the legacy "User Deleted" details carry the user's name instead of the uid. A plain string change; no event needed.

**Interfaces:** Consumes `logEvent` and `diffChanges`. Produces nothing new.

- [ ] **Step 1: Write a failing test.** Add a pure helper `branchListChanges(prev: {id,name}[], next: {id,name}[]): Change[]` to `src/lib/activity/diff.ts`, with tests in `tests/activityCatalogue.test.mts`:
```ts
assert.deepEqual(branchListChanges([{ id: "a", name: "مصر الجديدة" }], [{ id: "a", name: "مصر الجديدة" }, { id: "b", name: "التجمع" }]),
  [{ field: "branch", from: null, to: "التجمع" }]);
assert.deepEqual(branchListChanges([{ id: "a", name: "A" }], [{ id: "a", name: "B" }]), [{ field: "branch", from: "A", to: "B" }]);
assert.deepEqual(branchListChanges([{ id: "a", name: "A" }], []), [{ field: "branch", from: "A", to: null }]);
```
The same helper serves labs and insurers (lists of `{id, name}`).
- [ ] **Step 2: Run** `npm run test:activity` → FAIL.
- [ ] **Step 3: Implement** the helper, then wire every call site above.
- [ ] **Step 4: Run** `npm run test:activity`, `npm run test:settings` and `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** `git commit -m "Activity log: patient, plan, lab, team and settings events"`

---

### Task 7: The Activity page

**Files:**
- Create: `src/lib/activity/feed.ts` (pure), `src/lib/activity/useActivity.ts` (hooks), `src/components/activity/ActivityFeed.tsx`, `src/components/activity/ActivityEntry.tsx`, `src/components/activity/ActivitySummary.tsx`
- Modify: `src/lib/clinicDate.ts` (export `instantAtYmd`), `src/components/settings/ActivityLogs.tsx` (becomes `export default function ActivityLogs() { return <ActivityFeed />; }`)
- Test: `tests/activityFeed.test.mts`; script `"test:activity-feed"`

**Interfaces:**
```ts
// clinicDate.ts
export function instantAtYmd(timeZone: string, ymd: string): Date;   // that zone's midnight at the start of ymd
// feed.ts
export type Tab = "all" | Exclude<Category, "system">;
export type Preset = "today" | "yesterday" | "week" | "month" | { from: string; to: string };  // ymd, inclusive
export function rangeFor(preset: Preset, now: Date, tz: string): { start: Date; end: Date };     // end exclusive
export function dayKey(log: ActivityLogDoc, tz: string): string;                                 // ymd in tz
export type Filters = { tab: Tab; userId?: string; patient?: string; branchId?: string; flaggedOnly?: boolean };
export function filterEntries(logs: ActivityLogDoc[], f: Filters): ActivityLogDoc[];
export type FoldedEntry = { log: ActivityLogDoc; members: ActivityLogDoc[] };                     // members.length > 1 for a group
export function foldGroups(logs: ActivityLogDoc[]): FoldedEntry[];                               // same groupId + discount.* → one; amount summed
export type SummaryItem = { key: "received" | "edited" | "deleted" | "discounts" | "insCreated" | "insStatus" | "insCancelled" | "insCollected"; count: number; amount: number };
export type PersonSummary = { userId: string; userName: string; items: SummaryItem[] };
export function summarize(logs: ActivityLogDoc[], tab: "money" | "discount" | "insurance"): PersonSummary[];
// useActivity.ts
export function useActivityRange(start: Date, end: Date): { logs: ActivityLogDoc[]; loading: boolean; capped: boolean; reload: () => void };
export function usePatientActivity(patientId: string): { logs: ActivityLogDoc[]; loading: boolean; hasOlder: boolean; loadOlder: () => void };
```
**Rules:**
- **Ranges:**
  - `week` is today-6 through the end of today.
  - `month` is the first of the clinic month through the end of today.
- **`useActivityRange`:**
  - Query: `where("timestamp", ">=", start)`, `where("timestamp", "<", end)`, `orderBy("timestamp","desc")`, `limit(500)`, paging with `startAfter(lastDoc)`.
  - Stop when a page is short or the total reaches 5,000; at 5,000, `capped` is true.
  - Uses `getDocs` (not live), plus a refresh button.
- **`filterEntries`:**
  - The tab matches `categoriesOfLog`.
  - `patient` is a case-insensitive substring of `patientName`, falling back to `details` for legacy entries.
  - `flaggedOnly` matches `flag === true` (legacy entries are never flagged).
- **`summarize` items per tab:**
  - money: `received` = payment.received, `edited` = payment.edited|expense.edited|income.edited|procedure.edited, `deleted` = *.deleted in money
  - discount: `discounts` = discount.given|changed count, with `amount` the sum of amounts (removed subtracts)
  - insurance: `insCreated`, `insStatus`, `insCancelled`, `insCollected`

  People are sorted by the total amount, descending.
- **UI:**
  - Slab header with the eyebrow "سجل النشاط", date preset pills, and a custom date pair.
  - A tab pill row.
  - A filter row: a person select built from the distinct `userId → userName` in the loaded logs; a patient text box; a branch select only when `useActiveBranch().branches.length > 1`; a 🔸 toggle.
  - `ActivitySummary` on the money, discount and insurance tabs. Clicking a person sets `userId`.
  - Below that, day headers (Arabic long date in Cairo) and `ActivityEntry` rows:
    - bold actor name, then the sentence from `describeLog`, the time (`HH:mm`, Cairo) at the end, 🔸 when flagged, and an AI chip when `actor === "ai"`
    - the patient name is a link to `/patients/{patientId}` when there is a `patientId`
    - clicking a row expands a before → after table of `changes` (labels via `fieldLabel`), plus the reason
    - folded groups show "(n خدمات)"
  - The capped note reads "عرض أول 5,000 إجراء في الفترة دي — ضيّق التاريخ".
  - Phone: the same blocks stacked; no table.

- [ ] **Step 1: Write failing tests:**
```ts
const tz = "Africa/Cairo";
const r = rangeFor("today", new Date("2026-10-13T22:30:00Z"), tz);              // 01:30 Cairo on the 14th
assert.equal(r.start.toISOString(), "2026-10-13T21:00:00.000Z");
assert.equal(r.end.toISOString(), "2026-10-14T21:00:00.000Z");
const late = { id: "l", timestamp: new Date("2026-10-13T20:30:00Z") };           // 23:30 Cairo on the 13th — Review Focus 4
assert.equal(dayKey(late, tz), "2026-10-13");
const y = rangeFor("yesterday", new Date("2026-10-14T09:00:00Z"), tz);
assert.ok(late.timestamp >= y.start && late.timestamp < y.end);
const g = foldGroups([
  { id: "1", event: "discount.given", groupId: "g", amount: 100, patientName: "عمر" },
  { id: "2", event: "discount.given", groupId: "g", amount: 200, patientName: "عمر" },
  { id: "3", event: "payment.received", amount: 50 }]);
assert.equal(g.length, 2); assert.equal(g[0].members.length, 2); assert.equal(g[0].log.amount, 300);
const s = summarize([
  { id: "a", v: 2, event: "discount.given", categories: ["discount","money"], userId: "m", userName: "Malak", amount: 200 },
  { id: "b", v: 2, event: "discount.removed", categories: ["discount","money"], userId: "m", userName: "Malak", amount: 50 }], "discount");
assert.deepEqual(s, [{ userId: "m", userName: "Malak", items: [{ key: "discounts", count: 1, amount: 150 }] }]);
assert.equal(filterEntries([{ id: "x", module: "appointments", details: "Booked عمر" }], { tab: "appointment", patient: "عمر" }).length, 1);
assert.equal(filterEntries([{ id: "x", module: "finance" }], { tab: "all", flaggedOnly: true }).length, 0);
```
- [ ] **Step 2: Run** `npm run test:activity-feed` → FAIL.
- [ ] **Step 3: Implement** `instantAtYmd`, `feed.ts`, the hooks and the components, and swap `ActivityLogs.tsx` to the host.
- [ ] **Step 4: Run** the test and `npx tsc --noEmit` → green.
- [ ] **Step 5: Commit** `git commit -m "Activity log: new page with dates, tabs, people summary and grouped discounts"`

---

### Task 8: Patient-file tab and index

**Files:**
- Modify:
  - `src/app/(dashboard)/patients/[id]/page.tsx`: add tab id `"activity"` to the union at ≈226, the `?tab=` allowlist at ≈367-371 and the tabs array at ≈1022. Label it "سجل النشاط" / "Activity" with the `ScrollText` icon (lucide), `show: isAdmin && !chair`. Render the content block next to timeline (≈1893): `{activeTab === "activity" && <ActivityFeed patientId={patient.id} />}`.
  - `src/components/activity/ActivityFeed.tsx`: with `patientId`, use `usePatientActivity`, hide the date pills, patient box and summary, keep the tabs and the 🔸 toggle, show "Load older", and show the note "السجل ده بيبدأ من 14 أكتوبر 2026 — الإجراءات القديمة في صفحة سجل النشاط".
  - `firestore.indexes.json`: add `{ "collectionGroup": "system_logs", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "patientId", "order": "ASCENDING" }, { "fieldPath": "timestamp", "order": "DESCENDING" } ] }`.
- Test: `npx tsc --noEmit`; the behaviour is checked in Task 9.

**Interfaces:** Consumes `ActivityFeed` and `usePatientActivity` (Task 7).

- [ ] **Step 1: Implement** the tab, the patient mode and the index entry.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npm run test:activity-feed` → green.
- [ ] **Step 3: Commit** `git commit -m "Activity log: patient-file tab and its index"`

---

### Task 9: Browser check and ship

- [ ] **Step 1: Full suite.** Run `npx tsc --noEmit`, then `npm run test:activity`, `npm run test:activity-feed`, `npm run test:activity-appointments`, and, with the emulator up, `npm run test:activity-writers`, `npm run test:activity-money-routes`, `npm run test:activity-insurance-routes`, `npm run test:branch-money-routes`, `npm run test:staged-once`. All must pass.
- [ ] **Step 2: Browser check** with the local dev server against the demo clinic (see the `demo-clinic` memory note); use preview tools. Do each of these:
  - take a payment
  - give a 2-service visit discount
  - drag an appointment
  - press Arrived → In chair
  - cancel an insurance approval
  - edit a branch name

  Confirm on Settings → Activity log (Today) that each appears once, in Arabic, with names, money and before → after, under the right tab. Confirm that the visit discount is one line, that the Discounts summary shows the person, and that the patient tab shows the same entries. Confirm that a Receptionist account sees no "سجل النشاط" tab. Screenshot the page.
- [ ] **Step 3: Ship.**
  - `git fetch && git rebase origin/main`, then rerun step 1's quick suites, then `git push origin HEAD:main` (Vercel deploys).
  - Deploy the index with `npx firebase-tools@13 deploy --only firestore:default`. Read the memory note `firestore-database-is-named-default` first; rules are unchanged on main.
  - Remove the `node_modules` junction with `rmdir`, then run `git worktree remove --force`.
