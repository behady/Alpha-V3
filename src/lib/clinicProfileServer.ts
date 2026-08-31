import { adminClinicDoc } from "@/lib/adminClinicDb";
import type { ClinicProfile } from "@/types/clinicProfile";
import {
  CLINIC_PROFILE_DOC,
  LEGACY_CLINIC_PROFILE_DOC,
  LEGACY_ONLY_FIELDS,
  sanitizeClinicProfile,
} from "@/lib/clinicProfile";

/**
 * Server-side read for API routes & SSR (Firebase Admin).
 *
 * Takes an explicit clinicId: this once read the root `settings/clinicProfile` doc, which does not
 * exist — every clinic's settings live under clinics/{clinicId}/settings — so it always returned
 * null and callers silently fell back to placeholder clinic names in outbound WhatsApp messages.
 *
 * Reads the merged document now, with the same fallback the client uses for clinics that have not
 * saved their profile since Phase 2. See src/lib/clinicProfile.ts for why the fallback exists and
 * when it can be deleted.
 */
export async function getClinicProfileAdmin(clinicId: string): Promise<ClinicProfile | null> {
  const snap = await adminClinicDoc(clinicId, CLINIC_PROFILE_DOC.collection, CLINIC_PROFILE_DOC.docId).get();
  const current = snap.exists ? sanitizeClinicProfile(snap.data() as Record<string, unknown>) : null;

  if (current && LEGACY_ONLY_FIELDS.every((field) => current[field])) return current;

  const legacySnap = await adminClinicDoc(
    clinicId,
    LEGACY_CLINIC_PROFILE_DOC.collection,
    LEGACY_CLINIC_PROFILE_DOC.docId
  ).get();
  if (!legacySnap.exists) return current;

  const legacy = sanitizeClinicProfile(legacySnap.data() as Record<string, unknown>);
  if (!current) return legacy;

  const merged = { ...current };
  for (const field of LEGACY_ONLY_FIELDS) {
    if (!merged[field] && legacy[field]) merged[field] = legacy[field];
  }
  return merged;
}
