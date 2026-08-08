import { adminClinicCollection } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * The day at a glance, computed from records rather than described by a model.
 *
 * Scope is deliberately narrower than "morning briefing" usually implies. Two sections that would
 * normally belong here are absent because the data cannot support them honestly:
 *
 *  - No-show risk. Nothing in this system has ever been marked "No Show" and no workflow prompts
 *    staff to do it, so a risk score would be computed from zero labels and would report every
 *    patient as perfectly reliable — a confident all-clear that is not evidence of anything.
 *  - Overdue balances. No ledger row carries a due date, so "overdue" cannot be derived. What is
 *    shown instead is balances with no recent activity, labelled as exactly that.
 *
 * Both are worth adding once the underlying data exists. Guessing them now would make the whole
 * briefing untrustworthy, including the parts that are real.
 */

export interface BriefingAppointment {
  id: string;
  time: string;
  patientId: string;
  patientName: string;
  doctor: string;
  treatment: string;
  status: string;
}

export interface StaleBalance {
  patientId: string;
  patientName: string;
  balance: number;
  daysSinceLastActivity: number;
}

export interface DailyBriefing {
  generatedAt: string;
  dateKey: string;
  appointments: BriefingAppointment[];
  counts: { total: number; attended: number; cancelled: number; stillScheduled: number };
  staleBalances: StaleBalance[];
  staleBalanceTotal: number;
  notes: string[];
}

const SCAN_LIMIT = 4000;
const MIN_BALANCE = 1;
/** Matches the revenue engine's threshold so the two features do not disagree about "stale". */
const STALE_DAYS = 45;

const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

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

/** Same per-row resolution the revenue engine documents: payments carry the value on `paid`. */
function rowAmount(row: Record<string, unknown>): number {
  return String(row.type) === "payment"
    ? toNumber(row.paid ?? row.amount)
    : toNumber(row.amount ?? row.cost);
}

function toMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!m) return 0;
  let h = Number(m[1]) % 12;
  if (m[3]?.toUpperCase() === "PM") h += 12;
  return h * 60 + Number(m[2]);
}

export async function buildDailyBriefing(clinicId: string, dateKey: string): Promise<DailyBriefing> {
  const notes: string[] = [];

  const [apptSnap, ledgerSnap, patientsSnap] = await Promise.all([
    adminClinicCollection(clinicId, "appointments").where("date", "==", dateKey).get(),
    adminClinicCollection(clinicId, "ledger").limit(SCAN_LIMIT).get(),
    adminClinicCollection(clinicId, "patients").limit(SCAN_LIMIT).get(),
  ]);

  const appointments: BriefingAppointment[] = apptSnap.docs
    .map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        time: typeof d.time === "string" ? d.time : "",
        patientId: typeof d.patientId === "string" ? d.patientId : "",
        patientName: typeof d.patientName === "string" ? d.patientName : "Unnamed patient",
        doctor: typeof d.doctor === "string" ? d.doctor : "",
        treatment: typeof d.treatment === "string" ? d.treatment : "",
        status: normalizeAppointmentStatus(typeof d.status === "string" ? d.status : ""),
      };
    })
    .sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

  const counts = {
    total: appointments.length,
    attended: appointments.filter((a) => ATTENDED.has(a.status)).length,
    cancelled: appointments.filter((a) => a.status === "Cancelled" || a.status === "No Show").length,
    stillScheduled: appointments.filter((a) => a.status === "Scheduled" || a.status === "Confirmed").length,
  };

  const names = new Map<string, string>();
  patientsSnap.forEach((doc) => {
    const n = (doc.data() || {}).name;
    if (typeof n === "string" && n.trim()) names.set(doc.id, n.trim());
  });

  // Balance is charged-minus-paid per patient; there is no stored balance field to read (the one
  // on the patient doc is written as 0 at creation and never updated).
  const billed = new Map<string, number>();
  const paid = new Map<string, number>();
  const lastActivity = new Map<string, Date>();

  ledgerSnap.forEach((doc) => {
    const d = (doc.data() || {}) as Record<string, unknown>;
    if (d.status === "deleted" || d.status === "cancelled") return;
    const patientId = typeof d.patientId === "string" ? d.patientId : "";
    if (!patientId) return;

    const amount = rowAmount(d);
    if (String(d.type) === "payment") paid.set(patientId, (paid.get(patientId) || 0) + amount);
    else if (String(d.type) === "procedure") billed.set(patientId, (billed.get(patientId) || 0) + amount);

    const when = parseDate(d.date);
    if (when) {
      const current = lastActivity.get(patientId);
      if (!current || when.getTime() > current.getTime()) lastActivity.set(patientId, when);
    }
  });

  const staleBalances: StaleBalance[] = [];
  for (const [patientId, billedTotal] of billed) {
    const balance = billedTotal - (paid.get(patientId) || 0);
    if (balance < MIN_BALANCE) continue;

    const last = lastActivity.get(patientId);
    if (!last) continue;
    const days = Math.max(0, Math.round((Date.now() - last.getTime()) / 86400000));
    if (days < STALE_DAYS) continue;

    staleBalances.push({
      patientId,
      patientName: names.get(patientId) || "Unnamed patient",
      balance,
      daysSinceLastActivity: days,
    });
  }
  staleBalances.sort((a, b) => b.balance - a.balance);

  notes.push(
    `"No recent activity" means no ledger entry for ${STALE_DAYS}+ days. It is not the same as ` +
      "overdue — this system does not record payment due dates."
  );

  return {
    generatedAt: new Date().toISOString(),
    dateKey,
    appointments,
    counts,
    staleBalances,
    staleBalanceTotal: staleBalances.reduce((sum, r) => sum + r.balance, 0),
    notes,
  };
}
