import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { findStaffByPhone, respondToStaffMessage } from "@/lib/bot/staffLine";
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
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { loadMetaWhatsappConfig, sendMetaWhatsappMedia } from "@/lib/metaWhatsapp";
import type { MetaInteractive } from "@/lib/metaWhatsapp";
import type { BotBrief, BotFacts, BotMedicine, BotScript } from "@/types/whatsapp";
import { cleanBrief } from "./brief";
import { cleanScripts } from "./scripts";
import { arabicClock, arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import { normalizeReplyText } from "@/lib/patientMessaging";
import { claimKey, claimOnce } from "./replyClaims";
import { locationPinLine, mapLinesBesideAddress, withPin } from "./careNote";
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
import { aiBrainOf, dryRunBrainTag, pickReply, type AiBrain } from "@/lib/botPro/brain";
import { answerWithPro } from "@/lib/botPro/answerWithPro";
import { isLatinMessage, localizeOutbound } from "./localize";
import { joinBubbles, priceBeforeQuestions, splitBubbles } from "./bubbles";
import { loadPatientDossier, type PatientDossier } from "./patientDossier";
import { appointmentLine, branchesTextOf, stripDoctorNames } from "./ownerRules";
import { isBareAgreement, resolveSpokenPick, spokenSlots } from "./spokenPick";
import { fixRelativeDayWords } from "./relativeDay";
import { holdRepeatOffer, withoutSlotOffer } from "./slotRepeat";
import { DEFAULT_SCREENING, readScreeningAnswer } from "./medicineScreen";
import { stripRepeatIntro } from "./repeatIntro";
import { feminizeAddress } from "./voiceFix";
import { tidyModelWording } from "./wordingFix";
import { SALES_CLOSE_REASONS, LEAD_INTEREST_REASONS, activeOffers, closingLine, offerForService } from "./sales";
import { markBotLeadBooked, snoozeBotLead, upsertBotLead } from "./botLeads";
import { newerPatientLines, recentThreadLines, recordThreadMessage } from "./thread";
import { lineTakesOver } from "./supersede";
import { STAFF_QUESTION_HOLD_MS, deskHearsHeldMessage, staffQuestionAt, staffQuestionCouldHold } from "./staffHold";
import { adSubjectText, adSystemLine, readStoredAd, type AdReferral } from "./adReferral";
import { checkupFees, checkupIsInAdOffer, isPlainCheckup, namesCheckup, plainCheckupPrices, stripCheckupFee } from "./offerCheckup";
import { attributionFromClicks, clickFromReferral, mergeClicks, type AdClick } from "@/lib/metaConversions";
import { clinicalReplyText,
  urgentCallLine, decideBotReply, type BotContext, type BotState } from "./engine";
import { needsHuman } from "./clinicalTriage";
import { asksPrice, isDecline, mentionsRelative, quickIntent } from "./quickAnswers";
import { markConversationDeclined } from "./conversation";
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
  | { status: "replied"; text: string; handoff: boolean; reason: string; structure?: MetaInteractive; brain?: AiBrain }
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
  /** The clinic's own trigger→reply scripts, already cleaned of rows that could never fire. */
  scripts: BotScript[];
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
  /** The owner's structured preferences (Auto-reply tab); empty means today's prompt. */
  brief: BotBrief;
  /** The name the model introduces itself with, once. */
  personaName: string;
  /** Human pacing and bubble splitting. */
  humanTouch: boolean;
  /** No dentist names in cards, lists, slot labels or AI replies; no dentist question. Default off. */
  hideDoctorNames: boolean;
  /** Add "closed now, we open at…" under a hand-off while the clinic is shut. Default off. */
  closedNote: boolean;
  /** Which brain writes AI-first replies; "standard" unless the clinic chose Pro and has the add-on. */
  aiBrain: AiBrain;
}

