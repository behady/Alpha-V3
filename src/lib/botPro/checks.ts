/**
 * Red-line checks on a reply written by the Pro brain.
 *
 * The prompt asks the model to keep to the clinic's facts; this file is what makes it true. Each
 * check is a pure function of the text, so a failing reply can be named precisely and the model
 * can be told which rule it broke. The number, script and drug rules re-implement the ones the
 * standard assistant applies (aiReply.ts); that file is deliberately not imported so it can be
 * retired later.
 *
 * Persona rule (same as the standard assistant's): never claim to be human, and never bring up
 * being an AI — unless the patient asked directly, in which case the honest answer is required.
 */
import { strayDrugNames } from "@/lib/bot/drugGuard";

/* ------------------------------------------------------------------------------------------- */
/* Text helpers                                                                                 */
/* ------------------------------------------------------------------------------------------- */

const foldDigits = (s: string): string => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/**
 * Arabic spelling folded to one form so a phrase is written once: alef forms to bare alef,
 * ى to ي, ة to ه, no tashkeel or tatweel; Latin lower-cased; curly quotes straightened; spaces
 * collapsed. Patterns below are written in this folded form ("مساعد الي", not "مساعد آلي").
 */
function normalise(s: string): string {
  return foldDigits(s)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-word / whole-phrase match: not preceded or followed by a letter or digit, either script. */
function phrase(pattern: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, "u");
}

/* ------------------------------------------------------------------------------------------- */
/* Numbers                                                                                      */
/* ------------------------------------------------------------------------------------------- */

/** Every number the model may say: digits folded to ASCII, thousands commas dropped. */
export function allowedNumbers(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    for (const m of foldDigits(src || "").matchAll(/\d[\d,]*/g)) out.add(m[0].replace(/,/g, ""));
  }
  return out;
}

const CLOCK = /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g;

/*
 * A figure attached to money, a percentage or "thousand" is checked at any size; everything else
 * keeps the 50 threshold so a tooth count or a street number does not trip the guard. A unit
 * word must end where the word ends, so "3 الفريق" is not "3 ألف" and "2 جمعة" is not "2 جم".
 */
const MONEYISH = /(\d[\d,]*)\s*(%|(?:ج\.?م|جنيهات|جنيه|جنيها|جنية|الف|ألف|آلاف|الاف|egp|le|pounds?)(?![\p{L}\p{N}]))?/giu;

/** Figures in the reply that the clinic never supplied. Clock times are the clock check's business. */
export function strayNumbers(reply: string, allowed: Set<string>): string[] {
  const norm = foldDigits(reply).replace(CLOCK, " ");
  const out: string[] = [];
  for (const m of norm.matchAll(MONEYISH)) {
    const n = m[1].replace(/,/g, "");
    if (allowed.has(n)) continue;
    if (Boolean(m[2]) || Number(n) >= 50) out.push(n);
  }
  return out;
}

const clockKey = (h: string, mm: string): string => `${Number(h)}:${mm}`;

