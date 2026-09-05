import { adminClinicDoc } from "@/lib/adminClinicDb";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import {
  WHATSAPP_OPT_OUT_FOOTER_AR,
  WHATSAPP_OPT_OUT_FOOTER_BILINGUAL,
  appendOptOutFooter,
} from "@/lib/patientMessaging";
import { loadWapilotConfig } from "@/lib/wapilotConfig";
import {
  META_TEMPLATE_FOR_KIND,
  loadMetaWhatsappConfig,
  sendMetaTemplate,
  sendMetaWhatsappInteractive,
  sendMetaWhatsappText,
  type MetaInteractive,
} from "@/lib/metaWhatsapp";
import { sendWhatsApp } from "@/lib/whatsapp";
import { enqueueWhatsapp } from "@/lib/whatsapp/outbox";
import { recordThreadMessage } from "@/lib/bot/thread";

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
export async function sendPatientWhatsAppAuto(clinicId: string, to: string, text: string): Promise<string | undefined> {
  const meta = await loadMetaWhatsappConfig(clinicId);
  if (meta) {
    const result = await sendMetaWhatsappText({ config: meta, to, text });
    if (!result.ok) throw new Error(`Meta Cloud API failed: ${result.error || "unknown"}`);
    // Meta's id for the message: the handle its delivered/read/failed statuses arrive under.
    return result.messageId;
  }
  await sendWhatsApp({ clinicId, to, text });
  return undefined;
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
  /**
   * The values for this message's pre-approved Meta template, in template-parameter order.
   *
   * Business-initiated messages — the ones nobody asked for right now — only deliver on the
   * official channel as templates; free-form text is silently dropped outside the 24-hour
   * window. Callers that ARE business-initiated pass this; the message kind maps to its
   * registered template via META_TEMPLATE_FOR_KIND. Without it, a Meta-channel send falls back
   * to free-form text and takes its chances with the window.
   */
  metaTemplate?: { kind: string; params: string[] };
  /**
   * Who to credit in the patient's chat thread. Staff replies name the person; everything else
   * is recorded as the system with its message kind, so a receptionist scrolling the thread sees
   * "reminder" and "receipt" between the patient's messages rather than a gap.
   */
  thread?: { author: "staff"; uid?: string; name?: string; kind?: string };
}): Promise<WhatsappDeliveryResult> {
  const mode = await resolveWhatsappDeliveryMode(args.clinicId);

  /** Every patient message that actually left goes into the thread, whichever shape it took. */
  const remember = (waMessageId?: string, channel?: "meta" | "wapilot") =>
    args.audience === "patient"
      ? recordThreadMessage(args.clinicId, args.to, {
          direction: "out",
          author: args.thread?.author ?? "system",
          text: args.text,
          uid: args.thread?.uid,
          name: args.thread?.name,
          kind: args.thread ? args.thread.kind || "staff_reply" : args.queue?.type || args.metaTemplate?.kind || "message",
          waMessageId,
          // The chat screen decides from this whether free text can deliver — a conversation the
          // clinic opened has no inbound message to have learned it from.
          channel,
        }).catch(() => {})
      : Promise.resolve();

  // Added here, at the single point every WhatsApp message passes through, rather than in each
  // template: a footer that depends on the caller remembering it is a footer that is missing from
  // whichever sender gets written next — and the number is banned by the aggregate, not by the
  // one message someone remembered to mark.
  const text = args.audience === "patient" ? await applyPatientOptOutFooter(args.clinicId, args.text) : args.text;

  if (mode === "auto") {
    const meta = await loadMetaWhatsappConfig(args.clinicId);
    const tpl = args.metaTemplate ? META_TEMPLATE_FOR_KIND[args.metaTemplate.kind] : undefined;
    if (meta && tpl) {
      const result = await sendMetaTemplate({
        config: meta,
        to: args.to,
        templateName: tpl.name,
        params: args.metaTemplate!.params.slice(0, tpl.paramCount),
      });
      if (!result.ok) throw new Error(`Meta template failed: ${result.error || "unknown"}`);
      await remember(result.messageId, "meta");
      return { mode: "auto", sent: true };
    }
    const waMessageId = await sendPatientWhatsAppAuto(args.clinicId, args.to, text);
    await remember(waMessageId, meta ? "meta" : "wapilot");
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

/**
 * Send a message that is buttons/lists on the official API and numbered text elsewhere.
 *
 * `textFallback` is composed by the caller and MUST say the same thing the structure does — it is
 * what the Wapilot channel sends, what the log records, and what an interactive send falls back
 * to when Meta rejects the structure. Splitting content across two shapes with one meaning is the
 * caller's contract; this function only picks the richest shape the channel can render.
 */
export async function sendPatientWhatsAppRich(
  clinicId: string,
  to: string,
  textFallback: string,
  structure?: MetaInteractive
): Promise<string | undefined> {
  const meta = await loadMetaWhatsappConfig(clinicId);
  if (meta && structure) {
    const rich = await sendMetaWhatsappInteractive({ config: meta, to, message: structure });
    if (rich.ok) return rich.messageId;
    // A rejected structure (length rules, API drift) must degrade to words, not to silence.
    const plain = await sendMetaWhatsappText({ config: meta, to, text: textFallback });
    if (!plain.ok) throw new Error(`Meta Cloud API failed: ${plain.error || rich.error || "unknown"}`);
    return plain.messageId;
  }
  return sendPatientWhatsAppAuto(clinicId, to, textFallback);
}
