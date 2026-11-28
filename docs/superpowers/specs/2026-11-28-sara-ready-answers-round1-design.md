# Sara: ready-made answers, round 1

Date: 2026-11-28. Owner approved the design in chat the same day.

## Why

On 2026-11-28 Sara answered two questions with "…". The cause: she answers by reading raw
records through `db_read` (100 full documents per read, re-sent on every tool round), ran out
of her five tool rounds, and the route returned an empty reply. The two turns used 696k and
350k input tokens (about $0.30 together) and the clinic was charged two credits for nothing.

The owner then reviewed 100 likely questions and kept all of them
(https://claude.ai/artifact/7kTrtmMgVNZAFhVh27mzZf). Round 1 covers questions 1–24
(Money, Who owes us) and the safety work that applies to every question.

## Owner's decisions

- The system works out the answer; Sara only picks the answer and words it.
- Long lists never pass through the AI. The full list goes into a PDF.
- Money answers show the detail lines, not only a total (his notes on Q2, Q3, Q6, Q9, Q10).
- Outside the ready answers, Sara reads little and stops early. Owners and Admins are then
  offered a deeper search for **10 credits**. Everyone else is told she cannot answer yet.
- Every question is logged so common ones can become ready answers later.
- Sara tells a person only what their screens already show them.

## What exists already (found while reading the code)

- `lib/reports` builds 30 reports on the server as documents (`buildReportDoc`), the same
  engine behind the Reports page and the phone's `/api/reports`.
- `lib/automation/briefing` loads and sums money, production, HR and stale balances.
- `buildCustomPdf` renders table sections to a PDF for the WhatsApp staff line (`document` key).
- `resolveBriefingAccess(role, permissions)` gives `money` (`access.finance`) and `hr`.
- Gap: `/api/gemini` checks permissions on writes only. `db_read` on `ledger`, `expenses`
  and `staff`, `generate_financial_summary` and `run_clinic_report` run for any staff member.
- `generate_financial_summary` ignores the branch on screen.

## Design

### 1. Read permissions (`src/lib/sara/readPolicy.ts`)

`mayReadCollection(collection, filter, role, permissions)`:

| Collection | Needs |
|---|---|
| `ledger`, `expenses` (clinic-wide) | `access.finance` |
| `ledger` filtered to one `patientId` | `access.patients` |
| `patients` | `access.patients` |
| `appointments` | `access.appointments` |
| `clinical_notes` | `access.clinical` |
| `inventory`, `inventory_transactions` | `access.inventory` |
| `staff` | anyone, but pay fields are removed unless `hr` |
| `services`, `tickets` | any staff member |

`generate_financial_summary`, `run_clinic_report` with `revenue`, and the new money tools need
`access.finance`. `run_report` needs `access.reports`, plus the report's add-on, plus `hr` for
payroll, exactly as `/api/reports` does. Each tool is removed from the offer and checked again
in its handler.

### 2. Ready answers

- **`run_report`** `{ report, startDate, endDate }`: builds the report document on the server
  (`lib/sara/reportRunner.server.ts`, the same steps as `/api/reports`, filtered to the branch
  on screen), hands the model a digest (figures, first 10 rows of each table, totals, row
  counts) and attaches the full document for the PDF. Covers compare, expenses, top
  treatments, discounts, payment methods, lab spend, dentists.
- **`money_day`** `{ startDate, endDate }` (replaces the body of
  `generate_financial_summary`): collected, expenses, deductions, net; by method, by
  collector, by branch; payment and expense lines; cash-in-drawer for the period. Same cash
  rule as the Finance page.
- **`who_owes`** `{ filter, days?, patientId?, limit? }`: balances from the whole ledger
  (`receivables`), filters `all | top | older | today | credit | patient | finished`.
- **`payment_changes`** `{ startDate, endDate }`: payments edited or deleted, from
  `system_logs`. Owners and Admins only.

Digest and PDF conversion live in `src/lib/sara/reportDigest.ts` (pure, tested).

### 3. Safety net

- `db_read` and `find_patient`: default 20 rows (max 50), heavy fields removed
  (`teethData`, images, long arrays), and a per-turn ceiling on returned characters
  (`lib/sara/readBudget.ts`): 24,000 normally, 150,000 in a deep search.
- When the ceiling is hit the tool returns a refusal instead of data.
- After the loop: if the model still wants a tool or returned no text, one last call with
  tools off asks it to answer from what it has. If that is empty too, the reply is a plain
  "I couldn't work that out" with `noAnswer: true` and **no credit is charged**.
- The widget does not keep a `noAnswer` turn in the history it sends back.

### 4. Deep search

When the ceiling was hit and the caller is Owner/Admin on the web widget, the reply carries
`deepSearchOffer: { credits: 10 }`. The widget shows a card; on yes it resends the question
with `deepSearch: true`. The server re-checks the role, checks the clinic has 10 credits left,
raises the ceilings (150,000 characters, 8 rounds, 100 rows per read) and charges 10 credits
only if an answer comes back.

### 5. Question log

Root collection `sara_question_log` (server-only, no rules change: unlisted root collections
are denied to clients). One row per question: clinic, user, role, client, question (first 500
characters), outcome (`ready | read | deep | none | failed`), tools used, API calls, tokens,
credits. Read by superadmin through `/api/admin/sara-questions` and a list in the superadmin
AI costs tab.

### 6. PDF

The server returns `document: { title, subtitle, language, sections }` (the shape the
WhatsApp staff line already sends as a PDF). The web widget shows an "Open PDF" button that
prints the sections with the existing print helper. Nothing in the document passes through
the model.

## Out of scope for round 1

Questions 25–100, quick-question buttons, rules changes, Android, `/api/reports` itself,
context caching of Sara's prompt.

## Testing

- Unit tests for every file in `src/lib/sara` (`npm run test:sara`).
- Route test on the Firestore emulator: a receptionist is refused money, an admin is not; an
  empty model reply charges nothing.
- Demo clinic: ask questions 1–24 before and after, record API calls and tokens for each.

## Rollout

Branch `claude/sara-ready-answers`. Pushed only on the owner's yes, after the live-clinics
safety check.
