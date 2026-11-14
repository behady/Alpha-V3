import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { CLINIC_SECRETS_COLLECTION } from "@/types/wapilot";
import { conversationKey } from "@/lib/bot/conversation";
import { readStoredAd } from "@/lib/bot/adReferral";
import { patientSendablePhone, pickPatientPhone } from "@/lib/patientPhone";
import { chargeAmount } from "@/lib/paymentAllocation";
import {
  OPEN_STATUSES,
  TRIGGER_EVENT,
  attributionFromClicks,
  buildConversionPayload,
  classifyResponse,
  clickFromReferral,
  eventsEndpoint,
  isTooOld,
  mergeClicks,
  nextAttemptAt,
  pickClick,
  readCapiSettings,
  readClick,
  redactPayload,
  toMillis,
  type AdClick,
  type ConversionEventName,
  type MetaCapiSettings,
  type SendOutcome,
} from "@/lib/metaConversions";

/**
 * The server half of the Conversions API: settings, the queue, the click lookup and the send.
 *
 * `metaConversions.ts` decides WHAT to say to Meta; this file decides WHEN and actually says it.
 * The Firebase trigger (functions/metaConversions.js) only drops a row into the queue the moment an
 * appointment is booked, confirmed or visited — it never talks to Meta itself. A cron here walks
 * the queue every ten minutes, finds the click that came before each moment, and posts it.
 *
 * Why a queue and not a direct send from the trigger:
 *   - A Purchase must wait for the visit's charges to be entered (PURCHASE_SETTLE_MS), and Meta
 *     keeps the first copy of an event id, so it cannot be sent early and "corrected" later.
 *   - Meta has bad minutes like everyone else. A failed send is retried on a schedule
 *     (RETRY_DELAYS_MS) instead of being lost with a log line nobody reads.
 *   - The row IS the log. The settings card lists the last few so a clinic owner can see "sent",
 *     "skipped — no ad click" or "failed — token expired" without anybody opening a console.
 *
 * Where it lives: `clinic_secrets/{clinicId}/meta_conversion_events/{eventId}`. Not under
 * `clinics/{id}` — the clinic subtree wildcard in firestore.rules lets every member of a clinic
 * read and write any subcollection there, and a nested deny cannot take that back. Everything
 * under `clinic_secrets` is denied to every client, so only the Admin SDK ever sees these rows.
 *
 * Safety for the live clinics: nothing here runs for a clinic unless
 * `clinic_secrets/{clinicId}.metaCapi.enabled === true`, and the token is read from that document
 * only to put it in an Authorization header. It is never stored on a queue row, never logged, and
 * never returned from any function in this file.
 */

// ── Names other files rely on ───────────────────────────────────────────────────────────────

/** Field of `clinic_secrets/{clinicId}` that holds the Conversions API settings. */
export const CAPI_SETTINGS_FIELD = "metaCapi";
/** The queue + log, one row per event id, under `clinic_secrets/{clinicId}`. */
export const CAPI_EVENTS_SUBCOLLECTION = "meta_conversion_events";
/** The WhatsApp card's own settings field (src/lib/metaWhatsapp.ts), used as a fallback. */
const WHATSAPP_SETTINGS_FIELD = "metaWhatsapp";

/** How long a claimed row stays locked against a second, overlapping run. */
const CLAIM_LOCK_MS = 2 * 60 * 1000;
/** One cron run stops claiming new rows after this, so it ends inside the function's 300 s. */
const RUN_BUDGET_MS = 240 * 1000;
const DEFAULT_SEND_TIMEOUT_MS = 15_000;

export function capiEventsCollection(clinicId: string): FirebaseFirestore.CollectionReference {
  const id = String(clinicId || "").trim();
  if (!id) throw new Error("capiEventsCollection: clinicId is required");
  return adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(id).collection(CAPI_EVENTS_SUBCOLLECTION);
}

