/**
 * The two times, once.
 *
 * Two prompt rules ask the model to name two exact times in every answer that touches a service,
 * and they outrank "don't repeat yourself". So a patient who asked for the address and then the
 * area heard "السبت 3:00 ولا الأحد 3:00؟" under every answer, cut off as its own pushy bubble, and
 * the model, reading its own earlier replies, kept copying the pattern.
 *
 * When the last offer is still fresh, this message is not about WHEN, and the reply only repeats
 * times the patient already heard, the CLOSING offer comes off the reply, and the times the
 * patient last heard stay on the conversation, so "الأول" still books them. Anything this file cannot read for certain is sent exactly as the model wrote it:
 * a sentence that carries anything besides the offer (a price, an address, a branch, an English
 * word) is never cut. Pure: no I/O.
 */
import { resolveSpokenPick, spokenSlots } from "./spokenPick";

type Slot = { key: string; label: string };
type Line = { author: string; text: string };

/** Arabic LETTERS only: "\u061F" and "\u060C" sit in the same Unicode block and must end a word, not extend it. */
const AR = "\u0621-\u064A\u066E-\u06D3\u06FA-\u06FC";

/** Alef spellings, taa marbuta, diacritics and Arabic-Indic digits vary by keyboard. */
function norm(text: string): string {
  return String(text || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

/** A whole Arabic word (JavaScript's `\b` does not see Arabic letters). */
function hasWord(t: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`(?<![${AR}])${w}(?![${AR}])`).test(t));
}

/* ------------------------------------------------------------ is the patient talking about WHEN? */

const TIMING_STEMS = ["حجز", "ميعاد", "معاد", "موعد", "مواعيد", "فاضي", "يناسب", "مناسب"];
const TIMING_WORDS = [
  "امتي", "متي", "اجي", "نيجي", "الساعه", "النهارده", "انهارده", "بكره", "بعد بكره",
  "السبت", "الحد", "الاحد", "الاتنين", "الاثنين", "التلات", "الثلاثاء", "التلاتاء", "الاربع", "الاربعاء", "الخميس", "الجمعه",
  "الصبح", "الصباح", "صباحا", "الضهر", "الظهر", "العصر", "عصرا", "المغرب", "بالليل", "بليل", "المسا", "مساء", "مساءا",
  "يوم", "اليوم", "ايام", "الايام", "وقت", "الوقت", "اوقات", "اسبوع", "الاسبوع", "الجاي", "بدري", "النهار",
  // A pick by position, in case the model answered it as a plain answer.
  "الاول", "الاولاني", "التاني", "الثاني", "التالت", "الثالث",
];
const TIMING_LATIN =
  /\b(book|booking|appointment|appt|slot|slots|available|availability|when|today|tomorrow|morning|evening|tonight|week|saturday|sunday|monday|tuesday|wednesday|thursday|friday|first|second|1st|2nd|a7g\w*|ma3ad|mi3ad|m3ad|emta|bokra)\b|\d{1,2}:\d{2}|\b\d{1,2}\s*(am|pm)\b/i;
/** A bare hour ("3", "الساعة 6"): not part of a price, a phone number, a date or a clock. */
const BARE_HOUR = /(?<![\d:\/.,])(?:1[0-2]|0?[1-9])(?![\d:\/.,])/;

/** A day, a time, an hour, a pick or booking: then the times may be said again. */
export function asksAboutTiming(text: string): boolean {
  const t = norm(text);
  if (!t.trim()) return false;
  if (TIMING_STEMS.some((s) => t.includes(s))) return true;
  if (hasWord(t, TIMING_WORDS)) return true;
  if (BARE_HOUR.test(t)) return true;
  return TIMING_LATIN.test(t);
}

/* ------------------------------------------------------------ which sentence is the offer? */

/** Says it is an offer: one of these, or a question mark. */
const OFFER_WORDS = ["عندي", "عندنا", "متاح", "متاحه", "يناسبك", "يناسبكم", "تحب", "تحبي", "نظبط", "نحجز", "احجزلك", "نسجل", "نثبت", "انهي"];
/** Every word a closing offer may hold besides the times themselves. Anything else keeps the sentence. */
const OFFER_VOCAB = new Set([
  "عندي", "عندنا", "تحب", "تحبي", "تحبوا", "حابب", "حابه", "انهي", "اني", "فيهم", "منهم", "ايه", "اللي", "اكتر", "اكثر",
  "ولا", "او", "يوم", "مثلا", "حضرتك", "لحضرتك", "ليك", "ليكي", "عشان", "علشان", "الكشف", "كشف", "لو", "في", "مع", "يا",
  "فندم", "طيب", "ممكن", "نقدر", "اقرب", "تيجي", "تشرفنا", "تنورنا", "نشوفك", "هل", "am", "pm",
]);
const OFFER_STEMS = ["ميعاد", "معاد", "موعد", "مواعيد", "حجز", "متاح", "مناسب", "يناسب", "نظبط", "تظبط", "نسجل", "نثبت", "ناكد"];
const RELATIVE_DAYS = ["بكره", "النهارده", "انهارده", "بعد بكره"];
// "بعد بكره" whole: the prompt now writes it before the third day's slots (lib/bot/relativeDay),
// and a stray "بعد" left behind would keep every such offer from being recognised.
const TIME_OF_DAY = ["الساعه", "م", "ص", "العصر", "عصرا", "المغرب", "بالليل", "الصبح", "الضهر", "بعد بكره", "بكره", "النهارده", "انهارده"];
/** Letters a closing offer may carry besides the times ("المواعيد المتاحة عندي مثلاً … تحب أنهي فيهم"). */
const MAX_OFFER_RESIDUE_LETTERS = 40;
const MAX_TAIL_LETTERS = 30;

