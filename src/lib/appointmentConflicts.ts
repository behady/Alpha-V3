/**
 * Does an existing appointment stand in the way of a new one?
 *
 * Pure functions, no Firebase, so the booking modal, the calendar's drag-and-drop and the public
 * booking endpoint can all decide "is this slot taken" the same way — and so the decision can be
 * tested with fixtures rather than against a live calendar.
 *
 * The reason this exists: every caller used to query `where("doctor", "==", name)`. `doctor` is a
 * display string that has been observed holding an email address, and renaming a dentist rewrites
 * it on the staff record but not on the appointments already booked. So the moment a dentist was
 * renamed, their existing appointments stopped matching the query, the conflict check found
 * nothing, and the clinic could double-book them with no warning at all.
 *
 * `doctorId` is the stable key and has been written on appointments for a while. Matching on it
 * fixes the rename case. Rows predating it carry no id and can still only be matched by name —
 * which is exactly what those rows do today, so nothing regresses for them.
 */

import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { parseApptTimeToMinutes } from "@/lib/appointmentTime";

/** Statuses that release the chair. A cancelled 3pm must not block 3pm forever. */
const RELEASED_STATUSES = new Set(["Cancelled", "No Show"]);

/** Default length assumed for an appointment that somehow has none recorded. */
const FALLBACK_DURATION_MINUTES = 30;

export type ConflictCandidate = {
  id: string;
  time?: string | null;
  duration?: number | null;
  status?: string | null;
  doctor?: string | null;
  doctorId?: string | null;
  roomId?: string | null;
};

export type ConflictQuery = {
  time: string;
  duration: number;
  /** Stable staff id of the dentist being booked. Preferred over the name whenever it is known. */
  doctorId?: string | null;
  /** Display name, used for rows that predate doctorId. */
  doctorName?: string | null;
  /** Appointment being edited — never conflicts with itself. */
  excludeAppointmentId?: string | null;
};

/** Case- and whitespace-insensitive form, so "Dr. Ahmed " and "dr. ahmed" are one dentist. */
export function normalizeDoctorName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

/** Has this appointment been released (cancelled / no-show)? */
export function isReleasedAppointment(status: string | null | undefined): boolean {
  return RELEASED_STATUSES.has(normalizeAppointmentStatus(String(status || "")));
}

/**
 * Is this existing appointment one of the dentist we are booking?
 *
 * With no dentist named at all, every appointment counts — one chair is the assumption, and it is
 * the safe direction.
 *
 * `slotSuggestions` deliberately makes the opposite choice for id-less rows: it treats them as
 * blocking whoever asks, because handing the AI planner a slot that turns out to be taken is worse
 * than hiding one that was free. Here the check is advisory (the user is asked whether to proceed),
 * so precision matters more than caution and an id-less row is matched by name — unchanged from
 * how every one of these callers already behaved.
 */
export function apptBlocksDoctor(
  appt: Pick<ConflictCandidate, "doctor" | "doctorId">,
  doctorId?: string | null,
  doctorName?: string | null
): boolean {
  const wantedId = String(doctorId || "").trim();
  const wantedName = normalizeDoctorName(doctorName);
  if (!wantedId && !wantedName) return true;

  const apptId = String(appt.doctorId || "").trim();
  if (apptId) {
    // The appointment knows exactly whose it is. Trust that over any display string, and when we
    // have no id to compare against fall back to the name rather than letting it through.
    if (wantedId) return apptId === wantedId;
    return normalizeDoctorName(appt.doctor) === wantedName;
  }

  // Legacy row with no doctorId: the name is all there is.
  const apptName = normalizeDoctorName(appt.doctor);
  if (!apptName) return true; // Belongs to nobody in particular — treat it as occupying the chair.
  return wantedName ? apptName === wantedName : false;
}

/** Do [aStart, aEnd) and [bStart, bEnd) overlap? Touching end-to-start does not count. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function durationOf(appt: ConflictCandidate): number {
  const value = Number(appt.duration);
  return value > 0 ? value : FALLBACK_DURATION_MINUTES;
}

/**
 * Every appointment in `existing` that clashes with the requested slot for this dentist.
 *
 * Callers fetch a single day (`where("date", "==", …)`) and filter here. A day's worth of
 * appointments is small, and doing the match in memory is what lets one row be matched by id and
 * the next by name — something a Firestore query cannot express.
 */
export function findDoctorConflicts(
  existing: ConflictCandidate[],
  query: ConflictQuery
): ConflictCandidate[] {
  const start = parseApptTimeToMinutes(query.time);
  const end = start + (Number(query.duration) > 0 ? Number(query.duration) : FALLBACK_DURATION_MINUTES);
  const exclude = String(query.excludeAppointmentId || "");

  return existing.filter((appt) => {
    if (exclude && appt.id === exclude) return false;
    if (isReleasedAppointment(appt.status)) return false;
    if (!apptBlocksDoctor(appt, query.doctorId, query.doctorName)) return false;
    const apptStart = parseApptTimeToMinutes(String(appt.time || ""));
    return intervalsOverlap(start, end, apptStart, apptStart + durationOf(appt));
  });
}

/** Same shape for rooms, which have always had a stable id and need no name fallback. */
export function findRoomConflicts(
  existing: ConflictCandidate[],
  query: { time: string; duration: number; roomId: string; excludeAppointmentId?: string | null }
): ConflictCandidate[] {
  const roomId = String(query.roomId || "").trim();
  if (!roomId) return [];
  const start = parseApptTimeToMinutes(query.time);
  const end = start + (Number(query.duration) > 0 ? Number(query.duration) : FALLBACK_DURATION_MINUTES);
  const exclude = String(query.excludeAppointmentId || "");

  return existing.filter((appt) => {
    if (exclude && appt.id === exclude) return false;
    if (isReleasedAppointment(appt.status)) return false;
    if (String(appt.roomId || "").trim() !== roomId) return false;
    const apptStart = parseApptTimeToMinutes(String(appt.time || ""));
    return intervalsOverlap(start, end, apptStart, apptStart + durationOf(appt));
  });
}
