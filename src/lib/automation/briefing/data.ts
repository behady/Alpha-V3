import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { parseClinicSchedule, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import type { BriefingAppointment } from "./types";

/**
 * Every Firestore read a briefing needs, done once.
 *
 * The sections below used to be separate features with separate scans — the schedule read
 * appointments, the balance check read the ledger, the low-stock check read inventory. Assembled
 * into one page that would be six or seven round trips, several of them re-reading the same
 * collection. So the loading lives here and the section builders take plain arrays.
 *
 * Two scans are deliberately different in kind:
 *
 *  - Date-ranged queries (appointments, ledger, attendance) are exact. They ask for a window and
 *    get all of it.
 *  - The whole-ledger scan behind stale balances is capped and unordered, because a patient's
 *    balance is the sum of everything ever charged and paid, which has no useful date window. On
 *    a clinic past the cap it silently sees only part of the history, so that section carries its
 *    own note rather than presenting a total it cannot stand behind.
 */

const SCAN_LIMIT = 4000;
const AHEAD_LIMIT = 2000;
const STAFF_LIMIT = 500;
const LEADS_LIMIT = 3000;

export interface LedgerRow {
  id: string;
  type: string;
  date: string;
  description: string;
  category: string;
  method: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  amount: number;
  paid: number;
  cost: number;
  discountAmount: number;
  labFee: number;
  doctorCommissionAmount: number;
  clinicProfit: number;
}

export interface StaffRecord {
  id: string;
  uid: string;
  name: string;
  role: string;
  baseSalary: number;
  commissionPercentage: number;
  overtimeMultiplier: number;
  registeredDeviceId: string | null;
  /** Keyed 0-6 (Sunday first), matching JS getDay() and the attendance screen's editor. */
  schedule: Record<number, { active: boolean; start: string; end: string }> | null;
}

export interface PunchRecord {
  id: string;
  userId: string;
  staffId: string;
  userName: string;
  date: string;
  checkIn: Date | null;
  checkOut: Date | null;
  durationMinutes: number;
  status: string;
  overtimeStatus: string;
  checkInDistanceM: number | null;
  checkInAccuracyM: number | null;
  deviceId: string | null;
}

export interface LeadRecord {
  id: string;
  name: string;
  source: string;
  stage: string;
  followUpDate: string;
  patientId: string;
  createdAt: Date | null;
}

export interface InventoryRecord {
  id: string;
  name: string;
  stock: number;
  minStock: number;
  unit: string;
}

export interface BriefingData {
  /** Appointments inside the reporting window. */
  inRange: BriefingAppointment[];
  /** Appointments after the window — used for "did they book anything next?" and the preview. */
  ahead: BriefingAppointment[];
  /** Appointments in the comparison window, for the weekly brief's week-on-week arrows. */
  previousRange: BriefingAppointment[];
  /** Past appointments never closed out, from before the window. */
  unresolved: BriefingAppointment[];
  /** Ledger rows from the comparison window through the end of the reporting window. */
  ledgerWindow: LedgerRow[];
  /** Capped, unordered whole-ledger scan, for per-patient balances only. Empty without money access. */
  ledgerAll: LedgerRow[];
  ledgerAllTruncated: boolean;
  patientNames: Map<string, string>;
  patientCreatedAt: Map<string, Date>;
  staff: StaffRecord[];
  punches: PunchRecord[];
  leads: LeadRecord[];
  inventory: InventoryRecord[];
  schedule: ClinicScheduleConfig;
  /** Metres a punch may be from the clinic and still be accepted. Settings default is 50. */
  geofenceRadiusM: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && v !== null && "seconds" in v) {
    const s = Number((v as { seconds: unknown }).seconds);
    return Number.isFinite(s) ? new Date(s * 1000) : null;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapAppointment(id: string, d: Record<string, unknown>): BriefingAppointment {
  return {
    id,
    date: str(d.date),
    time: str(d.time),
    patientId: str(d.patientId),
    patientName: str(d.patientName, "Unnamed patient"),
    doctor: str(d.doctorName) || str(d.doctor),
    treatment: str(d.treatment),
    status: normalizeAppointmentStatus(str(d.status)),
    duration: num(d.duration) || 30,
  };
}

function mapLedger(id: string, d: Record<string, unknown>): LedgerRow {
  return {
    id,
    type: str(d.type),
    date: str(d.date).slice(0, 10),
    description: str(d.description),
    category: str(d.category, "General"),
    method: str(d.method, "Cash"),
    patientId: str(d.patientId),
    patientName: str(d.patientName, "Unnamed patient"),
    doctorId: str(d.doctorId),
    doctorName: str(d.doctorName) || str(d.doctor),
    amount: num(d.amount),
    paid: num(d.paid),
    cost: num(d.cost),
    discountAmount: num(d.discountAmount),
    labFee: num(d.labFee),
    doctorCommissionAmount: num(d.doctorCommissionAmount),
    clinicProfit: num(d.clinicProfit),
  };
}

/** Statuses that mean a past appointment was never answered for, either way. */
const UNRESOLVED_STATUSES = new Set(["Scheduled", "Confirmed", "Delayed"]);

export async function loadBriefingData(args: {
  clinicId: string;
  startDate: string;
  endDate: string;
  /** Earliest date the money comparison needs. Usually a week or a period before startDate. */
  comparisonStart: string;
  /** The comparison window itself, when week-on-week appointment counts are wanted. */
  previousStart: string | null;
  previousEnd: string | null;
  /** Earliest date the HR scan needs — the 1st of the month, for payroll-to-date. */
  attendanceStart: string;
  needsMoney: boolean;
  needsHr: boolean;
}): Promise<BriefingData> {
  const { clinicId, startDate, endDate, comparisonStart, attendanceStart, previousStart, previousEnd } = args;

  const empty = { docs: [] as { id: string; data: () => Record<string, unknown> }[], size: 0 };

  const [
    apptRangeSnap,
    apptAheadSnap,
    apptPreviousSnap,
    apptPastSnap,
    ledgerWindowSnap,
    ledgerAllSnap,
    patientsSnap,
    staffSnap,
    punchSnap,
    leadsSnap,
    inventorySnap,
    settingsSnap,
  ] = await Promise.all([
    adminClinicCollection(clinicId, "appointments").where("date", ">=", startDate).where("date", "<=", endDate).get(),
    adminClinicCollection(clinicId, "appointments").where("date", ">", endDate).limit(AHEAD_LIMIT).get(),
    previousStart && previousEnd
      ? adminClinicCollection(clinicId, "appointments")
          .where("date", ">=", previousStart)
          .where("date", "<=", previousEnd)
          .get()
      : Promise.resolve(empty),
    adminClinicCollection(clinicId, "appointments").where("date", "<", startDate).limit(SCAN_LIMIT).get(),
    args.needsMoney
      ? adminClinicCollection(clinicId, "ledger").where("date", ">=", comparisonStart).where("date", "<=", endDate).get()
      : Promise.resolve(empty),
    args.needsMoney ? adminClinicCollection(clinicId, "ledger").limit(SCAN_LIMIT).get() : Promise.resolve(empty),
    adminClinicCollection(clinicId, "patients").limit(SCAN_LIMIT).get(),
    args.needsHr ? adminClinicCollection(clinicId, "staff").limit(STAFF_LIMIT).get() : Promise.resolve(empty),
    args.needsHr
      ? adminClinicCollection(clinicId, "attendance")
          .where("date", ">=", attendanceStart)
          .where("date", "<=", endDate)
          .get()
      : Promise.resolve(empty),
    adminClinicCollection(clinicId, "leads").limit(LEADS_LIMIT).get(),
    adminClinicCollection(clinicId, "inventory").limit(SCAN_LIMIT).get(),
    adminClinicDoc(clinicId, "settings", "clinic_info").get(),
  ]);

  const inRange = apptRangeSnap.docs.map((doc) => mapAppointment(doc.id, doc.data() || {}));
  /**
   * Kept whole rather than trimmed to `aheadEnd`. The preview section only wants the next day or
   * week, but "did this patient book anything at all after their visit?" has to see the entire
   * future — trimming it would report a patient booked for next month as having left with nothing.
   */
  const ahead = apptAheadSnap.docs.map((doc) => mapAppointment(doc.id, doc.data() || {}));

  const previousRange = apptPreviousSnap.docs.map((doc) => mapAppointment(doc.id, doc.data() || {}));

  const unresolved = apptPastSnap.docs
    .map((doc) => mapAppointment(doc.id, doc.data() || {}))
    .filter((a) => UNRESOLVED_STATUSES.has(a.status));

  const ledgerWindow = ledgerWindowSnap.docs.map((doc) => mapLedger(doc.id, doc.data() || {}));
  const ledgerAll = ledgerAllSnap.docs.map((doc) => mapLedger(doc.id, doc.data() || {}));

  const patientNames = new Map<string, string>();
  const patientCreatedAt = new Map<string, Date>();
  patientsSnap.docs.forEach((doc) => {
    const d = (doc.data() || {}) as Record<string, unknown>;
    const name = str(d.name);
    if (name) patientNames.set(doc.id, name);
    const created = toDate(d.createdAt);
    if (created) patientCreatedAt.set(doc.id, created);
  });

  const staff: StaffRecord[] = staffSnap.docs.map((doc) => {
    const d = (doc.data() || {}) as Record<string, unknown>;
    const raw = d.attendanceSchedule;
    let schedule: StaffRecord["schedule"] = null;
    if (raw && typeof raw === "object") {
      const parsed: Record<number, { active: boolean; start: string; end: string }> = {};
      let any = false;
      for (let day = 0; day < 7; day++) {
        const cfg = (raw as Record<string, unknown>)[String(day)] as Record<string, unknown> | undefined;
        if (!cfg || typeof cfg !== "object") continue;
        any = true;
        parsed[day] = {
          active: Boolean(cfg.active),
          start: str(cfg.start, "00:00"),
          end: str(cfg.end, "00:00"),
        };
      }
      if (any) schedule = parsed;
    }

    return {
      id: doc.id,
      uid: str(d.uid),
      name: str(d.name, "Unnamed staff"),
      role: str(d.role, "Staff"),
      baseSalary: num(d.baseSalary),
      commissionPercentage: num(d.commissionPercentage),
      overtimeMultiplier: num(d.overtimeMultiplier) || 1.5,
      registeredDeviceId: str(d.registeredDeviceId) || null,
      schedule,
    };
  });

  /**
   * The `attendance` collection holds two unrelated kinds of document: staff punches, and
   * waiting-room check-ins written when a patient is marked Checked In. Only punches carry
   * `userId`, and only punches carry `date` — so the range query already excludes patient rows,
   * and the userId check makes that explicit rather than accidental.
   */
  const punches: PunchRecord[] = punchSnap.docs
    .map((doc) => {
      const d = (doc.data() || {}) as Record<string, unknown>;
      return {
        id: doc.id,
        userId: str(d.userId),
        staffId: str(d.staffId),
        userName: str(d.userName),
        date: str(d.date),
        checkIn: toDate(d.checkIn),
        checkOut: toDate(d.checkOut),
        durationMinutes: num(d.durationMinutes),
        status: str(d.status),
        overtimeStatus: str(d.overtimeStatus),
        checkInDistanceM: d.checkInDistanceM == null ? null : num(d.checkInDistanceM),
        checkInAccuracyM: d.checkInAccuracyM == null ? null : num(d.checkInAccuracyM),
        deviceId: str(d.deviceId) || null,
      };
    })
    .filter((p) => p.userId !== "");

  const leads: LeadRecord[] = leadsSnap.docs.map((doc) => {
    const d = (doc.data() || {}) as Record<string, unknown>;
    return {
      id: doc.id,
      name: str(d.name, "Unnamed lead"),
      source: str(d.source, "Unknown"),
      stage: str(d.stage, "new").toLowerCase(),
      followUpDate: str(d.followUpDate),
      patientId: str(d.patientId),
      createdAt: toDate(d.createdAt),
    };
  });

  const inventory: InventoryRecord[] = inventorySnap.docs.map((doc) => {
    const d = (doc.data() || {}) as Record<string, unknown>;
    return {
      id: doc.id,
      name: str(d.name, "Unnamed item"),
      stock: num(d.stock),
      minStock: num(d.minStock),
      unit: str(d.unit, "pcs"),
    };
  });

  const settingsData = (settingsSnap.data() || {}) as Record<string, unknown>;
  const radius = parseInt(String(settingsData.attendanceRadius ?? ""), 10);

  return {
    inRange,
    ahead,
    previousRange,
    unresolved,
    ledgerWindow,
    ledgerAll,
    ledgerAllTruncated: ledgerAllSnap.size >= SCAN_LIMIT,
    patientNames,
    patientCreatedAt,
    staff,
    punches,
    leads,
    inventory,
    schedule: parseClinicSchedule(settingsData),
    geofenceRadiusM: Number.isFinite(radius) && radius > 0 ? radius : 50,
  };
}
