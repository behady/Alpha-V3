/**
 * The desk comes first.
 *
 * Two rules for the moments a person and the model meet in one thread. Both come from Asnany's
 * chats of 25-26/11/2026.
 *
 * 1. An answer composed while a receptionist was typing is hers to give. The model takes ten to
 *    thirty seconds; reception typed "للاسف مواعيد انهارده مقفوله" on the clinic phone inside
 *    that gap and the model's answer, one second later, offered 6 pm today. The claim minutes
 *    (conversation.ts) only stop a turn that STARTS after staff wrote; this stops one that
 *    started before.
 *
 * 2. "The team has your message" is said once. A patient with swelling after a root canal was
 *    handed to the team, then got a fresh apology and "I told the doctor right now" for every
 *    message she sent: about 25 in 66 minutes, each one a promise nobody had kept yet. The desk
 *    is still told about every message; the patient is not told the same thing again.
 *
 * Pure, with no imports, so respond.ts and the tests read one rule.
 */

/** Silence longer than this ends a conversation (conversation.ts, CONVERSATION_TTL_MS). */
const EXCHANGE_MS = 60 * 60 * 1000;

/**
 * Did a person write to the patient after the message this turn is answering?
 *
 * `humanActiveAtMs` is the conversation's stamp of the latest staff message, read again just
 * before the send; `messageAtMs` is when the patient's message arrived. Both are this server's
 * clock. Zero or absent (nobody wrote, or the thread was handed back to the bot) is "no".
 */
export function staffAnsweredMeanwhile(humanActiveAtMs: unknown, messageAtMs: number): boolean {
  const at = Number(humanActiveAtMs);
  return Number.isFinite(at) && at > 0 && at > messageAtMs;
}

/**
 * Which replies give way to a person who wrote meanwhile: the model's own talk.
 *
 * A booking written to the calendar, a cancellation, a "running late" note have already happened
 * and the patient must hear about them. The fixed safety line carries the clinic's number and
 * always goes.
 */
export function yieldsToStaff(reason: string): boolean {
  return reason === "ai_answer" || reason.startsWith("ai_handoff_");
}

/** The fields of a conversation this rule reads. */
export interface OpenHandoff {
  /** Severity of a hand-off still waiting for a person; absent when none is open. */
  openHandoffSeverity?: string;
  /** A person wrote inside the claim minutes or paused the bot. */
  staffActive?: boolean;
  /** Epoch ms of the patient's previous message. */
  lastMessageAt: number;
}

/**
 * Was the patient already told, in this same exchange, that a person is coming?
 *
 * True only for a medical or complaint hand-off raised again while one at least as serious is
 * still open and the patient has not been silent for an hour. The caller then sends nothing and
 * still flags the desk with the new words.
 *
 * A symptom after a complaint is not a repeat: the complaint's line carried no emergency number,
 * the medical one does. An ordinary open ask ("send me the Instagram link") silences nothing.
 */
export function holdingLineAlreadySaid(c: OpenHandoff, reason: string, now: number): boolean {
  if (c.staffActive) return false;
  const medical = reason === "ai_handoff_medical" || reason === "clinical";
  const complaint = reason === "ai_handoff_complaint";
  if (!medical && !complaint) return false;
  const open = c.openHandoffSeverity;
  if (!(open === "urgent" || (complaint && open === "complaint"))) return false;
  return now - (Number(c.lastMessageAt) || 0) < EXCHANGE_MS;
}
