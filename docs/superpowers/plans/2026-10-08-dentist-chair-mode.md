# Dentist Chair Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dentist adds and updates their own treatments from their home screen and the patient file without ever seeing a price, a price list, a discount or a dentist picker; other dentists' work is visible but locked.

**Architecture:** One helper (`isChairMode`) decides who is in chair mode; the existing `ServiceEditorDrawer` gains a `dentistMode` switch that hides every money control and forces main-list pricing and the dentist themselves; a new `ChairPopup` shows a patient's treatments (own ones actionable) and hosts the editor; the dentist home opens it from the chair slab, the day list and a search box; the patient file hides money in chair mode. No API or Firestore-rule changes: every write goes through the existing `moneyApi` / insurance routes.

**Tech Stack:** Next.js app router, React, TypeScript, Tailwind v4 tokens (`ink`, `ink-slab`, `accent`, `line`, `surface`), Firestore client listeners, `npx tsx` tests under `tests/`.

**Spec:** `docs/superpowers/specs/2026-10-08-dentist-chair-mode-design.md`

## Global Constraints

- Repo stores CRLF; scripted edits must preserve the file's existing line endings.
- Stage only this work's files; never a bare `git stash`; push to `origin main` when a task is green (owner's standing rule).
- Arabic first: every new string has an `isAr ? "…" : "…"` pair; copy in Egyptian Arabic as in the rest of the app (مخطط / جاري / اتعمل).
- Yellow type only on `bg-ink-slab` and written as `text-[#FACC15]` (the `.text-accent` utility is remapped to dark gold).
- Phone first: buttons `h-12`, popups full screen under 768px (`sm:` breakpoint is 640px; use `md:` = 768px for "desk").
- `dentistMode` absent ⇒ `ServiceEditorDrawer` behaves byte-for-byte as today; reception's screens do not change.
- Dentist-added treatments are priced from the clinic's default price list (`isDefault` in `listsForBranch`) and always `addToLedger: true`; the client sends `unitCost: null` so the server prices from the catalogue.

## Review Focus

1. A dentist whose staff row has no `uid` match (`me === null`): the home must say so and never open the popup with an empty `meStaffId` (which would make every note "mine"). Pinned in Task 2 (`canTouch` with empty me ⇒ false) and Task 5.
2. A note with `doctorId` empty but `doctor` name equal to the dentist's (pre-`doctorId` rows): `isMine` tolerates it, so `canTouch` must too — Task 2 test.
3. An approval-linked note (`claimId`) that is mine: status/notes editable through `updateApprovalProcedure`, never through `updateProcedure` (which would re-price it) — Task 4 routes on `note.claimId`.
4. Status tap while a previous tap is still saving: one in-flight write per note (`busyId`), second tap ignored — Task 4 and Task 5.
5. The editor on a phone with 30+ notes on the patient: the whole window scrolls, Save stays reachable — Task 3 layout change applies to every caller.

---

### Task 1: Chair-mode rule

**Files:**
- Create: `src/lib/chairMode.ts`
- Create: `src/lib/useChairMode.ts`
- Create: `tests/chairMode.test.mts`
- Modify: `package.json` (scripts: add `"test:chair": "npx tsx tests/chairMode.test.mts"`)

**Interfaces:**
- Produces: `export type ChairModeInput = { role?: string | null; isDentist?: boolean; homeView?: "desk" | "chair" | "owner" }` and `export function isChairMode(i: ChairModeInput): boolean` in `src/lib/chairMode.ts`.
- Produces: `export function useChairMode(): { chair: boolean; staffId: string; staffName: string; ready: boolean }` in `src/lib/useChairMode.ts` — reads `useClinic().role`, `useUI().homeView`, and the staff row where `uid == useAuth().user.uid` (one `onSnapshot`, as `DentistHome.tsx:89-105` does); `ready` is false until that row has been looked up; `staffId` is `""` when none.

- [ ] **Step 1: Write the failing test** `tests/chairMode.test.mts` (same assert style as `tests/archSelection.test.mts`):

```ts
assert.equal(isChairMode({ role: "Dentist" }), true);
assert.equal(isChairMode({ role: "Dentist", homeView: "desk" }), true);
assert.equal(isChairMode({ role: "Admin", isDentist: true, homeView: "chair" }), true);
assert.equal(isChairMode({ role: "Owner", isDentist: true, homeView: "chair" }), true);
assert.equal(isChairMode({ role: "Admin", isDentist: true, homeView: "desk" }), false);
assert.equal(isChairMode({ role: "Admin", isDentist: false, homeView: "chair" }), false);
assert.equal(isChairMode({ role: "Receptionist", homeView: "chair" }), false);
assert.equal(isChairMode({}), false);
```

