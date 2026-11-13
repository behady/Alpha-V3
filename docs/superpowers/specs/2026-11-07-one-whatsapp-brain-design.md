# One WhatsApp brain — retiring the old AI and the menu bot

Date: 2026-11-07. Status: design approved by the owner in conversation (plain-language version); this is the written record. Nothing is built yet.

## 1. Why

Two AI brains answer WhatsApp patients today. The old one (`src/lib/bot/aiReply.ts`, Gemini Flash) sits behind a scripted menu engine (`src/lib/bot/engine.ts`: "send 1 to book, 2 for hours, 3 for a person", numbered day/time lists). The new "Pro" brain (`src/lib/botPro/`) reads the whole chat, searches the calendar itself, books/moves/cancels through its own tools and carries a learned clinic layer. Asnany (`9W2yESJBVvKomhSRkL9m`) has piloted it since 2026-11-02: 150 chats, 537 AI turns, 6 bot bookings in the first week.

On 2026-11-07 the owner reviewed the week and decided: the new brain runs on Flash (the Pro model hit the 250/day Tier-1 quota and the spending cap on Nov 4 and knocked the bot out for three hours), and the old brain plus the menu bot are deleted so one brain remains.

## 2. Decisions (owner, 2026-11-07)

| Topic | Decision |
|---|---|
| Who gets the new brain | Every clinic whose auto-reply switch (`botEnabled`) is on. "Bot only" clinics move to the AI too and spend credits per reply. |
| Model | Whatever `GEMINI_PRO_MODEL` names (Flash today), on `GEMINI_PRO_API_KEY`. No code change to the model choice. |
| Price | 1 credit per brain reply (the old brain's price), so no clinic's bill changes on switch day. The token log measures the real cost; the owner sets the final price after a month. |
| Free layer in code | Opt-out, the emergency-symptom triage (to a person), "thanks", and a bare "ok" that confirms an appointment within two days. Everything else goes to the brain. |
| Fixed replies (`botScripts`) | Retired as a feature: no code matching, editor removed. Text already written is not deleted and reaches the brain as clinic knowledge (section 5). |
| Menu, lists, digits | Deleted. Old buttons a patient taps later arrive as text and the brain reads them (d284e19c already made a bare digit the model's business). |
| Pro add-on, brain picker, mode cards | Removed. The `whatsappPro` catalogue entry goes; `whatsappBot` is the bot's add-on; the credit pool still comes with `aiChat` (section 6). |
| Rollout | One deploy, every clinic at once: routing is code; no clinic document is written or migrated. |

## 3. Red lines carried over unchanged

The Pro spec's locked rules (no invented prices, no medicine beyond the clinic's approved list, no double booking, persona rule) and every code guard that runs on a reply (drug guard, number guard, medicine screening, clinical triage, opt-out footer, quiet hours, 15 replies/hour, 40 turns/conversation, staff claim pauses the bot) are untouched by this change.

## 4. What a turn looks like after

`respondToPatientMessage` (`src/lib/bot/respond.ts`) keeps every gate in front of the brain (bot off, opt-out, quiet hours, staff active, rate limits, lid phone resolution, patient lookup). After the gates:

1. Media with no text: a photo already described → the brain with the description (today's `photo_ai`); audio that could not be transcribed, or an unreadable photo → today's fixed "we received it, a person will look" and a handoff. Unchanged.
2. Text: a small pure decider replaces `decideBotReply`. In order: opt-out → silent; `needsHuman` → dentist-mode AI (`clinical: true`) when the clinic chose it and the AI is available, else the clinical handoff line; `handed_off` with a staff member active → silent; "thanks" → one courtesy line; "ok" with an appointment inside two days → confirm it (today's `ack` action); everything else → `{ type: "ai", question: text }`.
3. The AI action runs `answerWithPro` only. There is no `pickReply`, no `answerWithAi`. Unavailable (no key, no plan, no credits, timeout, model error) → the ladder from d284e19c: `no_credits`/`plan` → "a person will contact you" + owner alert (12-hour throttle); first other failure → "please resend"; second in a row → handoff. No menu branch exists any more.
4. The brain's answer handling (book_slot, open_booking without a spoken offer, reschedule, cancel, late, medicine, media, handoff topics, doctor-name stripping, spoken-pick resolution, bubbles, localisation, lead grading, ai_debug) stays as it is today for the Pro path.

What `open_booking` means without lists: today an `open_booking` whose sentence names no slot opens the dentist/day lists. After: the caller fetches the next slots (`nextSlots`) and asks the brain nothing new — it replies with the brain's sentence plus the slot offer rendered as today's spoken-offer text, stores the slot keys as `pendingSlots`, and the next turn's pick resolves through the existing `resolveSpokenPick`/`book_slot` path. For a stranger with no record the name question (`booking_name`) stays: it is a brain-driven step already (a greeting or question at the name step goes to the brain; a plain name registers). `register` then books the pending slot as today.

Conversation states: `new`, `awaiting_choice`, `booking_name`, `handed_off` remain. `reprompted`, `booking_doctor`, `booking_day`, `booking_time` are no longer produced; a conversation stored in one of them is read as `awaiting_choice` with its `pendingSlots` kept, so a chat mid-list on deploy day gets a normal brain reply on its next message.

## 5. Clinic data: nothing written

- No migration. `botMode`, `botAiEnabled`, `botAiBrain`, `botAiMaxReplies`, `botScripts` stay in every clinic's `settings/whatsapp` document; the server stops reading the first four.
- `botScripts` is read once per turn as it is today and folded into the brain's `knowledge` list (trigger words as the question, reply as the answer), capped with the existing 40-entry knowledge limit. A clinic's wording survives in the brain's voice. The editor and the "Fixed replies" step disappear from the UI; the type stays so old documents still parse.
- `bot_knowledge`, `botCoaching`, `botBrief`, the playbook, conversation `memory`, the learned clinic layer: all read by the Pro brain today, unchanged.
- The nightly `bot-memory` and `bot-coach` jobs call Gemini directly on `GEMINI_API_KEY`; they are not the old brain and stay. Their "is AI on" check becomes `botEnabled === true`.

## 6. Plans, add-ons, credits

- The bot needs `whatsappBot`. Replies spend the clinic's AI credit pool, which `aiChat` provides (`getAiCreditLimit` returns 0 without it, and 0 means "no pool", so the `aiChat` check must stay or a clinic with no pool would answer unmetered). Every plan tier that includes `whatsappBot` includes `aiChat`; a per-clinic override without it gets the `plan` handoff + owner alert.
- `whatsappPro` is removed from the feature catalogue, the subscription tiers, the saas type, the playground route and the settings UI. `proContext`'s `plan_pro` verdict goes.
- `PRO_CREDITS_PER_REPLY` becomes 1. The `whatsapp_sales` credit-log feature key stays so monthly reports keep one line.

## 7. UI

Auto-reply tab (`src/components/settings/WhatsAppSettings.tsx`): the on/off switch stays; the three answer-mode cards, the Standard/Pro picker and the "AI replies per conversation" cap are removed; "Teach the assistant your clinic" (today's "Teach Pro your clinic", `ProSetup`) shows for every clinic with the bot in its plan. Steps shown: About your clinic, How the AI should talk, Behaviour and limits, Test it (`stepsForMode` collapses to one list; the Fixed replies step goes). The test chat (`BotPlayground`) loses its "try Pro" toggle: every rehearsal is the one brain.

Quick setup (`src/lib/setupWizard.ts`, `WhatsAppQuestionsStep`): the "who answers" question becomes on/off; it writes `botEnabled` only. `answerModeOf`/`chosenAnswerMode` collapse to on/off for the `AutoReplySwitch`.

Text that describes the menu bot or the brain choice (`grandTour.ts`, `grandTourWalks.ts`, `screenMap.ts`, the `whatsappBot` catalogue description, the WhatsApp settings strings) is rewritten to describe one AI receptionist.

## 8. Code that goes

- `src/lib/bot/aiReply.ts` (the old brain). `AI_DEFAULT_ACK`, `AiReplyResult`, `AiThreadLine`, `AiPatientContext` move to a small `src/lib/bot/aiTypes.ts` since the Pro path and tests use them.
- `src/lib/bot/botPrompt.ts` shrinks to what Pro imports: `factLines`, `clinicAndPatientLayer`, `LANGUAGE_RULE`, `HIDE_DOCTOR_NAMES_RULE`, `PHONE_HIDDEN_LINE`, `BRANCHES_RULE`, `BotPromptInput`, `AiPatientContext`, and `SALES_VOICE` as an exported constant that `proPrompt.ts` imports instead of copying (the source-reading drift test becomes an import equality test). `buildBotPrompt`, `fixedPromptLayers`, `promptVersion`, the assisted/sales job and voice blocks and the old rule lists are deleted.
- `src/lib/bot/engine.ts`: `decideBotReply`, `parseTapId`, `menuChoice`, `numberChoice`, `startBooking`, `greeting`, `hoursAndAddress`, `answerIntent`, `factReply`, `locationReply`, `ASK_PHONE_REPLY`, `HANDOFF_REPLY`, the booking actions. What remains (`BotState`, `BotContext` trimmed, `clinicalReplyText`, `urgentCallLine`, the tiny decider) moves to `src/lib/bot/decide.ts`; `engine.ts` is deleted.
- `src/lib/bot/scripts.ts` keeps `cleanScripts` only (for the knowledge fold); `matchScript`/`parseTriggers` and `BotScriptsEditor.tsx` go.
- `src/lib/botPro/brain.ts` (`aiBrainOf`, `pickReply`, `dryRunBrainTag`, `playgroundOutcome`) goes; `respond.ts` calls `answerWithPro` directly.
- In `respond.ts`: `menuButtons`, `optionList`, `renderDayList`, `renderTimeList`, `upcomingOpenDays`, `listDoctors`/`listDays`/`listTimes`, the `list_*`/`book`/`relist`/`open_now`/`price_list`/`my_appointment`/`reschedule_start`-by-intent branches, `MENU_ON_SCREEN_REASONS`, `ctx.menuShown`, the `structure` buttons on plain answers, the "assisted" `history` memory, the `aiMaxReplies` cap. `bookAt`, `startReschedule`, `flagAppointmentChange`, `register`, the medicine screening, the spoken-pick code and everything after the reply is composed stay.
- `localize.ts` menu/list rows that no code emits any more are dropped; the rest stays.
- `quickAnswers.ts` keeps `normalize`, `has`, `quickIntent` (used for thanks/ack/human detection and lead grading), `isDecline`, `mentionsRelative`, `looksLikeQuestion`; unused intent word lists may stay (they are data, and `quickIntent` is still called by the misses panel and lead code) — pruning them is not part of this change.

## 9. Tests

- Delete: `botEngine.test.mts` (the menu machine), `botPrompt.test.mts` (the old prompt), `botScripts.test.mts`, `botAiFirstFallback.test.mts` (its source assertions describe the deleted ladder), `botProWiring.test.mts` parts about `pickReply`.
- Rewrite: a `botDecide.test.mts` for the small decider (opt-out silent, clinical handoff vs dentist mode, thanks, ok-confirms, everything else → ai, handed_off with staff → silent); `botProPrompt.test.mts` voice check becomes an import equality; `botOwnerRules`, `botBubbles`, `botSuperseded`, `botLidChats`, `botTestCases` keep passing (they test shared pieces); a new source-assertion test pins the failure ladder (`no_credits` → alert, first miss → resend, second → handoff, and `menuButtons(` absent from `respond.ts`).
- `npm run test:bot*` scripts in `package.json` updated to the surviving files; `tsc --noEmit` and `eslint` clean.
- Proof for the live-clinics gate: the dry-run replay (`scripts/pro-battery.mts --dry`, fake model, no key) over the saved cases plus a scripted set of the retired menu inputs ("1", "2", "3", "0", a stale `t2026-…|…` tap id, a conversation stored at `booking_day`) shows a reply or handoff on every one, zero Firestore writes (the dry-run sink), zero sends.

## 10. Not in this change

- No model, key or Vercel environment change.
- No Firestore migration or backfill; no deletion of old fields.
- No change to the WhatsApp gateway, Meta webhook parsing, or the Android app.
- No new owner-facing feature; no change to the learned layer or the onboarding chat beyond the button being visible to every clinic.
- Pruning unused keyword lists in `quickAnswers.ts`, and the monthly credit price review.
