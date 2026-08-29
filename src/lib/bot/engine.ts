import { isOptOutReply, normalizeReplyText } from "@/lib/patientMessaging";

/**
 * What the bot says next, given what it said last.
 *
 * A pure function on purpose. Everything that talks to Firestore, the gateway or the clock lives
 * in lib/bot/conversation and the webhook; this file is the part with the judgement in it, so it
 * can be exercised exhaustively in a test rather than by messaging a real phone and reading a real
 * patient's record afterwards — which is how the last two bugs had to be found.
 *
 * The rule underneath every branch: when the bot is unsure, a person takes over. A dental clinic
 * is not a shop, and a wrong answer here is not a wrong answer about a delivery date. Silence with
 * a handoff is always available and is always the safe move.
 */

/** Where a conversation has got to. Stored verbatim, so add rather than renumber. */
export type BotState =
  /** Nothing said yet, or the last exchange expired. */
  | "new"
  /** The menu has been sent; we are waiting for a choice. */
  | "awaiting_choice"
  /** Asked once more after something unrecognised. One retry only. */
  | "reprompted"
  /** Asked an unrecognised sender for their name, to create their patient record. */
  | "booking_name"
  /** A dentist list was sent; waiting for the pick (only clinics with several dentists). */
  | "booking_doctor"
  /** A list of days was sent; waiting for the patient to pick one. */
  | "booking_day"
  /** A list of times for the chosen day was sent; waiting for a pick. */
  | "booking_time"
  /** A human owns this conversation now. The bot stays quiet until it expires. */
  | "handed_off";

/**
 * Work the engine wants done but cannot do itself — everything that needs Firestore or a clock.
 *
 * The engine stays pure: it decides WHAT happens (list the days, book slot 3) and the caller
 * performs it and composes the visible text. The alternative — the engine returning finished
 * prose about data it never saw — is how a bot confirms an appointment that was never written.
 */
export type BotAction =
  | { type: "list_doctors" }
  /** Typed pick from the stored dentist list; index 1-based, last row is "any". */
  | { type: "list_days_doctor_index"; index: number }
  /** `doctorName` empty means "any chair". Travels inside tap ids so stale taps stay exact. */
  | { type: "list_days"; doctorName?: string }
  /** `index` is 1-based, exactly the number the patient typed. */
  | { type: "list_times"; index: number }
  | { type: "book"; index: number }
  /** A tapped day button — the date travels IN the id, so the tap is stale-proof. */
  | { type: "list_times_date"; dateKey: string; doctorName?: string }
  /** A tapped time button — date and time both travel in the id. */
  | { type: "book_slot"; dateKey: string; time: string; doctorName?: string }
  /** An unrecognised sender told us their name; create the patient, then continue booking. */
  | { type: "register"; name: string }
  /** The reply was not a valid pick; show the same options again. */
  | { type: "relist" };

/**
 * A button tap, decoded from the id the button carried.
 *
 * WhatsApp lets a patient tap buttons on ANY earlier message, however old, and the first live
 * test did exactly that: a tap on a stale menu was read against the CURRENT step's numbering and
 * booked the wrong day. So tap ids carry their whole meaning — `d2026-08-30` is that date
 * whenever it is tapped, `t2026-08-30|04:30 PM` is that exact slot — and interpreting them needs
 * no conversation state at all. Typed digits remain stateful; only they need the stored lists.
 */
export function parseTapId(
  text: string
):
  | { kind: "menu"; choice: "1" | "2" | "3" }
  | { kind: "doctor"; doctorName: string }
  | { kind: "day"; dateKey: string; doctorName: string }
  | { kind: "time"; dateKey: string; time: string; doctorName: string }
  | { kind: "back_menu" }
  | { kind: "back_days" }
  | null {
  const t = text.trim();
  if (t === "m1" || t === "m2" || t === "m3") return { kind: "menu", choice: t[1] as "1" | "2" | "3" };
  if (t === "back_menu") return { kind: "back_menu" };
  if (t === "back_days") return { kind: "back_days" };
  if (t.startsWith("dr|")) return { kind: "doctor", doctorName: t.slice(3).trim() };
  const day = /^d(\d{4}-\d{2}-\d{2})(?:\|(.*))?$/.exec(t);
  if (day) return { kind: "day", dateKey: day[1], doctorName: (day[2] || "").trim() };
  const time = /^t(\d{4}-\d{2}-\d{2})\|([^|]+)(?:\|(.*))?$/.exec(t);
  if (time) return { kind: "time", dateKey: time[1], time: time[2].trim(), doctorName: (time[3] || "").trim() };
  return null;
}

