import { adminDb } from "@/lib/firebaseAdmin";
import { normalizeToE164, sendWhatsApp } from "@/lib/whatsapp";
import type { OwnerAlertKey } from "@/types/whatsapp";
import { WHATSAPP_SETTINGS_DOC_REF } from "@/types/whatsapp";

export type OwnerAlertSendResult =
  | { sent: true }
  | { sent: false; reason: "no_settings" | "no_owner_number" | "disabled" | "invalid_owner_phone" };

/**
 * Sends a WhatsApp to `ownerNumber` when `ownerAlerts[alertKey]` is true (Settings → WhatsApp).
 */
export async function sendOwnerWhatsAppAlertIfEnabled(
  alertKey: OwnerAlertKey,
  message: string
): Promise<OwnerAlertSendResult> {
  const snap = await adminDb()
    .collection(WHATSAPP_SETTINGS_DOC_REF.collection)
    .doc(WHATSAPP_SETTINGS_DOC_REF.docId)
    .get();

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

  await sendWhatsApp({ to, text: message.trim() });
  return { sent: true };
}
