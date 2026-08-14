/** Calendar date YYYY-MM-DD in an IANA timezone (e.g. Africa/Cairo). */
export function ymdInTimeZone(timeZone: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** Tomorrow's calendar date in clinic timezone (for ~24h appointment reminders). */
export function tomorrowYmdInTimeZone(timeZone: string, now = new Date()): string {
  const today = ymdInTimeZone(timeZone, now);
  const [y, m, d] = today.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return ymdInTimeZone(timeZone, anchor);
}

/**
 * Today's date on the device's own clock, YYYY-MM-DD.
 *
 * For anything a person does while standing in the clinic — clocking in, being marked present —
 * the device's clock IS the clinic's clock. The alternative that was in use, `toISOString()`,
 * gives the date in UTC: in Egypt (UTC+2/+3) a shift punched at half past midnight was filed
 * under the previous day, which is exactly the kind of quiet error that surfaces as a payroll
 * argument at the end of the month.
 */
export function localYmd(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

export function clinicTimeZone(): string {
  const tz = process.env.CLINIC_TIMEZONE?.trim();
  return tz || "Africa/Cairo";
}

/**
 * How far ahead of UTC a timezone is at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than hardcoded, because Egypt reintroduced summer time in 2023: the
 * offset is +2 in winter and +3 in summer. A fixed offset would put every reminder an hour out for
 * half the year, in the direction nobody notices until patients start arriving early.
 */
function timeZoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour` comes back as 24 rather than 0 for midnight in some engines.
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asIfUtc - at.getTime();
}

/**
 * The instant at which the clock in `timeZone` next reads `hour:00` on today's date there.
 *
 * Two passes: the first converts a naive local time to an instant using the offset in force
 * *around* that time, the second re-checks in case the guess landed on the far side of a daylight
 * saving change. Without the second pass, a reminder scheduled for the morning of a clock change
 * goes out an hour early or late.
 */
export function instantAtHourInTimeZone(timeZone: string, hour: number, now = new Date()): Date {
  const [y, m, d] = ymdInTimeZone(timeZone, now).split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, 0, 0);

  const firstGuess = new Date(naive - timeZoneOffsetMs(timeZone, new Date(naive)));
  const settledOffset = timeZoneOffsetMs(timeZone, firstGuess);
  return new Date(naive - settledOffset);
}
