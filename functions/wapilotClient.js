"use strict";

/**
 * Mirrors `src/lib/wapilotConfig.ts` + `src/lib/whatsapp.ts`.
 * Loads `settings/wapilot` from Firestore first, then env vars on Firebase Functions.
 */

const admin = require("firebase-admin");

const DEFAULT_API_ROOT = "https://api.wapilot.net/api/v2";
const DEFAULT_SEND_PATH = "/{instanceId}/send-message";
const DEFAULT_SEND_DOCUMENT_PATH = "/{instanceId}/send-file";

let cachedConfig = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

function cleanPhone(raw) {
  const s = String(raw || "").trim();
  const keepPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return keepPlus ? `+${digits}` : digits;
}

function normalizeToE164(raw) {
  const value = cleanPhone(raw);
  if (!value) return "";
  const normalized = value.startsWith("+") ? value : value.startsWith("00") ? `+${value.slice(2)}` : "";
  if (!normalized) return "";
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : "";
}

function normalizeToInternationalDigits(raw) {
  return normalizeToE164(raw)
    .replace(/^\+/, "")
    .replace(/\D/g, "");
}

function configFromEnv() {
  const instanceId = (process.env.WAPILOT_INSTANCE_ID || "").trim();
  const token = (process.env.WAPILOT_API_TOKEN || process.env.WAPILOT_ACCESS_TOKEN || "").trim();
  return {
    instanceId,
    token,
    apiRoot: (process.env.WAPILOT_API_BASE_URL || DEFAULT_API_ROOT).replace(/\/$/, ""),
    sendUrlOverride: (process.env.WAPILOT_SEND_URL || "").trim() || null,
    sendPathTemplate: (process.env.WAPILOT_SEND_PATH || DEFAULT_SEND_PATH).trim() || DEFAULT_SEND_PATH,
    source: instanceId && token ? "env" : "none",
  };
}

function mergeFirestoreWithEnv(data, envFallback) {
  const instanceId = typeof data.instanceId === "string" ? data.instanceId.trim() : "";
  const token = typeof data.apiToken === "string" ? data.apiToken.trim() : "";
  if (!instanceId || !token) return null;

  return {
    instanceId,
    token,
    apiRoot:
      (typeof data.apiBaseUrl === "string" && data.apiBaseUrl.trim()) || envFallback.apiRoot,
    sendUrlOverride:
      (typeof data.sendUrl === "string" && data.sendUrl.trim()) || envFallback.sendUrlOverride,
    sendPathTemplate:
      (typeof data.sendPath === "string" && data.sendPath.trim()) || envFallback.sendPathTemplate,
    source: "firestore",
  };
}

async function getWapilotConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedConfig && now - cachedAt < CACHE_MS) {
    return cachedConfig;
  }

  const envFallback = configFromEnv();

  try {
    const snap = await admin.firestore().collection("settings").doc("wapilot").get();
    if (snap.exists) {
      const merged = mergeFirestoreWithEnv(snap.data() || {}, envFallback);
      if (merged) {
        cachedConfig = merged;
        cachedAt = now;
        return merged;
      }
    }
  } catch (e) {
    console.warn("getWapilotConfig: Firestore read failed", e);
  }

  cachedConfig = envFallback;
  cachedAt = now;
  return envFallback;
}

function buildSendUrl(apiRoot, instanceId, template) {
  const path = template
    .replace(/\{instanceId\}/g, encodeURIComponent(instanceId))
    .replace(/^\//, "");
  return `${apiRoot}/${path}`;
}

function wapilotConfigErrorMessage(config) {
  if (!config.instanceId && !config.token) {
    return "Wapilot is not configured. Add credentials in Settings → WhatsApp or set WAPILOT_* env on Functions.";
  }
  if (!config.instanceId) return "Wapilot Instance ID is missing.";
  if (!config.token) return "Wapilot API token is missing.";
  return "Wapilot is not configured.";
}

/**
 * @param {string} phone
 * @param {string} message
 */
async function sendWapilotWhatsApp(phone, message) {
  const config = await getWapilotConfig();
  const { instanceId, token, apiRoot, sendUrlOverride, sendPathTemplate } = config;

  if (!instanceId || !token) {
    throw new Error(wapilotConfigErrorMessage(config));
  }

  const digits = normalizeToInternationalDigits(phone);
  if (!digits) {
    throw new Error("Invalid phone for Wapilot");
  }

  const url = sendUrlOverride || buildSendUrl(apiRoot, instanceId, sendPathTemplate);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Token: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: `${digits}@c.us`,
      text: String(message || ""),
    }),
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Wapilot API failed (${res.status}): ${details}`);
  }
  return res.json().catch(() => ({}));
}

module.exports = {
  sendWapilotWhatsApp,
  normalizeToInternationalDigits,
  getWapilotConfig,
};
