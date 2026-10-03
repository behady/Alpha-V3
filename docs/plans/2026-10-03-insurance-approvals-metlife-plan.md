# Insurance Approvals (MetLife) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload a scanned MetLife pre-approval, have the server read it, confirm it on screen, save it as a claim against the right patient, and export the month's claims as the clinic's 11-column MetLife statement.

**Architecture:** Four pure modules (the MetLife reader: schema, prompt, normalise, checks; the patient matcher; the statement model; the styled workbook), two Admin-SDK routes (read, claims), one new page with four components, and the plumbing every server-written collection in this app already has (rules exclusion, recycle bin, storage path, add-on switch). The ledger is untouched; claims are their own register.

**Tech Stack:** Next.js App Router, Firestore Admin SDK, Firebase Storage, `@google/generative-ai` 0.24 (`gemini-flash-latest`, `responseSchema`), `xlsx-js-style` 1.2.0, tsx tests with `node:assert/strict`.

**Spec:** `docs/plans/2026-10-03-insurance-approvals-metlife-design.md` — field lists, check rules, the sheet's measured layout, and the decisions are the contract. Where this plan names a value, it is copied from there.

## Global Constraints

- Branch `claude/insurance-approvals`, cut from `claude/insurance-statement` after Task 1 rewrites that branch's history (the Nextcare sample and its fixture names). Work in a worktree (`EnterWorktree` / `.claude/worktrees/insurance-approvals`); `node_modules` is a junction to the main checkout (it already holds `xlsx-js-style`). Never `cd` into the main checkout: another session edits it live.
- **Never add a real approval or statement file to the repo.** The samples are `C:\Users\PC\Downloads\METLIFE APPROVAL.pdf` and `C:\Users\PC\Downloads\metlife 2-2026.xlsx`; tests use invented names and numbers. The probe script takes the PDF path as an argument.
- Files are CRLF; write new files CRLF before committing.
- Arabic UI strings live in one `TEXT` table per component, never spliced into JSX.
- Firestore writes to `insurance_claims`, `insurance_docs` and `settings/insurance_wording` happen only in `/api/insurance/*` with the Admin SDK. Never write `undefined` to Firestore (strip it).
- The read is **not charged**: `logAiCreditUsage({ feature: "insurance_read", credits: 0, usage })`.
- Dates in records are `yyyy-mm-dd` strings; the paper's dates are `dd/mm/yyyy`.
- Tests: `npx tsx tests/<name>.test.mts`, one npm script per suite with a `_comment_` line, judged by exit code. `npx tsc --noEmit` and `npx eslint <new files>` clean before each commit that touches `src/`.
- Commit per task; push the branch at the end; the owner merges to `main`.

## Review Focus

1. A PDF whose page 1 is upside down or a phone photo at an angle: the read must still return every line or `null`, never a half table that passes the sum check by luck. Pinned by the probe in Task 7 (the real sample) and by Task 4's "line count vs printed total" hard check.
2. An approval already saved, uploaded again from a second browser tab a second later: exactly one claim exists afterwards. Pinned by the document-id test in Task 8 (`claimDocId`) and the 409 path.
3. A family: two patients with the same certificate and different dependent codes: the matcher must not pick the sibling. Task 5 test.
4. A line approved at fewer units or a lower amount than requested (29 of 216 sample lines): saved, shown as a warning, exported with the approved figure in column K and the requested in J. Tasks 4 and 9 tests.
5. The export range straddling two months (the "2-2026" file ran 26 Jan–27 Feb): the range filter is inclusive on both ends by approval date, and `treated`/`sent` only. Task 9 test.

---

### Task 1: Scrub the real Nextcare sample from the branch and anonymise its fixture

**Files:**
- Rewrite history of: `docs/samples/insurance-statement-nextcare-2026-02.xlsx`, `docs/samples/insurance-statement-generated-example.xlsx` (both removed from every commit)
- Modify: `tests/fixtures/insuranceStatement.fixture.ts` (invented names and member codes), `tests/insuranceStatement.test.mts` (header comment), `src/lib/insuranceStatementXlsx.ts` and `src/lib/insuranceStatement.ts` (comments naming `docs/samples/...`), `docs/plans/2026-10-02-insurance-statement-design.md` (sample location line), `.gitignore` (`docs/samples/` ignored)

**Interfaces:**
- Produces: branch `claude/insurance-approvals` whose history contains no `docs/samples/*.xlsx`.

- [ ] **Step 1: Create the branch and rewrite its history**

```bash
git fetch origin
git checkout -b claude/insurance-approvals claude/insurance-statement
git filter-branch --force --index-filter "git rm --cached --ignore-unmatch docs/samples/insurance-statement-nextcare-2026-02.xlsx docs/samples/insurance-statement-generated-example.xlsx" origin/main..HEAD
git log --all --oneline -- docs/samples | cat
```
Expected: the last command prints nothing on `claude/insurance-approvals` (the old `claude/insurance-statement` ref still has them until Task 12 deletes it).

- [ ] **Step 2: Replace the fixture's real names and codes with invented ones**

In `tests/fixtures/insuranceStatement.fixture.ts`, replace every patient name and 4-char member code with invented values (e.g. `سارة محمد عادل` / `A1B2`) and keep every amount, service name and tooth number, so `EXPECTED_SUBTOTALS` still holds. Edit the test's header comment and the two `src/lib` comments to say "the sample stays outside the repo (it holds real patient names)". Add `docs/samples/` to `.gitignore`.