- [ ] **Step 2: Run** `npx tsx tests/chairMode.test.mts` — expected: fails, module not found.
- [ ] **Step 3: Implement** `isChairMode` and the hook. The hook subscribes only when `user?.uid && clinicId`.
- [ ] **Step 4: Run** `npm run test:chair` — expected: `chair mode: 8 checks passed`.
- [ ] **Step 5: Commit** `feat: chair-mode rule and hook`.

### Task 2: Chair popup logic

**Files:**
- Create: `src/lib/chairPopup.ts`
- Create: `tests/chairPopup.test.mts`
- Modify: `package.json` (add `"test:chair-popup": "npx tsx tests/chairPopup.test.mts"`)

**Interfaces:**
- Consumes: `isMine(row, me)` and `DentistIdentity` from `src/lib/dentistHome.ts`; `Note` from `src/components/clinical-notes/types.ts`; `InsuranceClaim`, `lineStatusOf` from `src/lib/insurance/claims.ts`.
- Produces in `src/lib/chairPopup.ts`:
  - `export function canTouch(note: Pick<Note, "doctorId" | "doctor">, me: Pick<DentistIdentity, "staffId" | "name"> | null): boolean` — false when `me` is null or `me.staffId` is empty; otherwise `isMine`.
  - `export type ChairGroup = { key: string; title: { ar: string; en: string }; notes: Note[]; isToday: boolean }`
  - `export function groupForChair(notes: Note[], todayAppointmentId: string | null, visitDates: Record<string, string>): ChairGroup[]` — first group is today's visit (`appointmentId === todayAppointmentId`, title "زيارة النهارده"/"Today's visit", `isToday: true`, present even when empty if `todayAppointmentId` is set); then one group per other `appointmentId` titled by `visitDates[appointmentId]` (fallback the note's `date`), newest first; last group "مش مرتبط بزيارة"/"Not linked to a visit" for notes with no `appointmentId`, omitted when empty.
  - `export type ApprovalLine = { claimId: string; lineIndex: number; name: string; teeth: string; status: LineStatus; mine: boolean }`
  - `export function approvalLinesForChair(claims: InsuranceClaim[], me: { staffId: string } | null): ApprovalLine[]` — live claims only (`status !== "cancelled"`), every line, `mine = claim.dentists[i]?.staffId === me?.staffId`; `name` is the line's wording (`line.description` as the booking tab shows it — copy the field `InsuranceApprovals.tsx` renders), `teeth` the line's tooth string.

- [ ] **Step 1: Write the failing tests** covering: `canTouch` with null me → false; empty staffId → false; `doctorId` match → true; name-only match (no `doctorId`) → true; different dentist → false. `groupForChair`: today's group first and present-but-empty when id given; non-linked last; dates descending. `approvalLinesForChair`: cancelled claim skipped, `mine` true only for the assigned line.
- [ ] **Step 2: Run** `npx tsx tests/chairPopup.test.mts` — expected: fail (module not found).
- [ ] **Step 3: Implement** `src/lib/chairPopup.ts`.
- [ ] **Step 4: Run** `npm run test:chair-popup` — expected: all checks pass.
- [ ] **Step 5: Commit** `feat: chair popup grouping and permissions logic`.

### Task 3: Editor in dentist mode + phone scrolling

**Files:**
- Modify: `src/components/clinical-notes/ServiceEditorDrawer.tsx` (Props at :33-77; field builders :719-1000; stacked layout :1096-1148)
- Modify: `tests/payers.test.mts` (append a block)

**Interfaces:**
- Consumes: `priceLists` state already in the drawer (`listsForBranch`), `PRIVATE_PAYER_ID`.
- Produces: two new props on `ServiceEditorDrawer`: `dentistMode?: boolean` and `meStaffId?: string`.

- [ ] **Step 1: Add the failing source checks** to `tests/payers.test.mts`: the drawer source contains `dentistMode`, the strings `addToLedger: dentistMode ? true : addToLedger` and `doctorId: dentistMode ? meStaffId` , and the literal `unitCost: dentistMode ? null`.
- [ ] **Step 2: Run** `npm run test:payers` — expected: those checks fail.
- [ ] **Step 3: Implement dentist mode.** In `handleSave`'s payload: `doctorId: dentistMode ? meStaffId ?? null : (selectedDoctorId || null)`, `addToLedger: dentistMode ? true : addToLedger`, `unitCost: dentistMode ? null : …`, `priceListId: dentistMode ? (priceLists.find(l => l.isDefault)?.id ?? "") : discount.priceListId`, no discount fields when `dentistMode`. In both layouts, when `dentistMode`: do not render `costField`, `discountField`, `billingStrip`, `ledgerField`, `doctorField`, the pricing-mode select, the extra-procedures link; under `procedureField` render `<p>` "مش في القائمة — الاستقبال هيحط السعر" / "Not in the list — reception sets the price" only when `previewMatched.length < previewProcedures.length`; `needsTypedPrice` is `false` in dentist mode. Approval rows unchanged.
- [ ] **Step 4: Phone scrolling.** In the stacked layout (`content`, :1096-1148): the chart wrapper loses `shrink-0` and the form wrapper loses `flex-1 min-h-0 overflow-y-auto` below `md`; instead the parent `div` (`flex-1 min-h-0 flex flex-col`) becomes `flex-1 min-h-0 overflow-y-auto md:overflow-visible md:flex md:flex-col` and the two children keep their desk classes behind `md:`. The footer with Save stays `shrink-0` outside the scrolling area.
- [ ] **Step 5: Run** `npm run test:payers` and `npx tsc --noEmit -p .` — expected: pass, no errors.
- [ ] **Step 6: Commit** `feat: editor dentist mode; phone editor scrolls as one`.

