# Insurance: bill an approval in the month it was finished

Date: 2026-11-10 · Asked by: DENT INN (Dr Ahmed Roshdy), via the owner · Applies to: MetLife, NextCare, AXA

## The problem

DENT INN sends each insurer one sheet a month listing the work done that month. An approval issued
on 20/10 is often worked on across several visits — some services on 20/10, the rest on 5/11. The
company expects it on **November's** sheet (the month it was finished).

Today every approval has one `treatedDate`. `lineSyncPatch` (lib/insurance/appointments.ts) sets it
from the **first** finished visit, so the whole approval — sheet *and* every dentist's share — is
locked to October. There is no way to move it except un-treating and re-treating it.

## What the owner agreed (2026-11-10)

1. An approval goes on the sheet of the month it was **finished**: the month its last service was
   done. Until every service is Completed or deleted, it is on **no** sheet.
2. The **approval date never changes** and is printed on the sheet exactly as now.
3. The dentist's % is earned **per service, on the day that service was done**. A service done on
   20/10 counts in October even though the approval finishes in November. Recording an actual
   payout on the Team page is unchanged.
4. Each service shows a **"Done on" date**, filled from the visit and **editable**. Shown and editable
   in the booking pop-up's Insurance tab and on the Insurance page; both write the same field.
5. A service the patient will never come back for gets a **Delete** button. Deleted: it leaves the
   patient's file (its treatment row and charge) and the sheet, and the approval can finish. Not
   deleted: it stays and keeps the approval open.
6. Insurance page date range gets a switch: **By approval date / By finish date**. The Excel sheet
   is the same file for each insurer; only which approvals appear on it changes.
7. The system already knows when an approval was sent (`status: "sent"`, `sentAt`, the Mark sent
   button and the post-export "mark these sent").

### Clinic owner's answers (2026-11-11, Arabic questionnaire)

