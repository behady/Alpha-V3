import {
  GoogleGenerativeAI,
  type GenerateContentRequest,
  type GenerateContentResult,
  type ModelParams,
  type Part,
} from "@google/generative-ai";
import { createUsageMeter, type AiUsageMeter } from "@/lib/aiCreditLog";
import {
  BACKGROUND_POLICY,
  INTERACTIVE_POLICY,
  classifyGeminiError,
  freshCounts,
  nextStep,
  type RetryPolicy,
} from "@/lib/geminiRetry";

/**
 * The one door to Google for every AI feature.
 *
 * Twelve files used to construct their own `GoogleGenerativeAI` client. That meant twelve places
 * with no retry, no timeout, no second key and — for half of them — no record of what the call
 * cost. This module owns all four:
 *
 *   - **Keys.** `GEMINI_API_KEY` first; `GEMINI_API_KEY_FALLBACK` (a second Google project) when
 *     the first is refused or its quota is spent. Server-only, never bundled to a client.
 *   - **Models.** Named once, in `GEMINI_MODELS`. Google can repoint a `-latest` alias without
 *     telling anyone; when a version is pinned, it is pinned here and nowhere else.
 *   - **Retry.** Rate limits and outages back off and retry; a refused key switches; anything
 *     else fails fast. The policy is `lib/geminiRetry.ts`, pure and tested.
 *   - **Metering.** Every response is added to a usage meter, so the per-feature cost picture
 *     has no holes: a feature that goes through here is a feature whose Google bill is known.
 *
 * Deliberately a thin wrapper over `generateContent` only. Nothing in this codebase streams or
 * uses the SDK's chat helper (see the note in api/gemini/route.ts on why), so that is the whole
 * surface.
 */

/** Model names, in one place. Pin to an exact version here when Google publishes one worth pinning. */
export const GEMINI_MODELS = {
  /** The workhorse: the bot, the assistant, plans, translations, every background job. */
  flash: "gemini-flash-latest",
  /** "Super mode" — several times the price per token; only where a route asks for it. */
  pro: "gemini-pro-latest",
} as const;

export const GEMINI_KEY_ENV = "GEMINI_API_KEY";
export const GEMINI_FALLBACK_KEY_ENV = "GEMINI_API_KEY_FALLBACK";

/** The keys in the order they are tried. Empty when the primary is not configured. */
export function geminiKeys(): string[] {
  const primary = (process.env[GEMINI_KEY_ENV] || "").trim();
  const fallback = (process.env[GEMINI_FALLBACK_KEY_ENV] || "").trim();
  if (!primary) return [];
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

export function hasGeminiKey(): boolean {
  return geminiKeys().length > 0;
}

/** The key for callers that still talk to Google over raw REST (TTS). Prefer `geminiModel`. */
export function primaryGeminiKey(): string {
  return geminiKeys()[0] || "";
}

export class GeminiTimeoutError extends Error {
  constructor(ms: number) {
    // The message is what older callers matched on; keep it.
    super("ai_timeout");
    this.name = "GeminiTimeoutError";
    (this as { ms?: number }).ms = ms;
  }
}

export type GeminiModelOptions = {
  /**
   * What this call is for — "whatsapp_bot", "treatment_plan", "bot_playbook"… Logged on every
   * retry line so a 429 storm can be traced to the feature causing it. Not stored by this module.
   */
  feature: string;
  /** Per-call ceiling. Default 60s; the bot passes its own, shorter one. */
  timeoutMs?: number;
  /** INTERACTIVE_POLICY unless a background job says otherwise. */
  policy?: RetryPolicy;
  /** Bring your own meter (the chat route creates one before it knows the model). */
  meter?: AiUsageMeter;
  /**
   * Explicit context caching, primary key only. A cache lives in one Google project, so on the
   * fallback key the plain `params` (which carry the system instruction inline) are used instead —
   * same answer, full price for that one call.
   */
  cached?: { name: string; params: ModelParams };
};

export type GeminiRequest = GenerateContentRequest | string | Array<string | Part>;

export type GeminiModel = {
  modelName: string;
  meter: AiUsageMeter;
  generateContent(request: GeminiRequest): Promise<GenerateContentResult>;
};

const DEFAULT_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new GeminiTimeoutError(ms)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * A model handle that retries, times out, falls back and meters.
 *
 * `params` are exactly what `getGenerativeModel` takes. Throws synchronously when no key is
 * configured, so a route can fail its request cleanly instead of on the first call.
 */
export function geminiModel(params: ModelParams, opts: GeminiModelOptions): GeminiModel {
  const keys = geminiKeys();
  if (keys.length === 0) throw new Error(`${GEMINI_KEY_ENV} is missing.`);

  const policy = opts.policy ?? INTERACTIVE_POLICY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const meter = opts.meter ?? createUsageMeter(params.model);

  const build = (keyIndex: number) => {
    const genAI = new GoogleGenerativeAI(keys[keyIndex]);
    if (opts.cached && keyIndex === 0) {
      return genAI.getGenerativeModelFromCachedContent(
        { name: opts.cached.name, model: params.model, contents: [] },
        opts.cached.params,
      );
    }
    return genAI.getGenerativeModel(params);
  };

  return {
    modelName: params.model,
    meter,
    async generateContent(request) {
      let keyIndex = 0;
      let counts = freshCounts();
      let model = build(keyIndex);

      for (;;) {
        try {
          const result = await withTimeout(model.generateContent(request), timeoutMs);
          meter.add(result.response);
          return result;
        } catch (err) {
          const kind = classifyGeminiError(err);
          const step = nextStep(kind, counts, keyIndex, keys.length, policy);

          if (step.action === "fail") throw err;

          if (step.action === "switch_key") {
            keyIndex += 1;
            counts = freshCounts();
            model = build(keyIndex);
            console.warn(`[gemini] ${opts.feature}: ${kind} on key #${keyIndex} — switching to key #${keyIndex + 1}`);
            continue;
          }

          if (kind === "rate_limited") counts.rateLimited += 1;
          else if (kind === "unavailable") counts.unavailable += 1;
          else if (kind === "timeout") counts.timeouts += 1;
          console.warn(`[gemini] ${opts.feature}: ${kind} — retry in ${step.delayMs}ms (key #${keyIndex + 1})`);
          await sleep(step.delayMs);
        }
      }
    },
  };
}

/** For nightly and weekly jobs: patient waits, longer backoff, one timeout retry. */
export function backgroundGeminiModel(params: ModelParams, opts: Omit<GeminiModelOptions, "policy">): GeminiModel {
  return geminiModel(params, { ...opts, policy: BACKGROUND_POLICY });
}
