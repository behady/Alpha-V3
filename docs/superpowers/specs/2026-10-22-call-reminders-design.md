# Call reminders — design

**Date:** 2026-10-22 · **Status:** approved in conversation, awaiting written-spec review

## Why

The clinic has no way to say "call this patient on Thursday about the crown price". Leads have a
follow-up date (`leads.followUpDate`), but once someone is a patient that date is cleared, and the
other call lists (recall, payment recovery, reactivation) are computed from visit dates and
balances — nobody chooses the day. Promised calls live in people's heads and get lost.

**Success:** any staff member can set a call for a chosen day (and optionally a time), the chosen
person or role is told on that day by app notification and WhatsApp, the desk works the calls from
the dashboard, and the owner learns the same evening about any call that was not made.

## Decisions taken with the owner (2026-10-22)

| Question | Decision |
|---|---|
| Where can a reminder be created? | Patient file, booking pop-up, **and** a treatment card |
| When does it go out? | Optional time; blank = the clinic's morning time |
| What can staff record after the call? | Done + note · Call again on a date · Book now |
| Where are calls worked? | Dashboard card + a full Calls page |
| Assigned person is off? | Anyone at the desk can handle it; owner/admin alerted at end of day for misses |
| Reason field | Free text only |
| Who is told | Staff only (never the patient) |

## Out of scope

- Messaging the patient. This is a task for staff, not an automated patient message.
- Repeating reminders ("every 6 months") — the recall feature already covers routine check-ups.
- A pick-list of reasons, and editing one in Settings.
- Marking a reminder done by replying on WhatsApp.
- The Android app (frozen; phones use the web mobile view).

## 1. Creating a reminder

One component, `CallReminderDialog`, opened from three places:

| Entry point | Where | Prefill |
|---|---|---|
| Patient file | a "تذكير بمكالمة" button in the file header | patient |
| Booking pop-up | the same button in the pop-up's patient strip | patient |
| Treatment card | an item on the card's menu (`TimelineCard` / `ServiceItem`) | patient + reason `متابعة: <treatment name>` (+ tooth) |

Fields:

| Field | Required | Notes |
|---|---|---|
| اليوم | yes | quick chips بكرة · بعد ٣ أيام · بعد أسبوع · بعد شهر, or a date picker. Today allowed, past days refused. |
| الساعة | no | blank = the clinic's morning time (see §2) |
| السبب | yes | free text, max 300 characters |
| لمين | yes | one staff member **or** one role (Receptionist, Assistant, Dentist, Admin). Defaults to the creator. |

The reminder is created in the **branch on screen** (`useActiveBranch`). In a single-branch clinic
the field is simply empty.

The patient file shows a small badge "مكالمة يوم الخميس" while the patient has an open reminder.

**Who may create:** anyone who can open the patient file. **Who may delete:** the creator, or an
Owner/Admin. A reminder that has been handled cannot be edited, only viewed.

## 2. Delivery

### When

`fireAt` is computed once, at save time, in the clinic's own clock (`Africa/Cairo`, as `clinicNow`
does): the chosen day at the chosen time, or at the morning time when none was chosen. The morning
time is a timing on the new catalogue event (below), default 10:00. Changing the morning time later
does not move reminders already saved — `fireAt` is stored, not recomputed.

The existing **10-minute alert sweep** (`/api/automation/alert-sweep` → `runAlertSweep`) gets a new
step, `sendDueCallReminders(clinicId)`, so delivery is accurate to about ten minutes and ships with
a normal push (no Cloud Functions deploy).

### Who

- **A person:** that staff member.
- **A role:** every staff member with that role who works at the reminder's branch
  (`staff.branchIds`; staff with no branch list count as working everywhere, as elsewhere). Owner is
  addressed as Admin, as the notification gate already does.
- **Nobody left** (person removed, role empty at that branch): nothing is sent; the reminder shows
  "مالهاش حد" on the card and is counted in the evening alert.

### What

Through the existing gate `deliverClinicNotification` with explicit `uids`, so the clinic switch,
bell row, push and staff WhatsApp all behave like every other alert:

- **App notification** (bell + push) titled "📞 تذكير بمكالمة", tapping opens the Calls page on that
  reminder.
- **WhatsApp** to each recipient's number from Alerts & reports (`people.<uid>.phone`):

  ```
  📞 تذكير بمكالمة
  المريض: منى أحمد — 01012345678
  السبب: سعر التركيبة، قالت هتفكر
  من: سارة · يوم 20 أكتوبر
  افتح: https://alphadental.app/calls?id=…
  ```

A time chosen on purpose is honoured: quiet hours do not hold a call reminder back.

**Sent once.** The sweep claims a reminder in a transaction (`notifiedAt` set before delivery), so
two overlapping sweeps can never send it twice. A delivery failure is recorded on the reminder
(`deliveryError`) and not retried; the reminder still appears on the card.

### Two new catalogue events

Authored in `src/lib/notificationCatalog.ts` (then `npm run gen:notify-catalog`), group `frontdesk`:

| id | What | Default | Timing |
|---|---|---|---|
| `callReminderDue` | the reminder itself | bell + push + WhatsApp **on** | `hourOfDay` "morning time", fallback 10 |
| `callRemindersMissed` | evening list of unhandled calls, to Owner/Admin | bell + WhatsApp **on** | `hourOfDay` "send at", fallback 21 |

Both appear on Settings → Alerts & reports, where the owner can switch either channel off for the
clinic. Personal mutes still subtract, as for every alert.

### The evening alert

In the sweep, once per clinic per day at the `callRemindersMissed` hour (deduped through the
existing `alert_marks`): if any reminder whose `fireAt` fell on today is still open, send

