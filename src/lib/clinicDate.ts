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

export function clinicTimeZone(): string {
  const tz = process.env.CLINIC_TIMEZONE?.trim();
  return tz || "Africa/Cairo";
}
