import { auth } from "@/lib/firebase";
import { handleWhatsAppApiResult } from "@/lib/whatsappManual";
import { getGlobalClinicId } from "@/lib/db-utils";

/** Fire-and-forget patient automation for booking templates (`new` / `edit` / `cancel`) — see `/api/whatsapp/send-patient-message`. */
export async function sendPatientAppointmentWhatsApp(args: {
  template: "new" | "edit" | "cancel";
  patientId: string;
  date: string;
  time: string;
  doctor: string;
  /** Only used to name the patient in the click-to-send prompt. */
  patientName?: string;
}): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;
  try {
    const idToken = await u.getIdToken();
    const res = await fetch("/api/whatsapp/send-patient-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        // The clinic the appointment was actually written to, not whichever one the server would
        // resolve as this user's default. For anyone who belongs to more than one clinic those are
        // different answers, and the mismatch meant the message was prepared for — and checked
        // against the settings of — a clinic nobody was looking at.
        clinicId: getGlobalClinicId(),
        kind: "appointment",
        appointmentTemplate: args.template,
        patientId: args.patientId,
        date: args.date,
        time: args.time,
        doctor: args.doctor,
      }),
    });
    const data = await res.json().catch(() => ({}));
    // No gateway configured, or the clinic sends by hand: the server returns the composed
    // message instead of an error, and this offers to open WhatsApp with it ready to send.
    if (res.ok) handleWhatsAppApiResult(data, args.patientName);
    if (!res.ok && !data?.skipped) {
      console.warn("Patient appointment WhatsApp:", data?.error || res.statusText);
    }
  } catch (e) {
    console.warn("Patient appointment WhatsApp:", e);
  }
}
