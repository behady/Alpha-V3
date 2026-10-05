/**
 * The booking popup's time grid: the times a clinic day offers, and which of them are taken.
 *
 * "Taken" is decided by `findDoctorConflicts`, the same check that warns on save, so the grid can
 * never call a time free and then have the Save button object to it. A taken time stays on the
 * grid (shown red) rather than disappearing: the desk can see the day's shape, and can still
 * double-book on purpose — the save-time warning asks first, exactly as before.
 */
import { findDoctorConflicts, type ConflictCandidate } from "@/lib/appointmentConflicts";
import { minutesToTimeKey, parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";

/** Every bookable start time of a clinic day, in the stored "hh:mm AM" form. */
export function buildDaySlots(sched: ClinicScheduleConfig): string[] {
  const step = sched.slotDuration > 0 ? sched.slotDuration : 30;
  const { start, end } = clinicDayBoundsMinutes(sched);
  const out: string[] = [];
  for (let m = start; m < end; m += step) out.push(minutesToTimeKey(m));
  return out;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `count` consecutive date keys starting at `startKey`. */
export function dateKeysFrom(startKey: string, count: number): string[] {
  const base = parseKey(startKey);
  return Array.from({ length: count }, (_, i) => toKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
}

/** Is this date one of the clinic's weekly days off ("friday", …)? */
export function isClinicOffDay(dateKey: string, offDays: readonly string[]): boolean {
  if (!dateKey || !offDays.length) return false;
  const dayName = parseKey(dateKey).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  return offDays.includes(dayName);
}

/**
 * Where the date strip begins: today, unless the chosen date falls outside the strip — then the
 * strip starts on that date, so the day being booked or edited is always one of the buttons.
 */
export function stripStartFor(todayKey: string, selectedKey: string, count: number): string {
  if (!selectedKey) return todayKey;
  const last = dateKeysFrom(todayKey, count)[count - 1];
  return selectedKey >= todayKey && selectedKey <= last ? todayKey : selectedKey;
}

export type SlotCell = { time: string; busy: boolean; current: boolean };

export type SlotQuery = {
  duration: number;
  doctorId?: string | null;
  doctorName?: string | null;
  /** The appointment being edited, which never blocks itself. */
  excludeAppointmentId?: string | null;
  /** The time already chosen; kept on the grid even when it is not one of the regular slots. */
  current?: string | null;
  /** Clinic opening time in minutes, so times after midnight sort after the evening. */
  dayStartMinutes?: number;
};

export function slotGrid(slots: readonly string[], dayAppointments: ConflictCandidate[], q: SlotQuery): SlotCell[] {
  const currentMin = q.current ? parseApptTimeToMinutes(q.current) : null;
  const times = [...slots];
  if (currentMin !== null && !times.some((t) => parseApptTimeToMinutes(t) === currentMin)) {
    times.push(minutesToTimeKey(currentMin));
  }
  const start = q.dayStartMinutes ?? (slots.length ? parseApptTimeToMinutes(slots[0]) : 0);
  const order = (t: string) => {
    const m = parseApptTimeToMinutes(t);
    return m < start ? m + 24 * 60 : m;
  };
  times.sort((a, b) => order(a) - order(b));
  return times.map((time) => ({
    time,
    current: currentMin !== null && parseApptTimeToMinutes(time) === currentMin,
    busy:
      findDoctorConflicts(dayAppointments, {
        time,
        duration: q.duration,
        doctorId: q.doctorId,
        doctorName: q.doctorName,
        excludeAppointmentId: q.excludeAppointmentId,
      }).length > 0,
  }));
}
