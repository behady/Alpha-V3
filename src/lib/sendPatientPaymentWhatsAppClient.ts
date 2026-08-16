import { auth } from "@/lib/firebase";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";
import { getGlobalClinicId } from "@/lib/db-utils";

/** Patient receipt after a payment is posted (`invoice` template). */
export async function sendPatientPaymentWhatsApp(args: {
  patientId: string;
  ledgerId: string;
  /** Only used to name the patient in the click-to-send prompt. */
  patientName?: string;
}): Promise<{ sent: boolean; skipped?: string; error?: string; manual?: boolean }> {
  const u = auth.currentUser;
  if (!u) return { sent: false, skipped: "not_signed_in" };
  try {
    const idToken = await u.getIdToken();
    const res = await fetch("/api/whatsapp/send-patient-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        // See the appointment client: the clinic on screen, never the caller's default.
        clinicId: getGlobalClinicId(),
        kind: "invoice",
        patientId: args.patientId,
        ledgerId: args.ledgerId,
        automation: true,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      skipped?: boolean;
      reason?: string;
      error?: string;
      manual?: boolean;
    };
    // No gateway configured, or the clinic sends by hand: offer to open WhatsApp with the
    // message already written rather than reporting a failure nobody can act on.
    if (res.ok && data.manual) {
      handleWhatsAppApiResult(data, args.patientName);
      return { sent: false, manual: true };
    }
    if (res.ok && data.ok && !data.skipped) return { sent: true };
    if (data.skipped) return { sent: false, skipped: data.reason || "skipped" };
    const err = typeof data.error === "string" ? data.error : res.statusText;
    console.warn("Patient payment WhatsApp:", err);
    return { sent: false, error: err };
  } catch (e) {
    const err = e instanceof Error ? e.message : "Send failed";
    console.warn("Patient payment WhatsApp:", err);
    return { sent: false, error: err };
  }
}
