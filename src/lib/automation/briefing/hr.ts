import type { PunchRecord, StaffRecord } from "./data";
import type { HrSection, HrStaffRow } from "./types";

/**
 * The floor: who is in, who is late, who never came, what it costs.
 *
 * The pay arithmetic deliberately mirrors the payroll table on the Attendance screen — same
 * hourly rate derived from base salary over expected monthly hours, same overlap-with-schedule
 * split between regular and overtime, same rule that unreviewed overtime is pending rather than
 * assumed. Two screens disagreeing about what someone earned is a payroll argument, and the brief
 * is the one people will read first.
 *
 * Three things this cannot do, and does not pretend to:
 *
 *  - Judge anyone who has no work schedule configured. Without a start time there is no such
 *    thing as late, and no such thing as absent. Those people are counted in `withoutSchedule`
 *    and left out of every lateness figure rather than silently scored as perfect.
 *  - Report leave, sickness or an approved day off. Nothing in the system records them, so a
 *    scheduled day with no punch reads as absent even when it was agreed in advance.
 *  - Detect a punch from someone else's phone. The device check happens at clock-in and blocks
 *    the punch outright, so there is no record of one to find. What is reported instead is staff
 *    with no device registered yet — whose next punch will bind to whatever phone they use.
 */

/** Minutes past the scheduled start before an arrival is called late, rather than just imprecise. */
const LATE_GRACE_MINUTES = 5;

/**
 * How long after a shift should have started before a missing punch counts as absent.
 *
 * Without this, an owner opening the brief at nine sees the whole evening shift marked absent.
 */
const ABSENT_GRACE_MINUTES = 30;

/** A GPS fix vaguer than this was accepted on trust rather than on evidence. */
const VAGUE_ACCURACY_M = 120;

function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return 0;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

/** Weekday for a YYYY-MM-DD key, 0 = Sunday. Anchored at midday so no timezone can shift it. */
function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

/** Minutes from midnight for an instant, read on the clinic's clock rather than the server's. */
function minutesInZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

