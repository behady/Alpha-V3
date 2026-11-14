import { normalizeReplyText } from "@/lib/patientMessaging";

/**
 * A question from the desk keeps the patient's answer for the desk.
 *
 * A staff reply holds the bot back only for the clinic's claim minutes (Settings → WhatsApp,
 * `botHumanClaimMinutes`, 15 by default). That stays short on purpose: a desk found an hour far
 * too long when a receptionist only answered one thing. But a receptionist who ASKED the patient
 * something is waiting for the answer, and patients answer late. 2026-11-14: reception asked
 * "where does it say we work with AXA?" at 07:53, the patient answered at 09:06, and the bot
 * answered her instead, over the person who had asked.
 *
 * The rule: when the clinic's most recent message to the patient was written by a person and asks
 * something, what the patient sends in the next 12 hours is for that person. The bot says
 * nothing; the desk is told. A later bot or system message (a reminder, a confirmation) ends it,
 * because the patient is then answering that. So does «رجّع البوت», which zeroes the
 * conversation's staff stamp.
 *
 * Pure, and imports only the text normaliser, so the server and the Chats screen read one rule.
 */

/** How long a staff question keeps the patient's answers for the desk. A shift; inside Meta's 24h. */
export const STAFF_QUESTION_HOLD_MS = 12 * 60 * 60 * 1000;

/** A staff line and its conversation stamp are written a moment apart by the same server. */
const STAMP_SLACK_MS = 60 * 1000;

/**
 * Words that make a staff message a question even without a question mark.
 *
 * Receptionists type fast and rarely add "؟": "حضرتك ممكن تعرفني مكتوب فين" is a question.
 * Whole words only, after the shared Arabic folding (أ→ا, ى→ي, ة→ه). Statements a desk writes
 * ("موعد حضرتك تم تسجيله", "متاح في فرع حدائق الاهرام") carry none of these.
 */
const QUESTION_WORDS = [
  "ايه", "ليه", "ازاي", "امتى", "فين", "منين", "مين", "كام", "بكام", "انهي", "هل",
  "ممكن", "ينفع", "تحب", "تحبي", "تحبوا", "تحبو", "تقدر", "تقدري", "تقدروا", "يناسبك",
  "يناسبكم", "يناسب",
  "what", "when", "where", "which", "who", "why", "how", "can you", "could you", "would you",
  "do you", "did you", "are you", "will you", "is it", "is that",
];

const NEEDLES = QUESTION_WORDS.map((w) => normalizeReplyText(w)).filter(Boolean);

/** Does this staff message ask the patient something? */
export function asksPatient(raw: string): boolean {
  // A link is not a question: a maps link carries "?" in it ("…/maps?q=…").
  const text = String(raw || "").replace(/(?:https?:\/\/|www\.)\S+/gi, " ");
  if (/[?؟]/.test(text)) return true;
  const norm = normalizeReplyText(text);
  if (!norm) return false;
  // "وفين" and "وامتى" are the same question: a leading و comes off before the word check.
  const loose = norm.replace(/(^|\s)و(?=\S{2,})/g, "$1و ");
  return NEEDLES.some((n) => ` ${norm} `.includes(` ${n} `) || ` ${loose} `.includes(` ${n} `));
}

/** The few fields of a thread line this rule reads. Anything else on the line is ignored. */
export interface HoldLine {
  direction?: unknown;
  author?: unknown;
  text?: unknown;
  at?: unknown;
}

/**
 * When the open staff question was asked (epoch ms), or 0 when no question holds the thread.
 *
 * `lines` is any slice of the thread that reaches back past the staff message, in any order.
 * `humanActiveAtMs` is the conversation's stamp of the latest staff message: 0 after «رجّع البوت»,
 * and older than the line for a message filed from history that no person sent just now.
 */
export function staffQuestionAt(lines: readonly HoldLine[], humanActiveAtMs: number, now: number): number {
  if (!(Number(humanActiveAtMs) > 0)) return 0;
  let last: HoldLine | null = null;
  for (const l of lines) {
    if (!l || l.direction !== "out") continue;
    if (!last || (Number(l.at) || 0) > (Number(last.at) || 0)) last = l;
  }
  if (!last || last.author !== "staff") return 0;
  const at = Number(last.at) || 0;
  if (!(at > now - STAFF_QUESTION_HOLD_MS)) return 0;
  if (Number(humanActiveAtMs) < at - STAMP_SLACK_MS) return 0;
  return asksPatient(String(last.text ?? "")) ? at : 0;
}

/** Worth reading the thread at all? Only when a person wrote inside the last 12 hours. */
export function staffQuestionCouldHold(humanActiveAtMs: number | undefined, now: number): boolean {
  return Number(humanActiveAtMs) > now - STAFF_QUESTION_HOLD_MS;
}
