# Activity log v2 — design

Date: 2026-10-13. Asked for by the owner ("the logs page needs to do better since we added more
things"). Decisions were taken with him in conversation; his choices are marked **decided**.

## Goal

The activity log answers four questions, quickly, in Arabic:

1. **Who touched the money?** Payments, edited and deleted charges and payments, price changes.
2. **Discounts:** who gave a discount, to which patient, how much, and why.
3. **Insurance:** who created an approval, changed its status, or collected from the insurer.
4. **A patient's story and a staff member's day:** everything that happened to one patient, and
   everything one person did on a given day.

## Decisions

- **Decided:** approach A. Fix what every action *writes*, then rebuild the page. Rebuilding only
  the page (B) or rebuilding the story from the records (C) cannot say who changed what.
- **Decided:** the patient story shows in **both** places: a patient filter on the logs page, and
  a new tab in the patient file.
- **Decided:** the patient-file tab is **owner and admins only**, the same audience as the
  logs page.
- **Decided:** the Money, Discounts and Insurance tabs get a **summary strip per person** for the
  chosen dates.
- **Decided:** the LOW/MEDIUM/HIGH labels are replaced by one **"worth a look" (🔸)** flag.
- **Decided:** old entries are **not** rewritten. They still show, with raw ids hidden. Only new
  actions carry the full detail, so a patient's tab starts on the day this ships.
- **Decided, left out:** log-in/log-out (the attendance page covers shifts), the WhatsApp bot's own
  activity, Excel export of the log, and WhatsApp alerts. Any of these can come later.

## Facts about the code today (origin/main 4d5d79a4)

- **One collection.** `clinics/{id}/system_logs` holds everything, about 1,500 entries for the
  live clinic. Three writers feed it:
  - `logActivity` (`src/lib/logger.ts`, client)
  - `logActivityServer` (`src/lib/server/systemLog.ts`)
  - `logAiAction` (`src/lib/serverLogger.ts`)

  `recordMoneyChange` (`src/lib/server/ledgerAudit.ts`) writes a `system_logs` line plus a
  `ledger_audit` before/after snapshot, and stamps every line `module: "finance"`, even
  "Appointment Deleted".
- **Rules.** Any clinic member may read and create entries; only a superadmin may edit or delete
  them. The settings panel (`settingsRegistry` id `logs`) is ADMIN view.
- **What is wrong with what gets written (live data, 2026-10-13):**
  - Every live entry is `MEDIUM`, so severity tells nothing apart.
  - "Appointment Updated" never says what changed, and autosave writes one per save.
  - Details carry raw ids ("… toward n7EuTEtedn3m3QDHjpi8").
  - Nothing records the branch.
  - A payment taken in `QuickPaymentModal` is logged twice: once from the client, once from the
    server.
- **Silent today:**
  - discounts as such: the visit discount is split into one vague "Finance Entry Updated" per
    charge
  - insurance status changes that move no money, and approvals saved as "approved"
  - appointment status buttons and drag-to-move
  - lab cases and lab payments (`src/lib/labCaseWrite.ts`)
  - deduction edits
  - branches (`LocationsSettings`), the service catalogue (`PricingSettings`), insurers
    (`PayersSettings`), labs (`DentalLabsSettings`)
  - treatment-plan status changes
- **The phone app** reads `system_logs` (`ClinicSettings.kt` `loadLogs`: `action`, `details`,
  `userName`, `timestamp`, last 100). So `action` and `details` must stay readable sentences.
- **The patient file** already has a "سجل الزيارات" (Timeline) tab. The new tab must not be
  confused with it.

## Design

### 1. One entry shape (v2)

Every new entry keeps today's fields, so the phone app, the MCP connector and old readers keep
working. `action` and `details` become a *good* English sentence produced from the template below.
It also gains structured fields:

```ts
type ActivityEventV2 = {
  v: 2;
  event: EventKey;              // stable key, e.g. "payment.received"; see the catalogue
  categories: Category[];       // one or more: an added treatment with a discount is money + discount
  flag: boolean;                // "worth a look"
  patientId?: string | null;
  patientName?: string | null;
  amount?: number | null;       // EGP, the money this entry is about
  changes?: Array<{ field: string; from: Scalar; to: Scalar }>;  // before → after, stable field keys
  reason?: string | null;       // discount reason, cancel reason…
  branchId?: string | null;     // the branch on screen (client) / the stamped branch (server)
  groupId?: string | null;      // ties entries written by one user action (visit discount split)
  refs?: {                      // for links and wording; never shown as raw ids
    appointmentId?: string; ledgerId?: string; noteId?: string; claimId?: string;
    labCaseId?: string; staffId?: string; staffName?: string; payerName?: string;
    receiptNumber?: string; method?: string; procedure?: string; date?: string; time?: string;
  };
};
type Category = "money" | "discount" | "insurance" | "appointment" | "patient"
              | "clinical" | "lab" | "team" | "settings" | "system";
```

`severity` is still written, for old readers: `flag ? "HIGH" : "MEDIUM"`. `module` is still
written, mapped from the first category.

### 2. The event catalogue: one file, used by both sides

`src/lib/activity/catalogue.ts` is pure, with no Firebase imports, and is imported by client,
server and tests. For every `EventKey` it holds:

- its categories
- its flag rule: a function of the event, e.g. `payment.edited` is always flagged;
  `procedure.added` is flagged only when the price is below the list price
- `en(e)` and `ar(e)` sentence templates
- labels for every `changes[].field` key in both languages (`time` → "الساعة", `doctor` → "الدكتور")

The page renders from the catalogue, so the stored English `action`/`details` are only a fallback.
Old entries (no `v`) render through today's `ACTION_AR` table and `readableDetails()` id-stripper,
moved into this module unchanged.

Writers:

- `logEvent(user, event)` in `src/lib/logger.ts`, client. Fills `branchId` from
  `currentBranchId()`.
- `logEventServer({ clinicId, user, branchId, event })` in `src/lib/server/systemLog.ts`.
- `recordMoneyChange` gains an optional `event`; when given, the line it writes is that event.
- `diffChanges(prev, next, fields)` is a pure helper. It returns only the fields that actually
  changed, normalised to scalars, so an edit that changes nothing writes nothing.

### 3. What gets logged

Event keys, grouped. **(new)** means silent today.

**Money** (server, via `recordMoneyChange`)
- `procedure.added`: treatment, tooth, list price, final price, discount and reason, insurer,
  doctor. Categories money (+ discount when a discount was given or the price is below the list).
  Flagged when the price is below the list.
- `procedure.edited`: price old → new, plus any other changed field. Flagged when the price drops
  below the list.
- `procedure.deleted`, `procedure.moved`, `procedure.continued`: amount and patient. Deleted is
  flagged.
- `payment.received`: amount, method, receipt number, treatment by name. The duplicate client log
  in `QuickPaymentModal` is removed.
- `payment.edited`: old → new amount or method. Flagged.
- `payment.deleted`: amount, method, receipt. Flagged.
- `expense.added` / `expense.edited` / `expense.deleted`: amount and description. Edited and
  deleted are flagged.
- `commission.changed`, `labfee.corrected`: old → new, with names instead of ids.
- `staff.paid` / `staff.payout.edited` / `staff.payout.deleted` / `staff.deduction.added` /
  `staff.deduction.edited` **(new)** / `staff.deduction.removed`. Edits and deletes are flagged.

**Discounts**
- `discount.given`, `discount.changed`, `discount.removed`: written by the ledger update route
  when a charge's discount changes, with the patient, the treatment, the amount (the change in
  discount) and the reason. Always flagged.
