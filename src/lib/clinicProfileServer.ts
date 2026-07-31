import { adminDb } from "@/lib/firebaseAdmin";
import type { ClinicProfile } from "@/types/clinicProfile";
import { sanitizeClinicProfile } from "@/lib/clinicProfile";

/** Server-side read for API routes & SSR (Firebase Admin). */
export async function getClinicProfileAdmin(): Promise<ClinicProfile | null> {
  const snap = await adminDb().collection("settings").doc("clinicProfile").get();
  if (!snap.exists) return null;
  return sanitizeClinicProfile(snap.data() as Record<string, unknown>);
}
