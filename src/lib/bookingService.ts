import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDoc,
  deleteDoc,
  runTransaction,
  arrayUnion,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { logActivity } from "@/lib/logger";
import { sendPatientAppointmentWhatsApp } from "@/lib/sendPatientAppointmentWhatsAppClient";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import {
  normalizeDateKey,
  normalizeTimeKey,
  parseApptTimeToMinutes,
  minutesToTimeKey,
} from "@/lib/appointmentTime";

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
  /**
   * Staff id of the treating dentist. `doctor` is a display name and is not a stable key —
   * it has been observed holding an email address in real records, and renaming a dentist
   * silently orphans every row keyed on the old string.
   */
  doctorId?: string | null;
  date: string;
  time: string;
  duration: number;
  /** Branch/room the visit happens in. Ids are the stable keys; names are display copies. */
  branchId?: string | null;
  branchName?: string | null;
  roomId?: string | null;
  roomName?: string | null;
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

/**
 * Moved to lib/appointmentTime.ts so server code can use them without importing the client
 * Firebase SDK that this module pulls in. Re-exported here so existing imports keep working.
 */
export { normalizeDateKey, normalizeTimeKey, parseApptTimeToMinutes, minutesToTimeKey };

export interface BookingUserContext {
  uid: string;
  name: string;
  role: string;
  language: "en" | "ar";
}

/**
 * Validates, normalizes, and saves the booking (creates/updates appointment, ledger, and clinical note).
 * Dispatches WhatsApp alerts and activity logs.
 */
