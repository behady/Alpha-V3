/**
 * The payroll engine, run in the browser for one clinic's team.
 *
 * `buildHrSection` is the arithmetic the nightly brief and `/api/payroll` already use: hours worked,
 * lateness, absences, open shifts, approved overtime, estimated pay. It is a pure function over
 * plain records, so the same answer can be computed on a screen without asking the server — which
 * matters here for two reasons. The route refuses anyone without HR access, so a dentist could not
 * see their own figures through it; and the attendance screen currently keeps its own copy of the
 * same sums, which is how two screens come to quote different wages for the same person.
 *
 * This module is only the adapter: Firestore documents in, the engine's records out.
 *
 * THE ONE DELIBERATE DIFFERENCE. The engine treats a person with no roster as unjudgeable — no
 * expected hours, so no hourly rate, so an estimated pay of zero. That is right for a brief that
 * says "set up a schedule", and wrong for a screen showing somebody's pay, because most staff in a
 * young clinic have no roster yet and a page of zeroes reads as broken rather than as unconfigured.
 * So the assumption the attendance screen has always made is kept — Sunday to Thursday, 13:00 to
 * 21:00 — and it is RETURNED AS SUCH, so the screen can say "no roster set, assuming…" out loud
 * instead of quietly inventing a wage.
 */

import { Timestamp } from "firebase/firestore";
import type { StaffRecord, PunchRecord } from "@/lib/automation/briefing/data";

function str(value: unknown, fallback = ""): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s || fallback;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export type Schedule = Record<number, { active: boolean; start: string; end: string }>;

/**
 * What the attendance screen has always assumed when nobody has set a roster.
 *
 * Sunday to Thursday is the Egyptian working week; 13:00–21:00 is an afternoon-and-evening clinic.
 * Changing these numbers changes what every unrostered person appears to be owed, so they are one
 * definition rather than a literal repeated per file.
 */
export function defaultSchedule(): Schedule {
  const out: Schedule = {};
  for (let day = 0; day < 7; day += 1) {
    out[day] = { active: day <= 4, start: "13:00", end: "21:00" };
  }
  return out;
}

/** The roster as stored, or null when this person has none. Accepts the 0-6 keyed object or an array. */
export function scheduleFrom(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const parsed: Schedule = {};
  let any = false;
  for (let day = 0; day < 7; day += 1) {
    const cfg = source[String(day)] as Record<string, unknown> | undefined;
    if (!cfg || typeof cfg !== "object") continue;
    any = true;
    parsed[day] = {
      active: Boolean(cfg.active),
      start: str(cfg.start, "00:00"),
      end: str(cfg.end, "00:00"),
    };
  }
  return any ? parsed : null;
}

/** The roster to judge this person by, and whether it is really theirs. */
export function expectedScheduleFor(raw: unknown): { schedule: Schedule; assumed: boolean } {
  const stored = scheduleFrom(raw);
  return stored ? { schedule: stored, assumed: false } : { schedule: defaultSchedule(), assumed: true };
}

/** Hours a roster asks for in a week. */
export function weeklyMinutes(schedule: Schedule): number {
  let total = 0;
  for (let day = 0; day < 7; day += 1) {
    const cfg = schedule[day];
    if (!cfg?.active) continue;
    const [sh, sm] = cfg.start.split(":").map(Number);
    const [eh, em] = cfg.end.split(":").map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins > 0) total += mins;
  }
  return total;
}

/**
 * A staff document as the engine wants it.
 *
 * `assumeSchedule` fills in the default roster so the engine produces a real wage rather than zero.
 * The caller learns whether it was assumed from `expectedScheduleFor` and says so on screen.
 */
export function staffRecordFrom(
  id: string,
  data: Record<string, unknown>,
  assumeSchedule = true,
): StaffRecord {
  const { schedule, assumed } = expectedScheduleFor(data.attendanceSchedule);
  return {
    id,
    uid: str(data.uid),
    name: str(data.name, "Unnamed staff"),
    role: str(data.role, "Staff"),
    baseSalary: num(data.baseSalary),
    commissionPercentage: num(data.commissionPercentage),
    overtimeMultiplier: num(data.overtimeMultiplier) || 1.5,
    registeredDeviceId: str(data.registeredDeviceId) || null,
    schedule: assumed && !assumeSchedule ? null : schedule,
  };
}

/**
 * A punch as the engine wants it.
 *
 * The `attendance` collection holds two unrelated kinds of document — staff punches and
 * waiting-room check-ins written when a patient is marked Checked In. Only a punch carries
 * `userId`, so the caller filters on it; the same check the server-side loader makes.
 */
export function punchRecordFrom(id: string, data: Record<string, unknown>): PunchRecord {
  return {
    id,
    userId: str(data.userId),
    staffId: str(data.staffId),
    userName: str(data.userName),
    date: str(data.date),
    checkIn: toDate(data.checkIn),
    checkOut: toDate(data.checkOut),
    durationMinutes: num(data.durationMinutes),
    status: str(data.status),
    overtimeStatus: str(data.overtimeStatus),
    checkInDistanceM: data.checkInDistanceM == null ? null : num(data.checkInDistanceM),
    checkInAccuracyM: data.checkInAccuracyM == null ? null : num(data.checkInAccuracyM),
    deviceId: str(data.deviceId) || null,
  };
}

/** `13h 20m`, and "0h 0m" rather than a blank when there is nothing. */
export function hoursText(minutes: number): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
