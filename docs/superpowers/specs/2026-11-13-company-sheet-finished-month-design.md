# Company sheet: a patient goes on the month he finished

Date: 2026-11-13
Asked by: the owner, for DENT INN's GASCO monthly closing sheet (تقفيلة الشهر).

## The problem

A contract company (GASCO: billed straight from treatments, no approval paper) gets one sheet a
month. Today the sheet lists every treatment charged to the company inside the dates, finished or
not. So a patient half-way through his work is billed now, and the rest of his work lands on a
later sheet as a second case.

## What the owner decided

| Question | Answer |
|---|---|
| What holds a patient back? | Any waiting treatment still Planned or In progress. |
| Who decides? | The system suggests; the dentist can switch any patient either way. |
| A moved patient next month? | Appears by himself, old and new work together as one case. |
| Which companies? | Every contract company (a payer with no document format). |
| From when? | November 2026. October and earlier print exactly as today. |
| Picking the period? | Keep the from/to dates; the sheet covers the months they touch. |
| Force an unfinished patient onto a sheet? | No. An unfinished patient can never be put on a sheet. |
| Reports tab and the phone report? | They follow the same sheet as the Insurance page. |
| Lock a sent month? | Yes, now: "Mark as sent" freezes the month, "Mark not sent" reopens it. |

My reading of "no forcing", not yet confirmed: the switch can still pull in a patient whose
treatments are all Done today but were ticked after the month ended (done 28 Nov, ticked 2 Dec).
That is a finished patient, not a forced one.

## The rule

Everything is worked out from dates already stored. There is no "close the month" step; the sent
lock below is optional protection, not part of the calculation.

For one company and one patient, walk the calendar months from 2026-11 forward, carrying a list of
**waiting** treatments (charged to the company, not yet on any sheet):

1. Add the treatments charged in this month to the waiting list.
2. If nothing is waiting, go to the next month.
3. A waiting treatment is **finished by this month** when it is Done and its done date is on or
   before the month's last day.
4. The patient is **held** this month when:
   - any waiting treatment is not Done today (Planned or In progress): always, no switch overrides it;
   - else the switch says "Next month";
   - else, with no switch saved, any waiting treatment's done date is after the month's last day.
5. Held: nothing prints; the whole waiting list carries to the next month.
6. Not held: every waiting treatment prints on this month's sheet as **one case**, and the waiting
   list is emptied. (A "This month" switch is what lets a treatment ticked late print here.)

A month marked **sent** skips steps 3 to 6: see "The sent lock".

What this gives:

- A patient finishing in November is on November with all his work, including work charged earlier
  (from November on).
- A patient who comes back in December appears in December with only the new treatments: the
  November ones left the waiting list when they printed.
- A treatment done on 28 Nov but ticked Done on 2 Dec has a done date of 2 Dec, so the patient is
  held in November. The switch pulls him back into November.
- A patient with anything Planned or In progress has no usable switch: he waits.

### When a treatment is Done

- The charge row names its treatment card (`clinicalNoteId`). A card continued into later visits is
  one treatment: the newest card of the chain gives the state, as in `lib/reports/treatmentStatus`.
- Done date: the card's `completedDate`, else the card's own date.
- A charge with no card (typed straight onto the ledger), a card that no longer exists, or a card
  with no state: treated as Done on the charge's date. These print today and must keep printing.
- Deleted and cancelled charges are never waiting.

### The sent lock

After the sheet goes to the company the desk presses **Mark as sent** on that month.

- The server works the month's sheet out again from the database (never from the browser's list)
  and stores the ids of the charges on it, with who and when.
- From then on that month's sheet is exactly those charges. Reopening a treatment, changing a
  switch, or adding work later cannot change it, and those charges never wait again.
- Anything not on the stored list keeps following the normal rule into later months. A treatment
  back-dated into a sent month waits for the next unsent month.
- Switches on a sent month are disabled; the route answers 409 `sent_locked`.
- A stored charge that is later deleted or cancelled drops off the sheet. Amounts are read live.
- **Mark not sent** removes the lock; the month is computed again.
- A month can be marked sent only when its sheet is not empty, and only after every earlier month
  with a non-empty sheet is sent, so a sent month never depends on an open one. For the same
  reason "Mark not sent" is refused while a later month is sent.
- The lock is the company's month across all branches: one sheet goes to the company.

### The period on screen

- The sheet for `[from, to]` is the sheets of every calendar month the range touches
  (`monthsBetween`), from 2026-11 on. 1–15 Nov prints November's sheet.
- For months before 2026-11 inside the range, today's rule is kept unchanged: charges dated inside
  `[from, to]`, one case per visit.
- Charges dated before 2026-11-01 never enter the waiting list, so old open work holds nobody back.

### Branches

The walk runs over all of the company's charges, whatever the branch, so a patient is held or not
held the same way on every screen. The branch on screen then filters which printed lines show.

## What the desk sees

On the Insurance page, with a contract company picked, a new panel above the account table:

- **This month's sheet**: one row per patient: name, treatments, value, and a switch
  "This month / Next month". Patients moved by hand are marked so.
