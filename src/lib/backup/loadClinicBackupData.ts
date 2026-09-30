/**
 * Everything a clinic owns, read for the Excel backup.
 *
 * The only file in the backup that touches Firestore. It reads with the Admin SDK (the route that
 * calls it has already proven the caller is this clinic's Owner or Admin) and hands the builder
 * plain arrays. Paging lives in readAllDocs.ts and the document → row mapping in mapDocs.ts, both
 * Firebase-free and tested; this file only says which collections and in what order.
 */

import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { clinicTimeZone } from "@/lib/clinicDate";
import { mapPunch } from "@/lib/automation/briefing/data";
import { LAB_CASES_COLLECTION, toLabCase } from "@/lib/labCases";
import { LAB_PAYMENTS_COLLECTION } from "@/lib/labAccounts";
import { LABS_SETTINGS_DOC, parseDentalLabs } from "@/lib/dentalLabs";
import { PRICE_LISTS_DOC, parsePriceLists } from "@/lib/priceLists";
import { readAllDocs } from "./readAllDocs";
import {
  mapBackupAppointment,
  mapBackupLedger,
  mapBackupStaff,
  mapLabPayment,
  mapPatient,
  mapService,
} from "./mapDocs";
import type { ClinicBackupData } from "./types";

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
    ledger: ledger.map((r) => mapBackupLedger(r.id, r.data, timeZone)),
    labCases: labCases.map((c) => toLabCase(c.id, c.data)),
    labPayments: labPayments.map((p) => mapLabPayment(p.id, p.data, timeZone)),
    labs: parseDentalLabs(labsDoc.data()).map((l) => ({ id: l.id, name: l.name })),
    staff: staff.map((s) => mapBackupStaff(s.id, s.data)),
    services: services.map((s) => mapService(s.id, s.data)),
    priceLists: parsePriceLists(priceListsDoc.data() as Record<string, unknown> | undefined),
    // The attendance collection also holds waiting-room check-ins; only punches carry a userId.
    punches: attendance.map((p) => mapPunch(p.id, p.data)).filter((p) => p.userId !== ""),
  };
}
