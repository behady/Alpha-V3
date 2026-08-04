import { adminDb } from "@/lib/firebaseAdmin";
import {
  CLINIC_SECRETS_COLLECTION,
  WHATSAPP_CLOUD_SETTINGS_DOC,
  type WhatsAppCloudConfig,
  type WhatsAppCloudPublicSettings,
  type WhatsAppCloudStatus,
} from "@/types/whatsappCloud";

// Per-clinic credentials are cached briefly so a burst of sends (e.g. a reminder run) doesn't
// re-read Firestore for every message. Keyed by clinicId; "__env__" holds the env fallback.
const CACHE_MS = 60_000;
const cache = new Map<string, { config: WhatsAppCloudConfig; at: number }>();

const ENV_CACHE_KEY = "__env__";

/**
 * Shared fallback credentials, used when a clinic hasn't connected its own number yet.
 * During development this points at Meta's test number so the whole app is testable before any
 * clinic has completed onboarding. In production it should be unset or point at a number you
 * control — never at one clinic's live number, or their messages would send as another business.
 */
function configFromEnv(): WhatsAppCloudConfig {
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const wabaId = process.env.META_WHATSAPP_WABA_ID?.trim() ?? "";

  return {
    phoneNumberId,
    wabaId,
    accessToken,
    source: phoneNumberId && accessToken ? "env" : "none",
    clinicId: null,
  };
}

/**
 * Resolve credentials for a clinic: its own connected number first, then the shared env fallback.
 *
 * Reads the token from `clinic_secrets/{clinicId}` (Admin SDK only) — see the note in
 * types/whatsappCloud.ts for why it can't live under clinics/{clinicId}/.
 */
export async function loadWhatsAppConfig(
  clinicId?: string | null,
  forceRefresh = false
): Promise<WhatsAppCloudConfig> {
  const cacheKey = clinicId || ENV_CACHE_KEY;
  const now = Date.now();

  if (!forceRefresh) {
    const hit = cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_MS) return hit.config;
  }

  const envFallback = configFromEnv();

  if (clinicId) {
    try {
      const snap = await adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(clinicId).get();
      const data = snap.exists ? (snap.data()?.whatsapp as Record<string, unknown> | undefined) : undefined;

      const phoneNumberId = typeof data?.phoneNumberId === "string" ? data.phoneNumberId.trim() : "";
      const accessToken = typeof data?.accessToken === "string" ? data.accessToken.trim() : "";

      // Partial credentials are treated as not-configured rather than merged with env — mixing one
      // clinic's phone number ID with the fallback token would send from the wrong business.
      if (phoneNumberId && accessToken) {
        const config: WhatsAppCloudConfig = {
          phoneNumberId,
          accessToken,
          wabaId: typeof data?.wabaId === "string" ? data.wabaId.trim() : "",
          source: "clinic",
          clinicId,
        };
        cache.set(cacheKey, { config, at: now });
        return config;
      }
    } catch (e) {
      console.warn(`loadWhatsAppConfig: clinic_secrets read failed for ${clinicId}`, e);
    }
  }

  const fallback = { ...envFallback, clinicId: clinicId ?? null };
  cache.set(cacheKey, { config: fallback, at: now });
  return fallback;
}

/** Call after writing new credentials so the next send picks them up immediately. */
export function clearWhatsAppConfigCache(clinicId?: string | null): void {
  if (clinicId) cache.delete(clinicId);
  else cache.clear();
}

export function whatsappConfigErrorMessage(config: WhatsAppCloudConfig): string {
  if (!config.phoneNumberId && !config.accessToken) {
    return "WhatsApp is not connected. Connect a number in Settings → WhatsApp, or set META_WHATSAPP_* environment variables.";
  }
  if (!config.phoneNumberId) return "WhatsApp Phone Number ID is missing.";
  if (!config.accessToken) return "WhatsApp access token is missing.";
  return "WhatsApp is not configured.";
}

/** Persist a clinic's credentials, splitting secret and public halves across the two locations. */
export async function saveClinicWhatsAppCredentials(
  clinicId: string,
  secrets: { phoneNumberId: string; accessToken: string; wabaId?: string },
  publicSettings: WhatsAppCloudPublicSettings
): Promise<void> {
  const db = adminDb();

  await db.collection(CLINIC_SECRETS_COLLECTION).doc(clinicId).set(
    {
      whatsapp: {
        phoneNumberId: secrets.phoneNumberId.trim(),
        accessToken: secrets.accessToken.trim(),
        wabaId: (secrets.wabaId || "").trim(),
      },
    },
    { merge: true }
  );

  await db
    .collection("clinics")
    .doc(clinicId)
    .collection(WHATSAPP_CLOUD_SETTINGS_DOC.collection)
    .doc(WHATSAPP_CLOUD_SETTINGS_DOC.docId)
    .set({ ...publicSettings, status: "connected" }, { merge: true });

  clearWhatsAppConfigCache(clinicId);
}

/** Disconnect a clinic: delete the token, keep the settings doc as an audit trail. */
export async function disconnectClinicWhatsApp(clinicId: string): Promise<void> {
  const db = adminDb();

  await db.collection(CLINIC_SECRETS_COLLECTION).doc(clinicId).set({ whatsapp: null }, { merge: true });
  await db
    .collection("clinics")
    .doc(clinicId)
    .collection(WHATSAPP_CLOUD_SETTINGS_DOC.collection)
    .doc(WHATSAPP_CLOUD_SETTINGS_DOC.docId)
    .set({ status: "disconnected" }, { merge: true });

  clearWhatsAppConfigCache(clinicId);
}

/** Masked status for the Settings UI. Never returns the token itself. */
export async function getWhatsAppStatus(clinicId: string): Promise<WhatsAppCloudStatus> {
  const config = await loadWhatsAppConfig(clinicId, true);

  let publicSettings: WhatsAppCloudPublicSettings = {};
  try {
    const snap = await adminDb()
      .collection("clinics")
      .doc(clinicId)
      .collection(WHATSAPP_CLOUD_SETTINGS_DOC.collection)
      .doc(WHATSAPP_CLOUD_SETTINGS_DOC.docId)
      .get();
    if (snap.exists) publicSettings = snap.data() as WhatsAppCloudPublicSettings;
  } catch (e) {
    console.warn(`getWhatsAppStatus: settings read failed for ${clinicId}`, e);
  }

  return {
    ...publicSettings,
    configured: Boolean(config.phoneNumberId && config.accessToken),
    source: config.source,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId || "",
    tokenSet: Boolean(config.accessToken),
  };
}
