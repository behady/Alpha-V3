import { adminClinicCollection } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Dormant patient detection — who has not been seen in a long time.
 *
 * Deterministic for the same reason as the revenue engine: this drives outbound messages to real
 * people, so every name on the list has to be defensible from a query result rather than produced
 * by a model's judgement about who "seems" overdue.
 *
 * The definition of a visit is the whole difficulty here, and it is stated rather than assumed.
 * There is no `lastVisit` field on a patient in this app, so it has to be derived. Deriving it
 * from appointment dates alone counts appointments that were BOOKED, not attended — a patient who
 * cancelled or no-showed three times would look recently seen and get wrongly left off. So an
 * appointment only counts once it reached a stage that means the patient was physically present,
 * and a clinical note counts on its own because a note is only written when work was documented.
 */

export type DormancyReason = "dormant" | "never_visited";

export interface DormantPatient {
  patientId: string;
  patientName: string;
  phone: string;
  reason: DormancyReason;
  /** Null when the patient has no attended visit on record at all. */
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  /** Where the last-visit date came from, so a human can check it. */
  evidence: { collection: string; docId: string }[];
  /** A future booking means they are already coming back and should not be chased. */
  hasUpcomingAppointment: boolean;
}

export interface DormancyReport {
  scannedAt: string;
  clinicId: string;
  thresholdDays: number;
  counts: { dormant: number; neverVisited: number; skippedUpcoming: number };
  patients: DormantPatient[];
  truncated: boolean;
  notes: string[];
}

const SCAN_LIMIT = 4000;

/**
 * Stages that mean the patient actually turned up. "Scheduled"/"Confirmed" are bookings that may
 * never have happened, and "Cancelled"/"No Show" explicitly did not.
 */
const ATTENDED_STATUSES = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

function pickPhone(p: Record<string, unknown>): string {
  for (const key of ["phone", "phoneNumber", "phoneE164", "mobile", "whatsapp", "primaryPhone"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * @param thresholdDays How long without an attended visit counts as dormant. Passed in rather than
 *   hardcoded — "6 months" is a clinic policy decision, not something this file should invent.
 */
export async function scanDormantPatients(
  clinicId: string,
  thresholdDays: number
): Promise<DormancyReport> {
  const notes: string[] = [];
  const todayKey = ymd(new Date());

  const [patientsSnap, apptSnap, notesSnap] = await Promise.all([
    adminClinicCollection(clinicId, "patients").limit(SCAN_LIMIT).get(),
    adminClinicCollection(clinicId, "appointments").limit(SCAN_LIMIT).get(),
    adminClinicCollection(clinicId, "clinical_notes").limit(SCAN_LIMIT).get(),
  ]);

  const truncated =
    patientsSnap.size >= SCAN_LIMIT || apptSnap.size >= SCAN_LIMIT || notesSnap.size >= SCAN_LIMIT;
  if (truncated) {
    notes.push(
      `Only the first ${SCAN_LIMIT} records per collection were scanned, so this list may be incomplete.`
    );
  }

  /** patientId -> most recent attended visit, with the record it came from. */
  const lastVisit = new Map<string, { date: Date; collection: string; docId: string }>();
  const hasUpcoming = new Set<string>();

  const remember = (patientId: string, date: Date | null, collection: string, docId: string) => {
    if (!patientId || !date) return;
    const current = lastVisit.get(patientId);
    if (!current || date.getTime() > current.date.getTime()) {
      lastVisit.set(patientId, { date, collection, docId });
    }
  };

  apptSnap.forEach((doc) => {
    const d = doc.data() || {};
    const patientId = typeof d.patientId === "string" ? d.patientId : "";
    if (!patientId) return;

    const status = normalizeAppointmentStatus(typeof d.status === "string" ? d.status : "");
    const dateStr = typeof d.date === "string" ? d.date : "";

    // Anything booked from today onward means they are already returning. A "Rescheduled" marker
    // is excluded alongside Cancelled/No Show — it sits on a slot the patient is not actually
    // coming to, and the real upcoming visit is a separate document that will set this on its own.
    if (dateStr >= todayKey && status !== "Cancelled" && status !== "No Show" && status !== "Rescheduled") {
      hasUpcoming.add(patientId);
    }

    if (ATTENDED_STATUSES.has(status)) {
      remember(patientId, parseDate(d.date), "appointments", doc.id);
    }
  });

  notesSnap.forEach((doc) => {
    const d = doc.data() || {};
    const patientId = typeof d.patientId === "string" ? d.patientId : "";
    remember(patientId, parseDate(d.date), "clinical_notes", doc.id);
  });

  const out: DormantPatient[] = [];
  let skippedUpcoming = 0;

  patientsSnap.forEach((doc) => {
    const p = (doc.data() || {}) as Record<string, unknown>;
    const patientId = doc.id;

    if (hasUpcoming.has(patientId)) {
      skippedUpcoming++;
      return;
    }

    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Unnamed patient";
    const phone = pickPhone(p);
    const visit = lastVisit.get(patientId);

    if (!visit) {
      // Registered but never seen. Reported separately because "we have never treated you" is a
      // different conversation from "it has been a while", and because a patient created moments
      // ago would otherwise appear as infinitely overdue.
      out.push({
        patientId,
        patientName: name,
        phone,
        reason: "never_visited",
        lastVisitDate: null,
        daysSinceLastVisit: null,
        evidence: [{ collection: "patients", docId: patientId }],
        hasUpcomingAppointment: false,
      });
      return;
    }

    const days = Math.max(0, Math.round((Date.now() - visit.date.getTime()) / 86400000));
    if (days < thresholdDays) return;

    out.push({
      patientId,
      patientName: name,
      phone,
      reason: "dormant",
      lastVisitDate: ymd(visit.date),
      daysSinceLastVisit: days,
      evidence: [{ collection: visit.collection, docId: visit.docId }],
      hasUpcomingAppointment: false,
    });
  });

  // Longest-absent first; never-visited last, since they have no elapsed time to rank on.
  out.sort((a, b) => (b.daysSinceLastVisit ?? -1) - (a.daysSinceLastVisit ?? -1));

  const withoutPhone = out.filter((p) => !p.phone).length;
  if (withoutPhone > 0) {
    notes.push(`${withoutPhone} of these patients have no phone number on file and cannot be messaged.`);
  }
  notes.push(
    "A visit means an appointment the patient attended, or a clinical note. Cancelled and no-show " +
      "appointments do not count as visits."
  );

  return {
    scannedAt: new Date().toISOString(),
    clinicId,
    thresholdDays,
    counts: {
      dormant: out.filter((p) => p.reason === "dormant").length,
      neverVisited: out.filter((p) => p.reason === "never_visited").length,
      skippedUpcoming,
    },
    patients: out,
    truncated,
    notes,
  };
}
