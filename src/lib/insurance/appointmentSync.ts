"use client";

/**
 * A finished visit tells its approval: the service line is Completed, and this dentist did it.
 *
 * Every screen that writes an appointment status calls this after its own write (bookingService,
 * the two reception dashboards, the dentist's home). It is a no-op for a private booking, for a
 * status that is not "done", and for a line that already says what the visit says, so calling it
 * on every status change costs one claim read at most.
 *
 * The write itself goes through the claims route (the client may not write `insurance_claims`),
 * which also carries the change into the treatment row in the patient's file. A failure here is
 * reported to the console and to the caller as a message; the appointment's own status is already
 * saved and must not look unsaved because the approval could not follow.
 */

import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { patchClaim, InsuranceCallError } from "@/components/insurance/api";
import { CLAIMS_COLLECTION, parseClaim } from "./claims";
import { lineSyncPatch, parseClaimLink, VISIT_DONE_STATUSES, type LinkedAppointmentLite } from "./appointments";

/** Resolves to null when nothing needed doing or it was done; otherwise a message for a toast. */
export async function syncClaimLineFromAppointment(clinicId: string | null | undefined, appt: LinkedAppointmentLite): Promise<string | null> {
  if (!clinicId) return null;
  const link = parseClaimLink(appt);
  if (!link || !VISIT_DONE_STATUSES.has(String(appt.status ?? ""))) return null;
  try {
    const snap = await getDoc(doc(db, "clinics", clinicId, CLAIMS_COLLECTION, link.claimId));
    if (!snap.exists()) return null;
    const claim = parseClaim(snap.id, snap.data());
    if (!claim) return null;
    const patch = lineSyncPatch(claim, appt);
    if (!patch) return null;
    const error = await patchClaim(clinicId, claim.id, patch);
    if (error) console.error("Insurance line did not follow the visit", error);
    return error;
  } catch (err) {
    console.error("Insurance line did not follow the visit", err);
    return err instanceof InsuranceCallError ? err.kind : "sync_failed";
  }
}
