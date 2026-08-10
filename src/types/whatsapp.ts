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
  | "reactivation";

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
