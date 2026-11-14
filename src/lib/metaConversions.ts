/**
 * Telling Meta which WhatsApp ad clicks became patients.
 *
 * A clinic running Click-to-WhatsApp ads pays Meta to find people who will open a chat. Meta then
 * optimises for exactly that — more chats — because a chat is the last thing it ever hears about.
 * Whether that chat turned into a booking, a visit or nothing at all happens inside this system,
 * and until now it stayed here. The Conversions API for Business Messaging is the return path:
 * the click id (`ctwa_clid`) Meta put on the first message of the ad conversation goes back with
 * an event — "this click booked", "this click came in and paid" — and the ad set can then be
 * optimised for patients instead of chats.
 *
 * This module is the pure half: which appointment change means which event, what the request
 * looks like, which click it belongs to, and what to do with Meta's answer. No Firestore, no
 * fetch — the server half (`metaConversionsServer.ts`) and the Firebase trigger
 * (`functions/metaConversions.js`, which twins `conversionTriggers` below) do the I/O.
 *
 * Off by default for every clinic. Nothing is sent for an appointment whose patient never came
 * from an ad click: there is nothing to credit, and Meta has no use for it.
 */

// ── Configuration ────────────────────────────────────────────────────────────────────────────

/**
 * Graph API version for the events endpoint. One constant, overridable per deployment, so a Meta
 * deprecation is an env change rather than a code hunt. The lead-form webhook already runs v23.0.
 */
export const META_CAPI_GRAPH_VERSION = (process.env.META_CAPI_GRAPH_VERSION || "").trim() || "v23.0";
export const META_GRAPH_ROOT = "https://graph.facebook.com";
/** Identifies the sender to Meta. Not a secret. */
export const META_CAPI_PARTNER_AGENT = "alpha-dental";
export const META_CAPI_CURRENCY = "EGP";

/** The events-endpoint URL for one dataset. The token goes in the Authorization header, never here. */
export function eventsEndpoint(datasetId: string, version: string = META_CAPI_GRAPH_VERSION): string {
  return `${META_GRAPH_ROOT}/${version}/${encodeURIComponent(datasetId.trim())}/events`;
}

/**
 * How long a visit sits before its Purchase goes out. Meta keeps the FIRST event it receives for
 * an event id and drops later copies, so a Purchase cannot be "updated" once sent. Waiting a few
 * hours after the patient arrives lets the dentist enter the day's treatments first, so the value
 * Meta learns from is the real one rather than zero.
 */
export const PURCHASE_SETTLE_MS = 3 * 60 * 60 * 1000;

/** Meta rejects events whose event_time is more than seven days old. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A click older than this is not credited. Meta's own attribution windows are far shorter; this
 * only stops a patient who tapped one ad two years ago from being reported on every visit since.
 */
export const MAX_CLICK_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Total tries per event (the first send included). */
export const MAX_ATTEMPTS = 5;
/** Wait before try N+1, indexed by tries already made: 5 min, 20 min, 1 h, 3 h → ~4.5 h in all. */
export const RETRY_DELAYS_MS = [5 * 60_000, 20 * 60_000, 60 * 60_000, 3 * 60 * 60_000] as const;

// ── Event mapping ───────────────────────────────────────────────────────────────────────────

export type ConversionEventName = "LeadSubmitted" | "QualifiedLead" | "Purchase";
export type ConversionTrigger = "booked" | "confirmed" | "visited";

export const TRIGGER_EVENT: Record<ConversionTrigger, ConversionEventName> = {
  booked: "LeadSubmitted",
  confirmed: "QualifiedLead",
  visited: "Purchase",
};

/** Statuses that mean the patient physically came in. The first one reached is the visit. */
export const VISITED_STATUSES = ["Checked In", "In Chair", "Checking Out", "Completed"] as const;
/** Legacy spellings still found on old rows (see appointmentStages.ts). */
const STATUS_ALIASES: Record<string, string> = { Arrived: "Checked In", Seated: "In Chair", Pending: "Scheduled" };
const DEAD_STATUSES = new Set(["Cancelled", "No Show"]);

