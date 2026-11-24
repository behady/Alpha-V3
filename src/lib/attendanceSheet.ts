/**
 * One person's clock-ins for a period, as a sheet: a row per shift and a row per missed day, what
 * each shift paid, the filters above it, and the totals under it.
 *
 * The owner asked (2026-11-24) for the team page's clock-in tab to read like the Finance → GASCO
 * sheet — filters, one line per day, an Excel download — and for the sheet to show how clocking in
 * and out becomes a wage for someone on a fixed salary. So every shift carries its pay, worked out
 * by the payroll engine's own split (`shiftPaySplit`, `hourlyRateFor`): the time inside the roster
 * at the hour price, approved extra time at the extra-time rate, nothing for refused or unanswered
 * extra time. A test holds the sum of those days to `buildHrSection`'s estimated pay — the "Owed"
 * figure at the top of the same profile.
 *
 * Rule 3 of the team page holds here too: on an ASSUMED roster (nobody set one) no row is called
 * late and no missed day is listed, because those would be facts about the assumption.
 *
 * Pure: no Firestore, no React. The tab draws it and `attendanceSheetXlsx` writes it.
 */

import type { PunchRecord } from "@/lib/automation/briefing/data";
import { dayCountsAbsent, dayLateMinutes, hourlyRateFor, shiftPaySplit } from "@/lib/automation/briefing/hr";
import type { Schedule } from "@/lib/hrClient";

/** A clock-in further than this from the clinic is marked far (red on the page). */
export const FAR_FROM_CLINIC_M = 300;

export type ShiftRow = {
  kind: "shift";
  id: string;
  date: string;
  punch: PunchRecord;
  checkIn: Date | null;
  checkOut: Date | null;
  /** Clocked in today and not out yet. */
  stillIn: boolean;
  /** Left open on a day that is over: they forgot to clock out. */
  forgot: boolean;
  /** Closed by the system after a forgotten clock-out. */
  autoClosed: boolean;
  worked: number;
  /** Minutes inside the roster: paid at the hour price. */
  regular: number;
  /** Minutes outside it: paid only once approved. */
  extra: number;
  /** Only on a FINISHED shift with extra time: what was decided about it. */
  extraDecision: "approved" | "rejected" | "pending" | null;
  /** Minutes late, on the day's first clock-in only; 0 on an assumed roster. */
  late: number;
  /** What this shift earned; null when the person has no fixed salary. */
  pay: number | null;
  distanceM: number | null;
  far: boolean;
  branchName: string | null;
};

export type AbsentRow = { kind: "absent"; id: string; date: string; pay: number | null };

export type SheetRow = ShiftRow | AbsentRow;

export type SheetFilter = "all" | "late" | "extra" | "open" | "far" | "absent";
export const SHEET_FILTERS: readonly SheetFilter[] = ["all", "late", "extra", "open", "far", "absent"];

export type AttendanceSheet = {
  /** Newest first. */
  rows: SheetRow[];
  /** Salary ÷ the roster's monthly hours; 0 without a salary. */
  hourlyRate: number;
  /** Monthly hours the roster asks for (the hour price's divisor). */
  monthlyHours: number;
  /** The person has a fixed salary, so the Day's pay column is shown. */
  payShown: boolean;
  totals: { days: number; worked: number; extra: number; lateDays: number; lateMinutes: number; absentDays: number; pay: number };
  counts: Record<SheetFilter, number>;
};