/** Firestore refuses `undefined` anywhere in a write; this drops those keys (one level deep). */
function defined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e || "unknown error")).slice(0, 500);

// ── Settings ────────────────────────────────────────────────────────────────────────────────

export interface ResolvedCapiConfig {
  /** Exactly what the Conversions API card saved (wabaId/token may be blank there). */
  settings: MetaCapiSettings;
  datasetId: string;
  /** The WABA id to send — the card's own, else the WhatsApp card's. */
  wabaId: string;
  /** The token to send with — the card's own, else the WhatsApp card's. Never leaves the server. */
  token: string;
  testEventCode: string;
  enabled: boolean;
  /** Switched on AND everything needed to send is there. */
  ready: boolean;
  /** Which of datasetId / wabaId / token are missing after the fallbacks. */
  missing: string[];
  wabaFromWhatsapp: boolean;
  tokenFromWhatsapp: boolean;
  whatsappWabaId: string;
  whatsappTokenSet: boolean;
}

/**
 * A clinic's Conversions API settings, with the WhatsApp card's WABA id and token filled in where
 * the clinic left them blank — most clinics use one system-user token for both, and asking them
 * to paste it twice is how the two copies drift apart.
 *
 * No cache, deliberately: an owner who switches this off expects the next run to stop, not one
 * that happens to land on a warm serverless instance a minute later. It is one read per run.
 *
 * A failed read throws. Reading it as "switched off" would mark every queued event `skipped`,
 * and those cannot be un-skipped.
 */
export async function loadCapiConfig(clinicId: string): Promise<ResolvedCapiConfig> {
  const snap = await adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(String(clinicId || "").trim()).get();
  const data = (snap.exists ? snap.data() : null) || {};
  const settings = readCapiSettings(data[CAPI_SETTINGS_FIELD]);
  const wa = (data[WHATSAPP_SETTINGS_FIELD] && typeof data[WHATSAPP_SETTINGS_FIELD] === "object" ? data[WHATSAPP_SETTINGS_FIELD] : {}) as Record<string, unknown>;
  const whatsappWabaId = str(wa.wabaId);
  const whatsappToken = str(wa.token);

  const wabaId = settings.wabaId || whatsappWabaId;
  const token = settings.token || whatsappToken;
  const missing: string[] = [];
  if (!settings.datasetId) missing.push("datasetId");
  if (!wabaId) missing.push("wabaId");
  if (!token) missing.push("token");

  return {
    settings,
    datasetId: settings.datasetId,
    wabaId,
    token,
    testEventCode: settings.testEventCode,
    enabled: settings.enabled,
    ready: settings.enabled && missing.length === 0,
    missing,
    wabaFromWhatsapp: !settings.wabaId && !!whatsappWabaId,
    tokenFromWhatsapp: !settings.token && !!whatsappToken,
    whatsappWabaId,
    whatsappTokenSet: !!whatsappToken,
  };
}

// ── The send ────────────────────────────────────────────────────────────────────────────────

/**
 * POST one body to the dataset's events endpoint and sort the answer.
 *
 * The token rides in the Authorization header, never in the URL or the body, so neither the
 * redacted payload on the log row nor any proxy log in between can carry it. Never throws: a
 * network error or a timeout comes back as a retryable outcome (status 0) with the reason in
 * `error`.
 */
