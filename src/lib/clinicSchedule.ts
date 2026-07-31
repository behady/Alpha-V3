/** Maps Firestore `settings/clinic_info.schedule` to booking/calendar numbers. */

export type ClinicScheduleConfig = {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  slotDuration: number;
  offDays: string[];
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
  };
}

/** Total minutes from midnight for slot iteration */
export function clinicDayBoundsMinutes(c: ClinicScheduleConfig): { start: number; end: number } {
  const start = c.startHour * 60 + c.startMinute;
  let end = c.endHour * 60 + c.endMinute;
  if (end <= start) end += 24 * 60;
  return { start, end };
}
