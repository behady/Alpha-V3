import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { FieldValue } from "firebase-admin/firestore";
import {
  computeAvailableSlots,
  createPatientBooking,
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
  /** Write bot bookings as Confirmed instead of leaving them for the desk to review. */
  autoConfirm: boolean;
}

async function loadBotSettings(clinicId: string): Promise<BotSettings> {
  const snap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const d = snap.exists ? snap.data() || {} : {};
  return {
    enabled: d.botEnabled === true,
    answerStrangers: d.botAnswerStrangers === true,
    autoConfirm: d.botAutoConfirmBookings === true,
  };
}

/** "14"+"30" -> "2:30 م" — the shape a patient reads, not the shape the calendar stores. */
function arabicClock(h: number, m: number): string {
  const twelve = ((h + 11) % 12) + 1;
  const mm = m ? `:${String(m).padStart(2, "0")}` : ":00";
  return `${twelve}${mm} ${h < 12 ? "ص" : "م"}`;
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

/** "2026-08-30" -> "السبت 30/8". The patient picks by number; this is only what they read. */
function arabicDayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return `${ARABIC_DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** "02:00 PM" -> "2:00 م". */
function arabicTimeLabel(time: string): string {
  return time.replace(/^0/, "").replace("AM", "ص").replace("PM", "م");
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

  let profile: PublicClinicProfile | null = null;
  try {
    // requireEnabled false: the assistant has its own opt-in and only answers people who wrote
    // first — tying it to the public-page switch would silently disable booking for every clinic
    // that never wanted a public booking page.
    profile = await loadPublicClinicProfile(clinicId, { requireEnabled: false });
    ctx.hoursText = formatHours(profile.schedule);
  } catch {
    // No clinic_info at all. The menu offers the receptionist instead of inventing anything.
  }
  // Booking needs a configured schedule (never offer times from the 9-to-9 fallback) and an
  // identified patient (a booking must belong to somebody). A real phone with nobody on file is
  // a NEW patient: the bot may ask their name and create the record, exactly as the public
  // booking page does for strangers — a lid sender with no phone can register nothing.
  ctx.canOfferBooking = Boolean(profile?.schedule.isConfigured && patient);
  ctx.canRegister = Boolean(profile?.schedule.isConfigured && !patient && phone);
  if (patient && typeof patient.data.name === "string") ctx.patientName = patient.data.name;
  if (conversation.state === "booking_day") ctx.optionCount = conversation.pendingDays?.length ?? 0;
  if (conversation.state === "booking_time") ctx.optionCount = conversation.pendingTimes?.length ?? 0;

  const decision = decideBotReply({ state: conversation.state, text, ctx });

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
  let pending: { days?: string[]; times?: string[]; date?: string } | undefined;
  /** Buttons/lists for the official channel; the text above is what every other channel sends. */
  let structure: MetaInteractive | undefined;

  if (decision.action && profile) {
    const act = decision.action;
    const branchId = profile.branches.length === 1 ? profile.branches[0].id : null;

    const listDays = () => {
      const days = upcomingOpenDays(profile!.schedule);
      if (!days.length) {
        replyText = "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت لتحديد الميعاد.";
        nextState = "handed_off";
        handoff = true;
        reason = "no_open_days";
        return;
      }
      replyText = renderDayList(days);
      structure = {
        body: "📅 اختار اليوم اللي يناسبك:",
        list: optionList("اختيار اليوم", days, arabicDayLabel, (d) => `d${d}`, { id: "back_menu", title: "رجوع للقائمة" }),
      };
      nextState = "booking_day";
      pending = { days };
    };

    const listTimes = async (dateKey: string) => {
      const slots = await computeAvailableSlots({ clinicId, dateKey, doctorName: null, branchId, profile: profile! });
      if (!slots.length) {
        const days = conversation.pendingDays?.length ? conversation.pendingDays : upcomingOpenDays(profile!.schedule);
        replyText = `اليوم ده كل مواعيده اتحجزت 🙏\n\n${renderDayList(days)}`;
        nextState = "booking_day";
        reason = "booking_day_full";
        pending = { days };
        return;
      }
      const times = slots.slice(0, 8);
      replyText = renderTimeList(dateKey, times);
      structure = {
        body: `⏰ المواعيد المتاحة يوم ${arabicDayLabel(dateKey)}:`,
        list: optionList("اختيار الميعاد", times, arabicTimeLabel, (t) => `t${dateKey}|${t}`, { id: "back_days", title: "رجوع لاختيار اليوم" }),
      };
      nextState = "booking_time";
      pending = { days: conversation.pendingDays, times, date: dateKey };
    };

    if (act.type === "register") {
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
        notes: "Created via WhatsApp assistant",
        source: "whatsapp_bot",
      });
      patient = { id: created.id, data: { name: act.name, phone } };
      ctx.patientName = act.name;
      listDays();
      if (nextState === "booking_day") reason = "registered";
    } else if (act.type === "list_days") {
      listDays();
    } else if (act.type === "relist") {
      if (conversation.state === "booking_time" && conversation.pendingDate && conversation.pendingTimes?.length) {
        replyText = RELIST_PREFIX + renderTimeList(conversation.pendingDate, conversation.pendingTimes);
        structure = {
          body: RELIST_PREFIX.trim(),
          list: optionList("اختيار الميعاد", conversation.pendingTimes, arabicTimeLabel, (t) => `t${conversation.pendingDate}|${t}`, { id: "back_days", title: "رجوع لاختيار اليوم" }),
        };
        pending = { days: conversation.pendingDays, times: conversation.pendingTimes, date: conversation.pendingDate };
      } else if (conversation.pendingDays?.length) {
        replyText = RELIST_PREFIX + renderDayList(conversation.pendingDays);
        structure = {
          body: RELIST_PREFIX.trim(),
          list: optionList("اختيار اليوم", conversation.pendingDays, arabicDayLabel, (d) => `d${d}`, { id: "back_menu", title: "رجوع للقائمة" }),
        };
        nextState = "booking_day";
        pending = { days: conversation.pendingDays };
      } else {
        // The stored options are gone — a fresh list beats an apology about lost state.
        listDays();
      }
    } else if (act.type === "list_times") {
      const dateKey = conversation.pendingDays?.[act.index - 1];
      if (!dateKey) listDays();
      else await listTimes(dateKey);
    } else if (act.type === "list_times_date") {
      // A tapped day carries its own date. A stale tap can name a day already gone — fresh days
      // then, with no scolding: the patient did nothing wrong, the message was just old.
      if (act.dateKey < clinicNow().dateKey) listDays();
      else await listTimes(act.dateKey);
    } else if (act.type === "book" || act.type === "book_slot") {
      const time = act.type === "book_slot" ? act.time : conversation.pendingTimes?.[act.index - 1];
      const dateKey = act.type === "book_slot" ? act.dateKey : conversation.pendingDate;
      if (!time || !dateKey || !patient || !phone) {
        listDays();
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
        });
        if (booked.ok) {
          replyText = [
            settings.autoConfirm ? "✅ تم تأكيد حجزك:" : "✅ تم تسجيل طلب حجزك:",
            `📅 ${arabicDayLabel(dateKey)}`,
            `⏰ ${arabicTimeLabel(time)}`,
            "",
            settings.autoConfirm
              ? "في انتظارك 🦷 لو حبيت تعدّل، ابعت *3* للتواصل مع الاستقبال."
              : "العيادة هتراجع الطلب وتتواصل معاك للتأكيد. لو حبيت تعدّل، ابعت *3* للتواصل مع الاستقبال.",
          ].join("\n");
          nextState = "awaiting_choice";
          reason = "booked";
          // The desk hears about it the moment it lands, same as an online booking — the whole
          // point of a bot is that nobody was at a screen when this arrived.
          void sendClinicPush(
            clinicId,
            { title: "حجز جديد من واتساب 🤖", body: `${ctx.patientName || "Patient"} — ${dateKey} ${time}` },
            { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "day" } }
          );
        } else if (booked.reason === "slot_taken") {
          await listTimes(dateKey);
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
    await markHandoff(clinicId, conversation.phoneKey, reason);
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

  // The stop line goes on the opening turn only. The patient started this conversation, so
  // repeating "reply STOP" on every answer reads as a machine that expects to be told to go away.
  const body =
    conversation.state === "new"
      ? appendOptOutFooter(replyText, WHATSAPP_OPT_OUT_FOOTER_AR)
      : replyText;
  // A structure that mirrors the text mirrors its footer too — the tapped and typed experiences
  // must read identically, opt-out line included.
  if (structure && structure.body === replyText && body !== replyText) {
    structure = { ...structure, body };
  }

  try {
    await sendPatientWhatsAppRich(clinicId, replyTo, body, structure);
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
    },
    now
  );

  return { status: "replied", text: body, handoff, reason };
}
