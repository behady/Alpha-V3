# Branch Finance Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each branch keeps its own books (rows, receipt numbers, tax identity) and a staff member sees and acts on only the branches the owner allows.

**Architecture:** Every new ledger row is stamped with the branch on screen; the stamp travels from one browser chokepoint (`moneyApi.post`) to the four money routes, each of which checks it through one server helper and refuses a branch the caller may not use. Reads filter by the on-screen branch with one pure predicate; receipts take their counter and tax block from the branch. Firestore rules are untouched (approach A).

**Tech Stack:** Next.js 16 route handlers, firebase-admin transactions, Firestore client SDK, pure TS helpers tested with `npx tsx`, route tests on the Firestore emulator (`tests/notePhotosRoute.test.mts` harness).

**Spec:** `docs/superpowers/specs/2026-10-11-branch-finance-separation-design.md`

## Global Constraints

- Repo files are CRLF; scripted edits must keep CRLF (see memory `repo-stores-crlf`). Write tests and new files as the editor does; `git diff --stat` must show only intended lines.
- Optional fields are written with conditional spread, never `undefined` (Firestore rejects it).
- A clinic with **no branches** (`parseClinicBranches` → `[]`) behaves exactly as today everywhere: nothing stamped, nothing checked, nothing filtered, no new UI.
- `branchId` on a ledger row is a non-empty string or absent — never `""`, never `null`.
- Owners and admins (`isFullAccessRole(role)`) are always allowed every branch. `ALL_BRANCHES` (`"__all__"`) is offered to them only.
- Old rows (no `branchId`) are never rewritten.
- Every user-facing string in English and Arabic, as the surrounding file does.
- Commit after each task; `npx tsc --noEmit -p .` clean before each commit.
- Nothing here changes `firestore.rules` or the Android app.

## Review Focus

1. A non-admin who had "All branches" remembered in localStorage from before this change must land on their first allowed branch, never on all — Task 11's `resolveBranchChoice` test pins it.
2. The owner ticks branches for a person and later deletes those branches: the person must not lose access to everything — Task 1 pins "ticked but none exist ⇒ all".
3. Admin on "All branches" opens Quick Pay and cancels the branch pick: no row may be written — Task 12 pins that every money form awaits `requireBranchForMoney()` and returns on `null`.
4. A payment taken today against an old charge that has no branch: the payment is in scope under its branch, the charge only under "All branches"; the patient's file still adds up — Task 17 pins the row label and Task 1 pins `rowInScope` on a row with no branch.
5. Two branches minting receipts in the same second must get independent numbers and the clinic-wide counter must stay untouched — Task 18 pins both.

---

### Task 1: Pure branch-access helpers

**Files:**
- Create: `src/lib/branchAccess.ts`
- Test: `tests/branchAccess.test.mts`
- Modify: `package.json` (add `"test:branch-access": "npx tsx tests/branchAccess.test.mts"` after `"test:branches"`)

**Interfaces:**
- Produces:
  - `allowedBranches(branches: readonly ClinicBranch[], staff: { branchIds?: unknown } | null | undefined, isAdmin: boolean): ClinicBranch[]`
  - `rowInScope(row: { branchId?: unknown }, scopeBranchId: string): boolean` — `""` passes every row; otherwise `row.branchId === scopeBranchId`.
  - `branchForAutomaticRow(args: { appointment?: { branchId?: unknown } | null; patient?: { branchId?: unknown } | null; branches: readonly { id: string }[] }): string | null` — appointment's → patient's → first branch's id → `null` when the clinic has no branches. A branch id that no longer exists is skipped.
  - `isValidBranchIds(v: unknown): v is string[]`

- [ ] **Step 1: Write the failing tests** in `tests/branchAccess.test.mts` (style of `tests/roomSchedule.test.mts`: `node:assert/strict`, one `console.log("branchAccess: all checks passed")` at the end):

