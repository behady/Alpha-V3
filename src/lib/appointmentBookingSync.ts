import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export interface BookingSavePayload {
  patientId: string;
  patientName: string;
  isNewPatient?: boolean;
  newPatientPhone?: string;
  newPatientDob?: string;
  newPatientAddress?: string;
  newPatientSource?: string;
  newPatientGender?: string;
  treatment: string;
  doctor: string;
  date: string;
  time: string;
  duration: number;
  type?: string;
  notes?: string;
  cost: number;
  clinicalNoteId?: string | null;
  newProcedureName?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  chargeForVisit?: boolean;
  listPrice?: number;
  discountMode?: string;
  discountPercent?: number | null;
  discountFixed?: number | null;
  discountAmount?: number | null;
  sessionProcedures?: { name: string; cost: number; addToLedger: boolean }[];
  status?: string;
  delayedPromptUntil?: number | null;
  services?: Array<{
    serviceId: string | null;
    serviceName: string;
    cost: number;
    listPrice?: number;
    discountAmount?: number;
    clinicalNoteId?: string;
    ledgerId?: string;
    status?: "Planned" | "Completed";
  }>;
  discountDistribution?: "total" | "each";
}

function buildLedgerDescription(data: BookingSavePayload, normalizedCost: number, svcName: string): string {
  const isPlanned = !data.status || ["Scheduled", "Confirmed"].includes(data.status);
  const statusSuffix = isPlanned ? " (Planned)" : "";
  const base = `${svcName || data.treatment}${statusSuffix}`;
  const amt = Number(data.discountAmount) || 0;
  const list = Number(data.listPrice) || 0;
  const chargeForVisit = data.chargeForVisit !== false;
  if (!chargeForVisit || amt <= 0 || list <= 0 || normalizedCost >= list) return base;
  const mode = data.discountMode as string | undefined;
  const tag =
    mode === "percent" && data.discountPercent != null
      ? `${data.discountPercent}% off`
      : mode === "fixed"
        ? `${amt} EGP off`
        : "discount";
  return `${base} — Before ${list} → After ${normalizedCost} (${tag})`;
}

