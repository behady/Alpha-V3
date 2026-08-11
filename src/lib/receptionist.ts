/**
 * The receptionist's identity, and the wake word that summons her.
 *
 * Kept in one file because the name appears in the model's persona, in the panel's copy, and in
 * speech recognition — renaming her should be one edit, not a hunt.
 */

export const RECEPTIONIST_NAME = {
  en: "Alpha",
  ar: "ألفا",
} as const;

/**
 * Spellings speech recognition actually produces for "Alpha".
 *
 * A recogniser transcribes phonetically and rarely agrees with itself on a proper noun, so the
 * literal name alone would miss most of the time. These are the plausible renderings; matching is
 * whole-word, so a partial overlap inside a longer word never fires.
 *
 * "Alpha" is a materially riskier wake word than a person's name: it is also the clinic system's
 * own brand ("Alpha Dental"), and an ordinary English word ("alpha version", "alpha male"). Staff
 * saying "in the Alpha system" or "the alpha version of the form" will summon her — that is a real
 * cost of this name, not a bug in the matching, and worth knowing before relying on hands-free.
 */
const WAKE_WORDS_EN = ["alpha", "alfa", "alfah", "alpher"];

/** Arabic renderings, after the normalisation below strips diacritics and unifies alef forms. */
const WAKE_WORDS_AR = ["الفا", "الفه", "الفاء"];

/** Arabic diacritics (tashkeel) and tatweel — recognisers emit these inconsistently. */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟـ]/g;

/** Lowercases, removes punctuation, and flattens Arabic spelling variants to one form. */
export function normalizeForWake(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(ARABIC_MARKS, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface WakeMatch {
  /** Whether the wake word was heard at all. */
  matched: boolean;
  /**
   * What was said after it. Empty when she was called with nothing following — the caller should
   * then wait for the next utterance rather than acting on nothing.
   */
  command: string;
}

/**
 * Finds the wake word and returns everything after it.
 *
 * Deliberately requires the name to appear as its own word, and takes the LAST occurrence: someone
 * who says "Alpha… sorry, Alpha, check him in" means the second one. Text before the wake word is
 * discarded, because it is whatever was being said in the room beforehand — not an instruction.
 */
export function findWakeCommand(transcript: string): WakeMatch {
  const normalized = normalizeForWake(transcript);
  if (!normalized) return { matched: false, command: "" };

  const words = normalized.split(" ");
  const wakeSet = new Set<string>([...WAKE_WORDS_EN, ...WAKE_WORDS_AR]);

  let lastIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (wakeSet.has(words[i])) lastIndex = i;
  }
  if (lastIndex === -1) return { matched: false, command: "" };

  // Strip a leading vocative "يا" ("ya Alpha") and common filler that follows a name.
  const after = words.slice(lastIndex + 1);
  while (after.length && ["please", "من", "فضلك", "لو", "سمحت"].includes(after[0])) after.shift();

  return { matched: true, command: after.join(" ").trim() };
}

/**
 * Whether an utterance is worth sending at all.
 *
 * Recognisers emit stray single syllables from background noise; sending those would cost a credit
 * and produce a confused answer.
 */
export function isUsableCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length < 3) return false;
  return trimmed.split(/\s+/).length >= 2 || trimmed.length >= 6;
}
