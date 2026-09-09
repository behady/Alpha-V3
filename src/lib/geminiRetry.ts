/**
 * When to try Google again, and when to give up — as a pure function.
 *
 * No imports on purpose: `lib/gemini.ts` applies this to real calls, and `tests/geminiClient`
 * exercises it directly with fake errors, so the rule that decides whether a patient waits two
 * seconds or gets handed to the receptionist is one that can be read and tested on its own.
 *
 * The one key every clinic shares has one speed limit at Google. Before this existed a 429
 * looked like any other failure: the bot retried the *content* once and handed off, and one
 * clinic's busy morning could quietly break another clinic's assistant. Now: back off and retry
 * on a rate limit or an outage, move to the second key when the first is refused or its quota is
 * spent (a second Google project has its own quota), and fail fast on everything else.
 */

export type GeminiErrorKind = "rate_limited" | "unavailable" | "auth" | "timeout" | "other";

/**
 * What kind of failure this is. `status` comes from the SDK's fetch error when Google answered;
 * the message regexes cover the SDK's own wording and the network errors that never got a status.
 */
export function classifyGeminiError(err: unknown): GeminiErrorKind {
  const e = (err || {}) as { status?: unknown; name?: unknown; message?: unknown; code?: unknown };
  const message = String(e.message || "");
  const name = String(e.name || "");
  const code = String(e.code || "");

  if (name === "GeminiTimeoutError" || /^(ai|gemini|transcribe|describe)_timeout$/.test(message)) return "timeout";

  const status = typeof e.status === "number" ? e.status : Number((message.match(/\[(\d{3}) /) || [])[1]) || 0;

  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(message)) return "rate_limited";
  if (status === 401 || status === 403 || /API key|API_KEY_INVALID|PERMISSION_DENIED|unregistered callers|not authorized/i.test(message)) return "auth";
  if (
    (status >= 500 && status <= 504) ||
    /UNAVAILABLE|overloaded|internal error|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network/i.test(message) ||
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/.test(code)
  ) {
    return "unavailable";
  }
  return "other";
}

export type RetryPolicy = {
  /** Retries on the same key after a 429 before moving to the next key. */
  maxRateLimitRetries: number;
  /** Retries on the same key after a 5xx / network failure before moving to the next key. */
  maxUnavailableRetries: number;
  /** Retries after our own timeout. Zero for anything a person is waiting on. */
  maxTimeoutRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

/** A person — or a patient on WhatsApp — is waiting. Short waits, few of them. */
export const INTERACTIVE_POLICY: RetryPolicy = {
  maxRateLimitRetries: 3,
  maxUnavailableRetries: 2,
  maxTimeoutRetries: 0,
  baseDelayMs: 800,
  maxDelayMs: 6_000,
};

/** A nightly or weekly job. Nobody is waiting; the work should get done. */
export const BACKGROUND_POLICY: RetryPolicy = {
  maxRateLimitRetries: 5,
  maxUnavailableRetries: 3,
  maxTimeoutRetries: 1,
  baseDelayMs: 2_000,
  maxDelayMs: 20_000,
};

export type RetryCounts = { rateLimited: number; unavailable: number; timeouts: number };
export const freshCounts = (): RetryCounts => ({ rateLimited: 0, unavailable: 0, timeouts: 0 });

export type RetryStep =
  | { action: "retry"; delayMs: number }
  | { action: "switch_key" }
  | { action: "fail" };

/** Exponential backoff with jitter between 0.5× and 1.5×, so retries from many clinics spread out. */
export function backoffMs(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const raw = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt));
  return Math.round(raw * (0.5 + random()));
}

/**
 * Decide the next move after a failure of `kind`, given how many retries this key has already
 * had. The caller resets `counts` when it switches key: a fresh key gets its own retries, and the
 * number of keys bounds the total.
 */
export function nextStep(
  kind: GeminiErrorKind,
  counts: RetryCounts,
  keyIndex: number,
  keyCount: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): RetryStep {
  const moreKeys = keyIndex + 1 < keyCount;
  switch (kind) {
    case "auth":
      // A refused key does not become valid by waiting.
      return moreKeys ? { action: "switch_key" } : { action: "fail" };
    case "rate_limited":
      if (counts.rateLimited < policy.maxRateLimitRetries) {
        return { action: "retry", delayMs: backoffMs(counts.rateLimited, policy, random) };
      }
      // The second key is a second project with its own quota — the one time switching helps a 429.
      return moreKeys ? { action: "switch_key" } : { action: "fail" };
    case "unavailable":
      if (counts.unavailable < policy.maxUnavailableRetries) {
        return { action: "retry", delayMs: backoffMs(counts.unavailable, policy, random) };
      }
      return moreKeys ? { action: "switch_key" } : { action: "fail" };
    case "timeout":
      return counts.timeouts < policy.maxTimeoutRetries ? { action: "retry", delayMs: 0 } : { action: "fail" };
    default:
      // Bad request, safety block, unparseable output: the same call will fail the same way.
      return { action: "fail" };
  }
}