/** Every H:MM / HH:MM in the reply that is not among the times the calendar offered ("07:30" = "7:30"). */
export function strayClocks(reply: string, allowedClocks: Set<string>): string[] {
  const allowed = new Set<string>();
  for (const c of allowedClocks) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(foldDigits(c));
    allowed.add(m ? clockKey(m[1], m[2]) : c);
  }
  const out: string[] = [];
  for (const m of foldDigits(reply).matchAll(CLOCK)) {
    const key = clockKey(m[1], m[2]);
    if (!allowed.has(key)) out.push(key);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- */
/* Script                                                                                       */
/* ------------------------------------------------------------------------------------------- */

const arabicLetters = (s: string) => (s.match(/[؀-ۿ]/g) || []).length;
const latinLetters = (s: string) => (s.match(/[A-Za-z]/g) || []).length;

/**
 * True when the reply is mostly in the other script from the patient's message. A question or a
 * reply too short to tell is never "wrong".
 */
export function wrongScript(question: string, reply: string): boolean {
  const qArabic = arabicLetters(question);
  const qLatin = latinLetters(question);
  if (!(qArabic >= 3 || qLatin >= 3) || !reply.trim()) return false;
  const rArabic = arabicLetters(reply);
  const rLatin = latinLetters(reply);
  if (rArabic + rLatin < 6) return false;
  return qArabic > qLatin ? rLatin > rArabic : rArabic > rLatin;
}

/* ------------------------------------------------------------------------------------------- */
/* Persona                                                                                      */
/* ------------------------------------------------------------------------------------------- */

// Pieces, all in folded form. Prefixes: ال / بال / وال / كال / لل / ب / و / ك / ل / ف.
const AR_PREFIX = "(?:وال|بال|فال|كال|لل|ال|ب|و|ك|ل|ف)?";
const AR_BOT = `${AR_PREFIX}(?:شات ?بوت|روبوت|بوت)(?:ات)?`;
const AR_AI = `${AR_PREFIX}ذكاء (?:ال)?(?:اصطناعي|صناعي)`;
const AR_ASSISTANT = `${AR_PREFIX}مساعد (?:ال)?الي`;
const AR_HUMAN = `(?:ال)?انسان(?:ه)?(?: حقيقي(?:ه)?)?|بني ادم(?: حقيقي)?|شخص حقيقي|حد حقيقي|بشر`;
const AR_YOU = "(?:انت|انتي|انتو|انتوا|حضرتك|حضرتكم)";

const ASKS_PATTERNS: RegExp[] = [
  // انت بوت / انتي إنسان / حضرتك ذكاء اصطناعي / انت بني آدم
  phrase(`${AR_YOU} (?:ده |دي |فعلا |بجد |اصلا |بقي )?(?:${AR_BOT}|${AR_AI}|${AR_ASSISTANT}|${AR_HUMAN}|ai|robot|human)`),
  // ده انسان ولا بوت / حد حقيقي ولا بوت / ولا بوت؟
  phrase(`(?:${AR_HUMAN}|حد|شخص) ولا (?:ده |انت |هو )?(?:${AR_BOT}|${AR_AI}|${AR_ASSISTANT}|ai)`),
  phrase(`ولا (?:انت )?(?:${AR_BOT})`),
  // ده بوت؟ / هو ده بوت؟
  phrase(`(?:ده|دي|هذا|هذه) (?:رد )?(?:${AR_BOT}|${AR_AI})`),
  // بكلم حد حقيقي / بتكلم بوت / بكلم انسان
  phrase(`(?:بكلم|بتكلم|بكلمه|بكلمك|بتكلمني|بتكلمنا|بحكي|بتحكي|بدردش|اكلم) (?:مع )?(?:${AR_HUMAN}|${AR_BOT}|${AR_AI}|ai)`),
  // Franco
  phrase("(?:enta|enti|inta|inti|anta|anti) (?:bot|robot|ensan|insan)"),
  // English
  phrase("(?:are|r) (?:you|u) (?:a |an |actually |really |just |some )*(?:real |actual )?(?:bot|chatbot|robot|ai|a\\.i\\.|human|person|human being|machine|real person|real human|artificial intelligence)"),
  phrase("is (?:this|it|that) (?:a |an |actually |really |just |some )*(?:real |actual )?(?:bot|chatbot|robot|ai|a\\.i\\.|human|person|human being|machine|real person|real human|automated|artificial intelligence)"),
  phrase("am i (?:talking|speaking|chatting|texting|messaging|writing) (?:to|with) (?:a |an |some )?(?:real |actual )?(?:bot|chatbot|robot|ai|human|person|human being|machine|real person|real human|someone real)"),
];

/** The patient asked, directly, whether they are talking to a bot or a person. */
export function asksIfBot(question: string): boolean {
  const q = normalise(question).replace(/[؟?!.,،]+/g, " ").replace(/\s+/g, " ");
  return ASKS_PATTERNS.some((re) => re.test(q));
}

const HUMAN_CLAIMS: RegExp[] = [
  // أنا إنسان / أنا بني آدم / أنا شخص حقيقي (optionally "فعلا"/"بجد")
  phrase(`انا (?:فعلا |بجد |طبعا |اكيد )?(?:${AR_HUMAN})`),
  // مش بوت / مش روبوت / مش ذكاء اصطناعي / مش مساعد الي
  phrase(`مش (?:مجرد )?(?:${AR_BOT}|${AR_AI}|${AR_ASSISTANT})`),
  // I'm human / I am a real person
  phrase("i(?:'m| am) (?:a |an )?(?:real |actual )?(?:human|human being|real person|real human|actual person)"),
  // not a bot
  phrase("not (?:a |an )?(?:bot|chatbot|robot|ai|machine)"),
];

/** The reply says it is a person, or denies being a bot. Offering a person ("someone will call you") is fine. */
export function claimsHuman(reply: string): boolean {
  const r = normalise(reply).replace(/[؟?!.,،]+/g, " ").replace(/\s+/g, " ");
  return HUMAN_CLAIMS.some((re) => re.test(r));
}

const AI_WORDS: RegExp[] = [
  phrase(AR_BOT),
  phrase(AR_AI),
  phrase(AR_ASSISTANT),
  phrase("ai|a\\.i\\.|bots?|chatbots?|assistant bots?|artificial intelligence"),
];

/** The reply brings up being a bot / AI. */
export function mentionsAi(reply: string): boolean {
  const r = normalise(reply);
  return AI_WORDS.some((re) => re.test(r));
}

/* ------------------------------------------------------------------------------------------- */
/* All checks together                                                                          */
/* ------------------------------------------------------------------------------------------- */

export type Violation = {
  rule: "price" | "clock" | "drug" | "script" | "claims_human" | "volunteers_ai";
  detail: string;
};

/**
 * Every red line the reply crosses, one entry per rule, in a fixed order. `claims_human` is
 * always a violation; `volunteers_ai` only when the patient did not ask.
 */
export function checkReply(args: {
  question: string;
  reply: string;
  allowed: Set<string>;
  clocks: Set<string>;
  drugsAllowed: string;
}): Violation[] {
  const { question, reply, allowed, clocks, drugsAllowed } = args;
  const out: Violation[] = [];

  const prices = strayNumbers(reply, allowed);
  if (prices.length) out.push({ rule: "price", detail: prices.join(", ") });

  const times = strayClocks(reply, clocks);
  if (times.length) out.push({ rule: "clock", detail: times.join(", ") });

  const drugs = strayDrugNames(reply, drugsAllowed);
  if (drugs.length) out.push({ rule: "drug", detail: drugs.join(", ") });

  if (wrongScript(question, reply)) out.push({ rule: "script", detail: "reply is in the other script from the patient's message" });

  if (claimsHuman(reply)) out.push({ rule: "claims_human", detail: "reply claims to be a person or denies being a bot" });

  if (mentionsAi(reply) && !asksIfBot(question)) {
    out.push({ rule: "volunteers_ai", detail: "reply mentions being a bot/AI though the patient did not ask" });
  }

  return out;
}