### Task 4: ChairPopup component

**Files:**
- Create: `src/components/chair/ChairPopup.tsx`
- Create: `src/components/chair/ChairNoteCard.tsx`

**Interfaces:**
- Consumes: Task 1 hook is NOT used here (the caller passes `me`); Task 2 helpers; Task 3 editor props; `TeethChartSelector` (`src/components/clinical-notes/ServiceEditorDrawer.tsx` export) with `patientId`; `treatmentsByTooth` (`src/lib/toothTreatments.ts`) with `suggestCategory` (`src/lib/dentalIcons.ts`); `updateProcedure`, `updateApprovalProcedure`, `deleteProcedure` from `src/lib/moneyApi.ts`; `patchClaim` from `src/components/insurance/api.ts`; `claimProgress`, `LINE_STATUSES`, `lineStatusOf` from `src/lib/insurance/claims.ts`; `useUI().confirm` for delete.
- Produces: `export default function ChairPopup(props: { isOpen: boolean; onClose: () => void; patientId: string; appointment: { id: string; branchId?: string | null } | null; me: DentistIdentity; services: Service[]; doctors: Staff[] })`.
  - `ChairNoteCard(props: { note: Note; mine: boolean; busy: boolean; dentistName: string; onStatus: (s: "Planned" | "Ongoing" | "Completed") => void; onEdit: () => void; onDelete: () => void; isAr: boolean })` — name centred `text-lg font-black`, teeth, status pill, dentist; `mine` ⇒ the three status buttons (selected = `bg-ink-slab text-white`, done gets `Check` in `text-[#FACC15]`), عدّل, احذف; else a `Lock` icon with the dentist's name and no buttons.

- [ ] **Step 1: Build the shell.** Portal to `document.body` with `dir`, `cairo.variable`, `arabic-ui`, as `ApprovalReadSheet.tsx` does; full screen under `md`, else `max-w-5xl max-h-[92vh] rounded-[2rem]`; header `bg-ink-slab`, title `text-[#FACC15]` = patient name, subtitle "الكرسي · د. {me.name}"; `+ أضف علاج` pinned in the footer (`bg-accent text-ink-on-accent h-12`).
- [ ] **Step 2: Data.** On open: `getDoc(patients/{id})` → name, `fileId`, age (`dob`/`age` as the patient page computes `displayAge`), phone, `allergies`, `teethData`; `onSnapshot(clinical_notes where patientId == id)`; `onSnapshot(insurance_claims where patientId == id)` (only when `isAnyUnlocked(clinic, "insurance")`); `visitDates` from `getDocs(appointments where patientId == id)` → `{[id]: date}`.
- [ ] **Step 3: Sections.** Patient strip (name, `fileId`, age, phone as a WhatsApp link via `openWhatsApp`, allergies in `text-rose-700`); `TeethChartSelector` with `patientId`, `selected` state `chartTeeth`; groups from `groupForChair(notes, appointment?.id ?? null, visitDates)` → `ChairNoteCard`s; approvals from `approvalLinesForChair` → rows with the same three buttons when `mine`, calling `patchClaim(clinicId, claimId, { lineStatus: { [i]: next } })`.
- [ ] **Step 4: Actions.** Status on own note: if `note.claimId` → `updateApprovalProcedure(note.id, { patientId, appointmentId: note.appointmentId, status, doctorId: me.staffId, note: note.note ?? "" })`; else `updateProcedure(note.id, { patientId, appointmentId: note.appointmentId ?? null, procedures: [note.procedure], selectedTeeth: parseTeethString(note.tooth), doctorId: me.staffId, status, note: note.note, date: note.date, addToLedger: true })` — one `busyId` at a time. Delete: `confirm` "تحذف العلاج ده؟" then `deleteProcedure(note.id)`. Edit / add: render `ServiceEditorDrawer` `inline` below the list with `dentistMode`, `meStaffId={me.staffId}`, `appointmentId={appointment?.id ?? null}`, `selectedTeethOverride={chartTeeth}`, `onSelectedTeethChange={setChartTeeth}`, `hideTeethSelector`, `initialNote` for edit; `onSaved` closes the editor and shows "اتحفظ".
- [ ] **Step 5: Verify** `npx tsc --noEmit -p .` and `npx eslint src/components/chair` — expected: clean.
- [ ] **Step 6: Commit** `feat: chair popup`.

