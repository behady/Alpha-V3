# The Gemini key — one door, two keys, every call metered

All AI in the product goes to Google through `src/lib/gemini.ts`. Nothing else constructs a
Google client or reads the key. This is what that buys, and what to do with it.

## Environment

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY` | The primary key. Required. Its Google project owns the rulebook cache the bot uses. |
| `GEMINI_API_KEY_FALLBACK` | Optional. A key from a **second Google project** with billing enabled. Used when the primary is refused (bad or revoked key) or has spent its per-minute quota. Its quota is separate, which is the whole point. |

Both are server-only. Neither may ever be prefixed `NEXT_PUBLIC_`.

**Check once:** the project behind each key is on the **paid** tier. On the free tier Google may
use prompts to improve its products, and these prompts carry patient names and clinical notes.

## What happens when Google says no

The rule is `src/lib/geminiRetry.ts`, tested in `tests/geminiClient.test.mts`.

| Google says | Interactive (bot, chat, plans) | Background (nightly/weekly jobs) |
|---|---|---|
| 429 / quota | wait ~0.8s, ~1.6s, ~3.2s and retry; then switch to the fallback key; then fail | five waits up to 20s; then switch; then fail |
| 5xx / overloaded / network | two short retries; switch; fail | three; switch; fail |
| key refused (401/403) | switch immediately; fail if no fallback | same |
| our own timeout | fail (a person is waiting) | one retry |
| 400 / safety / bad output | fail at once — the same call would fail the same way | same |

Worst-case wait for a patient on WhatsApp before the bot gives up is under ten seconds. Every
retry and switch is logged as `[gemini] <feature>: <kind> …`, so a 429 storm can be traced to
the feature causing it.

## Every call is metered, by feature

`geminiModel(params, { feature })` adds each response to a token meter, and the feature's charge
writes it to `ai_usage/{month}.tokensByFeature.{feature}.{model}`. The superadmin **Costs** tab
prices those at the day's rate and shows **Google, by feature** across the platform, plus each
clinic's biggest feature. Feature names in use:

`whatsapp_bot`, `whatsapp_sales`, `whatsapp_voice`, `whatsapp_photo`, `reception`, `chat`,
`treatment_plan`, `plan_translation`, `diagnosis_chat`, `ortho_analyze`, `marketing_single`,
`marketing_month`, `bot_coach`, `bot_memory`, `bot_playbook`.

The three nightly/weekly jobs charge the clinic nothing but still log their tokens under
`credits: 0`, so their cost is visible for the first time.

## Adding an AI feature

```ts
import { GEMINI_MODELS, geminiModel } from "@/lib/gemini";

const model = geminiModel({ model: GEMINI_MODELS.flash, generationConfig: { … } }, { feature: "my_feature" });
const result = await model.generateContent(prompt);
// …then charge through lib/aiQuota with `usage: model.meter.snapshot()`.
```

Use `backgroundGeminiModel` for anything nobody is waiting on. Never call
`new GoogleGenerativeAI` directly — the margin dashboard cannot see what does not go through
here.

## Models

Named once in `GEMINI_MODELS`. Today both are `-latest` aliases, which Google can repoint
without notice; when a version is worth pinning, pin it there and nowhere else. Intro pricing
ends 31 Dec 2026 — `lib/platformCost.ts` already prices dates after that at the doubled rate.
