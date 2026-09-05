/**
 * Firestore: document `settings/whatsapp`
 *
 * Path: settings (collection) / whatsapp (document id)
 */
export type WhatsAppTemplateType =
  | "new"
  | "edit"
  | "cancel"
  | "invoice"
  | "treatment"
  | "reminder24h"
  | "google_review"
  | "reactivation"
  /** The instant reply to a brand-new lead — see functions/leadWelcome.js. */
  | "lead_welcome";

export interface WhatsAppMessageTemplate {
  id: string;
  type: WhatsAppTemplateType;
  message: string;
  isActive: boolean;
}

/**
 * Owner alert toggles: module_action → send WhatsApp to ownerNumber.
 * Recommended keys (UI writes these):
 * - appointment_add | appointment_edit | appointment_delete
 * - finance_add | finance_edit | finance_delete
 *
 * Legacy / alternate keys (e.g. appointment_new) may exist; treat as optional booleans.
 */
export type OwnerAlertKey =
  | "appointment_add"
  | "appointment_edit"
  | "appointment_delete"
  | "finance_add"
  | "finance_edit"
  | "finance_delete";

export type WhatsAppOwnerAlerts = Partial<Record<OwnerAlertKey | string, boolean>>;

/**
 * How this clinic's messages actually leave.
 *
 * `auto`   — the gateway sends them unattended.
 * `manual` — the message is prepared and WhatsApp opens with it typed; a person presses send.
 *
 * Manual is not a degraded mode. A clinic with no commercial registration cannot be verified for
 * the official WhatsApp Business API at all, and automating an ordinary WhatsApp account risks
 * that number being restricted — which for a clinic means losing contact with its own patients.
 * Click-to-send avoids both, at the cost of a tap per message.
 *
 * Absent, the server decides: manual when no gateway is configured, auto when one is.
 */
export type WhatsAppDeliveryMode = "auto" | "manual";

export interface WhatsAppSettingsDocument {
  isPatientAutomationEnabled: boolean;
  /** Weekly "we miss you" to patients whose last completed visit is older than `recallAfterMonths`. */
  isRecallEnabled?: boolean;
  recallAfterMonths?: number;
  /** The day after a completed visit, ask for a Google review (needs the clinic's review link). */
  isReviewRequestEnabled?: boolean;
  /** Send the 24h reminder as the template with confirm / reschedule buttons. Needs Meta approval. */
  useReminderButtons?: boolean;
  /** One "still interested?" the day after a bot lead asked and did not book. Needs Meta approval. */
  isLeadFollowupEnabled?: boolean;
  /** "How are you feeling?" the morning after a procedure, with the aftercare line. Needs Meta approval. */
  isCheckinEnabled?: boolean;
  /** A polite rebook message the day after a no-show. Needs Meta approval. */
  isNoShowRecoveryEnabled?: boolean;
  templates: WhatsAppMessageTemplate[];
  ownerNumber: string;
  ownerAlerts: WhatsAppOwnerAlerts;
  deliveryMode?: WhatsAppDeliveryMode;
  /**
   * Which built-in wording the clinic started from — `bilingual` or `arabic`. Only decides the
   * fallback body for a template the clinic never edited; see lib/whatsappDefaultBodies.
   */
  templatePack?: "bilingual" | "arabic";
  /**
   * Print "to stop, reply STOP" at the bottom of every automated patient message.
   *
   * On unless explicitly turned off. What restricts a WhatsApp number is recipients reporting it,
   * and a visible way out is what an irritated patient uses instead of the report button — so the
   * clinic that most needs this is exactly the one who would never go looking for the setting.
   */
  optOutFooterEnabled?: boolean;
  /**
   * Answer patients who message the clinic's WhatsApp, rather than only sending to them.
   *
   * Off until switched on, and it needs a working gateway: in manual delivery there is nobody at
   * a screen when the patient writes, and a reply queued for someone to tap tomorrow is not a
   * conversation. See lib/bot/respond, which re-checks every gate itself.
   */
  botEnabled?: boolean;
  /**
   * Answer numbers with no patient record.
   *
   * Off by default, and that default is the ban-protection one: answering unknown numbers means
   * answering wrong numbers and anyone who ever saw the clinic's number — strangers who never
   * asked to be messaged, which is exactly the traffic that gets a number reported.
   */
  botAnswerStrangers?: boolean;
  /**
   * Bot bookings land as Confirmed instead of Unconfirmed.
   *
   * Off by default: the desk reviews every request, and the bot cannot fill a calendar
   * unattended. A clinic that trusts the flow flips this and the booking is final the moment the
   * patient taps a time — the slot recomputation at write time keeps that safe against
   * double-booking either way.
   */
  botAutoConfirmBookings?: boolean;
  /**
   * Let the model answer free-text questions the buttons could not. Runs ONLY after every free
   * path failed (menu, digits, taps), at most three answers per conversation, one credit each
   * from the clinic's monthly AI pool. Prices are quoted as ranges with "reception confirms";
   * complaints, named-staff questions and anything medical hand to a person.
   */
  botAiEnabled?: boolean;
  /**
   * "ai_first": the model leads every conversation like a salesperson and decides when to open
   * the booking; the fixed routes keep only safety (pain, complaints, opt-out) and the calendar.
   * "assisted" (default): buttons and keyword answers first, the model last.
   */
  botMode?: "assisted" | "ai_first";
  /** AI replies allowed per conversation. 0 = unlimited. Absent: 3 assisted, unlimited in ai_first. */
  botAiMaxReplies?: number;
  /** The owner's standing instructions to the bot, in their own words. Sent verbatim. */
  botCoaching?: string;
  /** Answers to the questions the clinic's data cannot supply. See BotFacts. */
  botFacts?: BotFacts;
  /**
   * Answer new leads automatically. Separate from `isPatientAutomationEnabled` on purpose: a
   * clinic may happily remind its own patients while wanting no machine to greet strangers,
   * or the reverse. Off until a manager turns it on — nothing messages anybody by surprise.
   */
  isLeadAutoReplyEnabled?: boolean;
  updatedAt?: string;
}

