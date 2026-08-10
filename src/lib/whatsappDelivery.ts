import { adminClinicDoc } from "@/lib/adminClinicDb";
import { loadWapilotConfig } from "@/lib/wapilotConfig";
import { sendWhatsApp } from "@/lib/whatsapp";

/**
 * How a clinic's WhatsApp messages leave the building.
 *
 * `auto`   — the gateway sends them, unattended. Needs credentials, and carries the risk that
 *            comes with automating a WhatsApp account: the number can be restricted by Meta.
 * `manual` — the server prepares the message and hands the finished text back to the browser,
 *            which opens WhatsApp with it already typed. A person presses send.
 *
 * Manual exists because a large share of Egyptian clinics cannot use the official WhatsApp
 * Business API at all — it requires business verification documents that an informally-run clinic
 * does not have — and because the unofficial alternative puts the clinic's own number at risk.
 * Click-to-send has neither problem: nothing is automated, so nothing can be banned for
 * automation, there is no per-clinic gateway cost, and it works from the staff member's own
 * WhatsApp. The trade is that someone has to press the button, which for a clinic seeing ten
 * patients a day is ten taps.
 *
 * It is also the honest default. A clinic with no gateway configured previously got a failed send
 * and a console warning nobody read, so reminders silently never went out.
 */
export type WhatsappDeliveryMode = "auto" | "manual";

export type WhatsappDeliveryResult =
  | { mode: "auto"; sent: true }
  | { mode: "manual"; sent: false; phone: string; text: string };

/**
 * Manual when the clinic has explicitly chosen it, or when there is no gateway to send through.
 * Falling back to manual rather than failing is the point: the message still reaches the patient,
 * it just needs a tap.
 */
export async function resolveWhatsappDeliveryMode(clinicId: string): Promise<WhatsappDeliveryMode> {
  try {
    const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
    if (snap.exists && String(snap.data()?.deliveryMode || "") === "manual") return "manual";
  } catch {
    // A missing or unreadable settings doc is not a reason to fail a send; fall through to
    // deciding on whether credentials exist.
  }

  try {
    const config = await loadWapilotConfig(clinicId);
    return config.source === "none" ? "manual" : "auto";
  } catch {
    return "manual";
  }
}

/**
 * Sends through the gateway, or returns the composed message for a human to send.
 *
 * Callers must handle both outcomes. The message body, opt-out checks and template resolution all
 * happen before this is called, so a manual result carries exactly the text that would otherwise
 * have been sent — the patient receives the same message either way.
 */
export async function deliverWhatsAppMessage(args: {
  clinicId: string;
  to: string;
  text: string;
}): Promise<WhatsappDeliveryResult> {
  const mode = await resolveWhatsappDeliveryMode(args.clinicId);
  if (mode === "manual") {
    return { mode: "manual", sent: false, phone: args.to, text: args.text };
  }
  await sendWhatsApp({ clinicId: args.clinicId, to: args.to, text: args.text });
  return { mode: "auto", sent: true };
}