- **Visit discount:** `AppointmentMoneyTab` already splits one visit discount into one update per
  charge. It now sends one shared `groupId` and the visit total with each update. The server logs
  one `discount.given` per charge with that `groupId`, and the page folds a group into one line:
  "خصم 300 ج على زيارة عمر حسام علي (3 خدمات)". No change to how the money is written.
- An appointment-level discount saved through `bookingService` is logged as `discount.*` from the
  appointment diff (below).

**Insurance** (server, `api/insurance/claims`)
- `insurance.created` **(new when saved as approved)**: insurer, patient, number of lines, total.
- `insurance.status`: old → new status. `cancelled` is flagged.
- `insurance.edited`: which parts changed (lines, dentist, patient, MetLife fields), as
  `changes`.
- `insurance.collected`: amount, insurer by name, number of claims.
- Row side-effects keep their money events, now carrying `refs.claimId` and `refs.payerName`.
- `settings.insurers` **(new)**, from `PayersSettings`.

**Appointments** (client; `bookingService` is where appointments are written)
- `appointment.created`: patient, date, time, doctor, branch.
- `appointment.edited`: a diff of date, time, duration, doctor, status, room, branch, treatment,
  cost and discount. **Notes-only edits are not logged**, and an empty diff writes nothing. This is
  what ends the autosave noise.
- `appointment.status` **(new)**: from → to. Written through one helper called by
  `DesktopDashboard`, `MobileDashboard` and `DentistHome` status handlers. No-show and cancelled
  are not flagged; they are routine.
- `appointment.moved` **(new)**: from `updateBookingTime` (drag), old → new date and time.
- `appointment.deleted` (server): date, time and doctor added; module corrected to appointments.
  Flagged.

**Patients**
- `patient.created`: also logged when the patient is created inside a booking **(new)**.
- `patient.edited`: a diff of name, phone, birth date, gender, branch and insurer.
- `patient.deleted` (server, records/delete): the patient's name. Flagged.
- `patient.restored`.

**Clinical**
- `plan.created` / `plan.edited` / `plan.deleted` / `plan.status` **(new)**.
- `media.uploaded`.

