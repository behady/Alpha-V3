# Company sheet (GASCO): one line per procedure, under each patient

Owner's asks, in order (2026-11-17 → 2026-11-21). The first design (a side drawer, finish date
decides the month) was built, tested by the owner on localhost and replaced: "interface is
complicated". What is described here is what is on the branch.

## Decisions (owner)

- The "This month / Next month" switch is gone. (Live check 2026-11-18: no clinic ever used it.)
- A patient opens IN PLACE on the Insurance page. One line per procedure: name, dentist, start
  date, end date, status, price, sheet month. History behind a small button.
- **Each procedure alone**: it goes on the sheet of the month it ENDED. A patient no longer waits
  for all his work. (Reverses what the DENT INN doctor first asked; the owner was told.)
- The month fills itself in ("Auto: November 2026"); a picker of twelve months moves it. An
  unfinished procedure is on no sheet, but may be placed after a warning.
- Start date, end date and status are all changeable on the line. The start date is the real one:
  the charge and the treatment's first card move together ("Everywhere").
- The money list (billed / collected) is not on the Insurance page; it stays on Finance.
- A sent month is locked EVERYWHERE — the sheet, the patient's file, the chair pop-up, the visit's
  money tab and Finance. Only an Owner or Admin may still change such a procedure, after a warning
  that the sheet the company received will no longer match. Its month stays locked for everyone
  (mark the month not sent).
- New permissions `insurance.edit` and `insurance.send`, ON for everyone by default.
- A "Copy permissions from another user" button on the user's access screen.

## Rules (`lib/insurance/companySheet.ts`, pure)

`placeCharges` gives every live charge of the company from 2026-11 on a `Placement`:
picked month (`settings/company_sheet_<payerId>.months[chargeId]`) else the month it ended, else
none. A charge on a sent list belongs to that month whatever happened since; a sent month takes
nothing new, so a procedure that would land on it rolls on to the next month that is not sent.
`buildCompanySheets` groups placements into month sheets (one entry per patient per month) and is
what the Excel, the Reports tab and the phone report print. `lib/insurance/sheetPatients.ts` turns
the same placements into the patient list, each line's state and its history.

## Route (`POST /api/insurance/company-sheet`)

`send`, `unsend`, `pickMonth {chargeId, month|null}`, `startDate {chargeId, date}`,
`finishDate {noteId, date}`, `reopen {noteId}`, `finish {noteId}`.
Needs patients.edit (the page's permission) AND insurance.send (send/unsend) or insurance.edit
(the rest), and the procedure's branch. Sent: staff 409 `sent_locked`; Owner/Admin 409
`sent_confirm` until `confirmSent: true`. Every change is in the activity log; a start date change
is in the ledger audit; dates/status/month changes are also kept on the card (`finishLog`).

## The lock outside the Insurance page (`lib/server/companySheetLock.ts`)

`/api/clinical/procedures` (update, delete, move) and `/api/finance/ledger` (update, delete of a
treatment charge) ask `sentSheetGate`: staff 409 `sheet_sent`; Owner/Admin 409
`sheet_sent_confirm` until `confirmSentSheet: true`. `lib/moneyApi.post` asks the question once for
every screen through `lib/confirmBridge` and repeats the call with the yes.

## Default-on permissions (`config/permissionsCatalog.ts`)

A permission added after clinics went live cannot be "off until ticked": every stored list predates
it. `defaultOn` permissions are held with nothing stored; switching one off stores `no:<id>`.
`listHoldsPermission` is the one test (Protect, requireStaffPermission, holdsPermission). No user
document is written by the update.

## Approval insurers (MetLife / NextCare / AXA) — built 2026-11-21

Owner's answers: the whole approval moves together; the "By approval date / By finish date" switch
stays; patient → approvals → services; the action buttons stay on each approval.

- **List:** patients (grouped by `patientId`), each opens in place to his approval cards; a card
  shows number, status, dates, approved total, its services (dentist, status, amount, done date)
  and the same actions as before (`ClaimsTable.tsx`).
- **Sheet month:** a claim field `sheetMonth` (`yyyy-mm` or absent = automatic, the month it was
  finished). Shown and honoured only **by finish date**; by approval date nothing changes.
  `claimSheetMonth` / `inSheetRange` in `billingMonth.ts` are the one rule the list, the counts
  beside each insurer and all three statements read.
- **Server:** `PATCH /api/insurance/claims` key `sheetMonth` travels alone; refused when the
  approval is not treated (`not_treated`), sent (`sent_locked`) or the month is not one
  (`bad_month`). Needs `insurance.edit`; marking sent / not sent needs `insurance.send` (both
  default on). An unfinished approval may be placed after a warning.
- **Listening:** by finish date `useClaims` and the page's counts ask two index-free questions
  (finished in range, picked into range) and drop an approval picked onto another month.
- **Pop-up:** `ClaimsSheetPreview.tsx` — will be sent / already sent / not on this sheet and why,
  read from the statement the Excel is written from.

## Not built

The GASCO tutorial film still shows the old switch. A production build was not run locally.