function canon(status: unknown): string {
  const s = typeof status === "string" ? status.trim() : "";
  if (!s) return "";
  return STATUS_ALIASES[s] || s;
}
const isVisited = (s: string) => (VISITED_STATUSES as readonly string[]).includes(s);

/**
 * Which conversion moments one appointment write represents.
 *
 * `before` is null for a newly created appointment, `after` null for a deleted one. A new booking
 * is `booked`; a booking made already confirmed (the bot's auto-confirm, or the desk picking
 * Confirmed in the popup) is both `booked` and `confirmed`. Reaching any visited stage from a
 * non-visited one is `visited` — Checked In → In Chair → Completed is one visit, not three, and
 * the event id makes sure only the first is ever queued.
 *
 * Twinned in functions/metaConversions.js — the test in tests/metaConversions.test.mts runs the
 * same table through both.
 */
export function conversionTriggers(before: { status?: unknown } | null, after: { status?: unknown } | null): ConversionTrigger[] {
  if (!after) return [];
  const a = canon(after.status) || "Scheduled";
  if (DEAD_STATUSES.has(a)) return [];
  const out: ConversionTrigger[] = [];
  const b = before ? canon(before.status) || "Scheduled" : null;
  if (b === null) out.push("booked");
  if (a === "Confirmed" && b !== "Confirmed") out.push("confirmed");
  if (isVisited(a) && !(b && isVisited(b))) out.push("visited");
  return out;
}

/** The idempotency key: one event of each kind per appointment, ever. Also the log doc id. */
export function conversionEventId(appointmentId: string, eventName: ConversionEventName): string {
  return `${appointmentId}_${eventName}`;
}

/** When a queued event is first due. Purchases wait for the visit's charges to be entered. */
export function firstDueAt(trigger: ConversionTrigger, eventTimeMs: number): number {
  return trigger === "visited" ? eventTimeMs + PURCHASE_SETTLE_MS : eventTimeMs;
}

// ── Which click ─────────────────────────────────────────────────────────────────────────────

/** One ad click, as stored on conversations, leads and patients. */
export interface AdClick {
  ctwaClid: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  /** Epoch ms the click's first message arrived. */
  clickedAt: number;
}

/** Keep the newest copy of each click id, newest first, at most `max`. */
export function mergeClicks(existing: unknown, incoming: AdClick[], max = 10): AdClick[] {
  const all = [...(Array.isArray(existing) ? existing : []), ...incoming]
    .map(readClick)
    .filter((c): c is AdClick => !!c);
  const byId = new Map<string, AdClick>();
  for (const c of all) {
    const prev = byId.get(c.ctwaClid);
    if (!prev || c.clickedAt > prev.clickedAt) byId.set(c.ctwaClid, c);
  }
  return [...byId.values()].sort((x, y) => y.clickedAt - x.clickedAt).slice(0, max);
}

/** A click from any stored shape; null when it carries no click id or no time. */
export function readClick(raw: unknown): AdClick | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ctwaClid = typeof r.ctwaClid === "string" ? r.ctwaClid.trim() : "";
  const at = toMillis(r.clickedAt ?? r.at);
  if (!ctwaClid || !at) return null;
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const out: AdClick = { ctwaClid: ctwaClid.slice(0, 300), clickedAt: at };
  const sourceId = s(r.sourceId, 64);
  const sourceUrl = s(r.sourceUrl, 500);
  const headline = s(r.headline, 160);
  if (sourceId) out.sourceId = sourceId;
  if (sourceUrl) out.sourceUrl = sourceUrl;
  if (headline) out.headline = headline;
  return out;
}

/**
 * The click an event is credited to: the newest one at or before the event, and not older than
 * MAX_CLICK_AGE_MS. A click AFTER the booking did not cause it.
 */
export function pickClick(clicks: AdClick[], eventTimeMs: number): AdClick | null {
  let best: AdClick | null = null;
  for (const c of clicks) {
    if (c.clickedAt > eventTimeMs) continue;
    if (eventTimeMs - c.clickedAt > MAX_CLICK_AGE_MS) continue;
    if (!best || c.clickedAt > best.clickedAt) best = c;
  }
  return best;
}

