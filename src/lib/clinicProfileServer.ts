import { adminClinicDoc } from "@/lib/adminClinicDb";
import type { ClinicProfile } from "@/types/clinicProfile";
import { sanitizeClinicProfile } from "@/lib/clinicProfile";

/**
 * Server-side read for API routes & SSR (Firebase Admin).
 *
 * Takes an explicit clinicId: this read the root `settings/clinicProfile` doc, which does not
 * exist — every clinic's settings live under clinics/{clinicId}/settings — so it always
 * returned null and callers silently fell back to placeholder clinic names in outbound
 * WhatsApp messages.
 */
export async function getClinicProfileAdmin(clinicId: string): Promise<ClinicProfile | null> {
  const snap = await adminClinicDoc(clinicId, "settings", "clinicProfile").get();
  if (!snap.exists) return null;
  return sanitizeClinicProfile(snap.data() as Record<string, unknown>);
}