export interface BotContext {
  /** Clinic display name, for the greeting. */
  clinicName: string;
  /** The patient's name when we know them; absent for a number we do not recognise. */
  patientName?: string;
  /** Opening hours, already formatted for reading. Empty when the clinic has not set any. */
  hoursText?: string;
  /** Where the clinic is. Empty when unset. */
  addressText?: string;
  /** Whether real booking can be offered: schedule configured AND the sender is a known patient. */
  canOfferBooking?: boolean;
  /**
   * Schedule configured, real phone in hand, but nobody on file for it — a NEW patient. Booking
   * asks their name first and creates the record, exactly as the public booking page does.
   */
  canRegister?: boolean;
  /** How many dentists the clinic has. Two or more and booking starts by choosing one. */
  doctorCount?: number;
  /**
   * How many numbered options the last booking message listed. The options themselves live in
   * the conversation document; the engine only needs to know whether "4" is a choice or noise.
   */
  optionCount?: number;
}

export interface BotDecision {
  /** What to send. Empty means say nothing at all — unless `action` asks the caller to compose. */
  reply: string;
  /** Data work for the caller; when set, the caller builds the reply text. */
  action?: BotAction;
  next: BotState;
  /**
   * Put this conversation in front of a person.
   *
   * Set on every path the bot cannot finish itself, including the ones where it also sends a
   * holding reply — the patient is told someone is coming, and someone actually has to come.
   */
  handoff: boolean;
  /** Short machine-readable note for the conversation log, so a quiet turn is explainable. */
  reason: string;
}

const SILENT = (next: BotState, reason: string): BotDecision => ({ reply: "", next, handoff: false, reason });

/**
 * Things a patient sends that must never be answered by a machine.
 *
 * Deliberately broad and deliberately erring towards handing over. A swollen face at 1am is the
 * message where being unhelpful is free and being wrong is not — the bot's job here is to stop
 * talking and fetch a person, not to reassure.
 */
const CLINICAL_WORDS = [
  // Arabic, in the spellings people actually type
  "الم", "وجع", "وجعني", "بيوجعني", "ورم", "وارم", "منتفخ", "انتفاخ", "نزيف", "بينزف",
  "دم", "صديد", "خراج", "حراره", "سخونه", "التهاب", "مسكن", "مضاد حيوي", "حساسيه",
  "كسر", "اتكسر", "خلع", "طوارئ", "اسعاف", "حامل", "حمل", "سكر", "ضغط",
  // English
  "pain", "hurts", "hurting", "swollen", "swelling", "bleeding", "blood", "pus", "abscess",
  "fever", "infection", "emergency", "broke", "broken", "pregnant", "allergic", "allergy",
];

/** Does this message need a human clinician rather than a menu? */
export function needsHuman(text: string): boolean {
  const n = normalizeReplyText(text);
  if (!n) return false;
  return CLINICAL_WORDS.some((w) => n.includes(normalizeReplyText(w)));
}

function greeting(ctx: BotContext): string {
  const who = ctx.patientName?.trim() ? ` ${ctx.patientName.trim()}` : "";
  const lines = [
    `أهلاً${who} 👋`,
    `معاك المساعد الآلي لـ *${ctx.clinicName}*.`,
    "",
    "ابعت رقم الاختيار:",
    ctx.canOfferBooking ? "*1* — حجز موعد" : "*1* — التحدث مع الاستقبال للحجز",
    "*2* — مواعيد العمل والعنوان",
    "*3* — التحدث مع الاستقبال",
  ];
  return lines.join("\n");
}

function hoursAndAddress(ctx: BotContext): string {
  const lines: string[] = [`🏥 *${ctx.clinicName}*`];
  if (ctx.hoursText?.trim()) {
    lines.push("", "🕐 *مواعيد العمل:*", ctx.hoursText.trim());
  }
  if (ctx.addressText?.trim()) {
    lines.push("", "📍 *العنوان:*", ctx.addressText.trim());
  }
  if (!ctx.hoursText?.trim() && !ctx.addressText?.trim()) {
    // Nothing configured. Saying so beats inventing hours, and beats an empty message.
    return "الاستقبال هيبعتلك مواعيد العمل والعنوان حالاً.";
  }
  lines.push("", "لأي حاجة تانية ابعت *3* وهيرد عليك حد من الاستقبال.");
  return lines.join("\n");
}

