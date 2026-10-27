# WhatsApp Auto-reply: one tab, three modes, guided AI setup

Date: 2026-10-28 · Status: approved design, awaiting spec review

## Why

Owner: "WhatsApp AI is so bad to set up and let it know what each clinic wants."

Today the Bot tab holds a 4-way "who answers" picker plus every bot switch, the ready answers and
the test chat; the AI tab is separate and teaches the AI about the clinic through one empty
"instructions" box. Picking "AI only" still shows every bot setting, and there is no guided way to
tell the AI what the clinic wants.

## What changes for the clinic

### Modes (unchanged storage, clearer words)

| Card | Meaning shown on the card | Stored as (as today) |
|---|---|---|
| Off | Nobody answers; staff reply by hand. | `botEnabled: false` |
| Bot only | Free. Fixed answers, menus, booking buttons. Unknown questions go to staff. | `botEnabled, botMode: "assisted", botAiEnabled: false` |
| AI only | The AI leads every chat like a salesperson. Bookings, cancelling and "تمام" confirmations still run on the system's buttons. Costs credits. | `botEnabled, botMode: "ai_first", botAiEnabled: true` |
| Bot + AI | The bot answers what it can for free; the AI handles only the rest, up to a per-chat limit. | `botEnabled, botMode: "assisted", botAiEnabled: true` |

Cards the clinic has not bought stay visible, locked, with the reason (today's rule). "AI only" still
needs the Bot add-on (the AI runs inside the bot engine).

### One "Auto-reply" tab (الرد الآلي)

The WhatsApp page's **Bot** and **AI** tabs become one tab, **Auto-reply**, at `/chats/bot`. Mode
cards on top; under them a numbered list of the chosen mode's steps only. Each step opens in place
(one open at a time) and shows a progress badge.

| # | Step | Bot only | AI only | Bot + AI | Badge |
|---|---|---|---|---|---|
| 1 | About your clinic: the existing `botFacts` boxes | ✓ | ✓ | ✓ | "4 of 14 filled" |
| 2 | Fixed replies: scripts, photo library, medicine list | ✓ | optional, shown last | ✓ | "3 replies" |
| 3 | How the AI should talk: new guided cards (below) | – | ✓ | ✓ | "2 of 5 filled" |
| 4 | Behaviour and limits | bot parts only | ✓ | ✓ | none |
| 5 | Test it: the existing playground | ✓ | ✓ | ✓ | none |

Step 4 contents:
- All modes: answer unknown numbers, auto-confirm bookings, minutes a staff reply keeps the bot out.
- AI modes only: AI name, replies per chat (+ unlimited), human touch, quiet nudge, dentist mode.

With mode **Off**, no steps show — just a line saying messages collect in Chats.

Fixed replies stay in AI only because the engine already runs them before the AI in that mode
(`engine.ts` matches scripts before the `aiFirst` branch). Behaviour is deliberately left as is so
no live clinic changes; the step is labelled "optional — these fire before the AI".

### New: "How the AI should talk" (step 3)

Stored as `settings/whatsapp.botBrief`:

```ts
type BotBrief = {
  focus?: string;        // what to push, e.g. "implants and whitening"
  tone?: "friendly" | "formal" | "short";   // absent = friendly (today's voice)
  prices?: "ranges" | "consult";            // absent = ranges (today's rule)
  neverSay?: string;     // topics/words never to discuss
  handoffWhen?: string;  // always pass to staff when…
};
```

Plus "Anything else" = the existing `botCoaching` box, unchanged.

Each card has a one-line Arabic example as placeholder. Badge counts the 5 brief fields + coaching
as filled when non-empty / non-default.

**Prompt:** `buildBotPrompt` gets `brief?: BotBrief` and renders it in layer 5 (the clinic layer),
next to the owner's instructions, as clinic preferences. Layers 1–4 stay byte-identical (cacheable,
pinned by `test:prompt`). Every option can only make the AI stricter: `consult` forbids quoting
prices; `formal` and `short` change voice only. Layer 1's "if two rules conflict, the higher wins"
already keeps safety on top. Default values add no lines, so a clinic that never opens the cards
gets today's prompt exactly.

Writes go through a `cleanBrief` that drops empty/default keys and never writes `undefined`
(Firestore rejects it in the browser).

### New: "Interview me"

A button at the top of steps 1 and 3 (AI modes only; needs the AI add-on).

1. Dialog: one text box — "Tell us about your clinic in your own words" — with an example.
2. `POST /api/whatsapp/brief-draft` `{ clinicId, text }` (admin of that clinic only; text ≤ 3,000
   chars). One Gemini call with a JSON schema returns suggested `botFacts` fields and `botBrief`
   fields. Charged as 1 AI credit, logged through `logAiCreditUsage` like `broadcasts/review`.
   Refused when the clinic has no AI add-on or no credits.
3. Review list: each suggested field with its value; fields that already hold something show
   "replaces: <old>" and start unticked. Owner ticks/unticks, presses **Apply**. Only then is
   anything written (one save). Cancel writes nothing.

The model is told to extract only what the owner wrote and leave unknown fields empty — never to
invent durations, prices, warranties.

## What does not change

- The stored mode fields, so every live clinic answers exactly as now.
- The bot engine's order (`engine.ts`), `respond.ts`, the /setup wizard, the Bot misses tab, the
  WhatsApp Settings tab, the Chats tab.

## Routes and links

- `/chats/bot` → the Auto-reply tab. `?step=ai` opens step 3.
- `/chats/ai` → redirects to `/chats/bot?step=ai`.
- Registry `whatsapp_ai`: `movedTo: "/chats/bot?step=ai"`; still found by Settings search.
- Tab gate: shown when `whatsappBot` or `aiChat` is unlocked (locked-with-padlock to admins otherwise).
- References to update: `chats/layout.tsx`, `settingsRegistry.ts`, `panels.tsx`,
  `WhatsAppSettingsTab.tsx`, `aiNavigation.ts`, `grandTour.ts`, `screenMap.ts` (tour stops
  `whatsapp-tab-ai` → the step).

## Code shape

- `WhatsAppSettings.tsx` keeps the state, listener and save; section `"bot"` renders the mode cards
  and step list instead of the Bot/AI tab strip, reusing today's blocks inside steps. Section `"ai"`
  is removed.
- New `components/whatsapp/AutoReplySteps.tsx` (step list + badges, pure props).
- New `components/whatsapp/BotBriefEditor.tsx` (the five cards).
- New `components/whatsapp/InterviewDialog.tsx` (dialog + review list).
- New `lib/bot/brief.ts`: `BotBrief`, `cleanBrief`, `briefLines` (prompt text), `briefFilled`,
  `factsFilled`, `stepsForMode(mode)`.

## Testing

- Unit (`tests/botBrief.test.mts`): `cleanBrief` drops empties/defaults and never yields
  `undefined`; `briefLines` empty for defaults; `stepsForMode` per mode; badge counts.
- `npm run test:prompt` still passes: layers 1–4 unchanged, default brief = today's prompt.
- Route test on the Firestore emulator for `brief-draft`: non-admin refused, no-AI clinic refused,
  model output filtered to known fields.
- Browser: demo clinic, each of the 4 modes shows the right steps; fill a card, reload, it stuck;
  interview → review → apply writes only ticked fields; `/chats/ai` redirects; Arabic + English;
  phone width.
- `tsc`, `eslint`, `test:bot`, `test:scripts`, grand tour test.

## Out of scope

- Making AI only ignore fixed replies.
- A back-and-forth interview chat.
- Changing which bot/AI add-ons exist or what they cost.