- [ ] **Step 3: Run the suite**

Run: `npm run test:insurance-statement`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A tests/fixtures/insuranceStatement.fixture.ts tests/insuranceStatement.test.mts src/lib/insuranceStatementXlsx.ts src/lib/insuranceStatement.ts docs/plans/2026-10-02-insurance-statement-design.md .gitignore
git commit -m "Insurance statement: the real sample leaves the repo; fixture uses invented names"
```

---

### Task 2: The `insurance` add-on and the payer's document format and provider code

**Files:**
- Modify: `src/lib/featureCatalog.ts` (new entry after `lab`), `src/lib/subscriptions.ts` (`TIER_LIMITS.insurance` on every tier: `true` for the tiers where `lab` is `true`, `false` where it is `false`), `src/lib/payers.ts`, `src/components/settings/PayersSettings.tsx`
- Test: `tests/featureCatalog.test.mts` (already enforces catalogue = TIER_LIMITS keys), `tests/payers.test.mts`

**Interfaces:**
- Produces: `FeatureKey` includes `"insurance"`; `Payer` gains `format?: "metlife"` and `providerCode?: string`; `parsePayers` keeps both; `export type InsurerFormat = "metlife"`; `export const INSURER_FORMATS: { id: InsurerFormat; label: string }[]`.

- [ ] **Step 1: Write the failing payer tests** in `tests/payers.test.mts`

```ts
const [p] = parsePayers({ payers: [{ id: "metlife", name: "MetLife", active: true, isDefault: false, format: "metlife", providerCode: " DNC8144 " }] });
assert.equal(p.format, "metlife");
assert.equal(p.providerCode, "DNC8144");
const [q] = parsePayers({ payers: [{ id: "x", name: "X", active: true, isDefault: false, format: "bogus" }] });
assert.equal(q.format, undefined, "an unknown format is dropped, not stored");
assert.equal("format" in payersDocFrom([q]).payers[0], false, "no undefined written");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:payers` — Expected: FAIL on `p.format`.

- [ ] **Step 3: Implement** — `format` validated against `INSURER_FORMATS`, `providerCode` trimmed, both omitted when blank, in `parsePayers` and `payersDocFrom`. Catalogue entry: `key: "insurance", group: "modules", labelEn: "Insurance approvals", labelAr: "موافقات التأمين", descEn: "Upload the insurer's approval, the system reads and logs it, and the monthly statement is built from it.", descAr: "ارفع موافقة شركة التأمين، النظام يقرأها ويسجلها، وكشف الشهر يتبني منها."`. In `PayersSettings.tsx`, two fields in the editor beside `nameAr`: a select "Document format" (`—` / MetLife) and a text "Provider code", saved through the same `payers.map`/spread at lines 347–348.

- [ ] **Step 4: Run** `npm run test:payers && npm run test:features && npx tsc --noEmit` — Expected: all exit 0.

- [ ] **Step 5: Commit** `git commit -am "Insurance: the add-on switch, and the payer's document format and provider code"`

---

### Task 3: Storage path, rules, indexes, recycle bin

**Files:**
- Modify: `src/lib/storagePaths.ts`, `tests/storagePaths.test.mjs`, `firestore.rules` (server-only list near line 244 and two `match` blocks beside `xray_reports` at ~654), `firestore.indexes.json`, `src/lib/recycleBin.ts` (`BIN_COLLECTIONS`, `logModuleFor`, the label switch), `src/lib/server/recycleBinStore.ts` (`storagePathsFrom`), `src/app/api/records/delete/route.ts` (`CHILD_COLLECTIONS`)
- Test: `tests/storagePaths.test.mjs`, `tests/recycleBin.test.mjs`

**Interfaces:**
- Produces: `insuranceDocPath(clinicId, docId, filename): string` → `clinics/{clinicId}/insurance_docs/{docId}/{filename}` (filename sanitised to `[A-Za-z0-9._-]`, max 80 chars, extension kept); collections `insurance_claims` and `insurance_docs` readable by clinic members, client-write denied; composite index `insurance_claims(payerId ASC, approvalDate ASC)`; the bin knows `insurance_claims` (`permission: "patients.edit"`, `refFields: ["patientId"]`, module `patients`, label `Approval <approvalNumber> — <patientName>`, storage path from `snapshot.doc.path`); deleting a patient sweeps its claims.

- [ ] **Step 1: Failing tests**

```js
// tests/storagePaths.test.mjs
assert.equal(insuranceDocPath("c1", "d1", "METLIFE APPROVAL.pdf"), "clinics/c1/insurance_docs/d1/METLIFE_APPROVAL.pdf");
assert.throws(() => insuranceDocPath("", "d1", "a.pdf"));
assert.throws(() => insuranceDocPath("c1", "../x", "a.pdf"));
// tests/recycleBin.test.mjs — the existing loop over BIN_COLLECTIONS covers the new entry; add:
assert.equal(binLabel("insurance_claims", { approvalNumber: "D6000001", patientName: "Test" }), "Approval D6000001 — Test");
assert.deepEqual(storagePathsFrom("insurance_claims", { doc: { path: "clinics/c/insurance_docs/d/a.pdf" } }), ["clinics/c/insurance_docs/d/a.pdf"]);
```
(use the label function's real exported name from `recycleBin.ts`'s switch at line ~345.)

- [ ] **Step 2: Run** `npm run test:storage && npm run test:recyclebin` — Expected: FAIL (not exported).

- [ ] **Step 3: Implement** the path helper (same `requireClinic`/`requireSegment` guards as `botMediaPath`), the rules (copy the `xray_reports` block twice, add both names to the `sub !=` list), the index, the bin entries, and `"insurance_claims"` in `CHILD_COLLECTIONS`.

- [ ] **Step 4: Run** `npm run test:storage && npm run test:recyclebin && npm run test:permissions && npx tsc --noEmit` — Expected: exit 0. Run `npm run test:rules` if the emulator is available; otherwise note it in the commit body.

- [ ] **Step 5: Commit** `git commit -am "Insurance: storage path, server-only claim collections, index, recycle bin"`

---

### Task 4: The MetLife reader — schema, prompt, normalise, checks

**Files:**
- Create: `src/lib/insurance/metlife.ts`, `tests/insuranceMetlife.test.mts`, `tests/fixtures/insuranceMetlife.fixture.ts`
- Modify: `package.json` (`"test:insurance-metlife": "npx tsx tests/insuranceMetlife.test.mts"` + `_comment_`)

**Interfaces:**
- Produces:
```ts
export type MetlifeLine = { code: string; description: string; unitsRequested: number; grossPerUnit: number; grossTotal: number; unitsApproved: number; patientShare: number; approvedAmount: number; comment: string; confidence: number };
export type MetlifeHeader = { approvalNumber: string; approvalDate: string | null; policyNumber: string; employer: string; certificateNumber: string; dependentCode: string; paperPatientName: string; providerCode: string; physician: string; statusText: string; diagnosisCode: string; estimatedCost: number | null; requestedTotal: number | null; approvedTotal: number | null; patientShareTotal: number | null; collectNote: number | null; terminationDate: string | null; comment: string; confidence: Record<string, number> };
export type MetlifeExtraction = { header: MetlifeHeader; lines: MetlifeLine[] };
export type Check = { id: string; severity: "hard" | "soft"; field: string; en: string; ar: string };
export const METLIFE_FORMAT = "metlife";
export const APPROVAL_NUMBER_RE = /^D\d{7}$/;
export const METLIFE_RESPONSE_SCHEMA: object;            // plain data, SchemaType names as strings (as xrayReport.ts does)
export function buildMetlifePrompt(): string;
export function parseMetlifeDate(s: unknown): string | null;   // "03/10/2026" → "2026-10-03"; "9999-12-31" → "9999-12-31"; junk → null
export function parseMoney(s: unknown): number | null;         // "1,260.0" → 1260; 60 → 60; "" → null
export function normalizeMetlife(raw: unknown): MetlifeExtraction;
export function checkMetlife(x: MetlifeExtraction, ctx: { today: string; providerCode?: string; matchedPatientName?: string; nameScore?: number }): Check[];
export function hasHardFailure(checks: Check[]): boolean;
```
- Fixture: `SAMPLE_RAW` — the model-shaped JSON for an invented approval with the sample's *structure*: 5 lines (`D0120` 1×60, `D0270` 1×60, `D2650` 1×600, `D3120` 1×300, `D4220` 1×240), totals 1260/1260/0, policy `"6481234567 - EXAMPLE TRAVEL"`, provider `"DNC0001 - DR. EXAMPLE - DENTAL"`, status `AUTO APPROVED`, date `"03/10/2026"`, name `"EXAMPLE PATIENT NAME"`, certificate `"987"`, dependent `"1"`.

- [ ] **Step 1: Failing tests** (`tests/insuranceMetlife.test.mts`, sections 1–3)

```ts
assert.equal(parseMetlifeDate("03/10/2026"), "2026-10-03");
assert.equal(parseMetlifeDate("01/01/1900"), "1900-01-01");
assert.equal(parseMetlifeDate("10-03-2026"), null);
assert.equal(parseMoney("1,260.0"), 1260);
assert.equal(parseMoney(" - "), null);
const x = normalizeMetlife(SAMPLE_RAW);
assert.equal(x.header.policyNumber, "6481234567"); assert.equal(x.header.employer, "EXAMPLE TRAVEL");
assert.equal(x.header.providerCode, "DNC0001"); assert.equal(x.header.physician, "DR. EXAMPLE - DENTAL");
assert.equal(x.header.approvalDate, "2026-10-03"); assert.equal(x.lines.length, 5); assert.equal(x.lines[2].code, "D2650");
assert.deepEqual(checkMetlife(x, { today: "2026-10-03", providerCode: "DNC0001" }), [], "the clean sample passes");
// each hard rule, by mutating a copy:
hard(x, h => (h.approvalNumber = "D69257"), "approval_number");
hard(x, h => (h.approvalDate = "2026-10-09"), "approval_date_future");     // today + 1 is still fine
hardLines(x, l => (l[0].grossTotal = 61), "line_gross");                   // 1 × 60 ≠ 61
hardLines(x, l => (l[4].approvedAmount = 200), "approved_total");          // sum 1220 ≠ printed 1260
hard(x, h => (h.certificateNumber = ""), "certificate");
soft(x, h => (h.statusText = "PENDING"), "status");
soft(x, h => (h.providerCode = "DNC9999"), "provider_code");
soft(x, h => (h.confidence.approvalNumber = 0.5), "low_confidence");
softLines(x, (l, h) => { l[2].approvedAmount = 500; h.approvedTotal = 1160; }, "reduced");   // totals still add up, so only the soft check fires
assert.equal(hasHardFailure(checkMetlife(xNoLines, ctx)), true);
```
(`hard`/`soft` helpers assert that exactly one check with that `id` and severity appears.)

- [ ] **Step 2: Run** `npm run test:insurance-metlife` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/insurance/metlife.ts`. Prompt content per the spec's reader section (scanned MetLife Egypt dental pre-approval, skew, dd/mm/yyyy, `9999-12-31` = no end, `-`/blank = empty, copy the table row by row, `null` over guessing, confidence 0–1 per field and line). Checks: ids `approval_number`, `approval_date`, `approval_date_future`, `no_lines`, `line_gross`, `requested_total`, `approved_total`, `patient_share_total`, `certificate`, `dependent` (hard); `status`, `provider_code`, `low_confidence` (< 0.7, one check per field), `reduced` (per line), `name_mismatch` (`nameScore < 0.5` when a patient is matched) (soft). Money comparisons ±0.01. A `null` printed total skips its sum check and raises `low_confidence` for that field instead.

