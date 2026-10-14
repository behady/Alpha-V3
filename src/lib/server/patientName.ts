/**
 * A patient's name for an activity-log line. Money and treatment routes know the patient's id but
 * not always the name, and a log reading "Payment Received" with no one on it is not much of a
 * record. Never throws: a log line without a name beats a failed payment.
 */

import { adminClinicDoc } from "@/lib/adminClinicDb";

export async function patientNameOf(clinicId: string, patientId: string | null | undefined): Promise<string | null> {
  if (!clinicId || !patientId) return null;
  try {
    const snap = await adminClinicDoc(clinicId, "patients", patientId).get();
    const name = snap.exists ? snap.data()?.name : null;
    return typeof name === "string" && name.trim() ? name : null;
  } catch (error) {
    console.error("patientNameOf: could not read the patient", { clinicId, patientId }, error);
    return null;
  }
}
