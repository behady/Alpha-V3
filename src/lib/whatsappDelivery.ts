import { adminClinicDoc } from "@/lib/adminClinicDb";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { loadWapilotConfig } from "@/lib/wapilotConfig";
import { sendWhatsApp } from "@/lib/whatsapp";
import { enqueueWhatsapp } from "@/lib/whatsapp/outbox";

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
  | { mode: "queued"; sent: false }
  | { mode: "manual"; sent: false; phone: string; text: string };

/**
 * Can the server send this itself, unattended?
 *
 * Deliberately still two-valued. A dozen call sites read this as "manual means hand it back to the
 * browser", and quietly adding a third value would have each of them fall through to the gateway
 * and fail. Queueing to the clinic's phone is a property of *delivering* a patient message, not of
 * this question, so it lives in `deliverWhatsAppMessage` below.
 *
 * Unattended sending is a paid feature. It needs gateway credentials, which cost money and carry
 * the risk that Meta restricts the number, so it sits behind `whatsappIntegration` on the clinic's
 * plan. Everything else falls back to a human pressing send, which is free and cannot be banned.
 */
export async function resolveWhatsappDeliveryMode(clinicId: string): Promise<WhatsappDeliveryMode> {
  try {
    const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
    if (snap.exists && String(snap.data()?.deliveryMode || "") === "manual") return "manual";
  } catch {
    // A missing or unreadable settings doc is not a reason to fail a send; fall through to
    // deciding on whether credentials exist.
  }

  // Checked before the credentials, because a clinic that has downgraded may still have a working
  // gateway configured and must stop using it.
  if (!(await clinicHasFeature(clinicId, "whatsappIntegration"))) return "manual";

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
  /**
   * Supply this for messages that are worth queueing when there is no gateway: the ones aimed at
   * a patient, which a staff member can work through later. Omitting it keeps the old behaviour of
   * handing the text straight back to the browser — right for anything the sender is watching
   * happen, like an owner alert or a lab order.
   */
  queue?: {
    key: string;
    type: string;
    patientId?: string;
    patientName?: string;
    appointmentId?: string;
  };
}): Promise<WhatsappDeliveryResult> {
  const mode = await resolveWhatsappDeliveryMode(args.clinicId);

  if (mode === "auto") {
    await sendWhatsApp({ clinicId: args.clinicId, to: args.to, text: args.text });
    return { mode: "auto", sent: true };
  }

  // No gateway. If this message can wait for a person, put it in the clinic's list rather than
  // dropping it — that list is the whole reason the nightly reminders now reach anyone at all.
  if (args.queue) {
    await enqueueWhatsapp(args.clinicId, args.queue.key, {
      to: args.to,
      text: args.text,
      type: args.queue.type,
      patientId: args.queue.patientId,
      patientName: args.queue.patientName,
      appointmentId: args.queue.appointmentId,
    });
    return { mode: "queued", sent: false };
  }

  return { mode: "manual", sent: false, phone: args.to, text: args.text };
}
