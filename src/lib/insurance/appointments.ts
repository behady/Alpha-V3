/**
 * An appointment booked for one service line of an insurance approval.
 *
 * The receptionist books a visit for "the crown on the MetLife paper" the way she books private
 * work, and the appointment carries a small link back: the claim and the line index. Nothing else
 * changes on the appointment, and nothing is charged by the booking — the approval already wrote
 * the treatment and its price into the patient's file when it was saved.
 *
 * Pure functions only, shared by the booking modal, the dashboards' status handlers, the patient's
 * Insurance tab and the Insurance page. The actual writes live in `appointmentSync.ts` (client)
 * and the claims route (server).
 */

import { lineStatusOf, type InsuranceClaim, type LineStatus } from "./claims";

export type ClaimLink = { claimId: string; claimLine: number };

/** The appointment fields these helpers read; every one is optional on a real document. */
export type LinkedAppointmentLite = {
  id?: unknown;
  claimId?: unknown;
  claimLine?: unknown;
  status?: unknown;
  date?: unknown;
  time?: unknown;
  doctor?: unknown;
  doctorId?: unknown;
};

/**
 * The visit happened. "Checking Out" is the dentist's own "done" from the chair (DentistHome) and
 * "Completed" is the desk's; either one means the service was delivered.
 */
export const VISIT_DONE_STATUSES: ReadonlySet<string> = new Set(["Completed", "Checking Out"]);
/** The visit did not happen: the line is back to "not booked" as far as the approval is concerned. */
export const VISIT_VOID_STATUSES: ReadonlySet<string> = new Set(["Cancelled", "No Show"]);

/** The link on an appointment document, or null when it is a plain (private) booking. */
export function parseClaimLink(appt: LinkedAppointmentLite | null | undefined): ClaimLink | null {
  if (!appt) return null;
  const claimId = typeof appt.claimId === "string" ? appt.claimId.trim() : "";
  const line = Number(appt.claimLine);
  if (!claimId || !Number.isInteger(line) || line < 0) return null;
  return { claimId, claimLine: line };
}

/** Line indices still open for booking: not Completed, on an approval that is not cancelled. */
export function openLines(claim: Pick<InsuranceClaim, "lines" | "lineStatus" | "status">): number[] {
  if (claim.status === "cancelled") return [];
  return claim.lines.map((_, i) => i).filter((i) => lineStatusOf(claim, i) !== "Completed");
}

export type LineBooking =
  | { kind: "none" }
  | { kind: "booked"; date: string; time: string; doctor: string; appointmentId: string }
  | { kind: "done"; date: string; appointmentId: string };

function key(a: LinkedAppointmentLite): string {
  return `${String(a.date ?? "")} ${String(a.time ?? "")}`;
}

/**
 * Where one service line stands in the calendar: done (a visit for it was completed), booked (a
 * visit is on the calendar — the soonest one), or none. Cancelled and no-show visits do not count.
 */
export function lineBooking(appointments: readonly LinkedAppointmentLite[], claimId: string, lineIndex: number): LineBooking {
  const mine = appointments.filter((a) => {
    const link = parseClaimLink(a);
    return !!link && link.claimId === claimId && link.claimLine === lineIndex && !VISIT_VOID_STATUSES.has(String(a.status ?? ""));
  });
  const done = mine.filter((a) => VISIT_DONE_STATUSES.has(String(a.status ?? ""))).sort((a, b) => (key(a) < key(b) ? 1 : -1));
  if (done[0]) return { kind: "done", date: String(done[0].date ?? ""), appointmentId: String(done[0].id ?? "") };
  const open = mine.filter((a) => !VISIT_DONE_STATUSES.has(String(a.status ?? ""))).sort((a, b) => (key(a) < key(b) ? -1 : 1));
  if (open[0]) {
    return { kind: "booked", date: String(open[0].date ?? ""), time: String(open[0].time ?? ""), doctor: String(open[0].doctor ?? ""), appointmentId: String(open[0].id ?? "") };
  }
  return { kind: "none" };
}

export type ClaimProgress = { total: number; done: number; booked: number };

/**
 * "2 of 3 done, 1 booked" for an approval: done counts the claim's own line states (the record of
 * truth), booked counts open lines with a visit on the calendar.
 */
export function claimProgress(claim: Pick<InsuranceClaim, "id" | "lines" | "lineStatus" | "status">, appointments: readonly LinkedAppointmentLite[]): ClaimProgress {
  const total = claim.lines.length;
  let done = 0;
  let booked = 0;
  claim.lines.forEach((_, i) => {
    if (lineStatusOf(claim, i) === "Completed") {
      done += 1;
      return;
    }
    if (lineBooking(appointments, claim.id, i).kind === "booked") booked += 1;
  });
  return { total, done, booked };
}

/** The booking page, opened on this patient with this service line already picked. */
export function bookLineUrl(patientId: string, link: ClaimLink): string {
  return `/appointments?book=${encodeURIComponent(patientId)}&claim=${encodeURIComponent(link.claimId)}&line=${link.claimLine}`;
}

export type LineSyncPatch = { lineStatus?: Record<number, LineStatus>; dentists?: Record<number, string | null> };

/**
 * What a finished visit changes on its approval line, or null when nothing does.
 *
 * - A Planned line becomes Completed: that is the moment it goes on the monthly sheet and the
 *   dentist's share is counted (the owner's rule).
 * - An Ongoing line stays Ongoing: several visits make one service, and the desk marks it done
 *   after the last one.
 * - The dentist who did the visit becomes the line's dentist when the line names nobody or
 *   somebody else. A visit with no dentist leaves the line's dentist alone.
 */
export function lineSyncPatch(claim: Pick<InsuranceClaim, "lines" | "lineStatus" | "dentists" | "status">, appt: LinkedAppointmentLite): LineSyncPatch | null {
  const link = parseClaimLink(appt);
  if (!link || claim.status === "cancelled") return null;
  if (!VISIT_DONE_STATUSES.has(String(appt.status ?? ""))) return null;
  const i = link.claimLine;
  if (i >= claim.lines.length) return null;
  const patch: LineSyncPatch = {};
  if (lineStatusOf(claim, i) === "Planned") patch.lineStatus = { [i]: "Completed" };
  const doctorId = typeof appt.doctorId === "string" ? appt.doctorId.trim() : "";
  if (doctorId && claim.dentists[i]?.staffId !== doctorId) patch.dentists = { [i]: doctorId };
  return patch.lineStatus || patch.dentists ? patch : null;
}
