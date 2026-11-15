/**
 * One model reply, several WhatsApp messages.
 *
 * A clinic's coaching can ask for "three separate messages": the greeting and offer, then the
 * address with its map link, then the booking question. The model returns one string, so it
 * marks each break with a line holding only `---`, and the sender turns the parts into separate
 * bubbles a few seconds apart. Anywhere that can only send one message (a reply with buttons or
 * a list, the playground) folds the marks back into blank lines, so a patient never sees dashes.
 */

/** A line that is only dashes (three or more) on its own: the break between two messages. */
const BREAK = /(?:^|\n)[ \t]*[-—–]{3,}[ \t]*(?=\n|$)/;

/** At most this many bubbles from one reply; whatever follows rides in the last one. */
export const MAX_BUBBLES = 4;

/** The reply's messages in order; a reply with no break is one message. Never empty. */
export function splitBubbles(text: string, max: number = MAX_BUBBLES): string[] {
  const parts = text
    .split(BREAK)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [text.trim()];
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join("\n\n")];
}

/** The same reply as one message: each break becomes a blank line. */
export function joinBubbles(text: string): string {
  return splitBubbles(text, Number.POSITIVE_INFINITY).join("\n\n");
}

/** A money figure: "1,500 ج.م", "300 جنيه", "300 ج", "1500 EGP", "EGP 1,500", "LE 300". */
const PRICE_FIGURE = /\d[\d,٬.]*\s*(?:ج\.?\s*م|جنيه|ج(?=[\s.،,]|$)|EGP\b|LE\b)|\b(?:EGP|LE)\s*\d/i;

/** A paragraph that ends by asking something. */
const ENDS_IN_QUESTION = /[?؟]\s*$/;

/**
 * The price before any question the model put above it.
 *
 * Asked "السعر كام", the model sometimes opens with its own question ("is it for looks, or a tooth
 * that bothers you?") and gives the figure after it. Split into two bubbles, the first the patient
 * reads is a question that looks like the answer to theirs. The question paragraphs above the
 * first figure move to just after it; everything else stays where it was (a greeting stays
 * first). The model's own words, never added to. A reply with `---` breaks is the clinic's own
 * message order (its coaching) and is left alone.
 */
export function priceBeforeQuestions(reply: string): string {
  if (BREAK.test(reply)) return reply;
  const parts = reply.split(/\n[ \t]*\n/).map((s) => s.trim()).filter(Boolean);
  const first = parts.findIndex((p) => PRICE_FIGURE.test(p));
  if (first <= 0) return reply;
  const before = parts.slice(0, first);
  const asks = before.filter((p) => ENDS_IN_QUESTION.test(p));
  if (!asks.length) return reply;
  return [...before.filter((p) => !ENDS_IN_QUESTION.test(p)), parts[first], ...asks, ...parts.slice(first + 1)].join("\n\n");
}