function eachDate(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const last = new Date(`${endDate}T12:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function buildHrSection(args: {
  staff: StaffRecord[];
  punches: PunchRecord[];
  startDate: string;
  endDate: string;
  /** Today on the clinic's calendar — days after this are not judged at all. */
  today: string;
  /** Minutes from midnight, right now, on the clinic's clock. */
  nowMinutes: number;
  timeZone: string;
  geofenceRadiusM: number;
  /** First of the current month, for the payroll-to-date figure the weekly brief shows. */
  monthStart: string;
}): { section: HrSection; payrollMonthToDate: number } {
  const { staff, punches, startDate, endDate, today, nowMinutes, timeZone, geofenceRadiusM, monthStart } = args;

  const byUser = new Map<string, PunchRecord[]>();
  for (const punch of punches) {
    const list = byUser.get(punch.userId) || [];
    list.push(punch);
    byUser.set(punch.userId, list);
  }

  const days = eachDate(startDate, endDate).filter((d) => d <= today);
  const rows: HrStaffRow[] = [];
  /** Pay rate per staff id, so the overtime-cost total does not re-derive it and risk drifting. */
  const rates = new Map<string, { hourlyRate: number; multiplier: number }>();
  let payrollMonthToDate = 0;

  for (const person of staff) {
    const all = byUser.get(person.uid) || byUser.get(person.id) || [];

    const expectedWeeklyMinutes = person.schedule
      ? Object.values(person.schedule).reduce(
          (sum, day) => (day.active ? sum + Math.max(0, timeToMinutes(day.end) - timeToMinutes(day.start)) : sum),
          0
        )
      : 0;
    const expectedMonthlyHours = (expectedWeeklyMinutes * 52) / (12 * 60);
    const hourlyRate = expectedMonthlyHours > 0 ? person.baseSalary / expectedMonthlyHours : 0;
    rates.set(person.id, { hourlyRate, multiplier: person.overtimeMultiplier });

    const row: HrStaffRow = {
      staffId: person.id,
      uid: person.uid || person.id,
      name: person.name,
      role: person.role,
      hasSchedule: Boolean(person.schedule) && expectedWeeklyMinutes > 0,
      scheduledDays: 0,
      daysWorked: 0,
      minutesWorked: 0,
      lateMinutes: 0,
      lateDays: 0,
      absentDays: 0,
      activeNow: false,
      openShifts: 0,
      overtimeApprovedMinutes: 0,
      overtimePendingMinutes: 0,
      estimatedPay: 0,
      flags: [],
    };

    if (!person.registeredDeviceId) row.flags.push("no_device_registered");

    let regularMinutes = 0;
    let monthRegularMinutes = 0;
    let monthApprovedOvertime = 0;

    for (const dateKey of days) {
      const dayPunches = all.filter((p) => p.date === dateKey);
      const weekday = weekdayOf(dateKey);
      const dayConfig = person.schedule?.[weekday];
      const isScheduled = Boolean(dayConfig?.active) && row.hasSchedule;

      if (isScheduled) row.scheduledDays += 1;

      if (dayPunches.length === 0) {
        if (!isScheduled || !dayConfig) continue;
        const startMinutes = timeToMinutes(dayConfig.start);
        // A shift that has not plausibly begun yet is not an absence.
        const dayIsOver = dateKey < today;
        const startHasPassed = dateKey === today && nowMinutes > startMinutes + ABSENT_GRACE_MINUTES;
        if (dayIsOver || startHasPassed) row.absentDays += 1;
        continue;
      }

      row.daysWorked += 1;

      let firstIn: number | null = null;
      for (const punch of dayPunches) {
        if (!punch.checkIn) continue;

        const inMinutes = minutesInZone(punch.checkIn, timeZone);
        if (firstIn === null || inMinutes < firstIn) firstIn = inMinutes;

        if (punch.status === "active") {
          if (dateKey === today) row.activeNow = true;
          // Clocked in on a day that has already ended and never clocked out.
          else row.openShifts += 1;
        }

        const worked =
          punch.status === "active" && dateKey === today
            ? Math.max(0, nowMinutes - inMinutes)
            : punch.durationMinutes;
        row.minutesWorked += worked;

        if (
          punch.checkInDistanceM != null &&
          geofenceRadiusM > 0 &&
          punch.checkInDistanceM > geofenceRadiusM * 2 &&
          !row.flags.includes("far_punch")
        ) {
          row.flags.push("far_punch");
        }
        if (
          punch.checkInAccuracyM != null &&
          punch.checkInAccuracyM > VAGUE_ACCURACY_M &&
          !row.flags.includes("vague_gps")
        ) {
          row.flags.push("vague_gps");
        }

        // Regular versus overtime, split the same way the payroll table splits it: the part of
        // the shift that overlaps the roster is regular, everything else is overtime.
        let overtime = 0;
        if (!dayConfig || !dayConfig.active) {
          overtime = worked;
        } else {
          const schedStart = timeToMinutes(dayConfig.start);
          const schedEnd = timeToMinutes(dayConfig.end);
          let outMinutes = punch.checkOut ? minutesInZone(punch.checkOut, timeZone) : inMinutes + worked;
          if (outMinutes < inMinutes) outMinutes += 24 * 60;

          const overlap = Math.max(0, Math.min(schedEnd, outMinutes) - Math.max(schedStart, inMinutes));
          regularMinutes += overlap;
          if (dateKey >= monthStart) monthRegularMinutes += overlap;
          overtime = Math.max(0, worked - overlap);
        }

        if (overtime > 0) {
          if (punch.overtimeStatus === "approved") {
            row.overtimeApprovedMinutes += overtime;
            if (dateKey >= monthStart) monthApprovedOvertime += overtime;
          } else if (punch.overtimeStatus !== "rejected") {
            row.overtimePendingMinutes += overtime;
          }
        }
      }

      if (isScheduled && dayConfig && firstIn !== null) {
        const late = firstIn - timeToMinutes(dayConfig.start);
        if (late > LATE_GRACE_MINUTES) {
          row.lateMinutes += late;
          row.lateDays += 1;
        }
      }
    }

    row.estimatedPay =
      (regularMinutes / 60) * hourlyRate +
      (row.overtimeApprovedMinutes / 60) * hourlyRate * person.overtimeMultiplier;

    payrollMonthToDate +=
      (monthRegularMinutes / 60) * hourlyRate +
      (monthApprovedOvertime / 60) * hourlyRate * person.overtimeMultiplier;

    // Someone with no punches, no roster and no pay has nothing to report; keeping them would pad
    // the table with every dormant staff record the clinic has ever created.
    if (row.daysWorked === 0 && row.scheduledDays === 0 && row.flags.length === 0) continue;

    rows.push(row);
  }

  rows.sort((a, b) => {
    if (a.activeNow !== b.activeNow) return a.activeNow ? -1 : 1;
    if (a.absentDays !== b.absentDays) return b.absentDays - a.absentDays;
    if (a.lateDays !== b.lateDays) return b.lateDays - a.lateDays;
    return b.minutesWorked - a.minutesWorked;
  });

  const overtimePendingMinutes = rows.reduce((s, r) => s + r.overtimePendingMinutes, 0);

  const overtimePendingCost = rows.reduce((sum, r) => {
    const rate = rates.get(r.staffId);
    if (!rate || r.overtimePendingMinutes <= 0) return sum;
    return sum + (r.overtimePendingMinutes / 60) * rate.hourlyRate * rate.multiplier;
  }, 0);

  return {
    section: {
      staff: rows,
      onFloorNow: rows.filter((r) => r.activeNow).length,
      lateDays: rows.reduce((s, r) => s + r.lateDays, 0),
      absentDays: rows.reduce((s, r) => s + r.absentDays, 0),
      openShifts: rows.reduce((s, r) => s + r.openShifts, 0),
      totalMinutes: rows.reduce((s, r) => s + r.minutesWorked, 0),
      overtimePendingMinutes,
      overtimePendingCost,
      labourCost: rows.reduce((s, r) => s + r.estimatedPay, 0),
      withoutSchedule: rows.filter((r) => !r.hasSchedule).length,
    },
    payrollMonthToDate,
  };
}

/**
 * Who is rostered on a given date.
 *
 * Reads the same per-weekday schedule the payroll split uses, so "on tomorrow" and "counted as
 * absent tomorrow" can never disagree. Staff with no schedule configured are simply absent from
 * the list — there is nothing to read.
 */
export function rosteredOn(staff: StaffRecord[], dateKey: string): string[] {
  const weekday = weekdayOf(dateKey);
  return staff
    .filter((person) => Boolean(person.schedule?.[weekday]?.active))
    .map((person) => person.name)
    .sort((a, b) => a.localeCompare(b));
}
