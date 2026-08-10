import { adminDb } from "@/lib/firebaseAdmin";
import {
  CLINIC_SECRETS_COLLECTION,
  LEGACY_WAPILOT_SETTINGS_DOC_REF,
  WAPILOT_SECRET_FIELD,
  type WapilotConfig,
  type WapilotConfigSource,
} from "@/types/wapilot";

const DEFAULT_API_ROOT = "https://api.wapilot.net/api/v2";
const DEFAULT_SEND_PATH = "/{instanceId}/send-message";
const DEFAULT_SEND_DOCUMENT_PATH = "/{instanceId}/send-file";

/**
 * WhatsApp credentials, resolved per clinic.
 *
 * These used to live in one platform-wide document, `settings/wapilot`, which every clinic read
 * and — because the Settings screen is open to any clinic Admin — every clinic could overwrite.
 * Two consequences: one clinic's admin could silently redirect or break every other clinic's
 * messaging, and every patient in the system received messages from the same number rather than
 * from the clinic they actually attend.
 *
 * Credentials now live in `clinic_secrets/{clinicId}`, the collection the Firestore rules already
 * reserve for exactly this ("allow read, write: if false" — server-only, so no staff member can
 * read a token that sends messages as the clinic).
 *
 * Resolution order, most specific first:
 *   1. clinic_secrets/{clinicId}.wapilot  — this clinic's own connected number
 *   2. the legacy settings/wapilot doc, then WAPILOT_* env  — a shared platform number
 *
 * The shared fallback is deliberate and temporary: it keeps existing clinics sending while their
 * own numbers are connected one by one. A clinic on the fallback is reported as source
 * "platform", so the Settings screen can say plainly that messages are going out from a shared
 * number rather than the clinic's own.
 */

type CacheEntry = { config: WapilotConfig; at: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 60_000;

function configFromEnv(): WapilotConfig {
  const instanceId = process.env.WAPILOT_INSTANCE_ID?.trim() ?? "";
  const token =
    process.env.WAPILOT_API_TOKEN?.trim() ||
    process.env.WAPILOT_ACCESS_TOKEN?.trim() ||
    "";

  return {
    instanceId,
    token,
    apiRoot: (process.env.WAPILOT_API_BASE_URL || DEFAULT_API_ROOT).replace(/\/$/, ""),
    sendUrlOverride: process.env.WAPILOT_SEND_URL?.trim() || null,
    sendDocumentUrlOverride: process.env.WAPILOT_SEND_DOCUMENT_URL?.trim() || null,
    sendPathTemplate: (process.env.WAPILOT_SEND_PATH || DEFAULT_SEND_PATH).trim() || DEFAULT_SEND_PATH,
    sendDocumentPathTemplate:
      (process.env.WAPILOT_SEND_DOCUMENT_PATH || DEFAULT_SEND_DOCUMENT_PATH).trim() ||
      DEFAULT_SEND_DOCUMENT_PATH,
    source: instanceId && token ? "platform" : "none",
  };
}

/** Turns a stored credentials map into a config, or null when it is incomplete. */
function configFromStored(
  data: Record<string, unknown> | undefined,
  fallback: WapilotConfig,
  source: WapilotConfigSource
): WapilotConfig | null {
  if (!data) return null;
  const instanceId = typeof data.instanceId === "string" ? data.instanceId.trim() : "";
  const token = typeof data.apiToken === "string" ? data.apiToken.trim() : "";
  if (!instanceId || !token) return null;

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return {
    instanceId,
    token,
    apiRoot: str(data.apiBaseUrl) || fallback.apiRoot,
    sendUrlOverride: str(data.sendUrl) || fallback.sendUrlOverride,
    sendDocumentUrlOverride: str(data.sendDocumentUrl) || fallback.sendDocumentUrlOverride,
    sendPathTemplate: str(data.sendPath) || fallback.sendPathTemplate,
    sendDocumentPathTemplate: str(data.sendDocumentPath) || fallback.sendDocumentPathTemplate,
    source,
  };
}

/**
 * Credentials for one clinic.
 *
 * clinicId is required. It used to be absent, which is precisely how a per-tenant secret ended up
 * being shared by every tenant — there was no place in the signature for the question "whose
 * WhatsApp?" to be asked.
 */
export async function loadWapilotConfig(clinicId: string, forceRefresh = false): Promise<WapilotConfig> {
  const key = String(clinicId || "").trim();
  if (!key) return { ...configFromEnv(), source: "none" };

  const now = Date.now();
  if (!forceRefresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.config;
  }

  const envFallback = configFromEnv();
  let resolved: WapilotConfig | null = null;

  try {
    const snap = await adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(key).get();
    if (snap.exists) {
      const wapilot = (snap.data() || {})[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined;
      resolved = configFromStored(wapilot, envFallback, "clinic");
    }
  } catch (e) {
    console.warn("loadWapilotConfig: clinic_secrets read failed", e);
  }

  if (!resolved) {
    // Shared platform credentials. Read second so a clinic that has connected its own number
    // always wins, and so removing the shared fallback later changes nothing for those clinics.
    try {
      const legacy = await adminDb()
        .collection(LEGACY_WAPILOT_SETTINGS_DOC_REF.collection)
        .doc(LEGACY_WAPILOT_SETTINGS_DOC_REF.docId)
        .get();
      if (legacy.exists) {
        resolved = configFromStored(legacy.data() as Record<string, unknown>, envFallback, "platform");
      }
    } catch (e) {
      console.warn("loadWapilotConfig: legacy settings/wapilot read failed", e);
    }
  }

  const config = resolved ?? envFallback;
  cache.set(key, { config, at: now });
  return config;
}

/** Drop cached credentials. Pass a clinicId after saving that clinic's connection. */
export function clearWapilotConfigCache(clinicId?: string): void {
  if (clinicId) cache.delete(String(clinicId).trim());
  else cache.clear();
}

export function wapilotConfigErrorMessage(config: WapilotConfig): string {
  if (!config.instanceId && !config.token) {
    return "WhatsApp is not connected. Add an Instance ID and API token in Settings → WhatsApp, or switch that clinic to \"Open WhatsApp to send\".";
  }
  if (!config.instanceId) return "Wapilot Instance ID is missing.";
  if (!config.token) return "Wapilot API token is missing.";
  return "WhatsApp is not connected.";
}