const HANDOFF_REPLY = "تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت.";
const CLINICAL_REPLY =
  "شكراً لتواصلك 🙏\nالرسالة دي محتاجة حد من العيادة يشوفها بنفسه، وهيتواصل معاك في أقرب وقت.\n\nلو الموضوع طارئ، كلمنا على تليفون العيادة على طول.";

/** A bare number 1..99 in any digit script, or null. "٣" and "3." are the same answer. */
export function numberChoice(text: string): number | null {
  const n = normalizeReplyText(text)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,2}$/.test(n)) return null;
  return parseInt(n, 10);
}

/** The single word "1", "١", "1." and so on. Patients answer a numbered menu in every shape. */
function menuChoice(text: string): "1" | "2" | "3" | null {
  const n = normalizeReplyText(text)
    // Arabic-Indic digits, same fold the phone code does.
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (n === "1" || n === "١") return "1";
  if (n === "2" || n === "٢") return "2";
  if (n === "3" || n === "٣") return "3";
  return null;
}

/**
 * Decide the next turn.
 *
 * `state` is what the previous turn stored. A conversation that has gone quiet for long enough is
 * passed in as "new" by the caller rather than being aged in here, so the clock stays outside.
 */
export function decideBotReply(args: {
  state: BotState;
  text: string;
  ctx: BotContext;
}): BotDecision {
  const { state, text, ctx } = args;

  // An opt-out is handled before the bot ever sees the message — and if one reaches here anyway,
  // answering it would be the rudest possible response to "stop messaging me".
  if (isOptOutReply(text)) return SILENT("handed_off", "opt_out");

  if (!text.trim()) return SILENT(state, "empty_message");

  // Checked before everything, including the menu: a patient in pain who happens to type "2"
  // is still a patient in pain.
  if (needsHuman(text)) {
    return { reply: CLINICAL_REPLY, next: "handed_off", handoff: true, reason: "clinical" };
  }

  /*
   * Button taps first, and from ANY state — including handed_off. A tap is unambiguous intent
   * aimed at a specific button the clinic itself offered; unlike free text it cannot be
   * misread, and making it dead after a handoff turns every old message into a field of broken
   * buttons. The id says everything; the caller validates dates against today.
   */
  const tap = parseTapId(text);
  if (tap) {
    switch (tap.kind) {
      case "menu":
        if (tap.choice === "1") {
          if (ctx.canOfferBooking) {
            return (ctx.doctorCount ?? 0) >= 2
              ? { reply: "", action: { type: "list_doctors" }, next: "booking_doctor", handoff: false, reason: "booking_doctors" }
              : { reply: "", action: { type: "list_days" }, next: "booking_day", handoff: false, reason: "booking_days" };
          }
          if (ctx.canRegister) {
            return { reply: "أهلاً بيك 🌟 عشان نسجل حجزك، ابعتلنا اسمك الكامل من فضلك.", next: "booking_name", handoff: false, reason: "ask_name" };
          }
          return { reply: HANDOFF_REPLY, next: "handed_off", handoff: true, reason: "booking_request" };
        }
        if (tap.choice === "2") {
          return { reply: hoursAndAddress(ctx), next: "awaiting_choice", handoff: false, reason: "hours" };
        }
        return { reply: HANDOFF_REPLY, next: "handed_off", handoff: true, reason: "asked_for_human" };
      case "back_menu":
        return { reply: greeting(ctx), next: "awaiting_choice", handoff: false, reason: "back_to_menu" };
      case "back_days":
        return { reply: "", action: { type: "list_days" }, next: "booking_day", handoff: false, reason: "booking_back" };
      case "doctor":
        return { reply: "", action: { type: "list_days", doctorName: tap.doctorName }, next: "booking_day", handoff: false, reason: "booking_days" };
      case "day":
        return { reply: "", action: { type: "list_times_date", dateKey: tap.dateKey, doctorName: tap.doctorName }, next: "booking_time", handoff: false, reason: "booking_times" };
      case "time":
        return { reply: "", action: { type: "book_slot", dateKey: tap.dateKey, time: tap.time, doctorName: tap.doctorName }, next: "awaiting_choice", handoff: false, reason: "booking_book" };
    }
  }

  // A person is already dealing with this. Two voices in one thread is worse than one slow voice.
  if (state === "handed_off") return SILENT("handed_off", "already_with_a_human");

  if (state === "new") {
    return { reply: greeting(ctx), next: "awaiting_choice", handoff: false, reason: "greeted" };
  }

  /*
   * The sender is answering "what is your name". Anything that looks like a name is one — this is
   * how the public booking page has always worked, and demanding more ceremony from a chat than
   * from a web form would be backwards. Digits are not names; they are almost certainly a stray
   * tap at an old list, so the question is asked again rather than a patient called "3".
   */
  if (state === "booking_name") {
    const name = text.replace(/\s+/g, " ").trim();
    if (numberChoice(name) !== null || name.length < 2 || name.length > 80) {
      return { reply: "معلش، ابعت اسمك بالحروف (مش أرقام) عشان نكمل الحجز 🙏", next: "booking_name", handoff: false, reason: "ask_name_again" };
    }
    return { reply: "", action: { type: "register", name }, next: "booking_day", handoff: false, reason: "registered" };
  }

  // Mid-booking, the patient is answering a numbered list the caller stored. Zero always means
  // "back" — a patient who picked the wrong day must not need a human to undo it.
  if (state === "booking_doctor" || state === "booking_day" || state === "booking_time") {
    const n = numberChoice(text);
    if (n === 0) {
      if (state === "booking_time") {
        return { reply: "", action: { type: "list_days" }, next: "booking_day", handoff: false, reason: "booking_back" };
      }
      return { reply: greeting(ctx), next: "awaiting_choice", handoff: false, reason: "back_to_menu" };
    }
    if (n !== null && n >= 1 && n <= (ctx.optionCount ?? 0)) {
      if (state === "booking_doctor") {
        return { reply: "", action: { type: "list_days_doctor_index", index: n }, next: "booking_day", handoff: false, reason: "booking_days" };
      }
      return state === "booking_day"
        ? { reply: "", action: { type: "list_times", index: n }, next: "booking_time", handoff: false, reason: "booking_times" }
        : { reply: "", action: { type: "book", index: n }, next: "awaiting_choice", handoff: false, reason: "booking_book" };
    }
    // Not a pick. Same options again rather than a human: mis-typing a digit is not confusion,
    // and the turn caps in lib/bot/conversation still bound how long this can go on.
    return { reply: "", action: { type: "relist" }, next: state, handoff: false, reason: "booking_relist" };
  }

  const choice = menuChoice(text);

  if (choice === "1") {
    if (ctx.canOfferBooking) {
      // The real thing: dentists first when there is a choice to make, else straight to days.
      return (ctx.doctorCount ?? 0) >= 2
        ? { reply: "", action: { type: "list_doctors" }, next: "booking_doctor", handoff: false, reason: "booking_doctors" }
        : { reply: "", action: { type: "list_days" }, next: "booking_day", handoff: false, reason: "booking_days" };
    }
    if (ctx.canRegister) {
      // A real phone with nobody on file: a NEW patient. Their name is the only missing piece.
      return { reply: "أهلاً بيك 🌟 عشان نسجل حجزك، ابعتلنا اسمك الكامل من فضلك.", next: "booking_name", handoff: false, reason: "ask_name" };
    }
    // No configured schedule, or an unidentifiable sender: the honest answer is a person —
    // never a promise that a slot is held, which is the one lie a clinic cannot afford.
    return { reply: HANDOFF_REPLY, next: "handed_off", handoff: true, reason: "booking_request" };
  }
  if (choice === "2") {
    return { reply: hoursAndAddress(ctx), next: "awaiting_choice", handoff: false, reason: "hours" };
  }
  if (choice === "3") {
    return { reply: HANDOFF_REPLY, next: "handed_off", handoff: true, reason: "asked_for_human" };
  }

  // Not a menu choice. One re-prompt, then a person — a bot that asks the same question three
  // times has already failed, and the third ask is what makes someone report the number.
  if (state === "awaiting_choice") {
    return {
      reply: `معلش مفهمتش 🙏\n\n${greeting(ctx)}`,
      next: "reprompted",
      handoff: false,
      reason: "reprompt",
    };
  }

  return { reply: HANDOFF_REPLY, next: "handed_off", handoff: true, reason: "gave_up" };
}
