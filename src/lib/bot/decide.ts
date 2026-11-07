import { isOptOutReply } from "@/lib/patientMessaging";
import type { BotFacts } from "@/types/whatsapp";
import { voiceFor, type Gender } from "@/lib/arabicNames";
import { adGreetingLine, type AdReferral } from "./adReferral";
import { needsHuman, triageMessage } from "./clinicalTriage";
import { quickIntent } from "./quickAnswers";

/**
 * What happens to a patient's message before the brain sees it.
 *
 * A pure function on purpose, and a short one: the brain (src/lib/botPro) answers everything a
 * receptionist would answer, so the only decisions left here are the ones that must never be a
 * model's call — somebody asked to be left alone, somebody is in pain, a colleague is already in
 * the thread, the AI is switched off — plus the two one-word courtesies that cost nothing to get
 * right, and the name step, which is a form rather than a chat.
 *
 * The numbered menu, the day and time lists and the clinic scripts that used to live in front of
 * the model were retired in November 2026 (docs/superpowers/specs/2026-11-07-one-whatsapp-brain-
 * design.md). Their state names are still in BotState because conversations stored them.
 */

/** Where a conversation has got to. Stored verbatim, so add rather than renumber. */
export type BotState =
  /** Nothing said yet, or the last exchange expired. */
  | "new"
  /** An open chat: the brain answers the next message. */
  | "awaiting_choice"
  /** Asked an unrecognised sender for their name, to create their patient record. */
  | "booking_name"
  /** A human owns this conversation now. The bot stays quiet while a staff member is active. */
  | "handed_off"
  /** Stored by the retired menu bot; read as awaiting_choice (see liveState). */
  | "reprompted"
  | "booking_doctor"
  | "booking_day"
  | "booking_time";

export type LiveState = "new" | "awaiting_choice" | "booking_name" | "handed_off";

/** The state as the decider reads it: a menu-era list step is an open chat now. */
export function liveState(s: BotState): LiveState {
  switch (s) {
    case "new":
    case "awaiting_choice":
    case "booking_name":
    case "handed_off":
      return s;
    default:
      return "awaiting_choice";
  }
}

/** Work the decider wants done but cannot do itself — everything that needs Firestore or a model. */
export type BotAction =
  /** The brain answers. `clinical` means a symptom in dentist mode: answer as the desk dentist. */
  | { type: "ai"; question: string; clinical?: boolean }
  /**
   * "تمام" / "اوك" / 👍 with an appointment in the next two days: that reply is a patient saying
   * "I'll be there", so the caller confirms the appointment instead of spending a credit.
   */
  | { type: "ack" }
  /**
   * An unrecognised sender told us their name; create the patient, then continue booking.
   * `forRelative` means the name is somebody else's — the sender is booking for a wife, a child,
   * a parent — and the record is theirs, not the sender's.
   */
  | { type: "register"; name: string; forRelative?: boolean };

export interface BotContext {
  /** Clinic display name, for the welcome line. */
  clinicName: string;
  /** The patient's name when we know them; absent for a number we do not recognise. */
  patientName?: string;
  /** The clinic's phone, for the one message that tells a patient to ring it. */
  clinicPhone?: string;
  /** Answers the clinic wrote; carried for the caller, unused by the decider itself. */
  facts?: BotFacts;
  /** The ad or post this person arrived from; the welcome line names it. */
  ad?: AdReferral;
  /** The offer sentence for the ad's service, when the clinic wrote one (caller resolves it). */
  adOfferLine?: string;
  /** Not a message: the person opened the chat from an ad and has not typed yet. */
  welcome?: boolean;
  /** The patient has an appointment within two days — a one-word "تمام" then confirms it. */
  hasSoonAppointment?: boolean;
  /** Guessed from the patient's name, so the welcome is not addressed to every woman as a man. */
  gender?: Gender;
  /** The name being collected is a relative's (stored on the conversation by the caller). */
  forRelative?: boolean;
  /** The brain may run: the clinic's auto-reply is on and the key/plan are configured. */
  aiAvailable?: boolean;
  /** Settings → WhatsApp: what a symptom gets — a person (default) or the AI as a dentist first. */
  clinicalMode?: "handoff" | "dentist";
  /** A staff member wrote to this patient recently or paused the bot. */
  staffActive?: boolean;
}

export interface BotDecision {
  /** What to send. Empty means say nothing at all — unless `action` asks the caller to compose. */
  reply: string;
  /** Data work for the caller; when set, the caller builds the reply text. */
  action?: BotAction;
  next: BotState;
  /** Put this conversation in front of a person. */
  handoff: boolean;
  /** Short machine-readable note for the conversation log, so a quiet turn is explainable. */
  reason: string;
}

const SILENT = (next: BotState, reason: string): BotDecision => ({ reply: "", next, handoff: false, reason });
const AI = (question: string, next: BotState, clinical?: boolean): BotDecision => ({
  reply: "",
  action: clinical ? { type: "ai", question, clinical: true } : { type: "ai", question },
  next,
  handoff: false,
  reason: clinical ? "clinical_ai" : "ai",
});

export { needsHuman, triageMessage } from "./clinicalTriage";

/** The promise of a person when the brain is switched off or has given up. */
export const PERSON_WILL_REPLY = "وصلتني رسالتك 🙏 حد من الاستقبال هيرد على حضرتك في أقرب وقت.";

