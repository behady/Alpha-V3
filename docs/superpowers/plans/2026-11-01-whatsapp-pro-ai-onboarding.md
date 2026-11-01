# WhatsApp Pro AI — Plan 4 of 6: onboarding chat and the clinic layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic with the `whatsappPro` add-on can have Pro read its old WhatsApp chats, talk the findings over with the owner in a chat window, and from that conversation write its own **clinic layer** (rules, hand-off cases, never-say phrases, a prompt section) — versioned, editable, rolled back in one click, and published only after a replay test shows it breaks no red line.

**Architecture:** New folder `src/lib/botPro/onboarding/` for the scan, the owner chat and their Firestore store; `src/lib/botPro/layer.ts` for the layer type, its sanitiser and its prompt block; `src/lib/botPro/replay.ts` for the publish test. Everything lives in server-only collections read and written through four API routes (admin SDK), so **no Firestore rule changes**. Pro's reply loop reads the live layer (or, in the test chat only, the draft) and code enforces its never-say list like the other red lines.

**Tech Stack:** Next.js API routes on Vercel, TypeScript, `@google/generative-ai` 0.24.1 (JSON output with `responseSchema`), firebase-admin, tests with `npx tsx` + `node:assert/strict` (pattern: `tests/botProAnswer.test.mts`).

**Spec:** `docs/superpowers/specs/2026-10-31-whatsapp-pro-ai-design.md` §8 (and §3 red lines, §10 step 2 replay). Plan 1 (`docs/superpowers/plans/2026-10-31-whatsapp-pro-ai-core.md`) is built and live.

## Decisions this plan makes (spec §8 leaves them open)

