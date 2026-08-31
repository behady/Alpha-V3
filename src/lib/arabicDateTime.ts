/**
 * Dates and times as an Arabic-speaking patient reads them.
 *
 * These lived inside the WhatsApp assistant, so the bot's own messages said "الثلاثاء 1/9" and
 * "6:30 م" while the reminder and confirmation templates — the ones sent unprompted, by the
 * automation, to everybody — sent the raw stored values instead: "2026-09-02" and "06:30 PM". The
 * same clinic, on the same number, in two different languages. That went unnoticed because the
 * test number could only deliver to a single verified phone; it becomes every patient's first
 * impression the moment a real number is connected.
 *
 * So the formatting lives here, and both paths use it. The stored values are untouched: these are
 * a display layer over the canonical `YYYY-MM-DD` date key and `hh:mm AM/PM` time that the
 * calendar and every booking write depend on.
 */

/**
 * Day names in their written forms.
 *
 * Deliberately the printed spellings (`الإثنين`, `الثلاثاء`) rather than the typed ones
 * (`الاتنين`, `التلات`). This is the clinic writing TO a patient, where the formal spelling is
 * what a person would write. Anything matching what a patient types must not reuse this list.
 */
const ARABIC_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** "2026-08-30" -> "السبت 30/8". Returns the input unchanged if it is not a date key. */
export function arabicDayLabel(dateKey: string): string {
  const raw = String(dateKey || "").trim();
  if (!raw) return "";
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return `${ARABIC_DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** "02:00 PM" -> "2:00 م". Returns the input unchanged if it is not a time. */
export function arabicTimeLabel(time: string): string {
  const raw = String(time || "").trim();
  if (!raw) return "";
  return raw.replace(/^0/, "").replace("AM", "ص").replace("PM", "م");
}

/** "14"+"30" -> "2:30 م" — the shape a patient reads, not the shape the calendar stores. */
export function arabicClock(hour: number, minute: number): string {
  const twelve = ((hour + 11) % 12) + 1;
  const mm = minute ? `:${String(minute).padStart(2, "0")}` : ":00";
  return `${twelve}${mm} ${hour < 12 ? "ص" : "م"}`;
}
