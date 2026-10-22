# Call Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff set "call this patient on day X (optional time)" for a person or a role; on that day the recipients get a bell/push notification and WhatsApp, the desk handles calls from a dashboard card and a Calls page (done / call again / book), and Owner/Admin get an evening list of missed calls.

**Architecture:** A new `call_reminders` collection, written only by one server route (`/api/call-reminders`) and read live by the client. All decisions (fire time in Cairo, who receives, what is due, message text) live in one pure module tested without Firebase. Delivery rides the existing 10-minute alert sweep and the existing notification gate (`deliverClinicNotification`), so it ships with a normal push.

**Tech Stack:** Next.js App Router (TypeScript), Firebase Admin SDK (server), Firestore web SDK (`onSnapshot` reads), tsx test scripts (`node:assert/strict`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-22-call-reminders-design.md`

## Global Constraints

- All dates and times are on the clinic clock, `Africa/Cairo` (Egypt observes DST: UTC+3 in summer, UTC+2 in winter). Never use the server's local time.
- Firestore writes never contain `undefined`; optional fields are omitted.
- **No composite indexes.** Every query is a single equality or a single-field range; further filtering happens in memory. (A new index would need a manual Firebase deploy.)
- Notifications go through `deliverClinicNotification` with `event: "<catalogue id>"`; passing `roles:` at a call site fails `npm run test:notify`.
- After any edit to `src/lib/notificationCatalog.ts`, run `npm run gen:notify-catalog` (regenerates `functions/notificationCatalog.js`; never hand-edit that file).
- UI text in both languages via the file's existing `isAr ? "…" : "…"` pattern; Arabic in the Egyptian colloquial the app already uses. Copy fixed by the spec is quoted in the tasks.
- The repo stores CRLF; keep edited files CRLF (do not rewrite whole files with LF).
- No new npm dependencies. No changes under `android/`.
- Reason field: free text, required, trimmed, ≤ 300 characters.

## Review Focus

1. **DST:** a reminder for 10:00 on 2026-07-15 must fire at 07:00 UTC and on 2026-12-15 at 08:00 UTC — owned by Task 1 (`computeFireAt` tests).
2. **Today, morning time already passed:** date = today with no time, created at 15:00 → saved (not refused) with `fireAt` in the past, and the next sweep sends it — Task 1 (`validateReminderInput` accepts today) + Task 2 (due query includes past `pendingFireAt`).
3. **Two overlapping sweeps:** the same due reminder is delivered once — Task 2 (claim test).
4. **Owner with no staff row, staff with no branch list:** a role reminder for "Admin" reaches the owner; a Receptionist with no `branchIds` counts as working at every branch — Task 1 (`resolveRecipients` tests).
5. **"Book now" fails or is closed without saving:** the reminder stays open — Task 5 (book only after `saveBooking` resolves; component test of the handler order).

---

### Task 1: Pure logic — `src/lib/callReminders.ts`

**Files:**
- Create: `src/lib/callReminders.ts`
- Create: `tests/callReminders.test.mts`
- Modify: `package.json` (add `"test:calls": "npx tsx tests/callReminders.test.mts"`)

**Interfaces:**
- Produces (exported from `src/lib/callReminders.ts`, no Firebase imports):
  ```ts
  export const CALL_REMINDERS_COLLECTION = "call_reminders";
  export const REASON_MAX = 300;
  export type ReminderStatus = "open" | "done" | "rescheduled" | "booked";
  export type ReminderSource = "patient" | "booking" | "treatment";
  export type ReminderRecipient =
    | { kind: "person"; uid: string; name: string }
    | { kind: "role"; role: "Admin" | "Dentist" | "Receptionist" | "Assistant" };
  export interface CallReminder {            // the stored shape, timestamps as epoch ms in this module
    id: string; patientId: string; patientName: string; patientPhone: string;
    branchId: string | null; reason: string; source: ReminderSource; sourceNoteId?: string;
    date: string; time: string | null; fireAtMs: number;
    recipient: ReminderRecipient; status: ReminderStatus;
    note?: string; handledBy?: { uid: string; name: string }; handledAtMs?: number;
    appointmentId?: string; previousId?: string; nextId?: string;
    notifiedAtMs?: number; createdBy: { uid: string; name: string }; createdAtMs: number;
  }
  export interface ReminderInput { patientId: string; date: string; time: string | null; reason: string;
    recipient: ReminderRecipient; source: ReminderSource; sourceNoteId?: string }
  export function cairoInstant(ymd: string, hhmm: string, timeZone?: string): Date;
  export function computeFireAt(date: string, time: string | null, morningHour: number, timeZone?: string): Date;
  export function validateReminderInput(input: ReminderInput, todayYmd: string):
    { ok: true; value: ReminderInput } | { ok: false; error: "date" | "time" | "reason" | "recipient" };
  export function cleanReason(raw: string): string;   // trim, collapse whitespace/newlines to one space, cut to REASON_MAX
  export interface StaffForRecipients { uid: string; role: string; branchIds?: string[] | null }
  export function resolveRecipients(r: ReminderRecipient, branchId: string | null, members: StaffForRecipients[]): string[];
  export function quickDate(todayYmd: string, chip: "tomorrow" | "3days" | "week" | "month"): string;
  export function sortForCard(rows: CallReminder[], nowMs: number): CallReminder[];
  export function daysLate(r: CallReminder, todayYmd: string): number;      // 0 when due today or later
  export function reminderWhatsappText(r: Pick<CallReminder, "patientName"|"patientPhone"|"reason"|"createdBy"|"createdAtMs">, link: string): string;
  export function missedSummaryText(today: CallReminder[], olderCount: number, roleLabel: (role: string) => string): string | null;
  export function recipientLabel(r: ReminderRecipient, isAr: boolean): string;
  ```

- [ ] **Step 1: Write the failing tests** in `tests/callReminders.test.mts` (style of `tests/chairMode.test.mts`: an `eq` helper, a final `console.log("call reminders: N checks passed")`):
  - `computeFireAt("2026-07-15", "10:00", 10).toISOString() === "2026-07-15T07:00:00.000Z"` (summer, UTC+3)
  - `computeFireAt("2026-12-15", "10:00", 10).toISOString() === "2026-12-15T08:00:00.000Z"` (winter, UTC+2)
  - `computeFireAt("2026-12-15", null, 9).toISOString() === "2026-12-15T07:00:00.000Z"` (blank time → morning hour)
  - `validateReminderInput({...valid, date: "2026-10-21"}, "2026-10-22")` → `{ ok: false, error: "date" }`; same date as today → `ok: true`
  - `time: "25:00"` → error `"time"`; `reason: "   "` → error `"reason"`; person recipient with empty uid → error `"recipient"`
  - `cleanReason("  سعر\nالتركيبة  ")` → `"سعر التركيبة"`; a 400-char reason → length 300
  - `resolveRecipients({kind:"role",role:"Receptionist"}, "b1", [{uid:"a",role:"Receptionist",branchIds:["b1"]},{uid:"b",role:"Receptionist",branchIds:["b2"]},{uid:"c",role:"Receptionist"},{uid:"d",role:"Dentist"}])` → `["a","c"]`
  - role `"Admin"` with members `[{uid:"o",role:"Owner"},{uid:"x",role:"Admin"}]` → `["o","x"]` (Owner addressed as Admin)
  - person recipient whose uid is not in members → `[]`; `branchId: null` → branch filter ignored
  - `quickDate("2026-10-31","tomorrow") === "2026-11-01"`, `"3days"` → `"2026-11-03"`, `"week"` → `"2026-11-07"`, `"month"` → `"2026-11-30"`
  - `sortForCard`: overdue (older `fireAtMs`) before today's, today's by `fireAtMs` ascending
  - `daysLate` → 2 for a reminder dated `"2026-10-20"` with today `"2026-10-22"`
  - `reminderWhatsappText` equals exactly (spec copy, date in Arabic day + month):
    ```
    📞 تذكير بمكالمة
    المريض: منى أحمد — 01012345678
    السبب: سعر التركيبة، قالت هتفكر
    من: سارة · يوم 20 أكتوبر
    افتح: https://alphadental.app/calls?id=r1
    ```
  - `missedSummaryText([], 0, …) === null`; with two of today's misses (one person "سارة", one role Receptionist → label "الاستقبال") and `olderCount` 5:
    ```
    ⚠️ ٢ مكالمات ما اتعملتش النهارده:
    منى أحمد (سارة) · كريم علي (الاستقبال)
    و٥ متأخرة من أيام قبل كده
    ```
    (Arabic-Indic digits for the counts; the "و…" line only when `olderCount > 0`)

- [ ] **Step 2: Run, verify it fails**
  Run: `npx tsx tests/callReminders.test.mts` — Expected: FAIL, cannot find module `../src/lib/callReminders`.

- [ ] **Step 3: Implement `src/lib/callReminders.ts`**
  `cairoInstant`: treat `ymd hh:mm` as UTC to get a guess, read the zone's offset at that guess with `Intl.DateTimeFormat(…, { timeZone, hourCycle: "h23", … }).formatToParts`, subtract it, and re-check the offset once at the corrected instant (handles the DST edges). Default `timeZone = "Africa/Cairo"`. Arabic month names: يناير فبراير مارس أبريل مايو يونيو يوليو أغسطس سبتمبر أكتوبر نوفمبر ديسمبر. Role labels for `recipientLabel` (Arabic / English): Admin الإدارة / Admins, Dentist الدكاترة / Dentists, Receptionist الاستقبال / Reception, Assistant المساعدين / Assistants; a person shows their name.

- [ ] **Step 4: Run, verify it passes**
  Run: `npm run test:calls` — Expected: `call reminders: N checks passed`.

- [ ] **Step 5: Commit**
  `git add src/lib/callReminders.ts tests/callReminders.test.mts package.json` · message `Call reminders: pure rules (fire time, recipients, texts)`

---

### Task 2: Catalogue events + sending in the 10-minute sweep

**Files:**
- Modify: `src/lib/notificationCatalog.ts` (two events, group `frontdesk`)
- Regenerate: `functions/notificationCatalog.js` (`npm run gen:notify-catalog`)
- Modify: `src/lib/notificationDelivery.ts` (`DeliverOptions.ignoreQuietHours?: boolean` — when true, neither push nor WhatsApp is held by quiet hours)
- Create: `src/lib/alerts/callReminderSweep.ts`
- Modify: `src/lib/alerts/sweep.ts` (call the two new steps from `runAlertSweep`)
- Modify: `tests/notifications.test.mts` only if its "every event is raised" scan does not already see `event: "callReminderDue"` in `src/lib/alerts/callReminderSweep.ts` — extend the scan the same way it reads `src/lib/alerts/*`
- Create: `tests/callReminderSweep.test.mts` (Firestore emulator; template `tests/recycleBinCascade.test.mts`)

**Interfaces:**
- Consumes: Task 1 (`CALL_REMINDERS_COLLECTION`, `resolveRecipients`, `reminderWhatsappText`, `missedSummaryText`, `recipientLabel`).
- Produces:
  ```ts
  // catalogue ids
  "callReminderDue"      // bell + push + WhatsApp on; roles ["Receptionist"] (unused: always sent with uids); timings: [{ key: "hour", kind: "hourOfDay", en: "Morning time", ar: "ميعاد الصبح", fallback: 10, min: 0, max: 23 }]
  "callRemindersMissed"  // bell + WhatsApp on, push off; roles ["Owner","Admin"]; timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 21, min: 0, max: 23 }]
  // src/lib/alerts/callReminderSweep.ts
  export type Deliver = typeof deliverClinicNotification;
  export async function sendDueCallReminders(clinicId: string, now: Date, out: string[], deps?: { deliver?: Deliver }): Promise<number>;
  export async function sendMissedCalls(clinicId: string, prefs: AlertPreferences, today: string, now: Date, out: string[], deps?: { deliver?: Deliver }): Promise<boolean>;
  ```
  Catalogue copy: `callReminderDue` en "A call to make", ar "مكالمة لازم تتعمل", whenAr "في اليوم والساعة اللي اتحددوا في التذكير، للشخص أو الدور اللي اتحدد". `callRemindersMissed` en "Calls not made today", ar "مكالمات ما اتعملتش", whenAr "آخر اليوم، لو فيه مكالمات النهارده ما اتعملتش".

- [ ] **Step 1: Write the failing emulator test** `tests/callReminderSweep.test.mts` (seed clinic, patient, staff rows, users; inject `deliver` as a recorder):
  - `sends a due reminder once to its recipients`: reminder with `pendingFireAt` 5 minutes ago, recipient role Receptionist at branch b1 → recorder called once with `uids` = the b1 receptionists, `event: "callReminderDue"`, `ignoreQuietHours: true`, `actionUrl: "/calls?id=<id>"`, `whatsappText` = `reminderWhatsappText(...)`; afterwards the doc has `notifiedAt` and no `pendingFireAt`
  - `two overlapping sweeps send once`: `Promise.all([sendDueCallReminders(...), sendDueCallReminders(...)])` → recorder called once
  - `not yet due is left alone`: `pendingFireAt` in 1 hour → not called, field kept
  - `patient missing → not sent`: patient doc absent → not called, `pendingFireAt` removed, `deliveryError: "patient-missing"`
  - `nobody to receive`: person recipient no longer on staff → not called, `deliveryError: "nobody"`, `pendingFireAt` removed, status still `open`
  - `uses the patient's current name and phone`: patient renamed after save → text carries the new name
  - `missed: one message a day`: two open reminders with `fireAt` today before `now`, one done; `sendMissedCalls` at the configured hour twice → recorder called once with `event: "callRemindersMissed"` and `whatsappText` = `missedSummaryText(...)`; with zero open → not called
  - `missed: not before the hour`: clinic hour < configured hour → not called

- [ ] **Step 2: Run, verify it fails** — start the emulator per the template (cached jar, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`), run `npx tsx tests/callReminderSweep.test.mts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**
  - Catalogue rows as above; `npm run gen:notify-catalog`.
  - `ignoreQuietHours` in the web gate. If `test:notify` enforces parity of gate options with `functions/clinicPush.js`, mirror it there; otherwise leave Functions untouched (they never raise these events).
  - `sendDueCallReminders`: query `pendingFireAt <= now` (limit 50). Per doc, claim in a transaction: re-read, skip unless `pendingFireAt` still present and `status === "open"`, then set `notifiedAt = serverTimestamp()` and delete `pendingFireAt`. Only the claimer delivers. Read the patient (missing → `deliveryError: "patient-missing"`), resolve recipients from `readClinicMembers` joined with staff `branchIds` (empty → `deliveryError: "nobody"`), deliver with `{ event: "callReminderDue", uids, ignoreQuietHours: true, actionUrl, whatsappText, data: { screen: "calls" } }`, title "📞 تذكير بمكالمة", body `"<patient> — <reason>"`. A delivery that throws is recorded as `deliveryError` and not retried. Push `"callReminderDue:<id>"` to `out`.
  - `sendMissedCalls`: only when `clinicHourNow(now) === notifyTiming("callRemindersMissed", "hour", prefs)`; claim `alert_marks/callsMissed_<today>` with `.create()` (an existing doc means already sent); query `fireAt >= start of today (Cairo)` and filter `status === "open"` and `fireAtMs <= now`; query `status == "open"` for the older count (`fireAtMs < start of today`). Nothing open today → no send (and do not claim).
  - In `runAlertSweep`: `sendDueCallReminders` every tick when `isOn("callReminderDue")`; `sendMissedCalls` inside the `minute < 10` block when `isOn("callRemindersMissed")`; both wrapped in `.catch(e => console.warn(...))` like their neighbours.

- [ ] **Step 4: Run, verify** — `npx tsx tests/callReminderSweep.test.mts` passes; `npm run test:notify` prints its pass line; `npm run test:calls` still passes.

- [ ] **Step 5: Commit** — `Call reminders: send due reminders and the evening misses from the alert sweep`

---

### Task 3: The write route, rules and recycle bin

**Files:**
- Create: `src/app/api/call-reminders/route.ts`
- Create: `src/lib/callRemindersServer.ts` (Admin SDK writes, called by the route; keeps the route thin)
- Modify: `firestore.rules` (add `&& sub != 'call_reminders'` to `memberMayWrite`, with a one-line comment: written only by /api/call-reminders)
- Modify: `tests/permissions.test.mts` (the exclusion-chain list, if it enumerates collections)
- Modify: `src/lib/recycleBin.ts` (`PATIENT_CASCADE_COLLECTIONS` + label `call_reminders: ["calls", "مكالمات"]`)
- Modify: `tests/recycleBinCascade.test.mts` (a patient's reminder goes to the bin and back)
- Create: `tests/callRemindersRoute.test.mts` (emulator; template `tests/recycleBinCascade.test.mts`)

**Interfaces:**
- Consumes: Task 1 (`validateReminderInput`, `cleanReason`, `computeFireAt`); `requireStaffUser(request, clinicId)` → `{ ok: true, uid, role, name, permissions, clinicId }`; `readAlertPreferences`, `notifyTiming("callReminderDue","hour",prefs)`.
- Produces: `POST /api/call-reminders` with JSON `{ clinicId, branchId?, action, ... }`:
  | action | body | result |
  |---|---|---|
  | `create` | `ReminderInput` | `{ ok: true, id }` |
  | `done` | `{ id, note? }` | `{ ok: true }` |
  | `reschedule` | `{ id, note?, date, time }` | `{ ok: true, id: newId }` |
  | `book` | `{ id, appointmentId, appointmentDate }` | `{ ok: true }` |
  | `delete` | `{ id }` | `{ ok: true }` |
  Errors: `400 { error: "date"|"time"|"reason"|"recipient"|"bad-action" }`, `403 { error: "forbidden" }`, `404 { error: "not-found" }`, `409 { error: "already-handled" }`.

- [ ] **Step 1: Write the failing route test** `tests/callRemindersRoute.test.mts`:
  - `create` by a Receptionist → doc with `status: "open"`, `fireAt` = `computeFireAt(...)` using the clinic's morning hour, `pendingFireAt === fireAt`, `createdBy.uid`, `patientName`/`patientPhone` snapshots, `branchId` from the request, no `undefined`-valued keys
  - `create` with yesterday's date → 400 `date`; with a patient id that does not exist → 404
  - `done` with note → `status: "done"`, `note`, `handledBy`, `handledAt`, `pendingFireAt` removed
  - `reschedule` → old doc `status: "rescheduled"`, `nextId`; new doc `status: "open"`, same `recipient` and `reason`, `previousId`, new `fireAt`
  - `book` → `status: "booked"`, `appointmentId`, `note` = `"اتحجز ميعاد يوم <appointmentDate>"`
  - any handling action on a non-open reminder → 409
  - `delete` by the creator → removed; by another Receptionist → 403; by an Admin → removed
  - a user from another clinic → 403
  - Run `npm run test:bin-cascade` after adding the cascade case: binning the patient removes the reminder from `call_reminders`, restoring brings it back.

- [ ] **Step 2: Run, verify it fails** — `npx tsx tests/callRemindersRoute.test.mts` (emulator running). Expected: FAIL, route module not found.

- [ ] **Step 3: Implement** the route (method switch on `action`, `requireStaffUser` with the body's `clinicId`) and `callRemindersServer.ts` (one exported function per action, transactions for `done`/`reschedule`/`book` so a reminder cannot be handled twice). The rules edit, the cascade entry and its label.

- [ ] **Step 4: Run, verify** — the route test, `npm run test:bin-cascade`, `npx tsx tests/permissions.test.mts` all pass; `npm run test:rules` if the emulator for it is available offline (do not download; skip and say so if not).

- [ ] **Step 5: Commit** — `Call reminders: write route, rules exclusion, recycle-bin cascade`

---

### Task 4: Creating reminders — dialog, three entry points, patient-file list

**Files:**
- Create: `src/lib/callRemindersApi.ts` (client calls, modelled on `src/lib/moneyApi.ts`: Bearer token from `auth.currentUser`, `clinicId: currentClinicId()`, branch via `withBranch`)
- Create: `src/components/calls/CallReminderDialog.tsx`
- Create: `src/components/calls/PatientCallsPanel.tsx` (badge + history for one patient)
- Modify: `src/app/(dashboard)/patients/[id]/page.tsx` (button "تذكير بمكالمة" with the file's header actions; render `PatientCallsPanel`)
- Modify: `src/components/BookingModal.tsx` (same button beside the selected patient, only when a patient is chosen and is not `NEW_PATIENT`)
- Modify: `src/components/clinical-notes/ServiceItem.tsx` + `TimelineCard.tsx` (new optional prop `onCallReminder?: (note: Note) => void`, a menu item "تذكير بمكالمة"; wired from `src/components/clinical-notes/index.tsx`)

**Interfaces:**
- Consumes: Task 1 (`ReminderInput`, `quickDate`, `REASON_MAX`, `recipientLabel`), Task 3 route.
- Produces:
  ```ts
  // src/lib/callRemindersApi.ts
  export async function createCallReminder(input: ReminderInput): Promise<string>;
  export async function markCallDone(id: string, note?: string): Promise<void>;
  export async function rescheduleCall(id: string, date: string, time: string | null, note?: string): Promise<string>;
  export async function markCallBooked(id: string, appointmentId: string, appointmentDate: string): Promise<void>;
  export async function deleteCallReminder(id: string): Promise<void>;
  export class CallReminderApiError extends Error { status: number; code?: string }
  // src/components/calls/CallReminderDialog.tsx
  export default function CallReminderDialog(props: { isOpen: boolean; onClose: () => void;
    patient: { id: string; name: string }; source: ReminderSource; sourceNoteId?: string;
    initialReason?: string; onSaved?: (id: string) => void }): JSX.Element | null;
  // src/components/calls/PatientCallsPanel.tsx
  export default function PatientCallsPanel(props: { patientId: string }): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing source test** — add to `tests/callReminders.test.mts` a section reading files with `readFileSync` (the pattern `tests/chairMode.test.mts` uses):
  - `src/app/(dashboard)/patients/[id]/page.tsx`, `src/components/BookingModal.tsx` and `src/components/clinical-notes/index.tsx` each import `CallReminderDialog`
  - `CallReminderDialog.tsx` contains the four chips' labels "بكرة", "بعد ٣ أيام", "بعد أسبوع", "بعد شهر" and calls `createCallReminder`
  - `BookingModal.tsx` opens the dialog only when the selected patient is not `NEW_PATIENT`

- [ ] **Step 2: Run, verify it fails** — `npm run test:calls`. Expected: FAIL on the new checks.

- [ ] **Step 3: Implement**
  - Dialog fields per spec §1: day (chips + `<input type="date" min={today}>`), optional time (`<input type="time">`, helper text "لو سبتها فاضية هتوصل الساعة <morning hour>"), reason (`<textarea maxLength={300}>`, required), recipient (a select listing staff names then the four roles; default the current user). A treatment card passes `initialReason` = `متابعة: <treatment name>` plus ` — سنة <tooth>` when the note has a tooth. Errors from the route are shown in the dialog in the user's language; the button disables while saving. The dialog sits above the booking pop-up (z-index higher than the pop-up's `z-200`; see the booking-popup layer trap).
  - `PatientCallsPanel`: `onSnapshot` on `call_reminders` where `patientId ==` the patient; sorted in memory (open first by `fireAt`, then handled newest first). Open ones show the badge text "مكالمة يوم <weekday>" in the file header area; the list shows date, reason, recipient, status, note, handler.

- [ ] **Step 4: Run, verify** — `npm run test:calls` passes; `npx tsc --noEmit -p .` reports nothing in the touched files.

- [ ] **Step 5: Commit** — `Call reminders: create from the patient file, booking pop-up and treatment card`

---

### Task 5: Handling calls — shared actions + dashboard card

**Files:**
- Create: `src/components/calls/CallRow.tsx` (one reminder row with the three actions; used by the card and the page)
- Create: `src/components/calls/CallsTodayCard.tsx`
- Create: `src/lib/useOpenCallReminders.ts` (live hook)
- Modify: `src/components/dashboard/DesktopDashboard.tsx` and `src/components/dashboard/OwnerHome.tsx` (render the card)

**Interfaces:**
- Consumes: Task 1 (`sortForCard`, `daysLate`, `recipientLabel`, `quickDate`), Task 4 (`markCallDone`, `rescheduleCall`, `markCallBooked`), `saveBooking` from `src/lib/bookingService.ts` (returns `{ appointmentId, patientId }`), `BookingModal` with `preSelectedPatient`, `useActiveBranch`.
- Produces:
  ```ts
  export function useOpenCallReminders(): { rows: CallReminder[]; loading: boolean };   // status == "open", branch on screen (all branches for Owner/Admin on "all")
  export default function CallRow(props: { reminder: CallReminder; meUid: string; todayYmd: string }): JSX.Element;
  export default function CallsTodayCard(): JSX.Element | null;   // null when nothing is due today or overdue
  ```

- [ ] **Step 1: Write the failing test** — add to `tests/callReminders.test.mts`:
  - source check: `CallRow.tsx` calls `markCallBooked` only after `await saveBooking(` (the index of `markCallBooked(` is greater than the index of `await saveBooking(` inside the same handler)
  - source check: `DesktopDashboard.tsx` and `OwnerHome.tsx` render `<CallsTodayCard`
  - pure check of the card's selection, factored into Task 1 as `export function dueOnCard(rows: CallReminder[], nowMs: number, todayYmd: string): CallReminder[]` — open rows dated today or earlier, sorted by `sortForCard`; a row dated tomorrow is excluded (add the export to `src/lib/callReminders.ts`)

- [ ] **Step 2: Run, verify it fails** — `npm run test:calls`.

- [ ] **Step 3: Implement**
  - `CallRow`: patient name (link to the file), `tel:` button with the phone, reason, `recipientLabel` (+ "ليك" when the viewer is the person recipient, "مالهاش حد" when a person recipient is no longer on staff), "متأخرة منذ <n> يوم" when `daysLate > 0`. Buttons: **تم** (note box, optional) · **كلّمه تاني** (note + chips بكرة / بعد ٣ أيام / بعد أسبوع + date) · **احجز** (opens `BookingModal` with `preSelectedPatient`; its `onSave` runs `saveBooking(data, userCtx, fireOwnerWhatsAppAlert)` the same way `DesktopDashboard.handleSaveBooking` does, then `markCallBooked(id, appointmentId, data.date)`; closing the modal without saving leaves the reminder open).
  - `CallsTodayCard`: title "مكالمات النهارده", rows from `dueOnCard(useOpenCallReminders().rows, …)`, hidden when empty, placed above the day's appointments on the desk dashboard and beside the WhatsApp block on the owner home.

- [ ] **Step 4: Run, verify** — `npm run test:calls`; `npx tsc --noEmit -p .` clean.

- [ ] **Step 5: Commit** — `Call reminders: dashboard card with done, call again and book`

---

### Task 6: The Calls page

**Files:**
- Create: `src/app/(dashboard)/calls/page.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (nav item `{ key: "calls", href: "/calls", icon: PhoneCall, badge: <open due count> }` in both nav lists, next to `chats`; label "المكالمات" / "Calls")

**Interfaces:**
- Consumes: Task 5 (`CallRow`, `useOpenCallReminders`), Task 1 (`dueOnCard`, `daysLate`), `deleteCallReminder` (Task 4).
- Produces: route `/calls`, honouring `?id=<reminderId>` by scrolling to and highlighting that row (the notification's `actionUrl`).

- [ ] **Step 1: Write the failing test** — add to `tests/callReminders.test.mts`: a pure `export function callsTab(r: CallReminder, nowMs: number, todayYmd: string): "today" | "late" | "upcoming" | "done"` in `src/lib/callReminders.ts` (open + today → `today`; open + earlier day → `late`; open + later → `upcoming`; any other status → `done`), with one assertion per tab; and a source check that `layout.tsx` contains `href: "/calls"` twice.

- [ ] **Step 2: Run, verify it fails** — `npm run test:calls`.

- [ ] **Step 3: Implement** — tabs النهارده · متأخرة · الجاية · اتعملت. Open tabs from `useOpenCallReminders`; the done tab reads `handledAt >=` the start of the chosen range (single-field range) and filters in memory. Filters: person, role, date range, patient name search. A handled row shows creator + date, handler, note, and links to `previousId`/`nextId`. Delete shows for the creator and for Owner/Admin. Staff who are not Owner/Admin see only their own handled rows in the done tab.

- [ ] **Step 4: Run, verify** — `npm run test:calls`; `npx tsc --noEmit -p .` clean.

- [ ] **Step 5: Commit** — `Call reminders: Calls page and nav entry`

---

### Task 7: Whole-feature check and release

**Files:** none new.

- [ ] **Step 1: All suites** — `npm run test:calls`, `npm run test:notify`, `npm run test:bin-cascade`, `npx tsx tests/permissions.test.mts`, the two emulator tests from Tasks 2–3, `npx tsc --noEmit -p .`, `npm run lint` (no new warnings beyond the baseline). Each prints its pass line.
- [ ] **Step 2: Browser, demo clinic, phone width (375×812)** — as a Receptionist: create a reminder from the patient file, the booking pop-up and a treatment card (reason prefilled); see the file badge and history; with a reminder dated today and a time 1 minute ahead, call `/api/automation/alert-sweep` as superadmin and confirm the bell row appears; handle one each of تم / كلّمه تاني / احجز on the dashboard card; open `/calls?id=…` and see the row highlighted. Screenshot the card and the page.
- [ ] **Step 3: Push** — commit any fixes, `git push origin HEAD:main`.
- [ ] **Step 4: Tell the owner the one manual step** — the rules change must be deployed: `firebase deploy --only firestore:default` (never `firestore:rules`; the database is named "default"). Until it is deployed, clients can still write `call_reminders` directly; the route works either way.
