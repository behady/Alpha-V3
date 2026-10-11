# Finance page: branch tabs, insurer tabs, filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Finance page gets a tab per branch (owner), a tab per insurance company with a "Mark collected" flow (one row or many), payments that say which company paid, and a full filter set.

**Architecture:** The 1,766-line Finance page is split: the existing list becomes the **Clinic** tab; a new **InsurerTab** lists the company's treatment rows with the patient/insurer split and posts a new `insurer-collect` ledger action; **BranchTabs** drive the SAME remembered branch as the dashboard switch (`useActiveBranch().setActiveBranchId`); filters live in one `FinanceFilters` component and one pure `applyFinanceFilters()`.

**Tech Stack:** Next.js 16 route handler (`/api/finance/ledger`), firebase-admin transaction, Firestore client reads, pure TS helpers tested with `npx tsx`, emulator route tests (`tests/branchMoneyRoutes.test.mts` harness).

**Spec (decisions from the owner, 2026-10-12):** both per-row and select-all "Mark collected" on every insurer tab; for a contract company with no paper, what the patient paid in cash on a treatment is the patient's share and the rest is what the company owes; branch tabs are the same remembered branch as the dashboard; the filter table in the conversation is the full list. Builds on `docs/superpowers/specs/2026-10-11-branch-finance-separation-design.md`.

## Global Constraints

- CRLF files; diffs show only intended lines. Never write `undefined`. EN + AR for every string. `npx tsc --noEmit -p .` clean before each commit. Commit messages plain, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Money writes go through `/api/finance/ledger` only; the browser never writes `ledger`.
- **Ruling:** an insurer-collect payment takes the **charge's** `branchId` (insurer money follows the work, not the screen) — one company pays for both branches at once. Receipt numbers come from that branch's counter (`receiptCounterDocId`, `receiptPrefixOrClinic`). Method is `INSURER_PAYMENT_METHOD` ("Insurance"), `payerId`/`payerName` copied from the charge, commission 0 (as the claims route does for insurer money).
- A charge is "the company's" when `payerId` is set and ≠ `PRIVATE_PAYER_ID`. Rows with a `claimId` (approval-based insurers) also appear on their insurer's tab, read-only for collection (their "Insurer paid" lives on the claim — show a link "Collect on the Insurance page" instead of a button).
- Filtering is in memory after load (as the page already does with `rowInScope`).
- Nothing changes for a clinic with no insurers (no insurer tabs) or no branches (no branch tabs).

## Review Focus

1. A charge partly paid by the patient in cash: "Mark collected" must take exactly `cost − paid so far`, never the full cost — Task 1 pins `rowSplit`, Task 2 pins the route amount.
2. Collecting the same rows twice must not double-pay: a row with 0 outstanding is skipped, and a batch where every row is settled returns 409 `NOTHING_TO_DO` — Task 2.
3. A branch-restricted admin does not exist (admins see all), but a receptionist with `finance.add` on one branch must get 403 when a selected charge sits on another branch — Task 2 reuses `assertRowBranchAllowed`.
4. The Clinic tab under "All branches" must still show the "rows from before branches" line and the payer badge on payment rows — Task 3 pins both.
5. Filters combine with AND; clearing them restores every row — Task 1 pins `applyFinanceFilters` with two filters set and with none.

---

### Task 1: Pure helpers — insurer rows, the split, and the filter

**Files:**
- Create: `src/lib/insurerLedger.ts`, `src/lib/financeFilters.ts`
- Test: `tests/insurerLedger.test.mts`, `tests/financeFilters.test.mts`; `package.json` scripts `test:insurer-ledger`, `test:finance-filters`

**Interfaces (produces):**
```ts
// insurerLedger.ts
export type LedgerLite = { id: string; type?: unknown; payerId?: unknown; payerName?: unknown; claimId?: unknown; cost?: unknown; amount?: unknown; paid?: unknown; method?: unknown; procedureId?: unknown; date?: unknown; patientId?: unknown; patientName?: unknown; description?: unknown; branchId?: unknown; doctorName?: unknown };
export type InsurerRow = { charge: LedgerLite; cost: number; patientPaid: number; insurerPaid: number; outstanding: number; collectable: boolean /* false when claimId set or outstanding ≤ 0 */ };
export function insurerRows(rows: readonly LedgerLite[], payerId: string): InsurerRow[]; // procedure rows with that payerId; payments matched by procedureId; insurerPaid = payments with method "Insurance"; patientPaid = the rest; outstanding = max(0, cost − patientPaid − insurerPaid)
export function insurerTotals(rows: readonly InsurerRow[]): { billed: number; patientPaid: number; insurerPaid: number; outstanding: number };
// financeFilters.ts
export type FinanceFilter = { kind: "all" | "payment" | "income" | "expense"; method: string | "all"; payerId: string | "all" /* "private" = PRIVATE_PAYER_ID */; doctorId: string | "all"; patientQuery: string; category: string | "all"; receivedBy: string | "all"; receiptQuery: string; amountMin: number | null; amountMax: number | null; onlyOutstanding: boolean };
export const EMPTY_FINANCE_FILTER: FinanceFilter;
export function applyFinanceFilters<T extends LedgerLite & Record<string, unknown>>(rows: readonly T[], f: FinanceFilter): T[]; // AND of every set field; patientQuery matches patientName or patientPhone (case/diacritic-insensitive via existing normalizer in lib if one exists — grep "normalizeArabic"); receiptQuery matches receiptNumber substring; amount uses the row's cash value (`ledgerCashValue` from lib/reportHelpers); onlyOutstanding keeps procedure rows with cost − paid > 0.009
```

