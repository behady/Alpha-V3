import { normalizeReplyText } from "@/lib/patientMessaging";

/**
 * The day a patient named, as a date key.
 *
 * "ممكن ميعاد بكره" used to open the day list and throw "بكره" away, so the patient was asked to
 * pick tomorrow from a list of six days that started with tomorrow. Egyptians name near dates by
 * relative word or weekday, not by calendar date — بكره، بعد بكره، الخميس، الجمعه الجايه — and
 * those are the forms read here. A calendar date ("٢/٩") is deliberately not parsed: the list is
 * a fine answer for anything further out than a week, and a guessed month is a booked wrong day.
 */

const DAY_NAMES: Array<[string[], number]> = [
  [["الاحد", "الحد", "حد", "الأحد"], 0],
  [["الاتنين", "الاثنين", "الإثنين", "اتنين", "اثنين"], 1],
  [["التلات", "الثلاثاء", "التلاتاء", "الثلاث", "تلات"], 2],
  [["الاربع", "الأربعاء", "الاربعاء", "الاربعا", "اربع"], 3],
  [["الخميس", "خميس"], 4],
  [["الجمعه", "الجمعة", "جمعه", "جمعة"], 5],
  [["السبت", "سبت"], 6],
];

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns a YYYY-MM-DD key, or null when no day word is present.
 *
 * `todayKey` is the clinic's today (Cairo), never the server's — past 9pm the UTC date is still
 * yesterday, and "بكره" computed from that books the wrong day.
 */
export function parseDayWord(raw: string, todayKey: string): string | null {
  const text = ` ${normalizeReplyText(raw)} `;
  if (!text.trim()) return null;

  if (/ (بعد بكره|بعد بكرا|بعد بكرة|بعد غد) /.test(text)) return addDays(todayKey, 2);
  if (/ (بكره|بكرا|بكرة|غدا|tomorrow) /.test(text)) return addDays(todayKey, 1);
  if (/ (النهارده|انهارده|النهاردة|اليوم|دلوقتي|today) /.test(text)) return todayKey;

  const today = new Date(`${todayKey}T12:00:00`).getDay();
  const nextWeek = / (الجاي|الجايه|الجاية|اللي جاي|القادم|next) /.test(text);
  for (const [names, dow] of DAY_NAMES) {
    if (!names.some((n) => text.includes(` ${n} `))) continue;
    let offset = (dow - today + 7) % 7;
    // "الخميس الجاي" said on a Thursday means next week's; a bare "الخميس" on a Thursday means today.
    if (nextWeek && offset === 0) offset = 7;
    return addDays(todayKey, offset);
  }
  return null;
}
