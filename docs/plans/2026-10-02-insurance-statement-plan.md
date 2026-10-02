# Insurance Claim Statement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Reports tab that turns one insurer's treatments for one month into the insurer's claim statement, on screen and as an Excel file laid out exactly like `docs/samples/insurance-statement-nextcare-2026-02.xlsx`.

**Architecture:** Two pure, tested modules (the statement model from ledger rows; the styled workbook from the model), one new patient field (member number per insurer, edited in the patient modal), and one report tab registered through the existing catalog/registry pair. Styling comes from `xlsx-js-style`, dynamically imported on click.

**Tech Stack:** Next.js App Router (client component), Firestore client SDK (one `updateDoc`), `xlsx-js-style` 1.2.0, tsx tests with `node:assert/strict`.

**Spec:** `docs/plans/2026-10-02-insurance-statement-design.md` — the column lists, styles and decisions there are the contract.

## Global Constraints

- Branch `claude/insurance-statement` from `origin/main`, worktree `.claude/worktrees/insurance-statement`; `node_modules` is a junction to the main checkout (which already holds `xlsx-js-style`). Never `cd` to the main checkout.
- Files in this repo are CRLF; new files are written CRLF before commit.
- Arabic strings sit in one place per module (a `TEXT` table), never spliced into JSX.
- Statement text rules (spec): count prefix with no space when `unitsCount > 1` and `pricingMode !== "flat"`; `" رقم "` + teeth joined with `-`; no teeth part for `Gen` or none; FDI → quadrant position digit, primary teeth → letters A–E.
- Nothing in the tab writes to Firestore. The patient modal writes `insurance.<payerId>.memberNumber` only for non-blank values (no `undefined`, no empty-string keys for payers left blank — omit them).
- Tests are `npx tsx tests/<name>.test.mts`; one npm script per suite; run by exit code, not by reading the tail.
- Commit per task; push the branch at the end; the owner merges to `main` (Vercel deploys `main`).

## Review Focus

1. A procedure row whose `description` has no `(T: …)` and no `serviceName` must still produce a line (the procedure text), never an empty cell. Test in Task 1.
2. Two visits of the same patient in one month must be two cases with their own serials, in date order, not merged. Test in Task 1.
3. A row of another payer, of another month, or with status deleted must not appear and must not change the total. Test in Task 1.
4. A patient with no member number must still appear, with an empty bracket omitted (`name` alone), and be counted in the "missing member number" list. Test in Task 1 and Task 4.
5. The written workbook, read back, must have the RTL flag, the per-case merges and the `SUM` formulas in the subtotal and grand-total cells. Test in Task 2.

---

### Task 1: Statement model

**Files:**
- Create: `src/lib/insuranceStatement.ts`
- Create: `tests/insuranceStatement.test.mts`
- Create: `tests/fixtures/insuranceStatement.fixture.ts` — ledger rows that reproduce the sample's first three cases (serials 1–3: `(07B5)محمد حسن اسماعيل` 4800+28; `(9C99)سامح احمد محمد` 30+55; `(5D04)مي محمود محمد توفيق` 30+55+1600), plus: a second visit of patient 5D04 later in the month (serial 4), a row of another payer, a row dated the previous month, a deleted row, a row with no `serviceName` and no teeth, a flat-priced row with units 2 (no count prefix), a primary-tooth row (`(T: 55)` → `E`).
- Modify: `package.json` scripts — add `"test:insurance-statement": "npx tsx tests/insuranceStatement.test.mts"` with a `_comment_` line.

**Interfaces:**
- Produces:
  ```ts
  export type StatementRowLite = { id: string; type?: unknown; payerId?: unknown; patientId?: unknown; patientName?: unknown; date?: unknown; appointmentId?: unknown; status?: unknown; amount?: unknown; cost?: unknown; serviceName?: unknown; description?: unknown; unitsCount?: unknown; pricingMode?: unknown };
  export type StatementLine = { text: string; amount: number; rowId: string };
  export type StatementCase = { serial: number; patientId: string; patientName: string; memberNumber: string; date: string; lines: StatementLine[]; subtotal: number };
  export type Statement = { payerId: string; payerName: string; month: string; cases: StatementCase[]; total: number; missingMemberNumber: Array<{ patientId: string; patientName: string }> };
  export function insurerToothLabel(fdi: number): string;
  export function statementLineText(row: StatementRowLite): string;
  export function caseLabel(c: Pick<StatementCase, "memberNumber" | "patientName">): string;   // "(07B5)محمد حسن اسماعيل" or the name alone
  export function buildInsuranceStatement(args: { rows: StatementRowLite[]; payerId: string; payerName: string; month: string; memberNumbers: ReadonlyMap<string, string> }): Statement;
  ```
