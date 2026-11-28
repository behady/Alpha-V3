# Paid-daily dentists — design

**Date:** 2026-11-28 · **Status:** agreed in chat, waiting for the owner's review of this document

## 1. Why

Dr Mohamed Ehab takes his share (50%) from each patient payment the moment the patient pays. The app
does not know that: it adds every share up as "owed" and waits for the owner to record a payout on
the Team page. The owner recorded three lump payouts to keep the books level (21,700 on 31 Oct,
7,050 on 9 Nov, 11,800 on 28 Nov). Because a payout is always poured over the oldest unpaid work, the
Team page now says 10,400 is still owed for November, and November's share was partly recorded twice
(the 7,050 was his November share up to 9 Nov; the 11,800 was the whole of November).

The owner wants a per-dentist choice: some dentists are paid from each payment, the rest keep the
current "add up, then pay" flow.

## 2. What the owner sees

- **Team page → dentist → Settings:** a switch **"Paid daily — takes his share from each payment"**
  ("بياخد نصيبه يومي — من كل دفعة"). Owner and Admins only. Off for every dentist by default.
- **Team page → Money tab** of a paid-daily dentist: his patient payments show **Paid** at once and
  "Still owed" stays 0 for patient work. Manual payouts and deductions still work for anything else
  (advance, bonus, insurance share). Automatic daily lines are listed as **"Day's share (automatic)"**
  with no edit or delete button.
- **Finance page:** one automatic Salary line per dentist per day, **"Day's share – Dr Mohamed
  Ehab"** / **"نصيب اليوم – د. محمد إيهاب"**, equal to his share of that day's payments. It cannot be
  edited by hand (same lock the Team-page payouts already have).
- **Daily sheet, reports, Excel, owner WhatsApp reports:** no change needed — they already treat a
  payout's Salary line as cash leaving.

## 3. Rules

1. A day's line = the sum of `doctorCommissionAmount` on that dentist's **private** payment rows
   dated that day (rows with a `claimId` are insurance and are excluded). Positive sum → one line;
   zero → no line (an existing one is removed).
2. The line follows its payments: a payment added, edited (amount, date, dentist, branch) or deleted
   re-works **every** day and dentist it touched, before and after the change.
3. It applies to days on or after the date the switch was turned on (`paidDailyFrom`). Turning it on
   covers the payments already taken earlier that day.
4. Turning the switch off stops new lines. Existing lines stay as they are, frozen — they are history.
   Turning it on again sets a new `paidDailyFrom` (that day); the days while it was off stay owed as
   usual.
