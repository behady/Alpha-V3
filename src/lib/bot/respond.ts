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
import { minutesToTimeKey, parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { clinicDayBoundsMinutes } from "@/lib/clinicSchedule";
import { pickOfferedTimes, readTimePreference, type TimePreference } from "./slotPreference";
import { clinicNow } from "@/lib/publicBooking";
import { sendClinicPush } from "@/lib/push";
import { clinicDisplayName } from "@/lib/sms/events";
import { patientSendablePhone, phoneMatchKey, pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { resolveLidToPhone } from "@/lib/whatsapp";
import { findPatientByLid } from "@/lib/whatsappLid";
import { resolveWhatsappDeliveryMode, sendPatientWhatsAppRich } from "@/lib/whatsappDelivery";
import { loadMetaWhatsappConfig, sendMetaWhatsappMedia } from "@/lib/metaWhatsapp";
import type { MetaInteractive } from "@/lib/metaWhatsapp";
import type { BotFacts, BotMedicine } from "@/types/whatsapp";
import { arabicClock, arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import { appendOptOutFooter, normalizeReplyText, WHATSAPP_OPT_OUT_FOOTER_AR } from "@/lib/patientMessaging";
import {
  conversationKey,
  humanClaimMsFromSetting,
  loadConversation,
  markHandoff,
  replyAllowance,
  saveConversation,
  type HandoffSeverity,
} from "./conversation";
import type { BotConversation } from "./conversation";
import { answerWithAi, type AiPatientContext, type AiThreadLine, AI_DEFAULT_ACK } from "./aiReply";
import { isLatinMessage, localizeOutbound } from "./localize";
import { loadPatientDossier, type PatientDossier } from "./patientDossier";
import { resolveSpokenPick } from "./spokenPick";
import { DEFAULT_SCREENING, readScreeningAnswer } from "./medicineScreen";
import { stripRepeatIntro } from "./repeatIntro";
import { feminizeAddress } from "./voiceFix";
import { SALES_CLOSE_REASONS, LEAD_INTEREST_REASONS, activeOffers, closingLine, offerForService } from "./sales";
import { markBotLeadBooked, upsertBotLead } from "./botLeads";
import { recordThreadMessage } from "./thread";
import { clinicalReplyText,
  urgentCallLine, decideBotReply, type BotContext } from "./engine";
import { needsHuman } from "./clinicalTriage";
import { mentionsRelative, quickIntent } from "./quickAnswers";
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
  | { status: "replied"; text: string; handoff: boolean; reason: string; structure?: MetaInteractive }
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
  /** Symptoms go to the AI as a dentist (then to booking) instead of straight to a person. */
  clinicalDentist: boolean;
  /** How long a staff reply keeps the bot out of a thread. */
  humanClaimMs: number;
  /** May the assistant cancel an appointment itself, or only pass the request to the desk? */
  canCancel: boolean;
  /** The medicines this clinic authorised, with the exact words it wants sent for each. */
  medicines: BotMedicine[];
  /** The safety questions asked before any of them, in the clinic's wording or the built-in one. */
  medicineScreening: string;
  /** AI replies per conversation; 0 means no cap. */
  aiMaxReplies: number;
  /** The owner's coaching notes for the model. */
  coaching: string;
  /** The name the model introduces itself with, once. */
  personaName: string;
  /** Human pacing and bubble splitting. */
  humanTouch: boolean;
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
    clinicalDentist: d.botClinicalMode === "dentist",
    humanClaimMs: humanClaimMsFromSetting(d.botHumanClaimMinutes),
    // On by default: a patient cancelling their own appointment is the one calendar change
    // nobody needs to approve, and forwarding it left the slot booked and the desk chasing.
    canCancel: d.botCanCancel !== false,
    // Empty by default, and empty means the assistant names nothing: every medicine question goes
    // to the dentist until a clinic writes down what it is willing to have said in its name.
    medicines: Array.isArray(d.botMedicines)
      ? (d.botMedicines as BotMedicine[])
          .filter((m) => m && typeof m.id === "string" && String(m.text || "").trim())
          .slice(0, 20)
      : [],
    medicineScreening: String(d.botMedicineScreening || "").trim() || DEFAULT_SCREENING,
    aiMaxReplies:
      typeof d.botAiMaxReplies === "number" && d.botAiMaxReplies >= 0 ? Math.floor(d.botAiMaxReplies) : d.botMode === "ai_first" ? 0 : 3,
    coaching: typeof d.botCoaching === "string" ? d.botCoaching : "",
    personaName: typeof d.botPersonaName === "string" ? d.botPersonaName.trim() : "",
    humanTouch: d.botHumanTouch !== false,
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

/**
 * Does this sentence say the booking is done?
 *
 * On the ask-for-a-name path the model has already written "done, I've booked it for you" — and
 * from where it sits that is true, it picked the slot. Registration still stands between that
 * sentence and an actual appointment, and a patient told "booked" and then "send me your full
 * name" in the same message reasonably believes the first half. The claim is dropped rather than
 * softened: a warm sentence that is not true costs more than no sentence at all.
 */
function claimsBooked(text: string): boolean {
  return /حجزت|تم الحجز|تم تأكيد|اتحجز|booked|reserved|confirmed/i.test(text);
}

/**
 * Reasons that mean "a NEW booking is starting", so a reschedule in flight is abandoned.
 *
 * Without this, a patient who asked to move Tuesday's appointment, changed their mind, and then
 * booked a cleaning got the cleaning written on top of Tuesday.
 */
const FRESH_BOOKING_REASONS = new Set(["booking_doctors", "booking_days", "ask_name", "ai_ask_name", "ai_ask_name_slot", "registered", "back_to_menu", "greeted"]);

/** Everything a turn can leave on the conversation for the next one to read. */
type PendingOptions = {
  days?: string[];
  times?: string[];
  slots?: string[];
  date?: string;
  doctors?: string[];
  doctor?: string;
  treatment?: string;
  forRelative?: boolean;
  dayWord?: string;
  reschedule?: string;
  /** A medicine chosen but not yet allowed out, waiting on the safety questions. */
  medicine?: string;
};

/** The options already on the patient's screen, for a turn that is not replacing them. */
function pendingFrom(c: BotConversation) {
  return {
    days: c.pendingDays,
    times: c.pendingTimes,
    slots: c.pendingSlots,
    medicine: c.pendingMedicine,
    date: c.pendingDate,
    doctors: c.pendingDoctors,
    doctor: c.pendingDoctor,
    treatment: c.pendingTreatment,
    forRelative: c.pendingForRelative,
    dayWord: c.pendingDayWord,
    reschedule: c.pendingReschedule,
  };
}

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

function closedNoteEn(schedule: ClinicScheduleConfig): string {
  const n = nextOpening(schedule);
  if (!n) return "The clinic is closed right now; we'll reply as soon as we open 🙏";
  const today = clinicNow().dateKey;
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const when = n.dateKey === today ? "today" : n.dateKey === tomorrow.toISOString().slice(0, 10) ? "tomorrow" : `on ${new Date(`${n.dateKey}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "numeric" })}`;
  // The clock comes back as "3:00 م" because everything else that reads it is Arabic. This note is
  // appended after the localiser has already run, so it has to finish the job itself — otherwise an
  // English sentence ends in an Arabic meridiem, which is exactly the seam this whole path exists
  // to remove.
  const clock = n.clock.replace(/\s*م$/, " PM").replace(/\s*ص$/, " AM");
  return `The clinic is closed right now — we open ${when} at ${clock}, and we'll get back to you then 🙏`;
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
  /**
   * The playground: compose everything, send nothing. No WhatsApp send, no staff push, no lead,
   * no handoff inbox row, no miss. The thread IS written (the model needs its own history) and
   * credits ARE spent — a rehearsal that costs nothing teaches nothing about cost.
   */
  dryRun?: boolean;
  /** What the model saw in a photo, for staff. The patient is never shown it. */
  mediaNote?: { summary: string; urgent: boolean; interest?: string };
}): Promise<BotOutcome> {
  const { clinicId, chatId, text } = args;
  const now = args.now ?? Date.now();
  // Every staff notification goes through this; the playground swaps in silence.
  const push: typeof sendClinicPush = args.dryRun ? async () => {} : sendClinicPush;

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
  // E.164 everywhere: the patient record, the appointment and the lead all compare phones as
  // strings, and a Meta payload arrives without the plus.
  let phone = /^\d{8,15}$/.test(args.phone || "") ? `+${args.phone}` : args.phone || "";
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
      void push(clinicId, { title: "⚠️ مريض (موقف الرسايل) محتاج رد فوري", body: `${String(patient.data.name || phone)} — ${text.slice(0, 90)}` }, { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { chatId: conversationKey(chatId), patientId: patient.id } });
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

  const conversation = await loadConversation(clinicId, chatId, now, { humanClaimMs: settings.humanClaimMs });

  // A stop request recorded against this sender directly — the only place it can live when a lid
  // hides the patient record. Survives conversation expiry; see markConversationOptedOut.
  if (conversation.optedOut) {
    if (needsHuman(text)) {
      await markHandoff(clinicId, conversation.phoneKey, "opted_out_urgent", { text, phone, severity: "urgent" });
      void push(clinicId, { title: "⚠️ مريض (موقف الرسايل) محتاج رد فوري", body: `${phone} — ${text.slice(0, 90)}` }, { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { chatId: conversation.phoneKey, screen: "day" } });
    }
    return skip("opted_out");
  }

  const allowance = replyAllowance(conversation);
  if (!allowance.allowed) {
    /*
     * Out of budget — but a budget is a ban-protection device, not a triage rule. A message that
     * trips the clinical words is exactly the message that must not be swallowed here, so it is
     * flagged urgent and pushed to staff before we go quiet; the reply itself is still withheld,
     * which is the whole point of the cap.
     */
    const urgent = needsHuman(text);
    await markHandoff(clinicId, conversation.phoneKey, urgent ? "limit_urgent" : allowance.reason || "limit", {
      text,
      phone,
      severity: urgent ? "urgent" : "normal",
    });
    if (urgent) {
      void push(
        clinicId,
        { title: "⚠️ مريض محتاج رد فوري", body: `${phone} — ${text.slice(0, 90)}` },
        { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { chatId: conversation.phoneKey, screen: "chats" } }
      );
    }
    await saveConversation(
      clinicId,
      conversation,
      { state: "handed_off", replied: false, reason: allowance.reason || "limit", pending: pendingFrom(conversation) },
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
  // Remembered so a tapped button, a bare digit or an emoji keeps the language the patient chose.
  const latinNow = isLatinMessage(text);
  // Only asked when it matters: sales mode and a one-word acknowledgement on the table.
  if (settings.aiFirst && patient && quickIntent(text) === "ack") {
    const soon = await findNextAppointment(clinicId, patient.id).catch(() => null);
    const limit = new Date(`${clinicNow().dateKey}T12:00:00`);
    limit.setDate(limit.getDate() + 2);
    ctx.hasSoonAppointment = Boolean(soon && soon.date <= limit.toISOString().slice(0, 10));
  }
  ctx.clinicalMode = settings.clinicalDentist ? "dentist" : "handoff";
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
      : decideBotReply({
          // A handoff flag with nobody behind it must not mute the salesperson: the flag stays
          // for the desk, the model keeps helping. A person who actually wrote still owns it.
          state: settings.aiFirst && conversation.state === "handed_off" && !conversation.staffActive ? "awaiting_choice" : conversation.state,
          text,
          ctx,
        });

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
  let pending: PendingOptions | undefined;
  // The appointment being moved, if the patient is mid-reschedule. Rides on every list step.
  let rescheduleId = conversation.pendingReschedule || "";
  /** Has this patient already been introduced to the assistant by name in this thread? */
  let heardIntroBefore = false;
  /** Did the model answer in Arabic? Undefined when no model reply was composed this turn. */
  let modelWroteInArabic: boolean | undefined;
  /** Set when this turn actually cancelled an appointment, rather than promising somebody would. */
  let appointmentCancelled = false;
  /** Set when the patient answered the medicine safety questions and nothing in them was a flag. */
  let medicineScreened = false;
  /** The slot keys this reply names in its own sentence, so the next turn can answer "the first". */
  let spokenSlotKeys: string[] = [];
  /** Attach them to whatever this turn was already storing, without disturbing the rest. */
  const withSpokenSlots = (p: PendingOptions | undefined): PendingOptions | undefined =>
    spokenSlotKeys.length ? { ...(p ?? {}), slots: spokenSlotKeys } : p;
  let aiExchange: { q: string; a: string } | undefined;
  let aiInterest = "";
  let aiMedia: { id: string; label: string; url: string; kind: "image" | "document" } | null = null;
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
      // Mid-move, the patient's own appointment must not read as a booked slot: it made a
      // half-hour shift look impossible and a quiet day look full.
      const slots = await computeAvailableSlots({ clinicId, dateKey, doctorName: doctorName || null, branchId, profile: profile!, ignoreAppointmentId: rescheduleId || null });
      if (!slots.length) {
        const days = conversation.pendingDays?.length ? conversation.pendingDays : upcomingOpenDays(profile!.schedule);
        replyText = `اليوم ده كل مواعيده اتحجزت 🙏\n\n${renderDayList(days)}`;
        structure = {
          body: "اليوم ده كل مواعيده اتحجزت 🙏 اختار يوم تاني:",
          list: optionList("اختيار اليوم", days, arabicDayLabel, (d) => `d${d}|${doctorName}`, { id: "back_menu", title: "رجوع للقائمة" }),
        };
        nextState = "booking_day";
        reason = "booking_day_full";
        pending = { days, doctor: doctorName, treatment, reschedule: rescheduleId || undefined };
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


    /*
     * Write one appointment at the given slot, or move the one being rescheduled there.
     * Shared by the tapped/typed slot picks and the salesperson's spoken close ("بكره 5"),
     * so a booking born in conversation is written exactly like one born from a list.
     */
    const bookAt = async (dateKey: string, time: string, doctorName: string) => {
      if (!patient || !phone) {
        listDays();
        return;
      }
      if (args.dryRun) {
        // The rehearsal shows what WOULD be written. It must not touch the real calendar: the
        // playground once left test patients and Confirmed appointments in the live day view.
        replyText = [
          "✅ (تجربة) الحجز كان هيتسجل كده:",
          `📅 ${arabicDayLabel(dateKey)}`,
          `⏰ ${arabicTimeLabel(time)}`,
          ...(doctorName ? [`👨‍⚕️ ${doctorName}`] : []),
          ...(treatment ? [`🦷 ${treatment}`] : []),
        ].join("\n");
        nextState = "awaiting_choice";
        reason = "booked";
        return;
      }
      if (rescheduleId) {
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
          void push(
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
            // The care note: where to come, how to park, what the first visit is. The message a
            // receptionist adds by hand when there is time, which is never.
            ...(ctx.addressText?.trim() ? ["", `📍 ${ctx.addressText.trim()}`] : []),
            ...(ctx.facts?.mapsUrl?.trim() ? [ctx.facts.mapsUrl.trim()] : []),
            ...(ctx.facts?.parking?.trim() ? [`🅿️ ${ctx.facts.parking.trim()}`] : []),
            ...(ctx.facts?.consultation?.trim() ? [`ℹ️ ${ctx.facts.consultation.trim()}`] : []),
          ].join("\n");
          nextState = "awaiting_choice";
          reason = "booked";
          // The desk hears about it the moment it lands, same as an online booking — the whole
          // point of a bot is that nobody was at a screen when this arrived.
          void push(
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
    };

    /*
     * A move, done by the bot.
     *
     * The appointment is found by phone, shown back, and the same day list booking uses comes
     * next — with the appointment's own dentist, since a move is not a change of doctor. The
     * final pick lands on `bookAt`, which sees `rescheduleId` and moves instead of adding. No
     * appointment: offer one. Reached from the typed intent and from the model's own decision.
     */
    const startReschedule = async () => {
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;
      if (!appt) {
        replyText = "مالقيتش ليك ميعاد محجوز حالياً 🙏 تحب نحجزلك؟";
        structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
        reason = "reschedule_no_appointment";
        return;
      }
      rescheduleId = appt.id;
      const doctorName = appt.doctor && appt.doctor.toLowerCase() !== "any" ? appt.doctor : "";
      listDays(doctorName);
      if (nextState === "booking_day") {
        const intro = ["تمام، هنعدّل ميعادك ده 🔁", "", appointmentLine(appt), ""].join("\n");
        replyText = intro + "\n" + replyText;
        if (structure) structure = { ...structure, body: `${intro}\n${structure.body}` };
        reason = "reschedule_days";
      }
    };

    /*
     * A cancellation, a move, or "I'm running late".
     *
     * The bot does not touch the calendar here on purpose — a keyword match is not enough
     * evidence to move somebody's slot. What it does is stop the message evaporating: it finds
     * the appointment, tells a person with the details in hand, and confirms to the patient that
     * a human now has it. Reached from the typed intent and from the model's own decision.
     */
    /*
     * Cancelling, moving, or warning that they are running late.
     *
     * A cancellation used to be forwarded rather than performed: the patient was told reception
     * would confirm it, the appointment stayed on the calendar, and a patient who said "cancel it"
     * twice was told the same thing twice. The desk has to chase a message it could have read as a
     * change in the day view. So the bot cancels it — the one appointment action a patient is
     * unambiguously entitled to make about their own booking — and the desk is told it HAPPENED
     * rather than asked to do it.
     *
     * Reschedules still go through the booking flow (a new time has to be chosen), and a
     * running-late note changes no status: the slot is still theirs.
     */
    const flagAppointmentChange = async (kind: "cancel" | "reschedule" | "late") => {
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;

      if (kind === "cancel" && appt && settings.canCancel) {
        await adminClinicDoc(clinicId, "appointments", appt.id).set(
          {
            status: "Cancelled",
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledVia: "whatsapp_bot",
            cancelledBy: "patient",
          },
          { merge: true }
        );
        appointmentCancelled = true;
        replyText = [
          "تمام، ألغيت الميعاد ✅",
          "",
          appointmentLine(appt),
          "",
          `${v.youWant} نحجزلك ميعاد تاني في وقت يناسبك؟`,
        ].join("\n");
        reason = "appointment_cancelled";
        void push(
          clinicId,
          {
            title: "ميعاد اتلغى من واتساب ❌",
            body: `${ctx.patientName || phone} — ${appt.date} ${appt.time}${appt.doctor ? ` مع ${appt.doctor}` : ""}`,
          },
          { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
        );
        return;
      }

      const label = kind === "cancel" ? "إلغاء" : kind === "reschedule" ? "تعديل" : "تأخير";
      replyText = appt
        ? [`وصلتنا رسالتك بخصوص ${label} الميعاد 👍`, "", appointmentLine(appt), "", "الاستقبال هيتواصل معاك حالاً يأكدلك."].join("\n")
        : `وصلتنا رسالتك بخصوص ${label} الميعاد 👍 الاستقبال هيتواصل معاك حالاً.`;
      reason = `appointment_${kind}`;
      // The desk hears about it now. A running-late message has a shelf life measured in minutes,
      // and a passive flag on a document nobody has open is not a notification.
      void push(
        clinicId,
        {
          title: kind === "cancel" ? "طلب إلغاء ميعاد ❌" : kind === "reschedule" ? "طلب تعديل ميعاد 🔁" : "مريض هيتأخر ⏳",
          body: `${ctx.patientName || phone} — ${appt ? `${appt.date} ${appt.time}` : "من غير ميعاد محجوز"}`,
        },
        { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
      );
    };

    /*
     * The patient is answering the medicine safety questions.
     *
     * Decided here rather than by the model, and before anything else this turn: the model is the
     * part of the system that can be argued with, and "are you sure it's safe, just tell me" is
     * exactly the sentence somebody types when they are about to be hurt by the answer. Opt-outs
     * and clinical triage have already had their say — neither produces an action — so anything
     * reaching this line is an ordinary reply to a question we asked.
     */
    const screening = conversation.pendingMedicine && text.trim() ? readScreeningAnswer(text) : null;
    /*
     * Somebody who ignored the question and asked something else has not failed the screening.
     *
     * The reading is strict on purpose, so an answer nobody can parse reaches the dentist — but
     * "طب التقويم بكام؟" is not an unreadable answer, it is a different conversation. Sending that
     * patient to a person because they changed the subject would make the whole feature feel like
     * a trap. The held medicine is simply dropped and the turn carries on normally; if they come
     * back to it, they are asked again.
     */
    const changedSubject = screening === "unclear" && /[?؟]|^(طب|بس|ايه|إيه|كام|امتى|إمتى|فين|ليه|ممكن|عايز|عاوز)/.test(text.trim());
    if (changedSubject) pending = { ...pendingFrom(conversation), medicine: undefined };
    if (screening && !changedSubject) {
      const chosen = settings.medicines.find((m) => m.id === conversation.pendingMedicine);
      pending = { ...pendingFrom(conversation), medicine: undefined };
      if (screening === "clear" && chosen) {
        replyText = chosen.text;
        nextState = "awaiting_choice";
        reason = "medicine_given";
        medicineScreened = true;
      } else {
        replyText =
          screening === "risk"
            ? `شكراً إنك قلتلي 🙏 الحالة دي بالذات لازم الدكتور هو اللي يقول فيها، وأنا بوصّلك بيه حالاً.

${urgentCallLine(ctx.clinicPhone)}`
            : `معلش، عايز أتأكد صح قبل ما أقول أي حاجة 🙏 هخلي الدكتور يرد على حضرتك بنفسه.

${urgentCallLine(ctx.clinicPhone)}`;
        nextState = "handed_off";
        handoff = true;
        reason = screening === "risk" ? "medicine_screen_risk" : "medicine_screen_unclear";
      }
    } else if (act.type === "ack") {
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
      await startReschedule();
    } else if (act.type === "appointment_change") {
      await flagAppointmentChange(act.kind);
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
      const slotOffer = sales && profile?.schedule.isConfigured && (ctx.canOfferBooking || ctx.canRegister) ? await nextSlots(clinicId, profile, branchId, conversation.pendingDoctor ?? "", rescheduleId || null, readTimePreference(act.question, clinicDayBoundsMinutes(profile.schedule))) : [];
      heardIntroBefore = (salesContext?.thread || []).some(
        (line) => line.author === "bot" && Boolean(settings.personaName) && line.text.includes(settings.personaName)
      );
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
        personaName: settings.personaName,
        knowledge: salesContext?.knowledge,
        playbook: salesContext?.playbook,
        canBook: Boolean(ctx.canOfferBooking || ctx.canRegister),
        clinical: act.clinical === true,
        slots: slotOffer,
        media: salesContext?.media,
        memory: conversation.memory,
        dossier: salesContext?.dossier,
        medicines: settings.medicines.map((m) => ({ id: m.id, label: m.label, whenToUse: m.whenToUse })),
        medicineScreened: Boolean(conversation.medicineScreenedAtMs),
        flaggedForStaff: conversation.humanOwned && !conversation.staffActive,
        bookingStep: bookingStepLabel(conversation),
        sessionGapMinutes: salesContext?.gapMinutes,
      });
      /*
       * A pick the model turned into "let's open the booking" instead of "book this one".
       *
       * It happens on roughly half of the short answers — "the first one", "الاول", the hour said
       * back — and every time it happened the patient was handed the dentist menu and started
       * again, or worse, gave their name and was registered with no appointment. The keys they
       * were offered are on the conversation, so the choice is read here rather than argued about
       * in the prompt. Anything ambiguous still falls through to the model's own judgement.
       */
      if (ai.kind === "answer" && ai.openBooking && !ai.bookSlot && (conversation.pendingSlots?.length || 0) > 0) {
        const offered = (conversation.pendingSlots || [])
          .map((key) => slotOffer.find((s) => s.key === key))
          .filter((s): s is { key: string; label: string } => Boolean(s));
        const picked = resolveSpokenPick(act.question, offered);
        if (picked) {
          ai.bookSlot = picked;
          ai.openBooking = false;
        }
      }

      /*
       * Which of the offered times this reply actually says out loud.
       *
       * Recorded for EVERY answer, not only the ones the model labelled `open_booking`, because
       * the turn that offers two times is almost always a plain answer — which is how the memory
       * came to be written on the wrong turns, leaving "the first one" with nothing to resolve
       * against exactly when it mattered.
       */
      if (ai.kind === "answer" && ai.text) {
        const said = ai.text;
        // The clock alone is not an identifier: four different days share "3:00 م", and storing
        // all four made "the third one" resolve to a time nobody was offered. A slot counts as
        // spoken only when its date or its day name is in the sentence beside its clock — or when
        // that clock belongs to exactly one slot anyway.
        const hits: Array<{ key: string; at: number }> = [];
        for (const s of slotOffer) {
          // The digits only: the assistant says "10:30 بالليل" as often as "10:30 م", and matching
          // the marker missed every one of those.
          const clock = s.label.match(/\d{1,2}:\d{2}/)?.[0];
          if (!clock) continue;
          const at = said.indexOf(clock);
          if (at < 0) continue;
          const date = s.label.match(/\d{1,2}\/\d{1,2}/)?.[0];
          const day = s.label.match(/^(\S+)/)?.[1] || "";
          const unique = slotOffer.filter((o) => o.label.includes(clock)).length === 1;
          if (unique || (date && said.includes(date)) || (day.length > 2 && said.includes(day))) hits.push({ key: s.key, at });
        }
        // In the order the patient heard them, which is the order "the first one" counts in.
        spokenSlotKeys = hits.sort((a, b) => a.at - b.at).map((h) => h.key);
      }
      if (ai.kind === "answer" || ai.kind === "handoff") {
        const wrote = ai.text || "";
        // Which script it is MOSTLY in, not merely which letters appear: an English reply that
        // names "دكتور محمد إيهاب" contains Arabic without being Arabic, and treating that as
        // Arabic would leave an English patient reading Arabic day names.
        const arabic = (wrote.match(/[؀-ۿ]/g) || []).length;
        const latin = (wrote.match(/[A-Za-z]/g) || []).length;
        if (wrote.trim() && wrote !== AI_DEFAULT_ACK) modelWroteInArabic = arabic > latin;
      }
      if (ai.kind === "answer" && ai.sendMedia) aiMedia = salesContext?.media?.find((m) => m.id === ai.sendMedia) ?? null;
      if (ai.kind === "answer" && ai.medicineId) {
        /*
         * The clinic authorised this sentence; the assistant only chose it.
         *
         * Nothing is sent until somebody has said who the medicine is for and what else they take.
         * The questions go out once per conversation and the answer is read in code — the model is
         * not asked to judge whether it heard "no allergies", because the model is the part that
         * can be talked round, and this is the one feature in here that can physically hurt.
         */
        const chosen = settings.medicines.find((m) => m.id === ai.medicineId);
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        if (!chosen) {
          // Should be unreachable — aiReply validates the id — but a medicine that vanished from
          // settings mid-conversation must not become an improvised one.
          replyText = clinicalReplyText(ctx.clinicPhone);
          nextState = "handed_off";
          handoff = true;
          reason = "medicine_unknown";
        } else if (conversation.medicineScreenedAtMs) {
          replyText = intro ? `${intro}\n\n${chosen.text}` : chosen.text;
          nextState = "awaiting_choice";
          reason = "medicine_given";
        } else {
          replyText = settings.medicineScreening;
          nextState = conversation.state.startsWith("booking_") ? conversation.state : "awaiting_choice";
          pending = { ...pendingFrom(conversation), medicine: chosen.id };
          reason = "medicine_screen";
        }
      } else if (ai.kind === "answer" && ai.appointmentChange) {
        // The desk is told exactly as the typed intent tells it; the patient hears it in the
        // model's words and language, and the conversation stays open for a rebooking.
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        await flagAppointmentChange(ai.appointmentChange);
        // The model's own wording, unless the code just did something its sentence did not know
        // about — a performed cancellation says "done", and "I've told reception" would be wrong.
        if (intro && !appointmentCancelled) replyText = intro;
        handoff = !appointmentCancelled;
        nextState = "awaiting_choice";
        reason = appointmentCancelled ? "ai_cancelled" : `ai_${ai.appointmentChange}`;
      } else if (ai.kind === "answer" && ai.reschedule && ctx.canOfferBooking) {
        // "عايز أعدل الميعاد" heard by the model: the same move flow the typed intent opens.
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        await startReschedule();
        if (intro && reason === "reschedule_days") {
          replyText = `${intro}\n\n${replyText}`;
          if (structure) structure = { ...structure, body: `${intro}\n\n${structure.body}` };
        }
      } else if (ai.kind === "answer" && ai.bookSlot && (ctx.canOfferBooking || ctx.canRegister)) {
        /*
         * The spoken close: "بكره 5" became a slot key the model was given, validated there.
         * A known patient is booked on the spot; a stranger gives a name first and the slot
         * waits on the conversation — the register step books it without showing a list.
         */
        const [slotDate, slotTime, slotDoctor = ""] = ai.bookSlot.split("|");
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        if (ai.interest && !ctx.serviceMatch) ctx.serviceMatch = (await matchService(clinicId, ai.interest)) || undefined;
        if (ai.interest) aiInterest = (await matchService(clinicId, ai.interest)) || ai.interest;
        if (ctx.canOfferBooking) {
          await bookAt(slotDate, slotTime, slotDoctor);
          if (intro && (reason === "booked" || reason === "rescheduled")) replyText = `${intro}

${replyText}`;
          // "rescheduled" is a success too — labelling it a failure made the quiet-nudge chase a
          // patient who had just moved their appointment.
          if (!["booked", "rescheduled", "slot_taken", "reschedule_gone"].includes(reason)) reason = "ai_slot_failed";
        } else {
          const askName = `${v.welcome} 🙏 عشان أسجل الحجز باسمك، ${v.send === "ابعتي" ? "ابعتيلي" : "ابعتلي"} اسمك الكامل.`;
          const lead = intro && !claimsBooked(intro) ? intro : "";
          replyText = lead ? `${lead}

${askName}` : askName;
          nextState = "booking_name";
          pending = { date: slotDate, times: [slotTime], doctor: slotDoctor, treatment: ctx.serviceMatch || aiInterest || conversation.lastInterest };
          reason = "ai_ask_name_slot";
        }
      } else if (ai.kind === "answer" && (ai.openBooking || ai.bookSlot) && ctx.relative && ctx.canOfferBooking) {
        /*
         * "عايز أحجز لمراتي" — the booking belongs to somebody else.
         *
         * The deterministic path asked whose name it was; in AI mode that branch became
         * unreachable, so a wife's or a child's appointment was written on the sender's own
         * record and the desk saw the wrong patient in the chair. The model's own sentence still
         * carries the conversation; the name question is added to it.
         */
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        const askWho = "الحجز لمين بالظبط؟ ياريت تبعتلي الاسم الكامل بتاعه 🙏";
        replyText = intro ? `${intro}

${askWho}` : askWho;
        nextState = "booking_name";
        reason = "ask_relative_name";
      } else if (ai.kind === "answer" && ai.openBooking && (ctx.canOfferBooking || ctx.canRegister)) {
        // The model judged the moment right. The calendar part stays deterministic: its line
        // introduces the same lists a tapped "book" button would have produced.
        const intro = ai.text.trim();
        aiExchange = { q: act.question, a: intro };
        if (ai.interest && !ctx.serviceMatch) ctx.serviceMatch = (await matchService(clinicId, ai.interest)) || undefined;
        /*
         * Two questions in one message is the surest way to get neither answered.
         *
         * The model often writes "I have Sunday 9:30 or Monday 3, which suits you?" and asks to
         * open the lists in the same breath — so the patient received a spoken offer of two times
         * followed by a menu of four dentists, and had to work out which one they were meant to
         * reply to. When its own sentence already names times we handed it, that sentence IS the
         * booking step: the pick comes back next turn as book_slot, the way a spoken close does.
         */
        const alreadyOffered =
          Boolean(intro) &&
          slotOffer.some((s) => {
            const clock = s.label.match(/\d{1,2}:\d{2}/)?.[0];
            return Boolean(clock && intro.includes(clock));
          });
        if (alreadyOffered) {
          replyText = intro;
          structure = undefined;
          reason = "ai_answer";
          nextState = conversation.state.startsWith("booking_") ? conversation.state : "awaiting_choice";
          pending = pendingFrom(conversation);
        } else if (ctx.canOfferBooking) {
          if ((profile?.doctors.length ?? 0) >= 2) listDoctors();
          else listDays();
          if (intro) {
            replyText = `${intro}\n\n${replyText}`;
            if (structure) structure = { ...structure, body: `${intro}\n\n${structure.body}` };
          }
          reason = "ai_booking";
        } else {
          const askName = `${v.welcome} 🙏 عشان نسجل الحجز، ياريت حضرتك ${v.send === "ابعتي" ? "تبعتيلنا" : "تبعتلنا"} الاسم الكامل.`;
          const lead = intro && !claimsBooked(intro) ? intro : "";
          replyText = lead ? `${lead}\n\n${askName}` : askName;
          nextState = "booking_name";
          reason = "ai_ask_name";
        }
      } else if (ai.kind === "answer") {
        replyText = ai.text;
        // A person does not send three buttons under every sentence. In salesperson mode with
        // the human touch on, an answer is just an answer; the lists appear when booking starts.
        structure = sales && settings.humanTouch ? undefined : { body: ai.text, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
        aiExchange = { q: act.question, a: ai.text };
        if (ai.interest && !ctx.serviceMatch) ctx.serviceMatch = (await matchService(clinicId, ai.interest)) || ai.interest;
        if (ai.interest) aiInterest = (await matchService(clinicId, ai.interest)) || ai.interest;
        reason = "ai_answer";
        // Mid-list talk answered: the list the patient was shown is still the list they can pick from.
        if (conversation.state.startsWith("booking_")) {
          nextState = conversation.state;
          pending = {
            days: conversation.pendingDays,
            times: conversation.pendingTimes,
            date: conversation.pendingDate,
            doctors: conversation.pendingDoctors,
            doctor: conversation.pendingDoctor,
            treatment: conversation.pendingTreatment,
            forRelative: conversation.pendingForRelative,
            dayWord: conversation.pendingDayWord,
            reschedule: conversation.pendingReschedule,
          };
        }
      } else if (ai.kind === "handoff") {
        // The model recognised a person's job — a complaint, a named dentist, something medical,
        // or a question it has no facts for. Same promise as every other handoff: the patient is
        // told someone is coming, and the conversation is flagged so someone actually comes.
        // The medical wording is the engine's, phone number included. Two paths reaching the same
        // conclusion must not give the patient two different amounts of help getting there.
        /*
         * The model's own words, whatever the topic.
         *
         * An angry patient answered with a form sentence stays angry, and so does a pregnant one
         * asking whether she may take the antibiotic her own dentist prescribed: the reason those
         * questions are routed through the model at all is the sentence it writes on the way out.
         * What the clinic actually needs guaranteed on a medical handoff is the emergency NUMBER,
         * not the paragraph around it — so the number is appended to whatever it said, and the
         * form reply survives only for the turn where it said nothing.
         */
        const spoken = ai.text?.trim();
        const gender = ctx.gender ?? "unknown";
        replyText =
          ai.topic === "medical"
            ? spoken
              ? `${spoken}${spoken.includes(ctx.clinicPhone || "\u0000") ? "" : `\n\n${urgentCallLine(ctx.clinicPhone)}`}`
              : clinicalReplyText(ctx.clinicPhone)
            : spoken
              ? spoken
              : ai.topic === "complaint"
                ? `وصلتنا رسالتك 🙏 حد من إدارة العيادة هيتواصل ${voiceFor(gender).withYou} في أقرب وقت.`
                : `تمام 👍 الاستقبال هيتواصل ${voiceFor(gender).withYou} في أقرب وقت.`;
        nextState = "handed_off";
        handoff = true;
        reason = `ai_handoff_${ai.topic}`;
      } else {
        /*
         * Out of credits, or off the plan: the patient asked a perfectly good question and the
         * clinic simply cannot afford to answer it today. Telling them "I didn't understand"
         * blames them for the clinic's balance, so they get a person instead — and the owner is
         * told, because a silent bot that has stopped selling is worth knowing about.
         */
        if (ai.reason === "no_credits" || ai.reason === "plan") {
          replyText = "تمام، حد من الاستقبال هيتواصل مع حضرتك في أقرب وقت 🙏";
          nextState = "handed_off";
          handoff = true;
          reason = "ai_no_credits";
          void adminClinicDoc(clinicId, "settings", "bot_alerts")
            .get()
            .then((s) => {
              const last = Number(s.data()?.creditsAlertAtMs) || 0;
              if (Date.now() - last < 12 * 60 * 60 * 1000) return;
              void adminClinicDoc(clinicId, "settings", "bot_alerts").set({ creditsAlertAtMs: Date.now() }, { merge: true });
              void push(
                clinicId,
                {
                  title: "رصيد الذكاء الاصطناعي خلص 🤖",
                  body: "البوت وقف عن الرد على أسئلة المرضى وبيحولهم للاستقبال. جدّد الرصيد عشان يرجع يشتغل.",
                },
                { roles: ["Owner", "Admin"], channel: "alpha_leads", data: { screen: "settings" } }
              );
            })
            .catch(() => {});
        } else if (sales && conversation.lastReason !== "ai_unavailable") {
          /*
           * The model fell over — a timeout, or output that would not parse. In salesperson mode
           * there is no menu on the patient's screen to fall back to, and "I didn't understand,
           * pick from the buttons" arrives as an insult when what they sent was "the first one".
           *
           * So: ask again the way a person whose signal dropped would, keep the state and the
           * options they were already holding, and let the next turn work. Twice in a row is a
           * real fault rather than a blip, and that goes to a human below.
           */
          replyText = `معلش، الرسالة مأخدتش عندي كويس 🙏 ${v.send} تاني آخر حاجة كتبتها؟`;
          structure = undefined;
          nextState = conversation.state;
          pending = pendingFrom(conversation);
          reason = "ai_unavailable";
        } else if (conversation.state === "awaiting_choice" || conversation.state === "new") {
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
      // A rehearsal (dryRun) names nobody in the real patient list: the playground once left
      // test patients — and their Confirmed appointments — in the clinic's live day view.
      const created = args.dryRun
        ? null
        : await adminClinicCollection(clinicId, "patients").add({
            name: act.name,
            phone,
            createdAt: FieldValue.serverTimestamp(),
            lastVisit: null,
            // A relative shares the sender's phone. The link says whose phone it is, so the desk
            // is not puzzled by two records on one number, and the sender's own record stays the
            // one this number resolves to next time.
            ...(act.forRelative && patient
              ? { notes: `Created via WhatsApp assistant — booked by ${ctx.patientName || phone}`, bookedBy: patient.id }
              : { notes: "Created via WhatsApp assistant" }),
            source: "whatsapp_bot",
          });
      patient = { id: created?.id ?? "dry_run", data: { name: act.name, phone } };
      ctx.patientName = act.name;
      // The salesperson already agreed a time before asking the name: book it, no lists.
      if (conversation.pendingDate && conversation.pendingTimes?.length === 1) {
        await bookAt(conversation.pendingDate, conversation.pendingTimes[0], conversation.pendingDoctor ?? "");
        if (reason !== "booked") reason = "registered";
      } else {
        if ((profile?.doctors.length ?? 0) >= 2) listDoctors();
        else listDays();
        reason = "registered";
      }
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
      } else if (conversation.state === "booking_doctor" && (conversation.pendingDoctors?.length ?? 0) > 0) {
        // The dentist list again — not the day list. A non-pick at the dentist step used to fall
        // through to days, which skipped the question the patient had not answered.
        listDoctors();
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
      } else {
        await bookAt(dateKey, time, doctorName);
      }
    }
  } else if (decision.action && !profile) {
    replyText = "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت.";
    nextState = "handed_off";
    handoff = true;
    reason = "no_profile";
  }

  /*
   * Mid-reschedule, the appointment id rides on every list step so the final pick moves it. Any
   * step that leaves the booking lists (menu, handoff, done) drops it.
   *
   * `rescheduleId` is only carried when THIS turn is still part of the move that started it: a
   * fresh booking opened later in the same conversation must not inherit it, or the patient's
   * existing appointment is silently moved instead of a second one being made.
   */
  const stillMoving = reason.startsWith("reschedule") || reason === "booking_relist" || reason === "ai_answer" || Boolean(conversation.pendingReschedule && reason.startsWith("booking_") && !FRESH_BOOKING_REASONS.has(reason));
  if (rescheduleId && stillMoving && pending && typeof nextState === "string" && nextState.startsWith("booking_")) {
    pending = { ...pending, reschedule: rescheduleId };
  }

  // A name is being asked for: remember whose, and what they came for, until it arrives.
  if (reason === "ask_relative_name") pending = { forRelative: true, treatment: ctx.serviceMatch };
  if (reason === "ask_name" || reason === "ai_ask_name") pending = { treatment: ctx.serviceMatch || conversation.lastInterest };
  // A stranger's chosen slot rides the ask-name turn; the register step books it.
  if (reason === "ai_ask_name_slot" && !pending) pending = { treatment: ctx.serviceMatch || conversation.lastInterest };

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
  if (phone && !args.dryRun && ((!args.media && text.trim()) || args.mediaNote?.interest)) {
    if (reason === "booked" || reason === "rescheduled") {
      if (patient) void markBotLeadBooked(clinicId, phone, patient.id).catch(() => {});
    } else if (LEAD_INTEREST_REASONS.has(reason) || Boolean(args.mediaNote?.interest) || (ctx.serviceMatch && !reason.startsWith("booking_") && reason !== "registered" && reason !== "ask_name")) {
      void upsertBotLead({
        clinicId,
        phone,
        name: ctx.patientName,
        interest: ctx.serviceMatch || args.mediaNote?.interest,
        question: text || (args.mediaNote ? `🖼️ ${args.mediaNote.summary}` : ""),
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
  if (MISS.test(reason) && text.trim() && !args.media && !args.dryRun) {
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

  /*
   * The fixed lines, in the patient's script.
   *
   * In AI mode the model writes in whatever the patient wrote — and then a handoff, a closed-
   * clinic note or a cancellation acknowledgement arrived in Arabic under an English chat. The
   * few sentences the code itself composes are swapped for their English form when the message
   * being answered has Latin letters and no Arabic ones.
   */
  /*
   * The fixed lines, in the patient's script.
   *
   * The model already writes in the patient's language; everything the CODE composes did not, and
   * only the message text was ever rewritten — the buttons and the list rows stayed Arabic. Both
   * go through the shared localiser now, and a tapped button id no longer counts as evidence that
   * the patient writes English, which is how an Arabic patient who pressed a button used to get
   * the rest of their booking in English.
   */
  /*
   * And she is addressed as a woman.
   *
   * The prompt says so, in its own paragraph, and still loses about one reply in ten — because
   * every other line it is reading is written in the masculine to address the assistant itself.
   * The list of forms rewritten here is tiny and second-person only; see voiceFix.
   */
  if (replyText.trim() && ctx.gender === "female") {
    replyText = feminizeAddress(replyText, "female");
    if (structure) {
      structure = {
        ...structure,
        body: feminizeAddress(structure.body, "female"),
        ...(structure.buttons ? { buttons: structure.buttons.map((b) => ({ ...b, title: feminizeAddress(b.title, "female") })) } : {}),
      };
    }
  }

  /*
   * The introduction, once.
   *
   * The prompt has asked for that since the assistant was given a name, and over an eight-message
   * conversation it still said "معاكي سارة من العيادة" six times. Nothing gives it away as
   * software faster. If this patient has already heard it in this thread, the clause comes off
   * here — the greeting around it, which is answering their own, stays.
   */
  if (settings.personaName && replyText.trim()) {
    if (heardIntroBefore) {
      const trimmed = stripRepeatIntro(replyText, settings.personaName, clinicName);
      if (trimmed !== replyText) {
        replyText = trimmed;
        if (structure) structure = { ...structure, body: stripRepeatIntro(structure.body, settings.personaName, clinicName) };
      }
    }
  }

  const latinPatient = settings.aiFirst && (latinNow || (conversation.lastLatin === true && !/[؀-ۿ]/.test(text)));
  /*
   * ...and whether the model actually wrote in Latin script.
   *
   * Franco-Arabic is the case that breaks "the patient's script decides": "tmam 3ayza a7gz" is
   * Latin without being English, and the model answers it in Arabic about as often as in Franco.
   * When it chose Arabic and the fixed lines were translated anyway, one message came out reading
   * "عندي مثلاً Monday 7/9 الساعة 3:00 PM" — two languages in one sentence, which is worse than
   * either language would have been. The reply the model wrote is the better witness, so it gets
   * the casting vote; a turn with no model reply falls back to the patient's own script.
   */
  const localize = modelWroteInArabic === true ? false : latinPatient;
  if (localize) {
    const localized = localizeOutbound(replyText, structure);
    replyText = localized.text;
    structure = localized.structure;
  }

  // A promise of a person, made while the clinic is shut, says when the person will actually be
  // there. "في أقرب وقت" at 1am on a Thursday and on the Friday it is closed were the same words.
  if (handoff && profile && replyText.trim() && !reason.startsWith("appointment_") && !reason.startsWith("ai_cancel") && !reason.startsWith("ai_late")) {
    const st = openRightNow(profile.schedule);
    if (!st.open) replyText = `${replyText}\n\n${latinPatient ? closedNoteEn(profile.schedule) : closedNote(profile.schedule)}`;
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
      reason.startsWith("media_") && args.mediaNote
        ? args.mediaNote.urgent
          ? "urgent"
          : "normal"
        : reason === "clinical" || reason.startsWith("media_") || reason === "ai_handoff_medical"
        ? "urgent"
        : reason === "complaint" || reason === "ai_handoff_complaint"
          ? "complaint"
          : "normal";
    if (!args.dryRun) await markHandoff(clinicId, conversation.phoneKey, reason, {
      text: args.media && !text.trim() ? (args.mediaNote ? `🖼️ ${args.mediaNote.summary}` : `[${args.media}]`) : text,
      phone,
      patientId: patient?.id,
      patientName: ctx.patientName,
      severity,
    });
    // Appointment changes already pushed their own, more specific notification above — under
    // either name: the typed intent writes `appointment_*`, the model's own action `ai_cancel` /
    // `ai_late`, and for a while the second name slipped past this guard and pushed twice.
    if (!reason.startsWith("appointment_") && reason !== "ai_cancel" && reason !== "ai_late") {
      const who = ctx.patientName || phone || "مريض";
      const preview = (args.media && !text.trim() ? "" : text).replace(/\s+/g, " ").trim().slice(0, 90);
      void push(
        clinicId,
        {
          title:
            severity === "urgent"
              ? "⚠️ مريض محتاج رد فوري"
              : severity === "complaint"
                ? "شكوى من مريض 🙏"
                : "مريض محتاج حد يرد 💬",
          body: preview
            ? `${who} — ${preview}`
            : args.mediaNote
              ? `${who} بعت صورة: ${args.mediaNote.summary.slice(0, 110)}`
              : `${who} بعت ${args.media === "audio" ? "رسالة صوتية" : "صورة"}`,
        },
        {
          roles: ["Owner", "Admin", "Receptionist"],
          channel: "alpha_bookings",
          // The phone opens the conversation itself (chatId) where the app is new enough to have
          // a chats screen; an older build ignores it and falls back to the patient's record, or
          // to the day for a stranger.
          data: { chatId: conversation.phoneKey, ...(patient?.id ? { patientId: patient.id } : { screen: "day" }) },
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
        // Absent `pending` CLEARS the stored options. A turn that says nothing — a sticker, a
        // silent handoff, a duplicate — has not replaced the list the patient is looking at, so
        // it must carry that list forward or the next tap books against nothing.
        pending: withSpokenSlots(pending ?? (String(nextState).startsWith("booking_") ? pendingFrom(conversation) : undefined)),
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
  let body =
    conversation.state === "new" && !courtesy
      ? appendOptOutFooter(replyText, latinPatient ? "— To stop these messages, reply: STOP" : WHATSAPP_OPT_OUT_FOOTER_AR)
      : replyText;
  /*
   * The footer belongs on the interactive body too.
   *
   * The old test was `structure.body === replyText`, which only holds for the plainest replies —
   * every menu, day list and time list builds its own shorter heading, so the clinic's very first
   * automated message to a number, the one message that most needs a STOP line, went out without
   * one. The footer that was appended is appended there as well, whatever the body says.
   */
  if (structure && body !== replyText) {
    structure = { ...structure, body: `${structure.body}${body.slice(replyText.length)}` };
  }

  /*
   * Human pacing.
   *
   * A reply that lands 400ms after the question is the loudest tell there is. With the human
   * touch on, the reply waits a reading-and-typing pause (a second, plus a little per character,
   * capped), and a long plain answer goes out as two bubbles a few seconds apart, split at its
   * first paragraph break — the way a receptionist actually types on a phone. Lists and button
   * messages are never split; the playground skips the waits.
   */
  const pace = settings.humanTouch && !args.dryRun && !args.media;
  let secondBubble = "";
  if (pace && !structure && body.length > 180) {
    const cut = body.indexOf("\n\n", Math.min(80, body.length));
    if (cut > 40 && body.length - cut > 40) {
      secondBubble = body.slice(cut + 2).trim();
      body = body.slice(0, cut).trim();
    }
  }
  // The pause is measured from when the message arrived, not from when the model finished:
  // a slow model already looks like a person reading, and adding a full pause on top of it made
  // replies land 15 seconds later than a receptionist would.
  if (pace) {
    const target = Math.min(6500, 1200 + body.length * 28);
    const elapsed = Date.now() - now;
    if (target > elapsed) await new Promise((r) => setTimeout(r, target - elapsed));
  }

  let waMessageId: string | undefined;
  // Each bubble's thread line keeps the moment it actually went out, so two bubbles read in the
  // order the patient saw them — the first line is written after both sends.
  let firstSentAt = Date.now();
  let firstSent = false;
  try {
    if (!args.dryRun) waMessageId = await sendPatientWhatsAppRich(clinicId, replyTo, body, structure);
    firstSentAt = Date.now();
    firstSent = true;
    if (secondBubble) {
      await new Promise((r) => setTimeout(r, Math.min(7000, 1500 + secondBubble.length * 30)));
      await sendPatientWhatsAppRich(clinicId, replyTo, secondBubble, undefined);
      await recordThreadMessage(clinicId, replyTo, { direction: "out", author: "bot", text: secondBubble, kind: reason }, Date.now()).catch(() => {});
    }
    // The file the model chose to attach: a before/after photo, the price sheet. After the words.
    // Cast: the assignment happens inside the action dispatch and TS's flow analysis loses it here.
    const attach = aiMedia as { id: string; label: string; url: string; kind: "image" | "document" } | null;
    if (attach && !args.dryRun) {
      const cfg = await loadMetaWhatsappConfig(clinicId);
      if (cfg) {
        await new Promise((r) => setTimeout(r, 1200));
        const sent = await sendMetaWhatsappMedia({ config: cfg, to: replyTo, kind: attach.kind, link: attach.url, caption: attach.label });
        if (sent.ok) {
          await recordThreadMessage(clinicId, replyTo, { direction: "out", author: "bot", text: attach.label, media: attach.kind, kind: "ai_media", waMessageId: sent.messageId }, Date.now()).catch(() => {});
          void adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(chatId)).set({ sentMedia: FieldValue.arrayUnion(attach.id) }, { merge: true }).catch(() => {});
        }
      }
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("[bot] reply failed to send:", detail);
    await adminClinicCollection(clinicId, "whatsapp_inbound_debug").add({
      reason: "bot_send_failed",
      raw: detail.slice(0, 2000),
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    /*
     * Whether this turn is lost depends on what actually left.
     *
     * If the FIRST bubble never went, nothing reached the patient: the conversation must not
     * advance past a turn they never saw. But if the first bubble landed and the second (or the
     * attached file) failed, the patient is already holding half the answer — and returning here
     * used to discard the whole turn, so a booking that had just been written to the calendar was
     * followed by a conversation that had never heard of it. That turn is saved.
     */
    if (!firstSent) return skip("send_failed");
    await saveConversation(
      clinicId,
      conversation,
      { state: nextState, replied: true, reason, patientId: patient?.id, patientName: ctx.patientName, pending: withSpokenSlots(pending), aiExchange, medicineScreened },
      now
    );
    return { status: "replied", text: body, handoff, reason, structure };
  }

  if (!args.dryRun) await adminClinicCollection(clinicId, "whatsapp_logs").add({
    patientId: patient?.id || null,
    type: `bot_${reason}`,
    message: body,
    status: "success",
    createdAt: FieldValue.serverTimestamp(),
  });

  // The bot's own words, in the thread staff read. Never allowed to fail the turn.
  // A rehearsal (dryRun) writes to its own private play_ thread — the fake phone it carries
  // must never become a conversation on the Chats page, which is exactly what it once did.
  await recordThreadMessage(clinicId, args.dryRun ? chatId : replyTo, {
    direction: "out",
    author: "bot",
    text: body,
    kind: reason,
    waMessageId,
  }, firstSentAt).catch(() => {});

  await saveConversation(
    clinicId,
    conversation,
    {
      state: nextState,
      replied: true,
      reason,
      patientId: patient?.id,
      patientName: ctx.patientName,
      pending: withSpokenSlots(pending),
      aiExchange,
      medicineScreened,
      latin: latinNow ? true : /[؀-ۿ]/.test(text) ? false : undefined,
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

  return { status: "replied", text: body, handoff, reason, structure };
}

/** Where the patient is in the booking lists, for the model — or nothing when they are not. */
function bookingStepLabel(c: BotConversation): string {
  switch (c.state) {
    case "booking_doctor":
      return `اختيار الدكتور من قايمة: ${(c.pendingDoctors ?? []).map((d) => d || "أي دكتور").join("، ")}`;
    case "booking_day":
      return `اختيار اليوم من قايمة: ${(c.pendingDays ?? []).map(arabicDayLabel).join("، ")}${c.pendingReschedule ? " (لتعديل ميعاد موجود)" : ""}`;
    case "booking_time":
      return `اختيار الساعة يوم ${c.pendingDate ? arabicDayLabel(c.pendingDate) : ""} من: ${(c.pendingTimes ?? []).map(arabicTimeLabel).join("، ")}`;
    case "booking_name":
      return "طلبنا منه اسمه الكامل عشان نسجل الحجز";
    default:
      return "";
  }
}

/**
 * The next free appointment slots, as the salesperson may offer them.
 *
 * Times that SPAN each open day, up to six, for the dentist the conversation has already
 * settled on or any chair. Each carries a key the model must echo back exactly — the calendar
 * is consulted again at booking time, so a slot taken in the meantime is caught there.
 *
 * `askedFor` is what the patient said about timing. It matters because the model may only offer
 * what is on this list: until 2026-09-07 the list was the two EARLIEST free times of each day,
 * so a clinic open 12pm-10pm offered noon and half past noon forever, and a patient asking for
 * 9pm on Tuesday was told Tuesday had nothing while Tuesday 9pm sat free in the diary.
 */
export async function nextSlots(
  clinicId: string,
  profile: NonNullable<Awaited<ReturnType<typeof loadPublicClinicProfile>>>,
  branchId: string | null,
  doctorName: string,
  ignoreAppointmentId?: string | null,
  askedFor?: TimePreference
): Promise<Array<{ key: string; label: string }>> {
  const out: Array<{ key: string; label: string }> = [];
  try {
    const days = upcomingOpenDays(profile.schedule).slice(0, 4);
    const perDay = askedFor?.kind === "at" ? 2 : 3;

    /*
     * Two passes. The first honours what the patient asked for; if no open day can satisfy it
     * — an evening request at a clinic that shuts at 4 — the second offers the day spread out,
     * because a wrong-window time the patient can refuse beats "nothing is available", which
     * is a lie about the diary.
     */
    const freeByDay = new Map<string, number[]>();
    for (const dateKey of days) {
      const free = await computeAvailableSlots({ clinicId, dateKey, doctorName: doctorName || null, branchId, profile, ignoreAppointmentId: ignoreAppointmentId || null });
      freeByDay.set(dateKey, free.map((t) => parseApptTimeToMinutes(t)));
    }

    for (const preference of [askedFor ?? null, null]) {
      for (const dateKey of days) {
        const free = freeByDay.get(dateKey) ?? [];
        for (const minutes of pickOfferedTimes(free, perDay, preference)) {
          const time = minutesToTimeKey(minutes);
          const key = `${dateKey}|${time}|${doctorName}`;
          if (out.some((s) => s.key === key)) continue;
          out.push({ key, label: `${arabicDayLabel(dateKey)} الساعة ${arabicTimeLabel(time)}${doctorName ? ` مع ${doctorName}` : ""}` });
        }
        if (out.length >= 6) break;
      }
      if (out.length) break;
    }
  } catch (e) {
    // No calendar, no offer — but say why in the flight recorder; silence here hid a bug once.
    void adminClinicCollection(clinicId, "ai_debug")
      .add({ kind: "slots_error", error: e instanceof Error ? e.message : String(e), createdAt: FieldValue.serverTimestamp() })
      .catch(() => {});
  }
  return out;
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
): Promise<{
  thread: AiThreadLine[];
  patient: AiPatientContext;
  knowledge: Array<{ q: string; a: string }>;
  playbook: string;
  media: Array<{ id: string; label: string; when: string; url: string; kind: "image" | "document" }>;
  gapMinutes: number;
  dossier?: PatientDossier;
}> {
  const key = conversationKey(chatId);
  const [threadSnap, knowledgeSnap, playbookSnap, upcoming, mediaSnap, convSnap] = await Promise.all([
    adminClinicDoc(clinicId, "whatsapp_conversations", key).collection("messages").orderBy("at", "desc").limit(16).get().catch(() => null),
    adminClinicCollection(clinicId, "bot_knowledge").where("status", "==", "approved").limit(40).get().catch(() => null),
    adminClinicDoc(clinicId, "settings", "bot_playbook").get().catch(() => null),
    patient ? findNextAppointment(clinicId, patient.id).catch(() => null) : Promise.resolve(null),
    adminClinicCollection(clinicId, "bot_media").limit(20).get().catch(() => null),
    adminClinicDoc(clinicId, "whatsapp_conversations", key).get().catch(() => null),
  ]);
  // A file already sent in this conversation is not offered again.
  const sentMedia = new Set<string>(Array.isArray(convSnap?.data()?.sentMedia) ? (convSnap!.data()!.sentMedia as string[]) : []);
  const media = (mediaSnap?.docs ?? [])
    .map((d) => {
      const m = d.data() || {};
      return { id: d.id, label: String(m.label || ""), when: String(m.when || ""), url: String(m.url || ""), kind: (m.kind === "document" ? "document" : "image") as "image" | "document" };
    })
    .filter((m) => m.url && m.label && !sentMedia.has(m.id));
  /*
   * A sitting, not a lifetime. The thread is read newest-first and cut at the first silence of
   * 45 minutes or more that precedes the message being answered: what came before it is still
   * shown (context), but the model is told it is history — a "Hi" twenty minutes after an
   * unanswered "who are you" must be met as a fresh hello, not as a reply to the old question.
   */
  const rows = (threadSnap?.docs ?? []).map((d) => d.data() || {});
  let gapMinutes = 0;
  if (rows.length >= 2) {
    // rows[0] is the newest (the patient's current message); the gap is between it and rows[1].
    const newest = Number(rows[0].at) || 0;
    const prev = Number(rows[1].at) || 0;
    if (newest && prev) gapMinutes = Math.round((newest - prev) / 60000);
  }
  const thread: AiThreadLine[] = rows
    .reverse()
    .map((m) => ({ author: (m.author as AiThreadLine["author"]) || "bot", text: String(m.text || "") }))
    .filter((l) => l.text.trim() && !l.text.startsWith("[") );
  const knowledge = (knowledgeSnap?.docs ?? []).map((d) => {
    const k = d.data() || {};
    return { q: String(k.question || ""), a: String(k.answer || "") };
  });
  const pb = playbookSnap?.data() || {};
  const lastVisit = typeof patient?.data.lastVisit === "string" ? patient.data.lastVisit : undefined;
  // Their own file: what was done, what is owed, what the dentist prescribed. Only ever for a
  // number the clinic has already identified — a stranger has no record to read.
  const dossier = patient ? await loadPatientDossier(clinicId, patient.id).catch(() => undefined) : undefined;

  return {
    thread,
    knowledge,
    media,
    gapMinutes,
    dossier,
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