```ts
const b = (id: string) => ({ id, name: id, address: "", phone: "", code: "", rooms: [] });
const branches = [b("hel"), b("tag")];
assert.deepEqual(allowedBranches(branches, { branchIds: ["tag"] }, false).map((x) => x.id), ["tag"]);
assert.deepEqual(allowedBranches(branches, { branchIds: ["tag"] }, true).map((x) => x.id), ["hel", "tag"], "admins always see all");
assert.deepEqual(allowedBranches(branches, {}, false).map((x) => x.id), ["hel", "tag"], "nothing ticked = all");
assert.deepEqual(allowedBranches(branches, { branchIds: [] }, false).map((x) => x.id), ["hel", "tag"]);
assert.deepEqual(allowedBranches(branches, { branchIds: ["gone"] }, false).map((x) => x.id), ["hel", "tag"], "ticked branches all deleted = all, not nothing");
assert.deepEqual(allowedBranches(branches, { branchIds: ["gone", "hel"] }, false).map((x) => x.id), ["hel"]);
assert.deepEqual(allowedBranches([], { branchIds: ["hel"] }, false), [], "no branches: nothing to allow");
assert.equal(rowInScope({ branchId: "hel" }, ""), true);
assert.equal(rowInScope({}, ""), true, "old rows show under All");
assert.equal(rowInScope({}, "hel"), false, "old rows hide under a branch");
assert.equal(rowInScope({ branchId: "tag" }, "hel"), false);
assert.equal(branchForAutomaticRow({ appointment: { branchId: "tag" }, patient: { branchId: "hel" }, branches }), "tag");
assert.equal(branchForAutomaticRow({ appointment: { branchId: "gone" }, patient: { branchId: "hel" }, branches }), "hel");
assert.equal(branchForAutomaticRow({ patient: {}, branches }), "hel", "falls back to the first branch");
assert.equal(branchForAutomaticRow({ branches: [] }), null);
assert.equal(isValidBranchIds(["a", "b"]), true);
assert.equal(isValidBranchIds(["a", 3]), false);
```

- [ ] **Step 2: Run** `npx tsx tests/branchAccess.test.mts` — expected: FAIL, cannot find module `../src/lib/branchAccess`.
- [ ] **Step 3: Implement** the four functions in `src/lib/branchAccess.ts` with a file header comment stating the three rules (admins all; empty or all-deleted list = all; `""` scope passes everything). Import `ClinicBranch` type from `@/lib/clinicLocations`.
- [ ] **Step 4: Run** the test — expected: `branchAccess: all checks passed`.
- [ ] **Step 5: Commit** `src/lib/branchAccess.ts tests/branchAccess.test.mts package.json` — "Branch access: who may work in which branch, and which rows a branch view shows".

---

### Task 2: Branch receipt and tax fields

**Files:**
- Modify: `src/lib/clinicLocations.ts` (`ClinicBranch` type at :17-32, `sanitizeBranch` at :43-67)
- Test: `tests/priceListBranches.test.mjs` is the existing branch suite; add the new checks to a new `tests/clinicLocations.test.mts` instead (that suite is `.mjs` and tests price lists) and add `"test:clinic-locations": "npx tsx tests/clinicLocations.test.mts"` to `package.json`.

**Interfaces:**
- Produces on `ClinicBranch`: `receiptPrefix?: string` (A–Z0–9, upper, ≤4), `etaBranchCode?: string` (≤50), `taxRegistration?: string` (≤30). All optional; `sanitizeBranch` round-trips them (`LocationsSettings` writes its output straight back, so a dropped field is erased).
- Produces `receiptPrefixFor(branch: Pick<ClinicBranch, "name" | "receiptPrefix">): string` — the prefix, else the first three letters/digits of the name upper-cased, else `"BR"`.

- [ ] **Step 1: Write the failing tests** in `tests/clinicLocations.test.mts`:

```ts
const parsed = parseClinicBranches({ branches: [{ id: "h", name: "Heliopolis", rooms: [], receiptPrefix: "hel-1", etaBranchCode: " 12 ", taxRegistration: "100-200" }] });
assert.equal(parsed[0].receiptPrefix, "HEL1");
assert.equal(parsed[0].etaBranchCode, "12");
assert.equal(parsed[0].taxRegistration, "100-200");
assert.equal(parseClinicBranches({ branches: [{ id: "t", name: "Tagamoa", rooms: [] }] })[0].receiptPrefix, "", "absent stays absent-as-empty, never undefined");
assert.equal(receiptPrefixFor({ name: "Heliopolis", receiptPrefix: "" }), "HEL");
assert.equal(receiptPrefixFor({ name: "التجمع", receiptPrefix: "" }), "BR", "no Latin letters to borrow");
assert.equal(receiptPrefixFor({ name: "x", receiptPrefix: "TAG" }), "TAG");
```

- [ ] **Step 2: Run** `npx tsx tests/clinicLocations.test.mts` — expected: FAIL (`receiptPrefix` undefined / `receiptPrefixFor` not exported).
- [ ] **Step 3: Implement**: add the three fields to the type with one-line doc comments; in `sanitizeBranch` normalise `receiptPrefix` like `code` (strip non-alphanumerics, upper, slice 4), trim the other two with their length caps; add `receiptPrefixFor`.
- [ ] **Step 4: Run** the test and `npm run -s test:branches` — both pass.
- [ ] **Step 5: Commit** — "Branches: receipt prefix, ETA branch code and tax number per branch".

---

### Task 3: Server-side branch check

**Files:**
- Create: `src/lib/server/branchAccess.ts`

