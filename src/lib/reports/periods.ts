/**
 * Date arithmetic for the comparison and trend reports.
 *
 * All of it works on `YYYY-MM-DD` strings and calendar months, never on timestamps: a report that
 * compares "this month" with "last month" is asking about calendar months, and a clinic's day
 * starts and ends where the clinic is, not where the server is. Nothing here reads the clock —
 * callers pass the range on screen and the module answers with other ranges relative to it, so
 * every function can be pinned by a test on any day of the year.
 */

import type { DateRange } from "@/lib/reportHelpers";

export type MonthKey = string; // "YYYY-MM"

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

/** Inclusive number of days in a range. A single day is 1. */
export function daysIn(range: DateRange): number {
  return Math.round((toDate(range.end).getTime() - toDate(range.start).getTime()) / 86400000) + 1;
}

export function monthKeyOf(ymd: string): MonthKey {
  return ymd.slice(0, 7);
}

export function monthStart(key: MonthKey): string {
  return `${key}-01`;
}

export function monthEnd(key: MonthKey): string {
  const [y, m] = key.split("-").map(Number);
  // Day 0 of the next month is the last day of this one, whatever its length.
  return fromDate(new Date(Date.UTC(y, m, 0)));
}

/** Is the range exactly one or more whole calendar months? */
export function isWholeMonths(range: DateRange): boolean {
  return range.start === monthStart(monthKeyOf(range.start)) && range.end === monthEnd(monthKeyOf(range.end));
}

/**
 * The period immediately before, the same length.
 *
 * Whole calendar months step back by month — "this month" against "last month" compares 30 days
 * with 31 and everybody expects that. Anything else steps back by the exact number of days, so a
 * custom fortnight is compared with the fortnight before it.
 */
export function previousRange(range: DateRange): DateRange {
  if (isWholeMonths(range)) {
    const months = monthsBetween(monthKeyOf(range.start), monthKeyOf(range.end)).length;
    const end = shiftMonth(monthKeyOf(range.start), -1);
    const start = shiftMonth(end, -(months - 1));
    return { start: monthStart(start), end: monthEnd(end) };
  }
  const span = daysIn(range);
  const end = addDays(range.start, -1);
  return { start: addDays(end, -(span - 1)), end };
}

/**
 * The same dates a year earlier. 29 February lands on 28 February, which is the only honest
 * answer; a whole-month range keeps its month ends (Feb 1–29 → Feb 1–28).
 */
export function lastYearRange(range: DateRange): DateRange {
  const back = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return fromDate(new Date(Date.UTC(y - 1, m - 1, Math.min(d, last))));
  };
  if (isWholeMonths(range)) {
    return { start: monthStart(shiftMonth(monthKeyOf(range.start), -12)), end: monthEnd(shiftMonth(monthKeyOf(range.end), -12)) };
  }
  return { start: back(range.start), end: back(range.end) };
}

export function shiftMonth(key: MonthKey, by: number): MonthKey {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Every month from `from` to `to`, inclusive, in order. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = from; k <= to; k = shiftMonth(k, 1)) out.push(k);
  return out;
}

/**
 * The `n` calendar months ending with the month `end` falls in.
 *
 * The trend reports run over this rather than over the range on screen: a range of a week gives
 * a twelve-month chart nothing to draw, and an owner looking at "this month" still wants to see
 * it against the eleven before.
 */
export function trailingMonths(end: string, n: number): { range: DateRange; months: MonthKey[] } {
  const last = monthKeyOf(end);
  const first = shiftMonth(last, -(n - 1));
  return { range: { start: monthStart(first), end: monthEnd(last) }, months: monthsBetween(first, last) };
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** "Sep" or "Sep 25" — the year only when the run of months crosses one. */
export function monthLabel(key: MonthKey, isAr: boolean, withYear = false): string {
  const [y, m] = key.split("-").map(Number);
  const name = (isAr ? MONTHS_AR : MONTHS_EN)[m - 1] || key;
  return withYear ? `${name} ${String(y).slice(2)}` : name;
}

export function monthLongLabel(key: MonthKey, isAr: boolean): string {
  const [y, m] = key.split("-").map(Number);
  return `${(isAr ? MONTHS_AR : MONTHS_EN)[m - 1] || key} ${y}`;
}

/**
 * Day of the week with SATURDAY as 0, the Egyptian working week. Sunday is 1 and Friday, the
 * usual day off, is 6 — so a heatmap reads left to right the way the clinic's week runs.
 */
export function clinicWeekday(ymd: string): number {
  return (toDate(ymd).getUTCDay() + 1) % 7;
}

export const WEEKDAYS_EN = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
export const WEEKDAYS_AR = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

/** Whole days between two dates; negative when `b` is before `a`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

/** Months between two dates, fractional — for "average months between visits". */
export function monthsApart(a: string, b: string): number {
  return daysBetween(a, b) / 30.44;
}
