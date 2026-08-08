import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { parseClinicSchedule, clinicDayBoundsMinutes } from "@/lib/clinicSchedule";
import { parseApptTimeToMinutes } from "@/lib/bookingService";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Free appointment slots on a given day.
 *
 * Everything this needs is something a clinic has to have configured, and each input can be
 * missing in a way that looks exactly like a real answer:
 *
 *  - Clinic hours fall back to 09:00-21:00 with no days off when nobody has set them, so an
 *    unconfigured clinic looks like one open twelve hours a day, seven days a week.
 *  - A dentist with no schedule on file is not a dentist who is always free.
 *  - A treatment with no duration is not a treatment that takes one standard slot.
 *
 * So the result carries a `basis` block naming exactly which of those were read from real
 * settings and which were assumed. Callers are expected to repeat that rather than presenting a
 * list of times as authoritative — a confidently offered Friday evening slot at a clinic that
 * closes Thursday is worse than no suggestion at all.
 */

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface SuggestedSlot {
  time: string;
  startMinutes: number;
  endMinutes: number;
}

export interface SlotSuggestion {
  date: string;
  dayName: string;
  slots: SuggestedSlot[];
  durationMinutes: number;
  basis: {
    clinicHoursConfigured: boolean;
    clinicOpen: boolean;
    doctorId: string | null;
    doctorName: string | null;
    doctorHoursKnown: boolean;
    durationSource: "service" | "requested" | "clinic_default";
    existingAppointmentsConsidered: number;
  };
  notes: string[];
}