/** A click from a parsed referral (`AdReferral` shape). Null when Meta sent no click id. */
export function clickFromReferral(ad: { ctwaClid?: string; sourceId?: string; sourceUrl?: string; headline?: string } | null | undefined, atMs: number): AdClick | null {
  if (!ad?.ctwaClid) return null;
  return readClick({ ...ad, clickedAt: atMs });
}

/**
 * `patients/{id}.adAttribution`: the newest click on top (what attribution uses), every click kept
 * underneath with its time. Merging never drops a click id and never writes an empty one.
 */
export interface PatientAdAttribution extends AdClick {
  clicks: AdClick[];
}

export function attributionFromClicks(existing: unknown, incoming: AdClick[]): PatientAdAttribution | null {
  const prev = existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  const clicks = mergeClicks([...(Array.isArray(prev.clicks) ? prev.clicks : []), prev], incoming);
  if (!clicks.length) return null;
  return { ...clicks[0], clicks };
}

/** Firestore Timestamp, Date, epoch ms or ISO string → epoch ms (0 when unreadable). */
export function toMillis(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (v && typeof v === "object") {
    const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === "function") return o.toMillis();
    const sec = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : NaN;
    if (Number.isFinite(sec)) return sec * 1000;
  }
  return 0;
}

// ── Request body ────────────────────────────────────────────────────────────────────────────

/**
 * How the person is identified to Meta. Only the click id is used today. The phone variant is the
 * fallback for chats that carry no click id (organic, or a referral Meta did not attach): Meta
 * wants SHA-256 of the E.164 digits plus the Page id. It is typed and built here so adding it is
 * a change to the caller's choice, not to the request shape — but nothing selects it yet.
 */
export type MatchKey =
  | { kind: "ctwa"; ctwaClid: string }
  | { kind: "phone"; phoneSha256: string; pageId: string };

export interface ConversionPayloadInput {
  eventName: ConversionEventName;
  eventTimeMs: number;
  eventId: string;
  wabaId: string;
  match: MatchKey;
  value?: number;
  currency?: string;
  testEventCode?: string;
}

export function buildUserData(wabaId: string, match: MatchKey): Record<string, string> {
  if (match.kind === "ctwa") return { whatsapp_business_account_id: wabaId, ctwa_clid: match.ctwaClid };
  return { whatsapp_business_account_id: wabaId, ph: match.phoneSha256, page_id: match.pageId };
}

/** The JSON body POSTed to /{dataset_id}/events. Contains no credentials. */
export function buildConversionPayload(input: ConversionPayloadInput): Record<string, unknown> {
  const value = Number.isFinite(input.value) && (input.value as number) > 0 ? Math.round((input.value as number) * 100) / 100 : 0;
  const body: Record<string, unknown> = {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(input.eventTimeMs / 1000),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        event_id: input.eventId,
        user_data: buildUserData(input.wabaId, input.match),
        custom_data: { currency: input.currency || META_CAPI_CURRENCY, value },
      },
    ],
    partner_agent: META_CAPI_PARTNER_AGENT,
  };
  const code = input.testEventCode?.trim();
  if (code) body.test_event_code = code;
  return body;
}

/** What the future phone match hashes (SHA-256): the E.164 number as digits only, no "+". */
export function phoneDigitsForHash(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

const SECRET_KEYS = /^(access_token|token|appsecret_proof|authorization)$/i;

/** A deep copy with anything credential-shaped blanked, for the log. */
export function redactPayload<T>(payload: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : walk(val);
      return out;
    }
    return v;
  };
  return walk(payload) as T;
}

// ── Meta's answer ───────────────────────────────────────────────────────────────────────────

export interface SendOutcome {
  /** sent: accepted. retry: try again later. failed: never retry (bad request, bad token). */
  kind: "sent" | "retry" | "failed";
  httpStatus: number;
  eventsReceived?: number;
  fbtraceId?: string;
  error?: string;
  errorCode?: number;
}