/**
 * The answers to the questions patients ask that no other part of the system stores.
 *
 * Every field here was found by tracing real patient messages through the assistant and watching
 * it hand them to a receptionist — or, worse, answer them from the model's general knowledge of
 * dentistry in the clinic's own voice. "How long do braces take", "do you take instalments", "is
 * there parking", "can I just walk in": the clinic knows all of it, and nothing had ever asked.
 *
 * Every field is optional and empty means the same thing everywhere: the bot says a person will
 * confirm, and never guesses. Filling one in converts that question from a staffed interruption
 * into a free instant answer — so these are worth money, but no field is ever required.
 *
 * Written by the clinic in its own words and sent verbatim. The bot does not rephrase them, which
 * is what makes them safe to quote: a sentence the clinic wrote is a sentence the clinic meant.
 */
export interface BotFacts {
  /** Can a patient turn up without an appointment, and what happens if they do. */
  walkIn?: string;
  /** Instalments and payment plans. */
  installments?: string;
  /** Current offers or the discount policy — including "we don't discount", which is an answer. */
  offers?: string;
  /** A Google Maps link. "ابعتلي اللوكيشن" wants a pin, and a street address is not one. */
  mapsUrl?: string;
  /** Parking, and how to find the entrance. */
  parking?: string;
  /** Which insurers or corporate schemes are accepted, if any. */
  insurance?: string;
  /**
   * Treatments the clinic does NOT do.
   *
   * The one field here that prevents an invention rather than enabling an answer: the model is
   * told to treat a near-enough service in the price list as a yes, so an implant enquiry at a
   * clinic that does no implants can be answered with the price of something adjacent.
   */
  notOffered?: string;
  /** How long appointments take. The per-service durationMinutes field is empty on every clinic. */
  durations?: string;
  /** Typical number of sessions for the longer treatments. */
  sessions?: string;
  /** Standard aftercare — eating, rinsing, painkillers — as the clinic words it. */
  aftercare?: string;
  /**
   * Why this clinic: the one or two sentences the desk says when somebody hesitates. Used under
   * price answers, and as the whole reply to "it's expensive" and "somewhere else is cheaper".
   */
  whyUs?: string;
  /** The consultation terms — "الكشف مجاني", "200 ج.م بتتخصم من العلاج" — the strongest close there is. */
  consultation?: string;
  /** YYYY-MM-DD. After this day the offers text is treated as ended everywhere, automatically. */
  offersUntil?: string;
}

/** Firestore path helper */
export const WHATSAPP_SETTINGS_DOC_REF = { collection: "settings", docId: "whatsapp" } as const;

/**
 * Firestore: collection `whatsapp_logs` (top-level; query by patientId)
 *
 * Each document may use auto-id; include patientId for indexing.
 */
export type WhatsAppLogStatus = "pending" | "sent" | "delivered" | "failed" | string;

export interface WhatsAppLogEntry {
  id?: string;
  patientId: string;
  type: string;
  message: string;
  status: WhatsAppLogStatus;
  timestamp: string;
  /** Optional metadata for debugging */
  meta?: Record<string, unknown>;
}
