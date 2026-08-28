import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { FieldValue } from "firebase-admin/firestore";
import { loadPublicClinicProfile } from "@/lib/publicBooking";
import { clinicDisplayName } from "@/lib/sms/events";
import { phoneMatchKey, pickPatientPhone } from "@/lib/patientPhone";
import { sendWhatsApp } from "@/lib/whatsapp";
import { resolveWhatsappDeliveryMode } from "@/lib/whatsappDelivery";
import { appendOptOutFooter, WHATSAPP_OPT_OUT_FOOTER_AR } from "@/lib/patientMessaging";
import {
  loadConversation,
  markHandoff,
  replyAllowance,
  saveConversation,
} from "./conversation";
import { decideBotReply, type BotContext } from "./engine";

/**
 * Answering a patient's WhatsApp message, if the clinic has asked for that.
 *
 * Every gate below is a reason NOT to speak, and they are checked before anything is composed.
 * That ordering is the point: this is the first thing in the system that talks to a patient
 * without a staff member having decided to, and the cost of it being wrong is not a bad reply —
 * it is the clinic's WhatsApp number being restricted, which takes every other message with it.
 *
 * Off unless switched on, per clinic. Nothing here runs for a clinic that has not opted in.
 */

export type BotOutcome =
  | { status: "replied"; text: string; handoff: boolean; reason: string }
  | { status: "handoff_only"; reason: string }
  | { status: "skipped"; reason: string };

const skip = (reason: string): BotOutcome => ({ status: "skipped", reason });

/** Clinic settings that govern the bot. All default to the cautious answer. */
interface BotSettings {
  enabled: boolean;
  /** Answer numbers with no patient record? Off by default — see below. */
  answerStrangers: boolean;
}

async function loadBotSettings(clinicId: string): Promise<BotSettings> {
  const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const d = snap.exists ? snap.data() || {} : {};
  return {
    enabled: d.botEnabled === true,
    answerStrangers: d.botAnswerStrangers === true,
  };
}

/** Opening hours as a patient would read them, from the clinic's own booking schedule. */
function formatHours(schedule: unknown): string {
  const days: Array<[string, string]> = [
    ["saturday", "السبت"],
    ["sunday", "الأحد"],
    ["monday", "الإثنين"],
    ["tuesday", "الثلاثاء"],
    ["wednesday", "الأربعاء"],
    ["thursday", "الخميس"],
    ["friday", "الجمعة"],
  ];
  const s = (schedule || {}) as Record<string, any>;
  const lines: string[] = [];
  for (const [key, label] of days) {
    const day = s[key];
    if (!day || day.closed === true || day.enabled === false) continue;
    const from = String(day.start || day.from || day.open || "").trim();
    const to = String(day.end || day.to || day.close || "").trim();
    if (!from || !to) continue;
    lines.push(`${label}: ${from} - ${to}`);
  }
  return lines.join("\n");
}

/** The patient behind this number, if the clinic knows them. */
async function findPatient(
  clinicId: string,
  phone: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const key = phoneMatchKey(phone);
  if (key.length < 7) return null;

  const digits = String(phone || "").replace(/\D/g, "");
  if (digits) {
    const direct = await adminClinicCollection(clinicId, "patients")
      .where("phone", "==", `+${digits}`)
      .limit(1)
      .get();
    if (!direct.empty) {
      const doc = direct.docs[0];
      return { id: doc.id, data: (doc.data() || {}) as Record<string, unknown> };
    }
  }

  const scan = await adminClinicCollection(clinicId, "patients").limit(3000).get();
  for (const doc of scan.docs) {
    const data = (doc.data() || {}) as Record<string, unknown>;
    if (phoneMatchKey(pickPatientPhone(data)) === key) return { id: doc.id, data };
  }
  return null;
}