- Consumes: `parseLedgerProcedureDescription` from `src/lib/ledgerProcedureParse.ts`; `serviceLabel` from `src/lib/caseSheet.ts` for the name fallback.

- [ ] **Step 1: Write the failing tests** (`tests/insuranceStatement.test.mts`):
  ```ts
  assert.equal(insurerToothLabel(14), "4"); assert.equal(insurerToothLabel(36), "6"); assert.equal(insurerToothLabel(55), "E"); assert.equal(insurerToothLabel(51), "A"); assert.equal(insurerToothLabel(0), ""); assert.equal(insurerToothLabel(NaN), "");
  assert.equal(statementLineText({ id: "a", serviceName: "حشو كمبوزيت", description: "حشو كمبوزيت (T: 15,16) | 560*2=1120", unitsCount: 2, pricingMode: "per_tooth" }), "2حشو كمبوزيت رقم 5-6");
  assert.equal(statementLineText({ id: "b", serviceName: "كشف", description: "كشف (T: Gen) | 30*1=30", unitsCount: 1 }), "كشف");
  assert.equal(statementLineText({ id: "c", serviceName: "تنظيف جير", description: "تنظيف جير (T: Gen) | 550", unitsCount: 2, pricingMode: "flat" }), "تنظيف جير");
  assert.equal(statementLineText({ id: "d", description: "Scaling + Polish (T: 11) | 100=100" }), "Scaling + Polish رقم 1");
  assert.equal(statementLineText({ id: "e", description: "" }), "—");   // never an empty cell
  const s = buildInsuranceStatement({ rows: fixture.rows, payerId: "nextcare", payerName: "Nextcare", month: "2026-02", memberNumbers: fixture.memberNumbers });
  assert.deepEqual(s.cases.map((c) => c.serial), [1, 2, 3, 4]);
  assert.equal(caseLabel(s.cases[0]), "(07B5)محمد حسن اسماعيل");
  assert.deepEqual(s.cases[0].lines.map((l) => [l.text, l.amount]), [["2طربوش زركونيا رقم 4-5", 4800], ["علاج لثه صديديه", 28]]);
  assert.equal(s.cases[0].subtotal, 4828);
  assert.equal(s.cases[2].subtotal, 1685);
  assert.equal(s.cases[3].patientId, s.cases[2].patientId);            // second visit, own case, later date
  assert.ok(s.cases[3].date > s.cases[2].date);
  assert.equal(s.total, 4828 + 85 + 1685 + s.cases[3].subtotal);
  assert.ok(!s.cases.some((c) => c.lines.some((l) => ["other-payer", "last-month", "deleted"].includes(l.rowId))));
  assert.deepEqual(s.missingMemberNumber.map((m) => m.patientId), ["pat-nomember"]);
  assert.equal(caseLabel({ memberNumber: "", patientName: "X" }), "X");
  ```
- [ ] **Step 2: Run** `npm run test:insurance-statement` → fails (module missing).
- [ ] **Step 3: Implement** `src/lib/insuranceStatement.ts`. Grouping key = `patientId + "|" + (appointmentId || date)`; cases sorted by `(date, patientName)`; the case date = min date of its rows. Teeth: parse `(T: …)`, split on `,`, each `Number()` → `insurerToothLabel`, drop blanks; join `-`. Amount = `Number(amount) || Number(cost) || 0`, 2 dp.
- [ ] **Step 4: Run** → passes. **Step 5: Commit** `Insurance statement: the model — cases, lines and totals from ledger rows`.

---

### Task 2: The styled workbook

**Files:**
- Create: `src/lib/insuranceStatementXlsx.ts`
- Modify: `package.json` dependencies — `"xlsx-js-style": "^1.2.0"` (alphabetical, after `xlsx`). `package-lock.json`: run `npm install --package-lock-only --no-audit --no-fund` in the worktree so the lock gains the entry without touching the junctioned `node_modules`.
- Modify: `tests/insuranceStatement.test.mts`

**Interfaces:**
- Produces: `export type StatementHeader = { line1: string; line2: string; line3: string }`, `export function statementToWorkbook(statement: Statement, header: StatementHeader): XLSX.WorkBook` (import `XLSX from "xlsx-js-style"`), `export function statementFileName(statement: Statement): string` → `statement-<payerId>-<month>.xlsx`.
- Layout constants exactly per spec (widths, heights, fonts, fill `938953`, borders, merges, formulas).

