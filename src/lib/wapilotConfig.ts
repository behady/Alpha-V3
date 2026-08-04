import { adminDb } from "@/lib/firebaseAdmin";
import { WAPILOT_SETTINGS_DOC_REF, type WapilotConfig, type WapilotConfigSource } from "@/types/wapilot";

const DEFAULT_API_ROOT = "https://api.wapilot.net/api/v2";
const DEFAULT_SEND_PATH = "/{instanceId}/send-message";
const DEFAULT_SEND_DOCUMENT_PATH = "/{instanceId}/send-file";

let cached: WapilotConfig | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

function configFromEnv(): WapilotConfig {
  const instanceId = process.env.WAPILOT_INSTANCE_ID?.trim() ?? "";
  const token =
    process.env.WAPILOT_API_TOKEN?.trim() ||
    process.env.WAPILOT_ACCESS_TOKEN?.trim() ||
    "";
  const source: WapilotConfigSource =
    instanceId && token ? "env" : "none";

  return {
    instanceId,
    token,
    apiRoot: (process.env.WAPILOT_API_BASE_URL || DEFAULT_API_ROOT).replace(/\/$/, ""),
    sendUrlOverride: process.env.WAPILOT_SEND_URL?.trim() || null,
    sendDocumentUrlOverride: process.env.WAPILOT_SEND_DOCUMENT_URL?.trim() || null,
    sendPathTemplate:
      (process.env.WAPILOT_SEND_PATH || DEFAULT_SEND_PATH).trim() || DEFAULT_SEND_PATH,
    sendDocumentPathTemplate:
      (process.env.WAPILOT_SEND_DOCUMENT_PATH || DEFAULT_SEND_DOCUMENT_PATH).trim() ||
      DEFAULT_SEND_DOCUMENT_PATH,
    source,
  };
}

function mergeFirestoreWithEnv(
  data: Record<string, unknown>,
  envFallback: WapilotConfig
): WapilotConfig | null {
  const instanceId = typeof data.instanceId === "string" ? data.instanceId.trim() : "";
  const token = typeof data.apiToken === "string" ? data.apiToken.trim() : "";
  if (!instanceId || !token) return null;

  return {
    instanceId,
    token,
    apiRoot:
      (typeof data.apiBaseUrl === "string" && data.apiBaseUrl.trim()) ||
      envFallback.apiRoot,
    sendUrlOverride:
      (typeof data.sendUrl === "string" && data.sendUrl.trim()) ||
      envFallback.sendUrlOverride,
    sendDocumentUrlOverride:
      (typeof data.sendDocumentUrl === "string" && data.sendDocumentUrl.trim()) ||
      envFallback.sendDocumentUrlOverride,
    sendPathTemplate:
      (typeof data.sendPath === "string" && data.sendPath.trim()) ||
      envFallback.sendPathTemplate,
    sendDocumentPathTemplate:
      (typeof data.sendDocumentPath === "string" && data.sendDocumentPath.trim()) ||
      envFallback.sendDocumentPathTemplate,
    source: "firestore",
  };
}

/** Resolve Wapilot credentials: Firestore `settings/wapilot` first, then Vercel env. */
export async function loadWapilotConfig(forceRefresh = false): Promise<WapilotConfig> {
  const now = Date.now();
  if (!forceRefresh && cached && now - cachedAt < CACHE_MS) {
    return cached;
  }

  const envFallback = configFromEnv();

  try {
    const snap = await adminDb()
      .collection(WAPILOT_SETTINGS_DOC_REF.collection)
      .doc(WAPILOT_SETTINGS_DOC_REF.docId)
      .get();

    if (snap.exists) {
      const merged = mergeFirestoreWithEnv(snap.data() as Record<string, unknown>, envFallback);
      if (merged) {
        cached = merged;
        cachedAt = now;
        return merged;
      }
    }
  } catch (e) {
    console.warn("loadWapilotConfig: Firestore read failed", e);
  }

  cached = envFallback;
  cachedAt = now;
  return envFallback;
}

export function clearWapilotConfigCache(): void {
  cached = null;
  cachedAt = 0;
}

export function wapilotConfigErrorMessage(config: WapilotConfig): string {
  if (!config.instanceId && !config.token) {
    return "Wapilot is not configured. Add Instance ID and API token in Settings → WhatsApp, or set WAPILOT_* environment variables.";
  }
  if (!config.instanceId) return "Wapilot Instance ID is missing.";
  if (!config.token) return "Wapilot API token is missing.";
  return "Wapilot is not configured.";
}
