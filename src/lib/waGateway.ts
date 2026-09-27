/**
 * The server-side client for Alpha's own WhatsApp gateway (`whatsapp-gateway/` in this repo).
 *
 * The gateway speaks Wapilot's API for *sending*, so nothing in lib/whatsapp.ts knows it exists:
 * a clinic on it simply has credentials whose `apiBaseUrl` points at our host. What this file
 * adds is the part Wapilot did in its own dashboard — creating an instance, showing the QR,
 * disconnecting — done through the gateway's admin door with one platform-wide key.
 *
 * Both env vars unset is a supported state: the Settings screen then shows the manual Wapilot
 * fields and nothing else, exactly as before the gateway existed.
 */

const TIMEOUT_MS = 12_000;

export type GatewayState = "starting" | "qr" | "connecting" | "open" | "closed" | "logged_out" | "restricted";

/** The instance's sending rules as they stand right now — see whatsapp-gateway/src/policy.js. */
export type GatewaySending = {
  windowOpen: boolean;
  window: string;
  nextOpenAt: number | null;
  queued: number;
  waiting: number;
  dailyCap: number;
  sentToday: number;
};

export type GatewayInstanceStatus = {
  instanceId: string;
  label: string;
  state: GatewayState;
  phone: string | null;
  connectedAt: number | null;
  qrAt: number | null;
  lastError: string | null;
  webhookUrl: string;
  /** PNG data URL while `state === "qr"`, else null. */
  qr: string | null;
  sending?: GatewaySending;
  token?: string;
};

export function gatewayBaseUrl(): string {
  return String(process.env.ALPHA_WA_GATEWAY_URL || "").trim().replace(/\/$/, "");
}

export function gatewayConfigured(): boolean {
  return Boolean(gatewayBaseUrl() && String(process.env.ALPHA_WA_GATEWAY_ADMIN_KEY || "").trim());
}

/** The `apiBaseUrl` a clinic's stored credentials carry when they point at our gateway. */
export function gatewayApiRoot(): string {
  return `${gatewayBaseUrl()}/api/v2`;
}

/**
 * Whether a stored Wapilot-shaped credentials map is actually one of ours.
 *
 * Decided by the host the credentials send to, not by a flag alone: the flag says what wrote
 * the record, the host says where the messages go, and the second is the one that matters if
 * someone edits the record by hand.
 */
export function isAlphaGatewayCredentials(stored: Record<string, unknown> | undefined | null): boolean {
  if (!stored) return false;
  const root = gatewayApiRoot();
  if (!gatewayBaseUrl()) return false;
  const apiBaseUrl = typeof stored.apiBaseUrl === "string" ? stored.apiBaseUrl.trim().replace(/\/$/, "") : "";
  return apiBaseUrl === root || stored.provider === "alpha";
}

async function adminFetch(path: string, init?: RequestInit & { json?: unknown }): Promise<Response> {
  if (!gatewayConfigured()) throw new Error("The WhatsApp gateway is not configured (ALPHA_WA_GATEWAY_URL / ALPHA_WA_GATEWAY_ADMIN_KEY).");
  const headers: Record<string, string> = {
    "X-Admin-Key": String(process.env.ALPHA_WA_GATEWAY_ADMIN_KEY || "").trim(),
    ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  return fetch(`${gatewayBaseUrl()}${path}`, {
    method: init?.method || "GET",
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error || `Gateway answered ${res.status}`);
  return data;
}

/** Create the instance, or refresh its webhook if it already exists. Returns the SAME token either way. */
export async function gatewayCreateInstance(args: { instanceId: string; webhookUrl: string; label?: string }): Promise<GatewayInstanceStatus & { token: string; created: boolean }> {
  const res = await adminFetch("/admin/instances", { method: "POST", json: args });
  return readJson(res);
}

/** Null when the gateway has never heard of this instance. */
export async function gatewayInstanceStatus(instanceId: string): Promise<GatewayInstanceStatus | null> {
  const res = await adminFetch(`/admin/instances/${encodeURIComponent(instanceId)}`);
  if (res.status === 404) return null;
  return readJson(res);
}

/** Forget the login; the instance comes back waiting for a new scan. */
export async function gatewayLogout(instanceId: string): Promise<GatewayInstanceStatus> {
  const res = await adminFetch(`/admin/instances/${encodeURIComponent(instanceId)}/logout`, { method: "POST" });
  return readJson(res);
}

/** Lift the emergency brake (`state: restricted`) and reconnect with the same session. */
export async function gatewayResume(instanceId: string): Promise<GatewayInstanceStatus> {
  const res = await adminFetch(`/admin/instances/${encodeURIComponent(instanceId)}/resume`, { method: "POST" });
  return readJson(res);
}

/** Remove the instance and its session entirely. Idempotent. */
export async function gatewayDeleteInstance(instanceId: string): Promise<void> {
  const res = await adminFetch(`/admin/instances/${encodeURIComponent(instanceId)}`, { method: "DELETE" });
  if (res.status === 404) return;
  await readJson(res);
}

/**
 * The instance id for a clinic — deterministic, so re-running "connect" finds the same one.
 * Firestore ids are already safe characters; the prefix keeps clinics apart from the platform
 * line and from anything created by hand on the gateway.
 */
export function gatewayInstanceIdForClinic(clinicId: string): string {
  const safe = String(clinicId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 56);
  return `clinic_${safe}`;
}

export const PLATFORM_GATEWAY_INSTANCE_ID = "platform_alerts";

/**
 * Where the gateway posts inbound messages for a clinic.
 *
 * The inbound route identifies the tenant from the URL (`?clinicId=…&token=…`), so this is the
 * one place the webhook address is assembled. The app's public origin is taken from env, with
 * the production domain as the fallback — a per-deploy Vercel URL would break every clinic's
 * inbound the moment the next deploy went out.
 */
export function inboundWebhookUrlForClinic(clinicId: string): string {
  const token = String(process.env.WHATSAPP_INBOUND_TOKEN || "").trim();
  if (!token) throw new Error("WHATSAPP_INBOUND_TOKEN is not set, so the gateway would have nowhere to deliver replies.");
  const origin =
    String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "").trim().replace(/\/$/, "") ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    "https://alphadental.app";
  const u = new URL("/api/webhooks/whatsapp-inbound", origin);
  u.searchParams.set("clinicId", clinicId);
  u.searchParams.set("token", token);
  return u.toString();
}
