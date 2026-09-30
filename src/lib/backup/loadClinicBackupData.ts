/**
 * Everything a clinic owns, read for the Excel backup.
 *
 * The only file in the backup that touches Firestore. It reads with the Admin SDK (the route that
 * calls it has already proven the caller is this clinic's Owner or Admin) and hands the builder
 * plain arrays.
 *
 * No `limit()` anywhere. The briefing loader caps its scans because a brief is a summary and a
 * 4,000-row sample is enough for one; a backup that quietly stopped at row 4,000 would be worse
 * than none, because the owner would trust it. Every collection is paged by document id until a
 * page comes back short.
 *
 * Row shapes come from the briefing mappers where one exists, so a ledger row or a staff schedule
 * means the same thing here as it does on the weekly brief.
 */

import { FieldPath, type CollectionReference, type DocumentData } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import {
  mapAppointment,
  mapLedger,
  mapPunch,
  mapStaff,
  toDate,
} from "@/lib/automation/briefing/data";
import { LAB_CASES_COLLECTION, toLabCase } from "@/lib/labCases";
import { LAB_PAYMENTS_COLLECTION, type LabPayment } from "@/lib/labAccounts";
import { LABS_SETTINGS_DOC, parseDentalLabs } from "@/lib/dentalLabs";
import { PRICE_LISTS_DOC, parsePriceLists } from "@/lib/priceLists";
import type {
  BackupAppointment,
  BackupLedgerRow,
  BackupPatient,
  BackupService,
  BackupStaff,
  ClinicBackupData,
} from "./types";

type Doc = { id: string; data: Record<string, unknown> };

/** Page size per read. Firestore returns a page in one round trip; 1,000 keeps each under the memory a route has. */
const PAGE = 1000;

/**
 * Every document in a collection, in id order, however many there are.
 *
 * Ordered by document id so `startAfter` has a total order to resume from without an index.
 */
export async function readAllDocs(ref: CollectionReference<DocumentData>, pageSize = PAGE): Promise<Doc[]> {
  const out: Doc[] = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = ref.orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const doc of snap.docs) out.push({ id: doc.id, data: (doc.data() || {}) as Record<string, unknown> });
    if (snap.docs.length < pageSize) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A stored date of any shape as yyyy-mm-dd on the clinic's calendar, or "". */
function ymd(v: unknown, timeZone: string): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = toDate(v);
  return d ? ymdInTimeZone(timeZone, d) : "";
}

function mapPatient(id: string, d: Record<string, unknown>, timeZone: string): BackupPatient {
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

function mapBackupAppointment(id: string, d: Record<string, unknown>): BackupAppointment {
  const base = mapAppointment(id, d);
  return {
    ...base,
    patientPhone: str(d.patientPhone),
    branchName: str(d.branchName),
    roomName: str(d.roomName),
    source: str(d.source),
    cost: numOrNull(d.cost),
    notes: str(d.notes),
  };
}

function mapBackupLedger(id: string, d: Record<string, unknown>): BackupLedgerRow {
  return {
    ...mapLedger(id, d),
    payerName: str(d.payerName),
    status: str(d.status),
    notes: str(d.notes) || str(d.note),
  };
}

function mapBackupStaff(id: string, d: Record<string, unknown>): BackupStaff {
  return {
    ...mapStaff(id, d),
    email: str(d.email),
    phone: str(d.phone),
    active: d.active !== false,
    isDentist: d.isDentist === true,
  };
}

function mapService(id: string, d: Record<string, unknown>): BackupService {
  const prices: Record<string, number> = {};
  const raw = d.prices;
  if (raw && typeof raw === "object") {
    for (const [listId, v] of Object.entries(raw as Record<string, unknown>)) {
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

function mapLabPayment(id: string, d: Record<string, unknown>): LabPayment {
  return {
    id,
    labId: str(d.labId),
    labName: str(d.labName),
    amount: Number(d.amount) || 0,
    date: str(d.date).slice(0, 10),
    method: str(d.method),
    reference: str(d.reference) || undefined,
    note: str(d.note) || undefined,
  };
}

export async function loadClinicBackupData(args: {
  clinicId: string;
  generatedBy: string;
}): Promise<ClinicBackupData> {
  const { clinicId, generatedBy } = args;
  const timeZone = clinicTimeZone();

  const [
    profile,
    patients,
    appointments,
    ledger,
    labCases,
    labPayments,
    staff,
    services,
    attendance,
    labsDoc,
    priceListsDoc,
  ] = await Promise.all([
    getClinicProfileAdmin(clinicId),
    readAllDocs(adminClinicCollection(clinicId, "patients")),
    readAllDocs(adminClinicCollection(clinicId, "appointments")),
    readAllDocs(adminClinicCollection(clinicId, "ledger")),
    readAllDocs(adminClinicCollection(clinicId, LAB_CASES_COLLECTION)),
    readAllDocs(adminClinicCollection(clinicId, LAB_PAYMENTS_COLLECTION)),
    readAllDocs(adminClinicCollection(clinicId, "staff")),
    readAllDocs(adminClinicCollection(clinicId, "services")),
    readAllDocs(adminClinicCollection(clinicId, "attendance")),
    adminClinicDoc(clinicId, "settings", LABS_SETTINGS_DOC).get(),
    adminClinicDoc(clinicId, "settings", PRICE_LISTS_DOC).get(),
  ]);

  return {
    clinic: { id: clinicId, name: profile?.clinicName || clinicId, timeZone },
    generatedAt: new Date().toISOString(),
    generatedBy,
    patients: patients.map((p) => mapPatient(p.id, p.data, timeZone)),
    appointments: appointments.map((a) => mapBackupAppointment(a.id, a.data)),
    ledger: ledger.map((r) => mapBackupLedger(r.id, r.data)),
    labCases: labCases.map((c) => toLabCase(c.id, c.data)),
    labPayments: labPayments.map((p) => mapLabPayment(p.id, p.data)),
    labs: parseDentalLabs(labsDoc.data()).map((l) => ({ id: l.id, name: l.name })),
    staff: staff.map((s) => mapBackupStaff(s.id, s.data)),
    services: services.map((s) => mapService(s.id, s.data)),
    priceLists: parsePriceLists(priceListsDoc.data() as Record<string, unknown> | undefined),
    // The attendance collection also holds waiting-room check-ins; only punches carry a userId.
    punches: attendance.map((p) => mapPunch(p.id, p.data)).filter((p) => p.userId !== ""),
  };
}
