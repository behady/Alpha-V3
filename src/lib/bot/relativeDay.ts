/**
 * "النهارده" / "بكره" / "بعد بكره", worked out from the calendar instead of guessed by the model.
 *
 * On Saturday 14/11 at 06:52 the assistant offered "بكره السبت الساعة 3:00 م" — today's slot,
 * called tomorrow. The slot labels it copies are right ("السبت 14/11 الساعة 3:00 م"); the relative
 * word was the model's own arithmetic, done without knowing what day it was, and the prompt's only
 * worked example taught it to call the first time "بكره". Over 30 days of logged replies, 16 of the
 * 49 that used a day word were "بكره <today's weekday>".
 *
 * Two uses: the prompt shows each offered slot with the word that is true today (relativeDayWord),
 * and the reply is checked after the model writes it (fixRelativeDayWords). Pure: no clock is read
 * here, the caller passes the clinic's today (clinicNow().dateKey).
 */

// Arabic LETTERS only. The whole block (\u0600-\u06FF) also holds "،" "؛" "؟", and then
// "بكره الأربعاء،" looked like one long word and slipped through.
const AR = "\u0621-\u064A\u0671-\u06D3";

/** "2026-11-14" + n calendar days. UTC noon, so no machine offset can move the date. */
export function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isKey = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k);

/** The word a receptionist would put before this date, or "" when none fits. */
export function relativeDayWord(dateKey: string, todayKey: string): string {
  if (!isKey(dateKey) || !isKey(todayKey)) return "";
  if (dateKey === todayKey) return "النهارده";
  if (dateKey === shiftDateKey(todayKey, 1)) return "بكره";
  if (dateKey === shiftDateKey(todayKey, 2)) return "بعد بكره";
  return "";
}

const DOW: Record<string, number> = { احد: 0, اثنين: 1, اتنين: 1, ثلاثاء: 2, ثلاثا: 2, تلات: 2, تلاتاء: 2, اربعاء: 3, اربع: 3, خميس: 4, جمعه: 5, سبت: 6 };
const EN_DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const dayIndex = (w: string) => DOW[w.replace(/^ال/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")];

/**
 * Days from today to the day the reply named: by its date when it gave one (the date wins over
 * the weekday), else by weekday. -1 = a date further out than بعد بكره; null = nothing to check.
 */
function offsetOf(todayKey: string, weekday: number | undefined, day?: string, month?: string): number | null {
  if (day && month) {
    for (const k of [0, 1, 2]) {
      const key = shiftDateKey(todayKey, k);
      if (Number(key.slice(8, 10)) === Number(latin(day)) && Number(key.slice(5, 7)) === Number(latin(month))) return k;
    }
    return -1;
  }
  if (weekday === undefined || weekday < 0) return null;
  const today = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
  return (weekday - today + 7) % 7;
}

const AR_REL = String.raw`(بعد\s+بكر[هةا]|بكر[هةا]|(?:ال|ا|إ)نهارد[هة])`;
// No comma: "مش هينفع بكره، السبت فيه" is two days, not one day said twice.
const AR_SEP = String.raw`(\s*(?:[(:\-–—]\s*)?(?:يوم\s+)?)`;
const AR_DAY = "(ال(?:أحد|احد|إثنين|اثنين|اتنين|إتنين|ثلاثاء|ثلاثا|تلات|تلاتاء|أربعاء|اربعاء|أربع|اربع|خميس|جمعة|جمعه|سبت))";
const NUM = "([0-9٠-٩]{1,2})";
// The weekday must carry "ال" and end its word, so "النهارده حد من الاستقبال" is not a day. An
// attached "و"/"ف" ("وبكره الأحد") belongs to the word and stays where it is. "السبت الجاي" is next
// week's Saturday, a different day from this one: never touched. "اليوم" is left out on purpose —
// it also just means "the day".
const AR_RE = new RegExp(
  String.raw`(?<![${AR}])([وف](?=بعد|بكر|ال?نهارد|انهارد)|)${AR_REL}${AR_SEP}(?:${AR_DAY}(?![${AR}])(?!\s*(?:الجا[يى]|الجاي[هة]|القادم|اللي\s+جا[يى]))(?:\s*${NUM}\s*/\s*${NUM})?|${NUM}\s*/\s*${NUM})`,
  "g"
);
const EN_RE = new RegExp(
  String.raw`\b(the day after tomorrow|tomorrow|today)\b(,?\s*(?:on\s+)?\(?\s*)(?:\b(${EN_DOW.join("|")})\b(?:\s*(\d{1,2})\s*/\s*(\d{1,2}))?|(\d{1,2})\s*/\s*(\d{1,2}))`,
  "gi"
);

/** What stays of the separator when the word is dropped: an opening bracket, "يوم" — not the gap or a dash. */
function keptSeparator(sep: string): string {
  const bracket = sep.indexOf("(");
  return bracket >= 0 ? sep.slice(bracket) : sep.replace(/^[\s:\-–—]+/, "");
}

/**
 * A relative day word that contradicts the weekday or date written right after it is corrected
 * to the one that fits ("بكره السبت" on a Saturday → "النهارده السبت"), or dropped when none fits
 * ("بكره السبت 21/11" → "السبت 21/11"). The weekday and date win because they are copied from the
 * code's own slot labels; the relative word is the model's own arithmetic. Anything else — a
 * correct pair, a bare "بكره" with no day beside it — is returned byte-identical.
 */
export function fixRelativeDayWords(text: string, todayKey: string): string {
  if (!text || !isKey(todayKey)) return text;
  const ar = text.replace(AR_RE, (all: string, and: string, rel: string, sep: string, wd?: string, d1?: string, m1?: string, d2?: string, m2?: string) => {
    const said = /^بعد/.test(rel) ? 2 : /^بكر/.test(rel) ? 1 : 0;
    const off = offsetOf(todayKey, wd ? dayIndex(wd) : undefined, d1 ?? d2, m1 ?? m2);
    if (off === null || off === said) return all;
    const rest = all.slice(and.length + rel.length + sep.length);
    const word = off === 0 ? "النهارده" : off === 1 ? "بكره" : off === 2 ? "بعد بكره" : "";
    // No word fits (the date is further out): drop it and keep the day — "وبكره السبت 21/11" → "والسبت 21/11".
    return word ? `${and}${word}${sep}${rest}` : `${and}${keptSeparator(sep)}${rest}`;
  });
  return ar.replace(EN_RE, (all: string, rel: string, sep: string, wd?: string, d1?: string, m1?: string, d2?: string, m2?: string) => {
    const r = rel.toLowerCase();
    const said = r.startsWith("the day after") ? 2 : r === "tomorrow" ? 1 : 0;
    const off = offsetOf(todayKey, wd ? EN_DOW.indexOf(wd.toLowerCase()) : undefined, d1 ?? d2, m1 ?? m2);
    if (off === null || off === said) return all;
    const rest = all.slice(rel.length + sep.length);
    const cap = /^[A-Z]/.test(rel);
    let word = off === 0 ? "today" : off === 1 ? "tomorrow" : off === 2 ? "the day after tomorrow" : "";
    if (!word) {
      // "I have tomorrow, Saturday 21/11" → "I have Saturday 21/11": no stray "on" or comma left behind.
      const tail = `${sep.includes("(") ? sep.slice(sep.indexOf("(")) : ""}${rest}`;
      return cap ? tail[0].toUpperCase() + tail.slice(1) : tail;
    }
    if (cap) word = word[0].toUpperCase() + word.slice(1);
    return `${word}${sep}${rest}`;
  });
}
