/**
 * One Firestore document → one backup row, for every kind of record the workbook holds.
 *
 * Firebase-free (a document is a plain object here) so the mapping is tested with fixtures.
 *
 * Where the briefing has a mapper it is reused for the fields both agree on — a staff schedule, a
 * ledger row's money — so the file can never disagree with the weekly brief. But the briefing
 * mappers fill gaps with words a summary needs ("Unnamed patient", "Cash", "General", 30 minutes,
 * "Scheduled"). A backup must not invent anything: those fields are re-read here as stored, and
 * an absent value stays an empty cell.
 */

import {
  mapAppointment,
  mapLedger,
  mapStaff,
  toDate,
} from "@/lib/automation/briefing/data";
import { ymdInTimeZone } from "@/lib/clinicDate";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import type { LabPayment } from "@/lib/labAccounts";
import type {
  BackupAppointment,
  BackupLedgerRow,
  BackupPatient,
  BackupService,
  BackupStaff,
} from "./types";

type Doc = Record<string, unknown>;

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A stored date of any shape (yyyy-mm-dd text, ISO text, Timestamp) as yyyy-mm-dd on the clinic's calendar, or "". */
export function ymd(v: unknown, timeZone: string): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = toDate(v);
  return d ? ymdInTimeZone(timeZone, d) : "";
}

export function mapPatient(id: string, d: Doc, timeZone: string): BackupPatient {
  return {
    id,
    fileId: str(d.fileId),
    name: str(d.name),
    phone: str(d.phone),
    gender: str(d.gender),
    dateOfBirth: ymd(d.dateOfBirth, timeZone),
    address: str(d.address),
    branchName: str(d.branchName),
    source: str(d.source) || str(d.referral),
    medicalHistory: str(d.medicalHistory),
    allergies: str(d.allergies),
    status: str(d.status),
    createdAt: ymd(d.createdAt, timeZone),
  };
}

export function mapBackupAppointment(id: string, d: Doc): BackupAppointment {
  const base = mapAppointment(id, d);
  const status = str(d.status);
  return {
    ...base,
    patientName: str(d.patientName),
    // A legacy alias is still normalised; a missing status is missing, not "Scheduled".
    status: status ? normalizeAppointmentStatus(status) : "",
    duration: numOrNull(d.duration) as number,
    patientPhone: str(d.patientPhone),
    branchName: str(d.branchName),
    roomName: str(d.roomName),
    source: str(d.source),
    cost: numOrNull(d.cost),
    notes: str(d.notes),
  };
}

export function mapBackupLedger(id: string, d: Doc, timeZone: string): BackupLedgerRow {
  return {
    ...mapLedger(id, d),
    // The Reports Center reads `date || createdAt`; a row with neither has no date to show.
    date: ymd(d.date, timeZone) || ymd(d.createdAt, timeZone),
    patientName: str(d.patientName),
    category: str(d.category),
    method: str(d.method),
    payerName: str(d.payerName),
    status: str(d.status),
    notes: str(d.notes) || str(d.note),
  };
}

export function mapBackupStaff(id: string, d: Doc): BackupStaff {
  return {
    ...mapStaff(id, d),
    email: str(d.email),
    phone: str(d.phone),
    active: d.active !== false,
    isDentist: d.isDentist === true,
  };
}

export function mapService(id: string, d: Doc): BackupService {
  const prices: Record<string, number> = {};
  const raw = d.prices;
  if (raw && typeof raw === "object") {
    for (const [listId, v] of Object.entries(raw as Doc)) {
      const n = numOrNull(v);
      if (n !== null) prices[listId] = n;
    }
  }
  return {
    id,
    name: str(d.name),
    category: str(d.category),
    pricingMode: str(d.pricingMode) || "per_tooth",
    requiresLab: d.requiresLab === true,
    estimatedLabFee: numOrNull(d.estimatedLabFee),
    price: numOrNull(d.price),
    prices,
  };
}

export function mapLabPayment(id: string, d: Doc, timeZone: string): LabPayment {
  return {
    id,
    labId: str(d.labId),
    labName: str(d.labName),
    amount: Number(d.amount) || 0,
    date: ymd(d.date, timeZone),
    method: str(d.method),
    reference: str(d.reference) || undefined,
    note: str(d.note) || undefined,
  };
}
