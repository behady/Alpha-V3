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
