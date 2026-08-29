import { adminClinicDoc } from "@/lib/adminClinicDb";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import {
  WHATSAPP_OPT_OUT_FOOTER_AR,
  WHATSAPP_OPT_OUT_FOOTER_BILINGUAL,
  appendOptOutFooter,
} from "@/lib/patientMessaging";
import { loadWapilotConfig } from "@/lib/wapilotConfig";
import { loadMetaWhatsappConfig, sendMetaWhatsappText } from "@/lib/metaWhatsapp";
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
  // The official Cloud API wins outright. It is Meta-hosted, cannot drop a session, and does not
  // sit behind the whatsappIntegration plan gate the way the Wapilot path does — a clinic that has
  // connected an official number is auto, full stop, whatever else is configured.
  try {
    if (await loadMetaWhatsappConfig(clinicId)) return "auto";
  } catch {
    /* fall through to the Wapilot decision */
  }

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
 * Send one already-composed patient message through whichever channel the clinic runs on.
 *
 * The single place the Meta-vs-Wapilot choice is made for an unattended send, so no caller has to
 * know which gateway a clinic is on. Meta first, because a clinic that has both configured during
 * a migration wants the drop-proof one. Throws on failure exactly as `sendWhatsApp` did, so the
 * callers' existing try/catch (which records a failed log row) keeps working unchanged.
 */
export async function sendPatientWhatsAppAuto(clinicId: string, to: string, text: string): Promise<void> {
  const meta = await loadMetaWhatsappConfig(clinicId);
  if (meta) {
    const result = await sendMetaWhatsappText({ config: meta, to, text });
    if (!result.ok) throw new Error(`Meta Cloud API failed: ${result.error || "unknown"}`);
    return;
  }
  await sendWhatsApp({ clinicId, to, text });
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
   * Who is being written to.
   *
   * Required rather than defaulted, so that adding a new sender forces the question to be
   * answered. `patient` gets the opt-out footer; `staff` — owner alerts, lab orders, the clinic
   * messaging itself — never does, because telling an owner they may reply STOP to their own
   * alerts is nonsense, and because those numbers are not the ones at risk of being reported.
   */
  audience: "patient" | "staff";
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

  // Added here, at the single point every WhatsApp message passes through, rather than in each
  // template: a footer that depends on the caller remembering it is a footer that is missing from
  // whichever sender gets written next — and the number is banned by the aggregate, not by the
  // one message someone remembered to mark.
  const text = args.audience === "patient" ? await applyPatientOptOutFooter(args.clinicId, args.text) : args.text;

  if (mode === "auto") {
    await sendPatientWhatsAppAuto(args.clinicId, args.to, text);
    return { mode: "auto", sent: true };
  }

  // No gateway. If this message can wait for a person, put it in the clinic's list rather than
  // dropping it — that list is the whole reason the nightly reminders now reach anyone at all.
  if (args.queue) {
    await enqueueWhatsapp(args.clinicId, args.queue.key, {
      to: args.to,
      text,
      type: args.queue.type,
      patientId: args.queue.patientId,
      patientName: args.queue.patientName,
      appointmentId: args.queue.appointmentId,
    });
    return { mode: "queued", sent: false };
  }

  return { mode: "manual", sent: false, phone: args.to, text };
}

/**
 * The clinic's opt-out line, in the language its templates are written in.
 *
 * Reads the settings document rather than taking a parameter, for the same reason the footer is
 * applied here at all: every sender would otherwise have to pass it, and one that forgets removes
 * the protection silently. A settings read that fails leaves the footer ON — the failure mode
 * that costs a line of text, not the one that costs the number.
 *
 * Exported for the assistant's staged messages, which show the body on a confirmation card before
 * anyone approves it: the footer has to be on the text being previewed, or the card would promise
 * one thing and the patient receive another. Appending twice is harmless — see appendOptOutFooter.
 */
export async function applyPatientOptOutFooter(clinicId: string, text: string): Promise<string> {
  let arabicOnly = false;
  try {
    const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
    const data = snap.exists ? snap.data() : undefined;
    if (data?.optOutFooterEnabled === false) return text;
    arabicOnly = data?.templatePack === "arabic";
  } catch {
    // Fall through with the footer on. See above.
  }
  return appendOptOutFooter(text, arabicOnly ? WHATSAPP_OPT_OUT_FOOTER_AR : WHATSAPP_OPT_OUT_FOOTER_BILINGUAL);
}