- [ ] Write both test files first (RED): `insurerRows` with a Gasco charge 1584 cost, a 500 cash payment and a 300 Insurance payment → `{patientPaid:500, insurerPaid:300, outstanding:784, collectable:true}`; a claim row → `collectable:false`; a private row excluded; `insurerTotals` sums. `applyFinanceFilters`: empty filter returns all; kind+method AND; patientQuery "ليلى" matches "ليلى هاني"; onlyOutstanding drops settled charges and all payments; amount range.
- [ ] Run → FAIL (modules missing). Implement. Run → PASS. tsc. Commit "Finance helpers: an insurer's rows, the patient/insurer split, and the filter".

---

### Task 2: `/api/finance/ledger` action `insurer-collect`

**Files:**
- Modify: `src/app/api/finance/ledger/route.ts` (new `case "insurer-collect"` beside `create-payment` ~:1145; new `insurerCollect()` handler)
- Modify: `src/lib/moneyApi.ts` — `export function collectFromInsurer(args: { payerId: string; chargeIds: string[]; clinicId?: string | null }): Promise<{ ok: true; paid: number; count: number; receiptNumbers: string[] }>`
- Test: `tests/branchMoneyRoutes.test.mts` (emulator), 4 new cases

**Behaviour:** permission `finance.add`. Body `{ payerId, chargeIds[] (≤ 100) }`. Loads the charges + their payments (outside the transaction, like `createPayment` does), computes each row's outstanding with `insurerRows` from Task 1; skips rows with outstanding ≤ 0 or with `claimId`; refuses with 409 `NOTHING_TO_DO` when none remain; 400 when a charge's `payerId` ≠ body `payerId`; `assertRowBranchAllowed` on each charge (403 on the first failure, nothing written). Then ONE transaction: for each remaining charge, `buildPaymentRow` with `method: INSURER_PAYMENT_METHOD`, amount = outstanding, `payerId/payerName` from the charge, `branchId` = charge's, dentist from the charge (`resolveDoctorForPayment`), commission 0, receipt minted from that branch's counter (group charges by branch; one counter read+write per branch), `applyProcedureSync` as `createPayment` does, and `insurerPaidAt: date` on the charge. Audit via `recordLedgerAudit`. Returns `{ ok, paid, count, receiptNumbers }`.

- [ ] Emulator cases (RED first): admin collects two `gasco` charges (one half paid by cash) → 200, two Insurance payments of the right amounts, charges now `paid === cost`, receipt numbers follow each charge's branch prefix; the same call again → 409 NOTHING_TO_DO; desk-1 (hel only) collecting a `tag` charge → 403 and nothing written; a charge with `claimId` in the list is skipped (count excludes it).
- [ ] Implement, run with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`, tsc, commit "Finance: collect what an insurance company owes, row by row or all at once".

---

### Task 3: The Finance page — branch tabs, Clinic/insurer tabs, payer badge, filters

**Files:**
- Create: `src/components/finance/BranchTabs.tsx`, `src/components/finance/InsurerTab.tsx`, `src/components/finance/FinanceFilters.tsx`
- Modify: `src/app/(dashboard)/finance/page.tsx`, `src/config/settingsText.ts` or the finance text source the page uses (find it) for new strings
- Test: `tests/branchAccess.test.mts` (source pins)

**Behaviour:**
- **BranchTabs** (admins only, ≥ 2 branches): tabs `[each branch…][All branches]` bound to `useActiveBranch()` (`activeBranchId`, `setActiveBranchId`, `canChooseAll`); replaces the `BranchSelector` pill on this page only. Non-admins keep the fixed label.
- **Second row of tabs:** `Clinic` + one per active payer ≠ Private (`usePricingPolicy().payers`), in payer order; hidden when there are no insurers. Remembered in the URL `?tab=<payerId|clinic>`.
- **Clinic tab** = today's content + `FinanceFilters` (every filter from the plan header; dentist and kind reuse the existing state). Payment rows show a payer badge: `InsurerBadge` + "{payerName} paid" / "{payerName} دفعت" when `method === "Insurance"`, or "for {payerName} treatment" / "لعلاج على حساب {payerName}" when a cash payment settles a payer charge.
- **InsurerTab(payerId):** totals strip (Billed · Patient paid · Company paid · Outstanding, from `insurerTotals`); checkbox per row + "Select all outstanding"; row shows date, patient, treatment, dentist, cost, patient paid, company paid, outstanding, status pill (Outstanding / Collected / "On the Insurance page" for claim rows); per-row **Mark collected** and a sticky **Mark N selected collected (total)** button → `confirm` → `collectFromInsurer` → toast with count and receipt numbers → rows refresh from the live listener. Honours the page's date range and the on-screen branch (`rowInScope`); "Only outstanding" toggle on by default.
- Source pins: page matches `/BranchTabs/`, `/InsurerTab/`, `/applyFinanceFilters\(/`, `/collectFromInsurer\(/`; `InsurerTab.tsx` matches `/requireBranchForMoney/`? — NO: collection never asks (branch comes from the charge); pin that it does NOT import `useBranchForMoney`.

- [ ] Pins RED → implement → GREEN; tsc; `npm run -s test:payers`; commit "Finance page: a tab per branch, a tab per insurance company, and the filters".

---

### Task 4: Walk-through list

- [ ] Append a "Part F — Finance tabs" section to `docs/testing/branch-finance-walkthrough.md` (owner: branch tabs follow the dashboard; Gasco tab shows the MTA row with its split; select one → Mark collected → receipt TAG-/HEL- per the charge's branch; select all; second collect says nothing to do; Clinic tab payment row says "Gasco paid"; filters). Commit.
