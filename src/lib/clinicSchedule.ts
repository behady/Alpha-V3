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
