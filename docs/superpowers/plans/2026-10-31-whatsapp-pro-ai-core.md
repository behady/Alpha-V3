# WhatsApp Pro AI — Plan 1 of 6: the Pro reply core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic that has the new `whatsappPro` add-on and picks "Pro" gets every AI-first WhatsApp reply from Gemini Pro, which searches the whole calendar, reads the full patient file and family on the number, remembers the last 40 messages, never re-sells a booked patient, and falls back to today's reply if it fails.

**Architecture:** New folder `src/lib/botPro/`. Its entry `answerWithPro()` returns the **same `AiReplyResult` contract** as today's `answerWithAi()` (`src/lib/bot/aiReply.ts:97`), so everything downstream in `respond.ts` (booking by slot key, medicines, handoffs, media, opt-out footer) works unchanged. Gemini Pro runs a small tool loop: read-only tools (`find_slots`, `get_patient_file`, `get_price`) plus one finishing tool `reply` whose arguments are the old JSON fields. Code checks every reply against the red lines before it is returned. The only edit to live code is one branch at the AI call site plus one settings field.

**Tech Stack:** Next.js API routes on Vercel, TypeScript, `@google/generative-ai` (function calling), firebase-admin, tests with `npx tsx` + `node:assert/strict` (pattern: `tests/botBrief.test.mts`).

**Spec:** `docs/superpowers/specs/2026-10-31-whatsapp-pro-ai-design.md`

**The six plans** (each ships working software on its own; only Plan 1 is detailed here):
1. **Pro reply core** — this plan (spec §2 model/persona, §3, §4, §5 read tools, §6 items 1–4, §10 steps 1–3).
2. Pro actions and memory — `add_note`, booking for a family member, several bookings in one chat, the per-sitting rolling summary (§5 `addNote`, §6 item 1 summary, §2 actions).
3. Learning — Lessons list, style/fact split, scores, relevant-lessons retrieval (§7, §6 item 5).
4. Onboarding chat — old-chat scan, owner chat window, self-written clinic layer with versions (§8).
5. Owner coaching report + judge scoring in the battery (§9, §10 step 2 judge).
6. Pilot measurements → credit price → delete the old AI (§10 steps 4–5, §12).

## Global Constraints