- [ ] **Step 4: Run** `npm run test:insurance-metlife && npx tsc --noEmit && npx eslint src/lib/insurance/metlife.ts` — Expected: exit 0.

- [ ] **Step 5: Commit** `git add src/lib/insurance/metlife.ts tests/insuranceMetlife.test.mts tests/fixtures/insuranceMetlife.fixture.ts package.json && git commit -m "Insurance: the MetLife reader — schema, prompt, normalise, checks"`

---

### Task 5: The patient matcher

**Files:**
- Create: `src/lib/insurance/matchPatient.ts`
- Modify: `src/lib/patientInsurance.ts` (MetLife identity helpers), `tests/insuranceMetlife.test.mts` (section 4)

**Interfaces:**
- Consumes: `readMemberNumbers` (branch).
- Produces:
```ts
// patientInsurance.ts
export type PatientInsuranceEntry = { memberNumber: string; certificateNumber?: string; dependentCode?: string; policyNumber?: string };
export function metlifeMemberNumber(certificate: string, dependent: string): string;   // "987/1"
export function readInsurance(patient: Record<string, unknown>): Record<string, PatientInsuranceEntry>;
// matchPatient.ts
export type PatientLite = { id: string; name: string; insurance?: unknown };
export type PatientMatch = { kind: "exact"; patientId: string } | { kind: "candidates"; candidates: { patientId: string; name: string; score: number }[] } | { kind: "none" };
export function latinSkeleton(name: string): string[];                 // tokens; Arabic letters mapped to Latin, vowels and doubles dropped
export function nameSimilarity(a: string, b: string): number;          // matched tokens / max token count, 0..1
export function matchPatient(x: { payerId: string; certificateNumber: string; dependentCode: string; paperPatientName: string }, patients: PatientLite[]): PatientMatch;
```

