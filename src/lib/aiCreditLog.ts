import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";

/**
 * Token counts for one charged turn, summed across every API round that turn took.
 *
 * Credits are what the clinic is billed; tokens are what WE are billed, and the two are only
 * loosely related — a credit is one message, but a message that makes the assistant read the
 * ledger and then answer costs several round trips, each re-sending the whole context.
 */
export type AiTokenUsage = {
  model: string;
  /** Round trips to the model. One credit is not one call: the chat loop can take up to six. */
  apiCalls: number;
  /** Billed input, cached tokens included — Google counts those inside promptTokenCount. */
  inputTokens: number;
  /** Visible reply tokens. */
  outputTokens: number;
  /**
   * Hidden reasoning tokens. Billed at the OUTPUT rate, and on by default for the Gemini 3.x
   * models, which is why they are worth seeing separately: on a tool-calling turn they are
   * routinely larger than the reply itself, and nothing in this codebase asks for them.
   */
  thoughtTokens: number;
  /** The slice of inputTokens that hit the implicit cache and is billed at a tenth of the rate. */
  cachedTokens: number;
};

export type AiUsageMeter = AiTokenUsage & {
  /** Adds one response's usage to the running total. Safe to call on anything. */
  add(response: unknown): void;
  /** A plain snapshot, for handing to logAiCreditUsage. */
  snapshot(): AiTokenUsage;
};

/**
 * Accumulates token counts across the rounds of a single turn.
 *
 * Deliberately tolerant: `usageMetadata` is optional in the SDK's own types, and
 * `thoughtsTokenCount` is not in them at all (@google/generative-ai 0.24.1 predates thinking
 * models, though the API returns the field). A missing count must never cost anyone an answer,
 * so everything unreadable reads as zero.
 */
export function createUsageMeter(model: string): AiUsageMeter {
  const meter: AiUsageMeter = {
    model,
    apiCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,

    add(response: unknown) {
      meter.apiCalls += 1;
      const usage = (response as any)?.usageMetadata;
      if (!usage) return;
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      meter.inputTokens += n(usage.promptTokenCount);
      meter.outputTokens += n(usage.candidatesTokenCount);
      meter.thoughtTokens += n(usage.thoughtsTokenCount);
      meter.cachedTokens += n(usage.cachedContentTokenCount);
    },

    snapshot() {
      return {
        model: meter.model,
        apiCalls: meter.apiCalls,
        inputTokens: meter.inputTokens,
        outputTokens: meter.outputTokens,
        thoughtTokens: meter.thoughtTokens,
        cachedTokens: meter.cachedTokens,
      };
    },
  };
  return meter;
}

/**
 * A model name is used as a Firestore map key below. Dots are legal in a key set through a nested
 * object, but they are field-path separators the moment anyone reaches for `update()`, so they are
 * flattened here rather than left as a trap for a later refactor.
 */
const modelKey = (model: string) => (model || "unknown").replace(/\./g, "_");

/**
 * The Firestore increments for one token bundle.
 *
 * Exported because the marketing studio keeps its own meter — its credits are sold separately and
 * must never be confused with the chair-side assistant's — but should record tokens the same way.
 */
export function tokenIncrements(usage: AiTokenUsage) {
  return {
    apiCalls: FieldValue.increment(usage.apiCalls),
    input: FieldValue.increment(usage.inputTokens),
    output: FieldValue.increment(usage.outputTokens),
    thoughts: FieldValue.increment(usage.thoughtTokens),
    cached: FieldValue.increment(usage.cachedTokens),
  };
}

/**
 * One row per AI credit charge, so the Settings page can show WHERE the month's credits went
 * instead of just how many are gone.
 *
 * Two writes per charge: an append-only row in `ai_usage_log` (the visible history) and a
 * per-feature counter on the monthly `ai_usage` doc (the exact breakdown, immune to the log
 * page's row limit). Both are server-only writes — firestore.rules deny clients, because a
 * meter a clinic member can edit is not a meter.
 *
 * Token counts ride along on both when the caller measured them. They are stored raw, never as a
 * money figure: the per-token price changes on Google's schedule, and a cost baked into a document
 * at write time would quietly become wrong. Whatever reads this multiplies by the rate of the day.
 *
 * Logging must never cost anyone an answer: every failure is swallowed after a console line.
 */
export async function logAiCreditUsage(opts: {
  clinicId: string;
  /** e.g. "chat", "reception", "treatment_plan", "plan_translation", "diagnosis_chat" */
  feature: string;
  credits: number;
  userId?: string;
  userName?: string;
  patientId?: string;
  patientName?: string;
  detail?: string;
  /** What this turn actually cost us, from `createUsageMeter`. Omit and only credits are recorded. */
  usage?: AiTokenUsage;
}): Promise<void> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const u = opts.usage;
  try {
    await Promise.all([
      adminClinicCollection(opts.clinicId, "ai_usage_log").add({
        feature: opts.feature,
        credits: opts.credits,
        userId: opts.userId || "",
        userName: opts.userName || "",
        patientId: opts.patientId || "",
        patientName: opts.patientName || "",
        detail: opts.detail || "",
        monthKey,
        ...(u
          ? {
              model: u.model,
              apiCalls: u.apiCalls,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              thoughtTokens: u.thoughtTokens,
              cachedTokens: u.cachedTokens,
            }
          : {}),
        createdAt: FieldValue.serverTimestamp(),
      }),
      adminClinicDoc(opts.clinicId, "ai_usage", monthKey).set(
        {
          byFeature: { [opts.feature]: FieldValue.increment(opts.credits) },
          ...(u
            ? {
                tokens: tokenIncrements(u),
                // Split by model because the bill cannot be reconstructed without it: the Pro
                // model behind "super mode" costs several times what Flash does per token.
                byModel: { [modelKey(u.model)]: tokenIncrements(u) },
              }
            : {}),
        },
        { merge: true }
      ),
    ]);
  } catch (e) {
    console.error("Failed to log AI credit usage", e);
  }
}
