/**
 * Turns an assistant reply into something worth hearing.
 *
 * The reception assistant writes for the eye: markdown emphasis, a leading ✅ or ⚠️, ISO dates and
 * zero-padded clock times. A speech engine reads all of that literally — "star star Khaled star
 * star", "white heavy check mark", "two thousand twenty six dash zero eight dash sixteen" — which
 * is most of why the spoken replies sounded wrong. None of this changes what is displayed; it only
 * affects what is sent to the synthesiser.
 */

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/**
 * Emoji and pictographs. Read aloud they become their Unicode names ("white heavy check mark"),
 * which is both jarring and longer than the sentence it decorates.
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2700}-\u{27BF}]/gu;

/** `2026-08-16` → "16 August 2026". Anything not a real date is left alone. */
function spellDates(text: string, isAr: boolean): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match, y, m, d) => {
    const monthIndex = Number(m) - 1;
    const day = Number(d);
    if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return match;
    const monthName = (isAr ? MONTHS_AR : MONTHS_EN)[monthIndex];
    return `${day} ${monthName} ${y}`;
  });
}

/**
 * `04:00 PM` → "4 PM", `04:30 PM` → "4:30 PM".
 *
 * The leading zero is the main offender — engines read it as "zero four" — and an exact hour does
 * not need ":00" spoken at all.
 */
function spellTimes(text: string, isAr: boolean): string {
  return text.replace(/\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)\b/g, (_match, h, min, meridiem) => {
    const hour = Number(h);
    const suffix = isAr ? (meridiem.toUpperCase() === "AM" ? "صباحاً" : "مساءً") : meridiem.toUpperCase();
    return min === "00" ? `${hour} ${suffix}` : `${hour}:${min} ${suffix}`;
  });
}

/** Currency codes are initialisms to a speech engine: "E G P". */
function spellCurrency(text: string, isAr: boolean): string {
  return text.replace(/\bEGP\b/g, isAr ? "جنيه" : "Egyptian pounds");
}

/** Strips the markdown the model writes for on-screen emphasis. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    // A list marker at the start of a line becomes a pause rather than the word "dash"/"star".
    .replace(/^\s*[-*•]\s+/gm, ", ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/**
 * The full pipeline. Returns "" when nothing speakable is left, so the caller can skip the
 * utterance entirely rather than have the engine announce an empty string.
 */
export function toSpeechText(raw: string, isAr: boolean): string {
  if (!raw) return "";
  let out = raw;
  out = stripMarkdown(out);
  out = out.replace(EMOJI, " ");
  out = spellDates(out, isAr);
  out = spellTimes(out, isAr);
  out = spellCurrency(out, isAr);
  // Collapse the whitespace all the stripping leaves behind, and drop stray punctuation that would
  // otherwise be read as a pause with nothing either side of it.
  out = out.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  out = out.replace(/^[,.\s]+/, "").trim();
  return out;
}

/**
 * Caps what gets read aloud, as a backstop.
 *
 * Generation time scales with length — a one-line reply takes about 2.4 seconds, a two-sentence one
 * closer to 5 — so length is the only latency lever available on this provider. The assistant is
 * told to answer in one sentence when its reply will be spoken; this is what stops an occasional
 * long answer from producing a ten-second wait. Cuts on a sentence boundary, never mid-word.
 */
export function trimForSpeech(text: string, maxChars = 220): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;

  const sentences = clean.split(/(?<=[.!?؟。])\s+/);
  let out = "";
  for (const sentence of sentences) {
    if (!out) {
      out = sentence;
      continue;
    }
    if ((out + " " + sentence).length > maxChars) break;
    out += " " + sentence;
  }
  // A single sentence longer than the cap still has to be cut somewhere; a word boundary is the
  // least jarring place.
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    const lastSpace = out.lastIndexOf(" ");
    if (lastSpace > maxChars * 0.6) out = out.slice(0, lastSpace);
  }
  return out.trim();
}

/**
 * Picks the least robotic available voice for a language.
 *
 * Ranked rather than first-match: on Windows the list is typically ordered with the oldest SAPI5
 * voice (David) first, so `find()` reliably chose the worst one. Modern neural voices identify
 * themselves as "Natural" or "Online", and Chrome's own network voices as "Google" — all three are
 * a large step up, so they are preferred when present. Returns null when the language has no voice
 * at all, which is the signal to stay silent instead of reading Arabic in an English voice.
 */
export function pickVoice(voices: SpeechSynthesisVoice[], isAr: boolean): SpeechSynthesisVoice | null {
  const prefix = isAr ? "ar" : "en";
  const candidates = voices.filter((v) => v.lang?.toLowerCase().startsWith(prefix));
  if (candidates.length === 0) return null;

  const score = (v: SpeechSynthesisVoice): number => {
    const name = v.name.toLowerCase();
    let s = 0;
    if (name.includes("natural")) s += 100;
    if (name.includes("online")) s += 80;
    if (name.includes("google")) s += 60;
    if (name.includes("premium") || name.includes("enhanced")) s += 40;
    // Among the legacy Windows trio, Zira and Mark are noticeably clearer than David.
    if (name.includes("zira")) s += 12;
    if (name.includes("mark")) s += 8;
    if (name.includes("david")) s -= 5;
    // A country-specific match beats a generic one (en-US over plain "en").
    if (v.lang.includes("-")) s += 3;
    return s;
  };

  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}