/**
 * Sort Meta's response into what to do next.
 *
 * Network failures (status 0), 5xx and 429 retry. Other 4xx do not — a wrong dataset id or an
 * expired token fails the same way every time, and hammering Meta with it helps nobody — except
 * when Meta itself flags the error transient (`is_transient`) or it is one of the throttling
 * codes it sometimes answers with a 400 (4, 17, 32, 613, 80004).
 */
export function classifyResponse(httpStatus: number, body: unknown): SendOutcome {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const err = (b.error && typeof b.error === "object" ? b.error : null) as Record<string, unknown> | null;
  const eventsReceived = typeof b.events_received === "number" ? b.events_received : undefined;
  const fbtraceId =
    typeof b.fbtrace_id === "string" ? b.fbtrace_id : err && typeof err.fbtrace_id === "string" ? err.fbtrace_id : undefined;
  const errorCode = err && typeof err.code === "number" ? err.code : undefined;
  const error = err
    ? [err.message, err.error_user_msg].filter((x) => typeof x === "string" && x).join(" — ").slice(0, 500) || "Meta returned an error"
    : undefined;
  const base = { httpStatus, ...(eventsReceived !== undefined ? { eventsReceived } : {}), ...(fbtraceId ? { fbtraceId } : {}), ...(error ? { error } : {}), ...(errorCode !== undefined ? { errorCode } : {}) };

  if (httpStatus >= 200 && httpStatus < 300 && !err) {
    if (eventsReceived === 0) return { ...base, kind: "failed", error: "Meta accepted the request but received 0 events" };
    return { ...base, kind: "sent" };
  }
  if (httpStatus === 0 || httpStatus >= 500 || httpStatus === 429) return { ...base, kind: "retry", error: error || `HTTP ${httpStatus || "network error"}` };
  const throttled = errorCode !== undefined && [4, 17, 32, 613, 80004].includes(errorCode);
  if (err && (err.is_transient === true || throttled)) return { ...base, kind: "retry" };
  return { ...base, kind: "failed", error: error || `HTTP ${httpStatus}` };
}

/**
 * After a try that did not succeed: when the next one is due, or null to give up.
 * `attemptsMade` counts the try that just happened.
 */
export function nextAttemptAt(attemptsMade: number, nowMs: number): number | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MS[Math.min(attemptsMade - 1, RETRY_DELAYS_MS.length - 1)];
  return nowMs + (delay ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
}

// ── Queue states ────────────────────────────────────────────────────────────────────────────

/**
 * pending: queued, not yet tried. retry: tried, waiting for the next try. sent: Meta took it.
 * failed: gave up (4xx, or out of tries). skipped: nothing to send — no click on the patient,
 * the event is too old, or the clinic switched the feature off before it went out.
 */
export type QueueStatus = "pending" | "retry" | "sent" | "failed" | "skipped";
export const OPEN_STATUSES: QueueStatus[] = ["pending", "retry"];

/** Whether an event's moment is too old for Meta to take. */
export function isTooOld(eventTimeMs: number, nowMs: number): boolean {
  return nowMs - eventTimeMs > MAX_EVENT_AGE_MS;
}

// ── Settings ────────────────────────────────────────────────────────────────────────────────

/** `clinic_secrets/{clinicId}.metaCapi` — server-only, like the WhatsApp token beside it. */
export interface MetaCapiSettings {
  enabled: boolean;
  datasetId: string;
  /** Falls back to the WhatsApp card's WABA id when empty. */
  wabaId: string;
  /** Falls back to the WhatsApp card's system-user token when empty. */
  token: string;
  testEventCode: string;
}

export function readCapiSettings(raw: unknown): MetaCapiSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return { enabled: r.enabled === true, datasetId: s(r.datasetId), wabaId: s(r.wabaId), token: s(r.token), testEventCode: s(r.testEventCode) };
}

/** Digits only, as Meta issues them. */
export const isMetaId = (v: string) => /^\d{5,25}$/.test(v.trim());