export async function postConversion(args: {
  datasetId: string;
  token: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SendOutcome> {
  const doFetch = args.fetchImpl ?? fetch;
  try {
    const res = await doFetch(eventsEndpoint(args.datasetId), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${args.token}` },
      body: JSON.stringify(args.payload),
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // Meta answers JSON; a proxy error page does not. The status code still decides.
      json = {};
    }
    return classifyResponse(res.status, json);
  } catch (e) {
    return { ...classifyResponse(0, {}), error: errText(e) };
  }
}

// ── Which clicks belong to a patient ────────────────────────────────────────────────────────

/** Clicks on one conversation document: the list, plus the old first-ad-wins `ad` timed by `adAt`. */
function clicksFromConversation(data: Record<string, unknown> | undefined): AdClick[] {
  if (!data) return [];
  const out = mergeClicks(data.adClicks, [], 50);
  const legacy = clickFromReferral(readStoredAd(data.ad), toMillis(data.adAt));
  if (legacy) out.push(legacy);
  return out;
}

/**
 * The click a bot lead carries. Its time is the lead's `createdAt` — the bot writes the lead on
 * the ad's first message, so for an ad lead the two are the same moment. (A lead that existed
 * before the click and had the ad merged in later reads earlier than the real click. The other
 * sources carry the true time, and `mergeClicks` keeps the newest copy of each click id.)
 */
function clickFromLead(data: Record<string, unknown> | undefined): AdClick | null {
  if (!data) return null;
  const meta = (data.meta && typeof data.meta === "object" ? data.meta : {}) as Record<string, unknown>;
  if (!str(meta.ctwaClid)) return null;
  return readClick({
    ctwaClid: meta.ctwaClid,
    clickedAt: toMillis(data.createdAt),
    sourceId: meta.sourceId,
    sourceUrl: meta.sourceUrl,
    headline: meta.adName,
  });
}

/** A read that cannot fail the caller: a missing doc or collection simply contributes nothing. */
async function quietly<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[metaCapi] lookup skipped:", errText(e));
    return fallback;
  }
}

/**
 * Every ad click this system has seen for one patient, newest first.
 *
 * An appointment knows its patient, not its chat, and the click may have been kept in any of
 * three places depending on when and how the person arrived:
 *   (a) on the patient — `adAttribution`, written by the bot once the number is a patient, and by
 *       this file after every send (the carry-over);
 *   (b) on the WhatsApp conversation — keyed by the patient's phone (or their lid chat), plus any
 *       conversation the bot already tied to this patient id;
 *   (c) on a bot lead — `meta.ctwaClid`, found by patient id or by phone. A lead the desk converted
 *       by hand is often the only place the click survived.
 */
export async function clicksForPatient(clinicId: string, patientId: string, patient?: Record<string, unknown> | null): Promise<AdClick[]> {
  let p: Record<string, unknown> | null = patient ?? null;
  if (!p && patientId) {
    p = await quietly(async () => {
      const snap = await adminClinicDoc(clinicId, "patients", patientId).get();
      return snap.exists ? ((snap.data() || {}) as Record<string, unknown>) : null;
    }, null);
  }

  const found: AdClick[] = [];

  // (a) The patient's own record.
  const attr = p?.adAttribution && typeof p.adAttribution === "object" ? (p.adAttribution as Record<string, unknown>) : null;
  if (attr) found.push(...mergeClicks([attr, ...(Array.isArray(attr.clicks) ? attr.clicks : [])], [], 50));

  // (b) Conversations.
  const phone = pickPatientPhone(p);
  const keys = new Set<string>();
  if (phone) keys.add(conversationKey(phone));
  if (typeof p?.whatsappLid === "string" && p.whatsappLid.trim()) keys.add(conversationKey(p.whatsappLid));
  keys.delete("unknown");
  keys.delete("");
  for (const key of keys) {
    const data = await quietly(async () => (await adminClinicDoc(clinicId, "whatsapp_conversations", key).get()).data(), undefined);
    found.push(...clicksFromConversation(data));
  }
  if (patientId) {
    const docs = await quietly(
      async () => (await adminClinicCollection(clinicId, "whatsapp_conversations").where("patientId", "==", patientId).limit(5).get()).docs,
      []
    );
    for (const d of docs) found.push(...clicksFromConversation(d.data()));
  }

  // (c) Leads.
  const leadQueries: Array<[string, string]> = [];
  if (patientId) leadQueries.push(["patientId", patientId], ["existingPatientId", patientId]);
  const phones = new Set<string>();
  const digits = phone.replace(/\D/g, "");
  if (digits) phones.add(`+${digits}`);
  const sendable = quietlySync(() => patientSendablePhone(p));
  if (sendable) phones.add(`+${sendable.replace(/\D/g, "")}`);
  for (const ph of phones) if (ph.length > 1) leadQueries.push(["phone", ph]);
  for (const [field, value] of leadQueries) {
    const docs = await quietly(async () => (await adminClinicCollection(clinicId, "leads").where(field, "==", value).limit(20).get()).docs, []);
    for (const d of docs) {
      const c = clickFromLead(d.data());
      if (c) found.push(c);
    }
  }

  return mergeClicks([], found, 50);
}

function quietlySync(fn: () => string): string {
  try {
    return fn() || "";
  } catch {
    return "";
  }
}

const clickSignature = (v: unknown) => {
  const a = attributionFromClicks(v, []);
  return a ? a.clicks.map((c) => `${c.ctwaClid}@${c.clickedAt}`).join("|") : "";
};

/**
 * Carry the clicks found for a patient onto `patients/{id}.adAttribution`, so the next lookup
 * finds them in one read even after the conversation or the lead is gone. Written only when it
 * adds something, never with null, and never onto a patient document that does not exist.
 */
export async function rememberPatientClicks(clinicId: string, patientId: string, clicks: AdClick[]): Promise<void> {
  if (!patientId || !clicks.length) return;
  const ref = adminClinicDoc(clinicId, "patients", patientId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const existing = (snap.data() || {}).adAttribution;
  const next = attributionFromClicks(existing, clicks);
  if (!next) return;
  if (clickSignature(existing) === clickSignature(next)) return;
  // update, not set-with-merge: a merge would deep-merge the map and leave an older click's
  // headline under a newer click that has none.
  await ref.update({ adAttribution: next });
}

// ── What the visit was worth ────────────────────────────────────────────────────────────────

/**
 * The value a Purchase reports: the treatments charged on that appointment.
 *
 * Ledger rows of type "procedure" carrying this appointment id, skipping rows marked deleted or
 * cancelled, each read with `chargeAmount` (first real figure of `cost`, then `amount` — the
 * oldest rows only have `amount`). `cost` is already net of the discount, so `discountAmount` is
 * not subtracted again. Payments are not counted: Meta is told what the visit was worth, not
 * what was collected that day. 0 when nothing was charged.
 */
export async function appointmentChargeValue(clinicId: string, appointmentId: string): Promise<number> {
  if (!appointmentId) return 0;
  const snap = await adminClinicCollection(clinicId, "ledger").where("appointmentId", "==", appointmentId).get();
  let total = 0;
  for (const d of snap.docs) {
    const row = d.data() || {};
    if (row.type !== "procedure") continue;
    const status = str(row.status).toLowerCase();
    if (status === "deleted" || status === "cancelled") continue;
    total += chargeAmount(row);
  }
  return Math.round(total * 100) / 100;
}

// ── The queue ───────────────────────────────────────────────────────────────────────────────

export interface QueueRunSummary {
  clinicId: string;
  examined: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  /** Set when the clinic's whole run failed (processAllEnabledClinics). */
  error?: string;
}

const VALID_EVENTS = new Set<string>(Object.values(TRIGGER_EVENT));

/**
 * Work one clinic's due rows.
 *
 * Every row is CLAIMED in a transaction before anything is sent: still open, due, and not locked
 * by another run — then locked for two minutes. Two overlapping cron runs (Vercel does retry, and
 * the route can also be run by hand) therefore never both send the same event. Meta would drop
 * the second copy by event id anyway, but the attempt counter and the log would lie.
 *
 * Only one-field queries: the composite indexes are not deployed, so "due" and "not locked" are
 * checked in code on at most `limit` open rows.
 *
 * One bad row never stops the run: its error is caught, its lock released, and it is tried again
 * next time (until it is too old for Meta to take).
 */
export async function processClinicQueue(
  clinicId: string,
  opts: { nowMs?: number; fetchImpl?: typeof fetch; limit?: number; deadlineMs?: number } = {}
): Promise<QueueRunSummary> {
  const now = opts.nowMs ?? Date.now();
  const summary: QueueRunSummary = { clinicId, examined: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  const config = await loadCapiConfig(clinicId);
  const col = capiEventsCollection(clinicId);
  const snap = await col.where("status", "in", OPEN_STATUSES).limit(opts.limit ?? 100).get();

  const isClaimable = (d: Record<string, unknown> | undefined) =>
    !!d &&
    (OPEN_STATUSES as string[]).includes(String(d.status)) &&
    (Number(d.dueAt) || 0) <= now &&
    !((Number(d.lockedUntil) || 0) > now);

  for (const doc of snap.docs) {
    if (!isClaimable(doc.data())) continue;
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const ref = doc.ref;

    let row: Record<string, unknown> | null = null;
    try {
      row = await adminDb().runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        const d = fresh.data();
        if (!isClaimable(d)) return null;
        tx.update(ref, { lockedUntil: now + CLAIM_LOCK_MS });
        return d as Record<string, unknown>;
      });
    } catch (e) {
      console.warn("[metaCapi] claim failed:", clinicId, doc.id, errText(e));
      continue;
    }
    if (!row) continue;
    summary.examined += 1;

    const finish = (patch: Record<string, unknown>) =>
      ref.update({ ...defined(patch), lockedUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });

    try {
      const outcome = await processOne(clinicId, ref.id, row, config, now, opts.fetchImpl);
      await finish(outcome.patch);
      summary[outcome.count] += 1;
    } catch (e) {
      console.warn("[metaCapi] event failed:", clinicId, doc.id, errText(e));
      await ref.update({ lockedUntil: FieldValue.delete() }).catch(() => {});
      summary.failed += 1;
    }
  }
  return summary;
}

type Counter = "sent" | "retried" | "failed" | "skipped";

/** Decide and (when there is something to send) send one claimed row. Returns the row's update. */
async function processOne(
  clinicId: string,
  docId: string,
  row: Record<string, unknown>,
  config: ResolvedCapiConfig,
  now: number,
  fetchImpl?: typeof fetch
): Promise<{ patch: Record<string, unknown>; count: Counter }> {
  const skip = (reason: string): { patch: Record<string, unknown>; count: Counter } => ({ patch: { status: "skipped", reason }, count: "skipped" });

  // Switched off after the row was queued: say so on the row, send nothing.
  if (!config.enabled) return skip("disabled");
  if (!config.ready) {
    return {
      patch: { status: "failed", reason: "not_configured", response: { httpStatus: 0, error: `Missing: ${config.missing.join(", ")}` } },
      count: "failed",
    };
  }

  const eventTimeMs = Number(row.eventTimeMs) || 0;
  if (!eventTimeMs || isTooOld(eventTimeMs, now)) return skip("too_old");

  const trigger = str(row.trigger) as keyof typeof TRIGGER_EVENT;
  const eventName = (VALID_EVENTS.has(str(row.eventName)) ? str(row.eventName) : TRIGGER_EVENT[trigger]) as ConversionEventName | undefined;
  if (!eventName) return skip("unknown_event");
  const eventId = str(row.eventId) || docId;
  const appointmentId = str(row.appointmentId);

  let patientId = str(row.patientId);
  if (!patientId && appointmentId) {
    const appt = await adminClinicDoc(clinicId, "appointments", appointmentId).get();
    patientId = str((appt.data() || {}).patientId);
  }
  if (!patientId) return skip("no_patient");

  const clicks = await clicksForPatient(clinicId, patientId);
  const click = pickClick(clicks, eventTimeMs);
  if (!click) return { patch: { status: "skipped", reason: "no_click", patientId }, count: "skipped" };

  // The carry-over: whatever was found anywhere now also lives on the patient. Best-effort.
  await rememberPatientClicks(clinicId, patientId, clicks).catch((e) => console.warn("[metaCapi] carry-over skipped:", errText(e)));

  const value = eventName === "Purchase" ? await appointmentChargeValue(clinicId, appointmentId) : 0;
  const payload = buildConversionPayload({
    eventName,
    eventTimeMs,
    eventId,
    wabaId: config.wabaId,
    match: { kind: "ctwa", ctwaClid: click.ctwaClid },
    value,
    testEventCode: config.testEventCode || undefined,
  });
  const outcome = await postConversion({ datasetId: config.datasetId, token: config.token, payload, fetchImpl });
  const attempts = (Number(row.attempts) || 0) + 1;

  const common: Record<string, unknown> = {
    patientId,
    attempts,
    ctwaClid: click.ctwaClid,
    clickedAt: click.clickedAt,
    adSourceId: click.sourceId,
    value,
    payload: redactPayload(payload),
    response: responseRecord(outcome),
    test: config.testEventCode ? true : undefined,
    lastAttemptAt: FieldValue.serverTimestamp(),
  };

  if (outcome.kind === "sent") {
    return { patch: { ...common, status: "sent", reason: FieldValue.delete(), sentAt: FieldValue.serverTimestamp() }, count: "sent" };
  }
  if (outcome.kind === "retry") {
    const next = nextAttemptAt(attempts, now);
    if (next !== null) return { patch: { ...common, status: "retry", dueAt: next }, count: "retried" };
    return { patch: { ...common, status: "failed", reason: "out_of_attempts" }, count: "failed" };
  }
  return { patch: { ...common, status: "failed", reason: "meta_rejected" }, count: "failed" };
}

/** Meta's answer as stored on the row, without undefined keys. */
function responseRecord(outcome: SendOutcome): Record<string, unknown> {
  return defined({
    httpStatus: outcome.httpStatus,
    eventsReceived: outcome.eventsReceived,
    fbtraceId: outcome.fbtraceId,
    error: outcome.error,
    errorCode: outcome.errorCode,
  });
}

/**
 * The cron's whole job: every clinic that switched this on, one after the other.
 *
 * Only `clinic_secrets` documents with `metaCapi.enabled == true` are read, so the live clinics
 * that never touched the card cost nothing and are never looked at. One clinic's failure is
 * recorded in its summary and the rest still run.
 */
export async function processAllEnabledClinics(opts: { nowMs?: number; fetchImpl?: typeof fetch } = {}): Promise<QueueRunSummary[]> {
  const deadlineMs = Date.now() + RUN_BUDGET_MS;
  const snap = await adminDb().collection(CLINIC_SECRETS_COLLECTION).where(`${CAPI_SETTINGS_FIELD}.enabled`, "==", true).get();
  const out: QueueRunSummary[] = [];
  for (const doc of snap.docs) {
    if (Date.now() > deadlineMs) break;
    try {
      out.push(await processClinicQueue(doc.id, { ...opts, deadlineMs }));
    } catch (e) {
      console.warn("[metaCapi] clinic run failed:", doc.id, errText(e));
      out.push({ clinicId: doc.id, examined: 0, sent: 0, retried: 0, failed: 1, skipped: 0, error: errText(e) });
    }
  }
  return out;
}

// ── The settings card's helpers ─────────────────────────────────────────────────────────────

/**
 * The newest ad click across the clinic's WhatsApp conversations — what the test button sends
 * with, so the owner does not have to dig a click id out of anything.
 *
 * Two single-field reads (auto-indexed): conversations by `adAt` (when their first ad arrived) and
 * by `lastMessageAt` (a fresh click is always a fresh message, even on a chat whose first ad is
 * months old).
 */
export async function latestClinicClick(clinicId: string): Promise<AdClick | null> {
  const col = adminClinicCollection(clinicId, "whatsapp_conversations");
  const found: AdClick[] = [];
  for (const field of ["adAt", "lastMessageAt"]) {
    const docs = await quietly(async () => (await col.orderBy(field, "desc").limit(field === "adAt" ? 25 : 50).get()).docs, []);
    for (const d of docs) found.push(...clicksFromConversation(d.data()));
  }
  return mergeClicks([], found, 1)[0] ?? null;
}

/**
 * Send one test event, so an owner can see it arrive under Test Events in Events Manager.
 *
 * A test event code is REQUIRED. Without one this would be a real conversion on a real click id,
 * and Meta would train the clinic's ads on a booking that never happened. The switch does not
 * need to be on — testing before switching on is the point — but the dataset, WABA id and token
 * do. The attempt is written to the log like any other row, marked `test: true`.
 */
export async function sendTestConversion(
  clinicId: string,
  opts: { eventName?: ConversionEventName; ctwaClid?: string; testEventCode?: string; fetchImpl?: typeof fetch; nowMs?: number } = {}
): Promise<{ ok: boolean; eventId: string; ctwaClid: string; outcome: SendOutcome | null; error?: string }> {
  const now = opts.nowMs ?? Date.now();
  const config = await loadCapiConfig(clinicId);
  const testEventCode = str(opts.testEventCode) || config.testEventCode;
  if (!testEventCode) return { ok: false, eventId: "", ctwaClid: "", outcome: null, error: "test_code_required" };
  if (config.missing.length) return { ok: false, eventId: "", ctwaClid: "", outcome: null, error: `not_configured: ${config.missing.join(", ")}` };

  const ctwaClid = str(opts.ctwaClid) || (await latestClinicClick(clinicId))?.ctwaClid || "";
  if (!ctwaClid) return { ok: false, eventId: "", ctwaClid: "", outcome: null, error: "no_click_id" };

  const eventName: ConversionEventName = opts.eventName && VALID_EVENTS.has(opts.eventName) ? opts.eventName : "LeadSubmitted";
  const eventId = `test_${now}`;
  const payload = buildConversionPayload({
    eventName,
    eventTimeMs: now,
    eventId,
    wabaId: config.wabaId,
    match: { kind: "ctwa", ctwaClid },
    value: 0,
    testEventCode,
  });
  const outcome = await postConversion({ datasetId: config.datasetId, token: config.token, payload, fetchImpl: opts.fetchImpl });
  const sent = outcome.kind === "sent";

  try {
    await capiEventsCollection(clinicId)
      .doc(eventId)
      .create(
        defined({
          clinicId,
          appointmentId: "",
          patientId: null,
          trigger: "booked",
          eventName,
          eventId,
          eventTimeMs: now,
          status: sent ? "sent" : "failed",
          reason: sent ? undefined : "test_failed",
          dueAt: now,
          attempts: 1,
          ctwaClid,
          value: 0,
          payload: redactPayload(payload),
          response: responseRecord(outcome),
          test: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastAttemptAt: FieldValue.serverTimestamp(),
          sentAt: sent ? FieldValue.serverTimestamp() : undefined,
        })
      );
  } catch (e) {
    // The answer still goes back to the card; only the log line is lost.
    console.warn("[metaCapi] test log not written:", errText(e));
  }

  return defined({ ok: sent, eventId, ctwaClid, outcome, error: sent ? undefined : outcome.error || "send_failed" });
}

/** The latest rows of the log, newest first, timestamps as epoch ms. Rows never hold the token. */
export async function listRecentConversionEvents(clinicId: string, limit?: number): Promise<Array<Record<string, unknown> & { id: string }>> {
  const n = Math.max(1, Math.min(200, Math.floor(limit ?? 30)));
  const snap = await capiEventsCollection(clinicId).orderBy("createdAt", "desc").limit(n).get();
  return snap.docs.map((d) => {
    const data = d.data() || {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function" ? toMillis(v) : v;
    }
    return { ...out, id: d.id };
  });
}
