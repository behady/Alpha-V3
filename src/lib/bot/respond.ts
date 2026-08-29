import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { FieldValue } from "firebase-admin/firestore";
import { loadPublicClinicProfile } from "@/lib/publicBooking";
import { clinicDisplayName } from "@/lib/sms/events";
import { patientSendablePhone, phoneMatchKey, pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { resolveLidToPhone } from "@/lib/whatsapp";
import { findPatientByLid } from "@/lib/whatsappLid";
import { resolveWhatsappDeliveryMode, sendPatientWhatsAppAuto } from "@/lib/whatsappDelivery";
import { appendOptOutFooter, WHATSAPP_OPT_OUT_FOOTER_AR } from "@/lib/patientMessaging";
import {
  conversationKey,
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
  /**
   * Where the reply goes, verbatim: an E.164 phone, or the raw `...@lid` id WhatsApp used to hide
   * one. Separate from identity on purpose — since the lid rollout, "who do I answer" and "who is
   * this" stopped being the same question, and conflating them is why replies once composed fine
   * and then failed to dial.
   */
  chatId: string;
  /** The sender's phone when the payload revealed one; empty behind a lid. */
  phone?: string;
  text: string;
  /** Injectable so tests and the webhook agree on "now" rather than racing the clock. */
  now?: number;
}): Promise<BotOutcome> {
  const { clinicId, chatId, text } = args;
  const now = args.now ?? Date.now();

  const settings = await loadBotSettings(clinicId);
  if (!settings.enabled) return skip("bot_disabled");

  // A bot needs to be able to answer by itself. In manual delivery there is nobody at a screen at
  // the moment the patient writes — queueing a reply for someone to tap tomorrow is not a
  // conversation, it is a worse version of the message they already sent.
  const mode = await resolveWhatsappDeliveryMode(clinicId);
  if (mode !== "auto") return skip("no_gateway");

  // Behind a lid, identity comes from what the system has already learned: every outgoing
  // message binds its lid to its patient (lib/whatsappLid). The gateway's own resolver is asked
  // as a fallback — broken on their side today, fails fast and quietly, and starts contributing
  // the day they fix it with no change here.
  const isLidChat = /@lid$/i.test(chatId);
  let phone = args.phone || "";
  let patient: Awaited<ReturnType<typeof findPatient>> = null;
  if (!phone && isLidChat) {
    patient = await findPatientByLid(clinicId, chatId);
    if (patient) phone = patientSendablePhone(patient.data);
    if (!phone) phone = await resolveLidToPhone(clinicId, chatId);
  }
  if (!patient && phone) patient = await findPatient(clinicId, phone);

  /*
   * A still-anonymous sender may be introducing themselves.
   *
   * The gateway's own in-session autoresponder can deliver a prompt to a lid chat where our API
   * cannot, so the clinic's welcome message asks unknown senders for the phone number they are
   * registered under. When a message from an unbound lid IS a phone number that matches a
   * patient, that is the answer — the lid binds, and the greeting goes out to the number they
   * named, which is the address that actually delivers.
   *
   * Deliberately harmless to abuse: someone typing another person's number causes every reply —
   * greeting, and later booking details — to go to the REAL owner's phone, never back to the
   * claimant's chat. The claimant learns nothing and receives nothing. The binding source is
   * recorded so staff can always see which mappings were self-declared.
   */
  if (isLidChat && !phone && !patient) {
    const claimed = normalizeToE164AssumingCountry(text);
    if (claimed) {
      const claimedPatient = await findPatient(clinicId, claimed);
      if (claimedPatient) {
        await adminClinicDoc(clinicId, "patients", claimedPatient.id).update({
          whatsappLid: chatId,
          whatsappLidLearnedAt: FieldValue.serverTimestamp(),
          whatsappLidSource: "self_claimed",
        });
        patient = claimedPatient;
        phone = patientSendablePhone(claimedPatient.data);
      }
    }
  }

  /*
   * Where the reply must go. Sending to a lid is verified NOT to deliver — Wapilot's worker fails
   * it with a 422 after accepting it — so a lid sender the system cannot map to a phone cannot be
   * answered at all yet. Pretending otherwise would advance the conversation and burn the reply
   * budget on messages nobody receives, so the honest outcome is a handoff: the message lands in
   * front of a person, and the very next message the clinic sends this patient (a confirmation, a
   * receipt) teaches the mapping and unlocks the bot for them.
   */
  const replyTo = phone || chatId;
  if (isLidChat && !phone) {
    await markHandoff(clinicId, conversationKey(chatId), "lid_unidentified");
    return skip("lid_unidentified");
  }

  // A patient who asked to be left alone asked to be left alone. This is checked before the
  // engine, so no branch of it can ever talk to someone who opted out.
  if (patient?.data.whatsappOptOut === true) return skip("opted_out");

  if (!patient && !settings.answerStrangers) {
    // The cautious default. Answering unknown numbers means answering wrong numbers, spam and
    // anyone who ever saw the clinic's number — and every one of those is a stranger who did not
    // ask to be messaged, which is precisely the traffic that gets a number reported.
    //
    // Note what the lid rollout does to this switch: a sender hidden behind `@lid` cannot be
    // matched to their patient record, so with this off, the bot is silent for them too. That is
    // the safe direction to be wrong in — but it means clinics whose patients mostly appear as
    // lids will find the bot quiet until they enable answering unidentified senders.
    await markHandoff(clinicId, conversationKey(chatId), "unknown_number");
    return skip("unknown_number");
  }

  const conversation = await loadConversation(clinicId, chatId, now);

  // A stop request recorded against this sender directly — the only place it can live when a lid
  // hides the patient record. Survives conversation expiry; see markConversationOptedOut.
  if (conversation.optedOut) return skip("opted_out");

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
    await sendPatientWhatsAppAuto(clinicId, replyTo, body);
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