**Lab** **(new)**, client, from `labCaseWrite.ts`
- `lab.created`, `lab.sent`, `lab.received`, `lab.remake`, `lab.deleted` (flagged), and
  `lab.paid` with the amount.

**Team and settings**
- `staff.edited`: a diff of rates, commission, salary and branches.
- Existing user/role/permission events keep their wording, with names instead of uids.
- `settings.branches` **(new)**, `settings.services` **(new)**, `settings.labs` **(new)**.
- `settings.updated` stays as it is for the rest.

**Limit, stated plainly.** Money and insurance events are written by the server, so staff can
neither skip nor fake them. Appointment, patient, lab and settings events are written from the
staff member's browser, because that is where those records are saved today. They are faithful
for normal use but not tamper-proof. Moving appointment writes to the server is a separate
project.

### 4. The logs page (Settings → Activity log)

The page is rewritten as `src/components/activity/ActivityFeed.tsx`, with
`settings/ActivityLogs.tsx` becoming a thin host. The style follows the agreed direction: dark
slab, monochrome, serif figures, yellow as a fill only.

- **Dates:** Today (default) · Yesterday · Last 7 days · This month · Pick dates. Ranges are
  computed on the Cairo clock.
- **Tabs:** All · Money · Discounts · Insurance · Appointments · Patients · Treatment · Lab ·
  Team · Settings. A tab shows entries whose `categories` include it. Old entries are placed by
  their `module`.
- **Filters:**
  - person, from the staff list
  - patient, by typing a name; matches `patientName`, plus `details` for old entries
  - branch, shown only when the clinic has more than one
  - a "🔸 only worth a look" switch
- **Summary strip** on the Money, Discounts and Insurance tabs: one line per person with counts
  and totals for that tab's events, e.g. "مَلَك: 6 خصومات · 1,200 ج | دفعة محذوفة · 900 ج |
  3 دفعات معدّلة". Tapping a name sets the person filter.
- **List:** grouped by day, newest first, with the time on the side.
  - Each entry is one sentence from the catalogue; the person and patient names are bold.
  - The patient name links to their file.
  - Tapping the entry expands its `changes` as a before → after table, plus the reason.
  - Grouped visit discounts render as one line.
- **Loading:** one query, `timestamp >= start && timestamp < end`, ordered by `timestamp` desc,
  fetched in pages of 500 until the range is complete, capped at 5,000. If the cap is hit, the
  page says so. A single-field range needs no new index. Filters and the summary then run over
  the whole range, never over "the latest 200" as today.
- **Phone:** the same content as cards.

### 5. The patient-file tab

A tab named **"سجل النشاط"** (English: "Activity"), so it is not confused with the existing
"سجل الزيارات" timeline. It shows only to owner and admin, the same `ADMIN` test the settings
panel uses, and is hidden in chair mode.

It renders `ActivityFeed` with `patientId` fixed and the date range defaulting to "All time". The
query is `patientId == X`, ordered by `timestamp` desc, 200 at a time with "Load older". That
needs a composite index on `system_logs` (`patientId` ASC, `timestamp` DESC), added to
`firestore.indexes.json` and deployed with `--only firestore:default`. Entries from before the
ship date have no `patientId`, so the tab opens with one line saying the history starts on that
date.

## Testing

- **Catalogue unit tests** (`tests/activityCatalogue.test.mts`): every event key renders in both
  languages with no `undefined` or raw id; the flag rules; `diffChanges` returns nothing for an
  unchanged object and normalises Firestore timestamps and numbers; old entries render through
  the fallback.
- **Route tests on the Firestore emulator** (the cached-jar setup):
  - procedures create with a discount writes one `procedure.added` with `categories` money +
    discount
  - a ledger discount update writes `discount.given` with the right amount and groupId
  - a payment edit is flagged
  - claims PATCH approved → cancelled writes a flagged `insurance.status`
  - QuickPayment writes exactly one payment entry
- **Appointment diff:** a unit test of the diff helper used by `bookingService`; notes-only and
  no-op saves write nothing.
- **In the browser** (local dev against the emulator or the demo clinic):
  - take a payment, give a visit discount, move an appointment by drag, press each status
    button, cancel an insurance approval
  - check that each appears once, in Arabic, with names and before → after, under the right tab
    and in the summary
  - check the patient tab shows the same entries
  - check a receptionist account cannot see the tab
- `npx tsc --noEmit` and the existing suites stay green.

## Rollout

1. Catalogue, writers and tests.
2. Server events (money, insurance, settlements).
3. Client events (appointments, patients, lab, settings).
4. Page and patient tab.
5. Index deploy.

Each step is committed separately. It ships to main (Vercel deploys) only after the browser
check. The index deploy is part of shipping.

**Follow-up, not in this project:** the phone app's activity screen (`loadLogs`) can render v2
entries through the same catalogue rules once ported to Kotlin. Until then it shows the improved
English `action`/`details`, which is already better than today.
