/** Maps Firestore `settings/clinic_info.schedule` to booking/calendar numbers. */

export type ClinicScheduleConfig = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  slotDuration: number;
  offDays: string[];
  /**
   * Whether these values came from the clinic or from the fallbacks below.
   *
   * Nothing seeds settings/clinic_info at onboarding, so a clinic that never opened the Schedule
   * tab still parses as "open 09:00-21:00, seven days a week" — and until this flag existed there
   * was no way to tell that apart from a clinic that genuinely runs those hours. Anything that
   * reasons about availability has to be able to say "not configured" instead of quietly
   * suggesting a Friday evening slot to a clinic that closes at five.
   */
  isConfigured: boolean;
};

function parseHM(s: unknown, fallbackH: number, fallbackM: number): { h: number; m: number } {
  if (typeof s !== "string" || !s.trim()) return { h: fallbackH, m: fallbackM };
  const parts = s.trim().split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? "0", 10);
  return {
    h: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : fallbackH,
    m: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : fallbackM,
  };
}

export function parseClinicSchedule(data: Record<string, unknown> | undefined | null): ClinicScheduleConfig {
  const sched = (data?.schedule as Record<string, unknown>) || {};
  // Saving the Schedule tab stamps configuredAt. Start/end being present is accepted too, so a
  // clinic that configured its hours before this flag existed is not told to do it again.
  const isConfigured =
    Boolean(sched.configuredAt) ||
    (typeof sched.start === "string" && sched.start.trim() !== "" &&
     typeof sched.end === "string" && sched.end.trim() !== "");
  const start = parseHM(sched.start, 9, 0);
  const end = parseHM(sched.end, 21, 0);
  let slotDuration = parseInt(String(sched.slotDuration ?? "30"), 10);
  if (!Number.isFinite(slotDuration) || slotDuration <= 0) slotDuration = 30;
  const offDays = Array.isArray(sched.offDays)
    ? sched.offDays.map((d: unknown) => String(d).toLowerCase().trim()).filter(Boolean)
    : [];
  return {
    startHour: start.h,
    startMinute: start.m,
    endHour: end.h,
    endMinute: end.m,
    slotDuration,
    offDays,
    isConfigured,
  };
}

/** Total minutes from midnight for slot iteration */
export function clinicDayBoundsMinutes(c: ClinicScheduleConfig): { start: number; end: number } {
  const start = c.startHour * 60 + c.startMinute;
  let end = c.endHour * 60 + c.endMinute;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

export type DayBounds = {
  /** Where the drawn day starts and ends, in minutes from midnight (end may pass 1440). */
  start: number;
  end: number;
  /** The clinic's own hours, so the grid can shade what lies outside them. */
  clinicStart: number;
  clinicEnd: number;
};

/**
 * A visit's start on the drawn day. A clinic that runs past midnight has an `end` beyond 1440,
 * and a visit stored as "00:30" belongs at the end of that day, not before its start.
 */
export function visitStartInDay(startMin: number, bounds: { start: number; end: number }): number {
  if (bounds.end > 24 * 60 && startMin < bounds.start && startMin + 24 * 60 < bounds.end) {
    return startMin + 24 * 60;
  }
  return startMin;
}

/**
 * The day's bounds, widened so every visit actually booked on it is on screen.
 *
 * The schedule used to draw exactly the clinic's hours and drop whatever fell outside them: a
 * visit at 09:00 on a clinic set to open at 10:00 was filtered out of the day view and simply did
 * not exist there, while the calendar page pinned it to the top edge. Both are wrong in the same
 * way — the booking is real, and a screen that hides it is a screen the desk cannot trust. The
 * common case is a clinic that changes its hours in Settings after visits were already booked.
 *
 * The widening is in whole slots, measured from the clinic's own opening time, so the slot rows
 * stay aligned with the hours the clinic actually keeps.
 */
export function dayBoundsCovering(
  c: ClinicScheduleConfig,
  visits: ReadonlyArray<{ startMin: number; endMin: number }>,
): DayBounds {
  const clinic = clinicDayBoundsMinutes(c);
  const slot = Number.isFinite(c.slotDuration) && c.slotDuration > 0 ? c.slotDuration : 30;
  let { start, end } = clinic;
  for (const v of visits) {
    if (!Number.isFinite(v.startMin) || !Number.isFinite(v.endMin)) continue;
    const s = visitStartInDay(v.startMin, clinic);
    const e = s + Math.max(1, v.endMin - v.startMin);
    if (s < start) start -= Math.ceil((start - s) / slot) * slot;
    if (e > end) end += Math.ceil((e - end) / slot) * slot;
  }
  return { start: Math.max(0, start), end, clinicStart: clinic.start, clinicEnd: clinic.end };
}