export function matchesFilter(row: SheetRow, filter: SheetFilter): boolean {
  if (filter === "all") return true;
  if (row.kind === "absent") return filter === "absent";
  switch (filter) {
    case "late":
      return row.late > 0;
    case "extra":
      return row.extraDecision !== null;
    case "open":
      return row.forgot || row.autoClosed;
    case "far":
      return row.far;
    default:
      return false;
  }
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function buildAttendanceSheet(args: {
  /** This person's punches in the period. */
  punches: readonly PunchRecord[];
  schedule: Schedule;
  /** The roster is the clinic default, not theirs. */
  assumed: boolean;
  baseSalary: number;
  overtimeMultiplier: number;
  startDate: string;
  endDate: string;
  /** Today and the minutes past midnight now, on the clinic's clock. */
  today: string;
  nowMinutes: number;
  timeZone: string;
}): AttendanceSheet {
  const { schedule, assumed, startDate, endDate, today, nowMinutes, timeZone } = args;
  const now = { today, nowMinutes };
  const multiplier = args.overtimeMultiplier || 1.5;
  const hourlyRate = hourlyRateFor(args.baseSalary, schedule);
  const weekly = Object.values(schedule).reduce((s, d) => {
    if (!d.active) return s;
    const [sh, sm] = d.start.split(":").map(Number);
    const [eh, em] = d.end.split(":").map(Number);
    return s + Math.max(0, eh * 60 + (em || 0) - (sh * 60 + (sm || 0)));
  }, 0);
  const monthlyHours = (weekly * 52) / (12 * 60);
  const payShown = hourlyRate > 0;
  const judged = !assumed && weekly > 0;

  // The days the engine judges: inside the period, and not after today.
  const last = endDate < today ? endDate : today;
  const inRange = (d: string) => d >= startDate && d <= last;
  const punches = args.punches.filter((p) => inRange(p.date));

  // The day's first clock-in is the one judged for lateness.
  const firstOfDay = new Map<string, PunchRecord>();
  for (const p of punches) {
    if (!p.checkIn) continue;
    const seen = firstOfDay.get(p.date);
    if (!seen || (seen.checkIn && p.checkIn < seen.checkIn)) firstOfDay.set(p.date, p);
  }

  const rows: SheetRow[] = [];
  for (const p of punches) {
    const split = shiftPaySplit(p, schedule, timeZone, now);
    const finished = p.status === "completed";
    const extraDecision: ShiftRow["extraDecision"] =
      finished && split.overtime > 0
        ? p.overtimeStatus === "approved"
          ? "approved"
          : p.overtimeStatus === "rejected"
            ? "rejected"
            : "pending"
        : null;
    const late = judged && firstOfDay.get(p.date)?.id === p.id && p.checkIn ? dayLateMinutes(p.checkIn, p.date, schedule, timeZone) : 0;
    const pay = payShown
      ? (split.regular / 60) * hourlyRate + (p.overtimeStatus === "approved" ? (split.overtime / 60) * hourlyRate * multiplier : 0)
      : null;
    const active = p.status === "active";
    rows.push({
      kind: "shift",
      id: p.id,
      date: p.date,
      punch: p,
      checkIn: p.checkIn,
      checkOut: p.checkOut,
      stillIn: active && p.date === today,
      forgot: active && p.date !== today,
      autoClosed: p.autoClosed === true,
      worked: split.worked,
      regular: split.regular,
      extra: split.overtime,
      extraDecision,
      late,
      pay,
      distanceM: p.checkInDistanceM,
      far: p.checkInDistanceM != null && p.checkInDistanceM > FAR_FROM_CLINIC_M,
      branchName: p.checkInBranchName ?? null,
    });
  }

  const worked = new Set(punches.map((p) => p.date));
  if (judged) {
    for (const d of eachDate(startDate, last)) {
      if (!worked.has(d) && dayCountsAbsent(d, schedule, now)) rows.push({ kind: "absent", id: `absent-${d}`, date: d, pay: payShown ? 0 : null });
    }
  }

  const time = (r: SheetRow) => (r.kind === "shift" ? r.checkIn?.getTime() ?? 0 : 0);
  rows.sort((a, b) => b.date.localeCompare(a.date) || time(b) - time(a));

  const shifts = rows.filter((r): r is ShiftRow => r.kind === "shift");
  const counts = Object.fromEntries(SHEET_FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r, f)).length])) as Record<SheetFilter, number>;
  return {
    rows,
    hourlyRate,
    monthlyHours,
    payShown,
    totals: {
      days: worked.size,
      worked: shifts.reduce((s, r) => s + r.worked, 0),
      extra: shifts.reduce((s, r) => s + r.extra, 0),
      lateDays: shifts.filter((r) => r.late > 0).length,
      lateMinutes: shifts.reduce((s, r) => s + r.late, 0),
      absentDays: rows.length - shifts.length,
      pay: shifts.reduce((s, r) => s + (r.pay ?? 0), 0),
    },
    counts,
  };
}
