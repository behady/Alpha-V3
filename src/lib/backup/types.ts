/**
 * What the Excel backup is built from.
 *
 * Plain arrays, no Firestore types, so the workbook builder can be tested with fixtures and never
 * needs credentials — the same split as ledgerWrite.ts and the briefing sections. The loader
 * (loadClinicBackupData.ts) is the only file that knows where any of this comes from.
 *
 * Where a row shape already exists for the briefing (LedgerRow, StaffRecord, PunchRecord) it is
 * reused rather than re-declared, and only the fields the backup adds are listed here.
 */

import type { LedgerRow, PunchRecord, StaffRecord } from "@/lib/automation/briefing/data";
import type { LabCase } from "@/lib/labCases";
import type { LabPayment } from "@/lib/labAccounts";
import type { PriceList } from "@/lib/priceLists";

export type BackupPatient = {
  id: string;
  /** `PT-42` — the number the desk knows the patient by. */
  fileId: string;
  name: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  address: string;
  branchName: string;
  /** `source`, else the older `referral`. */
  source: string;
  medicalHistory: string;
  allergies: string;
  status: string;
  /** yyyy-mm-dd on the clinic's clock, or "" when the record never had one. */
  createdAt: string;
};

export type BackupAppointment = {
  id: string;
  date: string;
  time: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  doctor: string;
  treatment: string;
  status: string;
  duration: number;
  branchName: string;
  roomName: string;
  source: string;
  cost: number | null;
  notes: string;
};

export type BackupLedgerRow = LedgerRow & {
  payerName: string;
  /** "" for a live row; "deleted" / "cancelled" for one the Reports Center skips. */
  status: string;
  notes: string;
};

export type BackupStaff = StaffRecord & {
  email: string;
  phone: string;
  active: boolean;
  isDentist: boolean;
};

export type BackupService = {
  id: string;
  name: string;
  category: string;
  pricingMode: string;
  requiresLab: boolean;
  estimatedLabFee: number | null;
  /** The base (standard) price. */
  price: number | null;
  /** Overrides keyed by price-list id. Absent list → the base price applies. */
  prices: Record<string, number>;
};

export type ClinicBackupData = {
  clinic: { id: string; name: string; timeZone: string };
  /** ISO instant. */
  generatedAt: string;
  /** Display name of the person who pressed the button. */
  generatedBy: string;
  patients: BackupPatient[];
  appointments: BackupAppointment[];
  ledger: BackupLedgerRow[];
  labCases: LabCase[];
  labPayments: LabPayment[];
  labs: Array<{ id: string; name: string }>;
  staff: BackupStaff[];
  services: BackupService[];
  priceLists: PriceList[];
  punches: PunchRecord[];
};