/** The words of the offered labels: days, "الساعة", "مع د. أحمد" when names are shown. */
function labelWords(offer: Slot[]): Set<string> {
  return new Set(offer.flatMap((s) => norm(s.label).match(/\p{L}+/gu) || []));
}

/** Every word is offer vocabulary (a leading "و" allowed). An English word never is. */
function onlyOfferWords(text: string, offer: Slot[]): boolean {
  const known = labelWords(offer);
  const ok = (w: string) => OFFER_VOCAB.has(w) || known.has(w) || OFFER_STEMS.some((s) => w.includes(s));
  return (text.match(/\p{L}+/gu) || []).every((w) => ok(w) || (w.length > 2 && w.startsWith("و") && ok(w.slice(1))));
}

/** The sentence with every offered day, date, clock and dentist suffix taken out. */
function residue(t: string, offer: Slot[]): string {
  let r = t;
  for (const s of offer) {
    const label = norm(s.label);
    const doctor = label.replace(/^.*?\d{1,2}:\d{2}\s*[مص]?/, "").trim(); // "مع د. احمد" when names are shown
    const day = label.match(/^(\S+)/)?.[1] || "";
    const date = label.match(/\d{1,2}\/\d{1,2}/)?.[0] || "";
    const clock = label.match(/\d{1,2}:\d{2}/)?.[0] || "";
    for (const piece of [doctor, day, date, clock]) if (piece) r = r.split(piece).join(" ");
  }
  return r.replace(new RegExp(`(?<![${AR}])(${TIME_OF_DAY.join("|")})(?![${AR}])`, "g"), " ");
}

/** Names an offered time with its day or date, reads like an offer, and carries nothing else. */
function isOfferSentence(sentence: string, offer: Slot[]): boolean {
  if (!spokenSlots(sentence, offer).length) return false;
  const t = norm(sentence);
  const days = offer.map((s) => norm(s.label.match(/^(\S+)/)?.[1] || "")).filter((d) => d.length > 2);
  const dates = offer.map((s) => s.label.match(/\d{1,2}\/\d{1,2}/)?.[0] || "").filter(Boolean);
  if (!(hasWord(t, [...days, ...RELATIVE_DAYS]) || dates.some((d) => t.includes(d)))) return false;
  if (!(/[؟?]/.test(sentence) || hasWord(t, OFFER_WORDS))) return false;
  // An answer fused into the offer ("الكشف بـ 200 وعندي السبت 3…", the address and the times in
  // one breath) is never cut: another figure, or any word an offer does not need, keeps it whole.
  const rest = residue(t, offer);
  if (/\d/.test(rest)) return false;
  if (!onlyOfferWords(rest, offer)) return false;
  return (rest.match(/\p{L}/gu) || []).length <= MAX_OFFER_RESIDUE_LETTERS;
}

/** "تحب أنهي فيهم؟" / "إيه اللي يناسبك أكتر؟" on its own right after the times: part of the offer. */
function isOfferTail(sentence: string, offer: Slot[]): boolean {
  const s = sentence.trim();
  if (!/[؟?]$/.test(s) || /\d/.test(s) || spokenSlots(s, offer).length) return false;
  return (s.match(/\p{L}/gu) || []).length <= MAX_TAIL_LETTERS && onlyOfferWords(norm(s), offer);
}

/** An emoji or a lone mark after the question: goes with the sentence before it. */
const isDecoration = (s: string) => !/[\p{L}\p{N}]/u.test(s);

const BREAK_LINE = /^[ \t]*[-—–]{3,}[ \t]*$/;
/** Sentence ends: ؟ ? ! … always; a full stop only after a word of 3+ letters ("د. أحمد", "ج.م" stay whole). */
const SENTENCE_GAP = /(?<=[!?؟…]|\p{L}{3}\.)[ \t]+/u;

