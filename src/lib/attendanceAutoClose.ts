/**
 * Automatic clock-out for shifts nobody closed.
 *
 * Why this exists: clocking out needs the person to be standing in the clinic. Someone who walks
 * out without tapping the button cannot fix it from home, so the shift stays open until they are
 * back the next day — and is then recorded as 24 hours, or four days over a weekend. In one real
 * clinic half of all shifts looked like that, and an admin was rejecting the overtime by hand on
 * every one.
 *
 * The clinic admin sets one number: how many hours after the end of the shift an open shift is
 * closed. The shift is closed AT that moment (shift end + hours), not at whenever the scheduled
 * job happened to run, so the recorded hours do not depend on timing nobody controls.
 *
 * Pure on purpose — no Firestore, no clock of its own — so the rule can be tested exactly.
 */

export type DaySchedule = { active?: boolean; start?: string; end?: string };
export type WeekSchedule = Record<string, DaySchedule | undefined>;

/** The longest grace an admin can set. Beyond this the setting stops preventing anything. */
export const MAX_AUTO_CLOSE_HOURS = 12;

/** Used when the person has no shift that day and the clinic has no closing time saved. */
const FALLBACK_END = "21:00";

/**
 * The same default the attendance screen uses for someone whose shifts were never set:
 * Sunday to Thursday, 13:00–21:00. Kept identical so the screen and this job agree on when a
 * shift ended.
 */
export function defaultWeekSchedule(): WeekSchedule {
  const s: WeekSchedule = {};
  for (let i = 0; i < 7; i++) s[String(i)] = { active: i <= 4, start: "13:00", end: "21:00" };
  return s;
}

/**
 * The admin's setting as a usable number of hours, or null when the feature is off.
 *
 * Empty, zero, negative and unreadable all mean OFF. Zero is deliberately not "close the instant
 * the shift ends": a clinic that typed 0 almost certainly meant "none", and closing people out
 * while they are still seeing the last patient is the worse mistake.
 */
export function parseAutoCloseHours(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_AUTO_CLOSE_HOURS);
}

function parseHm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function offsetMs(timeZone: string, at: Date): number {
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
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asIfUtc - at.getTime();
}

/** Calendar date, weekday (0 = Sunday) and minutes past midnight of an instant, in a timezone. */
function localParts(timeZone: string, at: Date) {
  const shifted = new Date(at.getTime() + offsetMs(timeZone, at));
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** The instant a wall-clock time happens in a timezone. Two passes, for daylight-saving changes. */
function instantAtLocal(timeZone: string, y: number, m: number, d: number, minutes: number): Date {
  const naive = Date.UTC(y, m, d, 0, minutes, 0);
  const guess = new Date(naive - offsetMs(timeZone, new Date(naive)));
  return new Date(naive - offsetMs(timeZone, guess));
}

export type AutoCloseInput = {
  checkIn: Date;
  /** The person's own weekly shifts, keyed "0".."6" (0 = Sunday). Missing = the default week. */
  schedule?: WeekSchedule | null;
  /** The clinic's closing time ("21:00"), used on a day the person has no shift. */
  clinicEnd?: string | null;
  /** Hours after the end of the shift, already through parseAutoCloseHours. */
  hours: number;
  timeZone: string;
};

/**
 * The moment an open shift is closed.
 *
 * - A normal day: the end of that day's shift, plus the grace hours.
 * - A shift that runs past midnight (18:00–02:00): the end is on the following day.
 * - A day the person is not scheduled: the clinic's closing time stands in for the shift end.
 * - Someone who clocks in after their shift already ended: they get the grace hours from when
 *   they clocked in — otherwise they would be closed out before they had arrived.
 */
export function autoCloseCutoff(input: AutoCloseInput): Date {
  const { checkIn, hours, timeZone } = input;
  const local = localParts(timeZone, checkIn);
  const week = input.schedule && typeof input.schedule === "object" ? input.schedule : defaultWeekSchedule();
  const day = week[String(local.weekday)];

  let endMin: number | null = null;
  let startMin: number | null = null;
  if (day && day.active) {
    endMin = parseHm(day.end);
    startMin = parseHm(day.start);
  }
  if (endMin === null) {
    endMin = parseHm(input.clinicEnd) ?? parseHm(FALLBACK_END)!;
    startMin = null;
  }

  let shiftEnd = instantAtLocal(timeZone, local.y, local.m, local.d, endMin);
  // 18:00–02:00: the end belongs to tomorrow.
  if (startMin !== null && endMin <= startMin) {
    shiftEnd = instantAtLocal(timeZone, local.y, local.m, local.d + 1, endMin);
  }

  const from = Math.max(shiftEnd.getTime(), checkIn.getTime());
  return new Date(from + hours * 3_600_000);
}

export type AutoCloseDecision =
  | { close: false; cutoff: Date }
  | { close: true; cutoff: Date; durationMinutes: number };

/** Whether an open shift is due to be closed now, and with what recorded length. */
export function decideAutoClose(input: AutoCloseInput & { now: Date }): AutoCloseDecision {
  const cutoff = autoCloseCutoff(input);
  if (input.now.getTime() < cutoff.getTime()) return { close: false, cutoff };
  const durationMinutes = Math.max(0, Math.round((cutoff.getTime() - input.checkIn.getTime()) / 60000));
  return { close: true, cutoff, durationMinutes };
}
