import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Patients due for a routine check-up.
 *
 * Shares its definition of a "visit" with the dormancy scan deliberately — an attended
 * appointment or a clinical note — so the two features cannot disagree about when someone was
 * last seen.
 *
 * The interval is read from the clinic's own settings and this returns `configured: false` when
 * it is unset rather than falling back to a number. Six months is the usual convention, but it is
 * a clinical policy that varies by practice and patient, and presenting a developer's constant as
 * "you have 40 patients overdue" would be inventing the entire claim.
 */

export interface RecallDuePatient {
  patientId: string;
  patientName: string;
  phone: string;
  lastVisitDate: string;
  daysSinceLastVisit: number;
  /** How far past the recall interval they are. */
  daysOverdue: number;
  evidence: { collection: string; docId: string }[];
}

export interface RecallReport {
  scannedAt: string;
  clinicId: string;
  configured: boolean;
  intervalMonths: number | null;
  patients: RecallDuePatient[];
  counts: { due: number; skippedUpcoming: number; skippedNeverVisited: number };
  truncated: boolean;
  notes: string[];
}

const SCAN_LIMIT = 4000;
const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

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

export async function scanRecallDue(clinicId: string): Promise<RecallReport> {
  const base: Omit<RecallReport, "patients" | "counts" | "truncated" | "notes"> = {
    scannedAt: new Date().toISOString(),
    clinicId,
    configured: false,
    intervalMonths: null,
  };

  const settingsSnap = await adminClinicDoc(clinicId, "settings", "recall").get();
  const intervalMonths = Number(settingsSnap.exists ? settingsSnap.data()?.intervalMonths : NaN);

  if (!Number.isFinite(intervalMonths) || intervalMonths <= 0) {
    return {
      ...base,
      patients: [],
      counts: { due: 0, skippedUpcoming: 0, skippedNeverVisited: 0 },
      truncated: false,
      notes: [
        "No recall interval is set for this clinic, so nothing can be flagged as due. Set one in " +
          "Settings → Recall.",
      ],
    };
  }

  const thresholdDays = Math.round(intervalMonths * 30);
  const todayKey = ymd(new Date());
  const notes: string[] = [];

  const [patientsSnap, apptSnap, notesSnap] = await Promise.all([
    adminClinicCollection(clinicId, "patients").limit(SCAN_LIMIT).get(),
    adminClinicCollection(clinicId, "appointments").limit(SCAN_LIMIT).get(),
    adminClinicCollection(clinicId, "clinical_notes").limit(SCAN_LIMIT).get(),
  ]);

  const truncated =
    patientsSnap.size >= SCAN_LIMIT || apptSnap.size >= SCAN_LIMIT || notesSnap.size >= SCAN_LIMIT;
  if (truncated) {
    notes.push(`Only the first ${SCAN_LIMIT} records per collection were scanned.`);
  }

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

    // A "Rescheduled" marker sits on a slot the patient is not actually coming to — the real
    // upcoming visit is a separate document that will set this on its own.
    if (dateStr >= todayKey && status !== "Cancelled" && status !== "No Show" && status !== "Rescheduled") {
      hasUpcoming.add(patientId);
    }
    if (ATTENDED.has(status)) remember(patientId, parseDate(d.date), "appointments", doc.id);
  });

  notesSnap.forEach((doc) => {
    const d = doc.data() || {};
    remember(typeof d.patientId === "string" ? d.patientId : "", parseDate(d.date), "clinical_notes", doc.id);
  });

  const patients: RecallDuePatient[] = [];
  let skippedUpcoming = 0;
  let skippedNeverVisited = 0;

  patientsSnap.forEach((doc) => {
    const p = (doc.data() || {}) as Record<string, unknown>;
    const patientId = doc.id;

    if (hasUpcoming.has(patientId)) {
      skippedUpcoming++;
      return;
    }

    const visit = lastVisit.get(patientId);
    if (!visit) {
      // A recall is a *return* visit. Someone never treated here has nothing to be recalled to,
      // and belongs on the reactivation list instead.
      skippedNeverVisited++;
      return;
    }

    const days = Math.max(0, Math.round((Date.now() - visit.date.getTime()) / 86400000));
    if (days < thresholdDays) return;

    patients.push({
      patientId,
      patientName: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Unnamed patient",
      phone: pickPhone(p),
      lastVisitDate: ymd(visit.date),
      daysSinceLastVisit: days,
      daysOverdue: days - thresholdDays,
      evidence: [{ collection: visit.collection, docId: visit.docId }],
    });
  });

  patients.sort((a, b) => b.daysOverdue - a.daysOverdue);

  notes.push(
    `Based on this clinic's recall interval of ${intervalMonths} months. A visit means an ` +
      "attended appointment or a clinical note; cancelled and no-show appointments do not count."
  );

  return {
    ...base,
    configured: true,
    intervalMonths,
    patients,
    counts: { due: patients.length, skippedUpcoming, skippedNeverVisited },
    truncated,
    notes,
  };
}
