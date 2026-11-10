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

import { isLineRemoved, lineStatusOf, type InsuranceClaim, type LineStatus } from "./claims";

export type ClaimLink = { claimId: string; claimLine: number };

/** The appointment fields these helpers read; every one is optional on a real document. */
export type LinkedAppointmentLite = {
  id?: unknown;
  claimId?: unknown;
  claimLine?: unknown;
  /** Every approved service this visit is for; when present it is the truth and the pair above only mirrors its first entry. */
  claimLinks?: unknown;
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

/**
 * Every approved service an appointment is for.
 *
 * A visit used to carry one link (`claimId` + `claimLine`). It can now carry a list, `claimLinks`,
 * and still writes its first entry into the old pair so screens that read only the pair keep
 * working. Once a list exists it is the truth — an empty list means "unlinked", whatever the
 * mirrored pair still says. A document with no list is read the old way.
 */
export function parseClaimLinks(appt: LinkedAppointmentLite | null | undefined): ClaimLink[] {
  if (!appt) return [];
  const raw = Array.isArray(appt.claimLinks) ? appt.claimLinks : null;
  const candidates = raw ? raw.map((r) => (r && typeof r === "object" ? parseClaimLink(r as LinkedAppointmentLite) : null)) : [parseClaimLink(appt)];
  const seen = new Set<string>();
  const out: ClaimLink[] = [];
  for (const l of candidates) {
    if (!l) continue;
    const k = `${l.claimId}|${l.claimLine}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** The fields an appointment stores for its links: the list, and its first entry in the old pair. */
export function appointmentLinkFields(links: readonly ClaimLink[]): { claimLinks: ClaimLink[]; claimId: string | null; claimLine: number | null } {
  const clean = parseClaimLinks({ claimLinks: links });
  return { claimLinks: clean, claimId: clean[0]?.claimId ?? null, claimLine: clean[0]?.claimLine ?? null };
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
  const mine = appointments.filter(
    (a) =>
      parseClaimLinks(a).some((l) => l.claimId === claimId && l.claimLine === lineIndex) && !VISIT_VOID_STATUSES.has(String(a.status ?? "")),
  );
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
export function claimProgress(
  claim: Pick<InsuranceClaim, "id" | "lines" | "lineStatus" | "status"> & { removedLines?: InsuranceClaim["removedLines"] },
  appointments: readonly LinkedAppointmentLite[],
): ClaimProgress {
  let total = 0;
  let done = 0;
  let booked = 0;
  claim.lines.forEach((_, i) => {
    // A service deleted from the approval is not waiting to be done.
    if (isLineRemoved(claim, i)) return;
    total += 1;
    if (lineStatusOf(claim, i) === "Completed") {
      done += 1;
      return;
    }
    if (lineBooking(appointments, claim.id, i).kind === "booked") booked += 1;
  });
  return { total, done, booked };
}

/**
 * The dashboard, with the booking popup open on this patient and this service line already picked
 * (Insurance tab). Screens without the popup (phone, the dentist's home) pass the same query on
 * to /appointments, which reads it too.
 */
export function bookLineUrl(patientId: string, link: ClaimLink): string {
  return `/?book=${encodeURIComponent(patientId)}&claim=${encodeURIComponent(link.claimId)}&line=${link.claimLine}`;
}

export type LineSyncPatch = { lineStatus?: Record<number, LineStatus>; dentists?: Record<number, string | null>; lineDates?: Record<number, string> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a finished visit changes on its approval line, or null when nothing does.
 *
 * - A Planned line becomes Completed: that is the moment it goes on the monthly sheet and the
 *   dentist's share is counted (the owner's rule).
 * - An Ongoing line stays Ongoing: several visits make one service, and the desk marks it done
 *   after the last one.
 * - The dentist who did the visit becomes the line's dentist when the line names nobody or
 *   somebody else. A visit with no dentist leaves the line's dentist alone.
 * - The visit's date becomes the day THAT SERVICE was done (`lineDates`), when this visit is what
 *   completes it. Each service carries its own day: one done on 20/10 is October's pay, one done on
 *   5/11 is November's, and the approval is billed in the month of the last one
 *   (lib/insurance/billingMonth.ts). The approval's own treated date is not touched — moving it
 *   from the first visit is what used to lock the whole approval to that visit's month.
 *   A day somebody already typed for the service is kept. A visit dated before the approval (a
 *   misread paper) dates nothing. A service that was already done keeps its day, so saving an old
 *   visit again never moves an old approval's month.
 */
export function lineSyncPatch(
  claim: Pick<InsuranceClaim, "id" | "lines" | "lineStatus" | "dentists" | "status" | "approvalDate"> & { lineDates?: InsuranceClaim["lineDates"] },
  appt: LinkedAppointmentLite,
): LineSyncPatch | null {
  if (claim.status === "cancelled") return null;
  if (!VISIT_DONE_STATUSES.has(String(appt.status ?? ""))) return null;
  // Only this approval's services: a visit can be booked against more than one approval.
  const lines = parseClaimLinks(appt)
    .filter((l) => l.claimId === claim.id && l.claimLine < claim.lines.length)
    .map((l) => l.claimLine);
  if (lines.length === 0) return null;
  const doctorId = typeof appt.doctorId === "string" ? appt.doctorId.trim() : "";
  const visitDate = typeof appt.date === "string" && ISO_DATE.test(appt.date) ? appt.date : "";
  const canDate = Boolean(visitDate) && visitDate >= claim.approvalDate;
  const lineStatus: Record<number, LineStatus> = {};
  const dentists: Record<number, string | null> = {};
  const lineDates: Record<number, string> = {};
  for (const i of lines) {
    if (lineStatusOf(claim, i) === "Planned") {
      lineStatus[i] = "Completed";
      if (canDate && !claim.lineDates?.[i]) lineDates[i] = visitDate;
    }
    if (doctorId && claim.dentists[i]?.staffId !== doctorId) dentists[i] = doctorId;
  }
  const patch: LineSyncPatch = {};
  if (Object.keys(lineStatus).length) patch.lineStatus = lineStatus;
  if (Object.keys(dentists).length) patch.dentists = dentists;
  if (Object.keys(lineDates).length) patch.lineDates = lineDates;
  return patch.lineStatus || patch.dentists || patch.lineDates ? patch : null;
}
