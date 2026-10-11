# Branch finance separation — design

Date: 2026-10-11. Asked for by DENT INN (two branches: مصر الجديدة and التجمع الخامس). Decisions
below were taken with the owner in conversation; the choices he made are marked **decided**.

## Goal

Each branch keeps its own books — income, expenses, dentist payouts, profit, receipt numbers,
tax identity — and a staff member sees and acts on only the branches the owner allows them.
An owner or admin still sees everything, per branch or all at once.

## Decisions

- **Decided:** full split (own books, own receipt sequences, own tax block), with per-person
  branch access set by the owner.
- **Decided:** money belongs to **the branch on screen** when it is recorded, not the patient's
  branch nor the visit's. Automatic money (nobody at a screen) takes the visit's branch, else the
  patient's, else the first branch.
- **Decided:** access is a tick-list of branches on each person's Team profile. Empty means all.
  Owners and admins always see all branches. A restricted person never sees another branch in
  the switcher, so they cannot book, collect or record an expense there.
- **Decided:** one receipt sequence and one ETA branch code per branch; the tax registration
  number can be overridden per branch (so one company or two both work).
- **Decided:** old rows are **not** touched. They carry no branch and appear only under "All
  branches". Everything is test data today.
- **Decided:** enforcement is **screen + server** (approach A). Every money write goes through the
  website's API routes, which stamp the branch and refuse one the caller may not use. Firestore
  rules are unchanged; rule-level enforcement is a later project, after the phone app stamps
  branches.

## Facts about the code today

- Branches live in `settings/locations` (`lib/clinicLocations.ts`); the on-screen branch is
  `useActiveBranch()` (`lib/useActiveBranch.ts`): remembered in localStorage, derived never
  stored, `ALL_BRANCHES = "__all__"`, `scopeBranchId` is `""` under all-branches.
- Appointments, patients, lab cases, price lists and rooms carry `branchId`. **No ledger row
  does.** The Finance page, every report tab, payroll/settlements, the dashboard income tile and
  the owner's view see the clinic as one pot. Staff rows have no branch.
- All money writes already go through API routes (`lib/moneyApi.ts` → `/api/finance/ledger`,
  `/api/clinical/procedures`, `/api/insurance/claims`, `/api/staff/settlements`); `moneyApi.post`
  attaches `clinicId` to every body from one place. Firestore denies the client `ledger` writes.
- Receipt numbers: one clinic counter, minted server-side (`lib/receiptSettings.ts`,
  `receiptNumbers`); ETA block has one `branchCode`/address per clinic.

## 1. Data

### Staff
`staff/{id}.branchIds?: string[]` — the branches this person may work in. Absent or empty = all.
Ignored for Owner/Admin roles (always all). Set only from the Team page by an admin.

### Ledger rows
Every **new** row of every type gets `branchId: string` (never `""`): procedure charges,
payments, manual income/expense, insurer payments, patient share, settlement payouts/deductions,
lab-fee rows. Written by the server only. Old rows keep no field.

### Branches
`ClinicBranch` gains optional `receiptPrefix` (short, uppercase, e.g. `HEL`), `eta?: {
branchCode, address, taxRegistration? }`. Parsed in `lib/clinicLocations.ts` with the same
"absent = inherit clinic value" rule as everything there.

### Counters
Receipt counters move from one clinic doc to one per branch: `counters/receipt_<branchId>`.
The clinic-wide counter stays for rows with no branch (old data, none new).

## 2. The branch on screen

