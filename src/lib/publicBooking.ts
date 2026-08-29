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
import { FieldValue } from "firebase-admin/firestore";
import { parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
import { clinicDayBoundsMinutes, parseClinicSchedule, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { apptBlocksDoctor } from "@/lib/appointmentConflicts";
import { minutesToTimeKey, normalizeDateKey, parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { isFullAccessRole } from "@/lib/permissions";

/** Statuses that do NOT hold a slot. A cancelled 3pm must not block 3pm forever. */
const RELEASED_STATUSES = new Set(["Cancelled", "No Show"]);

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type PublicClinicProfile = {
  clinicName: string;
  enableDoctorSelection: boolean;
  defaultDurationMinutes: number;
  reasons: string[];
  doctors: string[];
  /** Lower-cased dentist name → staff id, so availability can match on the stable key. */
  doctorIdsByName: Record<string, string>;
  schedule: ClinicScheduleConfig;
  /** Configured branches. Empty for single-location clinics — the page then never mentions branches. */
  branches: ClinicBranch[];
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
export async function loadPublicClinicProfile(
  clinicId: string,
  opts?: {
    /**
     * The public page requires the clinic to have switched online booking on — a disabled
     * clinic's hours must not be readable by strangers. The WhatsApp assistant passes false:
     * it has its own opt-in (botEnabled), it only talks to people who wrote to the clinic
     * first, and tying it to the online-booking switch would silently disable the bot for
     * every clinic that never wanted a public booking page.
     */
    requireEnabled?: boolean;
    /**
     * Load the dentist list regardless of the public page's enableDoctorSelection switch. That
     * switch governs what strangers on the WEB form see; the assistant offers doctors whenever
     * the clinic actually has more than one, because a booking that lands in "Unassigned" is a
     * booking somebody at the desk has to re-file.
     */
    loadDoctors?: boolean;
  }
): Promise<PublicClinicProfile> {
  const ref = clinicRef(clinicId);

  const bookingSnap = await ref.collection("settings").doc("onlineBooking").get();
  if (opts?.requireEnabled !== false && (!bookingSnap.exists || bookingSnap.data()?.enabled !== true)) {
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

  const doctors: string[] = [];
  const doctorIdsByName: Record<string, string> = {};
  if (booking.enableDoctorSelection === true || opts?.loadDoctors === true) {
    // Dentists live in `staff`, not `users` — the page previously queried a `users` subcollection
    // that this app never writes to, so the dentist list came back empty every time.
    const staffSnap = await ref.collection("staff").get();
    for (const doc of staffSnap.docs) {
      const s = doc.data();
      if (!(s?.role === "Dentist" || (isFullAccessRole(s?.role) && s?.isDentist === true))) continue;
      const name = String(s?.name || "").trim();
      if (!name) continue;
      doctors.push(name);
      // Availability is decided against the stable staff id, not this display name — a renamed
      // dentist's existing appointments still carry the old string. The patient picks a name, so
      // the id has to be resolved here, where the staff records are already in hand.
      doctorIdsByName[name.toLowerCase()] = doc.id;
    }
  }

  let defaultDurationMinutes = parseInt(String(booking.defaultDurationMinutes ?? schedule.slotDuration), 10);
  if (!Number.isFinite(defaultDurationMinutes) || defaultDurationMinutes <= 0) {
    defaultDurationMinutes = schedule.slotDuration;
  }

  const locationsSnap = await ref.collection("settings").doc("locations").get();
  const branches = parseClinicBranches(locationsSnap.exists ? locationsSnap.data() : null);

  return {
    clinicName: String(info.name || "").trim() || "عيادة أسنان",
    enableDoctorSelection: booking.enableDoctorSelection === true,
    defaultDurationMinutes,
    reasons,
    doctors,
    doctorIdsByName,
    schedule,
    branches,
  };
}

/**
 * The clinic's wall clock, not the server's.
 *
 * Vercel runs on UTC; Cairo is two-to-three hours ahead. Deciding "has this slot already passed"
 * against server time offered afternoon slots that were nearly an hour gone — and one was
 * genuinely booked through the WhatsApp assistant before this existed. Every "now" in
 * availability goes through here. Hardcoding Africa/Cairo is a product decision, not laziness:
 * this system sells to Egyptian clinics, and a per-clinic timezone field can replace the constant
 * the day that stops being true.
 */
export function clinicNow(): { dateKey: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value || "00";
  // en-GB keeps hour "24" out (uses 00); guard anyway.
  const hour = Number(get("hour")) % 24;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
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
  branchId?: string | null;
  profile: PublicClinicProfile;
}): Promise<string[]> {
  const { clinicId, dateKey, doctorName, branchId, profile } = args;
  const schedule = profile.schedule;

  if (isClinicClosedOn(dateKey, schedule)) return [];

  const snap = await clinicRef(clinicId).collection("appointments").where("date", "==", dateKey).get();

  const wanted = String(doctorName || "").trim().toLowerCase();
  const wantedDoctorId = wanted ? profile.doctorIdsByName[wanted] || null : null;
  const wantedBranch = String(branchId || "").trim();
  const busy: Array<{ start: number; end: number }> = [];

  for (const doc of snap.docs) {
    const a = doc.data() || {};
    if (RELEASED_STATUSES.has(normalizeAppointmentStatus(String(a.status || "")))) continue;

    // Branch chosen: another branch's bookings don't block this one. Appointments recorded
    // before branches existed carry no branchId and block everywhere — the safe direction.
    if (wantedBranch) {
      const apptBranch = String(a.branchId || "").trim();
      if (apptBranch && apptBranch !== wantedBranch) continue;
    }

    // With no dentist chosen, any booking blocks the slot — one chair is the assumption for the
    // clinics this is built for. With a dentist chosen, only that dentist's own bookings matter.
    //
    // Matched through appointmentConflicts so this agrees with the clinic-side checks, and so a
    // renamed dentist's existing appointments — which still carry the old display string — are
    // found by their stable id rather than silently offered to another patient.
    if (wanted || wantedDoctorId) {
      if (!apptBlocksDoctor({ doctor: a.doctor, doctorId: a.doctorId }, wantedDoctorId, doctorName)) {
        continue;
      }
    }

    const start = parseApptTimeToMinutes(String(a.time || ""));
    const dur = Number(a.duration) > 0 ? Number(a.duration) : profile.defaultDurationMinutes;
    busy.push({ start, end: start + dur });
  }

  const { start: dayStart, end: dayEnd } = clinicDayBoundsMinutes(schedule);
  const step = schedule.slotDuration;
  const need = profile.defaultDurationMinutes;

  // A slot that starts today but has not started yet — on the CLINIC's clock. Offering 10:00 at
  // 11:30 wastes everyone's time and makes the clinic look disorganised.
  const { dateKey: todayKey, minutes: minutesNow } = clinicNow();

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

export type PatientBookingResult =
  | { ok: true; dateKey: string; time: string }
  /** The slot went to someone else between listing and choosing. Normal, not an error. */
  | { ok: false; reason: "slot_taken" }
  /** The patient already holds several open bookings; a person should untangle it. */
  | { ok: false; reason: "too_many_open" };

/** Upcoming open bookings one patient may hold — same guard the public page applies per phone. */
const MAX_OPEN_PER_PATIENT = 3;

/**
 * Book one slot for a KNOWN patient.
 *
 * The assistant's version of what the public /book route does for strangers, sharing the parts
 * that keep the calendar honest: the slot is recomputed here rather than trusted from the
 * conversation (the patient chose from a list that may be minutes old), and the appointment is
 * written in exactly the shape every clinic screen already reads — status "Scheduled", which
 * renders as Unconfirmed, because a request the clinic has not looked at yet is a request,
 * not a confirmed visit.
 */
export async function createPatientBooking(args: {
  clinicId: string;
  profile: PublicClinicProfile;
  patientId: string;
  patientName: string;
  phone: string;
  dateKey: string;
  time: string;
  /** Where this came from — "whatsapp_bot" — kept distinct from "online" for the reports. */
  source: string;
  /**
   * Write the booking as Confirmed instead of the Unconfirmed default. A clinic choice, not a
   * code one: some clinics want every bot request reviewed by the desk, others want the calendar
   * to just fill. The slot recomputation above makes either safe against double-booking.
   */
  autoConfirm?: boolean;
  /** Dentist display name, or empty for "any chair". */
  doctorName?: string;
}): Promise<PatientBookingResult> {
  const { clinicId, profile, patientId, patientName, phone, dateKey, time, source, autoConfirm } = args;
  const doctorName = String(args.doctorName || "").trim();
  const appointmentsRef = clinicRef(clinicId).collection("appointments");

  const today = clinicNow().dateKey;
  // A tap on a stale list can name yesterday. computeAvailableSlots below would refuse it anyway
  // for today (past times drop out), but a whole past DATE returns that day's free grid — so the
  // date is checked here, where the intent to write exists.
  if (dateKey < today) return { ok: false, reason: "slot_taken" };
  const openSnap = await appointmentsRef.where("patientId", "==", patientId).get();
  const open = openSnap.docs.filter((d) => {
    const a = d.data() || {};
    if (String(a.date || "") < today) return false;
    const status = normalizeAppointmentStatus(String(a.status || ""));
    return status !== "Cancelled" && status !== "No Show";
  }).length;
  if (open >= MAX_OPEN_PER_PATIENT) return { ok: false, reason: "too_many_open" };

  // Recomputed at the moment of writing, against the chosen dentist's own calendar. The list the
  // patient chose from is already stale.
  const branchId = profile.branches.length === 1 ? profile.branches[0].id : null;
  const free = await computeAvailableSlots({ clinicId, dateKey, doctorName: doctorName || null, branchId, profile });
  if (!free.includes(time)) return { ok: false, reason: "slot_taken" };

  const branch = branchId ? profile.branches[0] : null;
  await appointmentsRef.add({
    patientId,
    patientName,
    patientPhone: phone,
    date: dateKey,
    time,
    duration: profile.defaultDurationMinutes,
    branchId: branch?.id || null,
    branchName: branch?.name || null,
    doctor: doctorName || "Any",
    // The stable id too, when the name resolves to one: conflict checks match renamed dentists
    // by id, and a booking that only carries a display string ages badly.
    doctorId: doctorName ? profile.doctorIdsByName[doctorName.toLowerCase()] || null : null,
    treatment: "Consultation",
    status: autoConfirm ? "Confirmed" : "Scheduled",
    source,
    notes: "WhatsApp assistant booking",
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, dateKey, time };
}
