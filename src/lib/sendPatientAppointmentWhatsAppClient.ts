import { auth } from "@/lib/firebase";

/** Fire-and-forget patient automation for booking templates (`new` / `edit` / `cancel`) — see `/api/whatsapp/send-patient-message`. */
export async function sendPatientAppointmentWhatsApp(args: {
  template: "new" | "edit" | "cancel";
  patientId: string;
  date: string;
  time: string;
  doctor: string;
}): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;
  try {
    const idToken = await u.getIdToken();
    const res = await fetch("/api/whatsapp/send-patient-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        kind: "appointment",
        appointmentTemplate: args.template,
        patientId: args.patientId,
        date: args.date,
        time: args.time,
        doctor: args.doctor,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data?.skipped) {
      console.warn("Patient appointment WhatsApp:", data?.error || res.statusText);
    }
  } catch (e) {
    console.warn("Patient appointment WhatsApp:", e);
  }
}