- `useActiveBranch()` learns the person's **allowed branches**: `allowedBranches(branches,
  staffRow, isAdmin)` (pure, in `lib/branchAccess.ts`) = all for admins, else the ticked ones that
  still exist, else all when nothing is ticked.
- The switcher (`BranchSelector`) lists only allowed branches. One allowed → rendered as a fixed
  label, no switch. "All branches" offered to admins only.
- A remembered branch outside the allowed set resolves to the first allowed one (same
  "derived, never stored" rule as a deleted branch today).
- `BranchSelector` appears on: dashboard (already), Finance, Reports, Team, Patients, Owner view.
  One component, one stored choice.
- **Money under "All branches":** every money form (collect, Quick Pay, add treatment, expense,
  settlement, insurer paid) calls `requireBranchForMoney()`; under `ALL_BRANCHES` it opens a
  "Which branch?" pick (allowed branches) and returns the choice, otherwise returns the on-screen
  branch. No money row is ever sent without a branch.

## 3. Writing money

### Browser chokepoint
`moneyApi.post` attaches `branchId` the same way it attaches `clinicId`: from an explicit value in
the body, else `currentBranchId()` (the on-screen branch, `""` under all). Routes that write money
require a non-empty branch; the "Which branch?" pick (§2) supplies it under all-branches.

### Server check — one helper, every money route
`assertBranchAllowed(clinicId, uid, branchId)` in `lib/server/branchAccess.ts`:
1. branch exists in `settings/locations` (a clinic with no branches: skip everything, stamp
   nothing — pre-branch behaviour);
2. caller is admin, or `branchId ∈ staff.branchIds` (or the list is empty);
3. else 403 `"You can't record money for that branch."` / Arabic equivalent.
Called by: `/api/finance/ledger` (create, income, expense), `/api/clinical/procedures` (charge +
payment rows), `/api/insurance/claims` (collect share, insurer paid), `/api/staff/settlements`,
and the receipt-minting path. The stamped value is the checked one; routes never trust a
`branchId` nested inside row data.

### Edits and deletes
A row's branch never changes by edit (`branchId` joins the locked fields). Deleting/restoring
keeps it. Moving a procedure to another appointment keeps the row's branch (money stays where it
was taken).

### Bookings
`BookingModal`'s branch/room picker is limited to allowed branches; the appointment is stamped as
today. Bookings are client writes and stay so (approach A); the server-side insurance "book this
line" path uses the patient's branch.

### Automatic money
Insurer payments, patient-share rows written from an approval, bot/scheduled jobs: branch of the
linked appointment → patient's `branchId` → first branch. Helper `branchForAutomaticRow()`.

## 4. Reading money

- **Finance page, dashboard income tile, Owner view, Reports (every tab via `useReportData`
  datasets), Team payroll + settlements, staff insurance share:** filter rows by
  `rowInScope(row, scopeBranchId)` — `""` (all) passes everything; otherwise only
  `row.branchId === scope`. Rows with no branch show only under "All branches"; where a breakdown
  is drawn they are labelled "before branches".
- **Dentist share:** computed from rows in scope → one figure per branch for a dentist who works
  both; settlements stamped with the branch they are paid from and shown under it.
- **Patient file (Finance tab, booking Payment tab):** one patient = one account. Shows the
  whole account to anyone who may open the patient, each row with a small branch label; a
  restricted receptionist sees the other branch's balance but collects only into her own branch.
  **Decided:** see, not hide — a receptionist who cannot see the balance takes the wrong amount.
- **Patients list:** everyone sees all patients.
- **Receivables / recovery lists:** scoped like the Finance page.
- Reports export (Excel) carries a "Branch" column.

## 5. Receipts

- Number = `<receiptPrefix>-<n>` from the branch's own counter; a branch with no prefix set uses
  the first three letters of its name.
- Header prints the branch's name and address; the tax block uses the branch's ETA branch code
  and the branch override of the registration number if set, else the clinic's.
- Print and WhatsApp delivery unchanged. The number is minted in the same server transaction as
  the payment row, as today.

## 6. Settings and permissions UI

- Team → person → "Branches": tick-list of the clinic's branches, admins show "All branches"
  greyed. Saved to `staff.branchIds`. Invite/join flows leave it empty (= all).
- Settings → Branches & rooms: per-branch receipt prefix, ETA branch code, address, tax number
  override; a note that receipts restart numbering per branch.
- Shown only when the clinic has at least one branch; single-site clinics see nothing new.

## 7. Out of scope

- Firestore-rule enforcement (approach B).
- Android: reads keep working; the phone does not filter by branch or stamp money until a
  follow-up. Its money writes already go through the same routes, so they get stamped with the
  visit's branch via the automatic rule when the app sends none.
- Stock per branch. Moving old rows into branches.

## 8. Testing

- Unit (pure, tsx): `allowedBranches`, `rowInScope`, `branchForAutomaticRow`, per-branch receipt
  numbering, `parseClinicBranches` round-trip of the new fields.
- Route tests on the Firestore emulator (`route-tests` harness): restricted user posting another
  branch's money → 403; admin passes; no branch on a money write → 400; stamped value equals the
  checked one; edit cannot change `branchId`.
- Source pins (as `tests/payers.test.mts` does): every money route calls `assertBranchAllowed`;
  every money form calls `requireBranchForMoney`.
- Manual walk-through on DENT INN with a two-branch receptionist and a one-branch dentist before
  it ships.

## Rollout order

1. Data + helpers + server check (no UI change; stamps start; nothing filters yet).
2. Switcher + allowed branches + Team tick-list.
3. Finance/dashboard/owner filtering, then reports, then payroll.
4. Receipts per branch + branch settings.
5. Walk-through, then ship.
