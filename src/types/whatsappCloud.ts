/**
 * Meta WhatsApp Cloud API — types.
 *
 * Multi-tenant by design: every clinic connects its own WhatsApp Business number, so credentials
 * are resolved per clinic rather than from a single global config.
 *
 * Storage is deliberately split in two:
 *
 *   clinic_secrets/{clinicId}            → access token + IDs. TOP-LEVEL, Admin SDK only.
 *   clinics/{clinicId}/settings/whatsapp → display info only. Readable by clinic staff.
 *
 * The token must NOT live under clinics/{clinicId}/. That path is covered by the
 * `match /{subcollection}/{document=**}` rule in firestore.rules, which grants read to every
 * member of the clinic — a receptionist could then read a token that sends messages as the clinic.
 * Firestore rules OR together, so a narrower "deny" match underneath cannot claw that back;
 * keeping secrets in a separate top-level collection is the only way to actually lock them down.
 */

/** Firestore: `clinic_secrets/{clinicId}` — server-only credentials. */
export const CLINIC_SECRETS_COLLECTION = "clinic_secrets" as const;

/** Firestore: `clinics/{clinicId}/settings/whatsapp` — non-secret, staff-readable. */
export const WHATSAPP_CLOUD_SETTINGS_DOC = { collection: "settings", docId: "whatsapp" } as const;

export const GRAPH_API_VERSION = "v25.0" as const;

export type WhatsAppConfigSource = "clinic" | "env" | "none";

/** Secret half — never sent to the browser. */
export interface WhatsAppCloudSecrets {
  /** Meta "Phone Number ID" (not the phone number itself). */
  phoneNumberId: string;
  /** WhatsApp Business Account ID. Needed for template management. */
  wabaId?: string;
  /** System User token (permanent) or a temporary console token while testing. */
  accessToken: string;
}

/** Public half — safe for the Settings UI. */
export interface WhatsAppCloudPublicSettings {
  /** Human-readable number, e.g. "+1 555 200 6714". Display only. */
  displayPhoneNumber?: string;
  /** Meta-verified business display name. */
  verifiedName?: string;
  status?: "connected" | "disconnected";
  /** True while pointed at Meta's shared sandbox number (5-recipient cap). */
  isTestNumber?: boolean;
  connectedAt?: string;
  connectedBy?: string;
}

export interface WhatsAppCloudConfig extends WhatsAppCloudSecrets {
  source: WhatsAppConfigSource;
  clinicId: string | null;
}

/** Masked status for the Settings UI — never includes accessToken. */
export interface WhatsAppCloudStatus extends WhatsAppCloudPublicSettings {
  configured: boolean;
  source: WhatsAppConfigSource;
  phoneNumberId: string;
  wabaId: string;
  tokenSet: boolean;
}

export interface WhatsAppSendResult {
  ok: boolean;
  /** Meta's `wamid.*` message ID when the send succeeded. */
  messageId?: string;
  error?: string;
  /** Meta numeric error code, useful for branching on 131030 / 131047 / 190. */
  errorCode?: number;
}
