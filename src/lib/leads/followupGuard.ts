/**
 * Who must not be sent "you asked and have not booked yet".
 *
 * The follow-up used to ask one question: is there an UPCOMING appointment under this phone
 * number? That missed the two people it most needed to catch. Someone who came in yesterday has
 * no upcoming appointment, and a message the morning after her visit telling her she never booked
 * is how a happy patient types "Stop". And an appointment made at the desk carries a patient id
 * but no phone, so it was invisible to a search by phone.
 *
 * Pure: the route collects the person's appointments (by phone AND by patient id) and asks here.
 */
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export type FollowupAppointment = { date?: unknown; status?: unknown };

export type FollowupBlock = "" | "already_booked" | "recent_visit";

/** How far back an appointment still means "this person is already with us". */
export const RECENT_VISIT_DAYS = 30;

/** A YYYY-MM-DD key moved back by whole days, on the calendar rather than on a clock. */
function daysBefore(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * Why this lead is left alone, or "" when the follow-up may go.
 *
 * `already_booked` — an appointment today or later that still stands. The caller marks the lead
 * booked. `recent_visit` — any appointment in the last thirty days, whatever became of it: they
 * attended, or they missed it, and either way "you have not booked" is untrue.
 */
export function followupBlockedBy(appointments: FollowupAppointment[], todayKey: string, recentDays: number = RECENT_VISIT_DAYS): FollowupBlock {
  const since = daysBefore(todayKey, recentDays);
  let recent = false;
  for (const a of appointments) {
    const date = String(a.date || "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    const day = date.slice(0, 10);
    if (day >= todayKey) {
      const status = normalizeAppointmentStatus(String(a.status || ""));
      if (status !== "Cancelled" && status !== "No Show") return "already_booked";
    } else if (day >= since) {
      recent = true;
    }
  }
  return recent ? "recent_visit" : "";
}