```
⚠️ ٣ مكالمات ما اتعملتش النهارده:
منى أحمد (سارة) · كريم علي (الاستقبال) · …
```

plus a line "و٥ متأخرة من أيام قبل كده" when older open ones exist. No misses → no message.

## 3. Handling a call

### Dashboard card "مكالمات النهارده"

On the desk dashboard (`DesktopDashboard`) and the owner home. Lists open reminders of the branch
on screen whose `fireAt` is today or earlier, overdue first, then by time. Hidden when empty.

Each row: patient name · call button (`tel:` link) · reason · who it is for (with "ليك" when it is
the viewer's) · "متأخرة منذ يومين" when late. Everyone at the desk sees every row.

Three actions:

| Button | What happens |
|---|---|
| **تم** | asks for a short note (optional), closes the reminder: `status: "done"` |
| **كلّمه تاني** | note + chips بكرة · بعد ٣ أيام · بعد أسبوع or a date; closes this one (`status: "rescheduled"`) and creates a new reminder with the same recipients and reason, `previousId` pointing back |
| **احجز** | opens the booking pop-up for the patient; when that booking is saved the reminder closes (`status: "booked"`, note "اتحجز ميعاد يوم …", `appointmentId`) |

### Calls page `/calls` ("المكالمات")

Tabs النهارده · متأخرة · الجاية · اتعملت; filters: person, role, date range, patient search. Each row
shows creator and date, recipients, the handler, the note, and the chain of "call again" links. The
same three actions on open rows. In the top navigation next to the WhatsApp page.

Anyone who can see patients can open it. Only Owner/Admin see other people's finished history in
full and can delete reminders they did not create.

### In the patient file

A short "المكالمات" list: every reminder for the patient, open and handled, with notes — the next
caller sees what was said last time.

## 4. Data

Collection `clinics/{clinicId}/call_reminders/{id}`:

```ts
{
  patientId: string;
  patientName: string;          // snapshot for the card and WhatsApp text
  patientPhone: string;         // snapshot, same reason
  branchId: string | null;
  reason: string;               // free text, ≤ 300
  source: "patient" | "booking" | "treatment";
  sourceNoteId?: string;        // when created from a treatment card
  date: string;                 // YYYY-MM-DD, clinic clock
  time: string | null;          // "HH:mm" or null = morning time
  fireAt: Timestamp;            // computed at save
  pendingFireAt?: Timestamp;    // = fireAt until sent, then deleted (single-field range query, no composite index)
  recipient: { kind: "person"; uid: string; name: string } | { kind: "role"; role: NotifyRole };
  status: "open" | "done" | "rescheduled" | "booked";
  note?: string;                // what happened
  handledBy?: { uid: string; name: string };
  handledAt?: Timestamp;
  appointmentId?: string;       // when booked
  previousId?: string; nextId?: string;   // the "call again" chain
  notifiedAt?: Timestamp; deliveryError?: string;
  createdBy: { uid: string; name: string };
  createdAt: Timestamp;
}
```

Notes on the shape:

- `pendingFireAt` exists so the sweep can query `pendingFireAt <= now` — a single-field range that
  needs no composite index — and so a sent or handled reminder drops out of that query for good.
- Patient name and phone are snapshots taken at save, so the WhatsApp text and card need no second
  read. The sweep re-reads the patient before sending (it must check the bin anyway) and uses the
  current name and phone in the message.
- Optional fields are omitted, never written as `undefined` (Firestore rejects it in the browser).

### Writes go through the server

`/api/call-reminders` (Admin SDK, `requireStaffUser`, clinic from the request):
`create`, `done`, `reschedule`, `book`, `delete`. The route checks the caller's clinic membership,
the patient-file permission, the delete rule (creator or Owner/Admin) and the date (not in the
past), computes `fireAt`, and writes the chain for `reschedule` in one batch.

`firestore.rules`: add `call_reminders` to the `memberMayWrite` exclusion list (clients read, never
write). **This needs a rules deploy** (`firebase deploy --only firestore:default`) — a `git push`
does not do it.

### Recycle bin

Add `call_reminders` to `PATIENT_CASCADE_COLLECTIONS` (+ its label "مكالمات" / "calls") in
`src/lib/recycleBin.ts`, so reminders go to the bin with their patient and come back on restore.
The sweep skips reminders whose patient is in the bin.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| Patient deleted | reminders go to the bin with the file; nothing is sent while there |
| Booking that closed a reminder is later cancelled | reminder stays closed; staff can create a new one |
| Recipient removed from staff | "مالهاش حد" on the card; anyone can handle it; counted in the evening alert |
| Date today, no time | `fireAt` = morning time today; if that has passed, it fires on the next sweep |
| Date in the past | refused by the dialog and by the route |
| Branch clinic | card shows the branch on screen; role recipients limited to that branch; owner sees all on the Calls page |
| No WhatsApp number for a recipient | app notification only (as every staff alert) |
| No staff sending line for the clinic | app notification only |

## 6. Testing

- **Pure logic** in `src/lib/callReminders.ts`, tested by `tests/callReminders.test.mts`
  (`npm run test:calls`): `fireAt` from date/time/morning hour in Cairo time; recipients for a person
  and for a role at a branch; due selection; "sent once" claim; the evening count and text;
  reschedule produces a linked new reminder; past dates refused.
- **Catalogue:** `npm run test:notify` must pass with the two new events (every event raised, the
  generated functions copy current).
- **Route:** the create/done/reschedule/book/delete actions on the Firestore emulator, as the other
  route tests do.
- **Browser:** on the demo clinic at phone width — create from all three places, receive the bell
  notification, handle each of the three actions, see the patient-file list and the Calls page.
