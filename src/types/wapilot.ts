/**
 * Firestore: `clinic_secrets/{clinicId}` — one document per clinic, holding the `wapilot` map
 * described by WapilotCredentialsDocument below.
 *
 * This collection is denied to every client by the security rules on purpose: a token that can
 * send WhatsApp messages as the clinic must not be readable by the clinic's own staff. It is
 * written and read exclusively through the Admin SDK.
 */
export const CLINIC_SECRETS_COLLECTION = "clinic_secrets";

/** Field within `clinic_secrets/{clinicId}` that holds the WhatsApp gateway credentials. */
export const WAPILOT_SECRET_FIELD = "wapilot";

/**
 * The old platform-wide credentials document.
 *
 * Every clinic read it and any clinic Admin could overwrite it, so one clinic could break or
 * hijack another's messaging, and all patients were messaged from a single shared number. It is
 * still read as a *fallback* so clinics keep sending while their own numbers are connected, but
 * nothing writes to it any more.
 */
export const LEGACY_WAPILOT_SETTINGS_DOC_REF = {
  collection: "settings",
  docId: "wapilot",
} as const;

/**
 * Where a clinic's credentials came from.
 * `clinic`   — this clinic's own connected number.
 * `platform` — the shared fallback number (legacy doc or WAPILOT_* env).
 * `none`     — nothing configured; sending falls back to click-to-send.
 */
export type WapilotConfigSource = "clinic" | "platform" | "none";

export interface WapilotCredentialsDocument {
  instanceId: string;
  apiToken: string;
  apiBaseUrl?: string;
  sendPath?: string;
  sendDocumentPath?: string;
  sendDocumentUrl?: string;
  sendUrl?: string;
  connectedPhoneHint?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface WapilotConfig {
  instanceId: string;
  token: string;
  apiRoot: string;
  sendUrlOverride: string | null;
  sendDocumentUrlOverride: string | null;
  sendPathTemplate: string;
  sendDocumentPathTemplate: string;
  source: WapilotConfigSource;
}

/** Masked status for Settings UI (never includes apiToken). */
export interface WapilotConfigStatus {
  configured: boolean;
  source: WapilotConfigSource;
  instanceId: string;
  tokenSet: boolean;
  apiBaseUrl?: string;
  sendPath?: string;
  sendDocumentPath?: string;
  connectedPhoneHint?: string;
  updatedAt?: string;
}
