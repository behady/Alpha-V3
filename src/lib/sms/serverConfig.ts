import { adminClinicDoc } from "@/lib/adminClinicDb";
import { parseSmsSettings, type SmsSettings } from "@/lib/sms/config";

/**
 * Server-side read of a clinic's SMS settings.
 *
 * Kept apart from `config.ts` because that module is imported by the settings screen in the
 * browser, and anything reaching the Firestore Admin SDK from there pulls `firebase-admin` into
 * the client bundle.
 */
export async function loadSmsSettings(clinicId: string): Promise<SmsSettings> {
  try {
    const snap = await adminClinicDoc(clinicId, "settings", "sms").get();
    // Everything goes through parseSmsSettings, including the empty case: spreading the default
    // constant would hand every caller the same `events` and `templates` objects to mutate.
    return parseSmsSettings(snap.exists ? (snap.data() as Record<string, unknown> | undefined) : undefined);
  } catch {
    // An unreadable settings doc must not turn into "send by SMS anyway" — fall back to the
    // channel that costs the clinic nothing.
    return parseSmsSettings(undefined);
  }
}