### Task 5: Dentist home

**Files:**
- Modify: `src/components/dashboard/DentistHome.tsx` (chair slab :405-470; day list :470-568; editor mount :706-726)

**Interfaces:**
- Consumes: `ChairPopup` (Task 4), Task 3 props, `isMine`.

- [ ] **Step 1: Chair slab.** Under the hero's treatment line, list `notes.filter(n => n.appointmentId === hero.id)` **plus** the other dentists' notes on that visit (needs one more listener: `clinical_notes where appointmentId == hero.id`, replacing nothing). Each as a compact row: name, teeth, status; mine ⇒ three status buttons (`SlabButton` style, white on the slab); others ⇒ `Lock`. Replace "ابدأ ملاحظة النهارده" with **+ أضف علاج** → `setNoteCtx` as today but the mounted `ServiceEditorDrawer` gets `dentistMode` and `meStaffId={me.staffId}`. Add "افتح الكرسي" → `setChair({ patientId, appointment: hero })`.
- [ ] **Step 2: Day cards.** Under each `dayMine` row: chips for `notes` on that appointment (name · status), tap cycles Planned → Ongoing → Completed via `updateProcedure` (same payload rule as Task 4, `busyId` guard); a small "الكرسي" button opens `ChairPopup` for that appointment.
- [ ] **Step 3: Search.** Above the day list: `<input>` "دوّر على مريض بالاسم أو التليفون"; over `patients` (already loaded), first 8 whose `name` or `phone` contains the query; tap → `setChair({ patientId, appointment: null })`.
- [ ] **Step 4: Guard.** When `me === null`, the slab shows "حسابك مش مربوط بدكتور — كلّم الإدارة" and no add/status controls render.
- [ ] **Step 5: Mount** `<ChairPopup isOpen={!!chair} … me={me} services={services} doctors={doctors} />`.
- [ ] **Step 6: Verify** `npx tsc --noEmit -p .`, `npm run test:dentist` — expected: pass.
- [ ] **Step 7: Commit** `feat: dentist home opens the chair popup; status switches on the slab and day cards`.

### Task 6: Patient file in chair mode

**Files:**
- Modify: `src/app/(dashboard)/patients/[id]/page.tsx` (tabs :916-926; patient card balance field; editor mount; `TimelineCard` props)
- Modify: `src/components/clinical-notes/TimelineCard.tsx` and `ServiceItem.tsx` (new prop `hideMoney?: boolean`; `canTouch` gate for edit/delete via a new prop `canEditNote?: (note: Note) => boolean`)

**Interfaces:**
- Consumes: `useChairMode()` (Task 1), `canTouch` (Task 2), Task 3 props.

- [ ] **Step 1:** `const { chair, staffId, staffName } = useChairMode()`; tabs `finance` and `insurance` get `show: … && !chair`; the balance field is skipped when `chair`.
- [ ] **Step 2:** `TimelineCard` passes `hideMoney` and `canEditNote` to `ServiceItem`; `ServiceItem` skips the EGP chip when `hideMoney`, and renders edit/delete only when `canEditNote?.(note) !== false`.
- [ ] **Step 3:** The clinical record's `ServiceEditorDrawer` gets `dentistMode={chair}` and `meStaffId={staffId}`; `canEditNote={(n) => !chair || canTouch(n, { staffId, name: staffName })}`.
- [ ] **Step 4: Verify** `npx tsc --noEmit -p .`; `npm run test:tour` still fails only on the pre-existing `lead_grading` stop (no new failures).
- [ ] **Step 5: Commit** `feat: patient file hides money and locks other dentists' notes in chair mode`.

### Task 7: Ship

- [ ] **Step 1:** `npx tsc --noEmit -p .`; `npm run test:chair`, `test:chair-popup`, `test:payers`, `test:dentist`, `test:teeth`, `test:arch`, `test:insurance-metlife`, `test:insurance-nextcare` — all pass.
- [ ] **Step 2:** Rebase on `origin/main`, push `HEAD:main`.
- [ ] **Step 3:** Update memory `dentist-home.md` (chair mode shipped, what is hidden, the hard-lock decision) and tell the owner the phone/desk test steps with a Dentist login.
