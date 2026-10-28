# Expense receipt scan — design

Agreed with the owner 2026-10-28.

## What it does

Finance page → **Scan receipt**. Staff photograph or upload a receipt (photo or PDF). The AI reads
supplier, date, total and the line items, and groups them into one line per expense category
(the existing `EXPENSE_CATEGORY_LIST`). A review sheet shows the lines; staff edit, delete or add
lines, then **Save all**. Each line becomes an ordinary expense row on the ledger, carrying the
receipt photo and a shared receipt id.

## Decisions

- A receipt that mixes categories is split: one expense row per category.
- The photo is kept (Storage, `clinics/{clinicId}/expense_receipts/…`) and linked from each row.
- The AI never writes. Only the human **Save all** writes, and only through the ledger route.
- 1 AI credit per successful reading. Failed readings are free.
- New add-on `aiReceipts`, **off on every plan**; switched on per clinic in the superadmin panel.
  Requires `aiChat` (the credit meter).
- Needs `finance.add`, the same permission as typing an expense by hand.
- Branch = the branch on screen, the same rule as `create-entry`.

## Live-clinic safety

- `create-entry` is not changed. Saving uses a new ledger action, `create-receipt-entries`, which
  builds every row with the existing `buildManualEntryRow` and writes all rows in one batch (all or
  nothing), with an audit entry per row.
- Rows get two new optional fields, `receiptImageUrl` and `receiptGroupId`. Nothing that reads the
  ledger today looks at them; rows without them are untouched.
- No existing document is migrated or rewritten.
- With the add-on off (every clinic on day one) the only visible change is nothing: the button is
  hidden and the routes refuse.

## Pieces

1. `src/lib/receiptScan.ts` — prompt, response schema, `normalizeReceiptScan()` (pure, tested):
   clamps categories to the known list, drops empty lines, merges duplicate categories, rounds money.
2. `POST /api/ai/receipt-scan` — staff auth + `finance.add`, add-on gate, credit check, downloads
   the uploaded file by URL (must be this clinic's `expense_receipts` folder in our bucket), asks
   Gemini Flash, returns the normalised result, charges 1 credit, logs usage. Writes no ledger rows.
3. Ledger route action `create-receipt-entries` — validates 1–12 lines, URL ownership, writes the
   batch.
4. Finance page — button (only when unlocked), upload, review sheet, save.

## Testing

- Unit tests for `normalizeReceiptScan` and the URL-ownership check.
- Route test of `create-receipt-entries` on the Firestore emulator: rows written, fields correct,
  one refused line refuses all, `create-entry` output unchanged.
- Live reading checked with fake receipts (materials, cleaning, electricity, mixed).