- [ ] **Step 1: Failing tests**

```ts
assert.deepEqual(latinSkeleton("NADER MAGED SALEM"), ["ndr", "mgd", "slm"]);
assert.deepEqual(latinSkeleton("نادر ماجد سالم"), ["ndr", "mgd", "slm"]);
assert.deepEqual(latinSkeleton("محمود محمد"), ["mhmd", "mhmd"]);
assert.ok(nameSimilarity("AHMED MOHAMED ALI", "أحمد محمد علي") >= 0.99);
assert.ok(nameSimilarity("AHMED MOHAMED ALI", "سارة فتحي") < 0.2);
const fam = [
  { id: "p1", name: "ليلى خالد فهمي", insurance: { metlife: { memberNumber: "8700001/3", certificateNumber: "8700001", dependentCode: "3" } } },
  { id: "p2", name: "عمر خالد فهمي",  insurance: { metlife: { memberNumber: "8700001/2", certificateNumber: "8700001", dependentCode: "2" } } },
  { id: "p3", name: "نادر ماجد سالم" },
];
assert.deepEqual(matchPatient({ payerId: "metlife", certificateNumber: "8700001", dependentCode: "2", paperPatientName: "OMAR KHALED FAHMY" }, fam), { kind: "exact", patientId: "p2" });
const m = matchPatient({ payerId: "metlife", certificateNumber: "987", dependentCode: "1", paperPatientName: "NADER MAGED SALEM" }, fam);
assert.equal(m.kind, "candidates"); assert.equal(m.candidates[0].patientId, "p3");
assert.equal(matchPatient({ payerId: "metlife", certificateNumber: "9", dependentCode: "9", paperPatientName: "ZZZ QQQ" }, fam).kind, "none");
assert.equal(metlifeMemberNumber("987", "1"), "987/1");
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement.** Letter map for the skeleton: ا/أ/إ/آ/ع/ة→a, ب→b, ت/ط/ث→t, ج→g, ح/ه/خ→h, د/ض→d, ذ/ز→z, ر→r, س/ص→s, ش→sh, غ→gh, ف→f, ق/ك→k, ل→l, م→m, ن→n, و→w, ي/ى→y, ء→nothing; strip Arabic diacritics; lowercase; then drop `a e i o u y w`, collapse doubled letters, drop empty tokens. `matchPatient`: exact when a patient's `insurance[payerId].certificateNumber + dependentCode` equal the paper's; else candidates = patients with `nameSimilarity ≥ 0.5`, top 3 by score; else `none`. `readInsurance` keeps the branch's `readMemberNumbers` behaviour and adds the three optional fields.

- [ ] **Step 4: Run** `npm run test:insurance-metlife && npm run test:insurance-statement && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 5: Commit** `git commit -am "Insurance: the patient matcher — certificate + dependent, then a transliteration-tolerant name"`

