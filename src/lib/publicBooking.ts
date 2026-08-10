/**
 * Server-side logic for the public booking page.
 *
 * The page used to read Firestore straight from the patient's browser. That could never have
 * worked: the security rules require clinic membership for everything under clinics/{clinicId},
 * and a patient visiting a booking link is not signed in at all. Every read was denied, so the
 * page showed "problem loading clinic data" to every real visitor. It only ever appeared to work
 * when opened by someone already signed in to that clinic — which is exactly how it would have
 * been tested.
 *
 * Everything the page needs now comes through API routes on the Admin SDK, which lets the rules
 * stay locked shut while still answering the two questions a patient legitimately needs: when is
 * this clinic open, and which of those times are free. Nothing here returns a patient's own
 * records — see the note in the booking page about why that feature was removed rather than
 * ported.
 */

import { adminDb } from "@/lib/firebaseAdmin";
import { clinicDayBoundsMinutes, parseClinicSchedule, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { minutesToTimeKey, normalizeDateKey, parseApptTimeToMinutes } from "@/lib/appointmentTime";

/** Statuses that do NOT hold a slot. A cancelled 3pm must not block 3pm forever. */
const RELEASED_STATUSES = new Set(["Cancelled", "No Show"]);

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type PublicClinicProfile = {
  clinicName: string;
  enableDoctorSelection: boolean;
  defaultDurationMinutes: number;
  reasons: string[];
  doctors: string[];
  schedule: ClinicScheduleConfig;
};

export class PublicBookingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function clinicRef(clinicId: string) {
  return adminDb().collection("clinics").doc(clinicId);
}

/**
 * Loads only what a stranger may see: the clinic's name, its opening hours, the reasons it offers
 * and the first names of its dentists. Never staff emails, never patient data, never settings.
 *
 * Throws if online booking is switched off, so a disabled clinic's hours are not readable either.
 */
export async function loadPublicClinicProfile(clinicId: string): Promise<PublicClinicProfile> {
  const ref = clinicRef(clinicId);

  const bookingSnap = await ref.collection("settings").doc("onlineBooking").get();
  if (!bookingSnap.exists || bookingSnap.data()?.enabled !== true) {
    throw new PublicBookingError("Online booking is not enabled for this clinic.", 404);
  }
  const booking = bookingSnap.data() || {};

  const infoSnap = await ref.collection("settings").doc("clinic_info").get();
  const info = infoSnap.exists ? infoSnap.data() || {} : {};
  const schedule = parseClinicSchedule(info);

  const reasonsSnap = await ref.collection("settings").doc("visit_reasons").get();
  const rawReasons = reasonsSnap.exists ? reasonsSnap.data()?.reasons : null;
  const reasons =
    Array.isArray(rawReasons) && rawReasons.length
      ? rawReasons.map((r: unknown) => String(r)).filter(Boolean)
      : ["كشف", "استشارة", "متابعة", "طوارئ"];

  let doctors: string[] = [];
  if (booking.enableDoctorSelection === true) {
    // Dentists live in `staff`, not `users` — the page previously queried a `users` subcollection
    // that this app never writes to, so the dentist list came back empty every time.
    const staffSnap = await ref.collection("staff").get();
    doctors = staffSnap.docs
      .map((d) => d.data())
      .filter((s) => s?.role === "Dentist" || (s?.role === "Admin" && s?.isDentist === true))
      .map((s) => String(s?.name || "").trim())
      .filter(Boolean);
  }

  let defaultDurationMinutes = parseInt(String(booking.defaultDurationMinutes ?? schedule.slotDuration), 10);
  if (!Number.isFinite(defaultDurationMinutes) || defaultDurationMinutes <= 0) {
    defaultDurationMinutes = schedule.slotDuration;
  }

  return {
    clinicName: String(info.name || "").trim() || "عيادة أسنان",
    enableDoctorSelection: booking.enableDoctorSelection === true,
    defaultDurationMinutes,
    reasons,
    doctors,
    schedule,
  };
}

/** Is this YYYY-MM-DD one of the clinic's days off? */
export function isClinicClosedOn(dateKey: string, schedule: ClinicScheduleConfig): boolean {
  const parsed = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return true;
  return schedule.offDays.includes(DAY_NAMES[parsed.getDay()]);
}

/**
 * Free start times for one date, as canonical `hh:mm AM/PM` strings.
 *
 * Three things the browser-side version got wrong, all of which showed the patient the wrong
 * availability:
 *   - it compared its own "14:00" strings against times stored as "02:00 PM", so nothing ever
 *     matched and every slot looked free;
 *   - it treated cancelled appointments as still occupying their slot;
 *   - it blocked a time for every dentist as soon as one of them was booked.
 * Overlap is now decided in minutes, against appointments for the relevant dentist only, and
 * takes each existing appointment's own duration into account.
 */
export async function computeAvailableSlots(args: {
  clinicId: string;
  dateKey: string;
  doctorName?: string | null;
  profile: PublicClinicProfile;
}): Promise<string[]> {
  const { clinicId, dateKey, doctorName, profile } = args;
  const schedule = profile.schedule;

  if (isClinicClosedOn(dateKey, schedule)) return [];

  const snap = await clinicRef(clinicId).collection("appointments").where("date", "==", dateKey).get();

  const wanted = String(doctorName || "").trim().toLowerCase();
  const busy: Array<{ start: number; end: number }> = [];

  for (const doc of snap.docs) {
    const a = doc.data() || {};
    if (RELEASED_STATUSES.has(normalizeAppointmentStatus(String(a.status || "")))) continue;

    // With no dentist chosen, any booking blocks the slot — one chair is the assumption for the
    // clinics this is built for. With a dentist chosen, only that dentist's own bookings matter.
    if (wanted) {
      const apptDoctor = String(a.doctor || "").trim().toLowerCase();
      if (apptDoctor && apptDoctor !== wanted) continue;
    }

    const start = parseApptTimeToMinutes(String(a.time || ""));
    const dur = Number(a.duration) > 0 ? Number(a.duration) : profile.defaultDurationMinutes;
    busy.push({ start, end: start + dur });
  }

  const { start: dayStart, end: dayEnd } = clinicDayBoundsMinutes(schedule);
  const step = schedule.slotDuration;
  const need = profile.defaultDurationMinutes;

  // A slot that starts today but has not started yet. Offering 10:00 at 11:30 wastes everyone's
  // time and makes the clinic look disorganised.
  const now = new Date();
  const todayKey = normalizeDateKey(now.toISOString().split("T")[0]);
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  const free: string[] = [];
  for (let m = dayStart; m + need <= dayEnd; m += step) {
    if (dateKey === todayKey && m <= minutesNow) continue;
    const overlaps = busy.some((b) => m < b.end && m + need > b.start);
    if (!overlaps) free.push(minutesToTimeKey(m));
  }
  return free;
}

/**
 * Egyptian mobile numbers, in the international form the rest of the system stores.
 *
 * Returns null rather than guessing. A junk number creates a patient record nobody can contact
 * and a reminder that will never arrive.
 */
export function normalizeEgyptianMobile(raw: string): string | null {
  const digits = String(raw || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
  if (!digits) return null;

  let local = digits;
  if (local.startsWith("0020")) local = local.slice(4);
  else if (local.startsWith("20") && local.length >= 12) local = local.slice(2);
  if (local.startsWith("0")) local = local.slice(1);

  // Egyptian mobiles are 10 digits after the country code and start 10/11/12/15.
  if (!/^1[0125]\d{8}$/.test(local)) return null;
  return `+20${local}`;
}
