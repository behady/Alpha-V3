import { adminClinicDoc } from "@/lib/adminClinicDb";
import { normalizeToE164, sendWhatsApp } from "@/lib/whatsapp";
import type { OwnerAlertKey } from "@/types/whatsapp";
import { WHATSAPP_SETTINGS_DOC_REF } from "@/types/whatsapp";

export type OwnerAlertSendResult =
  | { sent: true }
  | { sent: false; reason: "no_settings" | "no_owner_number" | "disabled" | "invalid_owner_phone" };

/**
 * Sends a WhatsApp to `ownerNumber` when `ownerAlerts[alertKey]` is true (Settings → WhatsApp).
 *
 * This read the *top-level* `settings/whatsapp` document, which nothing in the application has
 * ever written — the Settings screen saves to `clinics/{clinicId}/settings/whatsapp`. So the
 * lookup always missed, every call returned "no_settings", and no owner alert has ever been sent.
 * Worse, had that document existed it would have been one owner number shared by every clinic on
 * the platform, so one practice's bookings and payments would have been reported to another
 * practice's owner. Now scoped to the clinic, like the screen that writes it.
 */
export async function sendOwnerWhatsAppAlertIfEnabled(
  clinicId: string,
  alertKey: OwnerAlertKey,
  message: string
): Promise<OwnerAlertSendResult> {
  if (!clinicId) return { sent: false, reason: "no_settings" };

  const snap = await adminClinicDoc(
    clinicId,
    WHATSAPP_SETTINGS_DOC_REF.collection,
    WHATSAPP_SETTINGS_DOC_REF.docId
  ).get();

  if (!snap.exists) {
    return { sent: false, reason: "no_settings" };
  }

  const data = snap.data() || {};
  const ownerNumber = typeof data.ownerNumber === "string" ? data.ownerNumber.trim() : "";
  const ownerAlerts = data.ownerAlerts as Record<string, boolean> | undefined;

  if (!ownerNumber) {
    return { sent: false, reason: "no_owner_number" };
  }
  if (!ownerAlerts?.[alertKey]) {
    return { sent: false, reason: "disabled" };
  }

  const to = normalizeToE164(ownerNumber);
  if (!to) {
    return { sent: false, reason: "invalid_owner_phone" };
  }

  await sendWhatsApp({ clinicId, to, text: message.trim() });
  return { sent: true };
}
