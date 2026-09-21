export const getFirstDay = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
export const getToday = () => new Date().toISOString().split("T")[0];

/**
 * Cash actually collected (or spent) on a ledger row.
 *
 * Which field holds the money depends on the write path that created the row, and several paths
 * store a placeholder `0` in the fields they don't use instead of omitting them — the inline
 * appointment payment writes `amount: 0, paid: <real amount>`, for example. That makes a `??`
 * chain the wrong tool here: `??` only falls through on null/undefined, so the placeholder `0`
 * wins and the row reads as free. Take the first candidate that is actually non-zero instead.
 *
 * Priority is per row type: payments and manual income carry the money in `paid`, expenses in
 * `cost`, and a procedure row only counts as cash once something has been `paid` against it
 * (its `cost`/`amount` are the treatment plan total, not money in the drawer).
 */
export function ledgerCashValue(row: Record<string, unknown>): number {
  const type = String(row.type || "");
  const candidates =
    type === "expense" ? [row.cost, row.amount] :
    type === "procedure" ? [row.paid] :
    [row.paid, row.amount];

  for (const candidate of candidates) {
    const n = Number(candidate ?? 0) || 0;
    if (n !== 0) return n;
  }
  return 0;
}

export function cleanName(value: unknown, fallback = "Unknown"): string {
  const v = String(value ?? "").trim();
  if (!v || v === "undefined" || v === "null") return fallback;
  return v;
}

/* --- the periods a clinic actually asks for ---------------------------------------------------- */

/**
 * The ranges an owner wants, named.
 *
 * "How did last month go" was two calendar pickers and half a dozen clicks, and every accepted
 * keystroke in either box refired the whole query — so stepping a month with the arrow keys cost a
 * full read per step. A preset sets both ends in ONE change, which makes it both quicker to ask and
 * cheaper to answer.
 *
 * The week starts on SATURDAY. The rest of the app already knows this (`weekStart` in
 * dentistReport.ts) and a report whose "this week" disagreed with the dentist's own screen about
 * which days it covered would be worse than having no preset at all.
 */
export type RangePreset = "today" | "week" | "month" | "lastMonth" | "quarter" | "year" | "custom";

export type DateRange = { start: string; end: string };

export function rangeFor(preset: Exclude<RangePreset, "custom">, todayYmd = getToday()): DateRange {
  const [y, m, d] = todayYmd.split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const at = (dt: Date) => dt.toISOString().slice(0, 10);

  switch (preset) {
    case "today":
      return { start: todayYmd, end: todayYmd };
    case "week": {
      // getUTCDay(): 0 = Sunday, 6 = Saturday. Saturday is day 0 of the Egyptian working week.
      const back = (today.getUTCDay() + 1) % 7;
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - back);
      return { start: at(start), end: todayYmd };
    }
    case "month":
      return { start: at(new Date(Date.UTC(y, m - 1, 1))), end: todayYmd };
    case "lastMonth": {
      const first = new Date(Date.UTC(y, m - 2, 1));
      // Day 0 of this month is the last day of the previous one, whatever its length.
      const last = new Date(Date.UTC(y, m - 1, 0));
      return { start: at(first), end: at(last) };
    }
    case "quarter": {
      const qStart = Math.floor((m - 1) / 3) * 3;
      return { start: at(new Date(Date.UTC(y, qStart, 1))), end: todayYmd };
    }
    case "year":
      return { start: at(new Date(Date.UTC(y, 0, 1))), end: todayYmd };
  }
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/**
 * A range said the way a person says it.
 *
 * The screen printed `2026-08-31 → 2026-09-21`, twice, two lines apart. ISO is not how anybody
 * reads a date, and in Arabic the arrow points the wrong way down the page — it says "to" while
 * the eye is travelling right to left. So: a word between the dates, and a single day when both
 * ends are the same day.
 */
export function rangeText(range: DateRange, isAr: boolean): string {
  const months = isAr ? MONTHS_AR : MONTHS_EN;
  const day = (s: string) => {
    const [yy, mm, dd] = s.split("-").map(Number);
    if (!yy || !mm || !dd) return s;
    return `${dd} ${months[mm - 1]}${yy === new Date().getFullYear() ? "" : ` ${yy}`}`;
  };
  if (range.start === range.end) return day(range.start);
  return isAr ? `${day(range.start)} إلى ${day(range.end)}` : `${day(range.start)} to ${day(range.end)}`;
}

/** Which preset a range corresponds to, or "custom" when it matches none. */
export function presetOf(range: DateRange, todayYmd = getToday()): RangePreset {
  const all: Exclude<RangePreset, "custom">[] = ["today", "week", "month", "lastMonth", "quarter", "year"];
  for (const p of all) {
    const r = rangeFor(p, todayYmd);
    if (r.start === range.start && r.end === range.end) return p;
  }
  return "custom";
}