export async function respondToPatientMessage(args: {
  clinicId: string;
  phone: string;
  text: string;
  /** Injectable so tests and the webhook agree on "now" rather than racing the clock. */
  now?: number;
}): Promise<BotOutcome> {
  const { clinicId, phone, text } = args;
  const now = args.now ?? Date.now();

  const settings = await loadBotSettings(clinicId);
  if (!settings.enabled) return skip("bot_disabled");

  // A bot needs to be able to answer by itself. In manual delivery there is nobody at a screen at
  // the moment the patient writes — queueing a reply for someone to tap tomorrow is not a
  // conversation, it is a worse version of the message they already sent.
  const mode = await resolveWhatsappDeliveryMode(clinicId);
  if (mode !== "auto") return skip("no_gateway");

  const patient = await findPatient(clinicId, phone);

  // A patient who asked to be left alone asked to be left alone. This is checked before the
  // engine, so no branch of it can ever talk to someone who opted out.
  if (patient?.data.whatsappOptOut === true) return skip("opted_out");

  if (!patient && !settings.answerStrangers) {
    // The cautious default. Answering unknown numbers means answering wrong numbers, spam and
    // anyone who ever saw the clinic's number — and every one of those is a stranger who did not
    // ask to be messaged, which is precisely the traffic that gets a number reported.
    await markHandoff(clinicId, phoneMatchKey(phone) || phone, "unknown_number");
    return skip("unknown_number");
  }

  const conversation = await loadConversation(clinicId, phone, now);

  const allowance = replyAllowance(conversation);
  if (!allowance.allowed) {
    await markHandoff(clinicId, conversation.phoneKey, allowance.reason || "limit");
    await saveConversation(
      clinicId,
      conversation,
      { state: "handed_off", replied: false, reason: allowance.reason || "limit" },
      now
    );
    return skip(allowance.reason || "limit");
  }

  const clinicName = await clinicDisplayName(clinicId);
  const ctx: BotContext = { clinicName };

  let canOfferBooking = false;
  try {
    const profile = await loadPublicClinicProfile(clinicId);
    ctx.hoursText = formatHours(profile.schedule);
    canOfferBooking = true;
  } catch {
    // Online booking switched off, or no schedule configured. The menu simply offers the
    // receptionist instead of hours it would have to invent.
  }
  ctx.canOfferBooking = canOfferBooking;
  if (patient && typeof patient.data.name === "string") ctx.patientName = patient.data.name;

  const decision = decideBotReply({ state: conversation.state, text, ctx });

  if (decision.handoff) {
    await markHandoff(clinicId, conversation.phoneKey, decision.reason);
  }

  if (!decision.reply.trim()) {
    await saveConversation(
      clinicId,
      conversation,
      {
        state: decision.next,
        replied: false,
        reason: decision.reason,
        patientId: patient?.id,
        patientName: ctx.patientName,
      },
      now
    );
    return decision.handoff ? { status: "handoff_only", reason: decision.reason } : skip(decision.reason);
  }

  // The stop line goes on the opening turn only. The patient started this conversation, so
  // repeating "reply STOP" on every answer reads as a machine that expects to be told to go away.
  const body =
    conversation.state === "new"
      ? appendOptOutFooter(decision.reply, WHATSAPP_OPT_OUT_FOOTER_AR)
      : decision.reply;

  try {
    await sendWhatsApp({ clinicId, to: phone, text: body });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("[bot] reply failed to send:", detail);
    await adminClinicCollection(clinicId, "whatsapp_inbound_debug").add({
      reason: "bot_send_failed",
      raw: detail.slice(0, 2000),
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    // Not recorded as a reply: a send that failed did not use up the number's budget, and the
    // conversation must not advance past a turn the patient never saw.
    return skip("send_failed");
  }

  await adminClinicCollection(clinicId, "whatsapp_logs").add({
    patientId: patient?.id || null,
    type: `bot_${decision.reason}`,
    message: body,
    status: "success",
    createdAt: FieldValue.serverTimestamp(),
  });

  await saveConversation(
    clinicId,
    conversation,
    {
      state: decision.next,
      replied: true,
      reason: decision.reason,
      patientId: patient?.id,
      patientName: ctx.patientName,
    },
    now
  );

  return { status: "replied", text: body, handoff: decision.handoff, reason: decision.reason };
}