5. One line per branch per day for clinics with branches (the line carries the payments' `branchId`).
6. Insurance shares and base salary are untouched: they stay owed until a manual payout.

## 4. How it is stored

- **Staff record:** `paidDaily: boolean`, `paidDailyFrom: "yyyy-mm-dd"`.
- **Automatic payout** in `staff_settlements`, one per dentist/day/branch, with a fixed id
  `daily_<staffId>_<date>_<branch or "all">` so re-running is always safe:
  `{ staffId, kind: "payout", auto: "daily", amount, date, method: "Cash", note: "",
  paymentIds: [...], ledgerId, branchId? }`.
- **Its Salary row** on `ledger` with a fixed id `dailypay_<staffId>_<date>_<branch or "all">`: the
  same shape a Team-page payout writes (`settlementId`, `staffId`, category "Salary") plus
  `dailyPay: true` so Finance can label it.
- The settlements route refuses to edit or delete an `auto: "daily"` payout; the ledger route already
  refuses rows with `settlementId`.

## 5. When the line is updated

One server helper, `syncDailyPay(clinicId, touched: {staffId, date}[])`, runs **after** a ledger
write has committed, re-works each touched day for each touched dentist (only if that dentist is
paid daily and the day is in range), then re-stamps paid/owed (`restampStaffSettlements`). It never
throws; failures go to Sentry and the nightly check repairs them.

It is called from every server path that creates, edits or deletes a payment row. Known today:
`/api/finance/ledger`, `/api/clinical/procedures`, `/api/insurance/claims`, `/api/appointments/delete`,
the patient-delete cascade, and AI approved actions (`aiPendingActions`). The plan re-checks this list
by searching every server file that writes the `ledger` collection, and a test fails if a new one
appears without calling the helper.

## 6. How paid and owed are worked out

`settleEarnings` (`src/lib/staffSettlement.ts`) gets one change: automatic daily payouts are applied
**first**, each to exactly the payments in its `paymentIds`. Manual payouts and deductions are then
poured oldest-first over what is left, as today. So a daily line can never be swallowed by an older
insurance line, and a manual payout can never land on work the dentist already took.

## 7. Nightly safety net

A cron (`/api/automation/daily-pay-check`, early morning Cairo time) re-works yesterday and today for
every dentist with `paidDaily` on. For a clinic with no such dentist it reads one staff query and
writes nothing.

## 8. Fixing Dr Mohamed's records (one time, clinic `SmtW6r6jKaFhfRWYcxsG` only)

### What was found (read-only check, 2026-11-28)

| Group | Payments | His share |
|---|---|---|
| On his current profile (`XLBIC0YPS9ogSe7K4UR3`), Aug–Nov | 119 | 50,950 |
| On an old copy of him (`dsQWVT4RmwvaC5Y9NZcF`, no staff record), May–Aug | 31 | 14,839 |
| No dentist on the payment, but its treatment is his (old copy), Jul–Aug | 10 | 3,825 |
| **Total** | **160 payments on 58 days (22 May – 27 Nov)** | **69,614** |

Also on the old copy: 52 treatment rows (83 ledger rows in all) and 54 clinical notes. The clinic
has no branches and no insurance rows.

### Steps

1. **Inventory script (read-only):** scans every collection of this clinic for the old id, the
   current id and the name "Mohamed Ehab", plus payments with no dentist whose treatment is his, and
   prints the full list with counts and totals. It must reproduce the table above; any difference
   stops the work and is shown to the owner.
2. **Backup:** every document the fix will touch is saved to a JSON file on this laptop before any
   write, with a restore script.
3. **Dry run:** prints every planned write (re-point, delete, create) and the before/after Finance
   numbers. **The owner OKs this list before step 4.**
4. **Write**, only to documents on the dry-run list, only under this clinic:
   - re-point the 83 old-copy ledger rows to his current id and name;
   - give the 10 no-dentist payments his id and name (taken from their treatment row);
   - delete the 3 lump payouts and their 3 Salary rows;
   - set `paidDaily: true`, `paidDailyFrom: 2026-05-22` on his staff record;
   - run `syncDailyPay` for all 58 days, which creates 58 daily lines.
5. **Check:** daily lines add up to 69,614; Team page shows 0 owed for patient work; Finance per month
   matches the table below; no document outside the dry-run list changed.

### Expected Finance change (money paid to him per month)

| Month | Now | After | Clinic profit |
|---|---|---|---|
| May | 0 | 1,800 | −1,800 |
| July | 0 | 10,364 | −10,364 |
| August | 0 | 14,775 | −14,775 |
| September | 0 | 8,300 | −8,300 |
| October | 21,700 | 22,575 | −875 |
| November | 18,850 | 11,800 | +7,050 |
| **Total** | **40,550** | **69,614** | **−29,064** |

## 9. Keeping other clinics untouched

- The switch is off for every dentist; with it off, no new code path writes anything.
- `syncDailyPay` and the nightly check write only for dentists whose `paidDaily` is on.
- The one-time fix is pinned to clinic `SmtW6r6jKaFhfRWYcxsG` and to the explicit id list from the dry
  run; it refuses to write any other document.
- All existing tests must still pass unchanged.

## 10. Tests

- **Allocation:** daily payouts cover exactly their payments; manual payouts skip them; insurance
  lines are unaffected; "owed" is 0 for a fully daily-paid dentist.
- **Day line:** sum of shares; zero removes the line; insurance rows excluded; respects
  `paidDailyFrom`; frozen when the switch is off; one line per branch.
- **Routes (Firestore emulator):** add / edit / delete a payment for a paid-daily dentist and the line
  follows; moving a payment to another dentist or date fixes both days; a dentist with the switch off
  gets no writes; the settlements route refuses to edit an automatic payout.
- **Coverage guard:** every server file that writes `ledger` calls `syncDailyPay`.
- **Fix script:** dry run on the emulator with a copy of the found records reproduces the tables above.

## 11. Not in this work

- Base salary, insurance shares, commission rates.
- The old copy of Dr Ahmed Tarek (`oaP88nsECRCvmaokenC9`, 7 payments) — seen, left alone.
- Moving the 54 clinical notes on Dr Mohamed's old copy — **owner to decide** at review (it does not
  affect money; it would show those visits under his name).

## 12. As built (2026-11-28)

- **Where the line is kept in step:** inside `recordLedgerAudit` / `recordLedgerAuditBatch`
  (`lib/server/ledgerAudit.ts`) — every audited money change re-works each dentist it names — plus
  explicit calls in the AI assistant's direct ledger writes and AI-approved payments. A touched
  dentist is re-checked over **all** days (the history is read anyway; only differing days are
  written). Guard: `tests/dailyPayCoverage.test.mts`.
- **Finance label:** the Salary row's description is "Day's share – <name>" ("نصيب اليوم – …").
- **Live inventory, dry run 2026-11-28:** matches §8 exactly (119 / 31 / 10 payments, 83 old-copy
  ledger rows, 54 notes, nothing naming him on neither id, old id nowhere else). The 28 Nov 11,800
  payout had already been deleted by the Owner from the Team page that morning, so the fix removes
  **two** lump payouts (21,700 and 7,050). 57 day lines (one day's payments all earned 0).
  November becomes 7,050 → 11,800 (clinic profit −4,750); the other months are as in §8.
- Clinical notes on the old copy are moved too (owner: "just do it").

## 13. Release

Built and tested in the `worktree-paid-daily` branch, committed locally. Nothing is pushed (pushing
puts it live) and the one-time fix is not run without the owner's explicit yes, each separately.