async function loadBotSettings(clinicId: string): Promise<BotSettings> {
  const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const d = snap.exists ? snap.data() || {} : {};
  return {
    enabled: d.botEnabled === true,
    scripts: cleanScripts(Array.isArray(d.botScripts) ? (d.botScripts as BotScript[]) : []),
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
    brief: cleanBrief(d.botBrief),
    personaName: typeof d.botPersonaName === "string" ? d.botPersonaName.trim() : "",
    humanTouch: d.botHumanTouch !== false,
    // Owners' switches. Both off unless an admin turns them on: the closed note was asked to stop
    // by the platform owner, so a clinic that wants it back opts in.
    hideDoctorNames: d.botHideDoctorNames === true,
    closedNote: d.botClosedNote === true,
    // The add-on is read only for a clinic that chose Pro: every other clinic reads what it did before.
    aiBrain: d.botAiBrain === "pro" ? aiBrainOf(d, await clinicHasFeature(clinicId, "whatsappPro").catch(() => false)) : "standard",
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

// appointmentLine (how an appointment reads in a chat message) lives in ./ownerRules, where it is tested.

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
/**
 * The ad this conversation started from, written where every reader will find it.
 *
 * Three places, one call: the conversation document (the Chats list badge, the report, and the
 * context every later turn is answered with), a line at the top of the thread so the desk sees
 * what the person saw, and a lead — created on the spot, whatever they typed. "مرحبا" from an ad
 * click is the warmest enquiry a clinic gets and used to leave no trace unless it happened to
 * contain a price question.
 *
 * The first ad wins. A person who taps two ads in a week is one person who came from the first;
 * re-attributing them would count them twice and credit the wrong creative.
 */
async function recordAdReferral(clinicId: string, chatId: string, phone: string, ad: AdReferral, text: string): Promise<void> {
  const key = conversationKey(chatId);
  const ref = adminClinicDoc(clinicId, "whatsapp_conversations", key);
  const snap = await ref.get();
  // Every click, before first-ad-wins below decides whether this one is "the" ad. Null when this
  // click id is already on the list (or Meta sent none): then nothing extra is written.
  const clicks = withNewAdClick(snap.data()?.adClicks, clickFromReferral(ad, Date.now()));
  if (readStoredAd(snap.data()?.ad)) {
    if (clicks) await ref.set({ adClicks: clicks }, { merge: true }).catch((e) => console.warn("[bot] ad click not kept:", e));
    return;
  }
  // The first ad: the click list rides on the write that was happening anyway.
  await ref.set({ ad, adAt: Date.now(), ...(clicks ? { adClicks: clicks } : {}), ...(text.trim() ? { adTypedAt: Date.now() } : {}) }, { merge: true });
  await recordThreadMessage(clinicId, chatId, { direction: "in", author: "system", text: adSystemLine(ad), kind: "ad_referral" }).catch(() => {});
  if (!phone) return;
  const interest = (await matchService(clinicId, adSubjectText(ad)).catch(() => "")) || undefined;
  await upsertBotLead({
    clinicId,
    phone,
    interest,
    question: text.trim() || "فتح المحادثة من الإعلان ولسه مكتبش",
    reason: "ad_referral",
    ad,
  });
}

/**
 * The conversation's ad-click list with this click added — or null when there is nothing to write.
 *
 * `ad` above is first-ad-wins because the reports credit the creative that brought somebody. The
 * Conversions API asks a different question: which click came right before THIS booking. A
 * patient who tapped a whitening ad in March and an implant ad in May books in May because of the
 * second, and Meta should hear about the second click id. So the clicks are kept as a list
 * beside `ad` (lib/metaConversions `mergeClicks`: newest first, one entry per click id, ten at
 * most, and each click keeps the time it was FIRST seen).
 *
 * Only the conversation, and only from the snapshot the caller already read. This runs for every
 * clinic, on the message path, before the reply — so it may not look anything up. It once also
 * found the patient behind the chat to copy the click onto the record, and that lookup could scan
 * thousands of patient documents for a stranger's number on every ad click, in clinics that never
 * switched the Conversions API on. The sender (lib/metaConversionsServer `clicksForPatient`)
 * reads this list itself when an appointment is due to be reported, and only for clinics that
 * did, so nothing is lost by leaving the patient alone here.
 *
 * Written ONLY when a click id appears that the list does not hold yet. Null when Meta sent no
 * click id, or this click id is already there: Meta re-attaches the same ctwa_clid when somebody
 * taps the same ad again, and that repeat must not touch the stored click — its time is when the
 * click was first seen, and moving it later could put it after a booking it caused (the sender
 * would then report "no_click"). A repeat costs no write.
 */
function withNewAdClick(existing: unknown, click: AdClick | null): AdClick[] | null {
  if (!click) return null;
  // Every stored id, not just the ten mergeClicks keeps by default.
  const known = new Set(mergeClicks(existing, [], Number.MAX_SAFE_INTEGER).map((c) => c.ctwaClid));
  if (known.has(click.ctwaClid)) return null;
  return mergeClicks(existing, [click]);
}

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

/**
 * Reasons whose reply shows the numbered menu (buttons attached below) or ends with "send *3*
 * to change it", so the next bare digit is a menu key even in salesperson mode.
 */
const MENU_ON_SCREEN_REASONS = new Set(["greeted", "reprompt", "back_to_menu", "hours", "booked"]);

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
  /** WhatsApp's id of this message, when the channel gave one: tells a newer message from a redelivered copy. */
  messageId?: string;
  /**
   * The `at` of this message's own thread line. "Did the patient write again?" is measured from
   * here, not from when this turn started: the line is written first, and a second message landing
   * in the same second is newer than this one even though it is older than this turn's start.
   * Absent (no line was written, or it did not hold the words yet: a voice note, whose transcript
   * is attached just before this turn starts): the turn's start, as before — a message that came
   * while the voice note was being transcribed was answered by a model that never heard it.
   */
  receivedAt?: number;
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
  /**
   * What the model saw in a photo. `summary` and `urgent` are for staff; `impression` (dental
   * photos only) may reach the patient as a preliminary reading, with the disclaimer added here.
   */
  mediaNote?: { summary: string; urgent: boolean; interest?: string; impression?: string; category?: "dental" | "document" | "other" };
  /**
   * The ad or post this message's conversation started from — present on the FIRST message of
   * a Click-to-WhatsApp conversation only, on either channel. Recorded on the conversation
   * before any gate, so the clinic knows where the person came from even when the bot is off.
   */
  ad?: AdReferral;
  /**
   * Not a message: the person opened the chat from an ad and has not typed. Sent by Meta only
   * when the clinic switched the welcome message on. The bot greets and names the ad.
   */
  welcome?: boolean;
  /** The playground's "try the Pro brain" switch. Ignored unless dryRun; the route checks the add-on. */
  brainOverride?: AiBrain;
  /** The playground's "use the draft layer" switch. Honoured only with dryRun; a live reply never sees a draft. */
  proLayer?: "draft";
}): Promise<BotOutcome> {
  const { clinicId, chatId, text } = args;
  const now = args.now ?? Date.now();

  /*
   * The clinic's own people first. A number entered on Settings → Alerts & reports is the owner
   * or a colleague, whatever patient record happens to share it — the owner once wrote "Hi" to
   * his own clinic and was greeted as a patient and offered a check-up. Checked before every
   * patient gate (bot switch, plan, opt-out, strangers), because none of those is about them.
   */
  const senderPhone = /^\d{8,15}$/.test(args.phone || "") ? `+${args.phone}` : args.phone || "";
  if (senderPhone && !args.dryRun) {
    const staff = await findStaffByPhone(clinicId, senderPhone).catch(() => null);
    if (staff) return respondToStaffMessage({ clinicId, to: senderPhone, text, sender: staff });
  }

  // Every staff notification goes through this; the playground swaps in silence.
  const push: typeof sendClinicPush = args.dryRun
    ? async () => ({ raised: false, bellWritten: false, pushed: 0, whatsapped: 0 })
    : sendClinicPush;

  /*
   * Where they came from, before whether we answer. The ad is on the wire for exactly one
   * message; every gate below that ends the turn early (bot off, not in plan, stranger) would
   * otherwise lose it, and the clinic paid for that click whether or not the bot is on.
   */
  if (args.ad && !args.dryRun) {
    await recordAdReferral(clinicId, chatId, senderPhone, args.ad, text).catch((e) => console.warn("[bot] ad referral not recorded:", e));
  }

  const settings = await loadBotSettings(clinicId);
  // The test chat (dryRun) still answers with auto-reply off: that is how an owner sets up and
  // rehearses a mode before letting it talk to patients. A rehearsal sends nothing to anyone.
  if (!settings.enabled && !args.dryRun) return skip("bot_disabled");
  // The receptionist is an add-on on top of automatic messages. The clinic's own toggle above
  // says whether they WANT it; this says whether they have PAID for it. Checked here, at the
  // one door every inbound message passes, so a switched-off clinic's bot stays silent whatever
  // the settings page still shows.
  if (!(await clinicHasFeature(clinicId, "whatsappBot"))) return skip("bot_not_in_plan");

  // A bot needs to be able to answer by itself. In manual delivery there is nobody at a screen at
  // the moment the patient writes — queueing a reply for someone to tap tomorrow is not a
  // conversation, it is a worse version of the message they already sent.
  const mode = await resolveWhatsappDeliveryMode(clinicId, { purpose: "bot" });
  if (mode !== "auto") return skip("no_gateway");

  // The same words from the same number inside 20 seconds are one message — a double tap on a
  // button, a message sent twice on a bad connection. Answered once. See lib/bot/replyClaims.
  if (text.trim() && !args.dryRun && !(await claimOnce(clinicId, claimKey("in", conversationKey(chatId), text), 20_000, now))) {
    return skip("duplicate_inbound");
  }

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
  let claimedNow = "";
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
      } else {
        // Nobody on file for that number: a NEW patient behind a lid. The number is kept on the
        // thread (claimedPhone) and, from the next line on, this chat has a phone — booking can
        // ask their name and create the record exactly as it does for a visible number. Replies
        // keep going to the lid thread, which is the chat the patient is actually looking at.
        claimedNow = claimed;
        await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(chatId)).set({ claimedPhone: claimed, claimedPhoneAt: now }, { merge: true });
      }
    }
  }

  /*
   * Where the reply must go. A lid is a valid reply address on the gateway (lib/whatsapp.ts:
   * verified live 2026-08-29), so a sender the system cannot name is still answered — as a
   * stranger with no record: questions, prices, the address. Booking needs a phone (canRegister),
   * and the engine and both brains ask for it instead (phoneHidden). Until Nov 2026 such chats
   * were handed to a person without a word; at Asnany that was 17% of all chats.
   */
  const replyTo = phone || chatId;

  // A patient who asked to be left alone asked to be left alone. This is checked before the
  // engine, so no branch of it can ever talk to someone who opted out.
  if (patient?.data.whatsappOptOut === true) {
    // Opt-out means no automated messages TO them. It does not mean a swollen face goes unseen:
    // a person is still told, the bot just does not answer.
    if (needsHuman(text)) {
      await markHandoff(clinicId, conversationKey(chatId), "opted_out_urgent", {
        text, phone, patientId: patient.id, patientName: String(patient.data.name || ""), severity: "urgent",
      });
      void push(clinicId, { title: "⚠️ مريض (موقف الرسايل) محتاج رد فوري", body: `${String(patient.data.name || phone)} — ${text.slice(0, 90)}` }, { event: "optedOutPatientNeedsReply", channel: "alpha_bookings", data: { chatId: conversationKey(chatId), patientId: patient.id, screen: "chats" } });
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
  // A lid sender who gave their number, now or on an earlier turn: identity from the number,
  // replies still to the lid thread.
  const claimedPhone = claimedNow || (isLidChat && !phone ? conversation.claimedPhone || "" : "");
  if (claimedPhone && !phone) {
    phone = claimedPhone;
    if (!patient) patient = await findPatient(clinicId, phone);
  }

  // An ad tap opens a chat; this is the moment the person behind it actually said something.
  // Once per number — the ads report separates "clicked" from "wrote" on it.
  if (conversation.ad && !conversation.adTypedAt && text.trim() && !args.dryRun) {
    void adminClinicDoc(clinicId, "whatsapp_conversations", conversation.phoneKey).set({ adTypedAt: now }, { merge: true }).catch(() => {});
  }

  // "Not now" is remembered before anything answers it, so the gracious one-line reply below is
  // the LAST automated message this person gets until a human decides otherwise.
  if (!args.dryRun && isDecline(text)) {
    void markConversationDeclined(clinicId, chatId).catch(() => {});
    if (phone) void snoozeBotLead(clinicId, phone).catch(() => {});
  }

  // A stop request recorded against this sender directly — the only place it can live when a lid
  // hides the patient record. Survives conversation expiry; see markConversationOptedOut.
  if (conversation.optedOut) {
    if (needsHuman(text)) {
      await markHandoff(clinicId, conversation.phoneKey, "opted_out_urgent", { text, phone, severity: "urgent" });
      void push(clinicId, { title: "⚠️ مريض (موقف الرسايل) محتاج رد فوري", body: `${phone} — ${text.slice(0, 90)}` }, { event: "optedOutPatientNeedsReply", channel: "alpha_bookings", data: { chatId: conversation.phoneKey, screen: "chats" } });
    }
    return skip("opted_out");
  }

  const allowance = replyAllowance(conversation, now);
  if (!allowance.allowed) {
    /*
     * Out of budget — but a budget is a ban-protection device, not a triage rule. A message that
     * trips the clinical words is exactly the message that must not be swallowed here, so it is
     * flagged urgent and pushed to staff before we go quiet; the reply itself is still withheld,
     * which is the whole point of the cap.
     */
    const urgent = needsHuman(text);
    /*
     * A burst is held, not handed over. The seven photos of a forwarded album are one event: the
     * first was answered, the rest are on the thread for staff, and raising a handoff row for
     * each would put six "needs reply" rows in the inbox for a message nobody sent on purpose.
     * The state is left as it was, so the person's next message a minute later is answered.
     */
    if (allowance.reason === "burst" && !urgent) {
      await saveConversation(clinicId, conversation, { state: conversation.state, replied: false, reason: "burst", pending: pendingFrom(conversation) }, now);
      return skip("burst");
    }
    await markHandoff(clinicId, conversation.phoneKey, urgent ? "limit_urgent" : allowance.reason || "limit", {
      text,
      phone,
      severity: urgent ? "urgent" : "normal",
    });
    if (urgent) {
      void push(
        clinicId,
        { title: "⚠️ مريض محتاج رد فوري", body: `${phone} — ${text.slice(0, 90)}` },
        { event: "urgentPatientMessage", channel: "alpha_bookings", data: { chatId: conversation.phoneKey, screen: "chats" } }
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
  const ctx: BotContext = { clinicName, facts: { ...settings.facts, offers: offersActive }, scripts: settings.scripts };
  ctx.offersExpired = Boolean(settings.facts.offers?.trim()) && !offersActive;

  let profile: PublicClinicProfile | null = null;
  // Two or more branches, one line each, for both brains; "" for everyone else (prompt unchanged).
  let branchesText = "";
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
    // "مكان بعيد عني" was answered with a promise of "the other branch's details" and nothing
    // else: neither brain had ever been told the clinic has one.
    branchesText = branchesTextOf(profile.branches);
  } catch {
    // No clinic_info at all. The menu offers the receptionist instead of inventing anything.
  }
  // Booking needs a configured schedule (never offer times from the 9-to-9 fallback) and an
  // identified patient (a booking must belong to somebody). A real phone with nobody on file is
  // a NEW patient: the bot may ask their name and create the record, exactly as the public
  // booking page does for strangers — a lid sender with no phone can register nothing.
  ctx.canOfferBooking = Boolean(profile?.schedule.isConfigured && patient);
  ctx.canRegister = Boolean(profile?.schedule.isConfigured && !patient && phone);
  // WhatsApp hid the number and nobody has typed it yet: booking asks for it instead of a hand-off.
  ctx.phoneHidden = isLidChat && !phone;
  // Hidden names: the engine never opens the dentist question; booking goes to days (any chair).
  ctx.doctorCount = settings.hideDoctorNames ? 0 : profile?.doctors.length ?? 0;
  if (patient && typeof patient.data.name === "string") ctx.patientName = patient.data.name;
  ctx.gender = guessGender(ctx.patientName);
  ctx.dayWord = parseDayWord(text, clinicNow().dateKey) || undefined;
  ctx.relative = mentionsRelative(text);
  ctx.forRelative = conversation.pendingForRelative === true;
  ctx.serviceMatch = (await matchService(clinicId, text)) || undefined;
  /*
   * The ad they came from, on every turn: the model is told each time (it is a fact about the
   * person, like their name), and the greeting names it. The ad's SERVICE fills in only on the
   * referral turn itself — "مرحبا" from someone who tapped the whitening ad is about whitening,
   * so the lead and any booking that follows carry it — never on a message weeks later, where a
   * question about braces must not be read as whitening because of an old click.
   */
  ctx.ad = args.ad ?? conversation.ad;
  ctx.welcome = args.welcome === true;
  if (ctx.ad) {
    const adService = (await matchService(clinicId, adSubjectText(ctx.ad))) || "";
    if (adService && offersActive) ctx.adOfferLine = offerForService(offersActive, adService) || undefined;
    if (adService && !ctx.serviceMatch && (args.ad || ctx.welcome)) ctx.serviceMatch = adService;
  }
  /*
   * Came from an ad for the running offer, and that offer includes the check-up (lib/bot/
   * offerCheckup): the clinic's ordinary check-up fee is not this patient's price. A patient from
   * the "كشف + تنظيف وتلميع بـ 299" ad was told "والكشف عموماً 200 ج.م". False for every chat
   * without an ad, every clinic without a running offer, an offer that does not mention the
   * check-up, and an ad that neither names it nor quotes one of the offer's prices — and then
   * nothing below changes.
   */
  const checkupInOffer = Boolean(ctx.ad && offersActive && checkupIsInAdOffer({ adText: adSubjectText(ctx.ad), offersText: offersActive }));
  ctx.aiAvailable = settings.aiEnabled && (settings.aiMaxReplies === 0 || (conversation.aiReplies ?? 0) < settings.aiMaxReplies);
  ctx.aiFirst = settings.aiFirst;
  // The replies that put a numbered menu on the screen, or end with "send *3* to change it".
  ctx.menuShown = MENU_ON_SCREEN_REASONS.has(String(conversation.lastReason || ""));
  // Remembered so a tapped button, a bare digit or an emoji keeps the language the patient chose.
  const latinNow = isLatinMessage(text);
  // Only asked when it matters: sales mode and a one-word acknowledgement on the table — this
  // message's, or (lib/bot/supersede) a newer one's. One lookup per turn at most.
  let soonLookup: Promise<boolean> | null = null;
  const soonAppointment = (): Promise<boolean> => {
    const p = patient;
    if (!p) return Promise.resolve(false);
    soonLookup ??= (async () => {
      const soon = await findNextAppointment(clinicId, p.id).catch(() => null);
      const limit = new Date(`${clinicNow().dateKey}T12:00:00`);
      limit.setDate(limit.getDate() + 2);
      return Boolean(soon && soon.date <= limit.toISOString().slice(0, 10));
    })();
    return soonLookup;
  };
  if (settings.aiFirst && patient && quickIntent(text) === "ack") ctx.hasSoonAppointment = await soonAppointment();
  ctx.clinicalMode = settings.clinicalDentist ? "dentist" : "handoff";
  if (conversation.state === "booking_doctor") ctx.optionCount = conversation.pendingDoctors?.length ?? 0;
  if (conversation.state === "booking_day") ctx.optionCount = conversation.pendingDays?.length ?? 0;
  if (conversation.state === "booking_time") ctx.optionCount = conversation.pendingTimes?.length ?? 0;

  /*
   * Does a person hold this thread? Staff took it over, or wrote inside the claim minutes
   * (loadConversation) — or their last message asked the patient something and this is the
   * answer, which only the thread can tell (lib/bot/staffHold). Then the bot says nothing at all:
   * no photo to the model, no "وصلتنا…" line, no model dentist. The desk is told, below.
   * The thread is read inside the claim minutes too: an answer to a staff question is the desk's
   * news whenever it comes, a reply to a staff statement is not.
   */
  const pausedByStaff = conversation.staffPaused === true;
  let staffAskedAtMs = 0;
  if (!pausedByStaff && staffQuestionCouldHold(conversation.staffWroteAtMs, now)) {
    const wrote = conversation.staffWroteAtMs || 0;
    const lines = await recentThreadLines(clinicId, chatId, Math.max(now - STAFF_QUESTION_HOLD_MS, wrote - 10 * 60 * 1000));
    staffAskedAtMs = staffQuestionAt(lines, wrote, now);
  }
  const heldByStaff = conversation.staffActive === true || staffAskedAtMs > 0;
  ctx.heldByStaff = heldByStaff;
  // A handoff flag with nobody behind it must not mute the salesperson: the flag stays for the
  // desk, the model keeps helping. A person who actually wrote, took the thread over, or asked the
  // patient something still owns it. (Also the state a newer message is judged in: see the send.)
  const engineState: BotState = heldByStaff ? "handed_off" : settings.aiFirst && conversation.state === "handed_off" ? "awaiting_choice" : conversation.state;

  /*
   * A photo, a voice note, a video: acknowledged and handed straight to a person.
   *
   * Stickers and reactions are the exception — they are punctuation, not a message, and answering
   * every thumbs-up sticker with "someone will look at this" is how a helpful bot becomes noise.
   * Everything else gets a person, because the clinic cannot know what it did not see, and the
   * worst thing this branch can do is be slightly over-eager on a photo of a parking spot.
   */
  /*
   * A photo the model has already read goes to the model, in sales mode: the reading (and, for
   * a dental photo, the preliminary impression) is in its prompt, so it can answer the picture
   * the way it answers a sentence — and, in dentist mode, as the desk dentist. The fixed "we got
   * your photo, someone will look" stays for clinics without the salesperson, for voice notes
   * that could not be transcribed, and for photos the describer could not read. In a thread a
   * person holds, neither: the photo is theirs to answer.
   */
  const photoToModel = !heldByStaff && args.media === "image" && !text.trim() && Boolean(args.mediaNote) && settings.aiFirst && ctx.aiAvailable;
  const decision = photoToModel
    ? {
        reply: "",
        action: {
          type: "ai" as const,
          question: `[المريض بعت صورة] ${args.mediaNote!.summary}`,
          clinical: ctx.clinicalMode === "dentist" && args.mediaNote!.category === "dental",
        },
        next: "awaiting_choice" as const,
        handoff: false,
        reason: "photo_ai",
      }
    : args.media && args.media !== "sticker" && !text.trim()
      ? heldByStaff
        ? { reply: "", next: "handed_off" as const, handoff: false, reason: "already_with_a_human" }
        : {
            reply:
              args.media === "audio"
                ? "وصلتنا الرسالة الصوتية 🎙️ حد من العيادة هيسمعها ويرد عليك حالاً."
                : "وصلتنا الصورة 📷 حد من العيادة هيشوفها ويرد عليك حالاً.\n\nلو الموضوع طارئ كلمنا على طول." +
                  (ctx.clinicPhone ? ` على ${ctx.clinicPhone}` : ""),
            next: "handed_off" as const,
            handoff: true,
            reason: `media_${args.media}`,
          }
      : decideBotReply({ state: engineState, text, ctx });

  /*
   * The patient wrote to a person and the bot said nothing — so that person is told: a paused
   * chat, the answer to a staff question, a photo or voice note, anything urgent
   * (deskHearsHeldMessage). needsHuman puts the chat in "مستني رد" (and lets handoffSla chase
   * it); one push goes out per staff message, keyed on it so two quick messages do not push
   * twice. 2026-11-14: a paused chat's "إيقاف.. ولكم الشكر" raised nothing at all and was seen by
   * nobody — and handoffSla skips paused chats, so the push here is the only one they get.
   */
  const heldMediaOnly = Boolean(args.media && args.media !== "sticker" && !text.trim());
  // Weighed as the media handoff weighs it: an unread photo or voice note is urgent unless it was
  // read and looked calm. A symptom is urgent.
  const heldSeverity: HandoffSeverity = (heldMediaOnly && !(args.mediaNote && !args.mediaNote.urgent)) || needsHuman(text) ? "urgent" : "normal";
  if (
    !args.dryRun &&
    heldByStaff &&
    decision.reason === "already_with_a_human" &&
    deskHearsHeldMessage({ paused: pausedByStaff, askedAtMs: staffAskedAtMs, mediaOnly: heldMediaOnly, urgent: heldSeverity === "urgent" })
  ) {
    const mediaOnly = heldMediaOnly;
    const severity = heldSeverity;
    const said = mediaOnly ? (args.mediaNote ? `🖼️ ${args.mediaNote.summary}` : `[${args.media}]`) : text;
    await markHandoff(clinicId, conversation.phoneKey, "patient_replied_to_staff", {
      text: said,
      phone,
      patientId: patient?.id,
      patientName: ctx.patientName,
      severity,
    });
    const staffSinceMs = Math.max(conversation.staffWroteAtMs || 0, conversation.pausedAtMs || 0);
    const tell = await claimOnce(clinicId, `held_${conversation.phoneKey}_${staffSinceMs}_${severity}`, 24 * 60 * 60 * 1000, now);
    if (tell) {
      const who = ctx.patientName || phone || "مريض";
      const preview = mediaOnly ? "" : text.replace(/\s+/g, " ").trim().slice(0, 90);
      const sent =
        args.media === "audio" ? "رسالة صوتية" : args.media === "video" ? "فيديو" : args.media === "document" ? "ملف" : args.media === "location" ? "لوكيشن" : "صورة";
      void push(
        clinicId,
        {
          title: severity === "urgent" ? "⚠️ مريض رد على الاستقبال ومحتاج رد فوري" : "مريض رد على الاستقبال 💬",
          body: preview
            ? `${who} — ${preview}`
            : args.mediaNote
              ? `${who} بعت صورة: ${args.mediaNote.summary.slice(0, 110)}`
              : `${who} بعت ${sent}`,
        },
        {
          event: severity === "urgent" ? "urgentPatientMessage" : "patientRepliedAfterClaim",
          channel: "alpha_bookings",
          data: { chatId: conversation.phoneKey, ...(patient?.id ? { patientId: patient.id } : { screen: "chats" }) },
        }
      );
    }
  }

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
  /** Which brain wrote the AI reply this turn; reported to the test chat only. */
  let brainUsed: AiBrain | undefined;
  /** The patient's messages this sales-mode reply also answers (sent together, still unanswered). */
  let askedTogether: string[] = [];
  /** The bot's (or staff's) turn just before those messages: what the patient was answering. */
  let answeredTurn: string[] = [];
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
      // Names hidden by the owner: no dentist question at all — days for any chair, exactly the
      // "أي دكتور 👌" pick (the appointment is written with doctor ""). Every caller lands here.
      if (settings.hideDoctorNames) {
        listDays("");
        return;
      }
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
      const heading = doctorName && !settings.hideDoctorNames ? `📅 اختار اليوم اللي يناسبك مع ${doctorName}:` : "📅 اختار اليوم اللي يناسبك:";
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
          ...(doctorName && !settings.hideDoctorNames ? [`👨‍⚕️ ${doctorName}`] : []),
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
            ...(doctorName && !settings.hideDoctorNames ? [`👨‍⚕️ ${doctorName}`] : []),
            "",
            `${v.waitingForYou} 🦷`,
          ].join("\n");
          nextState = "awaiting_choice";
          reason = "rescheduled";
          rescheduleId = "";
          void push(
            clinicId,
            { title: "تعديل ميعاد من واتساب 🔁", body: `${ctx.patientName || phone} — ${dateKey} ${time}${doctorName ? ` — ${doctorName}` : ""}` },
            { event: "botRescheduled", channel: "alpha_bookings", data: { screen: "day" } }
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
            ...(doctorName && !settings.hideDoctorNames ? [`👨‍⚕️ ${doctorName}`] : []),
            ...(treatment ? [`🦷 ${treatment}`] : []),
            "",
            settings.autoConfirm
              ? `${v.waitingForYou} 🦷 لو حبيت تعدّل الميعاد، ${v.send} *3*.`
              : `العيادة هتراجع الطلب وهتتواصل مع حضرتك للتأكيد. لو حبيت تعدّل، ${v.send} *3*.`,
            // The care note: where to come, how to park, what the first visit is. The message a
            // receptionist adds by hand when there is time, which is never.
            ...(ctx.addressText?.trim() ? ["", `📍 ${ctx.addressText.trim()}`] : []),
            // Not the raw field: a clinic that pasted its address above the link would say it twice.
            ...(mapLinesBesideAddress(ctx.addressText, ctx.facts?.mapsUrl) ? [mapLinesBesideAddress(ctx.addressText, ctx.facts?.mapsUrl)] : []),
            ...(ctx.facts?.parking?.trim() ? [`🅿️ ${ctx.facts.parking.trim()}`] : []),
            // Someone who came from an ad for a running offer booked the OFFER. Quoting the
            // ordinary consultation fee under their confirmation ("الكشف 200 ج.م") contradicts
            // the price they were just promised, so the fee line is left out for them.
            ...(ctx.facts?.consultation?.trim() && !(ctx.ad && offersActive) ? [`ℹ️ ${ctx.facts.consultation.trim()}`] : []),
          ].join("\n");
          nextState = "awaiting_choice";
          reason = "booked";
          // The desk hears about it the moment it lands, same as an online booking — the whole
          // point of a bot is that nobody was at a screen when this arrived.
          void push(
            clinicId,
            { title: "حجز جديد من واتساب 🤖", body: `${ctx.patientName || "Patient"} — ${dateKey} ${time}${doctorName ? ` — ${doctorName}` : ""}` },
            { event: "botBooked", channel: "alpha_bookings", data: { screen: "day" } }
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
        const intro = ["تمام، هنعدّل ميعادك ده 🔁", "", appointmentLine(appt, settings.hideDoctorNames), ""].join("\n");
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
          appointmentLine(appt, settings.hideDoctorNames),
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
          { event: "botCancelled", channel: "alpha_bookings", data: { screen: "day" } }
        );
        return;
      }

      const label = kind === "cancel" ? "إلغاء" : kind === "reschedule" ? "تعديل" : "تأخير";
      replyText = appt
        ? [`وصلتنا رسالتك بخصوص ${label} الميعاد 👍`, "", appointmentLine(appt, settings.hideDoctorNames), "", "الاستقبال هيتواصل معاك حالاً يأكدلك."].join("\n")
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
        { event: "patientRequestedChange", channel: "alpha_bookings", data: { screen: "day" } }
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
        replyText = [`تمام، ${v.waitingForYou} 🦷`, "", appointmentLine(appt, settings.hideDoctorNames)].join("\n");
      } else {
        const need = ctx.gender === "female" ? "محتاجة" : "محتاج";
        replyText = `تمام 🙏 لو حضرتك ${need} أي حاجة تانية إحنا هنا.`;
        reason = "ack";
      }
    } else if (act.type === "my_appointment") {
      const appt = patient ? await findNextAppointment(clinicId, patient.id) : null;
      if (appt) {
        replyText = [`ميعادك الجاي 👇`, "", appointmentLine(appt, settings.hideDoctorNames), "", "لو حابب تعدله أو تلغيه ابعتلنا وهنظبطهولك."].join("\n");
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
          // An offer patient whose offer covers the check-up is not shown its ordinary fee.
          if (!name || price <= 0 || (checkupInOffer && isPlainCheckup(name))) return "";
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
      const salesContext = sales ? await loadSalesContext(clinicId, chatId, patient, ctx, settings.hideDoctorNames) : null;
      let slotOffer = sales && profile?.schedule.isConfigured && (ctx.canOfferBooking || ctx.canRegister) ? await nextSlots(clinicId, profile, branchId, conversation.pendingDoctor ?? "", rescheduleId || null, readTimePreference(act.question, clinicDayBoundsMinutes(profile.schedule)), settings.hideDoctorNames) : [];
      heardIntroBefore = (salesContext?.thread || []).some(
        (line) => line.author === "bot" && Boolean(settings.personaName) && line.text.includes(settings.personaName)
      );
      {
        const lines = [...(salesContext?.thread ?? [])].reverse();
        let i = 0;
        for (; i < lines.length; i++) {
          if (lines[i].author === "system") continue;
          if (lines[i].author !== "patient") break;
          askedTogether.push(lines[i].text);
        }
        // ...and the turn they are answering, every bubble of it (the location pin reads it for a branch).
        for (; i < lines.length && lines[i].author !== "patient"; i++) {
          if (lines[i].author !== "system") answeredTurn.push(lines[i].text);
        }
      }
      const aiArgs: Parameters<typeof answerWithAi>[0] = {
        clinicId,
        clinicName,
        question: act.question,
        patientName: ctx.patientName,
        hoursText: ctx.hoursText,
        addressText: ctx.addressText,
        branchesText,
        clinicPhone: ctx.clinicPhone,
        hideDoctorNames: settings.hideDoctorNames,
        phoneHidden: ctx.phoneHidden === true,
        facts: ctx.facts,
        history: conversation.aiHistory ?? [],
        mode: sales ? "sales" : "assisted",
        thread: salesContext?.thread,
        patient: salesContext?.patient,
        coaching: settings.coaching,
        brief: settings.brief,
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
        photo: args.media === "image" && args.mediaNote ? args.mediaNote : undefined,
        ad: ctx.ad,
        // Absent (not false) for everyone else, so the arguments are what they always were.
        ...(checkupInOffer ? { checkupInOffer: true } : {}),
      };
      // Pro answers sales-mode turns only, for a clinic that chose it and has the add-on (or the
      // playground trying it); any Pro failure is answered by answerWithAi with exactly these args.
      const brain: AiBrain = (args.dryRun && args.brainOverride) || settings.aiBrain;
      const brainReply = await pickReply(
        brain === "pro" && sales ? "pro" : "standard",
        () => answerWithPro({ ...aiArgs, chatId, phone, conversationPatientId: conversation.patientId, previousSlotKeys: conversation.pendingSlots, branchId, profile, ...(args.dryRun && args.proLayer ? { proLayer: args.proLayer } : {}) }),
        () => answerWithAi(aiArgs)
      );
      const ai = brainReply.ai;
      /*
       * Names hidden by the owner — the backstop behind the prompt rule, on the model's own words
       * only (either brain), before anything is built from them. The clinic's cards already leave
       * the dentist out and are never rewritten: a dentist called "محمد علي" must not turn the
       * clinic's "شارع محمد علي" into "شارع الدكتور". The clinic's name, address and branches and
       * the patient's own name are protected inside the model's text too. No handoff over it.
       */
      if (settings.hideDoctorNames && profile?.doctors.length && (ai.kind === "answer" || ai.kind === "handoff") && ai.text) {
        const cleaned = stripDoctorNames(ai.text, profile.doctors, {
          protect: [clinicName, ctx.addressText || "", ...profile.branches.flatMap((b) => [b.name, b.address || ""])],
          patientName: ctx.patientName,
        });
        if (cleaned.stripped) {
          ai.text = cleaned.text;
          void adminClinicCollection(clinicId, "ai_debug")
            .add({ kind: "doctor_name_stripped", doctorNameStripped: true, brain: brainReply.brainUsed, createdAt: FieldValue.serverTimestamp() })
            .catch(() => {});
        }
      }
      /*
       * How a receptionist talks, on the model's own words only (like the name check above), for
       * either brain (lib/bot/wordingFix): "أهلاً بحضرتك", not the textbook "أهلاً بك"; no
       * translated "بالفعل"; and one welcome per sitting — on a later turn (conversation.turns
       * resets after an hour of quiet) a greeting that opens the reply is dropped, unless the
       * patient has just greeted again. Before stripRepeatIntro further down, so "أهلاً بك، معاك
       * سارة من …" on a later turn loses both parts instead of leaving a stray "أهلاً بك." line.
       * The cleaned words are also what the model reads back as its own earlier turns.
       */
      if ((ai.kind === "answer" || ai.kind === "handoff") && ai.text) {
        ai.text = tidyModelWording(ai.text, { laterTurn: conversation.turns > 0, patientText: [act.question, ...askedTogether].join("\n") });
      }
      /*
       * The check-up is in this patient's offer — the backstop behind the prompt, on either
       * brain's own words. The ordinary fee can still reach the model from approved answers, the
       * owner's coaching or an earlier bot line in the thread, and it once said "والكشف عموماً
       * 200 ج.م" under a veneer price. A clause naming the check-up WITH that fee becomes "والكشف
       * نفسه داخل في العرض"; every other figure and time stays. Only read when the reply names
       * the check-up at all; never a hand-off over it.
       */
      if (checkupInOffer && (ai.kind === "answer" || ai.kind === "handoff") && ai.text && namesCheckup(ai.text)) {
        const servicesSnap = await adminClinicCollection(clinicId, "services").limit(200).get().catch(() => null);
        const prices = plainCheckupPrices((servicesSnap?.docs || []).map((d) => (d.data() || {}) as Record<string, unknown>));
        const cleaned = stripCheckupFee(ai.text, checkupFees(ctx.facts?.consultation, prices, offersActive));
        if (cleaned.stripped) {
          if (!args.dryRun) {
            void adminClinicCollection(clinicId, "ai_debug")
              .add({ kind: "checkup_fee_stripped", brain: brainReply.brainUsed, before: ai.text.slice(0, 600), createdAt: FieldValue.serverTimestamp() })
              .catch(() => {});
          }
          ai.text = cleaned.text;
        }
      }
      /*
       * Asked the price, the price comes first. A question the model put above the figure ("is it
       * for looks?") is moved below it, so a reply split into two bubbles never opens with a
       * question that reads as the answer to "السعر كام". The model's own paragraphs, reordered;
       * nothing added. Asked in this message or in any of the patient's messages still unanswered.
       */
      if (ai.kind === "answer" && ai.text) {
        const unanswered: string[] = [];
        for (const line of [...(salesContext?.thread ?? [])].reverse()) {
          if (line.author === "system") continue;
          if (line.author !== "patient") break;
          unanswered.push(line.text);
        }
        if ([act.question, ...unanswered].some(asksPrice)) ai.text = priceBeforeQuestions(ai.text);
      }
      /*
       * Today is never called tomorrow (lib/bot/relativeDay). The model offered today's first slot
       * as "بكره السبت" on a Saturday morning: the weekday and date it copies from our labels were
       * right, the day word was its own guess. A day word that contradicts the weekday or date
       * right after it is corrected against the clinic's calendar, on either brain, before the
       * offered times are read from the text below. Anything else stays exactly as written.
       */
      if ((ai.kind === "answer" || ai.kind === "handoff") && ai.text) {
        const dayFixed = fixRelativeDayWords(ai.text, clinicNow().dateKey);
        if (dayFixed !== ai.text) {
          ai.text = dayFixed;
          if (!args.dryRun) {
            void adminClinicCollection(clinicId, "ai_debug")
              .add({ kind: "relative_day_fixed", brain: brainReply.brainUsed, createdAt: FieldValue.serverTimestamp() })
              .catch(() => {});
          }
        }
      }
      brainUsed = brainReply.brainUsed;
      // What Pro offered is what "the first one" and the spoken clocks below resolve against.
      if (brainReply.slotsShown) slotOffer = brainReply.slotsShown;
      /*
       * A pick the model turned into "let's open the booking" instead of "book this one".
       *
       * It happens on roughly half of the short answers — "the first one", "الاول", the hour said
       * back — and every time it happened the patient was handed the dentist menu and started
       * again, or worse, gave their name and was registered with no appointment. The keys they
       * were offered are on the conversation, so the choice is read here rather than argued about
       * in the prompt. Anything ambiguous still falls through to the model's own judgement.
       */
      /*
       * The same reading also overrules a `book_slot` the model got wrong. Offered "السبت 6:30
       * أو الأحد 3:00" and answered "الأول", it booked Saturday 3:30 — the first row of ITS list,
       * a time the patient was never told. What the patient heard is on the conversation in the
       * order they heard it, so "the first one" is counted there, not in the model's list.
       */
      if (ai.kind === "answer" && (ai.openBooking || ai.bookSlot) && (conversation.pendingSlots?.length || 0) > 0) {
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
       * "تمام" after two times is a yes to booking, not a choice between them. The model either
       * booked the first one on its own or lost the thread and greeted the patient again, so the
       * question is asked here: the same two times, back in one line. Arabic only — the line is
       * written in Arabic, and an "ok" from an English speaker stays with the model.
       */
      if (ai.kind === "answer" && /[؀-ۿ]/.test(act.question) && isBareAgreement(act.question)) {
        const offered = (conversation.pendingSlots || [])
          .map((key) => slotOffer.find((s) => s.key === key))
          .filter((s): s is { key: string; label: string } => Boolean(s));
        if (offered.length >= 2) {
          ai.bookSlot = undefined;
          ai.openBooking = false;
          ai.text = `تمام 👍 تحب ${offered[0].label} ولا ${offered[1].label}؟`;
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
      /*
       * A no the keyword list did not catch. "العنوان بعيد عليا" was answered kindly and then
       * chased 33 minutes later with "لسه معانا؟" — the nudge only knew a short list of phrases.
       * The model reads the whole sentence, so it says when the patient closed the subject, and
       * the same mark the keywords set keeps the nudge and the lead follow-up away. The chat doc
       * is marked in a rehearsal too (a playground chat is never nudged); the lead is not touched.
       */
      if (ai.kind === "answer" && ai.notNow) {
        void markConversationDeclined(clinicId, chatId).catch(() => {});
        if (!args.dryRun && phone) void snoozeBotLead(clinicId, phone).catch(() => {});
      }
      if (ai.kind === "answer" && ai.text) {
        const said = ai.text;
        // The clock alone is not an identifier: four different days share "3:00 م", and storing
        // all four made "the third one" resolve to a time nobody was offered. A slot counts as
        // spoken only when its date or its day name is in the sentence beside its clock — or when
        // that clock belongs to exactly one slot anyway.
        // "النهارده 3:00 أو بكره 6:30" names its days by today's calendar, so today goes along.
        spokenSlotKeys = spokenSlots(said, slotOffer, clinicNow().dateKey);
      }
      /*
       * The two times, once (lib/bot/slotRepeat). The prompt asks for two times in every answer,
       * so a patient who asked for the address, then the area, read the same "السبت 3:00 ولا
       * الأحد 3:00؟" under each answer. An info question soon after an offer gets the answer
       * without its closing offer. What the patient last heard is carried, because the save below
       * overwrites pendingSlots every turn and "الأول"/"التاني" must still resolve against it.
       */
      if (
        ai.kind === "answer" && ai.text &&
        !ai.bookSlot && !ai.openBooking && !ai.medicineId && !ai.appointmentChange && !ai.reschedule &&
        !isBareAgreement(act.question) &&
        holdRepeatOffer({
          question: act.question,
          spokenKeys: spokenSlotKeys,
          previousKeys: conversation.pendingSlots,
          thread: salesContext?.thread ?? [],
          offer: slotOffer,
          gapMinutes: salesContext?.gapMinutes,
        })
      ) {
        const held = withoutSlotOffer(ai.text, slotOffer);
        if (held) {
          ai.text = held;
          spokenSlotKeys = [...(conversation.pendingSlots ?? [])];
          if (!args.dryRun) {
            void adminClinicCollection(clinicId, "ai_debug")
              .add({ kind: "slot_offer_held", brain: brainReply.brainUsed, createdAt: FieldValue.serverTimestamp() })
              .catch(() => {});
          }
        }
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
        } else if (conversation.lastReason === "ai_ask_name_slot" || conversation.lastReason === "ai_ask_name_again") {
          /*
           * The name was asked for in the last message and the answer was not understood as one.
           * Asking again in the same words is a loop — a patient sent his name, then "it's
           * above", then a voice note, and got the identical question four times. A receptionist
           * would say it differently: the time is held, only the name is missing. Two such
           * reminders, each in its own words; after that the chat is stuck and a person takes it.
           */
          const held = slotOffer.find((s) => s.key === ai.bookSlot)?.label;
          const heldLine = held ? `ميعاد ${held} محجوز لحضرتك` : "الميعاد محجوز لحضرتك";
          pending = { date: slotDate, times: [slotTime], doctor: slotDoctor, treatment: ctx.serviceMatch || aiInterest || conversation.lastInterest };
          if (conversation.lastReason === "ai_ask_name_slot") {
            replyText = `معلش 🙏 ${heldLine}، ناقصني بس الاسم عشان أأكده.\n\nممكن ${v.send === "ابعتي" ? "تكتبيلي" : "تكتبلي"} الاسم الأول والأخير بس في رسالة لوحدها؟`;
            nextState = "booking_name";
            reason = "ai_ask_name_again";
          } else {
            replyText = `معلش على اللخبطة 🙏 ${heldLine}، والاستقبال هيأكده ${voiceFor(ctx.gender ?? "unknown").withYou} حالاً.`;
            nextState = "handed_off";
            handoff = true;
            reason = "ai_name_loop_handoff";
          }
        } else {
          // No "أهلاً بيك" in front: the patient has been talking to us for a while by now.
          const askName = `عشان أسجل الحجز باسمك، ${v.send === "ابعتي" ? "ابعتيلي" : "ابعتلي"} اسمك الكامل 🙏`;
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
          const askName = `عشان نسجل الحجز، ياريت حضرتك ${v.send === "ابعتي" ? "تبعتيلنا" : "تبعتلنا"} الاسم الكامل 🙏`;
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
                { event: "aiCreditsOut", channel: "alpha_leads", data: { screen: "settings" } }
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
        } else if (sales) {
          // Twice in a row (a quota or an outage, not a blip): a person takes it. Never the menu
          // re-prompt — in salesperson mode there are no buttons, and "pick from the buttons
          // below" was the first thing patients saw the morning the model's quota ran out.
          replyText = "وصلتني رسالتك 🙏 حد من الاستقبال هيرد على حضرتك في أقرب وقت.";
          structure = undefined;
          nextState = "handed_off";
          handoff = true;
          reason = "gave_up";
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
      // Names hidden since that list was sent: a stale pick books any chair, like a fresh one.
      if (settings.hideDoctorNames) listDays("");
      // Out of range or the list is gone: offering the dentists again beats guessing a chair.
      else if (picked === undefined) listDoctors();
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
      // The ad clicks this chat came through go onto the new record from its first second, so the
      // booking a moment later can be credited to its click (lib/metaConversions). The legacy
      // first-ad field is read too, for a chat whose ad predates the click list.
      const legacyClick = conversation.ad && conversation.adAt ? clickFromReferral(conversation.ad, conversation.adAt) : null;
      const registerAttribution = attributionFromClicks(null, mergeClicks(conversation.adClicks ?? [], legacyClick ? [legacyClick] : []));
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
            // Behind a lid the number was typed by the patient; binding the lid to the record
            // makes their next message resolve to it without the number again.
            ...(isLidChat ? { whatsappLid: chatId, whatsappLidLearnedAt: FieldValue.serverTimestamp(), whatsappLidSource: "self_claimed" } : {}),
            ...(registerAttribution ? { adAttribution: registerAttribution } : {}),
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
    // Check-up in their offer: the generic close, not the clinic's "الكشف 200 ج.م" (never saved; "" not undefined).
    appendLine(closingLine({ gender: ctx.gender, facts: checkupInOffer ? { ...ctx.facts, consultation: "" } : ctx.facts, alreadyBooked: Boolean(upcoming) }));
    // The button block below builds its own structure for menu-shaped replies; everything else
    // gets the Book button here.
    if (!structure && !upcoming && !["greeted", "reprompt", "back_to_menu", "hours"].includes(reason)) {
      structure = { body: replyText, buttons: menuButtons(Boolean(ctx.canOfferBooking)) };
    }
  }
  /*
   * "ابعتلي اللوكيشن" gets the map link, whichever path wrote the reply (lib/bot/careNote). The
   * model is never given the URL, so in sales mode a patient who asked three times got the street
   * address three times, and a slot pick in the same message swallowed the request. A reply that
   * already carries a map link (the menu's address answer, the booking note, a clinic's coaching
   * quoted by the model) is left alone; "the message did not reach me, send it again" gets none.
   * A reply that promises the link ("وده اللوكيشن 👇") gets it too. Branch talk — in this reply or
   * the turn the patient is answering — gets none: the saved link is one place, maybe not theirs.
   */
  if (replyText.trim() && reason !== "ai_unavailable") {
    const pin = locationPinLine({
      asked: [text, ...askedTogether],
      reply: `${replyText}\n${structure?.body ?? ""}`,
      addressText: ctx.addressText,
      mapsUrl: ctx.facts?.mapsUrl,
      before: answeredTurn,
    });
    if (pin) {
      // A name request must stay the last thing the patient reads.
      const nameAsk = /^(ai_ask_name|ask_name|ask_relative_name)/.test(reason);
      const mirrored = Boolean(structure && structure.body === replyText);
      replyText = withPin(replyText, pin, nameAsk);
      if (structure) structure = { ...structure, body: mirrored ? replyText : withPin(structure.body, pin, nameAsk) };
    }
  }
  /*
   * The line after every photo reading, written by code so the model cannot forget it: what it
   * said is an impression from a picture, not a diagnosis, and the exam and x-ray decide. Sent
   * as its OWN bubble a few seconds after the reading — the owner's first live photo reply was
   * five paragraphs in one bubble, and the verdict was "too much in one message".
   */
  let trailerBubble = "";
  if (reason === "ai_answer" && args.media === "image" && args.mediaNote?.impression && replyText.trim()) {
    const latinReply = /[A-Za-z]/.test(replyText) && !/[؀-ۿ]/.test(replyText);
    trailerBubble = latinReply
      ? "This is only an impression from the photo, not a diagnosis. An exam and an x-ray are a must."
      : "ده انطباع من الصورة بس مش تشخيص، ولازم كشف وأشعة.";
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
        ad: ctx.ad,
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
  // Off unless the clinic switched it on (botClosedNote): owners asked for it to stop.
  if (settings.closedNote && handoff && profile && replyText.trim() && !reason.startsWith("appointment_") && !reason.startsWith("ai_cancel") && !reason.startsWith("ai_late")) {
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
          event: "botHandedOff",
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
  /*
   * No opt-out footer on a conversation reply — the owner's call (2026-09-27). A person
   * answering a question does not sign off with "reply STOP to unsubscribe"; that line belongs
   * on the messages the clinic starts (reminders, receipts, campaigns), and those add it in
   * deliverWhatsAppMessage. Stop words still work on any message, and are confirmed once.
   */
  let body = replyText;

  /*
   * Several messages from one reply.
   *
   * The model marks a break with a line of `---` when the clinic's coaching asks for separate
   * messages (Asnany: the greeting and offer, then the address and map link, then the booking
   * question) — see lib/bot/bubbles. The parts go out one by one below. A reply that carries
   * buttons or a list, or a playground turn, can only be one message: the breaks become blank lines.
   */
  let extraBubbles: string[] = [];
  {
    const parts = splitBubbles(body);
    if (parts.length > 1) {
      if (!structure && !args.dryRun) {
        body = parts[0];
        extraBubbles = parts.slice(1);
      } else {
        body = parts.join("\n\n");
        if (structure) structure = { ...structure, body: joinBubbles(structure.body) };
      }
    }
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
  // A photo the model answered is a text turn in every way that matters here: it paces and
  // splits like one. Other media turns are the fixed one-liners and stay as they are.
  const pace = settings.humanTouch && !args.dryRun && (!args.media || photoToModel);
  let secondBubble = "";
  if (pace && !structure && !extraBubbles.length && body.length > 180) {
    const cut = body.indexOf("\n\n", Math.min(80, body.length));
    if (cut > 40 && body.length - cut > 40) {
      secondBubble = body.slice(cut + 2).trim();
      body = body.slice(0, cut).trim();
    }
  }
  // A photo answer is always the reading, then the question — two bubbles whatever their length.
  // The owner: "divide the message". A short question after a blank line is exactly the split.
  if (pace && !structure && !secondBubble && !extraBubbles.length && photoToModel) {
    const cut = body.indexOf("\n\n");
    if (cut > 0 && body.slice(cut + 2).trim()) {
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
  // order the patient saw them.
  let firstSentAt = Date.now();
  let firstSent = false;
  /*
   * Several messages in quick succession: did the patient write again while this answer was being
   * composed (or while its first bubble was going out)? Then the newer turn, whose model reads the
   * whole thread, answers everything, and the rest of this answer is not sent.
   *
   * Only a plain model answer in sales mode: a booking, a card or a hand-off still goes, a photo's
   * reading still goes (its context lives on this turn only), and assisted mode never drops one —
   * its model is not shown the thread, so the newer turn would not know the question. Only a newer
   * message that really reaches the model counts (lib/bot/supersede): a "شكرا", a script, an album
   * photo answer nothing in its place. Measured from this message's own line, not from when this
   * turn started (14/11/2026: two messages 8 ms apart each got a greeting and an offer).
   */
  const supersedable = !args.dryRun && reason === "ai_answer" && settings.aiFirst && !photoToModel;
  const ownLineAt = args.receivedAt ?? now;
  const wroteAgain = async (): Promise<boolean> => {
    for (const line of await newerPatientLines(clinicId, chatId, ownLineAt, { text, messageId: args.messageId })) {
      const takesOver = await lineTakesOver(line, { state: engineState, ctx, today: clinicNow().dateKey, soonAppointment }).catch(() => false);
      if (takesOver) return true;
    }
    return false;
  };
  // The first bubble went out and the patient wrote before the next one: the rest is not sent.
  let tailDropped = false;
  try {
    if (supersedable && (await wroteAgain())) {
      return skip("superseded");
    }
    // Two invocations composing the same answer at the same moment (two quick messages from the
    // patient, each answered): exactly one of them gets to send it. See lib/bot/replyClaims.
    if (!args.dryRun && !(await claimOnce(clinicId, claimKey("out", conversationKey(replyTo), body), 90_000))) {
      return skip("duplicate_reply");
    }
    if (!args.dryRun) waMessageId = await sendPatientWhatsAppRich(clinicId, replyTo, body, structure);
    firstSentAt = Date.now();
    firstSent = true;
    // The bot's own words, in the thread staff read, the moment they went out — so a turn started
    // by the patient's next message already sees them (it used to be written after the last
    // bubble, and a newer turn quoted the price again and offered other times). Never allowed to
    // fail the turn. A rehearsal (dryRun) writes to its own private play_ thread — the fake phone
    // it carries must never become a conversation on the Chats page, which it once did.
    await recordThreadMessage(clinicId, args.dryRun ? chatId : replyTo, { direction: "out", author: "bot", text: body, kind: reason, waMessageId }, firstSentAt).catch(() => {});
    // The rest of the reply, one message at a time — the model's own breaks, or the long-answer
    // split above. Each waits about as long as typing it would.
    for (const bubble of extraBubbles.length ? extraBubbles : secondBubble ? [secondBubble] : []) {
      await new Promise((r) => setTimeout(r, Math.min(7000, 1500 + bubble.length * 30)));
      // The patient wrote meanwhile: this tail was written for the older message. 14/11/2026: the
      // price went out, the patient asked "السعر كام", and 0.7 s later the old tail's question
      // arrived as if it were the answer.
      if (supersedable && (await wroteAgain())) {
        tailDropped = true;
        break;
      }
      await sendPatientWhatsAppRich(clinicId, replyTo, bubble, undefined);
      await recordThreadMessage(clinicId, replyTo, { direction: "out", author: "bot", text: bubble, kind: reason }, Date.now()).catch(() => {});
    }
    if (trailerBubble && !args.dryRun) {
      await new Promise((r) => setTimeout(r, pace ? 2500 : 0));
      await sendPatientWhatsAppRich(clinicId, replyTo, trailerBubble, undefined);
      await recordThreadMessage(clinicId, replyTo, { direction: "out", author: "bot", text: trailerBubble, kind: "photo_disclaimer" }, Date.now()).catch(() => {});
    }
    // The file the model chose to attach: a before/after photo, the price sheet. After the words.
    // Cast: the assignment happens inside the action dispatch and TS's flow analysis loses it here.
    const attach = aiMedia as { id: string; label: string; url: string; kind: "image" | "document" } | null;
    if (attach && !args.dryRun && !tailDropped) {
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
    return { status: "replied", text: body, handoff, reason, structure, ...dryRunBrainTag(args.dryRun, brainUsed) };
  }

  if (!args.dryRun) await adminClinicCollection(clinicId, "whatsapp_logs").add({
    patientId: patient?.id || null,
    type: `bot_${reason}`,
    message: body,
    status: "success",
    createdAt: FieldValue.serverTimestamp(),
  });

  /*
   * The tail was dropped for a newer message. Its turn answers that message and saves the
   * conversation; saving this older turn's state on top could undo it. What did go out still
   * counts against the number's ban-protection caps, so only those are stamped.
   */
  if (tailDropped) {
    void adminClinicDoc(clinicId, "whatsapp_conversations", conversation.phoneKey)
      .set({ recentReplies: FieldValue.arrayUnion(now), repliesInWindow: FieldValue.increment(1) }, { merge: true })
      .catch(() => {});
    return { status: "replied", text: body, handoff, reason: "superseded_tail" };
  }

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

  return { status: "replied", text: body, handoff, reason, structure, ...dryRunBrainTag(args.dryRun, brainUsed) };
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
      // Said in full: left as a bare label, the model answered the small talk and dropped the
      // booking — the patient had picked a time and was never asked for the name again.
      return "طلبنا منه اسمه الكامل عشان نسجل الحجز، ولسه مبعتوش — الميعاد اللي اختاره متثبتش. رد على كلامه في جملة واحدة، وبعدها اطلب منه الاسم الكامل تاني عشان تثبتله الحجز. متعرضش مواعيد جديدة ومتسألوش محتاج إيه";
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
  askedFor?: TimePreference,
  /** The owner's "don't mention dentists' names": the label leaves the dentist out, the key keeps it. */
  hideDoctor = false
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
          out.push({ key, label: `${arabicDayLabel(dateKey)} الساعة ${arabicTimeLabel(time)}${doctorName && !hideDoctor ? ` مع ${doctorName}` : ""}` });
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
  ctx: BotContext,
  /** The owner's "don't mention dentists' names": no dentist on the upcoming line or in the file. */
  hideDoctor = false
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
  // A voice note is its words: its line says "[audio]" (dropped below) with the transcript beside it,
  // so the model never heard an earlier voice note, and a burst that ended on a typed line lost it.
  const thread: AiThreadLine[] = rows
    .reverse()
    .map((m) => ({ author: (m.author as AiThreadLine["author"]) || "bot", text: String(m.transcript || m.text || "") }))
    .filter((l) => l.text.trim() && !l.text.startsWith("[") );
  const knowledge = (knowledgeSnap?.docs ?? []).map((d) => {
    const k = d.data() || {};
    return { q: String(k.question || ""), a: String(k.answer || "") };
  });
  const pb = playbookSnap?.data() || {};
  const lastVisit = typeof patient?.data.lastVisit === "string" ? patient.data.lastVisit : undefined;
  // Their own file: what was done, what is owed, what the dentist prescribed. Only ever for a
  // number the clinic has already identified — a stranger has no record to read.
  const file = patient ? await loadPatientDossier(clinicId, patient.id).catch(() => undefined) : undefined;
  // Prompt-only (never written anywhere), so an undefined field here reaches no Firestore write.
  const dossier = hideDoctor && file ? { ...file, usualDoctor: undefined } : file;

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
      upcomingAppointment: upcoming ? appointmentLine(upcoming, hideDoctor).replace(/\n/g, " ") : undefined,
      lastVisit,
    },
  };
}
