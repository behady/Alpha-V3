/**
 * Which brain answers a WhatsApp conversation: the standard one (answerWithAi) or the Pro one.
 *
 * Pro needs all three: the clinic chose it (botAiBrain is exactly "pro"), the whatsappPro add-on
 * is unlocked for the clinic, and the clinic runs AI-first. Anything else is the standard brain,
 * so a clinic that never touched the setting behaves exactly as before.
 */
import type { AiReplyResult } from "@/lib/bot/aiReply";
import type { ProReplyResult } from "./answerWithPro";

export type AiBrain = "standard" | "pro";

export function aiBrainOf(settings: Record<string, unknown>, proUnlocked: boolean): AiBrain {
  if (!proUnlocked) return "standard";
  if (settings.botMode !== "ai_first") return "standard";
  return settings.botAiBrain === "pro" ? "pro" : "standard";
}

/**
 * One turn's reply from the chosen brain.
 *
 * The standard brain never starts a Pro turn. A Pro turn that is unavailable (no key, plan or
 * credits, timeout, never reached `reply`) or that throws is answered by the standard brain, so
 * the patient gets today's reply instead of silence. `slotsShown` (the slots Pro offered, earlier
 * offers included) is handed back beside the answer for the caller's spoken-pick code; `ai` is a
 * plain AiReplyResult, so nothing downstream sees a new field.
 */
export async function pickReply(
  brain: AiBrain,
  pro: () => Promise<ProReplyResult>,
  standard: () => Promise<AiReplyResult>
): Promise<{ ai: AiReplyResult; slotsShown?: Array<{ key: string; label: string }>; brainUsed: AiBrain }> {
  if (brain === "pro") {
    let got: ProReplyResult;
    try {
      got = await pro();
    } catch {
      got = { kind: "unavailable", reason: "pro_error" };
    }
    if (got.kind !== "unavailable") {
      if (got.kind === "answer") {
        const { slotsShown, ...ai } = got;
        return { ai, ...(slotsShown ? { slotsShown } : {}), brainUsed: "pro" };
      }
      return { ai: got, brainUsed: "pro" };
    }
  }
  return { ai: await standard(), brainUsed: "standard" };
}

/** The test chat says which brain answered; a live reply carries nothing new (and never undefined). */
export function dryRunBrainTag(dryRun: boolean | undefined, brainUsed: AiBrain | undefined): { brain?: AiBrain } {
  return dryRun === true && brainUsed ? { brain: brainUsed } : {};
}

/**
 * The test chat's outcome as the screen gets it: the brain tag only when the request asked for
 * Pro and the clinic has it, so a clinic that never tried Pro does not see "Standard" on every reply.
 */
export function playgroundOutcome<T extends object>(out: T, triedPro: boolean): T {
  if (triedPro || !("brain" in out)) return out;
  const { brain: _brain, ...rest } = out as T & { brain?: AiBrain };
  void _brain;
  return rest as T;
}