- [ ] **Step 1: Failing tests** (append):
  ```ts
  const wb = statementToWorkbook(s, { line1: "DENT INN dental clinic\nد.أحمد رشدي أبو النجا", line2: "برج القاهرة للمبيعات - ميدان السبع عمارات - مصر الجديدة", line3: "01093888153 - 22907666" });
  const ws = wb.Sheets.Sheet1;
  assert.equal(ws.A1.v, "DENT INN dental clinic\nد.أحمد رشدي أبو النجا");
  assert.deepEqual([ws.A4.v, ws.B4.v, ws.C4.v, ws.D4.v], ["المسلسل", "اسم الحالة", "بيان الخدمة", "قيمة الخدمة"]);
  assert.equal(ws.A5.v, 1); assert.equal(ws.B5.v, "(07B5)محمد حسن اسماعيل"); assert.equal(ws.C5.v, "2طربوش زركونيا رقم 4-5"); assert.equal(ws.D5.v, 4800);
  assert.equal(ws.C7.v, "الاجمالي"); assert.equal(ws.D7.f, "SUM(D5:D6)");
  assert.equal(ws.A8.v, 2); assert.equal(ws.D10.f, "SUM(D8:D9)");
  assert.equal(ws.A4.s.fill.fgColor.rgb, "938953"); assert.equal(ws.A4.s.font.sz, 36); assert.equal(ws.A1.s.border.top.style, "medium"); assert.equal(ws.C5.s.font.sz, 20); assert.equal(ws.C7.s.font.sz, 22);
  const merges = ws["!merges"].map((m) => XLSX.utils.encode_range(m));
  for (const m of ["A1:D1", "A2:D2", "A3:D3", "A5:A7", "B5:B7", "A8:A10", "B8:B10"]) assert.ok(merges.includes(m), m);
  const last = XLSX.utils.decode_range(ws["!ref"]).e.r;   // footer spans 4 rows, A:C merged and D merged
  assert.ok(merges.includes(XLSX.utils.encode_range({ s: { r: last - 3, c: 0 }, e: { r: last, c: 2 } })));
  const totalCell = ws[XLSX.utils.encode_cell({ r: last - 3, c: 3 })];
  assert.ok(totalCell.f.startsWith("SUM(") && totalCell.f.includes("D7") && totalCell.f.includes("D10"));
  assert.deepEqual(ws["!cols"].map((c) => c.wch), [19.1, 45, 63.9, 44.3]);
  assert.equal(wb.Workbook.Views[0].RTL, true);
  const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  assert.equal(back.Workbook?.Views?.[0]?.RTL, true);
  assert.equal(back.Sheets.Sheet1.D7.f, "SUM(D5:D6)");
  assert.equal(statementFileName(s), "statement-nextcare-2026-02.xlsx");
  ```
- [ ] **Step 2: Run** → fails. **Step 3: Implement** with cell objects `{ v, t, s }` and `{ f, t: "n", s }`; build an `aoa`, then set `!merges`, `!cols`, `!rows` (row 1: 90, row 2: 45.8, row 3: 35.2, others 14.2 → omit), `wb.Workbook = { Views: [{ RTL: true }] }`, sheet `Sheet1`. Grand total formula = `SUM(` + every subtotal cell joined by `,` + `)`.
- [ ] **Step 4: Run** → passes; `npx tsc --noEmit -p tsconfig.json | grep -i insurance` clean. **Step 5: Commit** `Insurance statement: the workbook in the insurer's layout`.

---

### Task 3: Member number on the patient

**Files:**
- Modify: `src/app/(dashboard)/patients/[id]/page.tsx` — state `editInsurance: Record<string, string>` next to `editMedicalHistory` (line ~239); hydrate from `data.insurance?.[payerId]?.memberNumber` in the snapshot effect (near line 337); in `handleUpdate` add `insurance: <map of non-blank entries>` to the `updateDoc` payload (near line 579); in the modal, after the Medical history block (line ~2143), a section "Insurance member numbers / أرقام عضوية التأمين" with one input per `payers.filter(p => p.id !== PRIVATE_PAYER_ID && p.active)`, hidden entirely when there are none. `const { payers } = usePricingPolicy();` added to the page.
- Create: `src/lib/patientInsurance.ts` — pure: `export type PatientInsurance = Record<string, { memberNumber: string }>`, `export function readMemberNumbers(patient: Record<string, unknown>): Record<string, string>`, `export function writeInsurance(edits: Record<string, string>): PatientInsurance` (trims, drops blanks).
- Modify: `tests/insuranceStatement.test.mts` — tests for the two pure helpers.

