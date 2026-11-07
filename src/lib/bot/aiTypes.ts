/**
 * The reply contract between the brain and respond.ts.
 *
 * The brain itself lives in src/lib/botPro (answerWithPro). This file holds only what both sides
 * must agree on: what the caller hands the brain (AiArgs), what comes back (AiReplyResult), one
 * thread line, and the stand-in word for a reply the model chose not to write.
 */
import type { AdReferral } from "./adReferral";
import type { BotBrief, BotFacts } from "@/types/whatsapp";
import type { PatientDossier } from "./patientDossier";
import type { AiPatientContext } from "./botPrompt";

export type { AiPatientContext } from "./botPrompt";

/**
 * What stands in for a reply the model chose not to write.
 *
 * Exported because it is not evidence of anything: callers that read the reply to work out which
 * language the model answered in must not count this word as an answer in Arabic — doing so sent
 * an English patient an Arabic booking confirmation.
 */
export const AI_DEFAULT_ACK = "تمام 👍";

export type AiReplyResult =
  | {
      kind: "answer";
      text: string;
      /** The model judged the patient ready; the caller offers times or books the slot it named. */
      openBooking?: boolean;
      /** The service the patient is interested in, as the model read it. */
      interest?: string;
      /** The patient agreed to one of the offered slots (a key the caller gave). */
      bookSlot?: string;
      /** A file from the clinic's library to attach after the reply. */
      sendMedia?: string;
      /** The patient wants to move an existing appointment. */
      reschedule?: boolean;
      /** The patient is cancelling or running late — the desk is told, the model replies. */
      appointmentChange?: "cancel" | "late";
      /**
       * One of the medicines the clinic authorised, by id.
       *
       * Not a sentence: the clinic wrote the words and the caller sends them verbatim, after the
       * safety questions have been answered. The model's job here is choosing, never wording.
       */
      medicineId?: string;
    }
  /**
   * The model classified the message as something a human must handle.
   *
   * `text` is what it wanted to say while handing over — the apology to an angry patient, the
   * "let me get the doctor for you". Used in place of the fixed sentence wherever the fixed
   * sentence is merely procedural; the medical wording stays fixed because it carries the
   * clinic's emergency number and must read the same every time.
   */
  | { kind: "handoff"; topic: "medical" | "complaint" | "staff" | "other"; text?: string }
  /** No key, no plan, no credits, timeout, or model error — the caller runs its failure ladder. */
  | { kind: "unavailable"; reason: string };

export interface AiThreadLine {
  author: "patient" | "bot" | "staff" | "system";
  text: string;
}

/** Everything respond.ts hands the brain for one turn. */
export interface AiArgs {
  clinicId: string;
  clinicName: string;
  question: string;
  patientName?: string;
  hoursText?: string;
  addressText?: string;
  /** The clinic's branches, one per line, when it has two or more (respond.ts branchesTextOf). */
  branchesText?: string;
  clinicPhone?: string;
  /** The owner's "don't mention dentists' names" switch. */
  hideDoctorNames?: boolean;
  /** WhatsApp hid the sender's number (a lid) and they have not typed it yet. */
  phoneHidden?: boolean;
  facts?: BotFacts;
  /** Prior AI exchanges in this conversation, oldest first. */
  history: Array<{ q: string; a: string }>;
  /** "sales" lets the model lead the conversation and open bookings; default "assisted". */
  mode?: "assisted" | "sales";
  /** The whole recent thread, oldest first, every voice. */
  thread?: AiThreadLine[];
  patient?: AiPatientContext;
  /** The owner's standing instructions, verbatim. */
  coaching?: string;
  /** The owner's structured preferences from the Auto-reply tab. */
  brief?: BotBrief;
  /** The name the model signs in with, once, at the start of a conversation. */
  personaName?: string;
  /** The next free appointment slots the model may offer, key → how to say it. */
  slots?: Array<{ key: string; label: string }>;
  /** Files the model may attach after its reply. */
  media?: Array<{ id: string; label: string; when: string }>;
  /** What the assistant remembers about this patient from earlier conversations. */
  memory?: string;
  /** The patient's own record: money, treatments, prescriptions, their usual dentist. */
  dossier?: PatientDossier;
  /** Over-the-counter medicines this clinic authorised, for the model to choose between. */
  medicines?: Array<{ id: string; label: string; whenToUse?: string }>;
  /** True once the patient has answered the safety questions in this conversation. */
  medicineScreened?: boolean;
  /** The conversation is flagged for staff but nobody has picked it up: keep helping, say so once. */
  flaggedForStaff?: boolean;
  /** The patient is mid-booking; the step they are at. */
  bookingStep?: string;
  /** Minutes since the previous exchange when this message opened a new sitting (0 = same sitting). */
  sessionGapMinutes?: number;
  /** Answers staff gave that the owner approved for reuse. */
  knowledge?: Array<{ q: string; a: string }>;
  /** What has worked with this clinic's patients, distilled weekly (or edited by the owner). */
  playbook?: string;
  /** Whether the caller can actually open a booking if asked to. */
  canBook?: boolean;
  /**
   * The message is a symptom and the clinic chose dentist mode. The medical hand-off rule is
   * replaced by the dentist's script: ask, reassure, then offer the earliest appointment. The
   * emergency red flags still hand off.
   */
  clinical?: boolean;
  /** The patient just sent a photo: what it shows, and a preliminary reading for dental photos. */
  photo?: { summary: string; impression?: string; urgent: boolean; category?: "dental" | "document" | "other" };
  /** The ad or post this conversation started from. */
  ad?: AdReferral;
}