/**
 * The reply to a message that needs a clinician.
 *
 * Written to be read by somebody in pain, or by a parent asking about their child. It is the one
 * reply the model never gets to soften, because triage runs before the model precisely so that
 * these messages cannot be answered by it, so it has to carry its own warmth — and the number.
 */
export function clinicalReplyText(clinicPhone?: string): string {
  return `ألف سلامة عليك 🙏\nالكلام ده لازم الدكتور يشوفه بنفسه عشان نطمن عليك، وأنا بوصّل رسالتك للعيادة دلوقتي حالاً.\n\n${urgentCallLine(clinicPhone)}`;
}

/**
 * Where to call when it cannot wait.
 *
 * Kept apart from the sentence in front of it because those two things answer to different
 * masters: the number must appear on every medical handoff, word for word, while the sentence
 * introducing it is better written fresh each time by whoever is actually talking to the patient.
 */
export function urgentCallLine(clinicPhone?: string): string {
  return clinicPhone?.trim()
    ? `لو الموضوع مستعجل، كلمنا على طول على ${clinicPhone.trim()}`
    : "لو الموضوع مستعجل، كلمنا على تليفون العيادة على طول.";
}

/**
 * The ad welcome: the person tapped an ad and has not typed. Deterministic and free on purpose —
 * most ad taps never type, and spending a model call on each of them would be paying twice for
 * the click. The old menu under it is gone; the line invites them to write.
 */
function welcomeText(ctx: BotContext): string {
  const v = voiceFor(ctx.gender ?? "unknown");
  const who = ctx.patientName?.trim() ? ` يا ${ctx.patientName.trim()}` : "";
  return [
    `أهلاً بحضرتك${who} 👋`,
    `${v.withYou} المساعد الآلي لـ *${ctx.clinicName}*.`,
    ...(ctx.ad ? ["", adGreetingLine(ctx.ad, { offerLine: ctx.adOfferLine })] : []),
    "",
    "اكتبلنا اللي محتاجه وهنرد عليك حالاً 🙏",
  ].join("\n");
}

/**
 * Decide the next turn.
 *
 * `state` is what the previous turn stored. A conversation that has gone quiet for long enough is
 * passed in as "new" by the caller rather than being aged in here, so the clock stays outside.
 */
export function decide(args: { state: BotState; text: string; ctx: BotContext }): BotDecision {
  const { text, ctx } = args;
  const state = liveState(args.state);

  // An opt-out is handled before the bot ever sees the message — and if one reaches here anyway,
  // answering it would be the rudest possible response to "stop messaging me".
  if (isOptOutReply(text)) return SILENT("handed_off", "opt_out");

  if (!text.trim()) {
    if (ctx.welcome && state !== "booking_name") return { reply: welcomeText(ctx), next: "awaiting_choice", handoff: false, reason: "ad_welcome" };
    return SILENT(args.state, "empty_message");
  }

  // Checked before everything: a patient in pain who happens to type a digit is still in pain.
  if (needsHuman(text)) {
    /*
     * Dentist mode: the clinic chose to have the AI answer a symptom the way a dentist at the
     * desk would — ask what hurts and since when, reassure, then offer the earliest slot —
     * instead of promising a call-back. Only ordinary symptoms qualify. The phrase list is the
     * systemic and emergency material (diabetes, blood pressure, cannot swallow, after the
     * anaesthetic) and stays with a person whatever the setting.
     */
    const dentist = ctx.clinicalMode === "dentist" && ctx.aiAvailable && triageMessage(text).reason !== "phrase";
    if (dentist) return AI(text, "awaiting_choice", true);
    return { reply: clinicalReplyText(ctx.clinicPhone), next: "handed_off", handoff: true, reason: "clinical" };
  }

  // A person is already dealing with this. Two voices in one thread is worse than one slow voice.
  // A handoff flag with nobody behind it must not mute the brain: the flag stays for the desk.
  if (state === "handed_off" && ctx.staffActive) return SILENT("handed_off", "already_with_a_human");

  if (!ctx.aiAvailable) return { reply: PERSON_WILL_REPLY, next: "handed_off", handoff: true, reason: "ai_off" };

  if (state === "booking_name") {
    /*
     * The sender is answering "what is your name". Anything that looks like a name is one — this
     * is how the public booking page has always worked. A greeting, a question, a booking word or
     * digits at the name step is talk, not a name: "Hi" must not be registered as somebody called
     * Hi, and "3" is a stray tap at an old list. The brain answers and asks for the name again.
     */
    const name = text.replace(/\s+/g, " ").trim();
    const talk = quickIntent(name) !== null || /[?؟]/.test(name) || /\d/.test(name) || name.length < 2 || name.length > 80;
    if (talk) return AI(text, "booking_name");
    return { reply: "", action: { type: "register", name, forRelative: ctx.forRelative === true }, next: "awaiting_choice", handoff: false, reason: "registered" };
  }

  // The two courtesies that cost nothing to get right. "تمام" confirms an appointment only when
  // there is one to confirm; after a sales pitch it is agreement, and agreement is the brain's.
  const intent = quickIntent(text);
  if (intent === "thanks") return { reply: "العفو 🙏 تحت أمر حضرتك في أي وقت.", next: "awaiting_choice", handoff: false, reason: "thanks" };
  if (intent === "ack" && ctx.hasSoonAppointment) return { reply: "", action: { type: "ack" }, next: "awaiting_choice", handoff: false, reason: "ack" };

  return AI(text, "awaiting_choice");
}