**Interfaces:** Consumes `usePricingPolicy` (`payers: Payer[]`), `PRIVATE_PAYER_ID` from `src/lib/payers.ts`.

- [ ] **Step 1: Failing tests:** `readMemberNumbers({ insurance: { nextcare: { memberNumber: " 07B5 " }, axa: {} } })` → `{ nextcare: "07B5" }`; `readMemberNumbers({})` → `{}`; `writeInsurance({ nextcare: " 07B5 ", axa: "   " })` → `{ nextcare: { memberNumber: "07B5" } }`.
- [ ] **Step 2: Run** → fails. **Step 3: Implement** helper and page edits. **Step 4: Run** → passes; `tsc` clean; `npx eslint` on the page shows no new warnings.
- [ ] **Step 5: Commit** `Patients: a member number per insurer, for claim statements`.

---

### Task 4: The report tab

**Files:**
- Create: `src/components/reports/InsuranceStatementReport.tsx`
- Modify: `src/lib/reports/catalog.ts` — after the `payers` line: `{ id: "insurance", group: "money", en: "Insurance Statement", ar: "كشف حساب التأمين", hintEn: "One insurer, one month, in the insurer's own layout.", hintAr: "شركة تأمين واحدة، شهر واحد، بالشكل اللي الشركة عايزاه.", needs: [] }`.
- Modify: `src/components/reports/registry.tsx` — import `FileSpreadsheet` and the component; `insurance: { icon: FileSpreadsheet, render: (p) => <InsuranceStatementReport {...p} payers={p.payers} /> }` after `payers`.
- Modify: `src/components/reports/types.ts` — add optional `setRange?: (range: DateRange) => void` to `ReportProps`; `src/app/(dashboard)/reports/page.tsx` — pass `setRange` in the `report.render({...})` call.

**Component:** props `ReportProps & { payers: Payer[] }`. State: `payerId` (first active non-private payer), `month` (`range.start.slice(0, 7)`), header lines (localStorage key `insurance-statement-header:<clinicId>`, prefilled from `clinic`'s profile — read `getClinicProfile()` once; fall back to blank). On month change: `setRange?.({ start: `${m}-01`, end: lastDayOf(m) })`. Member numbers: `new Map(allPatients.map(p => [p.id, readMemberNumbers(p)[payerId] || ""]))`. Statement = `buildInsuranceStatement({ rows: procedures, payerId, payerName, month, memberNumbers })`. Render: controls row; three header inputs (line 1 is a textarea, two rows); a notice listing patients missing a member number with links to `/patients/<id>`; the preview table; the Excel button → `const XLSX = (await import("xlsx-js-style")).default; XLSX.writeFile(statementToWorkbook(statement, header), statementFileName(statement))`. Empty states: no insurers configured (link to `/settings/payers`); no rows for that insurer in that month. All strings in a `TEXT` const with `en`/`ar`.

- [ ] **Step 1:** add the catalog line first and run `npm run test:settings`, `npx tsx tests/featureCatalog.test.mts` (if a reports catalogue test exists under tests/, run it: `ls tests | grep -i report`) → note any that now fail for the missing renderer.
- [ ] **Step 2: Implement** the four edits and the component.
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json` clean; eslint clean on the new file.
- [ ] **Step 4: Verify in the browser.** Add to `.claude/launch.json` (main checkout's file is used by the app; add an entry `insurance-worktree` → `npx next dev -p 3123 .claude/worktrees/insurance-statement`). On the demo or owner clinic (`?clinic=`), Settings → Payers must have at least one insurer; if the owner's clinic has none, add one named "Nextcare" with its own price list, price two services, record two treatments on a patient under it, and set the patient's member number in the modal. Then Reports → Money → Insurance Statement: pick Nextcare and the month → preview shows the case → press Excel → open the file next to the sample. Screenshot the preview and the opened file.
- [ ] **Step 5: Commit** `Reports: Insurance Statement tab — one insurer, one month, the insurer's layout`.

---

### Task 5: Ship

- [ ] Run `npm run test:insurance-statement`, `test:payers`, `test:cases`, `test:settings`, `test:permissions`, `test:excel-backup` (if present on main; skip if not) by exit code; `npx tsc --noEmit`.
- [ ] `git push -u origin claude/insurance-statement`.
- [ ] Report to the owner in plain words: where the tab is, what to fill (member numbers), what the file looks like, and that the Android patient editor still lacks the member-number field (owed with the next APK).