**Interfaces:**
- Consumes: `allowedBranches`, `isValidBranchIds` (Task 1); `adminClinicDoc`, `adminClinicCollection` from `@/lib/adminClinicDb`; `LOCATIONS_DOC`, `parseClinicBranches`; `isFullAccessRole` from `@/lib/permissions`.
- Produces:
  ```ts
  export type BranchCheck = { ok: true; branchId: string | null } | { ok: false; response: NextResponse };
  export async function assertBranchAllowed(args: {
    clinicId: string; uid: string; role: string; branchId: unknown;
    /** When the body sends no branch, use this instead of refusing (automatic rows). */
    fallback?: () => Promise<string | null>;
  }): Promise<BranchCheck>;
  export const BRANCH_REQUIRED_MESSAGE = "Choose the branch this money belongs to.";
  export const BRANCH_FORBIDDEN_MESSAGE = "You can't record money for that branch.";
  ```
  Rules: no branches in the clinic → `{ ok: true, branchId: null }` (stamp nothing). Else `branchId` must be a non-empty string naming an existing branch — else 400 `BRANCH_REQUIRED_MESSAGE` unless `fallback` returns an id. Admin passes. Otherwise read the staff row (`adminClinicCollection(clinicId, "staff").where("uid", "==", uid).limit(1)`), and the branch must be in `allowedBranches(...)` — else 403 `BRANCH_FORBIDDEN_MESSAGE`. Responses are `NextResponse.json({ ok: false, error, code: "branch_required" | "branch_forbidden" }, { status })`.