export async function saveBooking(
  data: BookingSavePayload & { existingAppointmentId?: string | null; status?: string },
  userCtx: BookingUserContext,
  fireOwnerWhatsAppAlert: (key: string, msg: string) => Promise<void>
): Promise<void> {
  const normalizedDate = normalizeDateKey(data.date);
  const normalizedTime = normalizeTimeKey(data.time);
  const chargeForVisit = data.chargeForVisit !== false;
  const normalizedCost = chargeForVisit ? Number(data?.cost) || 0 : 0;

  if (data.isNewPatient) {
    const counterRef = getClinicDoc("settings", "counters");
    const newIdNumber = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let nextId = 1000;
      if (counterDoc.exists() && counterDoc.data().patientId) {
        nextId = counterDoc.data().patientId + 1;
        transaction.update(counterRef, { patientId: nextId });
      } else {
        transaction.set(counterRef, { patientId: nextId }, { merge: true });
      }
      return nextId;
    });

    const generatedFileId = `PT-${newIdNumber}`;

    const pRef = await addDoc(getClinicCollection("patients"), {
      fileId: generatedFileId,
      name: data.patientName,
      phone: data.newPatientPhone || "",
      address: data.newPatientAddress || "",
      dateOfBirth: data.newPatientDob || "",
      gender: data.newPatientGender || "Male",
      referral: data.newPatientSource || "",
      // Left blank rather than asserting health nobody screened for. See NewPatientModal.
      medicalHistory: "",
      status: "New",
      balance: 0,
      totalSpent: 0,
      createdAt: serverTimestamp(),
      searchableName: data.patientName.toLowerCase(),
      searchablePhone: (data.newPatientPhone || "").replace(/\D/g, ""),
      teethData: {},
    });
    data.patientId = pRef.id;
  }

  if (data.existingAppointmentId) {
    const aid = String(data.existingAppointmentId);
    const prevSnap = await getDoc(getClinicDoc("appointments", aid));
    const prev = prevSnap.exists() ? prevSnap.data() : ({} as Record<string, unknown>);

    const finalClinicalNoteId: string | null = data.clinicalNoteId || (prev.clinicalNoteId as string | undefined) || null;

    const nextStatus = data.status || (prev.status as string) || "Scheduled";
    const updatePayload: any = {
      patientId: data.patientId,
      patientName: data.patientName,
      treatment: data.treatment,
      doctor: data.doctor,
      date: normalizedDate || data.date,
      time: normalizedTime || data.time,
      duration: Number(data.duration) || 30,
      // undefined = caller didn't touch location (status-only edits) → keep what was there.
      // "" or null = caller cleared the picker → store null.
      branchId: data.branchId !== undefined ? data.branchId || null : (prev.branchId as string | undefined) ?? null,
      branchName: data.branchName !== undefined ? data.branchName || null : (prev.branchName as string | undefined) ?? null,
      roomId: data.roomId !== undefined ? data.roomId || null : (prev.roomId as string | undefined) ?? null,
      roomName: data.roomName !== undefined ? data.roomName || null : (prev.roomName as string | undefined) ?? null,
      type: data.type || "consult",
      notes: data.notes || "",
      cost: normalizedCost,
      clinicalNoteId: finalClinicalNoteId,
      serviceId: chargeForVisit ? data.serviceId || null : null,
      serviceName: chargeForVisit ? data.serviceName || null : null,
      listPrice: chargeForVisit ? Number(data.listPrice) || 0 : null,
      discountMode: chargeForVisit ? data.discountMode || "none" : null,
      discountPercent:
        chargeForVisit && data.discountMode === "percent" ? data.discountPercent ?? null : null,
      discountFixed:
        chargeForVisit && data.discountMode === "fixed" ? data.discountFixed ?? null : null,
      discountAmount: chargeForVisit ? Number(data.discountAmount) || 0 : null,
      modifiedBy: userCtx.name,
      updatedAt: serverTimestamp(),
      status: nextStatus,
      waitingMood: (prev.waitingMood as string | null | undefined) ?? null,
    };

    if (nextStatus !== prev.status) {
      updatePayload.statusHistory = arrayUnion({
        status: nextStatus,
        timestamp: new Date(),
        modifiedBy: userCtx.name,
      });
    }

    if (nextStatus === "Checked In" && prev.status !== "Checked In" && !prev.checkInTime) {
      updatePayload.checkInTime = serverTimestamp();
    }
    if ((nextStatus === "Checking Out" || nextStatus === "Completed") && prev.status !== nextStatus && !prev.checkOutTime) {
      updatePayload.checkOutTime = serverTimestamp();
    }


    Object.keys(updatePayload).forEach(key => {
      if (updatePayload[key] === undefined) delete updatePayload[key];
    });
    await updateDoc(getClinicDoc("appointments", aid), updatePayload);

    await logActivity(
      { uid: userCtx.uid, name: userCtx.name, role: userCtx.role },
      "Appointment Updated",
      `Updated ${data.patientName} appointment ${aid}`
    );

    void fireOwnerWhatsAppAlert(
      "appointment_edit",
      userCtx.language === "ar"
        ? `تعديل موعد: ${data.patientName} — ${normalizedDate || data.date} ${normalizedTime || data.time}`
        : `Appointment edited: ${data.patientName} — ${normalizedDate || data.date} ${normalizedTime || data.time}`
    );

    const prevDate = normalizeDateKey(String(prev.date ?? ""));
    const prevTime = normalizeTimeKey(String(prev.time ?? ""));
    const prevDoctor = String(prev.doctor ?? "").trim();
    const nextDateNorm = normalizeDateKey(String(normalizedDate || data.date || ""));
    const nextTimeNorm = normalizeTimeKey(String(normalizedTime || data.time || ""));
    const nextDoctor = String(data.doctor ?? "").trim();
    const scheduleChanged =
      prevDate !== nextDateNorm || prevTime !== nextTimeNorm || prevDoctor !== nextDoctor;

    if (scheduleChanged && data.patientId) {
      void sendPatientAppointmentWhatsApp({
        template: "edit",
        patientId: String(data.patientId),
        date: String(normalizedDate || data.date || ""),
        time: String(normalizedTime || data.time || ""),
        doctor: nextDoctor,
      });
    }

    if (data.sessionProcedures && data.sessionProcedures.length > 0) {
      for (const sp of data.sessionProcedures) {
        let newLedgerId = null;
        if (sp.addToLedger && sp.cost > 0) {
          const lRef = await addDoc(getClinicCollection("ledger"), {
            patientId: data.patientId,
            patientName: data.patientName,
            type: "procedure",
            category: "Treatment",
            amount: sp.cost,
            cost: sp.cost,
            description: sp.name,
            date: normalizedDate || data.date,
            appointmentId: aid,
            paid: 0,
            createdAt: serverTimestamp(),
            createdBy: userCtx.uid || "system",
          });
          newLedgerId = lRef.id;
        }

        const noteRef = await addDoc(getClinicCollection("clinical_notes"), {
          patientId: data.patientId,
          createdAt: serverTimestamp(),
          appointmentId: aid,
          tooth: "Gen",
          procedure: sp.name,
          procedures: [sp.name],
          cost: sp.cost,
          unitCost: sp.cost,
          unitsCount: 1,
          pricingFormula: `${sp.cost}*1`,
          note: "",
          doctor: data.doctor || userCtx.name || "System",
          doctorId: data.doctorId || null,
          // The treating dentist above is not necessarily who booked this in.
          createdByUid: userCtx.uid || null,
          createdByName: userCtx.name || "System",
          date: normalizedDate || data.date,
          status: "Completed",
          ledgerId: newLedgerId,
        });

        if (newLedgerId) {
          await updateDoc(getClinicDoc("ledger", newLedgerId), { clinicalNoteId: noteRef.id });
        }
      }
    }

    return;
  }

  // New appointment flow
  const finalClinicalNoteId: string | null = data.clinicalNoteId || null;

  const appRef = await addDoc(getClinicCollection("appointments"), {
    patientId: data.patientId,
    patientName: data.patientName,
    treatment: data.treatment,
    doctor: data.doctor,
    doctorId: data.doctorId || null,
    date: normalizedDate || data.date,
    time: normalizedTime || data.time,
    duration: Number(data.duration) || 30,
    branchId: data.branchId || null,
    branchName: data.branchName || null,
    roomId: data.roomId || null,
    roomName: data.roomName || null,
    type: data.type || "consult",
    notes: data.notes || "",
    cost: normalizedCost,
    clinicalNoteId: finalClinicalNoteId,
    serviceId: chargeForVisit ? data.serviceId || null : null,
    serviceName: chargeForVisit ? data.serviceName || null : null,
    listPrice: chargeForVisit ? Number(data.listPrice) || 0 : null,
    discountMode: chargeForVisit ? data.discountMode || "none" : null,
    discountPercent:
      chargeForVisit && data.discountMode === "percent" ? data.discountPercent ?? null : null,
    discountFixed:
      chargeForVisit && data.discountMode === "fixed" ? data.discountFixed ?? null : null,
    discountAmount: chargeForVisit ? Number(data.discountAmount) || 0 : null,
    status: data.status || "Scheduled",
    statusHistory: [
      {
        status: data.status || "Scheduled",
        timestamp: new Date(),
        modifiedBy: userCtx.name,
      }
    ],
    addedBy: userCtx.name,
    createdAt: serverTimestamp(),
  });


  if (data.sessionProcedures && data.sessionProcedures.length > 0) {
    for (const sp of data.sessionProcedures) {
      let newLedgerId = null;
      if (sp.addToLedger && sp.cost > 0) {
        const lRef = await addDoc(getClinicCollection("ledger"), {
          patientId: data.patientId,
          patientName: data.patientName,
          type: "procedure",
          category: "Treatment",
          amount: sp.cost,
          cost: sp.cost,
          description: sp.name,
          date: normalizedDate || data.date,
          appointmentId: appRef.id,
          paid: 0,
          createdAt: serverTimestamp(),
          createdBy: userCtx.uid || "system",
        });
        newLedgerId = lRef.id;
      }

      const noteRef = await addDoc(getClinicCollection("clinical_notes"), {
        patientId: data.patientId,
        createdAt: serverTimestamp(),
        appointmentId: appRef.id,
        tooth: "Gen",
        procedure: sp.name,
        procedures: [sp.name],
        cost: sp.cost,
        unitCost: sp.cost,
        unitsCount: 1,
        pricingFormula: `${sp.cost}*1`,
        note: "",
        doctor: data.doctor || userCtx.name || "System",
        doctorId: data.doctorId || null,
        createdByUid: userCtx.uid || null,
        createdByName: userCtx.name || "System",
        date: normalizedDate || data.date,
        status: "Completed",
        ledgerId: newLedgerId,
      });

      if (newLedgerId) {
        await updateDoc(getClinicDoc("ledger", newLedgerId), { clinicalNoteId: noteRef.id });
      }
    }
  }

  await logActivity(
    { uid: userCtx.uid, name: userCtx.name, role: userCtx.role },
    "Appointment Created",
    `Booked ${data.patientName} on ${normalizedDate || data.date} at ${normalizedTime || data.time} with ${data.doctor}`
  );

  void fireOwnerWhatsAppAlert(
    "appointment_add",
    userCtx.language === "ar"
      ? `موعد جديد: ${data.patientName} — ${normalizedDate || data.date} ${normalizedTime || data.time} — ${data.doctor || ""}`
      : `New appointment: ${data.patientName} — ${normalizedDate || data.date} ${normalizedTime || data.time} — ${data.doctor || ""}`
  );

  if (data.patientId) {
    void sendPatientAppointmentWhatsApp({
      template: "new",
      patientId: String(data.patientId),
      date: String(normalizedDate || data.date || ""),
      time: String(normalizedTime || data.time || ""),
      doctor: String(data.doctor || ""),
    });
  }
}

