import { adminClinicCollection } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Past appointments nobody ever closed out.
 *
 * This exists to fix the root cause behind no-show prediction being impossible. "No Show" is a
 * real status, but it is only ever set by hand from a dropdown and no workflow in the app leads
 * anyone to it — so the field has stayed empty and there is nothing to learn from. An appointment
 * whose date has passed while still sitting on "Scheduled" is an unanswered question: did they
 * come or not? Surfacing those and asking is the only way the answer ever gets recorded.
 *
 * Deliberately not automated. A sweep could mark everything old as a no-show, but that would
 * invent history — the far likelier truth is that the patient attended and nobody updated the
 * screen. Guessing here would poison the very data the prediction later depends on.
 */

export interface UnresolvedAppointment {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  time: string;
  doctor: string;
  treatment: string;
  status: string;
  daysAgo: number;
}

export interface UnresolvedReport {
  scannedAt: string;
  clinicId: string;
  appointments: UnresolvedAppointment[];
  count: number;
  notes: string[];
}

const SCAN_LIMIT = 4000;

/** Statuses that mean the visit was never closed out either way. */
const UNRESOLVED = new Set(["Scheduled", "Confirmed", "Delayed"]);

/**
 * Today is excluded — an appointment later this afternoon is not unresolved yet. A short grace
 * period after that avoids nagging the front desk about this morning's list before the day ends.
 */
const GRACE_DAYS = 1;

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function scanUnresolvedAppointments(clinicId: string): Promise<UnresolvedReport> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRACE_DAYS);
  const cutoffKey = ymd(cutoff);

  const snap = await adminClinicCollection(clinicId, "appointments")
    .where("date", "<", cutoffKey)
    .limit(SCAN_LIMIT)
    .get();

  const appointments: UnresolvedAppointment[] = [];

  snap.forEach((doc) => {
    const d = doc.data() || {};
    const status = normalizeAppointmentStatus(typeof d.status === "string" ? d.status : "");
    if (!UNRESOLVED.has(status)) return;

    const dateStr = typeof d.date === "string" ? d.date : "";
    const parsed = dateStr ? new Date(dateStr) : null;
    const daysAgo =
      parsed && !Number.isNaN(parsed.getTime())
        ? Math.max(0, Math.round((Date.now() - parsed.getTime()) / 86400000))
        : 0;

    appointments.push({
      id: doc.id,
      patientId: typeof d.patientId === "string" ? d.patientId : "",
      patientName: typeof d.patientName === "string" ? d.patientName : "Unnamed patient",
      date: dateStr,
      time: typeof d.time === "string" ? d.time : "",
      doctor: typeof d.doctor === "string" ? d.doctor : "",
      treatment: typeof d.treatment === "string" ? d.treatment : "",
      status,
      daysAgo,
    });
  });

  // Most recent first: those are the ones someone might still remember.
  appointments.sort((a, b) => a.daysAgo - b.daysAgo);

  const notes: string[] = [];
  if (appointments.length > 0) {
    notes.push(
      "These appointments are in the past but were never marked as attended or missed. Closing " +
        "them out is what makes attendance reporting possible — there is nothing to learn from " +
        "an appointment nobody answered for."
    );
  }

  return {
    scannedAt: new Date().toISOString(),
    clinicId,
    appointments,
    count: appointments.length,
    notes,
  };
}
