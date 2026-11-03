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