/** Create or update clinical note + procedure ledger row for an appointment (create or edit flow). */
export async function syncClinicalNoteAndLedgerForAppointment(
  fs: Firestore,
  opts: {
    appointmentId: string;
    normalizedDate: string;
    normalizedTime: string;
    normalizedCost: number;
    chargeForVisit: boolean;
    data: BookingSavePayload;
    userName: string;
    /** Resolved clinical note id (possibly newly created earlier in the flow). */
  finalClinicalNoteId: string | null;
  }
): Promise<{ serviceId: string | null; serviceName: string; cost: number; clinicalNoteId: string; ledgerId?: string | null; status?: "Planned" | "Completed" }[]> {
  const {
    appointmentId,
    normalizedDate,
    normalizedTime,
    normalizedCost,
    chargeForVisit,
    data,
    userName,
    finalClinicalNoteId,
  } = opts;

  const servicesList = data.services && data.services.length > 0 
    ? data.services 
    : [{ serviceId: data.serviceId || null, serviceName: data.serviceName || data.newProcedureName || data.treatment, cost: normalizedCost }];

  let primaryClinicalNoteId = finalClinicalNoteId;
  const syncedServices: { serviceId: string | null; serviceName: string; cost: number; clinicalNoteId: string; ledgerId?: string | null; status?: "Planned" | "Completed" }[] = [];

  // Process each service
  for (let i = 0; i < servicesList.length; i++) {
    const svc = servicesList[i];
    let noteId = svc.clinicalNoteId || (i === 0 ? primaryClinicalNoteId : null);
    
    // For extra services in 'existing' mode or multiple services in 'new' mode, we need unique clinical notes
    // If it's the first service and we have a finalClinicalNoteId, reuse it. Otherwise, create a new one.
    if (!noteId) {
      const newNoteRef = await addDoc(collection(fs, "clinical_notes"), {
        patientId: String(data.patientId),
        patientName: data.patientName,
        title: svc.serviceName.trim(),
        procedure: svc.serviceName.trim(),
        serviceId: svc.serviceId || null,
        serviceName: svc.serviceName || null,
        status: svc.status || (data.status === "Checked In" || data.status === "Checking Out" || data.status === "Completed" ? "Ongoing" : "Planned"), // Default for multi-service items
        date: normalizedDate || data.date,
        doctor: data.doctor || "",
        tooth: "Gen",
        note: "",
        createdAt: serverTimestamp(),
        addedBy: userName,
        cost: svc.cost,
        paid: 0,
        appointmentId: appointmentId,
        lastAppointmentId: appointmentId,
      });
      noteId = newNoteRef.id;
      if (i === 0) primaryClinicalNoteId = noteId; // Save first as primary if generated here
    } else if (noteId) {
      // Update existing primary note
      try {
        if (!chargeForVisit) {
          await updateDoc(doc(fs, "clinical_notes", noteId), {
            patientId: String(data.patientId),
            patientName: data.patientName,
            updatedAt: serverTimestamp(),
            appointmentId: appointmentId,
            lastAppointmentId: appointmentId,
            lastScheduledDate: normalizedDate || data.date,
            lastScheduledTime: normalizedTime || data.time,
            date: normalizedDate || data.date,
            doctor: data.doctor || "",
            status: svc.status || "Planned",
          });
        } else {
          const noteSync: Record<string, unknown> = {
            patientId: String(data.patientId),
            patientName: data.patientName,
            updatedAt: serverTimestamp(),
            appointmentId: appointmentId,
            lastAppointmentId: appointmentId,
            lastScheduledDate: normalizedDate || data.date,
            lastScheduledTime: normalizedTime || data.time,
            serviceId: svc.serviceId || null,
            serviceName: svc.serviceName || null,
            cost: svc.cost,
            date: normalizedDate || data.date,
            doctor: data.doctor || "",
            procedure: svc.serviceName || data.treatment,
            status: svc.status || "Planned",
          };
          await updateDoc(doc(fs, "clinical_notes", noteId), noteSync);
        }
      } catch (e) {
        console.warn("Clinical note sync failed", e);
      }
    }

    let existingLedgerId: string | undefined = undefined;
    
    // Ledger Sync per service
    try {
      const isCancelledOrNoShow = ["Cancelled", "No Show"].includes(data.status || "");
      const svcCost = svc.cost;

      // Handle Discount Distribution
      let svcDiscountAmount = 0;
      let svcListPrice = svcCost;
      let svcDiscountMode = data.discountMode || "none";
      
      if (data.discountDistribution === "each") {
        if (data.discountMode === "fixed") {
          svcDiscountAmount = Number(data.discountFixed) || 0;
          svcListPrice = svcCost + svcDiscountAmount;
        } else if (data.discountMode === "percent") {
          const pct = Number(data.discountPercent) || 0;
          svcListPrice = svcCost / (1 - pct/100);
          svcDiscountAmount = svcListPrice - svcCost;
        }
      } else if (svc.discountAmount !== undefined || svc.listPrice !== undefined) {
        svcDiscountAmount = Number(svc.discountAmount) || 0;
        svcListPrice = Number(svc.listPrice) || svcCost;
        svcDiscountMode = svcDiscountAmount > 0 ? "fixed" : "none";
      } else {
        const totalCost = servicesList.reduce((acc, s) => acc + (Number(s.cost) || 0), 0);
        const totalDiscount = Number(data.discountAmount) || 0;
        
        if (totalCost > 0 && totalDiscount > 0) {
           svcDiscountAmount = Math.round((Number(svc.cost) / totalCost) * totalDiscount);
           // Prevent rounding issues by giving remaining to the last service
           if (i === servicesList.length - 1) {
              const previousDiscounts = servicesList.slice(0, i).reduce((acc, s) => {
                 return acc + Math.round((Number(s.cost) / totalCost) * totalDiscount);
              }, 0);
              svcDiscountAmount = Math.max(0, totalDiscount - previousDiscounts);
           }
           svcListPrice = Number(svc.cost);
           svcDiscountMode = "fixed";
        } else {
           svcDiscountMode = "none";
           svcDiscountAmount = 0;
           svcListPrice = Number(svc.cost);
        }
      }

      // We need to find if there's an existing ledger for this clinical note from this appointment
      const syncedLedgerQuery = query(
        getClinicCollection("ledger"),
        where("appointmentId", "==", appointmentId),
        where("clinicalNoteId", "==", noteId),
        where("type", "==", "procedure")
      );
      const syncedLedgerSnap = await getDocs(syncedLedgerQuery);
      const existingSyncedLedger = syncedLedgerSnap.docs[0];
      if (existingSyncedLedger) existingLedgerId = existingSyncedLedger.id;

      if (svc.status === "Completed" && !isCancelledOrNoShow && chargeForVisit && data.treatment && (svcCost > 0 || svcListPrice > 0)) {
        const ledgerPayload = {
          patientId: data.patientId,
          patientName: data.patientName,
          date: normalizedDate || data.date,
          type: "procedure" as const,
          description: buildLedgerDescription({ ...data, listPrice: svcListPrice, discountAmount: svcDiscountAmount, discountMode: svcDiscountMode }, svcCost, svc.serviceName || data.treatment),
          cost: svcCost,
          paid: 0,
          doctor: data.doctor,
          clinicalNoteId: noteId,
          appointmentId,
          serviceId: svc.serviceId || null,
          serviceName: svc.serviceName || null,
          listPrice: svcListPrice || 0,
          discountMode: svcDiscountMode,
          discountPercent: data.discountDistribution === "each" ? (data.discountPercent ?? null) : (i === 0 ? (data.discountPercent ?? null) : null),
          discountFixed: data.discountDistribution === "each" ? (data.discountFixed ?? null) : (i === 0 ? (data.discountFixed ?? null) : null),
          discountAmount: svcDiscountAmount || 0,
          addedBy: userName,
        };
        if (existingSyncedLedger) {
          await updateDoc(getClinicDoc("ledger", existingSyncedLedger.id), {
            ...ledgerPayload,
            updatedAt: serverTimestamp(),
          });
        } else {
          const ref = await addDoc(getClinicCollection("ledger"), {
            ...ledgerPayload,
            createdAt: serverTimestamp(),
          });
          existingLedgerId = ref.id;
        }
      } else if (existingSyncedLedger) {
        const paymentsQuery = query(getClinicCollection("ledger"), where("procedureId", "==", existingSyncedLedger.id), where("type", "==", "payment"));
        const paymentsSnap = await getDocs(paymentsQuery);
        if (!paymentsSnap.empty) throw new Error("HAS_PAYMENTS");
        await deleteDoc(getClinicDoc("ledger", existingSyncedLedger.id));
      }
    } catch (e: any) {
      if (e?.message === "HAS_PAYMENTS") throw e;
      console.warn("Ledger sync failed", e);
    }

    syncedServices.push({
      serviceId: svc.serviceId || null,
      serviceName: svc.serviceName || "",
      cost: svc.cost,
      clinicalNoteId: noteId || "",
      ledgerId: existingLedgerId || null,
      status: svc.status || "Planned",
    });
  }

  return syncedServices;
}

/** Create a new clinical note when booking requests a new procedure name and none is linked yet. */
export async function maybeCreateClinicalNoteForBooking(
  fs: Firestore,
  data: BookingSavePayload,
  normalizedDate: string,
  normalizedCost: number,
  userName: string
): Promise<string | null> {
  // Overridden by syncClinicalNoteAndLedgerForAppointment since we now handle multiple services directly inside the sync block.
  // We keep this returning null to let sync block create the notes if needed.
  return data.clinicalNoteId || null;
}

export async function loadAppointmentStatus(fs: Firestore, appointmentId: string): Promise<string> {
  const snap = await getDoc(doc(fs, "appointments", appointmentId));
  if (!snap.exists()) return "Scheduled";
  return String(snap.data()?.status || "Scheduled");
}

export { db };
