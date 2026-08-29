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
   * Answer new leads automatically. Separate from `isPatientAutomationEnabled` on purpose: a
   * clinic may happily remind its own patients while wanting no machine to greet strangers,
   * or the reverse. Off until a manager turns it on — nothing messages anybody by surprise.
   */
  isLeadAutoReplyEnabled?: boolean;
  updatedAt?: string;
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