- The old AI is untouched: no edits to `src/lib/bot/aiReply.ts`, `botPrompt.ts`, `rulebookCache.ts`. In `respond.ts` only: the `aiBrain` settings field, the call-site branch, the playground override.
- `whatsappPro` is `false` on every tier in `src/lib/subscriptions.ts`; it is switched on per clinic from the superadmin panel only.
- `botPro` reads **only** `process.env.GEMINI_PRO_API_KEY` (never `GEMINI_API_KEY`). Model: `process.env.GEMINI_PRO_MODEL || "gemini-pro-latest"` (confirmed on the new key at build time, spec §12).
- `PRO_CREDITS_PER_REPLY = 3` — placeholder until the pilot measures cost (spec §12). Charged only for a delivered answer, like today; feature name `"whatsapp_pro"` in `logAiCreditUsage`.
- Whole Pro turn budget: **25 000 ms**, at most **4 model rounds**. Over either → `{ kind: "unavailable" }` → caller uses `answerWithAi`.
- Persona rule = the two lines at `src/lib/bot/botPrompt.ts:163-164`, copied verbatim into the Pro rulebook (the owner's decision matches them exactly).
- Prices only from the clinic's `services` price list; no clinic setting, lesson or prompt text can lift a red line.
- Firestore rejects `undefined`: every write spreads optional fields conditionally.
- Repo stores CRLF: edits to existing files must keep CRLF (no whole-file rewrites).
- Web app only: nothing under `android/` or `functions/`; no change to the WhatsApp gateway or Meta webhook code.
- Tests and the battery never use the production key or a clinic's credits.

## Review Focus

1. **QR chat with a hidden number** (`@lid`, `phone` empty): Pro must still find the patient through `whatsapp_conversations.patientId` and see their appointments — test in Task 2.
2. **Reception booked by phone** with only `patientPhone` on the appointment (no `patientId`): must count as "already booked" — test in Task 2.
3. **Reception books while Pro is thinking**: the re-check after the final `reply` must catch it — test in Task 6.
4. **A time the calendar never offered** ("تعالى بكرة الساعة 7") when the clinic has no schedule or the slot was never shown: must be caught like an invented price — test in Task 3 (`strayClocks`) and Task 6.
5. **The model never calls `reply`** (tool calls in a loop, or plain text): capped at 4 rounds then fallback, never a silent chat — test in Task 6.

---

### Task 1: The add-on and the brain switch

**Files:**
- Create: `src/lib/botPro/brain.ts`
- Modify: `src/lib/featureCatalog.ts` (new entry after `aiReceipts`), `src/lib/subscriptions.ts` (feature flag in the type and `false` in all four tiers), `src/types/saas.ts:39` (override type), `src/types/whatsapp.ts:129` (new field)
- Test: `tests/botProBrain.test.mts`; script `"test:pro-brain"` in `package.json`

**Interfaces:**
- Produces: `type AiBrain = "standard" | "pro"`; `aiBrainOf(settings: Record<string, unknown>, proUnlocked: boolean): AiBrain`; `WhatsAppSettings.botAiBrain?: "standard" | "pro"`; feature key `"whatsappPro"` (`group: "ai"`, `requires: "aiChat"`, labels EN "WhatsApp Pro AI" / AR "الرد الذكي المتقدم على واتساب").

- [ ] **Step 1: Write the failing test** `tests/botProBrain.test.mts`:

```ts
test("pro only when chosen, unlocked and AI-first", () => {
  assert.equal(aiBrainOf({ botAiBrain: "pro", botMode: "ai_first" }, true), "pro");
  assert.equal(aiBrainOf({ botAiBrain: "pro", botMode: "ai_first" }, false), "standard");
  assert.equal(aiBrainOf({ botAiBrain: "pro", botMode: "assisted" }, true), "standard");
  assert.equal(aiBrainOf({ botMode: "ai_first" }, true), "standard");
  assert.equal(aiBrainOf({ botAiBrain: "PRO", botMode: "ai_first" }, true), "standard");
});
test("whatsappPro is off on every tier", () => {
  for (const tier of Object.values(TIER_LIMITS)) assert.equal(tier.features.whatsappPro, false);
});
```

- [ ] **Step 2: Run** `npx tsx tests/botProBrain.test.mts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `aiBrainOf` (exact-string match, nothing else is pro) and the feature/type additions.
- [ ] **Step 4: Run** `npx tsx tests/botProBrain.test.mts` and `npm run test:features` — Expected: all `ok`.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: whatsappPro add-on (off everywhere) and the brain switch"`

---

### Task 2: Who is writing — patient, family and every appointment

**Files:**
- Create: `src/lib/botPro/person.ts`
- Test: `tests/botProPerson.test.mts`; script `"test:pro-person"`

**Interfaces:**
- Consumes: `pickPatientPhone`, `phoneMatchKey` from `src/lib/patientPhone.ts`; `normalizeAppointmentStatus` from `src/lib/appointmentStages`.
- Produces:
  - `phoneKeysOf(patient: Record<string, unknown>): string[]` — `phoneMatchKey` of **every** phone-like field `pickPatientPhone` knows (phone, phoneNumber, phoneE164, patientPhone, mobile, whatsapp, whatsApp, contactNumber, telephone, primaryPhone), deduped, empties dropped.
  - `interface ProAppointment { id: string; patientId?: string; patientName?: string; date: string; time: string; doctor: string; status: string; service?: string }`
  - `interface ProPerson { patientId: string | null; family: Array<{ id: string; name: string }>; upcoming: ProAppointment[]; past: ProAppointment[] }`
  - `familyOnNumber(patients: Array<{ id: string; data: Record<string, unknown> }>, senderKey: string, linkedPatientId?: string): Array<{ id: string; name: string }>`
  - `splitAppointments(rows: Array<ProAppointment & { patientPhone?: string }>, people: { ids: string[]; phoneKeys: string[] }, todayKey: string): { upcoming: ProAppointment[]; past: ProAppointment[] }` — upcoming = date ≥ today and not cancelled/no-show, sorted soonest first; past = last 10 by date desc.
  - `loadProPerson(args: { clinicId: string; chatId: string; phone?: string; conversationPatientId?: string; todayKey: string }): Promise<ProPerson>` — patients by sender phone key (same direct-then-scan approach as `findPatient`, `respond.ts:460`, but collects **all** matches); adds the conversation's linked `patientId`; appointments by `patientId in` family ids (chunks of 10) **plus** `patientPhone` equal to the sender's E.164; merged by id.

- [ ] **Step 1: Write the failing tests**:

```ts
test("reception booking with only a phone counts", () => {
  const rows = [{ id: "a1", patientPhone: "01001234567", date: "2026-11-05", time: "05:00 PM", doctor: "", status: "Scheduled" }];
  const { upcoming } = splitAppointments(rows, { ids: [], phoneKeys: [phoneMatchKey("+201001234567")] }, "2026-10-31");
  assert.equal(upcoming.length, 1);
});
test("cancelled and no-show are not upcoming", () => { /* status "Cancelled", "No Show" → upcoming [] */ });
test("family on one number, linked lid patient included", () => {
  const fam = familyOnNumber([p("m", "Mona", "01001234567"), p("k", "Karim", "+201001234567"), p("x", "Other", "01119999999")], phoneMatchKey("01001234567"), "z");
  assert.deepEqual(fam.map((f) => f.id).sort(), ["k", "m", "z"]);
});
test("second phone field on the file matches", () => { /* patient with phone "" and mobile "01001234567" → phoneKeysOf includes the key */ });
test("hidden QR number: no phone, linked patient still found", () => { /* familyOnNumber([], "", "z") → [{ id: "z" }] */ });
```

- [ ] **Step 2: Run** `npx tsx tests/botProPerson.test.mts` — Expected: FAIL.
- [ ] **Step 3: Implement** the pure helpers, then `loadProPerson` on `adminClinicCollection`.
- [ ] **Step 4: Run** — Expected: all `ok`.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: find the patient, family and every appointment on a number"`

---

### Task 3: Red-line checks

**Files:**
- Create: `src/lib/botPro/checks.ts`
- Test: `tests/botProChecks.test.mts`; script `"test:pro-checks"`

**Interfaces:**
- Consumes: `strayDrugNames` from `src/lib/bot/drugGuard.ts`.
- Produces:
  - `allowedNumbers(sources: string[]): Set<string>` — Arabic-Indic digits folded, commas dropped (same rule as `aiReply.ts:432-437`).
  - `strayNumbers(reply: string, allowed: Set<string>): string[]` — same rule as `aiReply.ts:448-458` (money/percent/"ألف" at any size, else ≥ 50).
  - `strayClocks(reply: string, allowedClocks: Set<string>): string[]` — every `H:MM` / `HH:MM` in the reply (digits folded, leading zero dropped) not in the set.
  - `wrongScript(question: string, reply: string): boolean` — same rule as `aiReply.ts:471-477`.
  - `asksIfBot(question: string): boolean` — the direct questions listed in `botPrompt.ts:164` (Arabic + English, normalised).
  - `claimsHuman(reply: string): boolean` — "أنا إنسان / بني آدم / شخص حقيقي / I am human / a real person" and negations of being a bot ("مش بوت", "not a bot").
  - `mentionsAi(reply: string): boolean` — بوت / روبوت / ذكاء اصطناعي / مساعد آلي / AI / bot / assistant-bot.
  - `type Violation = { rule: "price" | "clock" | "drug" | "script" | "claims_human" | "volunteers_ai"; detail: string }`
  - `checkReply(args: { question: string; reply: string; allowed: Set<string>; clocks: Set<string>; drugsAllowed: string }): Violation[]` — `volunteers_ai` only when `mentionsAi(reply) && !asksIfBot(question)`; `claims_human` always.

- [ ] **Step 1: Write the failing tests** (each one `assert.deepEqual(checkReply(...).map((v) => v.rule), [...])`):
  - `"التقويم يبدأ من ١٢ ألف"` with allowed `{"15000"}` → `["price"]`
  - `"خصم 20%"` with nothing allowed → `["price"]`
  - `"تعالى بكرة الساعة 7:30"` with clocks `{"5:00"}` → `["clock"]`; with clocks `{"7:30"}` → `[]`
  - question `"انت بني آدم؟"`, reply `"أيوه أنا إنسان"` → `["claims_human"]`
  - question `"انت بوت؟"`, reply `"أنا المساعد الآلي للعيادة، وتحب أوصلك بحد من الفريق؟"` → `[]`
  - question `"عايز أحجز"`, reply `"أنا بوت العيادة..."` → `["volunteers_ai"]`
  - question in English, reply in Arabic → `["script"]`
- [ ] **Step 2: Run** `npx tsx tests/botProChecks.test.mts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: all `ok`.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: red-line checks (price, clock, drug, script, persona)"`

---

### Task 4: The tools

**Files:**
- Create: `src/lib/botPro/tools.ts`
- Test: `tests/botProTools.test.mts`; script `"test:pro-tools"`

**Interfaces:**
- Consumes: `ProPerson` (Task 2).
- Produces:
  - `PRO_TOOL_DECLARATIONS: FunctionDeclaration[]` for `find_slots { from: "YYYY-MM-DD", to?: "YYYY-MM-DD", partOfDay?: "morning"|"afternoon"|"evening", doctor?: string }`, `get_patient_file { patientId: string }`, `get_price { service: string }`, `reply { action, reply, interest?, slotId?, medicineId?, sendMedia?, extraAppointment?: boolean }` (`action` enum = the same 11 values as the `responseSchema` in `aiReply.ts`).
  - `interface ToolEnv { todayKey: string; openDays(from: string, to: string): string[]; freeTimes(dateKey: string, doctor: string): Promise<string[]>; dayLabel(dateKey: string, time: string, doctor: string): string; person: ProPerson; patientFile(id: string): Promise<string>; prices: Array<{ name: string; price: number }>; shown: Map<string, { key: string; label: string }> }`
  - `runTool(name: string, args: Record<string, unknown>, env: ToolEnv): Promise<Record<string, unknown>>`
    - `find_slots`: window clamped to today … today+14 days; at most 3 times per day, 8 in total; each slot registered in `env.shown` under id `s{n}` (continuing numbering across calls) with key `date|time|doctor` (the format `respond.ts:1439` splits); returns `{ slots: [{ id, label }] }` or `{ slots: [], note: "no free time in that window" }`.
    - `get_patient_file`: only an id in `env.person.family` (plus `person.patientId`); anything else → `{ error: "not_on_this_number" }`.
    - `get_price`: case/diacritic-insensitive contains match on the price list; returns `{ matches: [{ name, price }] }` — never a number not in the list.
- [ ] **Step 1: Write the failing tests** with a fake `ToolEnv`:
  - `find_slots` for a 30-day window returns only dates ≤ today+14, ≤ 8 slots, ids `s1…s8`; a second call continues at `s9`.
  - `find_slots` `partOfDay: "evening"` returns only times ≥ 17:00 when the day has them.
  - `get_patient_file` for an id not on the number → `{ error: "not_on_this_number" }`.
  - `get_price("تقويم")` with list `[{ name: "تقويم معدني", price: 15000 }]` → one match, price 15000; `get_price("زراعة")` → `{ matches: [] }`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** In production `freeTimes` is `computeAvailableSlots` (`src/lib/publicBooking.ts:225`) and `openDays` uses the same open-day rule as `upcomingOpenDays` (`respond.ts:180`); both are wired in Task 6, not here.
- [ ] **Step 4: Run** — Expected: all `ok`.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: calendar, patient-file and price tools"`

---

### Task 5: The Pro prompt

**Files:**
- Create: `src/lib/botPro/proPrompt.ts`
- Test: `tests/botProPrompt.test.mts`; script `"test:pro-prompt"`

**Interfaces:**
- Consumes: `clinicAndPatientLayer`, `BotPromptInput`, `LANGUAGE_RULE` from `src/lib/bot/botPrompt.ts` (read-only reuse); `ProPerson`.
- Produces:
  - `proRulebook(args: { clinical: boolean; canBook: boolean }): string` — fixed text: receptionist role; the persona lines from `botPrompt.ts:163-164` verbatim; red lines (prices only via `get_price` or the list below; no medicine except a clinic-authorised `medicineId`; red flags → `handoff_medical`); tool rules ("search with `find_slots` before naming any time; only say times it returned; book with `book_slot` + `slotId`"); already-booked rule ("if the patient has an upcoming appointment, open with it; never sell or book again unless they clearly ask for another; then set `extraAppointment: true`"); always finish with `reply`.
  - `proTurnLayer(input: BotPromptInput, person: ProPerson): string` — `clinicAndPatientLayer({ ...input, offeredSlots: [] })` followed by: family on the number (names), every upcoming appointment (who, day, time, doctor), the last 5 past visits, and `memory`.
- [ ] **Step 1: Write the failing tests**:
  - `proRulebook` contains both persona lines from `botPrompt.ts` exactly (import the source file text and compare substrings).
  - `proTurnLayer` with an upcoming appointment contains its Arabic day label and time, and does **not** contain `"أقرب مواعيد متاحة"`.
  - `proTurnLayer` lists every family member's name.
  - Same input → byte-identical rulebook (it must stay cacheable by Gemini's implicit cache).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: all `ok`.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: rulebook and per-turn clinic/patient layer"`

---

### Task 6: `answerWithPro` — the loop, the checks, the fallback

**Files:**
- Create: `src/lib/botPro/answerWithPro.ts`
- Test: `tests/botProAnswer.test.mts`; script `"test:pro-answer"`

**Interfaces:**
- Consumes: Tasks 2–5; `AiReplyResult`, `AiThreadLine`, `AI_DEFAULT_ACK` from `src/lib/bot/aiReply.ts`; `createUsageMeter`, `logAiCreditUsage` from `src/lib/aiCreditLog`.
- Produces:
  - `type ProReplyResult = AiReplyResult & { slotsShown?: Array<{ key: string; label: string }> }`
  - `interface ProModel { send(contents: unknown[]): Promise<{ functionCall?: { name: string; args: Record<string, unknown> }; text?: string; usage?: unknown }> }`
  - `answerWithPro(args: ProArgs, deps?: { model?: ProModel; env?: Partial<ToolEnv>; charge?: boolean; record?: boolean; now?: () => number }): Promise<ProReplyResult>` where `ProArgs` = every field of `answerWithAi`'s args plus `chatId: string; phone?: string; conversationPatientId?: string`.
- Behaviour:
  1. No `GEMINI_PRO_API_KEY` (and no injected model), no `whatsappPro`/`aiChat`, or not enough credits for `PRO_CREDITS_PER_REPLY` → `{ kind: "unavailable" }`.
  2. Context: `loadProPerson`; the thread's last **40** lines (own read, not `loadSalesContext`'s 16); price list; system prompt = `proRulebook` + `proTurnLayer`.
  3. Loop ≤ 4 rounds, `toolConfig` mode `ANY`. A tool call → `runTool` → result appended. `reply` → go to 4. Plain text or round 5 → `unavailable` (`reason: "no_reply_tool"`).
  4. `checkReply` with allowed numbers from the same sources as `aiReply.ts:418-431` plus every `get_price` result, allowed clocks from `env.shown` labels + upcoming appointments + hours text. Any violation → one corrective round with a system note naming it; still violating → `drug` → `{ kind: "handoff", topic: "medical" }`, anything else → `{ kind: "handoff", topic: "other" }`.
  5. `book_slot`: `slotId` must be in `env.shown` → `bookSlot = shown.key`, else `openBooking: true`. If `person.patientId` has an upcoming appointment and `extraAppointment !== true` → one corrective round ("this patient is already booked on …"); still → drop `bookSlot`, keep the text.
  6. Re-check before returning: `loadProPerson` again; if the upcoming count grew and the action is `book_slot` or `open_booking` → one corrective round with the new appointment in the note.
  7. Charge `PRO_CREDITS_PER_REPLY` only for a delivered `answer` and only when `charge !== false`; `ai_debug` row with `model`, `brain: "pro"`, rounds, tools called, violations, `modelMs`, only when `record !== false`.
  8. A 25 000 ms deadline over the whole turn → `unavailable` (`reason: "ai_timeout"`).
- [ ] **Step 1: Write the failing tests** with a scripted fake `ProModel` (array of responses) and fake env:
  - `find_slots` then `reply{book_slot, slotId:"s1"}` → `bookSlot` = the shown key, `slotsShown` has it.
  - `reply{book_slot, slotId:"s9"}` never shown → `openBooking: true`, no `bookSlot`.
  - stray price twice → `{ kind: "handoff", topic: "other" }`; the second model call received a note naming the number.
  - drug name twice → `{ kind: "handoff", topic: "medical" }`.
  - already booked + `book_slot` without `extraAppointment` twice → no `bookSlot`.
  - re-check finds a new appointment → a corrective round happens (fake model called once more).
  - 5 tool calls with no `reply` → `{ kind: "unavailable", reason: "no_reply_tool" }`.
  - model that never resolves, fake clock → `{ kind: "unavailable", reason: "ai_timeout" }`.
  - `charge: false` → no write to `ai_usage` (fake firestore spy or injected `charge` hook).
- [ ] **Step 2: Run** `npx tsx tests/botProAnswer.test.mts` — Expected: FAIL.
- [ ] **Step 3: Implement**, including the real `ProModel` on `GoogleGenerativeAI(process.env.GEMINI_PRO_API_KEY).getGenerativeModel({ model, systemInstruction, tools: [{ functionDeclarations }], toolConfig })`. No explicit cache (`rulebookCache` cannot hold tools); the fixed rulebook goes first so Gemini's implicit prefix cache applies.
- [ ] **Step 4: Run** — Expected: all `ok`. Then `npx tsc --noEmit` — Expected: no new errors.
- [ ] **Step 5: Commit** `git commit -m "Pro AI: tool loop with red-line checks, already-booked rule and fallback"`

---

### Task 7: Wire it into the live reply path and the test chat

**Files:**
- Modify: `src/lib/bot/respond.ts` — `BotSettings` (`:82`) + `loadBotSettings` (`:118`) gain `aiBrain: AiBrain` via `aiBrainOf(d, await clinicHasFeature(clinicId, "whatsappPro"))`; `respondToPatientMessage` args gain `brainOverride?: AiBrain` (honoured **only** when `dryRun`); at the call site (`:1290`) `slotOffer` becomes `let`.
- Modify: `src/app/api/admin/bot-playground/route.ts:29,50` — body accepts `brain?: "pro"`; passes `brainOverride: "pro"` only when the clinic has `whatsappPro`.
- Test: `tests/botProWiring.test.mts`; script `"test:pro-wiring"`

**Interfaces:**
- Consumes: `answerWithPro`, `ProReplyResult` (Task 6), `aiBrainOf` (Task 1).
- Produces: `pickReply(brain: AiBrain, pro: () => Promise<ProReplyResult>, standard: () => Promise<AiReplyResult>): Promise<{ ai: AiReplyResult; slotsShown?: Array<{ key: string; label: string }>; brainUsed: AiBrain }>` in `src/lib/botPro/brain.ts` — standard brain never calls `pro`; Pro `unavailable` → calls `standard`.

- [ ] **Step 1: Write the failing test** for `pickReply`: standard never calls pro; pro answer is returned with `brainUsed: "pro"`; pro `unavailable` → standard's result with `brainUsed: "standard"`; pro throwing → standard.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `pickReply`; in `respond.ts` replace the single `const ai = await answerWithAi({...})` with `pickReply(brain, () => answerWithPro({ ...sameArgs, chatId, phone, conversationPatientId: conversation.patientId }), () => answerWithAi({...sameArgs}))`, and when `slotsShown` is present set `slotOffer = slotsShown` so the spoken-pick code (`:1332`, `:1352`) resolves against what Pro showed.
- [ ] **Step 4: Run** `npx tsx tests/botProWiring.test.mts`, `npm run test:bot`, `npm run test:botcases`, `npx tsc --noEmit` — Expected: all pass, no new type errors (proves the old path is unchanged).
- [ ] **Step 5: Commit** `git commit -m "Pro AI: route Pro clinics through answerWithPro, fall back to the old reply"`

---

### Task 8: The switch on screen and "Try Pro" in the test chat

**Files:**
- Modify: `src/components/settings/WhatsAppSettings.tsx` — state passthrough near `:187` (`...(data?.botAiBrain === "pro" ? { botAiBrain: "pro" } : {})`); a two-card picker **Standard / Pro** shown only when `autoReplyMode === "ai"` and `isUnlocked(clinic, "whatsappPro")`, saving via the existing `persist(next, "silent")`.
- Modify: `src/components/settings/BotPlayground.tsx` — a "Try Pro" toggle (only when unlocked) that sends `brain: "pro"` to `/api/admin/bot-playground`.
- Test: browser check (below).

- [ ] **Step 1:** Implement both, Arabic + English labels: Standard — "الرد الحالي" / "Current replies"; Pro — "الرد الذكي المتقدم — بيدوّر في الجدول كله ويقرا ملف المريض. بيستهلك رصيد أكتر لكل رد." / "Pro — searches the whole calendar and reads the patient file. Uses more credits per reply."
- [ ] **Step 2:** Run the dev server (`preview_start`), open WhatsApp → Settings on the demo clinic with `whatsappPro` overridden on: the picker shows only in AI-only mode; choosing Pro survives a reload; with the add-on off the picker is absent.
- [ ] **Step 3:** In the test chat with "Try Pro" on and `GEMINI_PRO_API_KEY` set to the **new test key** in `.env.local`: ask "عايز أحجز تنضيف بالليل" → reply names only times from the calendar; a patient with an upcoming appointment asking "عايز أحجز" → reply opens with that appointment. Screenshot both.
- [ ] **Step 4: Commit** `git commit -m "Pro AI: brain picker in WhatsApp settings and Try Pro in the test chat"`

---

### Task 9: Replay battery

**Files:**
- Create: `scripts/pro-battery.mts`; script `"battery:pro"` in `package.json`

**Interfaces:**
- Consumes: `answerWithPro(args, { charge: false, record: false })`; `checkReply`; `expectFromKind`, `SavedTestCase` from `src/lib/bot/testCases.ts`; env loading as in `scripts/probe-model-battery.mts:38-48`.
- Behaviour: `CLINIC_ID=<id> npx tsx scripts/pro-battery.mts` reads that clinic's `bot_test_cases` (read-only), replays each saved conversation turn by turn through `answerWithPro` with a fake send (nothing leaves the machine, no Firestore writes, no credits), and prints per case: action vs `expectFromKind`, red-line violations, rounds, tools called, `modelMs`, tokens. Ends with totals: pass rate, any red-line break, median and p90 latency, average tokens in/out per reply. Refuses to run when `GEMINI_PRO_API_KEY` equals `GEMINI_API_KEY`. Exit code 1 on any red-line break.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run against the demo clinic with the new key. Expected: zero red-line breaks; median latency under 20 s. Save the summary to `docs/superpowers/plans/2026-10-31-pro-battery-run-1.md`.
- [ ] **Step 3: Commit** `git commit -m "Pro AI: replay battery on saved real chats"`

---

## Owner steps (not code)

1. Create the new Gemini key in Google AI Studio and paste it yourself into `.env.local` as `GEMINI_PRO_API_KEY=` (test) — later added to Vercel under the same name for the pilot.
2. Pick the pilot clinic; switch `whatsappPro` on for it in the superadmin panel only after Task 9 passes.