- **Waiting**: held patients with their waiting value and the reason:
  "Not finished" (no switch), "Finished after the month" (switch offered), or "Moved by the
  dentist" (switch offered).
- A range touching several months shows one block per month.
- A small "Automatic" link on a switched patient clears the saved choice.
- Each month block has **Mark as sent** (with a confirm), and once sent shows "Sent on … by …"
  with **Mark not sent**.
- The Excel button's count and file follow the sheet exactly.

The same sheet, read-only (no switches, no sent buttons), prints from:

- the Finance page's company tab (Excel button);
- Reports → Insurance statement, when the insurer picked is a contract company;
- the phone "insurance" report document, for contract companies.

Approval insurers on those screens are unchanged.

Arabic and English strings for every label. Phone layout: rows stack, the switch stays one tap.

## Stored data

Two kinds of document under `clinics/{clinicId}/settings`, per company:

```
company_sheet_<payerId>
  marks: { "<patientId>__<yyyy-mm>": "include" | "hold" }
  updatedAt, updatedBy

company_sheet_<payerId>_<yyyy-mm>          (exists only while the month is sent)
  payerId, month, chargeIds: string[], cases, total, sentAt, sentBy, sentByName
```

- Read by the browser with live listeners (`settings/*` is already readable by clinic staff); the
  sent documents by a document-id range query. The reports route reads them with the Admin SDK.
- Written only by a new route, `POST /api/insurance/company-sheet`, with three actions:
  - `mark` `{ payerId, patientId, month, choice: "include" | "hold" | null }`; `null` clears it;
    refused 409 `sent_locked` on a sent month, and 409 `not_finished` for "include" on a patient
    with anything Planned or In progress.
  - `send` `{ payerId, month }`: recomputes the sheet server-side and writes the sent document;
    refused when the sheet is empty or an earlier non-empty month is not sent.
  - `unsend` `{ payerId, month }`: deletes the sent document; refused while a later month is sent.
- Every action: staff with `patients.edit` (the claims route's permission), the `insurance` add-on,
  the payer exists, is active and has no document format, `month` is `yyyy-mm` and not before
  2026-11. One activity-log row per change.
- No Firestore rules change, no index, no migration, no change to any ledger row or treatment card.

## Code

| Piece | What |
|---|---|
| `src/lib/insurance/companySheet.ts` (new, pure) | The walk: charges + cards + marks + sent lists + months in, per-month `{ printed cases, held patients, sent }` out. Start month constant. |
| `src/lib/insuranceStatement.ts` | Accept ready-made cases (one per patient per month) next to the per-visit grouping; line wording unchanged. |
| `src/components/insurance/useCompanySheet.ts` (new) | Loads the company's charges since 2026-11 and the cards behind them (by id, 30 at a time), listens to the marks and sent documents, runs the walk. |
| `src/components/insurance/CompanySheetPanel.tsx` (new) | The panel, switches and sent buttons. |
| `src/components/finance/InsurerTab.tsx` | Excel statement comes from the hook; optional panel slot for the Insurance page. |
| `src/components/reports/InsuranceStatementReport.tsx` | A contract company's statement comes from the hook. |
| `src/lib/server/companySheetData.ts` (new) | The same inputs read with the Admin SDK, for the route's `send` and for the phone report. |
| `src/lib/reports/loadReportData.server.ts`, `src/lib/reports/documents.ts` | The phone "insurance" document uses the walk for contract companies. |
| `src/app/api/insurance/company-sheet/route.ts` (new) | `mark`, `send`, `unsend`. |

`insuranceStatementGascoXlsx.ts` (the file's layout) is not touched.

## Not in this change

- A month that was sent to the company but never marked sent is still computed live, so it can
  change. The lock only protects months someone marked.
- The sent lock freezes which treatments are on the sheet, not their prices.
- Money, what the company owes, collections, dentist shares, MetLife / NextCare / AXA: unchanged.

## Tests

- `tests/companySheet.test.mts` (`npm run test:company-sheet`, added to CI): finished patient
  prints; unfinished is held and carries, and "include" cannot override it; returning patient
  prints only new work; "Next month" carries a finished patient; late tick held, then pulled in by
  "include"; continuation chain; charge with no card; start month; multi-month range; branch filter
  after the walk; sent month frozen against a reopened treatment, a changed switch and a back-dated
  charge; deleted charge drops off a sent sheet.
- Route test on the Firestore emulator: permission, add-on, payer with a format refused, bad month
  refused; mark set / change / clear, `not_finished`, `sent_locked`; send stores the server's own
  list, refuses an empty sheet and an unsent earlier month; unsend refused under a later sent month.
- Phone document test: a contract company's table equals the walk's sheet.
- Existing `test:insurance-statement` and `test:insurance-statement-gasco` stay green.
- Browser check on the demo clinic: switch a patient, mark a month sent, see the sheet and the
  Excel count follow.

## Effect on live clinics

Nothing is written until someone presses a switch or "Mark as sent". From the deploy on, a contract
company's sheet for November 2026 and later follows the new rule in every clinic that has one;
today that is DENT INN's GASCO. Earlier months are untouched.