---

### Task 6: MetLife boxes in the patient editor

**Files:**
- Modify: `src/app/(dashboard)/patients/[id]/page.tsx` (the insurance member-number inputs added by the branch at ~345 and ~588), `src/lib/patientInsurance.ts` (`writeInsurance` accepts the entry shape)

**Interfaces:**
- Consumes: `Payer.format`, `metlifeMemberNumber`, `readInsurance`.
- Produces: `writeInsurance(edits: Record<string, PatientInsuranceEntry | string>): PatientInsurance` — a string is a plain member number (unchanged behaviour); an entry with `certificateNumber`+`dependentCode` derives `memberNumber`.

- [ ] **Step 1: Failing test** (append to `tests/insuranceMetlife.test.mts`)

```ts
assert.deepEqual(writeInsurance({ metlife: { certificateNumber: " 987 ", dependentCode: "1", policyNumber: "6481234567", memberNumber: "" } }), { metlife: { memberNumber: "987/1", certificateNumber: "987", dependentCode: "1", policyNumber: "6481234567" } });
assert.deepEqual(writeInsurance({ nextcare: "A1B2", metlife: { certificateNumber: "", dependentCode: "", memberNumber: "" } }), { nextcare: { memberNumber: "A1B2" } });
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** `writeInsurance`, then in the patient page: for a payer with `format === "metlife"` render three inputs (policy number, certificate number, dependent code) instead of the single member-number box; state holds the entry shape.

- [ ] **Step 4: Run** `npm run test:insurance-metlife && npx tsc --noEmit` — exit 0. Open a patient on the demo clinic, save the three boxes, reload, see them persisted (the dev server through `preview_start`).

- [ ] **Step 5: Commit** `git commit -am "Patient editor: MetLife policy, certificate and dependent boxes"`

---

### Task 7: `POST /api/insurance/read` and the probe

**Files:**
- Create: `src/app/api/insurance/read/route.ts`, `scripts/probe-insurance-read.mjs`
- Modify: `package.json` (`"probe:insurance-read": "node scripts/probe-insurance-read.mjs"`)

**Interfaces:**
- Consumes: `requireStaffUser`, `clinicHasFeature(clinicId, "insurance")`, `adminBucket()`, `adminClinicCollection`, `parsePayers`, `METLIFE_RESPONSE_SCHEMA`, `buildMetlifePrompt`, `normalizeMetlife`, `checkMetlife`, `matchPatient`, `createUsageMeter`, `logAiCreditUsage`, `insuranceDocPath` (prefix check only).
- Produces: request `{ clinicId, payerId, docId, docPath }` → `200 { ok: true, docId, format: "metlife", extraction, checks, match, duplicate: { claimId, savedAt } | null, wording: Record<code, string | null> }`; `400` bad input / not a PDF or image / > 8 MB; `403` permission, add-on, payer without a format; `404` file; `502 { ok: false, error, retryable: true }` model failure (the file stays). Writes `insurance_docs/{docId}` `{ path, contentType, bytes, pages: number | null, payerId, uploadedAt, uploadedBy, claimId: null }`.

- [ ] **Step 1: Write the probe** `scripts/probe-insurance-read.mjs <email> <clinicId> <payerId> <pdfPath>`: mints a custom token as `probe-xray-reports-as-user.mjs` does, uploads the file with the client SDK to `insuranceDocPath(clinicId, randomUUID(), basename)`, posts to `${PROBE_BASE_URL ?? "http://localhost:3000"}/api/insurance/read`, prints the extraction, every check, and the match; exits 1 if any hard check is present.

- [ ] **Step 2: Run it** against the dev server before the route exists — Expected: HTTP 404 printed, exit 1.

- [ ] **Step 3: Implement the route.** Order: body validation → `requireStaffUser` + (`isFullAccessRole` or `patients.edit`) → add-on → payer lookup from `settings/payers`, `format` required → `docPath` must start with `clinics/${clinicId}/insurance_docs/${docId}/` → `adminBucket().file(path).download()` (≤ 8 MB; mime from the file's metadata, `application/pdf` or `image/*`) → `generateContent([{ text: prompt }, { inlineData: { data, mimeType } }])` with `responseMimeType: "application/json"`, `responseSchema`, 80 s timeout, `gemini-flash-latest` → `JSON.parse` → normalise → load the clinic's patients (`id`, `name`, `insurance`) → match → checks (with the matched name's score and the payer's `providerCode`) → duplicate lookup `insurance_claims/${claimDocId("metlife", approvalNumber)}` → wording from `settings/insurance_wording` → write `insurance_docs/{docId}` → log usage with 0 credits → respond. `maxDuration = 90`, `runtime = "nodejs"`.

- [ ] **Step 4: Run the probe with the real sample** `npm run probe:insurance-read -- <your email> <demo clinic id> metlife "C:\Users\PC\Downloads\METLIFE APPROVAL.pdf"` — Expected: exit 0; approval number `D6000001`, five lines, totals 1260/1260/0, no hard checks. If the model misreads a field, adjust the prompt (not the checks) and re-run until it passes three times in a row.

- [ ] **Step 5: Commit** `git add src/app/api/insurance/read/route.ts scripts/probe-insurance-read.mjs package.json && git commit -m "Insurance: the read route — Gemini reads the scan, checks run, nothing is saved yet"`

---

### Task 8: `POST`/`PATCH /api/insurance/claims` and the claim record

**Files:**
- Create: `src/lib/insurance/claims.ts`, `src/app/api/insurance/claims/route.ts`
- Modify: `tests/insuranceMetlife.test.mts` (section 5)

**Interfaces:**
- Produces:
```ts
// claims.ts (pure)
export const CLAIMS_COLLECTION = "insurance_claims"; export const DOCS_COLLECTION = "insurance_docs"; export const WORDING_DOC = "insurance_wording";
export type ClaimStatus = "approved" | "treated" | "sent" | "cancelled";
export type InsuranceClaim = { id: string; payerId: string; insurer: "metlife"; approvalNumber: string; approvalDate: string; status: ClaimStatus; treatedDate: string | null; patientId: string; patientName: string; paperPatientName: string; metlife: Omit<MetlifeHeader, "approvalNumber" | "approvalDate" | "paperPatientName" | "confidence">; lines: MetlifeLine[]; totals: { requested: number; approved: number; patientShare: number }; doc: { path: string; contentType: string; bytes: number; pages: number | null } };
export function claimDocId(insurer: string, approvalNumber: string): string;   // "metlife_d6000001"; strips non-alphanumerics
export function claimFromExtraction(args: { payerId: string; extraction: MetlifeExtraction; patientId: string; patientName: string; status: ClaimStatus; treatedDate: string | null; doc: InsuranceClaim["doc"] }): Omit<InsuranceClaim, "id">;
export function parseClaim(id: string, raw: unknown): InsuranceClaim | null;
```
- Route: `POST { clinicId, docId, payerId, extraction, patient: { id } | { create: { name: string; phone?: string } }, status: "approved" | "treated", treatedDate?: string, wording?: Record<code, string> }` → `201 { ok: true, claimId, patientId }` or `409 { ok: false, duplicate: { claimId, savedAt } }`. `PATCH { clinicId, claimId, patch: { status?, treatedDate?, patientId?, lines?, metlife? } }` → `200 { ok: true }`. Both: same auth as Task 7; the create runs in a transaction that fails if the claim doc exists; sets `insurance_docs/{docId}.claimId`; writes `patients/{id}.insurance.{payerId}` when missing or different; merges `wording` into `settings/insurance_wording.{metlife}` (only codes not already present); `status: "sent"` stamps `sentAt`; every write stamps `updatedAt`/`updatedBy`; `stripUndefined` from `recycleBinStore` on every payload.

- [ ] **Step 1: Failing tests**

```ts
assert.equal(claimDocId("metlife", " D6000001 "), "metlife_d6000001");
assert.equal(claimDocId("metlife", "D-69/257.66"), "metlife_d6000001");
const c = claimFromExtraction({ payerId: "metlife", extraction: normalizeMetlife(SAMPLE_RAW), patientId: "p3", patientName: "نادر ماجد سالم", status: "treated", treatedDate: "2026-10-03", doc });
assert.equal(c.approvalDate, "2026-10-03"); assert.deepEqual(c.totals, { requested: 1260, approved: 1260, patientShare: 0 });
assert.equal(JSON.stringify(c).includes("undefined"), false);
assert.equal(parseClaim("x", { ...c, status: "bogus" }), null);
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** both files. **Step 4: Run** `npm run test:insurance-metlife && npx tsc --noEmit && npx eslint src/lib/insurance src/app/api/insurance` — exit 0. Extend the probe with `--save` to post the extraction to the claims route, then post it again and assert the second answer is 409; run it on the demo clinic.

- [ ] **Step 5: Commit** `git add -A src/lib/insurance/claims.ts src/app/api/insurance/claims scripts/probe-insurance-read.mjs tests && git commit -m "Insurance: the claims route — one document per approval number, patient linked, wording learned"`

---

### Task 9: The MetLife statement model

**Files:**
- Create: `src/lib/insuranceStatementMetlife.ts`
- Modify: `tests/insuranceMetlife.test.mts` (section 6)

**Interfaces:**
- Produces:
```ts
export type MetlifeStatementLine = { text: string; count: number; requested: number; approved: number };
export type MetlifeStatementCase = { serial: number; patientName: string; policyNumber: string; certificateNumber: string; dependentCode: string; approvalNumber: string; date: string; lines: MetlifeStatementLine[]; subtotal: number };
export type MetlifeStatement = { from: string; to: string; cases: MetlifeStatementCase[]; total: number; missingWording: string[]; heldBack: number };
export const DEFAULT_METLIFE_WORDING: Record<string, string>;   // D0120 كشف, D0270 اشعه عاديه, D2650 حشو كمبوزيت, D3120 بطانه كالسيوم, D4220 علاج لثه صديديه
export function buildMetlifeStatement(args: { claims: InsuranceClaim[]; from: string; to: string; wording: Record<string, string> }): MetlifeStatement;
```

- [ ] **Step 1: Failing tests** — fixture: four claims: A (`2026-01-28`, treated), B (`2026-02-27`, sent), C (`2026-02-28`, approved — held back), D (`2026-01-25`, treated — outside), plus one line with `D9999` (no wording) and one reduced line (requested 2700, approved 500).

```ts
const s = buildMetlifeStatement({ claims: [C, A, D, B], from: "2026-01-26", to: "2026-02-27", wording: DEFAULT_METLIFE_WORDING });
assert.deepEqual(s.cases.map(c => c.approvalNumber), [A.approvalNumber, B.approvalNumber]);
assert.deepEqual(s.cases.map(c => c.serial), [1, 2]);
assert.equal(s.heldBack, 1);
assert.deepEqual(s.missingWording, ["D9999"]);
assert.equal(s.cases[0].lines[0].text, "كشف");
assert.equal(s.cases[1].lines[1].text, "SOME DESCRIPTION", "no wording → the paper's description");
assert.deepEqual([s.cases[1].lines[2].requested, s.cases[1].lines[2].approved], [2700, 500]);
assert.equal(s.total, s.cases[0].subtotal + s.cases[1].subtotal);
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (order by `approvalDate`, then `approvalNumber`; `count = unitsApproved`; subtotal and total to 2 dp). **Step 4: Run** — exit 0. **Step 5: Commit** `git commit -am "Insurance: the MetLife statement model"`

---

### Task 10: The MetLife workbook

**Files:**
- Create: `src/lib/insuranceStatementMetlifeXlsx.ts`
- Modify: `tests/insuranceMetlife.test.mts` (section 7)

**Interfaces:**
- Consumes: `StatementHeader` from `insuranceStatementXlsx.ts`.
- Produces: `metlifeStatementToWorkbook(statement: MetlifeStatement, header: StatementHeader): XLSX.WorkBook`; `METLIFE_TITLES: string[]` (the 11 headings from the spec, in order).

Layout values (spec): widths `[18.8, 35.5, 26.2, 27.8, 19.2, 23.6, 26.0, 40.0, 21.0, 26.1, 29.8]`; header rows 1–3 merged A:K, Arial 22 bold, heights `79.5 / 30.75 / 31.5`, row 1 wraps, thin border; title row 4 height `27.75`, Arial 22 bold, fill `938953`; case rows height `26.25`, A–G merged down the case, Arial 24 bold, A filled `EEECE1`, G a date cell (`t: "d"`, `z: "mm-dd-yy"`), C/D/E numeric when the value is all digits; line cells H–K Arial 20 bold; subtotal row H `الاجمالي`, K `=SUM(K<first>:K<last>)` with cached value, H–K filled `938953`, Arial 20 bold; footer 3 rows: A:F merged `الاجمالي` Arial 48 bold fill `938953`, K merged with `=SUM(<every subtotal cell>)` Arial 24 bold fill `938953`, G–J filled; RTL; sheet `Sheet1`; A4 portrait.

- [ ] **Step 1: Failing tests** (write + `XLSX.read` back, as the Nextcare test does)

```ts
const wb = metlifeStatementToWorkbook(s, { line1: "Clinic", line2: "Address", line3: "Phones" });
const ws = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellStyles: true }).Sheets.Sheet1;
assert.equal(ws["A4"].v, "المسلسل"); assert.equal(ws["K4"].v, "الموافق عليه");
assert.ok(merges(ws).includes("A5:A6"), "case A (two lines) merges A over its rows"); assert.ok(merges(ws).includes("G5:G6"));
assert.equal(ws["K7"].f, "SUM(K5:K6)");
assert.equal(ws["G5"].t, "d"); assert.equal(ws["G5"].z, "mm-dd-yy");
assert.equal(ws["C5"].t, "n");
assert.equal(footerK(ws).f, "SUM(K7,K12)");
assert.equal(ws["!cols"][7].wch, 40);
assert.equal(ws["!rows"][0].hpt, 79.5);
assert.equal(wb.Workbook.Views[0].RTL, true);
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**, reusing the `s`/`n`/`f`/`box`/`centered` helpers' shapes from `insuranceStatementXlsx.ts` (export them from there rather than copying). **Step 4: Run** `npm run test:insurance-metlife && npm run test:insurance-statement` — exit 0. Write a scratch file of the fixture to the scratchpad and open it in Excel beside `metlife 2-2026.xlsx` to compare by eye. **Step 5: Commit** `git commit -am "Insurance: the MetLife statement workbook, cell for cell"`

---

### Task 11: The Insurance page

**Files:**
- Create: `src/app/(dashboard)/insurance/page.tsx`, `src/components/insurance/text.ts`, `src/components/insurance/useClaims.ts`, `src/components/insurance/ApprovalDropZone.tsx`, `src/components/insurance/ApprovalConfirmCard.tsx`, `src/components/insurance/ClaimsTable.tsx`, `src/components/insurance/ClaimsExportBar.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (nav item `{ key: "insurance", href: "/insurance", icon: ShieldCheck }` after `lab`; `NAV_FEATURES.insurance = "insurance"`; in `hasAccess`, `insurance` is shown when `canAccessNavItem("patients", user, isAdmin)`; title map `"/insurance"`: `"التأمين"` / `"Insurance"`), `src/components/reports/InsuranceStatementReport.tsx` (one line + link: "MetLife statements are built from approvals on the Insurance page")

**Interfaces:**
- Consumes: every route and module above; `FeatureGate feature="insurance"`; `PermissionGuard` for `patients.edit`; `useClinic()`; `parsePayers`; `readInsurance`; `StatementHeader` + the branch's localStorage header helpers (export `loadHeader`/`saveHeader` from `InsuranceStatementReport.tsx` into `src/lib/insuranceStatementHeader.ts` and import from both).
- Produces:
  - `useClaims(clinicId, payerId, from, to): { claims: InsuranceClaim[]; loading: boolean }` — `onSnapshot` on `insurance_claims` where `payerId ==` and `approvalDate` between, parsed with `parseClaim`.
  - `ApprovalDropZone({ payer, onRead })`: accepts `.pdf,.jpg,.jpeg,.png`, many; per file: `docId = crypto.randomUUID()`, `uploadBytes(ref(storage, insuranceDocPath(clinicId, docId, file.name)))`, `POST /api/insurance/read`, progress states `uploading → reading → ready | failed(retryable)`; a failed card offers "Try again" and "Type it myself" (an empty extraction with every field blank).
  - `ApprovalConfirmCard({ payer, docId, docUrl, result, patients, onSaved })`: `<object>` for PDF / `<img>` for images; every header and line field editable; checks re-run in the browser with `checkMetlife` on every edit; patient picker (exact → preselected; candidates → radio list + search; none → "create new patient" with name prefilled from the paper); "approved, not treated yet" switch (default off; off ⇒ `status: "treated"`, `treatedDate = approvalDate`); wording boxes for codes whose `wording[code]` is null; Save disabled while `hasHardFailure`; on 409 shows "already saved on … — open".
  - `ClaimsTable({ claims, onPatch, onDelete })`: columns per spec; row actions mark treated / not treated, mark sent, open PDF (`getDownloadURL`), delete (`POST /api/records/delete` with `collection: "insurance_claims"`); editing or deleting a `sent` claim asks "this was already sent to MetLife — continue?" first.
  - `ClaimsExportBar({ claims, from, to, setRange, header, setHeader, wording })`: counts (`heldBack`, `missingWording`), Excel (dynamic `import("@/lib/insuranceStatementMetlifeXlsx")`, file `statement-metlife-<from>-<to>.xlsx`), "Mark all as sent" (PATCH each `treated` claim in the range).
  - Page: payer select (payers with a `format`), range inputs defaulting to the current month, "uploaded, not saved" strip (query `insurance_docs` where `claimId == null`, each opens a confirm card by re-posting to the read route).

- [ ] **Step 1: Build the page and components** per the interfaces; `TEXT` in `text.ts` with `en`/`ar` for every label, including the check messages' fallback.
- [ ] **Step 2: Verify in the browser** (`preview_start`, demo clinic, MetLife payer with `format: "metlife"` set in Settings → Payers): drop the sample PDF, see the card with the scan beside the fields and no red marks, Save, see the row, press Excel, open the file. Drop the same PDF again, see the "already saved" message. Screenshot the card and the list.
- [ ] **Step 3: Run** `npx tsc --noEmit && npx eslint src/components/insurance "src/app/(dashboard)/insurance" && npm run test:insurance-metlife && npm run test:insurance-statement && npm run test:caseSheet` (the last one greps the reports tab list; fix it if the branch moved the array) — exit 0.
- [ ] **Step 4: Commit** `git add -A src/app/\(dashboard\)/insurance src/components/insurance src/app/\(dashboard\)/layout.tsx src/components/reports src/lib/insuranceStatementHeader.ts && git commit -m "Insurance page: drop the approval, confirm what was read, the claims list, the MetLife Excel"`

---

### Task 12: Wrap-up — parity note, help text, push, branch cleanup

**Files:**
- Modify: `docs/plans/2026-10-03-insurance-approvals-metlife-design.md` (status line → built, commit hash), memory `android-parity-gaps.md` (claims list + mark treated owed on the phone), `first-prospect-insurance-dentist.md` (built, branch, what to show him)

- [ ] **Step 1: Full suite** `npm run test:insurance-metlife && npm run test:insurance-statement && npm run test:payers && npm run test:features && npm run test:storage && npm run test:recyclebin && npm run test:permissions && npx tsc --noEmit` — all exit 0; paste the tail of each into the commit body if any was skipped.
- [ ] **Step 2: Push** `git push -u origin claude/insurance-approvals`.
- [ ] **Step 3: Ask the owner** before `git push origin --delete claude/insurance-statement` (its history still holds the real Nextcare sample) — do not delete without a yes. Tell him GitHub keeps unreachable objects for a while and that the sample was public for a day; only GitHub support can purge the cache.
- [ ] **Step 4: Owner checklist** (plain language, in the final message): Settings → Payers → MetLife → Document format MetLife, Provider code `DNC8144`; Insurance page → drop the PDF → check the card → Save → row appears → Excel → compare with his February sheet.