1-أ 2-أ 3-أ 4-أ 5-أ 6-أ 7-أ 8-أ — as above (finish month, approval date unchanged, NextCare's date
column unchanged, all insurers, % per service on its day, editable per-service date, delete button,
delete also removes the treatment + charge from the patient's file). Three answers differ from the
first draft and are now the design:

- **9-ب — a paid service can still be deleted.** The payment is never erased (the cash is in the
  drawer): it is detached from the deleted charge and stays on the patient's account as credit,
  earning no dentist commission. The confirm dialog says how much stays as credit.
- **10-ب — the Insurance page opens "By approval date"** (the switch is remembered per browser
  after the first change).
- **11-ب — a sent approval cannot be moved to another month.** The server refuses any change that
  would change a `sent` approval's finish month (or reopen it). To fix one, the desk first presses
  a new **Mark not sent** button (sent → treated; rows untouched), edits, then marks it sent again.

## Design

### Data (on the claim document — no new collection)

| Field | Meaning |
|---|---|
| `lineDates: Record<number, "yyyy-mm-dd">` | The day each service was done. Set when the line becomes Completed; editable. |
| `removedLines: Record<number, { at: string; by: string }>` | Services deleted from the approval. The line stays on the claim (the paper is a record) but counts nowhere. |
| `finishedDate: "yyyy-mm-dd" \| null` | Latest `lineDates` value once every non-removed line is Completed; otherwise null. **Computed by the server on every write that touches lines** — never sent by the client. |
| `workMonths: string[]` | `"2026-10"`, `"2026-11"`… — the months of the Completed lines' dates. Lets the Team page find every approval with work in a month with one `array-contains-any` query. Server-computed. |

`treatedDate` keeps its current meaning (the day the treatment rows were written / the approval was
marked treated) so nothing that reads it today changes behaviour.

### The day a service is done

- Completed **from a visit** (`lineSyncPatch`): `lineDates[i]` = the visit's date, unless someone has
  already typed a date for that line.
- Completed **by hand** (status dropdown): `lineDates[i]` = today on the clinic clock.
- **Edited** by hand: any real date, not after today, not before the approval date.
- Set back to Planned/Ongoing: `lineDates[i]` is cleared.
- `lineSyncPatch` **stops** rewriting `treatedDate` from the first visit (the root cause).

### The treatment row follows the service's date

When a line's done date is set or edited, that line's clinical note and ledger charge are re-dated to
it (never its payments) in the same transaction — the same mechanism that re-dates all rows when
`treatedDate` moves today, applied per line. The Daily sheet and Finance then show the work on the
day it was done.

### Delete a service

New PATCH key `removeLine: number` on `/api/insurance/claims`:
- Deletes that line's note and charge in one transaction. Payments recorded against the charge are
  **kept**: their `procedureId` is cleared (they become on-account credit for the patient) and
  their dentist commission is zeroed; each detached payment is audited. (Owner's answer 9-ب.)
- Writes `removedLines[i]`, clears `lineDates[i]`, drops the line's dentist share from payroll,
  recomputes `finishedDate` / `workMonths`.
- Confirm dialog in the UI. A **Restore** button on a deleted line re-writes its row (it reuses
  `writeTreatmentRows`), so a mis-tap is not permanent.
- Deleted lines are greyed and struck through in both views; they never print on a sheet.

### Where it shows

- **Booking pop-up → Insurance tab** (`PatientInsuranceTab`): the empty right-hand column becomes
  "Done on" — the date (tap to edit) on Completed lines, the existing "Use for this visit" on open
  lines, and a delete icon on lines that are not Completed. The approval header reads
  "Finished 5 Nov 2026" when finished, "Not finished" otherwise.
- **Insurance page** (`ClaimsTable`): a "Finished" date column beside approval date / treated date;
  a "Services ▾" toggle on each row opens the same per-line "Done on" + delete as the pop-up. The
  patient page's Insurance tab gets the same controls.
- **Insurance page range**: `By approval date | By finish date` switch next to the date picker,
  default **By approval date**, remembered per browser.
- **Mark not sent**: a row action on `sent` approvals (Insurance page and the patient's Insurance
  tab) that sets status back to `treated`, so a sent approval can be corrected. The list query and `ClaimsExportBar` both follow it. The three statement
  builders (`insuranceStatementMetlife`, `…Nextcare`, AXA) take the already-filtered claims instead
  of each choosing their own date — today MetLife filters by approval date and NextCare by
  treated date, which is part of the confusion.

### Team page (dentist %)

`insuranceWorkByStaff` counts each Completed, non-removed line on **its own** date
(`lineDates[i]`, falling back to `treatedDate`, then `approvalDate`), on `treated`/`sent` claims as
today — so 20/10's work is October's pay even while the approval is still open. (An `approved`
claim's lines default to Completed, so counting it would pay for work never done.) The Team page loads claims with `workMonths array-contains-any` the
period's months (plus the current by-date listeners for old claims). Payout recording,
settlements and the staff settlement sync are untouched.

### Old approvals (live data safety)

Nothing already on a sent sheet or in a period's pay moves.

- Reading code falls back everywhere: a line with no `lineDates` entry uses `treatedDate`, then
  `approvalDate` — exactly today's date for it, so October's pay for old work is unchanged.
- One backfill script (`scripts/backfill-insurance-finish.mjs`, **dry-run by default**, prints every
  change, run only with the owner's OK) fills `lineDates` from those same fallbacks, `workMonths`,
  and `finishedDate` = `treatedDate` for old approvals whose lines are all Completed. **Sent**
  approvals keep `finishedDate = treatedDate` regardless, so they stay in the month they were sent.
- No existing field is renamed or removed.

### Permissions

All writes go through the existing claims route (money-writes-go-through-the-api rule); the same
roles that can change a line's status today can set its date and delete it. The new fields need no
Firestore rule change for reading (the claim doc is already readable); the client never writes them.

## Testing

- Unit: `finishedDate` / `workMonths` computation (all done, one open, one removed, edited dates);
  `lineSyncPatch` sets the line date and no longer moves `treatedDate`; payroll per line date across
  two months; statement filter by each date mode for all three insurers.
- Route (Firestore emulator, as `test:approval-teeth-route`): set/edit a line date re-dates only that
  line's note+charge; `removeLine` deletes the row and keeps its payment as on-account credit;
  restore; a change that moves a sent approval's finish month → 409, and goes through after
  Mark not sent.
- Backfill script: dry-run on an emulator copy changes nothing; real run leaves every old claim's
  payroll month and sheet month as before.
- Manual on the demo clinic: the 20/10 → 5/11 example end to end — October pay shows the first
  service, November shows the rest, the approval appears only on November's sheet by finish date
  and only on October's by approval date.

## Out of scope

- Splitting one approval across two monthly sheets (owner chose "whole approval in the finish month").
- Any change to the sheet layouts, the payout flow, or approvals with no paper (GASCO tab).
