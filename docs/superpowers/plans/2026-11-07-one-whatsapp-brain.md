# One WhatsApp Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every clinic with auto-reply on is answered by the Pro brain (`answerWithPro`) only; the old Flash brain, the scripted menu state machine, the Fixed replies feature, the brain picker and the Pro add-on are deleted, with no clinic document written.

**Architecture:** `respond.ts` keeps its gates, booking writer and post-compose pipeline but routes every text turn through a 60-line pure decider (`decide.ts`) whose default is `{type:"ai"}`, then calls `answerWithPro` directly. Slot lists become one `offerSlots` helper that speaks up to three times and stores their keys as `pendingSlots` (the existing spoken-pick path books them). Shared types the old brain owned move to `aiTypes.ts`; the shared voice lines become an export of a shrunken `botPrompt.ts`.

**Tech Stack:** Next.js 15 / TypeScript, firebase-admin, `@google/generative-ai`, tests via `npx tsx tests/*.test.mts` (node:assert), `npx tsc --noEmit -p tsconfig.json`, `npx eslint src tests`.

**Spec:** `docs/superpowers/specs/2026-11-07-one-whatsapp-brain-design.md`

## Global Constraints

- Repo stores CRLF: edit with targeted replacements; every new file is written with CRLF line endings (`sed -i 's/\r$//; s/$/\r/' <file>` after writing).
- No Firestore document is written or migrated by this change; `botMode`, `botAiEnabled`, `botAiBrain`, `botAiMaxReplies`, `botScripts` stay stored and stop being read (except `botScripts`, folded into knowledge).
- Never call Gemini with a real key or spend clinic credits in a test: fakes only (`ProModel` fakes, `--dry` battery).
- `PRO_CREDITS_PER_REPLY = 1`. The `aiChat` credit-pool check stays (`getAiCreditLimit` returns 0 without it).
- Patient-facing Arabic strings that survive are copied verbatim from today's code; no new Arabic copy except the two lines given in Task 4.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No push.

## Review Focus

1. A conversation stored at `booking_day`/`booking_time`/`booking_doctor`/`reprompted` on deploy day: its next message must get a brain reply, not a crash on an unknown state (Task 3 test "legacy states read as awaiting_choice").
2. A stale tapped button id (`m1`, `d2026-11-09|`, `t2026-11-09|05:00 PM|`) arriving as text: must reach the brain as a question, never book or throw (Task 3 test "tap ids are text").
3. A clinic with `botEnabled: true` and no `aiChat` in its features: the brain is unavailable with reason `plan`; the patient gets the holding reply and the owner alert fires once per 12 h (Task 4 source test).
4. `open_booking` with no slot in the brain's sentence and no free slot in 14 days: the reply must still be a sentence plus a handoff, never an empty list (Task 4 `offerSlots` empty branch).
5. A welcome event (ad tap, no text) must stay free: a fixed greeting naming the ad, no model call (Task 3 test "ad welcome is free").

---

### Task 1: Move the shared AI types out of the old brain

**Files:**
- Create: `src/lib/bot/aiTypes.ts`
- Modify: `src/lib/botPro/answerWithPro.ts:25-34`, `src/lib/botPro/proContext.ts:18`, `src/lib/botPro/replay.ts:19`, `src/lib/botPro/replayCases.ts:5`, `src/lib/bot/localize.ts` (import), `scripts/pro-battery.mts:47-48`, `tests/botProWiring.test.mts:10`, `tests/botProAnswer.test.mts` (imports)
- Delete: `src/lib/bot/aiReply.ts` — in Task 4 (it is the old brain; `respond.ts` still calls it until then)

**Interfaces:**
- Produces: `export interface AiArgs { … }` = the parameter type of today's `answerWithAi` (aiReply.ts:150-215) verbatim, field for field; `export type AiReplyResult` (aiReply.ts:99-133 verbatim); `export interface AiThreadLine` (aiReply.ts:135-138); `export const AI_DEFAULT_ACK = "تمام 👍"`; `export type { AiPatientContext } from "./botPrompt"`.
- `proContext.ts`: `export type ProArgs = AiArgs & { chatId: string; … }` (replace `Parameters<typeof answerWithAi>[0]`).

