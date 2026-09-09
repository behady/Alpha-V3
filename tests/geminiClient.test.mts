import assert from "node:assert/strict";
import {
  BACKGROUND_POLICY,
  INTERACTIVE_POLICY,
  backoffMs,
  classifyGeminiError,
  freshCounts,
  nextStep,
} from "../src/lib/geminiRetry";

/**
 * What the platform does when Google says no.
 *
 * One key serves every clinic, so one clinic's busy morning can push another clinic's bot into a
 * 429. The rule here decides whether that patient waits two seconds or gets handed to the
 * receptionist. The assertions that matter: a rate limit is retried, then moved to the second
 * key (a second project, a second quota); a refused key switches at once; a bad request never
 * retries, because it would fail the same way; and a person waiting never waits on a timeout.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const fetchErr = (status: number, message = "") => Object.assign(new Error(`[GoogleGenerativeAI Error]: Error fetching from Google: [${status} x] ${message}`), { status });
const noJitter = () => 0.5; // 0.5 + 0.5 = 1.0× — exact base delays

/* ------------------------------------------------------------------ classification */

run("Google's status codes and its wording both classify", () => {
  assert.equal(classifyGeminiError(fetchErr(429)), "rate_limited");
  assert.equal(classifyGeminiError(new Error("RESOURCE_EXHAUSTED: Quota exceeded for quota metric")), "rate_limited");
  assert.equal(classifyGeminiError(fetchErr(503)), "unavailable");
  assert.equal(classifyGeminiError(new Error("The model is overloaded. Please try again later.")), "unavailable");
  assert.equal(classifyGeminiError(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })), "unavailable");
  assert.equal(classifyGeminiError(fetchErr(403, "API key not valid")), "auth");
  assert.equal(classifyGeminiError(new Error("[400 Bad Request] API_KEY_INVALID")), "auth", "a bad key is auth even when Google says 400");
  assert.equal(classifyGeminiError(Object.assign(new Error("ai_timeout"), { name: "GeminiTimeoutError" })), "timeout");
  assert.equal(classifyGeminiError(new Error("ai_timeout")), "timeout", "the bot's old timeout message still counts");
  assert.equal(classifyGeminiError(fetchErr(400, "Role 'function' is not supported")), "other");
  assert.equal(classifyGeminiError(new SyntaxError("Unexpected token")), "other");
  assert.equal(classifyGeminiError(undefined), "other");
});

run("a status embedded only in the message is still read", () => {
  assert.equal(classifyGeminiError(new Error("[GoogleGenerativeAI Error]: [429 Too Many Requests] slow down")), "rate_limited");
  assert.equal(classifyGeminiError(new Error("[502 Bad Gateway]")), "unavailable");
});

/* ------------------------------------------------------------------ the policy */

run("a rate limit is retried with growing waits, then the second key is tried, then it fails", () => {
  const counts = freshCounts();
  const steps: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s = nextStep("rate_limited", counts, 0, 2, INTERACTIVE_POLICY, noJitter);
    steps.push(s.action === "retry" ? `retry:${s.delayMs}` : s.action);
    if (s.action === "retry") counts.rateLimited += 1;
    if (s.action !== "retry") break;
  }
  assert.deepEqual(steps, ["retry:800", "retry:1600", "retry:3200", "switch_key"]);
  // On the last key there is nowhere to go.
  const spent = { ...freshCounts(), rateLimited: INTERACTIVE_POLICY.maxRateLimitRetries };
  assert.deepEqual(nextStep("rate_limited", spent, 1, 2, INTERACTIVE_POLICY, noJitter), { action: "fail" });
  assert.deepEqual(nextStep("rate_limited", spent, 0, 1, INTERACTIVE_POLICY, noJitter), { action: "fail" }, "with one key, exhausting retries is the end");
});

run("a refused key switches immediately and never waits", () => {
  assert.deepEqual(nextStep("auth", freshCounts(), 0, 2, INTERACTIVE_POLICY), { action: "switch_key" });
  assert.deepEqual(nextStep("auth", freshCounts(), 1, 2, INTERACTIVE_POLICY), { action: "fail" });
  assert.deepEqual(nextStep("auth", freshCounts(), 0, 1, INTERACTIVE_POLICY), { action: "fail" });
});

run("an outage is retried briefly, then the other key, then fails", () => {
  const c = freshCounts();
  assert.equal(nextStep("unavailable", c, 0, 2, INTERACTIVE_POLICY, noJitter).action, "retry");
  c.unavailable = INTERACTIVE_POLICY.maxUnavailableRetries;
  assert.deepEqual(nextStep("unavailable", c, 0, 2, INTERACTIVE_POLICY), { action: "switch_key" });
  assert.deepEqual(nextStep("unavailable", c, 1, 2, INTERACTIVE_POLICY), { action: "fail" });
});

run("a bad request is never retried — it would fail the same way and cost the same", () => {
  assert.deepEqual(nextStep("other", freshCounts(), 0, 2, INTERACTIVE_POLICY), { action: "fail" });
  assert.deepEqual(nextStep("other", freshCounts(), 0, 2, BACKGROUND_POLICY), { action: "fail" });
});

run("a person waiting never waits on a timeout; a nightly job may try once more", () => {
  assert.deepEqual(nextStep("timeout", freshCounts(), 0, 2, INTERACTIVE_POLICY), { action: "fail" });
  assert.deepEqual(nextStep("timeout", freshCounts(), 0, 2, BACKGROUND_POLICY), { action: "retry", delayMs: 0 });
  assert.deepEqual(nextStep("timeout", { ...freshCounts(), timeouts: 1 }, 0, 2, BACKGROUND_POLICY), { action: "fail" });
});

run("backoff doubles, is capped, and jitters between half and one-and-a-half times", () => {
  assert.equal(backoffMs(0, INTERACTIVE_POLICY, noJitter), 800);
  assert.equal(backoffMs(1, INTERACTIVE_POLICY, noJitter), 1600);
  assert.equal(backoffMs(10, INTERACTIVE_POLICY, noJitter), INTERACTIVE_POLICY.maxDelayMs, "capped");
  assert.equal(backoffMs(0, INTERACTIVE_POLICY, () => 0), 400, "lowest jitter is half");
  assert.equal(backoffMs(0, INTERACTIVE_POLICY, () => 0.999), 1199, "highest jitter is just under 1.5×");
  // The whole interactive budget on one key stays under ten seconds even at maximum jitter:
  // a patient on WhatsApp is waiting for this.
  const worst = [0, 1, 2].reduce((n, i) => n + backoffMs(i, INTERACTIVE_POLICY, () => 0.999), 0);
  assert.ok(worst < 10_000, `worst-case interactive wait ${worst}ms`);
});

run("the background policy is more patient in every dimension", () => {
  assert.ok(BACKGROUND_POLICY.maxRateLimitRetries > INTERACTIVE_POLICY.maxRateLimitRetries);
  assert.ok(BACKGROUND_POLICY.maxUnavailableRetries > INTERACTIVE_POLICY.maxUnavailableRetries);
  assert.ok(BACKGROUND_POLICY.maxTimeoutRetries > INTERACTIVE_POLICY.maxTimeoutRetries);
  assert.ok(BACKGROUND_POLICY.maxDelayMs > INTERACTIVE_POLICY.maxDelayMs);
});
