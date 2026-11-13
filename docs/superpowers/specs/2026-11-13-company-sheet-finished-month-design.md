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

Not yet confirmed by the owner (my recommendation, used below): when the dentist forces an
unfinished patient into a month, only his Done treatments print; the unfinished ones keep waiting.

## The rule

Everything is worked out from dates already stored. There is no "close the month" step.

For one company and one patient, walk the calendar months from 2026-11 forward, carrying a list of
**waiting** treatments (charged to the company, not yet on any sheet):

1. Add the treatments charged in this month to the waiting list.
2. If nothing is waiting, go to the next month.
3. A waiting treatment is **finished by this month** when it is Done and its done date is on or
   before the month's last day.
4. The patient is **held** this month when the dentist's switch says "Next month"; or, with no
   switch saved, when any waiting treatment is not finished by this month.
5. Held: nothing prints; the whole waiting list carries to the next month.
6. Not held: the waiting treatments that are finished by this month print on this month's sheet as
   **one case**. Anything unfinished (only possible when the dentist forced "This month") stays
   waiting.

What this gives:

- A patient finishing in November is on November with all his work, including work charged earlier
  (from November on).
- A patient who comes back in December appears in December with only the new treatments: the
  November ones left the waiting list when they printed.
- A treatment done on 28 Nov but ticked Done on 2 Dec has a done date of 2 Dec, so the patient is
  held in November. The switch pulls him back into November.

### When a treatment is Done

- The charge row names its treatment card (`clinicalNoteId`). A card continued into later visits is
  one treatment: the newest card of the chain gives the state, as in `lib/reports/treatmentStatus`.
- Done date: the card's `completedDate`, else the card's own date.
- A charge with no card (typed straight onto the ledger), a card that no longer exists, or a card
  with no state: treated as Done on the charge's date. These print today and must keep printing.
- Deleted and cancelled charges are never waiting.

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
- **Waiting**: held patients, with the reason ("Not finished" or "Moved by the dentist"), their
  waiting value, and the same switch.
- A range touching several months shows one block per month.
- A small "Automatic" link on a switched patient clears the saved choice.
- The Excel button's count and file follow the sheet exactly.

The Finance page's company tab prints the same sheet from its Excel button; it shows no switches.

Arabic and English strings for every label. Phone layout: rows stack, the switch stays one tap.

## Stored data

One new document, `clinics/{clinicId}/settings/company_sheet`:

```
marks: { "<payerId>__<patientId>__<yyyy-mm>": "include" | "hold" }
updatedAt, updatedBy
```

- Read by the browser with a live listener (`settings/*` is already readable by clinic staff).
- Written only by a new route, `POST /api/insurance/company-sheet`
  `{ clinicId, payerId, patientId, month, choice: "include" | "hold" | null }`:
  staff with `patients.edit` (the claims route's permission), the `insurance` add-on, the payer
  exists, is active and has no document format, `month` is `yyyy-mm` and not before 2026-11.
  `null` deletes the mark. One activity-log row per change.
- No Firestore rules change, no index, no migration, no change to any ledger row or treatment card.

## Code

| Piece | What |
|---|---|
| `src/lib/insurance/companySheet.ts` (new, pure) | The walk: charges + cards + marks + months in, per-month `{ printed cases, held patients }` out. Start month constant. |
| `src/lib/insuranceStatement.ts` | Accept ready-made cases (one per patient per month) next to the per-visit grouping; line wording unchanged. |
| `src/components/insurance/useCompanySheet.ts` (new) | Loads the cards behind the company's charges (by id, 30 at a time), listens to the marks document, runs the walk. |
| `src/components/insurance/CompanySheetPanel.tsx` (new) | The panel and switches. |
| `src/components/finance/InsurerTab.tsx` | Excel statement comes from the hook; optional panel slot for the Insurance page. |
| `src/app/api/insurance/company-sheet/route.ts` (new) | Saves a switch. |

`insuranceStatementGascoXlsx.ts` (the file's layout) is not touched.

## Not in this change

- Reports → Insurance statement tab and the phone "insurance" document keep listing by charge date.
  For a contract company they can therefore differ from the Insurance page from November on.
  Aligning them is a follow-up.
- No lock on a month already sent. Changing a past month's switch, or reopening a Done treatment
  after its month was sent, changes that month's sheet when it is downloaded again. A "sent" lock,
  as on approvals, can be added later if this bites.
- Money, what the company owes, collections, dentist shares, MetLife / NextCare / AXA: unchanged.

## Tests

- `tests/companySheet.test.mts` (`npm run test:company-sheet`, added to CI): finished patient
  prints; unfinished is held and carries; returning patient prints only new work; forced "This
  month" prints Done only; forced "Next month" carries a finished patient; late tick; continuation
  chain; charge with no card; start month; multi-month range; branch filter after the walk.
- Route test on the Firestore emulator: permission, add-on, payer with a format refused, bad month
  refused, set / change / clear.
- Existing `test:insurance-statement` and `test:insurance-statement-gasco` stay green.
- Browser check on the demo clinic: switch a patient, see the sheet and the Excel count follow.

## Effect on live clinics

Nothing is written until someone presses a switch. From the deploy on, a contract company's sheet
for November 2026 and later follows the new rule in every clinic that has one; today that is DENT
INN's GASCO. Earlier months are untouched.
