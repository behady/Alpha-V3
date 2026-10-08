# Dentist chair mode — design

Date: 2026-10-08. Agreed with the owner in conversation; this is the written form.

## Goal

A dentist works the chair without touching money. From their home screen they open a patient,
see every treatment on that patient (theirs and other dentists'), add their own from the main
price list, and change the status of their own with one tap. It works in the phone's browser as
well as on the desk. Reception's screens do not change.

## Decisions (owner's answers)

| Question | Decision |
| --- | --- |
| Money when a dentist adds a treatment | Priced automatically from the clinic's **main (default) price list** and put on the bill. Reception changes list, discount or payer later. The dentist never sees an amount. |
| Insurance approvals | The dentist sees the patient's approved lines (name, teeth) and can set status on the ones linked to them. No amounts, no "who pays", no pulling lines into a visit. |
| Who gets it | Role **Dentist** always. An Owner/Admin with `isDentist` gets it when their home screen is **chair** (`uiPreferences.homeView === "chair"`). On the desk view they keep the full editor. |
| Scope of "no prices" | **Everywhere** for a dentist in chair mode: patient file Finance and Insurance tabs hidden, money chips off the clinical record, the edit window opens in dentist mode. |
| Which patients | Today's appointments, plus a search over all patients. A treatment added with no visit today is saved unlinked (`appointmentId: null`). |
| Editing own treatments | Everything clinical (name, teeth, status, notes) and delete, at any status. |
| Others' treatments | Visible, locked: no status change, no dentist change. A treatment with no dentist ("the clinic") is locked too. |
| Mobile | The website on a phone. No Android work. |
| Hard lock? | No. This is hiding in the UI; the dentist's account can still read ledger rows because "my share" on their home needs them. A rules change was offered and declined. |

## 1. Chair mode: one rule, one helper

`src/lib/chairMode.ts`

```ts
export type ChairModeInput = { role?: string | null; isDentist?: boolean; homeView?: "desk" | "chair" | "owner" };
export function isChairMode(i: ChairModeInput): boolean
```

True when `role === "Dentist"`, or when the staff row has `isDentist` and `homeView === "chair"`.
A hook `useChairMode()` in `src/lib/useChairMode.ts` reads the logged-in user's role, their staff
row's `isDentist` and `useUI().homeView`, and returns the boolean. Every screen below calls the
hook; nothing re-derives the rule. Test: `tests/chairMode.test.mts` (`npm run test:chair`).

## 2. The chair popup

`src/components/chair/ChairPopup.tsx`, opened by the dentist home with `{ patientId, appointment? }`.

Layout: on screens narrower than 768px it is a full-screen sheet (`fixed inset-0`), otherwise a
centred window `max-w-5xl`, `max-h-[92vh]`, body scrolling, header and the add button pinned.
Portalled to `<body>`, so it sets `dir` and the Arabic face itself (as the editor does).
Black header (`bg-ink-slab`), yellow title, patient name white.

Sections, top to bottom:

1. **Patient strip** — name, file number (`fileId`), age, phone (tap = WhatsApp), allergies in red
   when recorded. No balance.
2. **Teeth chart** — the shared `TeethChartSelector` with `patientId` (so "mark extracted teeth"
   works), fed by the patient's `teethData` and `treatmentsByTooth` over all their notes. Picking
   teeth here pre-fills the add form.
3. **This patient's treatments** — grouped: today's visit first (when opened from an
   appointment), then earlier, newest first (`groupNotesByVisit` from
   `clinical-notes/ordering.ts`). One card per note: name big and centred, teeth, status pill,
   dentist's name, date. Cards where `note.doctorId === me.staffId` get the three status buttons
   (مخطط / جاري / اتعمل), **عدّل** and **احذف**. All other cards get a lock icon and the text
   "د. فلان" and nothing to press. Approval-linked notes (`claimId`) are shown the same way;
   their edit opens the editor in approval mode (status, notes only).
4. **Insurance approvals** — only when the patient has live claims. One row per approved line:
   treatment name, teeth, and for lines whose `dentists[i] === me.staffId` the same status
   buttons; otherwise locked. Rendered from `insurance_claims` for the patient, with
   `claimProgress` for the pill. No figures.
5. **+ أضف علاج** — pinned at the bottom, yellow. Opens `ServiceEditorDrawer` inline below the
   list with `dentistMode`, `appointmentId` = today's visit or `null`, `selectedTeethOverride`
   from the chart.

Data: `patients/{id}` (getDoc), `clinical_notes where patientId` (onSnapshot, so a status tap
shows at once), `insurance_claims where patientId`, `services` and `staff` from the home (passed
in). Writes go through the existing `moneyApi` routes (`updateProcedure` for status,
`deleteProcedure`, `updateApprovalProcedure` for approval rows, `patchClaim` for approval line
status) — no new API. Status taps on own notes call `updateProcedure` with only `status`
changed; the route already accepts partial updates for approval rows and full for others, so the
popup sends the note's existing fields back unchanged plus the new status.

Helper `src/lib/chairPopup.ts`: `canTouch(note, me)`, `groupForChair(notes, appointments, todayAppointmentId)`,
`approvalLinesForMe(claims, me)`. Tested in `tests/chairPopup.test.mts`.

## 3. The editor in dentist mode

`ServiceEditorDrawer` gains `dentistMode?: boolean` and `meStaffId?: string`.

When on:
- Hidden: cost field, discount editor (price list / discount / payer), billing strip, "add to
  bill" tick, dentist dropdown, "extra procedures" link (one treatment per save keeps the list
  readable), the pricing-mode select.