/** Minutes from midnight back to the "hh:mm AM/PM" form the rest of the app stores. */
function toTimeLabel(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/**
 * Day index without timezone drift. `new Date("2026-08-10")` is parsed as UTC midnight, which in
 * a negative-offset zone lands on the previous day — enough to look up the wrong day's hours.
 */
function dayIndexFor(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

function parseHM(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function suggestSlots(args: {
  clinicId: string;
  date: string;
  doctorId?: string | null;
  serviceId?: string | null;
  durationMinutes?: number | null;
}): Promise<SlotSuggestion> {
  const { clinicId, date, doctorId, serviceId, durationMinutes } = args;
  const notes: string[] = [];

  const dayIndex = dayIndexFor(date);
  const dayName = DAY_NAMES[dayIndex];

  const [clinicInfoSnap, apptSnap] = await Promise.all([
    adminClinicDoc(clinicId, "settings", "clinic_info").get(),
    adminClinicCollection(clinicId, "appointments").where("date", "==", date).get(),
  ]);

  const schedule = parseClinicSchedule(clinicInfoSnap.exists ? (clinicInfoSnap.data() as Record<string, unknown>) : null);
  if (!schedule.isConfigured) {
    notes.push(
      "This clinic's opening hours have never been set, so these times assume 09:00-21:00 every " +
        "day. Set them in Settings → Schedule before relying on this."
    );
  }

  const clinicClosed = schedule.offDays.includes(dayName);
  const { start: clinicStart, end: clinicEnd } = clinicDayBoundsMinutes(schedule);

  // Duration, in order of how specific the answer is.
  let duration = 0;
  let durationSource: SlotSuggestion["basis"]["durationSource"] = "clinic_default";

  if (Number(durationMinutes) > 0) {
    duration = Number(durationMinutes);
    durationSource = "requested";
  } else if (serviceId) {
    const svcSnap = await adminClinicDoc(clinicId, "services", serviceId).get();
    const svcDuration = Number(svcSnap.exists ? svcSnap.data()?.durationMinutes : NaN);
    if (Number.isFinite(svcDuration) && svcDuration > 0) {
      duration = svcDuration;
      durationSource = "service";
    }
  }
  if (duration <= 0) {
    duration = schedule.slotDuration;
    notes.push(
      `No duration is recorded for this treatment, so slots are ${schedule.slotDuration} minutes — ` +
        "the clinic's standard length. A longer procedure may not actually fit."
    );
  }

  // Doctor availability. Absent means unknown, never "free all day".
  let doctorName: string | null = null;
  let doctorHoursKnown = false;
  let doctorStart = clinicStart;
  let doctorEnd = clinicEnd;
  let doctorOff = false;

  if (doctorId) {
    const staffSnap = await adminClinicDoc(clinicId, "staff", doctorId).get();
    if (staffSnap.exists) {
      const staff = staffSnap.data() || {};
      doctorName = typeof staff.name === "string" ? staff.name : null;

      const sched = staff.attendanceSchedule as Record<string, unknown> | undefined;
      const day = sched?.[String(dayIndex)] as Record<string, unknown> | undefined;

      if (day) {
        doctorHoursKnown = true;
        if (day.active === false) doctorOff = true;
        const s = parseHM(day.start);
        const e = parseHM(day.end);
        if (s !== null) doctorStart = Math.max(doctorStart, s);
        if (e !== null) doctorEnd = Math.min(doctorEnd, e);
        notes.push(
          "Availability for this dentist comes from their attendance schedule, which is set up for " +
            "payroll. Check it reflects when they actually see patients."
        );
      } else {
        notes.push(
          "No working hours are on file for this dentist, so these are the clinic's hours rather " +
            "than theirs. They may not be in."
        );
      }
    }
  }

  if (clinicClosed || doctorOff) {
    return {
      date,
      dayName,
      slots: [],
      durationMinutes: duration,
      basis: {
        clinicHoursConfigured: schedule.isConfigured,
        clinicOpen: !clinicClosed,
        doctorId: doctorId || null,
        doctorName,
        doctorHoursKnown,
        durationSource,
        existingAppointmentsConsidered: 0,
      },
      notes: [
        clinicClosed
          ? `The clinic is closed on ${dayName}.`
          : `${doctorName || "This dentist"} is not scheduled to work on ${dayName}.`,
        ...notes,
      ],
    };
  }

  // Busy intervals from what is already booked.
  const busy: Array<{ start: number; end: number }> = [];
  let considered = 0;

  apptSnap.forEach((doc) => {
    const d = doc.data() || {};
    const status = normalizeAppointmentStatus(typeof d.status === "string" ? d.status : "");
    // A cancelled or missed appointment is not occupying the chair.
    if (status === "Cancelled" || status === "No Show") return;

    // When asking about one dentist, only their bookings block the slot.
    if (doctorId) {
      const apptDoctorId = typeof d.doctorId === "string" ? d.doctorId : "";
      if (apptDoctorId && apptDoctorId !== doctorId) return;
      // Older appointments have no doctorId at all; those are counted as blocking, since
      // assuming they belong to someone else would hand out a slot that is already taken.
    }

    const start = parseApptTimeToMinutes(typeof d.time === "string" ? d.time : "");
    if (!start) return;
    const len = Number(d.duration) > 0 ? Number(d.duration) : schedule.slotDuration;
    busy.push({ start, end: start + len });
    considered++;
  });

  const windowStart = Math.max(clinicStart, doctorStart);
  const windowEnd = Math.min(clinicEnd, doctorEnd);

  const slots: SuggestedSlot[] = [];
  const step = schedule.slotDuration;

  for (let start = windowStart; start + duration <= windowEnd; start += step) {
    const end = start + duration;
    const overlaps = busy.some((b) => start < b.end && end > b.start);
    if (!overlaps) slots.push({ time: toTimeLabel(start), startMinutes: start, endMinutes: end });
  }

  if (slots.length === 0 && windowEnd > windowStart) {
    notes.push("Every slot that day is already taken.");
  }

  return {
    date,
    dayName,
    slots,
    durationMinutes: duration,
    basis: {
      clinicHoursConfigured: schedule.isConfigured,
      clinicOpen: true,
      doctorId: doctorId || null,
      doctorName,
      doctorHoursKnown,
      durationSource,
      existingAppointmentsConsidered: considered,
    },
    notes,
  };
}