- **Who pays:** onboarding (scan, owner chat, publish test) charges **no clinic credits** during the trial; token usage is added up on the onboarding state for Plan 5's cost report.
- **Scan size:** the 400 most recent conversations by `lastAt`, 12 per step, last 60 messages each, 2,500 characters per chat, phone-like digit runs (7+) replaced by `<رقم>` before anything reaches the model.
- **The scan runs while the owner's page is open** (the page calls "next step" in a loop and shows progress). Closing the page pauses it; reopening resumes.
- **Owner chat cap:** 60 owner messages per clinic per day.
- **Publish test:** every built-in conversation (moved from `scripts/lib/battery-conversations.ts`) plus up to 10 saved `bot_test_cases`, run through Pro with the draft layer, 6 at a time, nothing sent. **Publish is refused** if any delivered reply breaks a red line (independent `checkReply`, including the draft's never-say list) or more than 25% of turns come back `unavailable`. Action mismatches are reported, never blocking.
- **Prices and medicines never live in the layer:** a layer line with a money figure or a medicine name is dropped on save and the owner is told why ("add it to the price list").
- **Rollback:** any published version can be made live again without a new test (it passed when published); "No clinic layer" is also a choice.

## Global Constraints

- Red lines (spec §3) are code, not text: no layer, owner message or prompt section can change `checkReply`, the rulebook, or the booking rules. The layer prompt block says so in its first line.
- `botPro` reads **only** `process.env.GEMINI_PRO_API_KEY`; model `process.env.GEMINI_PRO_MODEL || "gemini-pro-latest"`.
- Every onboarding route: `requireAdminUser(req, clinicId)` and `clinicHasFeature(clinicId, "whatsappPro")`; the client sends `clinicId` in the body/query (memory: reply routes without it fall back to the wrong clinic).
- Server-only collections, written with the admin SDK: `clinics/{id}/pro_onboarding/state` (+ subcollections `findings`, `chat`) and `clinics/{id}/pro_layers/{versionId}`. No `firestore.rules` change, no deploy of rules.
- The old AI is untouched (`aiReply.ts`, `botPrompt.ts`, `rulebookCache.ts`). In `respond.ts` only: pass the playground's `proLayer: "draft"` through to `answerWithPro`, dry run only.
- Firestore rejects `undefined`: every write spreads optional fields conditionally.
- Repo stores CRLF: edits to existing files keep CRLF; no whole-file rewrites.
- Web app only: nothing under `android/` or `functions/`; no gateway or Meta webhook change.
- Tests never use the production key or a clinic's credits; model calls in tests are fakes.

## Review Focus

1. **A clinic with no stored chats** (new, or Meta-only since yesterday): the scan finishes at once with zero chats and the chat window still opens with "tell me about your clinic" — test in Task 4.
2. **Two tabs press "next step" together**: the step lock lets one through; the other gets `busy` and the queue is not processed twice — test in Task 4.
3. **The owner types a price or a medicine into the chat** ("the consult is 300", "tell them to take Augmentin"): the layer keeps neither line, and the AI's answer says why — test in Task 5 (via `sanitizeLayer`, Task 1).
4. **A never-say phrase written with different Arabic spelling** (أ/ا/إ, ة/ه, tashkeel): still caught in the reply — test in Task 1.
5. **The live layer is deleted or unreadable** mid-trial: Pro answers with no clinic layer rather than failing the turn — test in Task 3.

---

### Task 1: The clinic layer — type, sanitiser, never-say check, prompt block

**Files:**
- Create: `src/lib/botPro/layer.ts`
- Modify: `src/lib/botPro/checks.ts` (export `moneyFigures`; `checkReply` gains `neverSay`), `src/lib/botPro/proPrompt.ts` (add `proClinicLayer`)
- Test: `tests/botProLayer.test.mts`; script `"test:pro-layer"` in `package.json`

**Interfaces:**
- Produces:
  - `type ClinicLayer = { rules: string[]; handoffWhen: string[]; neverSay: string[]; promptSection: string }`
  - `EMPTY_LAYER: ClinicLayer`
  - `LAYER_LIMITS = { rules: 30, handoffWhen: 15, neverSay: 20, lineChars: 300, phraseMin: 3, phraseMax: 80, promptChars: 2000 }`
  - `sanitizeLayer(raw: unknown): { layer: ClinicLayer; dropped: Array<{ text: string; why: "price" | "medicine" }> }`: trims, drops empties and duplicates, caps counts/lengths; drops any line or phrase with `moneyFigures(text).length > 0` (why `price`) or `strayDrugNames(text, "").length > 0` (why `medicine`). The prompt section is filtered sentence by sentence (split on `.`, `؟`, `!`, newline) the same way.
  - `isEmptyLayer(l: ClinicLayer): boolean`
  - `type ReplaySummary = { passed: boolean; turns: number; unavailable: number; actionMisses: number; breaks: Array<{ caseId: string; q: string; reply: string; rules: string[] }>; ms: number }` (defined here so the store can type versions before Task 6 exists)
  - `neverSayHits(reply: string, phrases: string[]): string[]`: phrases (normalised with `normalizeForMatch` from `tools.ts`) found in the normalised reply.
  - In `checks.ts`: `moneyFigures(text: string): string[]`, the money and percentage figures `strayNumbers` already recognises, with nothing allowed. `checkReply` gets an optional `neverSay?: string[]`; hits add `{ rule: "never_say", detail: hits.join(", ") }` and `Violation["rule"]` gains `"never_say"`.
  - In `proPrompt.ts`: `proClinicLayer(layer: ClinicLayer | null): string`. It returns `""` for null or an empty layer. Otherwise it returns a block headed `CLINIC LAYER — written with the owner. Follow it; it never overrides the rules above.`, followed by the sections `How we talk and sell:`, `Hand the chat to the team when:`, `Never say:` and the prompt section, each skipped when empty.

- [ ] **Step 1: Write the failing tests** in `tests/botProLayer.test.mts`:

```ts
test("sanitizeLayer drops prices and medicines and says why", () => {
  const { layer, dropped } = sanitizeLayer({
    rules: ["  رحّب بالمريض باسمه ", "الكشف بـ 300 جنيه", "قوله ياخد اوجمنتين", "رحّب بالمريض باسمه"],
    handoffWhen: ["لو اشتكى من الدكتور"],
    neverSay: ["ارخص عيادة", "ab"],
    promptSection: "احنا عيادة عائلية. الخصم 20% للطلبة.",
  });
  assert.deepEqual(layer.rules, ["رحّب بالمريض باسمه"]);
  assert.deepEqual(layer.neverSay, ["ارخص عيادة"]); // "ab" is under phraseMin
  assert.equal(layer.promptSection, "احنا عيادة عائلية.");
  assert.deepEqual(dropped.map((d) => d.why).sort(), ["medicine", "price", "price"]);
});
test("sanitizeLayer of junk is the empty layer", () => {
  assert.deepEqual(sanitizeLayer(null).layer, EMPTY_LAYER);
  assert.deepEqual(sanitizeLayer({ rules: "not a list", neverSay: [5] }).layer, EMPTY_LAYER);
});
test("never-say survives Arabic spelling variants", () => {
  assert.deepEqual(neverSayHits("إحنا أرخص عياده في المنطقة", ["ارخص عيادة"]), ["ارخص عيادة"]);
  assert.deepEqual(neverSayHits("احنا عيادة كويسة", ["ارخص عيادة"]), []);
});
test("checkReply reports never_say", () => {
  const v = checkReply({ question: "بكام؟", reply: "احنا ارخص عيادة", allowed: new Set(), clocks: new Set(), drugsAllowed: "", neverSay: ["ارخص عيادة"] });
  assert.ok(v.some((x) => x.rule === "never_say"));
});
test("proClinicLayer: empty is nothing, full says it cannot override", () => {
  assert.equal(proClinicLayer(null), "");
  assert.equal(proClinicLayer(EMPTY_LAYER), "");
  const block = proClinicLayer({ ...EMPTY_LAYER, rules: ["اقفل البيع بعرض كشف"], neverSay: ["ارخص عيادة"] });
  assert.match(block, /never overrides the rules above/);
  assert.match(block, /اقفل البيع بعرض كشف/);
  assert.ok(!block.includes("Hand the chat to the team when:"), "empty sections are left out");
});
```

- [ ] **Step 2: Run** `npm run test:pro-layer`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `layer.ts`, the `checks.ts` additions and `proClinicLayer` as in Interfaces.
- [ ] **Step 4: Run** `npm run test:pro-layer && npm run test:pro-checks && npm run test:pro-prompt`. Expected: all pass (existing checks/prompt tests unchanged).
- [ ] **Step 5: Commit** `git commit -m "Pro AI: clinic layer type, sanitiser, never-say red line, prompt block"`.

---

### Task 2: Onboarding store and transcript helpers

**Files:**
- Create: `src/lib/botPro/onboarding/store.ts`, `src/lib/botPro/onboarding/transcript.ts`
- Test: `tests/botProOnboarding.test.mts`; script `"test:pro-onboarding"`

**Interfaces:**
- Produces, in `store.ts`:
  - `type ScanStatus = "idle" | "running" | "summarizing" | "done" | "failed"`
  - `type OnboardingState = { scan: { status: ScanStatus; queue: string[]; total: number; done: number; chatsRead: number; lockUntil: number; startedAt?: number; finishedAt?: number; error?: string }; learned: string[]; questions: string[]; draft: ClinicLayer; liveVersion: string | null; nextVersion: number; chatDay: string; chatCount: number; usage: { calls: number; inTok: number; outTok: number } }`
  - `EMPTY_STATE: OnboardingState`
  - `readState(raw: unknown): OnboardingState`: a tolerant parse; missing fields fall back to `EMPTY_STATE`, and the draft goes through `sanitizeLayer`
  - `onboardingStateRef(clinicId)`: `clinics/{id}/pro_onboarding/state`
  - `findingsCol(clinicId)` and `chatCol(clinicId)`: subcollections of the state doc
  - `layerRef(clinicId, versionId)`: `clinics/{id}/pro_layers/{versionId}`
  - `interface OnboardingStore`, the seam every orchestrator uses so tests can fake it:
    - `getState(): Promise<OnboardingState>`
    - `patchState(p: Partial<OnboardingState> | Record<string, unknown>): Promise<void>`
    - `tryLock(ms: number, now: number): Promise<boolean>`: a transaction that succeeds only if `scan.lockUntil <= now`
    - `unlock(): Promise<void>`
    - `recentConversationKeys(max: number): Promise<string[]>`: by `lastAt` desc, skipping `play_` ids and `staffLine === true`
    - `loadConversation(key: string): Promise<RawConversation | null>`
    - `saveFindings(n: number, f: ChunkFindings): Promise<void>`
    - `allFindings(): Promise<ChunkFindings[]>`
    - `addChat(role: "ai" | "owner", text: string): Promise<void>`
    - `recentChat(max: number): Promise<Array<{ role: "ai" | "owner"; text: string }>>`
    - `listVersions(): Promise<LayerVersion[]>`
    - `saveVersion(v: LayerVersion): Promise<void>`
    - `firestoreOnboardingStore(clinicId: string): OnboardingStore`
  - `type LayerVersion = { id: string; version: number; layer: ClinicLayer; createdAt: number; createdBy: string; test: ReplaySummary }`, with `ReplaySummary` from Task 1
- Produces, in `transcript.ts`:
  - `type RawConversation = { key: string; patientId?: string; phone?: string; messages: Array<{ author: string; text: string; at: number }>; appointmentsCreatedAt: number[] }`
  - `maskPhones(text: string): string`: digit runs of 7 or more (Latin or Arabic-Indic digits, spaces and dashes allowed inside) become `<رقم>`
  - `transcriptOf(c: RawConversation, maxChars = 2500): string | null`:
    - lines read `مريض: …`, `الاستقبال: …` (staff) or `البوت: …` (bot)
    - lines starting with `[` are skipped
    - phones are masked
    - the oldest lines are cut first to fit `maxChars`
    - returns `null` without at least one patient line and one clinic (staff or bot) line
  - `bookedAfter(c: RawConversation, days = 14): boolean`: an appointment created within `days` after the first patient message
  - `type ChunkFindings = { faq: string[]; answers: string[]; selling: string[]; facts: string[]; handoffs: string[]; avoid: string[]; chats: number; booked: number }`

- [ ] **Step 1: Write the failing tests:**
  - `maskPhones("كلمني على 0101 234 5678 او ٠١٢٣٤٥٦٧٨٩")` contains no digit run of 7 or more
  - `transcriptOf` returns `null` for a patient-only chat
  - `transcriptOf` labels authors (`patient`→مريض, `staff`→الاستقبال, `bot`→البوت) and skips a `[صورة]` line
  - `transcriptOf` cuts from the oldest line when over `maxChars`
  - `bookedAfter`: true for an appointment 3 days after the first patient line, false for one 20 days after, false for one before the chat
  - `readState(undefined)` deep-equals `EMPTY_STATE`
  - `readState({ scan: { status: "running", queue: ["a"] } })` keeps the queue and fills the rest
- [ ] **Step 2: Run** `npm run test:pro-onboarding`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. In `firestoreOnboardingStore`:
  - `loadConversation` reads the conversation doc and its last 60 `messages` (by `at` desc, then reversed)
  - for `appointmentsCreatedAt`, query appointments by `patientId` when set, else by `patientPhone` `in` the `phoneKeysOf(phone)` variants from `person.ts`; convert `createdAt` (Timestamp, millisecond number or ISO string) to ms and drop anything unreadable
- [ ] **Step 4: Run** `npm run test:pro-onboarding` and `npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Pro AI onboarding: state store and chat transcript helpers"`.

---

### Task 3: Pro answers with the live layer (draft in the test chat)

**Files:**
- Modify: `src/lib/botPro/proContext.ts` (`ProArgs.proLayer`, `ProContext.layer`, loader), `src/lib/botPro/answerWithPro.ts` (system prompt + check), `src/lib/bot/respond.ts` (pass-through, dry run only), `src/app/api/admin/bot-playground/route.ts` (accept `proLayer`), `src/components/settings/BotPlayground.tsx` ("Use the draft layer" toggle next to "Try Pro")
- Test: `tests/botProAnswer.test.mts`, `tests/botProWiring.test.mts`

**Interfaces:**
- Consumes: Task 1 `ClinicLayer`, `sanitizeLayer`, `proClinicLayer`, `checkReply({ neverSay })`; Task 2 `onboardingStateRef(clinicId)` and `layerRef(clinicId, versionId)`.
- Produces:
  - `ProArgs.proLayer?: "draft"`
  - `ProContext.layer: ClinicLayer | null`
  - `loadClinicLayer(clinicId: string, which: "live" | "draft"): Promise<ClinicLayer | null>`, exported from `proContext.ts`:
    - `live` reads `state.liveVersion` and then that `pro_layers` doc's `layer`
    - `draft` reads `state.draft`
    - both run the result through `sanitizeLayer`
    - any read error or missing doc gives `null`
  - `respondToPatientMessage` args gain `proLayer?: "draft"`, honoured only when `dryRun`.
  - Playground body field: `proLayer: "draft"`, honoured only together with `brain: "pro"`.

- [ ] **Step 1: Write the failing tests:**
  - In `botProAnswer.test.mts`, `"the clinic layer is in the prompt and its never-say is enforced"`:
    - give a fake context with `layer: { ...EMPTY_LAYER, neverSay: ["ارخص عيادة"], rules: ["اقفل بعرض كشف"] }`
    - fake model round 1 replies `"احنا ارخص عيادة"`, round 2 replies `"أهلاً بحضرتك"`
    - assert the first `system` string contains `اقفل بعرض كشف`
    - assert round 2's contents carry the rejection
    - assert the result is the round-2 answer
  - In `botProAnswer.test.mts`, `"no layer (null) changes nothing"`: the same reply passes with `layer: null`.
  - In `botProWiring.test.mts`, source assertions:
    - `respond.ts` contains `args.dryRun && args.proLayer`
    - the playground route only forwards `proLayer` when `tryPro`
    - `loadClinicLayer` returns `null` on a thrown read (inject via a small exported `readLayerDocs` seam, or assert the `catch(() => null)` in source if the seam is not worth it)
- [ ] **Step 2: Run** `npm run test:pro-answer && npm run test:pro-wiring`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - `loadProContext` loads the layer in its existing `Promise.all`, with `args.proLayer === "draft" ? "draft" : "live"`
  - `system = rulebook + "\n" + proClinicLayer(ctx.layer) + "\n" + turnLayer`, with the layer block omitted when `""`
  - `check()` passes `neverSay: ctx.layer?.neverSay ?? []`
  - in `respond.ts`'s `answerWithPro({...})` call, add `...(args.dryRun && args.proLayer ? { proLayer: args.proLayer } : {})`
  - the playground and `BotPlayground` send `proLayer: "draft"` when the toggle is on (the toggle shows only while "Try Pro" is on)
- [ ] **Step 4: Run** all `test:pro-*`, `test:bot`, `test:botcases`, and `npx tsc --noEmit -p .`. Expected: pass, tsc exit 0.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: replies follow the clinic's live layer; test chat can try the draft"`.

---

### Task 4: The scan (start, step, summarise)

**Files:**
- Create: `src/lib/botPro/onboarding/jsonModel.ts`, `src/lib/botPro/onboarding/scan.ts`
- Test: `tests/botProOnboarding.test.mts` (add)

**Interfaces:**
- Consumes: Task 2 store, transcript helpers and `ChunkFindings`; Task 1 `sanitizeLayer`.
- Produces:
  - `interface JsonModel { generate(prompt: string, schema: object): Promise<{ json: unknown; usage: { inTok: number; outTok: number } }> }`
  - `geminiProJson(apiKey: string, modelName: string): JsonModel`: `responseMimeType: "application/json"`, `responseSchema`, temperature 0.3
  - `SCAN_MAX_CHATS = 400`, `SCAN_CHUNK = 12`, `STEP_LOCK_MS = 110_000`
  - `startScan(store: OnboardingStore, now: number): Promise<OnboardingState>`: queues `recentConversationKeys(SCAN_MAX_CHATS)`, sets status `running` (or `summarizing` when the queue is empty) with `done: 0`, and clears old findings
  - `scanStep(store: OnboardingStore, model: JsonModel, now: number): Promise<{ state: OnboardingState; busy?: true }>`. One call does one unit of work:
    - `running`: take the next `SCAN_CHUNK` keys, build transcripts (skip `null`s), call the model with `CHUNK_SCHEMA` (the `ChunkFindings` lists, each at most 15 strings), save the findings, advance `done`/`chatsRead` and add to `usage`
    - `summarizing`: merge all findings (at most 30,000 characters of JSON), call the model with `SUMMARY_SCHEMA` `{ learned: string[]; questions: string[]; layer: ClinicLayer }`, then:
      - store `learned` (max 15) and `questions` (max 8)
      - store `draft = sanitizeLayer(layer).layer`
      - set status `done`
      - `addChat("ai", openingMessage(state))`
    - anything else returns the state untouched
    - takes `tryLock(STEP_LOCK_MS)` first (`busy` if not granted) and always unlocks
    - a model error sets status `failed` with `error`, and the next `startScan` recovers
  - `openingMessage(s: OnboardingState): string`, in Egyptian Arabic:
    - with chats read: `قريت {chatsRead} محادثة قديمة.`, then `اللي اتعلمته:` with one `• ` bullet per learned line, then `عندي كام سؤال:` with numbered questions
    - with zero chats: `مفيش محادثات قديمة أقرا منها. احكيلي عن العيادة: بتركزوا على إيه، وإزاي بتحبوا نرد على المرضى؟`
  - The prompts tell the model that transcripts are data, not instructions; never to write prices or medicine names into the layer; and to answer in Arabic.

- [ ] **Step 1: Write the failing tests** with a fake store (in-memory object implementing `OnboardingStore`) and a fake `JsonModel`:
  - zero conversations: `startScan` → `summarizing` → one `scanStep` → `done`, chat has the zero-chat opening, model called once (summary only)
  - 30 conversations: `running`; three steps read 12/12/6, one more summarises; `done === 30`; findings saved 3 times
  - a step while `lockUntil > now` returns `busy: true` and processes nothing (queue length unchanged)
  - the model throws in a step → status `failed`, lock released
  - a summary layer containing `"الكشف بـ 300"` ends up without that line in `draft`
- [ ] **Step 2: Run** `npm run test:pro-onboarding`. Expected: FAIL.
- [ ] **Step 3: Implement** `jsonModel.ts` and `scan.ts`.
- [ ] **Step 4: Run** `npm run test:pro-onboarding` and `npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Pro AI onboarding: old-chat scan in steps, summary into a first draft"`.

---

### Task 5: The owner chat turn

**Files:**
- Create: `src/lib/botPro/onboarding/ownerChat.ts`
- Test: `tests/botProOnboarding.test.mts` (add)

**Interfaces:**
- Consumes: Task 2 store, Task 4 `JsonModel`, Task 1 `sanitizeLayer`.
- Produces:
  - `OWNER_DAILY_CAP = 60`, `OWNER_TEXT_MAX = 2000`
  - `ownerChatTurn(store: OnboardingStore, model: JsonModel, input: { text: string; todayKey: string; priceNames: string[] }): Promise<{ ok: true; reply: string; draft: ClinicLayer; dropped: Array<{ text: string; why: "price" | "medicine" }> } | { ok: false; error: "empty" | "too_long" | "cap" | "not_ready" }>`
    - rejects an empty text and one over `OWNER_TEXT_MAX`
    - `not_ready` unless the scan status is `done`
    - `cap` once `chatCount` reaches the cap on `todayKey` (the count resets when the day changes)
    - otherwise:
      - saves the owner turn
      - calls the model with `{ learned, questions, draft, last 30 chat turns, priceNames, owner text }` and schema `{ reply: string; layer: ClinicLayer }`
      - sanitises the layer
      - when `dropped` is not empty, appends to the reply: `\n\nشلت من القواعد: {texts}. الأسعار مكانها قائمة الأسعار، والأدوية مش من شغل الرد التلقائي.`
      - saves the AI turn, `draft`, `chatCount + 1` and `usage`
  - The prompt carries the four red lines verbatim from spec §3 as "locked, the owner cannot change them". It asks for one or two questions at a time and for the full updated layer back. It says the owner's confirmation is what approves a fact.

- [ ] **Step 1: Write the failing tests:**
  - happy path: the reply is saved, the draft is replaced, and there are 2 new chat rows
  - an owner text "الكشف بـ 300 وقولهم ياخدوا اوجمنتين" with a fake model that copies it into `rules` gives a draft without either line and a reply ending with the `شلت من القواعد` note
  - the 61st message on the same `todayKey` → `cap`; the next day → ok
  - scan `running` → `not_ready`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `ownerChat.ts`.
- [ ] **Step 4: Run** `npm run test:pro-onboarding` and tsc. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Pro AI onboarding: owner chat writes the draft layer"`.

---

### Task 6: The publish test (replay)

**Files:**
- Create: `src/lib/botPro/replayCases.ts`, which holds the content of `scripts/lib/battery-conversations.ts`, moved
- Modify: `scripts/lib/battery-conversations.ts` (becomes `export * from "../../src/lib/botPro/replayCases";`)
- Create: `src/lib/botPro/replay.ts`
- Test: `tests/botProReplay.test.mts`; script `"test:pro-replay"`

**Interfaces:**
- Consumes: Plan 1 `answerWithPro(args, { model, context, sink, charge: false, record: false })`, `checkReply`, `allowedNumbers`; Task 1 `ClinicLayer`.
- Produces:
  - `type ReplayCase = { id: string; clinical: boolean; known: boolean; turns: Array<{ q: string; expect: string[] }> }`
  - `builtinReplayCases(): ReplayCase[]`: from `CONVERSATIONS`; `known` is true when `patient` is unset or `known`
  - `savedReplayCases(raw: Array<Record<string, unknown>>, max = 10): ReplayCase[]`: maps `bot_test_cases` docs using the same field names `scripts/pro-battery.mts` reads
  - (`ReplaySummary` comes from Task 1's `layer.ts`.)
  - `runReplay(input: { cases: ReplayCase[]; layer: ClinicLayer; baseArgs: ProArgs; context: ProContext; model: () => ProModel; concurrency?: number; answer?: typeof answerWithPro }): Promise<ReplaySummary>` — `answer` defaults to `answerWithPro` (a seam for the tests):
    - cases run 6 at a time; turns within a case run in order, with the thread carried along
    - the context gets `layer`
    - each delivered text is re-checked with `checkReply`, including `neverSay: layer.neverSay`
    - `passed = breaks.length === 0 && unavailable <= Math.floor(turns * 0.25)`
  - The known patient and stranger set-ups are the battery's `knownPerson`/`STRANGER`. Move them here as exports, and let `scripts/pro-battery.mts` import them, so there is one copy.

- [ ] **Step 1: Write the failing tests:**
  - a fake model that always replies `"أهلاً بحضرتك"` → `passed: true`, `turns` equals the sum of all turns, `breaks: []`
  - a fake model replying `"احنا ارخص عيادة"` every round with `layer.neverSay = ["ارخص عيادة"]` → Pro's own check hands off → `breaks: []` and the turn is not `unavailable`
  - the independent re-check: inject `answer` returning `{ kind: "answer", text: "احنا ارخص عيادة" }` with that layer → `breaks.length > 0`, `passed: false`
  - a model that throws → every turn `unavailable` → `passed: false`
  - `npm run battery:pro -- --dry` still runs, exit 0 (the move broke nothing)
- [ ] **Step 2: Run** `npm run test:pro-replay`. Expected: FAIL.
- [ ] **Step 3: Implement** the move, `replay.ts`, and the battery import change.
- [ ] **Step 4: Run** `npm run test:pro-replay`, `CLINIC_ID=<demo clinic id from memory demo-clinic> npx tsx scripts/pro-battery.mts --dry` (exit 0), tsc. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: replay test for a clinic layer; battery cases shared with the app"`.

---

### Task 7: The four API routes

**Files:**
- Create:
  - `src/app/api/whatsapp/pro-onboarding/route.ts` (GET state, PUT draft)
  - `src/app/api/whatsapp/pro-onboarding/scan/route.ts` (POST `{ clinicId, action: "start" | "step" }`)
  - `src/app/api/whatsapp/pro-onboarding/chat/route.ts` (POST `{ clinicId, text }`)
  - `src/app/api/whatsapp/pro-onboarding/publish/route.ts` (POST `{ clinicId }` runs the test and publishes; `{ clinicId, makeLive: string | null }` rolls back or switches the layer off)
- Test: `tests/botProOnboardingRoutes.test.mts` (source assertions, like `botProWiring`); script `"test:pro-onboarding-routes"`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces (JSON responses, all `{ ok: boolean, ... }`):
  - GET `?clinicId=` → `{ ok, state: { scan: { status, total, done, chatsRead, error? }, learned, questions, draft, liveVersion }, chat: Array<{ role, text, at }> (last 60), versions: Array<{ id, version, createdAt, createdBy, passed, breaks: number }> }`. Never return `queue`.
  - PUT `{ clinicId, draft }` → `{ ok, draft, dropped }`
  - scan POST → `{ ok, state, busy? }`; `maxDuration = 120`
  - chat POST → `ownerChatTurn` result; `maxDuration = 60`; `priceNames` from the clinic's `services`, the same read as `proContext.priceList`
  - publish POST → `{ ok, published: boolean, versionId?, test: ReplaySummary }`; `maxDuration = 300`:
    - the version id is `v{nextVersion}`
    - saves the `LayerVersion` and sets `liveVersion`
    - increments `nextVersion`
    - refuses with `{ ok: false, error: "empty" }` when the draft is empty
    - uses the scan lock so two publishes can't run together
  - `makeLive`: the version must exist and have `test.passed`; `null` switches the clinic layer off
- All four routes:
  - `runtime = "nodejs"`, `dynamic = "force-dynamic"`
  - `requireAdminUser(req, clinicId)`, then `clinicHasFeature(clinicId, "whatsappPro")` (403 `"Pro AI is not switched on for this clinic."`)
  - `GEMINI_PRO_API_KEY` missing → 503 `"Pro AI key is not set."` (GET and PUT don't need it)
  - each records `logActivity`-style server logs through `logActivityServer` for scan start, publish and rollback

- [ ] **Step 1: Write the failing source-assertion tests:** every route file contains `requireAdminUser(` and `clinicHasFeature(` with `"whatsappPro"`; scan, chat and publish read `GEMINI_PRO_API_KEY` and never `GEMINI_API_KEY`; GET strips `queue`; publish's `maxDuration = 300`; no route calls `logAiCreditUsage` with credits above 0.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the four routes as thin wrappers over the Task 3–6 functions.
- [ ] **Step 4: Run** the route test, all `test:pro-*`, tsc, and `npx eslint src/app/api/whatsapp/pro-onboarding`. Expected: pass, 0 errors.
- [ ] **Step 5: Commit** `git commit -m "Pro AI onboarding: API routes (state, scan, owner chat, publish/rollback)"`.

---

### Task 8: The screen — "Teach Pro your clinic"

**Files:**
- Create: `src/components/whatsapp/ProSetup.tsx` (full-screen dialog)
- Modify: `src/components/settings/WhatsAppSettings.tsx` (button under the Standard/Pro picker, shown when `proInPlan`; mounts `ProSetup`)
- Test: `tests/botProOnboardingRoutes.test.mts` (add source assertions for the entry point)

**Interfaces:**
- Consumes: Task 7 routes (the client sends `clinicId` and the Firebase ID token, like `InterviewDialog`).
- Produces: `ProSetup({ open, onClose, clinicId }: { open: boolean; onClose: () => void; clinicId: string })`.

The screen has three panes: stacked on a phone, side by side from `lg`. EN and AR copy throughout, RTL-aware.

1. **Reading your old chats**:
   - a Start button, then a progress bar (`done / total`, "{chatsRead} chats read")
   - while status is `running`/`summarizing`, it calls scan `step` in a loop (stopping on close; on `busy` it waits 3 s and retries)
   - a `failed` state shows the error and a "Start again" button
2. **Chat with Pro**:
   - the chat list and an input, sending to the chat route; disabled until the scan is `done`
   - shows `cap` as "You've reached today's 60 messages — continue tomorrow."
3. **Your clinic layer**:
   - four editable boxes (rules, hand-off cases, never-say: one per line; prompt section: free text), Save (PUT, shows `dropped` with reasons)
   - **Publish**: shows "Testing ~2–3 minutes" while it runs, then the summary (passed / breaks with the reply lines)
   - a **Versions** list (Live badge, "Make live", and "No clinic layer")
   - a hint line: "Try the draft first in the test chat: turn on Try Pro and Use the draft layer."

- [ ] **Step 1: Add source assertions:**
  - `WhatsAppSettings.tsx` renders `<ProSetup` only inside a `proInPlan` branch
  - `ProSetup.tsx` posts to all four routes with `clinicId`
  - the step loop stops when the dialog closes (an `aborted`/`cancelled` ref checked in the loop)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `ProSetup.tsx` and the entry button (label EN "Teach Pro your clinic" / AR "علّم Pro عيادتك"), using the page's existing tokens (`bg-surface-subtle`, `border-line`, `text-ink`, `bg-accent` fills for primary buttons only; accent is a fill, not text).
- [ ] **Step 4: Run** all `test:pro-*`, `test:setup`, tsc and eslint on the two files. Expected: pass (`test:setup`'s existing UsersHost assertion already fails on main and is not this plan's).
- [ ] **Step 5: Commit** `git commit -m "Pro AI onboarding: Teach Pro your clinic screen"`.

---

## After the last task

- Whole-branch review. Then:
  - push to `main` and `claude/whatsapp-pro-ai`
  - confirm the Vercel production build is Ready
  - update memory `whatsapp-pro-ai.md`
- The owner checks it on the demo clinic with the add-on on:
  1. Start the scan.
  2. Answer Pro's questions in the chat.
  3. Edit a rule.
  4. Try the draft in the test chat.
  5. Publish.
  6. Roll back.