- [ ] **Step 1: Implement** the helper (no unit test: it reads Firestore; Task 9's emulator test covers it). Keep it under 60 lines.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .` — clean.
- [ ] **Step 3: Commit** — "Server branch check: one helper every money route asks".

---

### Task 4: Browser chokepoint — the branch rides with every money call

**Files:**
- Create: `src/lib/branchScope.ts`
- Modify: `src/lib/moneyApi.ts:88-93` (`post`), `src/components/insurance/api.ts:31-40` (`call`), `src/lib/useActiveBranch.ts` (publish the scope)

**Interfaces:**
- Produces in `branchScope.ts`: `setCurrentBranchScope(id: string): void`, `currentBranchId(): string` (module-level, `""` until set — the same pattern as `currentClinicId()` in `db-utils.ts:17`).
- `useActiveBranch()` calls `setCurrentBranchScope(scopeBranchId)` in an effect whenever it changes, so any mounted consumer keeps it fresh.
- `moneyApi.post` and insurance `call` attach `branchId: body.branchId ?? currentBranchId()` when the result is non-empty (never send `""`). An explicit `branchId` in the body wins (the "Which branch?" pick, Task 12, passes one).

- [ ] **Step 1: Write a source-pin test** in `tests/branchAccess.test.mts`:

```ts
const money = readFileSync(new URL("../src/lib/moneyApi.ts", import.meta.url), "utf8");
assert.match(money, /currentBranchId\(\)/, "moneyApi.post no longer attaches the on-screen branch");
const ins = readFileSync(new URL("../src/components/insurance/api.ts", import.meta.url), "utf8");
assert.match(ins, /currentBranchId\(\)/, "the insurance client no longer attaches the on-screen branch");
```

- [ ] **Step 2: Run** the test — FAIL on the first `assert.match`.
- [ ] **Step 3: Implement** the three edits. In `post`, build `const branchId = body.branchId ?? currentBranchId();` and spread `...(branchId ? { branchId } : {})` beside `clinicId`.
- [ ] **Step 4: Run** `npx tsx tests/branchAccess.test.mts` and `npx tsc --noEmit -p .` — pass.
- [ ] **Step 5: Commit** — "Money calls carry the branch on screen, from one place".

---

### Task 5: `/api/finance/ledger` stamps and checks the branch

**Files:**
- Modify: `src/app/api/finance/ledger/route.ts` — `createPayment` (:199), `createEntry` (:357), the update path (`APPROVAL_ROW_LOCKED_FIELDS` area ~:423 and the `EDITABLE_*` lists), `POST` (:1058).

**Interfaces:**
- Consumes: `assertBranchAllowed` (Task 3). `authz` from `requireStaffPermission` gives `uid`, `role`.
- Behaviour: for `action` in `create` (payment) and the manual income/expense creation, call `assertBranchAllowed({ clinicId, uid: authz.uid, role: authz.role, branchId: body.branchId })`; on `ok: false` return its response; on `ok: true` spread `...(check.branchId ? { branchId: check.branchId } : {})` into the row before `txn.set`. The payment row's branch is the **on-screen** one even when the charge it settles has another (decided: money follows the screen).
- `branchId` is never editable: add it to the locked list for every row type (an update whose patch carries a different `branchId` → 409, same message shape as `APPROVAL_ROW_LOCKED`).

- [ ] **Step 1: Implement** the three edits. Keep the locked-field check beside the existing approval-row one.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`; `npm run -s test:ledger` (`tests/ledgerWrite.test.mjs`) still passes.
- [ ] **Step 3: Commit** — "Ledger route: every payment, income and expense is stamped with the branch on screen".

---

### Task 6: `/api/clinical/procedures` stamps the charge and its payment

**Files:**
- Modify: `src/app/api/clinical/procedures/route.ts` — the charge write (`txn.set(ledgerRef, {...})` at :420), the inline payment row written on create (search `buildPaymentRow(` in this file), `move` (:851-859 keeps the row's branch).

**Interfaces:**
- Consumes: `assertBranchAllowed` with `fallback: () => branchForAutomaticRow({ appointment, patient, branches })` so a phone-app call that sends no branch still gets the visit's. Load `branches` from `settings/locations` once at the top of the handler only when the body has no `branchId` (one read, not one per row).
- Stamp `branchId` on the ledger charge row and on any payment row created in the same request. The clinical note itself is **not** stamped (the note belongs to the patient; the money belongs to the branch).

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`; `npm run -s test:payers` passes.
- [ ] **Step 3: Commit** — "Procedures route: the charge and its payment carry the branch".

---

### Task 7: `/api/insurance/claims` — treatment rows and payments

**Files:**
- Modify: `src/app/api/insurance/claims/route.ts` — `writeTreatmentRows` (:144) gains a `branchId: string | null` arg spread into each charge; `collectShare` / `insurerPaid` payment rows (~:991 `buildPaymentRow`) get the same stamp; both POST (:285) and PATCH (:657) resolve it once via `assertBranchAllowed` with `fallback` = `branchForAutomaticRow({ appointment: linked visit if any, patient, branches })`.

**Interfaces:**
- Consumes: Tasks 1, 3. The linked visit: the claim's `ledgerIds`/appointment links already in scope of the handler (see `lib/insurance/appointments.ts`); when none, the patient doc already loaded (`patientSnap`).
- Rule: the **patient share** collected at a screen uses the on-screen branch (body); the **insurer's** payment uses the body's branch when present (an admin at a screen) else the automatic fallback.

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`; `npm run -s test:insurance-metlife` and `test:insurance-nextcare` pass.
- [ ] **Step 3: Commit** — "Claims route: approval rows and insurer money carry a branch".

---

### Task 8: Settlements and the AI chat's ledger writes

**Files:**
- Modify: `src/app/api/staff/settlements/route.ts` — `create` (:120) and the expense row it writes (:61).
- Modify: `src/app/api/gemini/route.ts:1320-1335` — the generic `createRecord` tool: when `col === "ledger"`, run `assertBranchAllowed` with `fallback: () => branchForAutomaticRow({ patient: patient doc of data.patientId if any, branches })` and stamp the result; the chat sends the on-screen branch as `branchId` in its request body (the chat widget posts through `fetch`, not `moneyApi` — attach `currentBranchId()` there too, in `src/components/AiChatWidget.tsx`'s request builder).

**Interfaces:**
- Consumes: `assertBranchAllowed` (settlements: no fallback — they are always made at a screen; the AI chat: fallback as above). Stamp `branchId` on the settlement doc **and** on the ledger expense row.

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`; `npx tsx tests/staffSettlement.test.mts` (if present; else skip) passes.
- [ ] **Step 3: Commit** — "Settlements: paid from a branch".

---

### Task 9: Route tests on the Firestore emulator

**Files:**
- Create: `tests/branchMoneyRoutes.test.mts` (copy the harness head of `tests/notePhotosRoute.test.mts` :1-60 verbatim: fake auth lookup server, env, `idToken()`; seed `clinics/C1/settings/locations` with branches `hel`, `tag`; users `admin-1` (Owner), `desk-1` (Receptionist, permissions incl. `finance.add`, `access.appointments`) with a staff row `{ uid: "desk-1", branchIds: ["hel"] }`).
- Modify: `package.json` — `"test:branch-money-routes": "npx tsx tests/branchMoneyRoutes.test.mts"`; `.github/workflows/*.yml` where `test:note-photos-route` runs, add this one beside it.

**Interfaces:** Consumes the real handlers: `POST` from `src/app/api/finance/ledger/route.ts` and `src/app/api/staff/settlements/route.ts`.

- [ ] **Step 1: Write the tests** (each is one `POST` call with a `Request` built like the harness does):

```ts
// desk-1 posts an expense for tag → 403, body.code === "branch_forbidden", and ledger has 0 rows
// desk-1 posts an expense for hel → 200, the stored row has branchId "hel"
// desk-1 posts an expense with no branchId → 400, body.code === "branch_required"
// admin-1 posts a payment for tag → 200, branchId "tag"
// admin-1 updates that payment with patch { branchId: "hel" } → 409
// a clinic with no locations doc: desk-1 posts an expense with no branchId → 200 and the row has no branchId field
```

- [ ] **Step 2: Run** with the emulator up (see memory `route-tests-on-firestore-emulator`: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:branch-money-routes`) — expected: all six pass (Tasks 3, 5, 8 already landed; if any fails, fix the route, not the test).
- [ ] **Step 3: Commit** — "Route tests: a branch you may not use is refused, a missing one is asked for".

---

### Task 10: Team profile — "Branches" tick-list

**Files:**
- Modify: `src/app/(dashboard)/team/SettingsTab.tsx` (new section after the pay form), `src/app/(dashboard)/team/page.tsx` (pass `branches` and an `onSaveBranchIds(ids: string[] | null)` that writes `updateDoc(getClinicDoc("staff", id), { branchIds: ids ?? deleteField() })` — pattern at :374), `src/app/(dashboard)/team/profileKit.tsx:26` (`branchIds?: string[]` on the Staff type), `src/lib/staffRoles.ts:6` (same).
- Modify: `src/config/settingsText.ts` → add under a `team` or the existing team text block: `branchesLabel` ("Branches" / "الفروع"), `branchesAll` ("All branches" / "كل الفروع"), `branchesAdminNote` ("Owners and admins always see every branch." / "المالك والمشرفون بيشوفوا كل الفروع دايمًا."), `branchesHint` ("Untick a branch and this person can't see, book or take money there." / "شيل علامة من فرع وما يقدرش يشوفه ولا يحجز ولا يقبض فيه.").

**Interfaces:**
- Consumes: `useActiveBranch().branches` (page already has it or reads `settings/locations`); `isFullAccessRole(staff.role)`.
- UI: section hidden when the clinic has no branches. For an admin row: the label and `branchesAdminNote`, no boxes. Otherwise one checkbox per branch; all ticked ⇒ save `null` (field deleted = all); none ticked is refused with a toast ("Pick at least one branch" / "اختار فرع واحد على الأقل").

- [ ] **Step 1: Source-pin test** in `tests/branchAccess.test.mts`: `assert.match(read("src/app/(dashboard)/team/SettingsTab.tsx"), /branchIds/, "the Team page lost the branches tick-list")`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npx tsx tests/settingsRegistry.test.mts` (text pairs must have both languages).
- [ ] **Step 5: Commit** — "Team page: which branches each person may work in".

---

### Task 11: The branch on screen honours allowed branches

**Files:**
- Modify: `src/lib/useActiveBranch.ts` (:92-160), `src/components/shared/BranchSelector.tsx` (:17-45)
- Create: `src/lib/useOwnStaffRow.ts` — `useOwnStaffRow(): { row: { id: string; branchIds?: string[]; isDentist?: boolean; role?: string } | null; ready: boolean }`, one `onSnapshot` on `staff where uid == user.uid limit 1` (lift the query from `src/lib/useAlsoDentist.ts:26-40`; `useAlsoDentistState` becomes a thin wrapper over it so the row is read once).
- Test: `tests/branchAccess.test.mts`

**Interfaces:**
- Produces in `branchAccess.ts`: `resolveBranchChoice(allowed: readonly { id: string }[], chosen: string | null, isAdmin: boolean): string` — `""` when `allowed` is empty; `ALL_BRANCHES` only when `chosen === ALL_BRANCHES && isAdmin`; `chosen` when in `allowed`; else `allowed[0].id`.
- `ActiveBranch` gains `allowedBranches: ClinicBranch[]` and `canChooseAll: boolean` (= `isAdmin && allowedBranches.length > 1`). `branches` stays the full list (rooms, labels), `selected` comes from `resolveBranchChoice(allowedBranches, chosen, isAdmin)`. `ready` is false until the staff row is read for non-admins.
- `BranchSelector` renders nothing when `branches.length < 2` **or** when given one allowed branch it renders a fixed pill with the name (no menu). New prop `allowAll` is passed `canChooseAll` by every caller.
- `BookingModal` (`src/components/BookingModal.tsx:338`, its own `branches` state; pickers at :1677 and :1976) stops loading `settings/locations` itself and takes `allowedBranches` from `useActiveBranch()`, so a restricted person can only book into a branch they may work in. An edited appointment on another branch keeps its stored `branchId` (shown read-only, not re-stamped).

- [ ] **Step 1: Write the failing tests**:

```ts
assert.equal(resolveBranchChoice([], ALL_BRANCHES, true), "");
assert.equal(resolveBranchChoice([b("hel"), b("tag")], ALL_BRANCHES, true), ALL_BRANCHES);
assert.equal(resolveBranchChoice([b("tag")], ALL_BRANCHES, false), "tag", "a remembered All from before the change resolves to the first allowed branch");
assert.equal(resolveBranchChoice([b("hel"), b("tag")], "tag", false), "tag");
assert.equal(resolveBranchChoice([b("tag")], "hel", false), "tag", "a remembered branch outside the allowed set falls back");
assert.equal(resolveBranchChoice([b("hel"), b("tag")], null, true), "hel");
```

- [ ] **Step 2: Run** — FAIL (`resolveBranchChoice` not exported).
- [ ] **Step 3: Implement** `resolveBranchChoice`, `useOwnStaffRow`, the `useActiveBranch` change, the `BranchSelector` change, the `BookingModal` change; update every `BranchSelector` call site (`grep -rn "<BranchSelector" src`) to pass `allowAll={canChooseAll}`. Add a source pin: `BookingModal.tsx` matches `/allowedBranches/` and no longer matches `/LOCATIONS_DOC/`.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npm run -s test:homeview` (uses `useAlsoDentistState`).
- [ ] **Step 5: Commit** — "The branch on screen is one the person may work in".

---

### Task 12: "Which branch?" before money under All branches

**Files:**
- Create: `src/components/shared/BranchPickModal.tsx` (portal to `document.body`, z-index above the booking popup — see memory `booking-popup-layer-trap`: z ≥ 300; lists `allowedBranches`; Cancel → `null`).
- Create: `src/lib/useBranchForMoney.ts` — `useBranchForMoney(): { requireBranchForMoney: () => Promise<string | null>; picker: ReactNode }`. Returns `scopeBranchId` at once when it is non-empty or the clinic has no branches (`""`); otherwise opens the modal and resolves with the pick or `null`.
- Modify (every money form awaits it and passes the result as `branchId` in the call; returns on `null`):
  - `src/components/appointments/AppointmentMoneyTab.tsx` — `handleCollect`, `handleQuickAdd`
  - `src/components/QuickPaymentModal.tsx:187`
  - `src/components/PatientFinance.tsx:469, :540` and its "Add treatment" → `ServiceEditorDrawer` save (`src/components/clinical-notes/ServiceEditorDrawer.tsx`, the `createProcedure` call)
  - `src/app/(dashboard)/finance/page.tsx:495` (income/expense)
  - `src/app/(dashboard)/team/page.tsx` — `createStaffSettlement` call
  - `src/components/insurance/ClaimsTable.tsx`, `src/components/insurance/PatientInsuranceTab.tsx` — `collectPatientShare` / `recordInsurerPayment` (`src/components/insurance/api.ts:234-239` gain an optional `branchId` arg forwarded in the body)
- Test: `tests/branchAccess.test.mts` source pins.

**Interfaces:**
- Consumes: `useActiveBranch().scopeBranchId`, `allowedBranches`; `moneyApi` functions accept `branchId?: string` in their args objects (add to `CreatePaymentArgs`, `CreateEntryArgs`, `ProcedureWriteArgs`, `StaffSettlementDraft` callers pass it in the body).

- [ ] **Step 1: Write the source-pin test**: for each of the eight files above, `assert.match(read(rel), /requireBranchForMoney\(\)/, `${rel} records money without asking which branch under All branches`)`.
- [ ] **Step 2: Run** — FAIL on the first file.
- [ ] **Step 3: Implement** the modal, the hook, and the eight call sites. Render `{picker}` once per screen (inside each component that calls the hook).
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npm run -s test:patient-account`, `npm run -s test:payers`.
- [ ] **Step 5: Commit** — "No money without a branch: All-branches admins are asked first".

---

### Task 13: Branch switcher on every money page

**Files:**
- Modify: `src/app/(dashboard)/finance/page.tsx:803` (`PageHeader` children), `src/app/(dashboard)/reports/page.tsx:199-237`, `src/app/(dashboard)/team/page.tsx:632-665`, `src/app/(dashboard)/patients/page.tsx` (its `PageHeader`), `src/components/dashboard/OwnerHome.tsx:329` (already has `activeBranch`; add the selector if missing).

**Interfaces:**
- Consumes: `useActiveBranch()` → `branches, activeBranchId, setActiveBranchId, canChooseAll`; `<BranchSelector branches={branches} value={activeBranchId} onChange={setActiveBranchId} allowAll={canChooseAll} compact />`.
- No filtering yet in this task — the switch only appears and remembers (filtering is Tasks 14–16).

- [ ] **Step 1: Implement** on the five pages.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`; open each page in the dev server and confirm the pill shows the on-screen branch and changing it on Finance changes it on the dashboard (same stored choice).
- [ ] **Step 3: Commit** — "One branch switch, on every page that handles money".

---

### Task 14: Finance page, dashboard income, owner view filter by branch

**Files:**
- Modify: `src/app/(dashboard)/finance/page.tsx` (ledger snapshot at :155-160 → filter with `rowInScope` after load, not in the query; claims at :212 → filter by the patient's branch is NOT done — claims list stays as is), `src/components/dashboard/DesktopDashboard.tsx` (income effect ~:300 and `visitMoney` listener ~:355), `src/components/dashboard/MobileDashboard.tsx` (income effect ~:302), `src/components/dashboard/OwnerHome.tsx:145,168`, `src/components/dashboard/DentistHome.tsx:147`.

**Interfaces:**
- Consumes: `rowInScope(row, scopeBranchId)` (Task 1); `scopeBranchId` from `useActiveBranch()`.
- Where the Finance page draws a breakdown (its category/method tables), rows with no `branchId` under `""` are labelled "before branches" / "قبل الفروع" in a single extra line of the totals, only when such rows exist.

- [ ] **Step 1: Source-pin test** in `tests/branchAccess.test.mts`: the five files match `/rowInScope\(/`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**. Filter in memory after each snapshot (the queries are date-bounded already; a composite index per query is not worth it for two branches).
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npx tsx tests/scheduleCard.test.mts` (already failing on main for an unrelated pin — note the result, do not fix here).
- [ ] **Step 5: Commit** — "Finance, dashboard and owner view: the money of the branch on screen".

---

### Task 15: Reports filter by branch, exports name it

**Files:**
- Modify: `src/app/(dashboard)/reports/page.tsx` — after `const extras = useReportData(...)` (:75) and wherever the page's own ledger/appointments/patients snapshot is held, filter `ledger` and `appointments` rows with `rowInScope`, patients with `rowInScope` too (patients carry `branchId`), **only when `scopeBranchId !== ""`**; pass the filtered sets to the tabs. One place, before any tab.
- Modify: the Excel export helper the reports page uses (`grep -n "xlsx\|toWorkbook\|exportRows" "src/app/(dashboard)/reports/page.tsx"`): add a "Branch" / "الفرع" column resolved from `branches.find(b => b.id === row.branchId)?.name ?? ""`.

**Interfaces:** Consumes Task 1, `useActiveBranch().branches`.

- [ ] **Step 1: Source-pin test**: `reports/page.tsx` matches `/rowInScope\(/` and the export matches `/"Branch"|الفرع/`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npx tsx tests/caseSheet.test.mts` (reads the reports page; note if already failing on main).
- [ ] **Step 5: Commit** — "Reports: every tab reads the branch on screen; exports say which".

---

### Task 16: Payroll, settlements and dentist share per branch

**Files:**
- Modify: `src/app/(dashboard)/team/page.tsx:142, :271` (ledger loads → `rowInScope`), the settlements load in the same file (filter `settlement.branchId` with `rowInScope`), `src/app/(dashboard)/team/MoneyTab.tsx` (show the branch name on each settlement row when the clinic has branches), `src/app/api/payroll/route.ts:67` (accept optional `branchId` in the query and filter rows with `rowInScope`; the Android brief keeps calling without it and gets the clinic total — its response keys are a frozen contract, add nothing).

**Interfaces:** Consumes Task 1; `useActiveBranch().scopeBranchId`.

- [ ] **Step 1: Source-pin test**: `team/page.tsx` and `api/payroll/route.ts` match `/rowInScope\(/`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npx tsx tests/staffReports.test.mts`, `npx tsx tests/staffSettlement.test.mts` (if present).
- [ ] **Step 5: Commit** — "Team: a dentist's share and payouts, per branch".

---

### Task 17: The patient's file shows every row, each with its branch

**Files:**
- Modify: `src/components/PatientFinance.tsx` (row renderers for procedures and payments), `src/components/appointments/AppointmentMoneyTab.tsx` (`chargeRow`, `approvalRow`, receipts list).

**Interfaces:**
- Consumes: `useActiveBranch().branches` for names. A small label `<span>{branchName}</span>` beside the date when the clinic has ≥2 branches; rows with no `branchId` show no label. No filtering here (decided: see, not hide).

- [ ] **Step 1: Source-pin test**: both files match `/branchId/` and `PatientFinance.tsx` does **not** match `/rowInScope\(/` ("the patient's file must show the whole account").
- [ ] **Step 2: Run** — FAIL on the first match.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit -p .`, `npm run -s test:patient-account`.
- [ ] **Step 5: Commit** — "Patient file: one account, every row says which branch took it".

---

### Task 18: Receipt numbers and tax block per branch

**Files:**
- Modify: `src/lib/receiptSettings.ts` — add `receiptCounterDocId(branchId: string | null): string` (`"receipt_counter"` for `null`, else `` `receipt_counter_${branchId}` ``) and give `formatReceiptNumber` an optional 4th arg `prefixOverride?: string` (replaces `settings.numberPrefix` when non-empty; the branch's prefix is followed by `-`).
- Modify: `src/app/api/finance/ledger/route.ts:284, :317` and `src/app/api/insurance/claims/route.ts:771-776, :1007` — read/write the counter at `receiptCounterDocId(check.branchId)`; pass `receiptPrefixFor(branch)` when the row has a branch.
- Modify: `src/lib/receiptRender.ts` — header prints the branch's name and `address` under the clinic name; the ETA block uses `branch.etaBranchCode || eta.branchCode` and `branch.taxRegistration || eta.registrationNumber` (field name per `ReceiptEtaSettings`). The renderer receives `branch?: ClinicBranch | null`, looked up from the row's `branchId` by `src/lib/printPatientReceipt.ts` (which already loads clinic info; add `settings/locations`).
- Test: `tests/receiptNumbers.test.mts` (new) with `"test:receipt-numbers"` in `package.json`.

**Interfaces:** Consumes Task 2 (`receiptPrefixFor`), Task 5/7 (`check.branchId` in scope at the mint sites).

- [ ] **Step 1: Write the failing tests**:

```ts
assert.equal(receiptCounterDocId(null), "receipt_counter");
assert.equal(receiptCounterDocId("hel"), "receipt_counter_hel");
const s = { numberPrefix: "R-", numberIncludesYear: false };
assert.equal(formatReceiptNumber(s, 5, "2026-10-11"), "R-0005");
assert.equal(formatReceiptNumber(s, 5, "2026-10-11", "HEL"), "HEL-0005");
assert.equal(formatReceiptNumber({ ...s, numberIncludesYear: true }, 5, "2026-10-11", "TAG"), "TAG-2026-0005");
```
  And in `tests/branchMoneyRoutes.test.mts` (Task 9 file) add: admin posts one payment for `hel` and one for `tag` → receipt numbers `HEL-0001` and `TAG-0001`; `settings/receipt_counter` (clinic-wide) does not exist afterwards.

- [ ] **Step 2: Run** both — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm run -s test:receipt-numbers`, the emulator suite, `npx tsc --noEmit -p .`, `npx tsx tests/receiptSettings.test.mts` (if present).
- [ ] **Step 5: Commit** — "Receipts: a number sequence and a tax block per branch".

---

### Task 19: Branch settings UI

**Files:**
- Modify: `src/components/settings/LocationsSettings.tsx` (per-branch card, after the lab code field at :281-302): three inputs bound to `receiptPrefix`, `etaBranchCode`, `taxRegistration` via the existing `updateBranch(branch.id, {...})`.
- Modify: `src/config/settingsText.ts` (locations block): `receiptPrefix` ("Receipt prefix" / "بادئة الإيصال"), `receiptPrefixHint` ("Receipts at this branch count on their own: HEL-0001, HEL-0002…" / "إيصالات الفرع ده ليها ترقيم لوحدها: HEL-0001، HEL-0002…"), `etaBranchCode` ("ETA branch code" / "كود الفرع في الضرائب"), `taxRegistration` ("Tax registration (if different)" / "رقم التسجيل الضريبي (لو مختلف)").

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`, `npx tsx tests/settingsRegistry.test.mts`; in the dev server set a prefix on one branch, save, reload, confirm it stays (round-trip through `sanitizeBranch`).
- [ ] **Step 3: Commit** — "Settings → Branches: receipt prefix and tax identity per branch".

---

### Task 20: Walk-through on DENT INN and the write-up

**Files:**
- Modify: `C:\Users\PC\.claude\projects\...\memory\branch-scoping-model.md` (append a dated section pointing at the spec and the two helpers; update `MEMORY.md` hook line).

- [ ] **Step 1:** With the dev server on the worktree, as the owner: Settings → Branches → set `HEL`/`TAG`; Team → a receptionist → tick one branch.
- [ ] **Step 2:** As that receptionist (second browser profile or the Playwright profile): the switcher is a fixed pill; booking popup offers only her branch; Quick Pay on a patient writes a row with her `branchId` (check in Finance under her branch, absent under the other); the receipt number starts with her prefix.
- [ ] **Step 3:** As the owner on "All branches": Finance shows both plus "before branches"; switch to one branch and the totals drop to that branch; Reports → Income tab follows; Team → the dentist's share differs per branch; Quick Pay asks "Which branch?" and Cancel writes nothing.
- [ ] **Step 4:** Record what was seen (one line per check) in the plan's final commit message; fix anything found before shipping.
- [ ] **Step 5: Commit and push** `HEAD:main`; update the memory file.
