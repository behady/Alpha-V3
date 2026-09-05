import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { FieldValue } from "firebase-admin/firestore";
import {
  computeAvailableSlots,
  createPatientBooking,
  movePatientBooking,
  loadPublicClinicProfile,
  type PublicClinicProfile,
} from "@/lib/publicBooking";
import type { ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { normalizeDateKey } from "@/lib/appointmentTime";
import { clinicNow } from "@/lib/publicBooking";
import { sendClinicPush } from "@/lib/push";
import { clinicDisplayName } from "@/lib/sms/events";
import { patientSendablePhone, phoneMatchKey, pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { resolveLidToPhone } from "@/lib/whatsapp";
import { findPatientByLid } from "@/lib/whatsappLid";
import { resolveWhatsappDeliveryMode, sendPatientWhatsAppRich } from "@/lib/whatsappDelivery";
import type { MetaInteractive } from "@/lib/metaWhatsapp";
import type { BotFacts } from "@/types/whatsapp";
import { arabicClock, arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import { appendOptOutFooter, normalizeReplyText, WHATSAPP_OPT_OUT_FOOTER_AR } from "@/lib/patientMessaging";
import {
  conversationKey,
  loadConversation,
  markHandoff,
  replyAllowance,
  saveConversation,
  type HandoffSeverity,
} from "./conversation";
import { answerWithAi, type AiPatientContext, type AiThreadLine } from "./aiReply";
import { SALES_CLOSE_REASONS, LEAD_INTEREST_REASONS, activeOffers, closingLine, offerForService } from "./sales";
import { markBotLeadBooked, upsertBotLead } from "./botLeads";
import { recordThreadMessage } from "./thread";
import { clinicalReplyText, decideBotReply, type BotContext } from "./engine";
import { needsHuman } from "./clinicalTriage";
import { mentionsRelative } from "./quickAnswers";
import { parseDayWord } from "./dayWords";
import { guessGender, voiceFor } from "@/lib/arabicNames";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

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
  /** Write bot bookings as Confirmed instead of leaving them for the desk to review. */
  autoConfirm: boolean;
  /** Let the model answer free text the buttons could not. Off by default; costs credits. */
  aiEnabled: boolean;
  /** The clinic's own answers to the questions its data cannot supply. */
  facts: BotFacts;
  /** The model leads the conversation (sales mode) instead of answering last. */
  aiFirst: boolean;
  /** AI replies per conversation; 0 means no cap. */
  aiMaxReplies: number;
  /** The owner's coaching notes for the model. */
  coaching: string;
}

async function loadBotSettings(clinicId: string): Promise<BotSettings> {
  const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const d = snap.exists ? snap.data() || {} : {};
  return {
    enabled: d.botEnabled === true,
    answerStrangers: d.botAnswerStrangers === true,
    autoConfirm: d.botAutoConfirmBookings === true,
    aiEnabled: d.botAiEnabled === true || d.botMode === "ai_first",
    facts: (d.botFacts && typeof d.botFacts === "object" ? d.botFacts : {}) as BotFacts,
    aiFirst: d.botMode === "ai_first",
    aiMaxReplies:
      typeof d.botAiMaxReplies === "number" && d.botAiMaxReplies >= 0 ? Math.floor(d.botAiMaxReplies) : d.botMode === "ai_first" ? 0 : 3,
    coaching: typeof d.botCoaching === "string" ? d.botCoaching : "",
  };
}

const ARABIC_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Opening hours as a patient would read them.
 *
 * Empty when the clinic never configured its schedule — parseClinicSchedule falls back to
 * 9:00-21:00 seven days a week for anything unset, and repeating that fallback to a patient is
 * inventing hours, which is worse than admitting a person will answer.
 */
function formatHours(schedule: ClinicScheduleConfig): string {
  if (!schedule.isConfigured) return "";
  const lines = [
    `من ${arabicClock(schedule.startHour, schedule.startMinute)} إلى ${arabicClock(schedule.endHour, schedule.endMinute)}`,
  ];
  const off = schedule.offDays.map((d) => ARABIC_DAYS[DAY_KEYS.indexOf(d)]).filter(Boolean);
  if (off.length) lines.push(`الإجازة: ${off.join(" و")}`);
  return lines.join("\n");
}



/**
 * The clinic's next open days, from today, as YYYY-MM-DD keys.
 *
 * Schedule-only — no slot query per day. Whether a listed day still has free times is answered
 * when the patient picks it, which costs one read for the day they want instead of six for days
 * they never will.
 */
function upcomingOpenDays(schedule: ClinicScheduleConfig, count = 6, horizonDays = 14): string[] {
  const out: string[] = [];
  // From the clinic's own today, not the server's: past 9pm Cairo the UTC date is still
  // yesterday, and "today" in a day list must mean the day the patient is living in.
  const d = new Date(`${clinicNow().dateKey}T12:00:00`);
  for (let i = 0; i < horizonDays && out.length < count; i++) {
    const key = normalizeDateKey(d.toISOString().split("T")[0]);
    if (!schedule.offDays.includes(DAY_KEYS[new Date(`${key}T12:00:00`).getDay()])) out.push(key);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function renderDayList(days: string[]): string {
  const lines = ["📅 اختار اليوم اللي يناسبك:", ""];
  days.forEach((day, i) => lines.push(`*${i + 1}* — ${arabicDayLabel(day)}`));
  lines.push("", "*0* — رجوع للقائمة");
  return lines.join("\n");
}

function renderTimeList(dateKey: string, times: string[]): string {
  const lines = [`⏰ المواعيد المتاحة يوم ${arabicDayLabel(dateKey)}:`, ""];
  times.forEach((t, i) => lines.push(`*${i + 1}* — ${arabicTimeLabel(t)}`));
  lines.push("", "*0* — رجوع لاختيار اليوم");
  return lines.join("\n");
}

const RELIST_PREFIX = "معلش مفهمتش 🙏 ابعت رقم من الاختيارات دي:\n\n";

/** The main menu as WhatsApp reply buttons. Ids are the digits the engine already understands. */
function menuButtons(canOfferBooking: boolean): MetaInteractive["buttons"] {
  return [
    { id: "m1", title: canOfferBooking ? "حجز موعد 🦷" : "الحجز مع الاستقبال" },
    { id: "m2", title: "مواعيد العمل 🕐" },
    { id: "m3", title: "الاستقبال 💬" },
  ];
}

/**
 * A day/time list as a WhatsApp list message, with a walk-back row.
 *
 * Row ids carry the option's full meaning (see parseTapId), so a tap on a week-old list still
 * does exactly what its label says instead of being read against whatever step is current.
 */
function optionList(
  buttonLabel: string,
  options: string[],
  labeler: (v: string) => string,
  idFor: (v: string) => string,
  back: { id: string; title: string }
): MetaInteractive["list"] {
  return {
    buttonLabel,
    rows: [
      ...options.slice(0, 9).map((v) => ({ id: idFor(v), title: labeler(v) })),
      back,
    ],
  };
}

/**
 * The patient's next appointment from today onwards, or null.
 *
 * The bot could write an appointment and never read one — not even the one it had just created —
 * so "ميعادي امتى" was handed to a receptionist to answer from the same database the bot was
 * already connected to. Cancelled and no-show rows are skipped: telling someone their cancelled
 * appointment is still on is worse than telling them nothing.
 */
async function findNextAppointment(
  clinicId: string,
  patientId: string
): Promise<{ id: string; date: string; time: string; doctor: string; status: string } | null> {
  const today = clinicNow().dateKey;
  const snap = await adminClinicCollection(clinicId, "appointments")
    .where("patientId", "==", patientId)
    .get();

  const upcoming = snap.docs
    .map((d) => {
      const a = (d.data() || {}) as Record<string, unknown>;
      return {
        id: d.id,
        date: String(a.date || ""),
        time: String(a.time || ""),
        doctor: String(a.doctor || ""),
        status: String(a.status || ""),
      };
    })
    .filter((a) => a.date >= today && !/cancel|no.?show/i.test(a.status))
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));

  return upcoming[0] ?? null;
}

/** How an appointment reads in a chat message. */
function appointmentLine(a: { date: string; time: string; doctor: string }): string {
  const parts = [`📅 ${arabicDayLabel(a.date)}`, `⏰ ${arabicTimeLabel(a.time)}`];
  if (a.doctor && a.doctor.toLowerCase() !== "any") parts.push(`👨‍⚕️ ${a.doctor}`);
  return parts.join("\n");
}

/**
 * Is the clinic open at this exact moment, in Cairo?
 *
 * The assistant had the opening hours and no clock, so asked "are you open now" it recited
 * "3pm to 11pm" in a confident voice — at 1pm, and on the Friday it is closed.
 */
function openRightNow(schedule: ClinicScheduleConfig): { open: boolean; opensLaterToday: boolean } {
  const now = clinicNow();
  const closedToday = schedule.offDays.includes(DAY_KEYS[new Date(`${now.dateKey}T12:00:00`).getDay()]);
  if (closedToday) return { open: false, opensLaterToday: false };
  const start = schedule.startHour * 60 + schedule.startMinute;
  const end = schedule.endHour * 60 + schedule.endMinute;
  return { open: now.minutes >= start && now.minutes < end, opensLaterToday: now.minutes < start };
}

/**
 * When the clinic next opens, for a patient writing while it is shut.
 *
 * "Someone will contact you" at 1am is a promise with no time on it. The bot has the schedule;
 * the honest version names the hour. Today counts only if opening time has not passed yet.
 */
function nextOpening(schedule: ClinicScheduleConfig): { dateKey: string; clock: string } | null {
  const now = clinicNow();
  const start = schedule.startHour * 60 + schedule.startMinute;
  const d = new Date(`${now.dateKey}T12:00:00`);
  for (let i = 0; i < 8; i++) {
    const key = d.toISOString().slice(0, 10);
    const off = schedule.offDays.includes(DAY_KEYS[new Date(`${key}T12:00:00`).getDay()]);
    if (!off && (i > 0 || now.minutes < start)) {
      return { dateKey: key, clock: arabicClock(schedule.startHour, schedule.startMinute) };
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function closedNote(schedule: ClinicScheduleConfig): string {
  const n = nextOpening(schedule);
  if (!n) return "العيادة مقفولة دلوقتي، وهنرد على حضرتك أول ما نفتح 🙏";
  const today = clinicNow().dateKey;
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const when =
    n.dateKey === today ? "النهارده" : n.dateKey === tomorrow.toISOString().slice(0, 10) ? "بكره" : arabicDayLabel(n.dateKey);
  return `العيادة مقفولة دلوقتي — بنفتح ${when} الساعة ${n.clock}، وهنرد على حضرتك ساعتها 🙏`;
}

/**
 * The service a patient named, matched against the clinic's own list.
 *
 * "عايز احجز تنظيف" landed on the calendar as "Consultation": the one word the patient volunteered
 * was the one word the desk did not get. Longest full-name match first; failing that, the first
 * word of a service name (≥ 3 letters) appearing in the message, so "تنظيف" finds "تنظيف الجير".
 */
async function matchService(clinicId: string, text: string): Promise<string> {
  // With and without the definite article: "التبييض بكام" must find "تبييض الأسنان".
  const t0 = ` ${normalizeReplyText(text)} `;
  const t = `${t0}${t0.replace(/ ال(?=\S{2,})/g, " ")}`;
  if (t0.trim().length < 3) return "";
  try {
    const snap = await adminClinicCollection(clinicId, "services").limit(200).get();
    const names = snap.docs.map((d) => String((d.data() || {}).name || "").trim()).filter(Boolean);
    let best = "";
    for (const name of names) {
      const n = normalizeReplyText(name);
      if (n.length >= 3 && t.includes(` ${n} `) && n.length > normalizeReplyText(best).length) best = name;
    }
    if (best) return best;
    for (const name of names) {
      const first = normalizeReplyText(name).split(" ")[0] || "";
      if (first.length >= 3 && t.includes(` ${first} `)) return name;
    }
  } catch {
    /* no services, no match */
  }
  return "";
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
  /**
   * Set when the message carried a photo, voice note, video or document.
   *
   * The assistant cannot read any of it, and that is the point: an uncaptioned photo is the one
   * message shape where "I don't understand" and "this needs a person" are the same sentence.
   */
  media?: "image" | "video" | "audio" | "document" | "sticker" | "location" | "contacts";
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
  if (patient?.data.whatsappOptOut === true) {
    // Opt-out means no automated messages TO them. It does not mean a swollen face goes unseen:
    // a person is still told, the bot just does not answer.
    if (needsHuman(text)) {
      await markHandoff(clinicId, conversationKey(chatId), "opted_out_urgent", {
        text, phone, patientId: patient.id, patientName: String(patient.data.name || ""), severity: "urgent",
      });
      void sendClinicPush(clinicId, { title: "⚠️ مريض (موقف الرسايل) محتاج رد فوري", body: `${String(patient.data.name || phone)} — ${text.slice(0, 90)}` }, { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { patientId: patient.id } });
    }
    return skip("opted_out");
  }

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
  if (conversation.optedOut) {
    if (needsHuman(text)) {
      await markHandoff(clinicId, conversation.phoneKey, "opted_out_urgent", { text, phone, severity: "urgent" });
      void sendClinicPush(clinicId, { title: "⚠️ مريض (موقف الرسايل) محتاج رد فوري", body: `${phone} — ${text.slice(0, 90)}` }, { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } });
    }
    return skip("opted_out");
  }

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
  // Offers carry their own end date; past it the sentence disappears from every reply at once.
  const offersActive = activeOffers(settings.facts, clinicNow().dateKey);
  const ctx: BotContext = { clinicName, facts: { ...settings.facts, offers: offersActive } };
  ctx.offersExpired = Boolean(settings.facts.offers?.trim()) && !offersActive;

  let profile: PublicClinicProfile | null = null;
  try {
    // requireEnabled false: the assistant has its own opt-in and only answers people who wrote
    // first — tying it to the public-page switch would silently disable booking for every clinic
    // that never wanted a public booking page.
    profile = await loadPublicClinicProfile(clinicId, { requireEnabled: false, loadDoctors: true });
    ctx.hoursText = formatHours(profile.schedule);
    // Both of these were declared on the context and never assigned: the menu promised "hours and
    // address" and printed hours alone, and the emergency reply told patients to ring a number it
    // did not include. The data has been sitting in clinic_info the whole time.
    ctx.addressText = profile.address;
    ctx.clinicPhone = profile.phone;
  } catch {
    // No clinic_info at all. The menu offers the receptionist instead of inventing anything.
  }
  // Booking needs a configured schedule (never offer times from the 9-to-9 fallback) and an
  // identified patient (a booking must belong to somebody). A real phone with nobody on file is
  // a NEW patient: the bot may ask their name and create the record, exactly as the public
  // booking page does for strangers — a lid sender with no phone can register nothing.
  ctx.canOfferBooking = Boolean(profile?.schedule.isConfigured && patient);
  ctx.canRegister = Boolean(profile?.schedule.isConfigured && !patient && phone);
  ctx.doctorCount = profile?.doctors.length ?? 0;
  if (patient && typeof patient.data.name === "string") ctx.patientName = patient.data.name;
  ctx.gender = guessGender(ctx.patientName);
  ctx.dayWord = parseDayWord(text, clinicNow().dateKey) || undefined;
  ctx.relative = mentionsRelative(text);
  ctx.forRelative = conversation.pendingForRelative === true;
  ctx.serviceMatch = (await matchService(clinicId, text)) || undefined;
  ctx.aiAvailable = settings.aiEnabled && (settings.aiMaxReplies === 0 || (conversation.aiReplies ?? 0) < settings.aiMaxReplies);
  ctx.aiFirst = settings.aiFirst;
  if (conversation.state === "booking_doctor") ctx.optionCount = conversation.pendingDoctors?.length ?? 0;
  if (conversation.state === "booking_day") ctx.optionCount = conversation.pendingDays?.length ?? 0;
  if (conversation.state === "booking_time") ctx.optionCount = conversation.pendingTimes?.length ?? 0;

  /*
   * A photo, a voice note, a video: acknowledged and handed straight to a person.
   *
   * Stickers and reactions are the exception — they are punctuation, not a message, and answering
   * every thumbs-up sticker with "someone will look at this" is how a helpful bot becomes noise.
   * Everything else gets a person, because the clinic cannot know what it did not see, and the
   * worst thing this branch can do is be slightly over-eager on a photo of a parking spot.
   */
  const decision =
    args.media && args.media !== "sticker" && !text.trim()
      ? {
          reply:
            args.media === "audio"
              ? "وصلتنا الرسالة الصوتية 🎙️ حد من العيادة هيسمعها ويرد عليك حالاً."
              : "وصلتنا الصورة 📷 حد من العيادة هيشوفها ويرد عليك حالاً.\n\nلو الموضوع طارئ كلمنا على طول." +
                (ctx.clinicPhone ? ` على ${ctx.clinicPhone}` : ""),
          next: "handed_off" as const,
          handoff: true,
          reason: `media_${args.media}`,
        }
      : decideBotReply({ state: conversation.state, text, ctx });

  /*
   * Perform whatever data work the engine asked for and compose the visible text. The engine
   * stays pure; this block is the only place booking options are fetched, and the options the
   * patient will answer against are stored on the conversation in the same save as the reply —
   * a list sent without its stored copy is a question whose answer cannot be understood.
   */
  let replyText = decision.reply;
  let nextState = decision.next;
  let reason = decision.reason;
  let handoff = decision.handoff;
  let pending: { days?: string[]; times?: string[]; date?: string; doctors?: string[]; doctor?: string; treatment?: string; forRelative?: boolean; dayWord?: string; reschedule?: string } | undefined;
  // The appointment being moved, if the patient is mid-reschedule. Rides on every list step.
  let rescheduleId = conversation.pendingReschedule || "";
  let aiExchange: { q: string; a: string } | undefined;
  let aiInterest = "";
  /** Buttons/lists for the official channel; the text above is what every other channel sends. */
  let structure: MetaInteractive | undefined;

  if (decision.action && profile) {
    const act = decision.action;
    const branchId = profile.branches.length === 1 ? profile.branches[0].id : null;

    const ANY_DOCTOR = "أي دكتور 👌";
    // Named at the start of the booking, carried through every step, written on the appointment.
    // The service named now, earlier in this booking, or earlier in the chat (the model's read).
    const treatment = conversation.pendingTreatment || ctx.serviceMatch || conversation.lastInterest || "";
    const v = voiceFor(ctx.gender ?? "unknown");

    const listDoctors = () => {
      // The stored list carries "" last, meaning "any chair" — the same convention the ids use.
      const doctors = [...profile!.doctors, ""];
      const label = (d: string) => (d ? d : ANY_DOCTOR);
      replyText = [
        "👨‍⚕️ تحب تحجز مع مين؟",
        "",
        ...doctors.map((d, i) => `*${i + 1}* — ${label(d)}`),
        "",
        "*0* — رجوع للقائمة",
      ].join("\n");
      structure = {
        body: "👨‍⚕️ تحب تحجز مع مين؟",
        list: optionList("اختيار الدكتور", doctors, label, (d) => `dr|${d}`, { id: "back_menu", title: "رجوع للقائمة" }),
      };
      nextState = "booking_doctor";
      // A day named before the dentist question waits here for the answer.
      pending = { doctors, treatment, dayWord: ctx.dayWord ?? conversation.pendingDayWord };
    };

    const listDays = (doctorName = "") => {
      const days = upcomingOpenDays(profile!.schedule);
      if (!days.length) {
        replyText = "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت لتحديد الميعاد.";
        nextState = "handed_off";
        handoff = true;
        reason = "no_open_days";
        return;
      }
      const heading = doctorName ? `📅 اختار اليوم اللي يناسبك مع ${doctorName}:` : "📅 اختار اليوم اللي يناسبك:";
      replyText = renderDayList(days);
      structure = {
        body: heading,
        // The chosen dentist rides inside every day id, so even a stale tap keeps its doctor.
        list: optionList("اختيار اليوم", days, arabicDayLabel, (d) => `d${d}|${doctorName}`, { id: "back_menu", title: "رجوع للقائمة" }),
      };
      nextState = "booking_day";
      pending = { days, doctor: doctorName, treatment };
    };

    const listTimes = async (dateKey: string, doctorName = "") => {
      const slots = await computeAvailableSlots({ clinicId, dateKey, doctorName: doctorName || null, branchId, profile: profile! });
      if (!slots.length) {
        const days = conversation.pendingDays?.length ? conversation.pendingDays : upcomingOpenDays(profile!.schedule);
        replyText = `اليوم ده كل مواعيده اتحجزت 🙏\n\n${renderDayList(days)}`;
        structure = {
          body: "اليوم ده كل مواعيده اتحجزت 🙏 اختار يوم تاني:",
          list: optionList("اختيار اليوم", days, arabicDayLabel, (d) => `d${d}|${doctorName}`, { id: "back_menu", title: "رجوع للقائمة" }),
        };
        nextState = "booking_day";
        reason = "booking_day_full";
        pending = { days, doctor: doctorName, treatment };
        return;
      }
      const times = slots.slice(0, 8);
      replyText = renderTimeList(dateKey, times);
      structure = {
        body: `⏰ المواعيد المتاحة يوم ${arabicDayLabel(dateKey)}:`,
        list: optionList("اختيار الميعاد", times, arabicTimeLabel, (t) => `t${dateKey}|${t}|${doctorName}`, { id: "back_days", title: "رجوع لاختيار اليوم" }),
      };
      nextState = "booking_time";
      // Reached from a dentist pick too, whose own reason says "days"; the log should say what was sent.
      reason = "booking_times";
      pending = { days: conversation.pendingDays, times, date: dateKey, doctor: doctorName, treatment };
    };

    if (act.type === "ack") {
      /*
       * "تمام" is, overwhelmingly, a patient answering the clinic's own reminder. It used to get the
       * full booking menu. Now, if there is an appointment in the next two days that the desk has
       * not confirmed, this reply confirms it — which is exactly what the patient meant — and says
       * so. With nothing to confirm it is a courtesy and gets one line back.
       */
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;
      const soon = new Date(`${clinicNow().dateKey}T12:00:00`);
      soon.setDate(soon.getDate() + 2);
      const within = appt && appt.date <= soon.toISOString().slice(0, 10);
      if (appt && within) {
        if (normalizeAppointmentStatus(appt.status) === "Scheduled") {
          await adminClinicDoc(clinicId, "appointments", appt.id).set(
            { status: "Confirmed", confirmedAt: FieldValue.serverTimestamp(), confirmedVia: "whatsapp_reply" },
            { merge: true }
          );
          reason = "ack_confirmed";
        } else {
          reason = "ack";
        }
        replyText = [`تمام، ${v.waitingForYou} 🦷`, "", appointmentLine(appt)].join("\n");
      } else {
        const need = ctx.gender === "female" ? "محتاجة" : "محتاج";
        replyText = `تمام 🙏 لو حضرتك ${need} أي حاجة تانية إحنا هنا.`;
        reason = "ack";
      }
    } else if (act.type === "my_appointment") {
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;
      if (appt) {
        replyText = [`ميعادك الجاي 👇`, "", appointmentLine(appt), "", "لو حابب تعدله أو تلغيه ابعتلنا وهنظبطهولك."].join("\n");
        structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
        reason = "appointment_told";
      } else {
        // Nothing on the calendar. Offering to make one beats a receptionist confirming a blank.
        replyText = "مالقيتش ليك ميعاد محجوز حالياً 🙏 تحب نحجزلك؟";
        structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
        reason = "no_appointment";
      }
    } else if (act.type === "reschedule_start") {
      /*
       * A move, done by the bot.
       *
       * The appointment is found by phone, shown back, and the same day list booking uses comes
       * next — with the appointment's own dentist, since a move is not a change of doctor. The
       * final tap lands on `book`, which sees `rescheduleId` and moves instead of adding. No
       * appointment: offer one, the way "my appointment" does.
       */
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;
      if (!appt) {
        replyText = "مالقيتش ليك ميعاد محجوز حالياً 🙏 تحب نحجزلك؟";
        structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
        reason = "reschedule_no_appointment";
      } else {
        rescheduleId = appt.id;
        const doctorName = appt.doctor && appt.doctor.toLowerCase() !== "any" ? appt.doctor : "";
        listDays(doctorName);
        if (nextState === "booking_day") {
          const intro = ["تمام، هنعدّل ميعادك ده 🔁", "", appointmentLine(appt), ""].join("\n");
          replyText = intro + "\n" + replyText;
          if (structure) structure = { ...structure, body: `${intro}\n${structure.body}` };
          reason = "reschedule_days";
        }
      }
    } else if (act.type === "appointment_change") {
      /*
       * A cancellation, a move, or "I'm running late".
       *
       * The bot does not touch the calendar here on purpose — a keyword match is not enough
       * evidence to move somebody's slot. What it does is stop the message evaporating: it finds
       * the appointment, tells a person with the details in hand, and confirms to the patient that
       * a human now has it. Before this the reply was the booking menu and nobody was told at all.
       */
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;
      const label = act.kind === "cancel" ? "إلغاء" : act.kind === "reschedule" ? "تعديل" : "تأخير";
      replyText = appt
        ? [`وصلتنا رسالتك بخصوص ${label} الميعاد 👍`, "", appointmentLine(appt), "", "الاستقبال هيتواصل معاك حالاً يأكدلك."].join("\n")
        : `وصلتنا رسالتك بخصوص ${label} الميعاد 👍 الاستقبال هيتواصل معاك حالاً.`;
      reason = `appointment_${act.kind}`;
      // The desk hears about it now. A running-late message has a shelf life measured in minutes,
      // and a passive flag on a document nobody has open is not a notification.
      void sendClinicPush(
        clinicId,
        {
          title:
            act.kind === "cancel" ? "طلب إلغاء ميعاد ❌" : act.kind === "reschedule" ? "طلب تعديل ميعاد 🔁" : "مريض هيتأخر ⏳",
          body: `${ctx.patientName || phone} — ${appt ? `${appt.date} ${appt.time}` : "من غير ميعاد محجوز"}`,
        },
        { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
      );
    } else if (act.type === "open_now") {
      const state = openRightNow(profile.schedule);
      const hours = ctx.hoursText?.trim() ? `\n\n🕐 مواعيدنا:\n${ctx.hoursText.trim()}` : "";
      replyText = state.open
        ? `أيوه احنا فاتحين دلوقتي ✅${hours}`
        : state.opensLaterToday
          ? `لسه مافتحناش، بنفتح النهارده الساعة ${arabicClock(profile.schedule.startHour, profile.schedule.startMinute)} 🕐${hours}`
          : `احنا مقفولين دلوقتي 🙏${hours}`;
      structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
      reason = "open_now";
    } else if (act.type === "price_list") {
      const servicesSnap = await adminClinicCollection(clinicId, "services").limit(200).get();
      const lines = servicesSnap.docs
        .map((d) => {
          const s = (d.data() || {}) as Record<string, unknown>;
          const name = String(s.name || "").trim();
          const price = Number(s.price) || 0;
          if (!name || price <= 0) return "";
          const perTooth = s.pricingMode === "per_tooth" ? " للسن" : "";
          return `• ${name}: يبدأ من ${price.toLocaleString("en-US")} ج.م${perTooth}`;
        })
        .filter(Boolean)
        .slice(0, 25);
      if (lines.length) {
        replyText = ["💰 *أسعارنا تبدأ من:*", "", ...lines, "", "الأسعار دي بداية السعر، والاستقبال بيأكد السعر النهائي بعد الكشف."].join("\n");
        reason = "price_list";
      } else {
        replyText = "الاستقبال هيبعتلك قائمة الأسعار حالاً 🙏";
        nextState = "handed_off";
        handoff = true;
        reason = "no_price_list";
      }
    } else if (act.type === "ai") {
      /*
       * Sales mode feeds the model everything a good receptionist would know before answering:
       * the thread so far (every voice), who this is and whether they are already booked, the
       * owner's coaching, the answers staff approved, and the playbook. Assisted mode keeps the
       * cheap call it always made.
       */
      const sales = settings.aiFirst;
      const salesContext = sales ? await loadSalesContext(clinicId, chatId, patient, ctx) : null;
      const ai = await answerWithAi({
        clinicId,
        clinicName,
        question: act.question,
        patientName: ctx.patientName,
        hoursText: ctx.hoursText,
        addressText: ctx.addressText,
        clinicPhone: ctx.clinicPhone,
        facts: ctx.facts,
        history: conversation.aiHistory ?? [],
        mode: sales ? "sales" : "assisted",
        thread: salesContext?.thread,
        patient: salesContext?.patient,
        coaching: settings.coaching,
        knowledge: salesContext?.knowledge,
        playbook: salesContext?.playbook,
        canBook: Boolean(ctx.canOfferBooking || ctx.canRegister),
      });
      if (ai.kind === "answer" && ai.openBooking && (ctx.canOfferBooking || ctx.canRegister)) {
        // The model judged the moment right. The calendar part stays deterministic: its line
        // introduces the same lists a tapped "book" button would have produced.
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        if (ai.interest && !ctx.serviceMatch) ctx.serviceMatch = (await matchService(clinicId, ai.interest)) || undefined;
        if (ctx.canOfferBooking) {
          if ((profile?.doctors.length ?? 0) >= 2) listDoctors();
          else listDays();
          if (intro) {
            replyText = `${intro}\n\n${replyText}`;
            if (structure) structure = { ...structure, body: `${intro}\n\n${structure.body}` };
          }
          reason = "ai_booking";
        } else {
          const askName = `${v.welcome} 🙏 عشان نسجل الحجز، ياريت حضرتك ${v.send === "ابعتي" ? "تبعتيلنا" : "تبعتلنا"} الاسم الكامل.`;
          replyText = intro ? `${intro}\n\n${askName}` : askName;
          nextState = "booking_name";
          reason = "ai_ask_name";
        }
      } else if (ai.kind === "answer") {
        replyText = ai.text;
        structure = { body: ai.text, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
        aiExchange = { q: act.question, a: ai.text };
        if (ai.interest && !ctx.serviceMatch) ctx.serviceMatch = (await matchService(clinicId, ai.interest)) || ai.interest;
        if (ai.interest) aiInterest = (await matchService(clinicId, ai.interest)) || ai.interest;
        reason = "ai_answer";
      } else if (ai.kind === "handoff") {
        // The model recognised a person's job — a complaint, a named dentist, something medical,
        // or a question it has no facts for. Same promise as every other handoff: the patient is
        // told someone is coming, and the conversation is flagged so someone actually comes.
        // The medical wording is the engine's, phone number included. Two paths reaching the same
        // conclusion must not give the patient two different amounts of help getting there.
        replyText =
          ai.topic === "medical"
            ? clinicalReplyText(ctx.clinicPhone)
            : ai.topic === "complaint"
              ? "وصلتنا رسالتك 🙏 حد من إدارة العيادة هيتواصل معاك في أقرب وقت."
              : "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت.";
        nextState = "handed_off";
        handoff = true;
        reason = `ai_handoff_${ai.topic}`;
      } else {
        // No key, no credits, model down — the ladder the AI replaced stands back up, so the
        // patient experience degrades to yesterday's, never to silence.
        if (conversation.state === "awaiting_choice" || conversation.state === "new") {
          replyText = `معلش، مفهمتش قصد حضرتك 🙏 ${v.choose} من الأزرار تحت أو ${v.send} رقم الاختيار.`;
          structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
          nextState = "reprompted";
          reason = "reprompt";
        } else {
          replyText = "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت.";
          nextState = "handed_off";
          handoff = true;
          reason = "gave_up";
        }
      }
    } else if (act.type === "list_doctors") {
      listDoctors();
    } else if (act.type === "list_days_doctor_index") {
      const doctors = conversation.pendingDoctors ?? [];
      const picked = doctors[act.index - 1];
      // Out of range or the list is gone: offering the dentists again beats guessing a chair.
      if (picked === undefined) listDoctors();
      // "بكره" was said before the dentist question: now that the chair is known, straight to
      // that day's times rather than a list of days that starts with it.
      else if (conversation.pendingDayWord && conversation.pendingDayWord >= clinicNow().dateKey) await listTimes(conversation.pendingDayWord, picked);
      else listDays(picked);
    } else if (act.type === "register") {
      /*
       * The moment a stranger becomes a patient. The same fields the public booking page writes,
       * so a bot-registered patient is indistinguishable from a web-registered one everywhere
       * else in the system — and identified by phone from their very next message.
       */
      const created = await adminClinicCollection(clinicId, "patients").add({
        name: act.name,
        phone,
        createdAt: FieldValue.serverTimestamp(),
        lastVisit: null,
        // A relative shares the sender's phone. The link says whose phone it is, so the desk is
        // not puzzled by two records on one number, and the sender's own record stays the one
        // this number resolves to next time.
        ...(act.forRelative && patient
          ? { notes: `Created via WhatsApp assistant — booked by ${ctx.patientName || phone}`, bookedBy: patient.id }
          : { notes: "Created via WhatsApp assistant" }),
        source: "whatsapp_bot",
      });
      patient = { id: created.id, data: { name: act.name, phone } };
      ctx.patientName = act.name;
      if ((profile?.doctors.length ?? 0) >= 2) listDoctors();
      else listDays();
      reason = "registered";
    } else if (act.type === "list_days") {
      const doctorName = act.doctorName ?? conversation.pendingDoctor ?? "";
      // Same shortcut for a tapped dentist button; a stale or past day word falls back to the list.
      if (act.doctorName !== undefined && conversation.pendingDayWord && conversation.pendingDayWord >= clinicNow().dateKey) {
        await listTimes(conversation.pendingDayWord, doctorName);
      } else {
        listDays(doctorName);
      }
    } else if (act.type === "relist") {
      if (conversation.state === "booking_time" && conversation.pendingDate && conversation.pendingTimes?.length) {
        replyText = RELIST_PREFIX + renderTimeList(conversation.pendingDate, conversation.pendingTimes);
        structure = {
          body: RELIST_PREFIX.trim(),
          list: optionList("اختيار الميعاد", conversation.pendingTimes, arabicTimeLabel, (t) => `t${conversation.pendingDate}|${t}`, { id: "back_days", title: "رجوع لاختيار اليوم" }),
        };
        pending = { days: conversation.pendingDays, times: conversation.pendingTimes, date: conversation.pendingDate, treatment };
      } else if (conversation.pendingDays?.length) {
        replyText = RELIST_PREFIX + renderDayList(conversation.pendingDays);
        structure = {
          body: RELIST_PREFIX.trim(),
          list: optionList("اختيار اليوم", conversation.pendingDays, arabicDayLabel, (d) => `d${d}`, { id: "back_menu", title: "رجوع للقائمة" }),
        };
        nextState = "booking_day";
        pending = { days: conversation.pendingDays, treatment };
      } else {
        // The stored options are gone — a fresh list beats an apology about lost state.
        listDays();
      }
    } else if (act.type === "list_times") {
      const dateKey = conversation.pendingDays?.[act.index - 1];
      if (!dateKey) listDays(conversation.pendingDoctor ?? "");
      else await listTimes(dateKey, conversation.pendingDoctor ?? "");
    } else if (act.type === "list_times_date") {
      // A tapped day carries its own date AND dentist. A stale tap can name a day already gone —
      // fresh days then, with no scolding: the patient did nothing wrong, the message was old.
      const doctorName = act.doctorName ?? conversation.pendingDoctor ?? "";
      if (act.dateKey < clinicNow().dateKey) listDays(doctorName);
      else await listTimes(act.dateKey, doctorName);
    } else if (act.type === "book" || act.type === "book_slot") {
      const time = act.type === "book_slot" ? act.time : conversation.pendingTimes?.[act.index - 1];
      const dateKey = act.type === "book_slot" ? act.dateKey : conversation.pendingDate;
      const doctorName = (act.type === "book_slot" ? act.doctorName : conversation.pendingDoctor) ?? "";
      if (!time || !dateKey || !patient || !phone) {
        listDays();
      } else if (rescheduleId) {
        const moved = await movePatientBooking({ clinicId, profile, appointmentId: rescheduleId, dateKey, time, doctorName, autoConfirm: settings.autoConfirm });
        if (moved.ok) {
          replyText = [
            "✅ تم تعديل ميعادك:",
            `📅 ${arabicDayLabel(dateKey)}`,
            `⏰ ${arabicTimeLabel(time)}`,
            ...(doctorName ? [`👨‍⚕️ ${doctorName}`] : []),
            "",
            `${v.waitingForYou} 🦷`,
          ].join("\n");
          nextState = "awaiting_choice";
          reason = "rescheduled";
          rescheduleId = "";
          void sendClinicPush(
            clinicId,
            { title: "تعديل ميعاد من واتساب 🔁", body: `${ctx.patientName || phone} — ${dateKey} ${time}${doctorName ? ` — ${doctorName}` : ""}` },
            { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
          );
        } else if (moved.reason === "slot_taken") {
          await listTimes(dateKey, doctorName);
          replyText = `الميعاد ده اتحجز في نفس اللحظة 🙏\n\n${replyText}`;
          reason = "slot_taken";
        } else {
          // The appointment vanished mid-flow (the desk cancelled it). Book fresh instead.
          rescheduleId = "";
          listDays(doctorName);
          replyText = `الميعاد القديم مش موجود، نحجزلك ميعاد جديد 👇\n\n${replyText}`;
          reason = "reschedule_gone";
        }
      } else {
        const booked = await createPatientBooking({
          clinicId,
          profile,
          patientId: patient.id,
          patientName: ctx.patientName || "Patient",
          phone,
          dateKey,
          time,
          source: "whatsapp_bot",
          autoConfirm: settings.autoConfirm,
          doctorName,
          treatment,
        });
        if (booked.ok) {
          replyText = [
            settings.autoConfirm ? "✅ تم تأكيد حجزك:" : "✅ تم تسجيل طلب حجزك:",
            `📅 ${arabicDayLabel(dateKey)}`,
            `⏰ ${arabicTimeLabel(time)}`,
            ...(doctorName ? [`👨‍⚕️ ${doctorName}`] : []),
            ...(treatment ? [`🦷 ${treatment}`] : []),
            "",
            settings.autoConfirm
              ? `${v.waitingForYou} 🦷 لو حبيت تعدّل الميعاد، ${v.send} *3*.`
              : `العيادة هتراجع الطلب وهتتواصل مع حضرتك للتأكيد. لو حبيت تعدّل، ${v.send} *3*.`,
          ].join("\n");
          nextState = "awaiting_choice";
          reason = "booked";
          // The desk hears about it the moment it lands, same as an online booking — the whole
          // point of a bot is that nobody was at a screen when this arrived.
          void sendClinicPush(
            clinicId,
            { title: "حجز جديد من واتساب 🤖", body: `${ctx.patientName || "Patient"} — ${dateKey} ${time}${doctorName ? ` — ${doctorName}` : ""}` },
            { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
          );
        } else if (booked.reason === "slot_taken") {
          await listTimes(dateKey, doctorName);
          replyText = `الميعاد ده اتحجز في نفس اللحظة 🙏\n\n${replyText}`;
          reason = "slot_taken";
        } else {
          replyText = "عندك أكتر من حجز مفتوح بالفعل — ابعت *3* والاستقبال هيظبطهالك.";
          nextState = "handed_off";
          handoff = true;
          reason = "too_many_open";
        }
      }
    }
  } else if (decision.action && !profile) {
    replyText = "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت.";
    nextState = "handed_off";
    handoff = true;
    reason = "no_profile";
  }

  // Mid-reschedule, the appointment id rides on every list step so the final pick moves it.
  // Any step that leaves the booking lists (menu, handoff, done) drops it.
  if (rescheduleId && pending && typeof nextState === "string" && nextState.startsWith("booking_")) pending = { ...pending, reschedule: rescheduleId };

  // A name is being asked for: remember whose, and what they came for, until it arrives.
  if (reason === "ask_relative_name") pending = { forRelative: true, treatment: ctx.serviceMatch };
  if (reason === "ask_name" || reason === "ai_ask_name") pending = { treatment: ctx.serviceMatch || conversation.lastInterest };

  /*
   * The salesman's turn, after the receptionist's.
   *
   * Three things, each only on a turn that is a sale in progress (see sales.ts): the running
   * offer for the service just named, the closing line with a Book button under a factual
   * answer, and a lead record for whoever asked about money or a service and has not booked.
   * A patient who already has an appointment gets the answer and no pitch — selling a
   * consultation to someone who is coming Tuesday reads as a bot that does not know them.
   */
  const salesTurn = !handoff && !args.media && Boolean(replyText.trim());
  const appendLine = (line: string) => {
    if (!line) return;
    const mirrored = Boolean(structure && structure.body === replyText);
    replyText = `${replyText}\n\n${line}`;
    if (structure && mirrored) structure = { ...structure, body: replyText };
  };
  // The sales-mode model already has the offer in its context and says it in its own words.
  if (salesTurn && ctx.serviceMatch && offersActive && !(settings.aiFirst && reason === "ai_answer") && (SALES_CLOSE_REASONS.has(reason) || reason.startsWith("booking_") || reason === "ask_name")) {
    appendLine(offerForService(offersActive, ctx.serviceMatch));
  }
  // In sales mode the model writes its own close; a second one under it reads as a stutter.
  if (salesTurn && SALES_CLOSE_REASONS.has(reason) && (ctx.canOfferBooking || ctx.canRegister) && !(settings.aiFirst && reason === "ai_answer")) {
    const upcoming = patient ? await findNextAppointment(clinicId, patient.id) : null;
    appendLine(closingLine({ gender: ctx.gender, facts: ctx.facts, alreadyBooked: Boolean(upcoming) }));
    // The button block below builds its own structure for menu-shaped replies; everything else
    // gets the Book button here.
    if (!structure && !upcoming && !["greeted", "reprompt", "back_to_menu", "hours"].includes(reason)) {
      structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
    }
  }
  if (phone && !args.media && text.trim()) {
    if (reason === "booked" || reason === "rescheduled") {
      if (patient) void markBotLeadBooked(clinicId, phone, patient.id).catch(() => {});
    } else if (LEAD_INTEREST_REASONS.has(reason) || (ctx.serviceMatch && !reason.startsWith("booking_") && reason !== "registered" && reason !== "ask_name")) {
      void upsertBotLead({
        clinicId,
        phone,
        name: ctx.patientName,
        interest: ctx.serviceMatch,
        question: text,
        reason,
        existingPatientId: patient?.id,
        existingPatientName: ctx.patientName,
      }).catch(() => {});
    }
  }

  /*
   * What the bot could not answer, recorded as it happens.
   *
   * This is the list the Intelligence page's "Bot" tab shows and the only honest source of what
   * to improve next: a question that repeats here is a fact worth writing into Settings or a word
   * worth teaching the matcher. Handoffs the bot chose on purpose — medical, complaints, appointment
   * changes — are not misses and are not recorded.
   */
  const MISS = /^(gave_up|reprompt|ai_handoff_other|ai_handoff_staff|asked_for_human|booking_abandoned)$|_unknown$/;
  if (MISS.test(reason) && text.trim() && !args.media) {
    void adminClinicCollection(clinicId, "bot_misses")
      .add({
        text: text.trim().slice(0, 300),
        reason,
        atMs: Date.now(),
        ...(ctx.patientName ? { patientName: ctx.patientName } : {}),
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  }

  // A promise of a person, made while the clinic is shut, says when the person will actually be
  // there. "في أقرب وقت" at 1am on a Thursday and on the Friday it is closed were the same words.
  if (handoff && profile && replyText.trim() && !reason.startsWith("appointment_")) {
    const st = openRightNow(profile.schedule);
    if (!st.open) replyText = `${replyText}\n\n${closedNote(profile.schedule)}`;
  }

  // Menu-shaped replies become tappable buttons on the official channel. Attached here rather
  // than in the engine because buttons are a channel capability, not a conversation decision.
  // The body drops the numbered lines and the "send the number" instruction — telling someone
  // holding three buttons to type a digit reads as a bot that does not know what it just sent.
  if (!structure && replyText && ["greeted", "reprompt", "back_to_menu", "hours"].includes(reason)) {
    const buttonBody = replyText
      .split("\n")
      .filter((line) => !/^\*[123]\*/.test(line.trim()) && !line.includes("ابعت رقم الاختيار"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    structure = {
      body: `${buttonBody}\n\nاختار من الأزرار 👇`,
      buttons: menuButtons(Boolean(ctx.canOfferBooking)),
    };
  }

  if (handoff) {
    /*
     * The moment the bot promises a person. Until this existed, that promise was a flag on a
     * document no screen read and no notification mentioned — every "الاستقبال هيتواصل معاك"
     * was kept by nobody, and a swollen face at 1am reached exactly as many people as a
     * sticker. Now it lands in the inbox on the Messages page and on staff phones, weighted by
     * what it is: a medical message or an unreadable photo is urgent, a complaint goes to
     * management, everything else is a normal ask.
     */
    const severity: HandoffSeverity =
      reason === "clinical" || reason.startsWith("media_") || reason === "ai_handoff_medical"
        ? "urgent"
        : reason === "complaint" || reason === "ai_handoff_complaint"
          ? "complaint"
          : "normal";
    await markHandoff(clinicId, conversation.phoneKey, reason, {
      text: args.media && !text.trim() ? `[${args.media}]` : text,
      phone,
      patientId: patient?.id,
      patientName: ctx.patientName,
      severity,
    });
    // Appointment changes already pushed their own, more specific notification above.
    if (!reason.startsWith("appointment_")) {
      const who = ctx.patientName || phone || "مريض";
      const preview = (args.media && !text.trim() ? "" : text).replace(/\s+/g, " ").trim().slice(0, 90);
      void sendClinicPush(
        clinicId,
        {
          title:
            severity === "urgent"
              ? "⚠️ مريض محتاج رد فوري"
              : severity === "complaint"
                ? "شكوى من مريض 🙏"
                : "مريض محتاج حد يرد 💬",
          body: preview ? `${who} — ${preview}` : `${who} بعت ${args.media === "audio" ? "رسالة صوتية" : "صورة"}`,
        },
        {
          roles: ["Owner", "Admin", "Receptionist"],
          channel: "alpha_bookings",
          // A known patient opens straight to their record on the phone; a stranger lands on the day.
          data: patient?.id ? { patientId: patient.id } : { screen: "day" },
        }
      );
    }
  }

  if (!replyText.trim()) {
    await saveConversation(
      clinicId,
      conversation,
      {
        state: nextState,
        replied: false,
        reason,
        patientId: patient?.id,
        patientName: ctx.patientName,
      },
      now
    );
    return handoff ? { status: "handoff_only", reason } : skip(reason);
  }

  /*
   * The stop line goes on the opening turn only. The patient started this conversation, so
   * repeating "reply STOP" on every answer reads as a machine that expects to be told to go away.
   *
   * And never under a one-word courtesy. "تمام" is overwhelmingly a patient confirming they will
   * attend, sent in reply to the clinic's own reminder — which arrives as the first turn of a
   * fresh conversation, so it qualified. Answering "yes I'll be there" with instructions for
   * unsubscribing is the one place this footer makes the ban risk worse rather than better.
   */
  const courtesy = reason === "ack" || reason === "thanks";
  const body =
    conversation.state === "new" && !courtesy
      ? appendOptOutFooter(replyText, WHATSAPP_OPT_OUT_FOOTER_AR)
      : replyText;
  // A structure that mirrors the text mirrors its footer too — the tapped and typed experiences
  // must read identically, opt-out line included.
  if (structure && structure.body === replyText && body !== replyText) {
    structure = { ...structure, body };
  }

  let waMessageId: string | undefined;
  try {
    waMessageId = await sendPatientWhatsAppRich(clinicId, replyTo, body, structure);
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
    type: `bot_${reason}`,
    message: body,
    status: "success",
    createdAt: FieldValue.serverTimestamp(),
  });

  // The bot's own words, in the thread staff read. Never allowed to fail the turn.
  await recordThreadMessage(clinicId, replyTo, {
    direction: "out",
    author: "bot",
    text: body,
    kind: reason,
    waMessageId,
  }).catch(() => {});

  await saveConversation(
    clinicId,
    conversation,
    {
      state: nextState,
      replied: true,
      reason,
      patientId: patient?.id,
      patientName: ctx.patientName,
      pending,
      aiExchange,
    },
    now
  );

  /*
   * The outcome, for the weekly playbook. "booked" and "handoff" are settled here; a conversation
   * that simply stops is judged "quiet" by the playbook job after a day of silence. `aiUsed`
   * marks the conversations the model took part in — the only ones the playbook learns from.
   */
  const outcomeUpdate: Record<string, unknown> = {};
  if (aiExchange || reason.startsWith("ai_")) outcomeUpdate.aiUsed = true;
  if (aiInterest) outcomeUpdate.lastInterest = aiInterest;
  if (reason === "booked" || reason === "rescheduled") {
    outcomeUpdate.outcome = "booked";
    outcomeUpdate.outcomeAt = now;
  } else if (handoff && conversation.outcome !== "booked") {
    outcomeUpdate.outcome = "handoff";
    outcomeUpdate.outcomeAt = now;
  }
  if (Object.keys(outcomeUpdate).length) {
    void adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(chatId)).set(outcomeUpdate, { merge: true }).catch(() => {});
  }

  return { status: "replied", text: body, handoff, reason };
}

/**
 * Everything the sales-mode model is shown beyond the message itself.
 *
 * The thread (last 16 lines, every voice), the patient as the desk would know them, the answers
 * the owner approved on the Bot tab, and the playbook. Four reads, only on sales-mode turns —
 * the cost of a model that remembers what it said.
 */
async function loadSalesContext(
  clinicId: string,
  chatId: string,
  patient: { id: string; data: Record<string, unknown> } | null,
  ctx: BotContext
): Promise<{ thread: AiThreadLine[]; patient: AiPatientContext; knowledge: Array<{ q: string; a: string }>; playbook: string }> {
  const key = conversationKey(chatId);
  const [threadSnap, knowledgeSnap, playbookSnap, upcoming] = await Promise.all([
    adminClinicDoc(clinicId, "whatsapp_conversations", key).collection("messages").orderBy("at", "desc").limit(16).get().catch(() => null),
    adminClinicCollection(clinicId, "bot_knowledge").where("status", "==", "approved").limit(40).get().catch(() => null),
    adminClinicDoc(clinicId, "settings", "bot_playbook").get().catch(() => null),
    patient ? findNextAppointment(clinicId, patient.id).catch(() => null) : Promise.resolve(null),
  ]);
  const thread: AiThreadLine[] = (threadSnap?.docs ?? [])
    .map((d) => d.data() || {})
    .reverse()
    .map((m) => ({ author: (m.author as AiThreadLine["author"]) || "bot", text: String(m.text || "") }))
    .filter((l) => l.text.trim() && !l.text.startsWith("[") );
  const knowledge = (knowledgeSnap?.docs ?? []).map((d) => {
    const k = d.data() || {};
    return { q: String(k.question || ""), a: String(k.answer || "") };
  });
  const pb = playbookSnap?.data() || {};
  const lastVisit = typeof patient?.data.lastVisit === "string" ? patient.data.lastVisit : undefined;
  return {
    thread,
    knowledge,
    playbook: String(pb.editedText || pb.text || ""),
    patient: {
      known: Boolean(patient),
      name: ctx.patientName,
      gender: ctx.gender,
      upcomingAppointment: upcoming ? appointmentLine(upcoming).replace(/\n/g, " ") : undefined,
      lastVisit,
    },
  };
}
