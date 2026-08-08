import { adminClinicCollection } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Attendance history per patient, and a risk band derived from it.
 *
 * The whole difficulty is that an absent label and a good record look identical to a query. A
 * patient with no missed appointments on file might be perfectly reliable, or might simply have
 * never had an appointment closed out — and reporting the second as "0% risk" is a confident
 * all-clear built on nothing. So a patient is only scored once enough of their history has
 * actually been resolved; below that they come back as `insufficient_data`, which the UI shows as
 * its own state rather than as a low score.
 *
 * The clinic-wide summary carries the same caveat: `resolvedRate` says how much of the past has
 * been closed out at all, so a reader can tell "we have very few no-shows" from "we have barely
 * recorded any outcomes".
 */

export type RiskBand = "insufficient_data" | "low" | "elevated" | "high";

export interface PatientAttendance {
  patientId: string;
  patientName: string;
  attended: number;
  missed: number;
  /** Past appointments never closed out either way — excluded from the rate, counted here. */
  unresolved: number;
  /** missed / (attended + missed), or null when there is not enough resolved history. */
  missRate: number | null;
  band: RiskBand;
}

export interface NoShowReport {
  scannedAt: string;
  clinicId: string;
  patients: PatientAttendance[];
  summary: {
    totalPastAppointments: number;
    resolved: number;
    unresolved: number;
    /** Share of past appointments that were closed out. Low means the data is not usable yet. */
    resolvedRate: number;
    totalMissed: number;
    patientsScored: number;
    patientsUnscored: number;
  };
  notes: string[];
}

const SCAN_LIMIT = 4000;

/**
 * Minimum resolved appointments before a patient gets a rate at all.
 *
 * One missed appointment out of one is not a 100% no-show risk, it is a single data point. Three
 * is still a small sample, but it is the point where a pattern is at least arguable — and the
 * band names below stay deliberately vague rather than implying precision the data cannot carry.
 */
const MIN_RESOLVED_FOR_SCORE = 3;

const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);
const UNRESOLVED = new Set(["Scheduled", "Confirmed", "Delayed"]);

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

function bandFor(missRate: number): RiskBand {
  if (missRate >= 0.4) return "high";
  if (missRate >= 0.2) return "elevated";
  return "low";
}

export async function scanNoShowRisk(clinicId: string): Promise<NoShowReport> {
  const todayKey = ymd(new Date());

  const [apptSnap, patientsSnap] = await Promise.all([
    adminClinicCollection(clinicId, "appointments").limit(SCAN_LIMIT).get(),
    adminClinicCollection(clinicId, "patients").limit(SCAN_LIMIT).get(),
  ]);

  const names = new Map<string, string>();
  patientsSnap.forEach((doc) => {
    const n = (doc.data() || {}).name;
    if (typeof n === "string" && n.trim()) names.set(doc.id, n.trim());
  });

  const stats = new Map<string, { attended: number; missed: number; unresolved: number }>();
  let totalPast = 0;
  let totalUnresolved = 0;
  let totalMissed = 0;

  apptSnap.forEach((doc) => {
    const d = doc.data() || {};
    const patientId = typeof d.patientId === "string" ? d.patientId : "";
    if (!patientId) return;

    const dateStr = typeof d.date === "string" ? d.date : "";
    // Only the past can tell you whether someone turned up.
    if (!dateStr || dateStr >= todayKey) return;

    const status = normalizeAppointmentStatus(typeof d.status === "string" ? d.status : "");
    // A cancellation is a patient who told you in advance. Counting it as a no-show would
    // penalise exactly the behaviour a clinic wants to encourage.
    if (status === "Cancelled") return;

    totalPast++;
    const row = stats.get(patientId) || { attended: 0, missed: 0, unresolved: 0 };

    if (status === "No Show") {
      row.missed++;
      totalMissed++;
    } else if (ATTENDED.has(status)) {
      row.attended++;
    } else if (UNRESOLVED.has(status)) {
      row.unresolved++;
      totalUnresolved++;
    }

    stats.set(patientId, row);
  });

  const patients: PatientAttendance[] = [];
  for (const [patientId, row] of stats) {
    const resolved = row.attended + row.missed;
    const scored = resolved >= MIN_RESOLVED_FOR_SCORE;
    const missRate = scored ? row.missed / resolved : null;

    patients.push({
      patientId,
      patientName: names.get(patientId) || "Unnamed patient",
      attended: row.attended,
      missed: row.missed,
      unresolved: row.unresolved,
      missRate,
      band: missRate === null ? "insufficient_data" : bandFor(missRate),
    });
  }

  // Riskiest first; unscored patients last, since they carry no signal.
  patients.sort((a, b) => (b.missRate ?? -1) - (a.missRate ?? -1));

  const resolved = totalPast - totalUnresolved;
  const resolvedRate = totalPast > 0 ? resolved / totalPast : 0;

  const notes: string[] = [];
  if (totalPast === 0) {
    notes.push("There are no past appointments to look at yet.");
  } else if (resolvedRate < 0.5) {
    notes.push(
      `Only ${Math.round(resolvedRate * 100)}% of past appointments were ever marked as attended ` +
        "or missed, so attendance figures are not meaningful yet. Closing out the unresolved ones " +
        "is what makes this useful."
    );
  }
  if (totalMissed === 0 && totalPast > 0) {
    notes.push(
      "No appointment has ever been marked as a no-show. That may be genuine, or it may mean " +
        "nobody records them — this cannot tell the difference, so treat a clean sheet with care."
    );
  }
  notes.push(
    `A patient needs at least ${MIN_RESOLVED_FOR_SCORE} closed-out appointments before a rate is ` +
      "shown. Cancellations are not counted as missed."
  );

  return {
    scannedAt: new Date().toISOString(),
    clinicId,
    patients,
    summary: {
      totalPastAppointments: totalPast,
      resolved,
      unresolved: totalUnresolved,
      resolvedRate,
      totalMissed,
      patientsScored: patients.filter((p) => p.missRate !== null).length,
      patientsUnscored: patients.filter((p) => p.missRate === null).length,
    },
    notes,
  };
}
