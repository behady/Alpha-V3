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

/** Arabic-Indic (U+0660-0669) and Persian/extended (U+06F0-06F9) digits to ASCII. */
const foldDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

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

/**
 * A phone number written with spaces or dashes ("0100 123 4567", "+20 100-123-4567"): one token.
 * It starts with 0 or +20 and has 9-11 more digits, each split from the last by at most one
 * space or dash, so a price such as "1 000" never matches.
 */
const PHONE = /(?<![\d+])(?:\+\s?20[\s-]?|0)\d(?:[\s-]?\d){8,10}(?!\d)/g;
/**
 * Unit words that make the figure before them a price or a percentage (also used by MONEYISH).
 * A unit must end where the word ends, so "3 الفريق" is not "3 ألف".
 */
const UNIT_WORDS =
  "ج\\.?م|جنيهات|جنيه|جنيها|جنية|الف|ألف|آلاف|الاف|egp|le|pounds?|percent|(?:ب|في\\s+)ال(?:مي|مائ|مئ|ماي)[هة]";
const UNIT_AFTER = `\\s*(?:%|٪|(?:${UNIT_WORDS})(?![\\p{L}\\p{N}]))`;
/**
 * Full dates: yyyy-mm-dd, yyyy/mm/dd, d/m/yyyy, d-m-yy, d.m.yyyy. They are not figures, unless a
 * unit follows ("10-20-30 جنيه"). A bare d/m is NOT skipped: "12/15 ألف" is an invented price range.
 */
const DATE = new RegExp(`(?<!\\d)(?:\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4})(?!\\d)(?!${UNIT_AFTER})`, "giu");

/** The forms a phone token can take: its digits, and with a +20 prefix turned back into a leading 0. */
function phoneForms(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const forms = [digits];
  if (raw.trimStart().startsWith("+") && digits.startsWith("20")) forms.push("0" + digits.slice(2));
  return forms;
}

/** Every number the model may say: digits folded to ASCII, thousands commas dropped, phones kept whole too. */
export function allowedNumbers(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    const text = foldDigits(src || "");
    for (const m of text.matchAll(/\d[\d,]*/g)) out.add(m[0].replace(/,/g, ""));
    for (const m of text.matchAll(PHONE)) for (const f of phoneForms(m[0])) out.add(f);
  }
  return out;
}

const CLOCK = /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g;

/*
 * A figure attached to money, a percentage or "thousand" is checked at any size; everything else
 * keeps the 50 threshold so a tooth count or a street number does not trip the guard. A unit
 * word must end where the word ends, so "3 الفريق" is not "3 ألف" and "2 جمعة" is not "2 جم".
 * Percent is % or ٪ or words (بالمية، في المية، بالمائة، في المائة).
 */
const MONEYISH = new RegExp(`(\\d[\\d,]*)\\s*(%|٪|(?:${UNIT_WORDS})(?![\\p{L}\\p{N}]))?`, "giu");

/**
 * Figures in the reply that the clinic never supplied. Clock times (the clock check's business)
 * and dates are skipped; a phone written with spaces or dashes is one token, checked whole.
 */
export function strayNumbers(reply: string, allowed: Set<string>): string[] {
  const out: string[] = [];
  let norm = foldDigits(reply).replace(PHONE, (raw) => {
    if (!phoneForms(raw).some((f) => allowed.has(f))) out.push(raw.replace(/\D/g, ""));
    return " ";
  });
  norm = norm.replace(DATE, " ").replace(CLOCK, " ");
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
  // An allowed entry may carry extra text ("7:30 م", "07:30:00", "الخميس 5:00 م"): take every H:MM in it.
  const allowed = new Set<string>();
  for (const c of allowedClocks) for (const m of foldDigits(c).matchAll(CLOCK)) allowed.add(clockKey(m[1], m[2]));
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
  phrase(`${AR_YOU} (?:ده |دي |فعلا |بجد |اصلا |بقي )?(?:${AR_BOT}|${AR_AI}|${AR_ASSISTANT}|${AR_HUMAN}|ai|robot|human|chat ?bot|bot)`),
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
  phrase("is (?:this|it|that) (?:a |an |actually |really |just |some )*(?:real |actual )?(?:bot|chatbot|robot|ai|a\\.i\\.|human|person|human being|machine|real person|real human|automated|automatic|auto-?reply|artificial intelligence)"),
  // are you real? / is there a real person (there)? / can I talk to a real person|human
  phrase("(?:are|r) (?:you|u) (?:really |actually )?(?:real|automated)"),
  phrase("is there (?:a |an |any )?(?:real|actual) (?:person|human|someone|somebody|one)(?: (?:there|on the other side|behind this|behind the screen))?"),
  phrase("can (?:i|we) (?:talk|speak|chat|text|message) (?:to|with) (?:a |an |some )?(?:real |actual )?(?:person|human|human being|someone real)"),
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

/*
 * Volunteering is about the assistant ITSELF. "We read x-rays with AI" is a fact about the clinic,
 * not a confession, so an AI word only counts inside a self frame (أنا / معاك / I'm / this is ...,
 * at most two words before the AI word, in the same clause) or as a fixed phrase (رد آلي,
 * automated reply). Punctuation ends a clause.
 */
const AI_ANY = `${AR_BOT}|${AR_AI}|${AR_ASSISTANT}|ai|a\\.i\\.|bots?|chatbots?|assistant bots?|artificial intelligence`;
const SELF_FRAME = phrase(
  `(?:انا|معاك|معاكي|معاكم|اسمي|i am|i'm|this is|you are talking to|you're talking to|my name is) (?:[^\\s|]+ ){0,2}?(?:${AI_ANY})`,
);
// "هنا" only counts right next to the word (هنا المساعد الآلي), never in "هنا بنستخدم الذكاء الاصطناعي".
const SELF_HERE = phrase(`هنا (?:${AI_ANY})`);
const SELF_PHRASES: RegExp[] = [
  phrase(`(?:ال)?(?:رد|ردود|رساله|رسايل|رسائل) (?:ال)?(?:الي|اليه)`),
  phrase("automated (?:reply|replies|message|messages|response|responses|assistant|answer)|auto-?repl(?:y|ies)"),
];

/** The reply talks about itself being a bot / AI / automated, as opposed to mentioning AI in passing. */
export function selfMentionsAi(reply: string): boolean {
  const r = normalise(reply).replace(/[.!؟?؛;،,\n]+/g, " | ").replace(/\s+/g, " ");
  return SELF_FRAME.test(r) || SELF_HERE.test(r) || SELF_PHRASES.some((re) => re.test(r));
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

  if (selfMentionsAi(reply) && !asksIfBot(question)) {
    out.push({ rule: "volunteers_ai", detail: "reply mentions being a bot/AI though the patient did not ask" });
  }

  return out;
}