export async function deleteBooking(appointmentId: string, userCtx: BookingUserContext): Promise<void> {
  const apptSnap = await getDoc(getClinicDoc("appointments", appointmentId));
  if (!apptSnap.exists()) return;
  const apptData = apptSnap.data();

  // Fix Scenario 1: The Phantom Charge
  // Check if this appointment has a ledger invoice attached
  const ledgerQuery = query(getClinicCollection("ledger"), where("appointmentId", "==", appointmentId), where("type", "==", "procedure"));
  const ledgerSnap = await getDocs(ledgerQuery);
  
  if (!ledgerSnap.empty) {
    for (const procedureLedger of ledgerSnap.docs) {
      const paymentsQuery = query(getClinicCollection("ledger"), where("procedureId", "==", procedureLedger.id), where("type", "==", "payment"));
      const paymentsSnap = await getDocs(paymentsQuery);
      
      if (!paymentsSnap.empty) {
          throw new Error("HAS_PAYMENTS");
      }
    }
    for (const procedureLedger of ledgerSnap.docs) {
        await deleteDoc(getClinicDoc("ledger", procedureLedger.id));
    }
  }

  // Delete associated clinical notes
  const notesQuery = query(getClinicCollection("clinical_notes"), where("lastAppointmentId", "==", appointmentId));
  const notesSnap = await getDocs(notesQuery);
  for (const docSnap of notesSnap.docs) {
    await deleteDoc(docSnap.ref);
  }

  await deleteDoc(getClinicDoc("appointments", appointmentId));
  await logActivity(
    { uid: userCtx.uid, name: userCtx.name, role: userCtx.role },
    "Appointment Deleted",
    `Deleted appointment for ${apptData.patientName || "Unknown"}`
  );
}

export async function updateBookingTime(id: string, newDate: string, newTime: string): Promise<void> {
  const ref = getClinicDoc('appointments', id);
  await updateDoc(ref, { date: newDate, time: newTime });
}
