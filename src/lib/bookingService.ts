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
import type { BookingSavePayload } from "@/lib/appointmentBookingSync";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export function normalizeDateKey(value?: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().split("T")[0];
}

export function normalizeTimeKey(value?: string): string {
  if (!value) return "";
  const normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace("ص", "AM")
    .replace("م", "PM")
    .toUpperCase();

  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (twelveHour) {
    const hours = Number(twelveHour[1]);
    const mins = Number(twelveHour[2]);
    if (hours >= 1 && hours <= 12 && mins >= 0 && mins <= 59) {
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")} ${twelveHour[3]}`;
    }
  }

  const twentyFourHour = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hours24 = Number(twentyFourHour[1]);
    const mins = Number(twentyFourHour[2]);
    if (hours24 >= 0 && hours24 <= 23 && mins >= 0 && mins <= 59) {
      const ampm = hours24 >= 12 ? "PM" : "AM";
      let hours12 = hours24 % 12;
      if (hours12 === 0) hours12 = 12;
      return `${hours12.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")} ${ampm}`;
    }
  }

  return normalized;
}

export function parseApptTimeToMinutes(timeStr?: string): number {
  if (!timeStr) return 0;
  const normalized = normalizeTimeKey(timeStr);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  return 0;
}

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
      medicalHistory: "None (Healthy)",
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
          doctorId: data.doctor || userCtx.uid || "system",
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
    date: normalizedDate || data.date,
    time: normalizedTime || data.time,
    duration: Number(data.duration) || 30,
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
        doctorId: data.doctor || userCtx.uid || "system",
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