- [ ] **Step 1: Create `aiTypes.ts`** with the four exports above, copied from `aiReply.ts`; header comment: "The reply contract between the brain and respond.ts; the brain itself lives in src/lib/botPro."
- [ ] **Step 2: Re-point every import** of `AiReplyResult`, `AiThreadLine`, `AiPatientContext`, `AI_DEFAULT_ACK`, `answerWithAi` (type-only uses) in the files listed to `@/lib/bot/aiTypes` (tests/scripts: `../src/lib/bot/aiTypes`). `respond.ts` keeps importing from `./aiReply` for now (Task 4 removes it).
- [ ] **Step 3: Delete `aiReply.ts`'s duplicate type definitions** (keep `answerWithAi` itself; make it `import type { AiArgs, AiReplyResult } from "./aiTypes"` and re-export `AI_DEFAULT_ACK`, `AiThreadLine`, `AiPatientContext` from there so `respond.ts` compiles untouched until Task 4). Run `npx tsc --noEmit -p tsconfig.json` — Expected: 0 errors.
- [ ] **Step 4: Run** `npm run test:pro-answer && npm run test:pro-wiring && npm run test:pro-replay` — Expected: all `ok`.
- [ ] **Step 5: Commit** `git commit -m "Move the WhatsApp AI reply contract out of the old brain"`.

### Task 2: Shrink `botPrompt.ts` to what the Pro brain imports

**Files:**
- Modify: `src/lib/bot/botPrompt.ts`, `src/lib/botPro/proPrompt.ts:201-218`, `tests/botProPrompt.test.mts:30-60`, `tests/adReferral.test.mts:7` and the `buildBotPrompt` assertions below line 100
- Delete: `tests/botPrompt.test.mts`, `scripts/probe-model-battery.mts`; `package.json` script `test:prompt`