- Forced: `addToLedger = true`; `discount.priceListId` = the clinic's default list
  (`listsForBranch` default / `patientDefaultPriceListId` fallback as today's default logic);
  `selectedDoctorId = meStaffId`; pricing mode = the service's own mode. The cost is still
  computed from the list × units exactly as today and sent in the payload — only the display is
  gone.
- Free-text treatment names are still allowed (the chart can't repaint from them, as before);
  with no list price they save at 0 and reception prices them. `needsTypedPrice` is off in
  dentist mode; a small line under the name says "مش في القائمة — الاستقبال هيحط السعر".
- Approval rows: unchanged (status, notes only).
- Editing an existing own treatment in dentist mode hides the same controls: the price list and
  the dentist stay what they are.
- Phones (narrower than 768px): the chart is no longer pinned above a tiny scrolling form — the
  whole window scrolls as one piece, the Save button stays pinned at the bottom. This fix applies
  to everyone, not only dentists (owner's screenshot 2026-10-08).

Reception's path (`dentistMode` absent) is byte-for-byte the current behaviour.

## 4. The dentist home

`DentistHome.tsx`:
- **The chair slab** (the black "next patient" card): under the patient's name, this visit's
  treatments — every dentist's, each with name, teeth and status; mine with the one-tap status
  switch (مخطط / جاري / اتعمل). Beside them a **+ أضف علاج** button that opens the editor in
  dentist mode for this visit (teeth from the chart inside it). "ابدأ ملاحظة النهارده" is
  replaced by that button; "افتح الكرسي" opens the chair popup for the full picture.
- **My day cards**: under each appointment, chips for this dentist's notes on that visit
  (`notes` is already `where doctorId == me`): name + status, tap cycles مخطط → جاري → اتعمل
  (one `updateProcedure` call, optimistic). A **افتح الكرسي** button opens the chair popup for
  that appointment. The existing "open today's note" button becomes that popup.
- **Search**: an input above the day list, over the already-loaded `patients` (name / phone),
  showing up to 8 matches; tap opens the chair popup with no appointment.
- Phone: nothing new to build for the grid (it already stacks); buttons `h-12`.

## 5. The patient file for a dentist in chair mode

`patients/[id]/page.tsx` with `useChairMode()` true:
- Tabs `finance` and `insurance` hidden.
- Balance field on the patient card hidden.
- `TimelineCard` / `ServiceItem` get `hideMoney` → the EGP chip is not rendered.
- The clinical record's `ServiceEditorDrawer` opens with `dentistMode` and `meStaffId`.
- Edit/delete on notes of other dentists hidden (`canTouch`).

`appointments/page.tsx` and the booking popup are reception tools; in chair mode the dentist
home does not link to them, and they are left unchanged.

## 6. Security

No Firestore rule changes. `clinical_notes` writes already go through `/api/clinical/procedures`,
which checks `clinical.edit`; the Dentist role has it. Nothing in this design lets a dentist do
anything their role could not already do through the existing screens; it removes what they see.

## 7. Testing

- `tests/chairMode.test.mts`: the rule for every role × isDentist × homeView.
- `tests/chairPopup.test.mts`: `canTouch` (own / other / no dentist / approval), grouping order,
  approval lines for me.
- `tests/payers.test.mts` extended: the dentist-mode payload still carries `priceListId`,
  `addToLedger: true`, and the computed cost.
- `npx tsc --noEmit`, `test:teeth`, `test:arch`, `test:dentist`.
- Manual (owner): Dentist login on phone and desk — add a treatment, flip status from the day
  card, open another dentist's patient and confirm nothing is pressable, open the patient file
  and confirm no Finance/Insurance tabs and no amounts.

## Out of scope

Android app; a hard lock on money data; pulling approved lines into a visit from the chair
popup; the owner/admin desk view.
