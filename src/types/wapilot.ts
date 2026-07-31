/** Firestore: `settings/wapilot` — credentials (Admin SDK / API only; blocked in client rules). */
export const WAPILOT_SETTINGS_DOC_REF = {
  collection: "settings",
  docId: "wapilot",
} as const;

export type WapilotConfigSource = "firestore" | "env" | "none";

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
