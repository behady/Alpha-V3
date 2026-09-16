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
  /**
   * Where to post "the clinic is typing", if the gateway can show it.
   *
   * Left unset on purpose and therefore OFF by default. Probed live against api.wapilot.net on
   * 2026-09-16: `send-message` and `send-file` exist (they answer INSTANCE_FORBIDDEN, i.e. the
   * route resolved and then checked the instance), while every plausible typing, presence and
   * seen path answers NOT_FOUND on v1, v2 and v3 alike. Wapilot simply has no such endpoint.
   *
   * It is configurable rather than absent because a clinic can point this integration at its own
   * WAHA instance, which does have one (`/api/startTyping`), and because the day Wapilot adds one
   * this becomes a settings change rather than a deploy. Unset means no request is made at all —
   * an indicator that costs a round trip before every reply would be worse than no indicator.
   */
  typingPath?: string;
  typingUrl?: string;
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
  /** Null when the gateway cannot show a typing indicator — the default. See typingPath above. */
  typingUrlOverride: string | null;
  typingPathTemplate: string | null;
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
