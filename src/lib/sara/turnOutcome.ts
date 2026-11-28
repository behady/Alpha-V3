/**
 * How a turn ends, and what is kept of it.
 *
 * The route used to return whatever text the last model call produced. When the model was still
 * asking for a tool on its last allowed round that text was empty, the widget printed "…", the
 * clinic was charged a credit, and the "…" went back to the model as its own previous answer on
 * the next question, which then failed the same way. Three small rules fix that, kept here so
 * they can be tested without the route.
 */

/** A reply that says nothing: empty, or only dots. */
export function isEmptyReply(text: unknown): boolean {
  const t = String(text ?? "").trim();
  return t === "" || /^[.…\s]+$/.test(t);
}

/** Does the turn need one last call with tools off? */
export function needsRescue(text: unknown, stillWantsTool: boolean): boolean {
  return stillWantsTool || isEmptyReply(text);
}

/** Appended as the last user part of the rescue call. */
export const RESCUE_INSTRUCTION =
  "You cannot use any more tools for this question. Using only what the tools above already returned, answer the " +
  "person now in their language, briefly. If that is not enough to answer, say plainly that you could not work it " +
  "out and name the page of the app where they can find it. Never reply with nothing.";

export function noAnswerText(prompt: unknown): string {
  const arabic = /[؀-ۿ]/.test(String(prompt ?? ""));
  return arabic
    ? "معرفتش أطلع الإجابة دي دلوقتي. جرّب تسأل بشكل أبسط، أو افتح التقارير. السؤال ده ماتحسبش عليك."
    : "I couldn't work that out this time. Try asking it more simply, or open Reports. This question was not charged.";
}

type Turn = { role?: unknown; content?: unknown; parts?: { text?: unknown }[] };

const turnText = (m: Turn) => String(m?.content ?? m?.parts?.[0]?.text ?? "");
const isAssistant = (m: Turn) => m?.role === "assistant" || m?.role === "model";

/**
 * The chat history without the turns that produced no answer.
 *
 * An empty assistant message is dropped together with the question it failed to answer, so the
 * roles still alternate and the model is not shown its own silence as an example.
 */
export function withoutEmptyTurns<T extends Turn>(history: readonly T[]): T[] {
  const out: T[] = [];
  for (const message of history) {
    if (isAssistant(message) && isEmptyReply(turnText(message))) {
      if (out.length > 0 && !isAssistant(out[out.length - 1])) out.pop();
      continue;
    }
    out.push(message);
  }
  return out;
}