**Interfaces:**
- Produces from `botPrompt.ts`: `export const SALES_VOICE: string[]` (today's lines 308-320, verbatim); unchanged exports `factLines`, `clinicAndPatientLayer`, `LANGUAGE_RULE`, `HIDE_DOCTOR_NAMES_RULE`, `PHONE_HIDDEN_LINE`, `BRANCHES_RULE`, `BotPromptInput`, `AiPatientContext`. Deleted: `buildBotPrompt`, `fixedPromptLayers`, `promptVersion`, `nonNegotiables`, `SALES_JOB`, `ASSISTED_JOB`, `DENTIST_JOB`, `NO_BOOKING_LINE`, `BOOKING_RULES`, `PRICE_RULES`, `MEDICINE_RULES`, `MONEY_RULES`, `PEOPLE_RULES`, `COMPLAINT_RULES`, `ASSISTED_VOICE`, `PRECEDENCE`, `RED_FLAGS`, `USUAL_DENTIST_RULE_PREFIX`, `NAMED_DENTIST_RULE_PREFIX`, `consultServiceLines` (keep if `clinicAndPatientLayer` calls it).
- `proPrompt.ts`: `import { SALES_VOICE as VOICE } from "@/lib/bot/botPrompt"`; the local `VOICE` array is deleted.

- [ ] **Step 1: Write the failing test** in `tests/botProPrompt.test.mts`: replace the `sourceArray("SALES_VOICE")` reading with `import { SALES_VOICE } from "../src/lib/bot/botPrompt"` and assert `proRulebook({clinical:false,canBook:true})` ends with `SALES_VOICE.join("\n")`. Keep the other source-prefix checks (`LANGUAGE_RULE` etc.) only where they read exported constants; drop any that read a deleted private array.
- [ ] **Step 2: Run** `npm run test:pro-prompt` — Expected: FAIL (`SALES_VOICE` is not exported).
- [ ] **Step 3: Export `SALES_VOICE`**, delete the listed symbols from `botPrompt.ts`, make `proPrompt.ts` import it; delete the two files and the `test:prompt` script; in `tests/adReferral.test.mts` delete the `buildBotPrompt` import and its assertions (the ad lines are still covered by `adPromptLines`).
- [ ] **Step 4: Run** `npm run test:pro-prompt && npm run test:ads && npx tsc --noEmit -p tsconfig.json` — Expected: pass; tsc 0 errors (nothing else imported the deleted symbols: verify with `grep -rn "buildBotPrompt\|fixedPromptLayers\|promptVersion" src tests scripts`).
- [ ] **Step 5: Commit** `git commit -m "The prompt file keeps only what the Pro brain reads"`.

### Task 3: The small decider replaces the menu engine

**Files:**
- Create: `src/lib/bot/decide.ts`, `tests/botDecide.test.mts`
- Modify: `src/lib/bot/sales.ts` (delete `competitorReply`, `expensiveReply`, `thinkingReply`, `offersExpiredReply`), `tests/sales.test.mts`, `tests/quickAnswers.test.mts`, `tests/adReferral.test.mts`, `package.json` (`test:bot` → `npx tsx tests/botDecide.test.mts`; delete `test:scripts`)
- Delete: `src/lib/bot/engine.ts`, `tests/botEngine.test.mts`, `tests/botScripts.test.mts`, `src/lib/bot/scripts.ts` → keep only `cleanScripts` (delete `matchScript`, `parseTriggers`, `stripArticle`)

**Interfaces:**
- Produces (`decide.ts`):
  - `export type BotState = "new" | "awaiting_choice" | "booking_name" | "handed_off"` plus the four legacy literals `"reprompted" | "booking_doctor" | "booking_day" | "booking_time"` kept in the type (documents still hold them) with a comment "stored by the retired menu bot; read as awaiting_choice".
  - `export function liveState(s: BotState): "new" | "awaiting_choice" | "booking_name" | "handed_off"` — the four legacy literals → `"awaiting_choice"`.
  - `export type BotAction = { type: "ai"; question: string; clinical?: boolean } | { type: "ack" } | { type: "register"; name: string; forRelative?: boolean }`.
  - `export interface BotContext { clinicName: string; patientName?: string; clinicPhone?: string; facts?: BotFacts; ad?: AdReferral; adOfferLine?: string; welcome?: boolean; hasSoonAppointment?: boolean; gender?: Gender; forRelative?: boolean; aiAvailable?: boolean; clinicalMode?: "handoff" | "dentist"; staffActive?: boolean }`.
  - `export interface BotDecision { reply: string; action?: BotAction; next: BotState; handoff: boolean; reason: string }` (unchanged shape).
  - `export function decide(args: { state: BotState; text: string; ctx: BotContext }): BotDecision`.
  - `export function clinicalReplyText(clinicPhone?: string): string` and `export function urgentCallLine(clinicPhone?: string): string` — moved verbatim from engine.ts:305-331.
  - `export { needsHuman, triageMessage } from "./clinicalTriage"`.
- `decide` order and exact outcomes:
  1. `isOptOutReply(text)` → `{reply:"", next:"handed_off", handoff:false, reason:"opt_out"}`.
  2. `!text.trim() && ctx.welcome && liveState(state) !== "booking_name"` → reply = `أهلاً بحضرتك{ يا <name>} 👋\n<v.withYou> المساعد الآلي لـ *<clinicName>*.` + (`ad` ? `\n\n` + `adGreetingLine(ctx.ad, { offerLine: ctx.adOfferLine })` : "") + `\n\nاكتبلنا اللي محتاجه وهنرد عليك حالاً 🙏`; next `awaiting_choice`, reason `ad_welcome`. (`v = voiceFor(ctx.gender ?? "unknown")`, as engine.ts:259-267.)
  3. `!text.trim()` → `{reply:"", next:state, handoff:false, reason:"empty_message"}`.
  4. `needsHuman(text)`: dentist mode (`ctx.clinicalMode === "dentist" && ctx.aiAvailable && triageMessage(text).reason !== "phrase"`) → `{reply:"", action:{type:"ai", question:text, clinical:true}, next:"awaiting_choice", handoff:false, reason:"clinical_ai"}`; else `{reply: clinicalReplyText(ctx.clinicPhone), next:"handed_off", handoff:true, reason:"clinical"}`.
  5. `liveState(state) === "handed_off" && ctx.staffActive` → `{reply:"", next:"handed_off", handoff:false, reason:"already_with_a_human"}`.
  6. `!ctx.aiAvailable` → `{reply:"وصلتني رسالتك 🙏 حد من الاستقبال هيرد على حضرتك في أقرب وقت.", next:"handed_off", handoff:true, reason:"ai_off"}`.
  7. `liveState(state) === "booking_name"`: `name = text.replace(/\s+/g," ").trim()`; if `quickIntent(name) !== null || /[?؟]/.test(name) || /\d/.test(name) || name.length < 2 || name.length > 80` → `{reply:"", action:{type:"ai", question:text}, next:"booking_name", handoff:false, reason:"ai"}`; else `{reply:"", action:{type:"register", name, forRelative: ctx.forRelative === true}, next:"awaiting_choice", handoff:false, reason:"registered"}`.
  8. `quickIntent(text) === "thanks"` → `{reply:"العفو 🙏 لو احتجت أي حاجة تانية إحنا هنا.", next:"awaiting_choice", handoff:false, reason:"thanks"}` (today's thanks line from engine.ts `answerIntent` — copy the exact string from there instead if it differs).
  9. `quickIntent(text) === "ack" && ctx.hasSoonAppointment` → `{reply:"", action:{type:"ack"}, next:"awaiting_choice", handoff:false, reason:"ack"}`.
  10. otherwise → `{reply:"", action:{type:"ai", question:text}, next:"awaiting_choice", handoff:false, reason:"ai"}`.

- [ ] **Step 1: Write `tests/botDecide.test.mts`** (node:assert, `console.log("ok - …")` per case) covering: opt-out silent; empty → `empty_message`; ad welcome is free (reason `ad_welcome`, reply contains the clinic name and `adGreetingLine` output, no action); clinical handoff vs dentist mode (`clinical_ai` with `clinical:true`); `handed_off` + `staffActive` silent, `handed_off` without staff → `ai`; `aiAvailable:false` → `ai_off` handoff; thanks; ack only with `hasSoonAppointment`, else `ai`; tap ids are text (`"m1"`, `"3"`, `"d2026-11-09|"`, `"t2026-11-09|05:00 PM|"` each → action `ai` with `question` equal to the text); legacy states read as `awaiting_choice` (`liveState("booking_day")`, and `decide({state:"booking_time", text:"الاول", …}).action.type === "ai"`); name step: `"Hi"` → ai, `"3"` → ai, `"أحمد محمود"` → register.
- [ ] **Step 2: Run** `npx tsx tests/botDecide.test.mts` — Expected: FAIL (module not found).
- [ ] **Step 3: Create `decide.ts`** per the interface; move `clinicalReplyText`/`urgentCallLine`; delete `engine.ts`; trim `scripts.ts` and `sales.ts`.
- [ ] **Step 4: Fix the three surviving tests**: `tests/sales.test.mts` — delete every `decideBotReply` block and the `expensiveReply` assertion, keep `activeOffers`/`offerForService`/`closingLine`; `tests/quickAnswers.test.mts` — delete the `decideBotReply` import and its cases (the intent-order cases stay); `tests/adReferral.test.mts` — replace the engine block (lines 68-101) with `decide` calls: welcome greets by the ad (`ad_welcome`, reply includes the ad subject), `"مرحبا"` with an ad → action `ai`, `"وشي وارم"` → `clinical`.
- [ ] **Step 5: Run** `npm run test:bot && npm run test:sales && npm run test:quick && npm run test:ads` — Expected: all pass. `npx tsc --noEmit` is expected to FAIL only inside `respond.ts` (it still imports `./engine`); Task 4 fixes that.
- [ ] **Step 6: Commit** `git commit -m "A ten-line decider replaces the WhatsApp menu engine"`.

### Task 4: `respond.ts` runs one brain and speaks its slots

**Files:**
- Modify: `src/lib/bot/respond.ts` (whole file; anchors below are today's line numbers), `src/app/api/admin/bot-playground/route.ts:8,32,54-55`, `src/components/settings/BotPlayground.tsx` (drop `proUnlocked`, `tryPro`, `useDraft`, the `brain` tag)
- Create: `tests/botOneBrain.test.mts` (source assertions, same style as `tests/botAiFirstFallback.test.mts`)
- Delete: `src/lib/botPro/brain.ts`, `tests/botProBrain.test.mts`, `tests/botAiFirstFallback.test.mts`, `tests/botProWiring.test.mts` `pickReply` cases (keep the `loadClinicLayerWith` cases), `package.json` scripts `test:pro-brain`, `test:bot-fallback`; add `"test:bot-one-brain": "npx tsx tests/botOneBrain.test.mts"`

**Interfaces:**
- Consumes: `decide`, `liveState`, `BotContext`, `BotAction`, `clinicalReplyText`, `urgentCallLine` from `./decide`; `AiArgs`, `AI_DEFAULT_ACK` from `./aiTypes`; `answerWithPro` (unchanged signature) and `PRO_CREDITS_PER_REPLY`.
- `BotSettings` loses `aiEnabled`, `aiFirst`, `aiMaxReplies`, `aiBrain`, `scripts` (keeps `scriptsKnowledge: Array<{q:string;a:string}>` = `cleanScripts(d.botScripts).filter(s => s.enabled !== false).map(s => ({ q: s.triggers.join("، "), a: s.reply }))`).
- `respondToPatientMessage` args lose `brainOverride`; keep `proLayer`. `BotOutcome` unchanged.
- New local helper inside the action block: `const offerSlots = async (intro: string, o: { doctorName?: string; dateKey?: string; reason: string }) => void` — fetches `await nextSlots(clinicId, profile, branchId, o.doctorName ?? conversation.pendingDoctor ?? "", rescheduleId || null, o.dateKey ? { kind: "on", dateKey: o.dateKey } : readTimePreference(text, clinicDayBoundsMinutes(profile.schedule)), settings.hideDoctorNames)` (if `TimePreference` has no `on` kind, pass `undefined` and filter `out` to `s.key.startsWith(o.dateKey)`), takes the first 3; with slots: `replyText = [intro, "", "عندنا المواعيد دي:", ...labels.map(l => `• ${l}`), "", `${v.youWant} أنهي واحد؟`].filter(Boolean).join("\n")`, `nextState = "awaiting_choice"`, `pending = { slots: keys, doctor, treatment, reschedule: rescheduleId || undefined }`, `spokenSlotKeys = keys`, `reason = o.reason`; with none: `replyText = intro ? `${intro}\n\nتمام 👍 الاستقبال هيتواصل معاك في أقرب وقت لتحديد الميعاد.` : "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت لتحديد الميعاد."`, `nextState = "handed_off"`, `handoff = true`, `reason = "no_open_days"`.

- [ ] **Step 1: Write `tests/botOneBrain.test.mts`** asserting on `respond.ts` source (CRLF normalised): contains `answerWithPro(` and not `answerWithAi(`, `pickReply(`, `decideBotReply(`, `menuButtons(`, `optionList(`, `renderDayList(`, `MENU_ON_SCREEN_REASONS`, `listDoctors`, `aiMaxReplies`, `botAiBrain`, `botMode`; contains the ladder in order: `ai.reason === "no_credits" || ai.reason === "plan"` → `creditsAlertAtMs` → `conversation.lastReason !== "ai_unavailable"` with `معلش، الرسالة مأخدتش عندي كويس` → `reason = "gave_up"` with `حد من الاستقبال هيرد على حضرتك`; contains `liveState(conversation.state)`; contains `PRO_CREDITS_PER_REPLY = 1` in `proContext.ts`; `brain.ts` does not exist. Also assert `bot-playground/route.ts` has no `whatsappPro` and no `brainOverride`.
- [ ] **Step 2: Run** `npx tsx tests/botOneBrain.test.mts` — Expected: FAIL.
- [ ] **Step 3: Rewrite `loadBotSettings`** (128-165) per the `BotSettings` interface above; delete the `aiBrainOf`/`clinicHasFeature("whatsappPro")` line and the `AiBrain` import.
- [ ] **Step 4: Replace the engine call** (820-888): build `ctx` with only the `decide.ts` fields (`staffActive: conversation.staffActive === true`, `aiAvailable: true`, `clinicalMode`, `hasSoonAppointment` computed as today at 830-835 but without the `settings.aiFirst` guard); keep the media branch exactly (856-879) but `photoToModel = args.media === "image" && !text.trim() && Boolean(args.mediaNote)`; replace `decideBotReply({state: …, text, ctx})` with `decide({ state: liveState(conversation.state), text, ctx })`. Delete `menuShown`, `optionCount`, `doctorCount`, `dayWord`, `relative`-only uses that fed the engine (keep `ctx.relative`? No: `relative` is read at 1596 from `ctx.relative` — keep `const relative = mentionsRelative(text)` as a local and use it there).
- [ ] **Step 5: Replace the list helpers** (946-1003 `listDoctors`/`listDays`/`listTimes`) with `offerSlots` per the interface; rewrite each caller: `bookAt` when `!patient || !phone` → ask the name (`replyText = askName…` as 1655-1662 does, `nextState="booking_name"`, `pending={date, times:[time], doctor, treatment}`); `slot_taken` (both) → `await offerSlots("الميعاد ده اتحجز في نفس اللحظة 🙏", { doctorName, dateKey, reason: "slot_taken" })`; `reschedule_gone` → `offerSlots("الميعاد القديم مش موجود، نحجزلك ميعاد جديد 👇", { doctorName, reason: "reschedule_gone" })`; `startReschedule` → `offerSlots(["تمام، هنعدّل ميعادك ده 🔁", "", appointmentLine(appt, settings.hideDoctorNames)].join("\n"), { doctorName, reason: "reschedule_days" })` and `reschedule_no_appointment` keeps its text with `structure = undefined`; `register` with no pending slot → `offerSlots("", { reason: "registered" })`; the `ai.openBooking` branch (1689-1716): `alreadyOffered` unchanged, else `offerSlots(intro, { reason: "ai_booking" })` when `ctx.canOfferBooking`, else the existing ask-name branch.
- [ ] **Step 6: Delete the retired action branches**: `my_appointment`, `reschedule_start` (keep the `startReschedule` function, called from `ai.reschedule`), `appointment_change` by intent (keep `flagAppointmentChange`, called from `ai.appointmentChange`), `open_now`, `price_list`, `list_doctors`, `list_days_doctor_index`, `list_days`, `relist`, `list_times`, `list_times_date`, `book`/`book_slot` (the brain's `bookSlot` path at 1636 calls `bookAt` directly). Keep `ack`, `register`, `ai`. Delete `RELIST_PREFIX`, `FRESH_BOOKING_REASONS` (and the `stillMoving` block 1836-1841 — `pending.reschedule` is set by `offerSlots`), `menuButtons`, `optionList`, `renderDayList`, `renderTimeList`, `upcomingOpenDays` (move it into `nextSlots`'s file scope if `nextSlots` uses it — it does: keep it), `bookingStepLabel` legacy cases (keep `booking_name`), `MENU_ON_SCREEN_REASONS`.
- [ ] **Step 7: The brain call** (1338-1386): `const sales = true` removed — every `sales ? … : …` resolves to the sales side; `aiArgs: AiArgs` with `mode: "sales"`, `knowledge: [...(salesContext?.knowledge ?? []), ...settings.scriptsKnowledge].slice(0, 40)`, `history` dropped; `const ai: AiReplyResult = await answerWithPro({ ...aiArgs, chatId, phone, conversationPatientId: conversation.patientId, previousSlotKeys: conversation.pendingSlots, branchId, profile, ...(args.dryRun && args.proLayer ? { proLayer: args.proLayer } : {}) }).catch((): AiReplyResult => ({ kind: "unavailable", reason: "pro_error" }))`; `slotsShown` from the Pro result replaces `slotOffer` as today; delete `brainUsed`, `dryRunBrainTag`, `playgroundOutcome` uses.
- [ ] **Step 8: The failure ladder** (1683-1740): keep `no_credits`/`plan` (unchanged), keep the `lastReason !== "ai_unavailable"` resend branch and the `gave_up` branch; delete the `reprompt` and classic `gave_up` branches.
- [ ] **Step 9: Post-compose**: delete the offer/closing-line appends guarded by `!(settings.aiFirst && reason === "ai_answer")` (1872-1882) and the button-attaching block (`["greeted","reprompt","back_to_menu","hours"]`, 2016-2030); `latinPatient = latinNow || (conversation.lastLatin === true && !/[؀-ۿ]/.test(text))`; `MISS` regex: drop `reprompt|booking_abandoned|asked_for_human`; `saveConversation` call: drop `aiExchange`? No — keep it (`aiReplies` is still logged); pass `state: nextState` as today.
- [ ] **Step 10: `localize.ts`**: delete the rows whose Arabic source no code emits any more (`*0* — رجوع للقائمة`, `رجوع للقائمة`, `اختار من الأزرار 👇`, the `*1*`/`*2*`/`*3*` menu rows, `ابعت رقم الاختيار`); keep every row still produced by `respond.ts`, `decide.ts`, `offerSlots` or `bookAt` (grep each source string before deleting). Also delete `src/lib/bot/aiReply.ts` and the `test:prompt`-style script `test:pro-wiring` stays.
- [ ] **Step 11: Playground**: route body type `{ clinicId?: string; text?: string; reset?: boolean; proLayer?: "draft" }`, no `whatsappPro` check, pass `proLayer` whenever `body.proLayer === "draft"`; drop `playgroundOutcome`; `BotPlayground` drops the `proUnlocked` prop and the two checkboxes except "use draft layer" (rename its label to the existing Arabic/English "draft" wording, shown always).
- [ ] **Step 12: Run** `npx tsc --noEmit -p tsconfig.json` — Expected: 0 errors; `npx eslint src/lib/bot src/lib/botPro src/app/api/admin/bot-playground src/components/settings/BotPlayground.tsx` — Expected: clean; `npx tsx tests/botOneBrain.test.mts && npm run test:bot-owner-rules && npm run test:bot-lid && npm run test:bot-superseded && npm run test:bot-bubbles && npm run test:pro-answer && npm run test:pro-wiring` — Expected: pass (fix `botOwnerRules` line 219: it reads `aiReply.ts`; point that check at `answerWithPro.ts` only).
- [ ] **Step 13: Commit** `git commit -m "One WhatsApp brain: respond.ts calls the Pro brain and speaks its slots"`.

### Task 5: Credits, plan gates and the Pro add-on

**Files:**
- Modify: `src/app/api/automation/bot-memory/route.ts:55` and `src/app/api/automation/bot-coach/route.ts:44` (the "is AI on" check becomes `settings.botEnabled !== true` → skip), `src/lib/botPro/proContext.ts:27,88-96`, `src/lib/featureCatalog.ts:127-137` (delete the `whatsappPro` entry), `src/lib/subscriptions.ts:48,111,140,170,200` (delete the key), `src/types/saas.ts:40`, `src/app/api/whatsapp/pro-onboarding/route.ts:35,61`, `…/chat/route.ts:36`, `…/publish/route.ts:58`, `…/scan/route.ts:42` (`"whatsappPro"` → `"whatsappBot"`), `tests/botProOnboardingRoutes.test.mts:37-41`, `tests/featureCatalog.test.mts` (if it lists keys), `tests/botProAnswer.test.mts` (any `plan_pro` or `3`-credit assertion)

- [ ] **Step 1: Update tests first**: onboarding-routes regex to `"whatsappBot"`; in `botProAnswer.test.mts` assert the charge is `1` where it asserted `3`, and delete any `plan_pro` case.
- [ ] **Step 2: Run** `npm run test:pro-onboarding-routes && npm run test:pro-answer` — Expected: FAIL.
- [ ] **Step 3: Implement**: `PRO_CREDITS_PER_REPLY = 1`; delete the `plan_pro` line in `proContext.ts`; remove `whatsappPro` everywhere listed (`grep -rn whatsappPro src tests` must return nothing).
- [ ] **Step 4: Run** the two tests plus `npm run test:features && npx tsc --noEmit -p tsconfig.json` — Expected: pass, 0 errors.
- [ ] **Step 5: Commit** `git commit -m "The Pro add-on is retired; a brain reply costs one credit"`.

### Task 6: Setup wizard and the auto-reply switch know only on/off

**Files:**
- Modify: `src/lib/setupWizard.ts:255-380`, `src/lib/bot/brief.ts:94-108`, `src/components/ai/AutoReplySwitch.tsx:47-49`, `src/components/setup/WhatsAppQuestionsStep.tsx:221-248,389-410,532-560`, `tests/setupWizard.test.mts:147-209`, `tests/botBrief.test.mts` (`stepsForMode` cases)

**Interfaces:**
- `export type AnswerMode = "off" | "ai"`; `answerModeOf(doc)` → `"off"` unless `doc.botEnabled === true`, else `"ai"`; `chosenAnswerMode` deleted (callers use `answerModeOf`); `clampAnswerMode(mode, allowed)` → `"off"` when `!allowed.bot`, else `mode`; `whatsappDocFromAnswers` writes `botEnabled` only (no `botMode`, no `botAiEnabled`); `WhatsAppAllowance = { messages: boolean; bot: boolean }`.
- `brief.ts`: `export type AutoReplyStep = "clinic" | "brief" | "behaviour" | "test"`; `export function autoReplySteps(): Array<{ id: AutoReplyStep; optional: boolean }>` = `[clinic, brief, behaviour, test]`, all `optional:false`; `stepsForMode` deleted.

- [ ] **Step 1: Rewrite the test expectations** in `tests/setupWizard.test.mts` lines 147-209 to the new interface (`answerModeOf({botEnabled:true}) === "ai"`, round-trip writes `{botEnabled:true}` and no `botMode`, `clampAnswerMode("ai", {messages:true, bot:false}) === "off"`), and in `tests/botBrief.test.mts` to `autoReplySteps()`.
- [ ] **Step 2: Run** `npm run test:setup && npm run test:brief` — Expected: FAIL.
- [ ] **Step 3: Implement** the interface; `WhatsAppQuestionsStep`'s `MODE_OPTIONS` becomes two cards: `ai` (label ar "الذكاء الاصطناعي يرد" / en "The AI answers", hint = today's `ai` hint, `rec: true`) and `off` (today's); `modeText` keeps the two keys; `AutoReplySwitch` confirm text drops the mode name: ar `المرضى هيبدأوا ياخدوا ردود تلقائية من المساعد على أي رسالة جديدة. تشغّل؟`, en `Patients will start getting automatic replies from the assistant on every new message. Turn it on?`.
- [ ] **Step 4: Run** `npm run test:setup && npm run test:brief && npx tsc --noEmit -p tsconfig.json` — Expected: pass; tsc errors only in `WhatsAppSettings.tsx` (Task 7).
- [ ] **Step 5: Commit** `git commit -m "Quick setup and the auto-reply switch ask only on or off"`.

### Task 7: The Auto-reply tab shows one assistant

**Files:**
- Modify: `src/components/settings/WhatsAppSettings.tsx` (anchors: 189-193 state init, 319-326 plan flags, 511 `stepReplies`, 541-542, 666-690 mode/brain strings, 1486-1489 `autoReplyMode`/`aiMode`/`modeSteps`, 1507 `interviewButton`, 1595-1612 `repliesStep`, 1708 `{aiMode && (`, 1725-1760 the cap block, 1857-1865 `stepView`, 2768-2900 the mode cards + brain picker), `src/lib/grandTour.ts:1081-1101`, `src/lib/grandTourWalks.ts:350`, `src/lib/screenMap.ts` (the Auto-reply sentence), `src/lib/featureCatalog.ts:48-56` (`whatsappBot` label/desc), `tests/botOwnerRules.test.mts:228+` (UI source checks), `tests/grandTour.test.mts` if it pins the old text
- Delete: `src/components/settings/BotScriptsEditor.tsx`

**Interfaces:**
- Consumes `autoReplySteps()` and `answerModeOf` from Task 6.
- `whatsappBot` catalogue entry: `labelEn: "WhatsApp AI Receptionist"`, `labelAr: "موظف استقبال واتساب بالذكاء الاصطناعي"`, `descEn: "An AI receptionist answers your WhatsApp patients in their own words, quotes only your price list, books, moves and cancels appointments, and hands anything sensitive to a person. Each reply spends one AI credit."`, `descAr: "موظف استقبال ذكي يرد على مرضاك في واتساب بكلامهم، لا يذكر إلا أسعار قائمتك، يحجز ويعدّل ويلغي المواعيد، ويحوّل أي شيء حساس لموظف. كل رد يستهلك رصيد ذكاء اصطناعي واحد."`

- [ ] **Step 1: Update `tests/botOwnerRules.test.mts` UI assertions** so none reference `botAiBrain`, `brainPro`, `answerModeBot`, or `BotScriptsEditor`; add an assertion that the file contains neither `botAiBrain` nor `BotScriptsEditor` nor `botAiMaxReplies`.
- [ ] **Step 2: Run** `npm run test:bot-owner-rules` — Expected: FAIL.
- [ ] **Step 3: Implement**: delete the three mode cards, the brain picker block and the cap block; `ProSetup` + its button (relabelled ar "علّم المساعد عيادتك" / en "Teach the assistant your clinic") render whenever `botInPlan`; `modeSteps = autoReplySteps()`; `aiMode` → `true` (delete the variable and its guards); `interviewButton` guard → `aiInPlan`; delete `repliesStep`, the `replies` key in `stepView`, `stepReplies`/`stepReplyCount` strings, `BotScriptsEditor` import; move `<BotMediaLibrary />` and `<BotMedicineList />` into `behaviourStep` (top); `<BotPlayground />` without props; state init drops `botMode`, `botAiBrain`, `botAiMaxReplies` (lines 189-193; `botScripts` stays so saving never deletes it: keep line 208). Rewrite the tour/map/catalogue text to "one AI receptionist; no menu; replies cost one credit".
- [ ] **Step 4: Run** `npm run test:bot-owner-rules && npm run test:tour && npm run test:features && npx tsc --noEmit -p tsconfig.json && npx eslint src` — Expected: all pass, 0 errors.
- [ ] **Step 5: Commit** `git commit -m "The Auto-reply tab shows one assistant: no mode cards, no brain picker, no fixed replies"`.

### Task 8: Whole-suite green and the live-clinics proof

**Files:**
- Modify: `package.json` scripts (verify every `test:*` still points at an existing file), `scripts/pro-battery.mts` (if it imports anything deleted)
- Create: `tests/botRetiredInputs.test.mts`; proof note `C:\Users\PC\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_9f98d975-52f1-47b7-ab42-8571746a8105\one-brain-proof.md` (outside the repo)

- [ ] **Step 1: Write `tests/botRetiredInputs.test.mts`**: for each of `["1","2","3","0","٣","m1","back_menu","d2026-11-09|","t2026-11-09|05:00 PM|","dr|أحمد"]` and each state in `["new","awaiting_choice","reprompted","booking_doctor","booking_day","booking_time","handed_off"]`, `decide({state, text, ctx:{clinicName:"X", aiAvailable:true}})` returns `action.type === "ai"` with `question === text` (for `handed_off` without `staffActive` too); and `decide` never returns a reply containing `*1*`, `*2*`, `*3*` or `رجوع للقائمة`.
- [ ] **Step 2: Run** `npx tsx tests/botRetiredInputs.test.mts` — Expected: pass (it exercises Task 3's code; a failure is a Task 3 bug — fix there).
- [ ] **Step 3: Run the full bot suite**: `for s in bot bot-one-brain botcases bot-owner-rules bot-lid bot-superseded bot-bubbles pro-prompt pro-answer pro-wiring pro-tools pro-checks pro-layer pro-person pro-onboarding pro-onboarding-routes pro-replay sales quick ads triage brief setup features tour; do npm run test:$s || exit 1; done` — Expected: every script passes. Then `npx tsc --noEmit -p tsconfig.json` (0 errors) and `npx eslint src tests scripts` (clean).
- [ ] **Step 4: Dry-run battery with no key**: `CLINIC_ID=9W2yESJBVvKomhSRkL9m npx tsx scripts/pro-battery.mts --dry` — Expected: exit 0 or 3 with every turn answered by the dry model and the log line reporting zero sends and zero writes (the sink is in-memory). If the script reads production Firestore and the session cannot, record that it was run by the owner's checkout instead (note it in the proof).
- [ ] **Step 5: Write the proof note** (plain language): what changed in routing, the grep showing no `adminClinicDoc(...).set` or `.update` was added to `respond.ts` (`git diff d284e19c -- src/lib/bot/respond.ts | grep '^+' | grep -c '\.set(\|\.update(\|\.add('` = 0 new writes beyond the ones that existed), the test list with results, the battery result, and the three data facts: no migration, old fields unread, `botScripts` read-only.
- [ ] **Step 6: Commit** `git commit -m "Retired-inputs test and package scripts for the one-brain bot"` and report to the owner with the proof; ask before any push.