/**
 * The reply without its CLOSING offer: the trailing sentences that offer times, walking back over
 * blank lines and `---` breaks, stopping at the first sentence that is anything else. Null (send
 * as written) when nothing came off, when under 8 letters would be left (the reply WAS the
 * offer), or when an offered time is still said somewhere in what is left (all or nothing).
 */
export function withoutSlotOffer(text: string, offer: Slot[]): string | null {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  // Every sentence, in order, with the line it sits on; blank lines and `---` breaks hold none.
  const units: Array<{ line: number; text: string; drop?: boolean }> = [];
  lines.forEach((line, n) => {
    if (!line.trim() || BREAK_LINE.test(line)) return;
    for (const s of line.trim().split(SENTENCE_GAP)) if (s.trim()) units.push({ line: n, text: s });
  });
  let i = units.length - 1;
  while (i >= 0 && isDecoration(units[i].text)) i -= 1;
  const lastWords = i;
  if (i >= 1 && isOfferTail(units[i].text, offer) && isOfferSentence(units[i - 1].text, offer)) {
    units[i].drop = true;
    i -= 1;
  }
  while (i >= 0 && isOfferSentence(units[i].text, offer)) {
    units[i].drop = true;
    i -= 1;
  }
  if (!units.some((u) => u.drop)) return null;
  for (let k = lastWords + 1; k < units.length; k++) units[k].drop = true;
  lines.forEach((line, n) => {
    if (!line.trim() || BREAK_LINE.test(line)) return;
    lines[n] = units.filter((u) => u.line === n && !u.drop).map((u) => u.text).join(" ");
  });
  const out = lines
    .join("\n")
    .split(/\n[ \t]*[-—–]{3,}[ \t]*(?=\n|$)/)
    .map((b) => b.replace(/\n{3,}/g, "\n\n").trim())
    .filter(Boolean)
    .join("\n---\n")
    .trim();
  if ((out.match(/\p{L}/gu) || []).length < 8) return null;
  if (spokenSlots(out, offer).length) return null;
  return out;
}

/* ------------------------------------------------------------ when to hold */

/** The patient's third message since the times were said hears them again. */
export const REOFFER_AFTER_PATIENT_MESSAGES = 3;
/** A patient back after this long is a new sitting: the times may be offered again. */
export const NEW_SITTING_MINUTES = 45;

/** Patient messages since the last bot line that said an offered time aloud; Infinity if none. */
export function patientMessagesSinceOffer(thread: Line[], offer: Slot[]): number {
  let count = 0;
  for (let i = thread.length - 1; i >= 0; i--) {
    const line = thread[i];
    if (line.author === "patient") count += 1;
    else if (line.author === "bot" && spokenSlots(line.text, offer).length) return count;
  }
  return Number.POSITIVE_INFINITY;
}

/** The patient's messages at the end of the thread, still unanswered (several sent together). */
function unansweredPatientLines(thread: Line[]): string[] {
  const out: string[] = [];
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].author === "system") continue;
    if (thread[i].author !== "patient") break;
    out.push(thread[i].text);
  }
  return out;
}

/**
 * Should this reply's closing offer come off? Only for a CHOICE of times (two or more) that the
 * patient ALREADY HEARD, every one of them, in the same sitting, fewer than three patient messages
 * ago, when nothing the patient just wrote is about a day, a time, booking or a pick.
 *
 * "Already heard" is what keeps a "no" from being answered with nothing. "مش هينفع", "مش هقدر",
 * "صعب" or a bare "لا" after an offer are not on any timing list, and the model answers them with
 * OTHER times: those are the answer, so a reply naming any time the patient has not heard yet is
 * sent as written.
 */
export function holdRepeatOffer(i: {
  question: string;
  /** spokenSlots of the reply just written. */
  spokenKeys: string[];
  /** conversation.pendingSlots: what the patient last heard. */
  previousKeys: string[] | undefined;
  thread: Line[];
  offer: Slot[];
  gapMinutes?: number;
}): boolean {
  if (i.spokenKeys.length < 2 || !i.previousKeys?.length) return false;
  const previous = i.previousKeys;
  if (!i.spokenKeys.every((k) => previous.includes(k))) return false; // a time they never heard is news
  if ((i.gapMinutes ?? 0) >= NEW_SITTING_MINUTES) return false;
  const heard = i.previousKeys.map((k) => i.offer.find((s) => s.key === k)).filter((s): s is Slot => Boolean(s));
  if (!heard.length) return false; // none of the times they heard is still free: new ones are news
  const asked = [i.question, ...unansweredPatientLines(i.thread)];
  if (asked.some(asksAboutTiming)) return false;
  if (asked.some((q) => resolveSpokenPick(q, heard))) return false; // a pick, however it was worded
  return patientMessagesSinceOffer(i.thread, i.offer) < REOFFER_AFTER_PATIENT_MESSAGES;
}
