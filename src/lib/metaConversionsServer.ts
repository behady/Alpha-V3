import { createHash } from "node:crypto";
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
  recheckAppointment,
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
 *   - A Purchase must wait for the visit's charges to be entered (PURCHASE_SETTLE_MS). We send
 *     one Purchase per visit, and Meta does NOT deduplicate these events by event_id, so it
 *     cannot be sent early and "corrected" later — the correction would count as a second sale.
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
 * Sending each event once is OUR job. Meta's docs tell partners to dedupe before sending; it does
 * not drop a repeated event_id. The guards: the trigger's create() (one row per appointment and
 * event), the claim lock (one run per row), rows that are never reopened once final, the
 * once-per-click markers below (one lead and one qualified lead per ad click, RESERVED before the
 * send so two rows on one click in two overlapping runs cannot both go out, and kept reserved
 * through a timed-out or 5xx try so no other row on that click goes out while that one may
 * already be at Meta), a sent row that is never released for another try even when its "sent"
 * cannot be written, and an undone row that is only deleted (to be queued afresh) if it was never
 * posted. What they cannot cover: a request that timed out after Meta had already accepted it is
 * retried, and Meta counts that second copy too. The 30-second timeout makes that rare; it cannot
 * make it impossible.
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
/**
 * Once-per-click markers, beside the queue and just as server-only. A separate subcollection so
 * the queue query and the settings card's log never trip over them.
 */
export const CAPI_CLICKS_SUBCOLLECTION = "meta_conversion_clicks";
/** The WhatsApp card's own settings field (src/lib/metaWhatsapp.ts), used as a fallback. */
const WHATSAPP_SETTINGS_FIELD = "metaWhatsapp";

/**
 * How long a claimed row stays locked against a second, overlapping run. Measured on the real
 * clock from the moment of the claim: a row claimed four minutes into a long run must still be
 * locked when the next run starts. Far longer than one row takes (a few reads plus one send of at
 * most DEFAULT_SEND_TIMEOUT_MS).
 */
const CLAIM_LOCK_MS = 5 * 60_000;
/**
 * A run stops claiming new rows after this, so it ends inside the function's 300 s — the cron's
 * all-clinics run and, by default, every single-clinic run too (processClinicQueue).
 */
const RUN_BUDGET_MS = 240 * 1000;
/**
 * Generous on purpose. A request that times out may still have reached Meta, and since Meta does
 * not dedupe, the retry would be counted twice — so a slow answer is better waited for.
 */
const DEFAULT_SEND_TIMEOUT_MS = 30_000;
/**
 * A row whose click is reserved by another row that is still open (mid-send in another run, or
 * waiting for a retry after a timeout or a 5xx) waits this long and asks again — until that row
 * is sent (this one ends "already_credited") or ends without a send (this one takes the click).
 */
const MARKER_BUSY_WAIT_MS = 5 * 60_000;
/** Tries at writing "sent" onto a row Meta has accepted, before giving up on the record. */
const SENT_WRITE_TRIES = 3;
/**
 * The lock left on a row Meta accepted but whose "sent" could not be written. Releasing it would
 * let the next run post it again, and Meta would count it twice. The row is flagged
 * `sentUnrecorded` in the same write; whichever run claims it after the lock lapses records it as
 * sent without posting anything.
 */
const SENT_UNRECORDED_LOCK_MS = 24 * 60 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Events that are credited once per ad click. A Purchase is once per visit and has no marker. */
const ONCE_PER_CLICK = new Set<ConversionEventName>(["LeadSubmitted", "QualifiedLead"]);

export function capiEventsCollection(clinicId: string): FirebaseFirestore.CollectionReference {
  const id = String(clinicId || "").trim();
  if (!id) throw new Error("capiEventsCollection: clinicId is required");
  return adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(id).collection(CAPI_EVENTS_SUBCOLLECTION);
}

/**
 * The once-per-click marker for one click and one event kind. The id hashes the click id: Meta's
 * click ids run to a few hundred characters and may hold characters a document id should not.
 */
export function clickMarkerRef(clinicId: string, ctwaClid: string, eventName: ConversionEventName): FirebaseFirestore.DocumentReference {
  const id = String(clinicId || "").trim();
  if (!id) throw new Error("clickMarkerRef: clinicId is required");
  const hash = createHash("sha256").update(ctwaClid).digest("hex").slice(0, 40);
  return adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(id).collection(CAPI_CLICKS_SUBCOLLECTION).doc(`${hash}_${eventName}`);
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
  /**
   * A test code is saved. Live sending pauses while it is (rows wait in the queue): a real event
   * must never go out marked as a test, and a test must never be a real event.
   */
  testMode: boolean;
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
 * A failed read throws, so the run stops without touching a row rather than guessing.
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
    testMode: !!settings.testEventCode,
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
 * before the click and had the ad merged in later reads EARLIER than the real click, and
 * `mergeClicks` keeps the earliest time of each click id — so clicksForPatient only takes a
 * lead's click when no other source, which carries the true time, has that click id.)
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
  const fromLeads: AdClick[] = [];
  for (const [field, value] of leadQueries) {
    const docs = await quietly(async () => (await adminClinicCollection(clinicId, "leads").where(field, "==", value).limit(20).get()).docs, []);
    for (const d of docs) {
      const c = clickFromLead(d.data());
      if (c) fromLeads.push(c);
    }
  }
  // A lead's time can read earlier than the click (see clickFromLead), and the earliest time of a
  // click id wins the merge — so a lead only contributes click ids nobody else has.
  const seen = new Set(found.map((c) => c.ctwaClid));
  for (const c of fromLeads) if (!seen.has(c.ctwaClid)) found.push(c);

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
  /**
   * Rows put back for a later run without a try being spent: their click is mid-send in another
   * run, or an "undone" moment turned out to be true again by the time we went to drop it.
   */
  deferred: number;
  /**
   * Set when the run touched no row because of the clinic's setup: switched off, missing a
   * dataset / WABA id / token, or a test code is saved. The rows wait; once the run resumes,
   * any that are older than Meta's seven days end as `too_old`.
   */
  paused?: "disabled" | "not_configured" | "test_mode";
  /** Set when the clinic's whole run failed (processAllEnabledClinics). */
  error?: string;
}

export interface QueueRunOptions {
  nowMs?: number;
  /** The real clock, for locks and the deadline. Injectable for tests. */
  clock?: () => number;
  fetchImpl?: typeof fetch;
  limit?: number;
  /** Stop claiming new rows after this (clock ms). Defaults to RUN_BUDGET_MS from the start. */
  deadlineMs?: number;
  /**
   * TEST-ONLY seams; production never passes these. Each runs at one exact point a race or a
   * failed write can strike, so the tests can make it strike there.
   */
  testHooks?: {
    /** Before each try at writing "sent" onto a row Meta accepted. Throwing fails that try. */
    beforeSentWrite?: (eventId: string, attempt: number) => void | Promise<void>;
    /** Between the "undone" re-check and the transaction that deletes the row. */
    beforeUndoneDelete?: (eventId: string) => void | Promise<void>;
  };
}

const VALID_EVENTS = new Set<string>(Object.values(TRIGGER_EVENT));
const FINAL_STATUSES = new Set(["sent", "failed", "skipped"]);

/**
 * Work one clinic's due rows.
 *
 * A setup problem pauses the run before any row is read: a clinic switched off, missing a piece
 * of its setup, or in test mode leaves every row exactly as it is. Those are temporary — the
 * owner is mid-way through the card — and ending rows over them would throw real conversions
 * away. Live rows are therefore never sent with a test code; only `sendTestConversion` uses one.
 *
 * Every row is CLAIMED in a transaction before anything is sent: still open, due, and not locked
 * by another run — then locked for CLAIM_LOCK_MS on the real clock (`opts.clock`, injectable for
 * tests). Two overlapping cron runs (Vercel does retry, and the route can also be run by hand)
 * therefore never both send the same event — which matters, because Meta does not dedupe and
 * would count both.
 *
 * The query is one field — `dueAt <= now`, oldest first — so it needs only the automatic index,
 * and every FINAL status deletes `dueAt`, so finished rows leave the query and a pile of
 * not-yet-due or finished rows can never crowd a due one out of the `limit`. The status and the
 * lock are checked in code.
 *
 * The run stops claiming rows RUN_BUDGET_MS in, even when the caller set no deadline (the admin
 * "run" button, the per-clinic cron door): a function cut off by the platform mid-send leaves a
 * row Meta may have taken but this file never marked, and the next run would post it again.
 *
 * One bad row never stops the run. An error BEFORE the send releases the row's lock and it is
 * tried again next time (until it is too old for Meta to take). After a send Meta accepted, the
 * row is never released: see recordSent.
 */
export async function processClinicQueue(clinicId: string, opts: QueueRunOptions = {}): Promise<QueueRunSummary> {
  const now = opts.nowMs ?? Date.now();
  const clock = opts.clock ?? Date.now;
  const deadlineMs = opts.deadlineMs ?? clock() + RUN_BUDGET_MS;
  const summary: QueueRunSummary = { clinicId, examined: 0, sent: 0, retried: 0, failed: 0, skipped: 0, deferred: 0 };
  const config = await loadCapiConfig(clinicId);
  if (!config.enabled) return { ...summary, paused: "disabled" };
  if (!config.ready) return { ...summary, paused: "not_configured" };
  if (config.testMode) return { ...summary, paused: "test_mode" };

  const col = capiEventsCollection(clinicId);
  const snap = await col.where("dueAt", "<=", now).orderBy("dueAt").limit(opts.limit ?? 100).get();

  const isClaimable = (d: Record<string, unknown> | undefined) =>
    !!d &&
    (OPEN_STATUSES as string[]).includes(String(d.status)) &&
    (Number(d.dueAt) || 0) <= now &&
    !((Number(d.lockedUntil) || 0) > clock());

  for (const doc of snap.docs) {
    if (!isClaimable(doc.data())) continue;
    if (clock() > deadlineMs) break;
    const ref = doc.ref;

    let row: Record<string, unknown> | null = null;
    try {
      row = await adminDb().runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        const d = fresh.data();
        if (!isClaimable(d)) return null;
        tx.update(ref, { lockedUntil: clock() + CLAIM_LOCK_MS });
        return d as Record<string, unknown>;
      });
    } catch (e) {
      console.warn("[metaCapi] claim failed:", clinicId, doc.id, errText(e));
      continue;
    }
    if (!row) continue;
    summary.examined += 1;

    const finish = (patch: Record<string, unknown>) =>
      ref.update({
        ...defined(patch),
        // A final row leaves the due-query for good; an open one keeps the dueAt in its patch.
        ...(FINAL_STATUSES.has(String(patch.status)) ? { dueAt: FieldValue.delete() } : {}),
        lockedUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    let outcome: RowOutcome;
    try {
      // processOne never throws once a request has gone to Meta (see there), so anything caught
      // here happened before a send and the row can safely be handed back.
      outcome = await processOne({ clinicId, ref, row, config, now, clock, fetchImpl: opts.fetchImpl, hooks: opts.testHooks });
    } catch (e) {
      console.warn("[metaCapi] event failed:", clinicId, doc.id, errText(e));
      await ref.update({ lockedUntil: FieldValue.delete() }).catch(() => {});
      summary.failed += 1;
      continue;
    }

    if (outcome.kind === "sent") {
      await recordSent({ clinicId, ref, eventId: outcome.eventId, patch: outcome.patch, finish, clock, hooks: opts.testHooks });
      summary.sent += 1;
      continue;
    }

    try {
      if (outcome.kind === "finish") await finish(outcome.patch);
      // A release keeps the status and the tries; only the lock goes (and dueAt moves, if set).
      else if (outcome.kind === "release") await ref.update({ ...defined(outcome.patch), lockedUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      // "done": already written (the row was deleted inside its transaction).
      summary[outcome.count] += 1;
    } catch (e) {
      // Nothing reached Meta on any of these paths (a retry/failed outcome's request did not
      // count), so handing the row back is safe.
      console.warn("[metaCapi] event write failed:", clinicId, doc.id, errText(e));
      await ref.update({ lockedUntil: FieldValue.delete() }).catch(() => {});
      summary.failed += 1;
    }
  }
  return summary;
}

/**
 * Write "sent" onto a row Meta has just accepted — and never hand it back for another try.
 *
 * Meta does not dedupe: a row released after its request went through would be posted again by
 * the next run and counted twice. So the write is tried SENT_WRITE_TRIES times with a short
 * pause, and if it still fails the row keeps its claim lock (it is NOT released), an error is
 * logged with the clinic and event, and — best effort — the lock is stretched to
 * SENT_UNRECORDED_LOCK_MS with `sentUnrecorded: true` beside it, so the run that eventually claims
 * it records it as sent instead of posting it. That same write carries the send's details (the
 * click, the try count, the payload, Meta's answer, the value): the late "sent" only flips the
 * status, and the log row still shows what went to Meta. If even that write fails, the claim lock
 * still holds it for CLAIM_LOCK_MS; past that, the click marker (already "sent" under this row's
 * event id for a lead) still stops a second post — reserveClickMarker records it — and for a
 * Purchase only the console error is left to explain a repeat.
 */
async function recordSent(args: {
  clinicId: string;
  ref: FirebaseFirestore.DocumentReference;
  eventId: string;
  patch: Record<string, unknown>;
  finish: (patch: Record<string, unknown>) => Promise<unknown>;
  clock: () => number;
  hooks?: QueueRunOptions["testHooks"];
}): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= SENT_WRITE_TRIES; attempt++) {
    try {
      await args.hooks?.beforeSentWrite?.(args.eventId, attempt);
      await args.finish(args.patch);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < SENT_WRITE_TRIES) await sleep(150 * attempt);
    }
  }
  console.error(
    "[metaCapi] Meta ACCEPTED this event but the row could not be marked sent; it stays locked so it is never posted again:",
    args.clinicId,
    args.eventId,
    errText(lastError)
  );
  // Everything the "sent" patch carries except the three fields that make it final: those are
  // what the recorded_late path writes later. Undefined keys dropped — Firestore refuses them.
  const details: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.patch)) if (v !== undefined && !SENT_ONLY_FIELDS.has(k)) details[k] = v;
  await args.ref
    .update({ ...details, sentUnrecorded: true, sentUnrecordedAt: args.clock(), lockedUntil: args.clock() + SENT_UNRECORDED_LOCK_MS })
    .catch((e) => console.error("[metaCapi] could not stretch the lock on a sent row:", args.clinicId, args.eventId, errText(e)));
}

/** The fields of a "sent" patch that make the row final; recordSent's fallback leaves them out. */
const SENT_ONLY_FIELDS = new Set(["status", "sentAt", "reason"]);

type Counter = "sent" | "retried" | "failed" | "skipped" | "deferred";
type RowOutcome =
  /** Write this onto the row (and release the lock). */
  | { kind: "finish"; patch: Record<string, unknown>; count: Counter }
  /** Meta accepted it: recordSent writes the patch and never releases the row. */
  | { kind: "sent"; eventId: string; patch: Record<string, unknown> }
  /** Hand the row back unchanged except for `patch` (usually a later dueAt); no try is spent. */
  | { kind: "release"; patch: Record<string, unknown>; count: Counter }
  /** Already handled inside processOne (the row was deleted). */
  | { kind: "done"; count: Counter };

/**
 * Decide and (when there is something to send) send one claimed row.
 *
 * Only called for a clinic that is switched on, fully set up and not in test mode. It may throw
 * BEFORE it posts (a read failed) — the caller then releases the row. Once a request has gone
 * to Meta nothing in here throws: the click marker is settled best-effort and the outcome is
 * handed back for the caller to record.
 */
async function processOne(ctx: {
  clinicId: string;
  ref: FirebaseFirestore.DocumentReference;
  row: Record<string, unknown>;
  config: ResolvedCapiConfig;
  now: number;
  clock: () => number;
  fetchImpl?: typeof fetch;
  hooks?: QueueRunOptions["testHooks"];
}): Promise<RowOutcome> {
  const { clinicId, ref, row, config, now, clock } = ctx;
  const docId = ref.id;
  const skip = (reason: string, extra: Record<string, unknown> = {}): RowOutcome => ({ kind: "finish", patch: { ...extra, status: "skipped", reason }, count: "skipped" });

  // A row Meta already took whose "sent" could not be written (recordSent). Record it, never post.
  if (row.sentUnrecorded === true) {
    return {
      kind: "finish",
      patch: { status: "sent", reason: "recorded_late", sentUnrecorded: FieldValue.delete(), sentAt: FieldValue.serverTimestamp() },
      // Counted as skipped: nothing went to Meta in this run.
      count: "skipped",
    };
  }

  const eventTimeMs = Number(row.eventTimeMs) || 0;
  if (!eventTimeMs || isTooOld(eventTimeMs, now)) return skip("too_old");

  const trigger = str(row.trigger) as keyof typeof TRIGGER_EVENT;
  const eventName = (VALID_EVENTS.has(str(row.eventName)) ? str(row.eventName) : TRIGGER_EVENT[trigger]) as ConversionEventName | undefined;
  if (!eventName) return skip("unknown_event");
  const eventId = str(row.eventId) || docId;
  const appointmentId = str(row.appointmentId);

  // Is the moment still true? One read, right before the send — see recheckAppointment.
  const apptSnap = appointmentId ? await adminClinicDoc(clinicId, "appointments", appointmentId).get() : null;
  const appt = apptSnap?.exists ? ((apptSnap.data() || {}) as Record<string, unknown>) : null;
  const recheck = recheckAppointment(eventName, appt);
  if (recheck.action === "skip") return skip(recheck.reason);
  if (recheck.action === "undone") {
    // Posted before (a timeout, a 5xx): Meta may already have counted it, so it must never be
    // queued again — it ends here. Never posted: drop it, so a later real confirmation or
    // arrival can queue a fresh row (the trigger's create() fails on a row that still exists).
    if ((Number(row.attempts) || 0) > 0) return skip(recheck.reason);
    await ctx.hooks?.beforeUndoneDelete?.(eventId);
    const dropped = await dropUndoneRow(clinicId, ref, eventName, appointmentId);
    if (dropped === "deleted") {
      console.info("[metaCapi] moment undone, row dropped:", clinicId, docId, recheck.reason);
      return { kind: "done", count: "skipped" };
    }
    if (dropped === "gone") return { kind: "done", count: "skipped" };
    // No try is counted, but its click is reserved (or credited) under this row: a run died after
    // reserving, maybe after posting. It may be at Meta, so it ends here like a tried row.
    if (dropped === "maybe_sent") return skip(recheck.reason);
    if (dropped === "mine_sent") {
      return {
        kind: "finish",
        patch: { status: "sent", reason: "recorded_late", sentUnrecorded: FieldValue.delete(), sentAt: FieldValue.serverTimestamp() },
        count: "skipped",
      };
    }
    // True again (the desk re-confirmed in between): leave it open, the next run sends it.
    return { kind: "release", patch: {}, count: "deferred" };
  }

  const patientId = str(row.patientId) || str(appt?.patientId);
  if (!patientId) return skip("no_patient");

  const clicks = await clicksForPatient(clinicId, patientId);
  const click = pickClick(clicks, eventTimeMs);
  if (!click) return skip("no_click", { patientId });

  // The carry-over: whatever was found anywhere now also lives on the patient. Best-effort.
  await rememberPatientClicks(clinicId, patientId, clicks).catch((e) => console.warn("[metaCapi] carry-over skipped:", errText(e)));

  // Once per click: a second booking (or confirmation) from the same ad chat is not a second
  // lead, and Meta would count it as one. A Purchase is per visit and is not limited here. The
  // marker is RESERVED before the send — two rows on one click in two overlapping runs (each
  // holding its own row's lock) would otherwise both see "no marker" and both go out.
  const marker = ONCE_PER_CLICK.has(eventName) ? clickMarkerRef(clinicId, click.ctwaClid, eventName) : null;
  const mine: MarkerOwner = { clinicId, eventName, eventId, appointmentId };
  const clickFields = { ctwaClid: click.ctwaClid, clickedAt: click.clickedAt, adSourceId: click.sourceId };
  if (marker) {
    const claim = await reserveClickMarker(marker, mine, clock(), { row: ref, fields: clickFields });
    if (claim === "already_credited") return skip("already_credited", { patientId, ...clickFields });
    // The click is credited to THIS row: an earlier run posted it and Meta took it, but neither
    // the "sent" nor its fallback reached the row. Record it; never post it again.
    if (claim === "mine_sent") {
      return {
        kind: "finish",
        patch: { patientId, ...clickFields, status: "sent", reason: "recorded_late", sentUnrecorded: FieldValue.delete(), sentAt: FieldValue.serverTimestamp() },
        // Counted as skipped: nothing went to Meta in this run.
        count: "skipped",
      };
    }
    if (claim === "busy") return { kind: "release", patch: { dueAt: now + MARKER_BUSY_WAIT_MS }, count: "deferred" };
  }

  const value = eventName === "Purchase" ? await appointmentChargeValue(clinicId, appointmentId) : 0;
  // Never a test code here: a clinic in test mode never reaches this line.
  const payload = buildConversionPayload({
    eventName,
    eventTimeMs,
    eventId,
    wabaId: config.wabaId,
    match: { kind: "ctwa", ctwaClid: click.ctwaClid },
    value,
  });
  // ── From here on a request may have reached Meta: nothing below may throw. ──
  const outcome = await postConversion({ datasetId: config.datasetId, token: config.token, payload, fetchImpl: ctx.fetchImpl });
  const attempts = (Number(row.attempts) || 0) + 1;

  // Sent: the click is credited for good. Failed (Meta refused it outright): the click is given
  // back for another booking on it. Retry (a timeout, a 5xx, a 429): the click STAYS reserved
  // under this row — that request may have reached Meta, and another row on the same click going
  // out meanwhile would be a second lead Meta counts. Other rows wait ("busy") until this row is
  // sent or ends; see reserveClickMarker.
  if (marker && outcome.kind !== "retry") await settleClickMarker(marker, mine, outcome.kind === "sent");

  const common: Record<string, unknown> = {
    patientId,
    attempts,
    ...clickFields,
    value,
    payload: redactPayload(payload),
    response: responseRecord(outcome),
    lastAttemptAt: FieldValue.serverTimestamp(),
  };

  if (outcome.kind === "sent") {
    return { kind: "sent", eventId, patch: { ...common, status: "sent", reason: FieldValue.delete(), sentAt: FieldValue.serverTimestamp() } };
  }
  if (outcome.kind === "retry") {
    const next = nextAttemptAt(attempts, now);
    if (next !== null) return { kind: "finish", patch: { ...common, status: "retry", dueAt: next }, count: "retried" };
    return { kind: "finish", patch: { ...common, status: "failed", reason: "out_of_attempts" }, count: "failed" };
  }
  return { kind: "finish", patch: { ...common, status: "failed", reason: "meta_rejected" }, count: "failed" };
}

/**
 * Delete a never-posted row whose moment was undone — but only if, re-read inside a transaction,
 * it STILL is: the appointment still says undone and the row is still open, unposted and here.
 *
 * Without the re-read, this race loses an event: we read "Scheduled", the desk re-confirms, the
 * trigger's create() fails ALREADY_EXISTS on our still-present row (and swallows it), and then we
 * delete the row — the real confirmation is never reported. The transaction re-reads the
 * appointment, so a re-confirmation written in between either aborts our delete (contention) or
 * is seen by it.
 *
 * "attempts: 0" is not proof the row was never posted. A run reserves the click marker (and stamps
 * the click on the row, see reserveClickMarker) BEFORE it posts, and a run that died after the
 * post leaves attempts at 0. So for a once-per-click event the marker is read in the same
 * transaction: reserved ("sending") or credited ("sent") under THIS row's event id means the post
 * may have happened, and the row is not deleted. A row with no click stamped never reserved one,
 * so it has no marker to find.
 *
 *   "deleted": dropped. "kept": no longer undone (or no longer ours to drop) — release it.
 *   "gone": the row is already gone. "maybe_sent": its click is reserved ("sending") under this
 *   row — the caller ends it skipped, never deletes it and never posts it. "mine_sent": the click
 *   is credited ("sent") under this row — Meta took it; the caller records it as sent/recorded_late.
 *
 * Exported for the emulator test.
 */
export async function dropUndoneRow(
  clinicId: string,
  ref: FirebaseFirestore.DocumentReference,
  eventName: ConversionEventName,
  appointmentId: string
): Promise<"deleted" | "kept" | "gone" | "maybe_sent" | "mine_sent"> {
  const apptRef = appointmentId ? adminClinicDoc(clinicId, "appointments", appointmentId) : null;
  return adminDb().runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const apptSnap = apptRef ? await tx.get(apptRef) : null;
    if (!fresh.exists) return "gone" as const;
    const d = fresh.data() || {};
    // Every read before any write: a Firestore transaction refuses a read after a write.
    const clid = str(d.ctwaClid);
    const markerSnap = ONCE_PER_CLICK.has(eventName) && clid ? await tx.get(clickMarkerRef(clinicId, clid, eventName)) : null;
    const unsent = (OPEN_STATUSES as string[]).includes(String(d.status)) && !(Number(d.attempts) > 0) && d.sentUnrecorded !== true;
    if (!unsent) return "kept" as const;
    const appt = apptSnap?.exists ? ((apptSnap.data() || {}) as Record<string, unknown>) : null;
    if (recheckAppointment(eventName, appt).action !== "undone") return "kept" as const;
    const m = markerSnap?.exists ? markerSnap.data() || {} : null;
    const rowEventId = str(d.eventId) || ref.id;
    if (m && str(m.eventId) === rowEventId) {
      // Credited under this row: Meta took it, only the row never heard. Record it as sent.
      if (m.state !== "sending") return "mine_sent" as const;
      return "maybe_sent" as const;
    }
    tx.delete(ref);
    return "deleted" as const;
  });
}

interface MarkerOwner {
  clinicId: string;
  eventName: ConversionEventName;
  eventId: string;
  appointmentId: string;
}

/**
 * Reserve the once-per-click marker before a send.
 *
 *   - No marker → written `{state: "sending", reservedAt, eventId, …}`: "reserved".
 *   - state "sent" (or no state: markers from before reservations were only written after a
 *     send) under THIS row's event id → "mine_sent": Meta took this very row before, and only
 *     the row never heard; the caller records it as sent and posts nothing.
 *   - state "sent" (or no state) under another row → "already_credited".
 *   - state "sending", ours (this row's earlier try timed out, or died mid-way) → re-reserved.
 *   - state "sending", another row's — that row is read and decides:
 *       sent, or sent but unrecorded → "already_credited" (and the marker is corrected to "sent");
 *       still open (pending / retry) → "busy": it is mid-send, or waiting for a retry after a try
 *         that may have reached Meta, and either way it will end sent or final on its own;
 *       refused outright by Meta (failed / meta_rejected) or missing → taken over;
 *       any other final ending (out_of_attempts, skipped after a try) → "already_credited", since
 *         its earlier try may have reached Meta.
 *
 * There is no age-based takeover any more. It existed for a run that died mid-send, but such a
 * row is still open: its claim lock lapses, the next run claims it and re-reserves its own marker,
 * so it always settles. Waiting on it is right — taking its click while it may already be at Meta
 * is what produced a second lead. A missing owner row (a hand-deleted row, a marker from before
 * rows carried event ids) can never settle, so that alone is taken over at once.
 *
 * On "reserved", `stamp` writes the click onto this row in the same transaction, so a row whose
 * click is reserved always says which click (dropUndoneRow needs it to find this marker).
 * `nowClock` is the real clock, kept on the marker as `reservedAt` for anyone reading it.
 */
export async function reserveClickMarker(
  marker: FirebaseFirestore.DocumentReference,
  mine: MarkerOwner,
  nowClock: number,
  stamp?: { row: FirebaseFirestore.DocumentReference; fields: Record<string, unknown> }
): Promise<"reserved" | "already_credited" | "busy" | "mine_sent"> {
  const events = capiEventsCollection(mine.clinicId);
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(marker);
    if (snap.exists) {
      const m = snap.data() || {};
      const owner = str(m.eventId);
      if (m.state !== "sending") return owner === mine.eventId ? ("mine_sent" as const) : ("already_credited" as const);
      if (owner !== mine.eventId) {
        const ownerRow = owner ? await tx.get(events.doc(owner)) : null;
        const od = ownerRow?.exists ? ownerRow.data() || {} : null;
        if (od && (od.status === "sent" || od.sentUnrecorded === true)) {
          // Its send went out but the marker never heard (settleClickMarker failed).
          tx.update(marker, { state: "sent", sentAt: FieldValue.serverTimestamp() });
          return "already_credited" as const;
        }
        if (od && (OPEN_STATUSES as string[]).includes(String(od.status))) return "busy" as const;
        // Ended without a recorded send. Only a row Meta refused outright (meta_rejected: nothing
        // was counted) gives its click back. Every other ending — out of attempts after timeouts,
        // a tried row skipped because its appointment changed, a run that died after reserving —
        // may already be at Meta, and taking the click would be a second lead Meta counts. So the
        // click is treated as credited. A missing owner row can never settle and is taken over.
        if (od && !(od.status === "failed" && od.reason === "meta_rejected")) {
          tx.update(marker, { state: "sent", sentAt: FieldValue.serverTimestamp() });
          return "already_credited" as const;
        }
      }
    }
    tx.set(marker, { ...mine, state: "sending", reservedAt: nowClock, createdAt: FieldValue.serverTimestamp() });
    if (stamp) tx.update(stamp.row, defined(stamp.fields));
    return "reserved" as const;
  });
}

/**
 * After a send Meta answered for good: "sent" marks the click credited; "failed" (refused outright,
 * so nothing was counted) gives the click back. A retry never comes here — its click stays
 * reserved (see processOne). Only a marker still reserved by THIS row is touched. Never throws — it
 * runs after a request may have reached Meta. A sent marker that cannot be written stays "sending"
 * under our event id, and reserveClickMarker reads our row (sent, or sentUnrecorded) and treats the
 * click as credited all the same.
 */
async function settleClickMarker(marker: FirebaseFirestore.DocumentReference, mine: MarkerOwner, sent: boolean): Promise<void> {
  for (let attempt = 1; attempt <= SENT_WRITE_TRIES; attempt++) {
    try {
      await adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(marker);
        if (!snap.exists) {
          // Somebody removed it mid-send. A sent click must still end up credited.
          if (sent) tx.set(marker, { ...mine, state: "sent", sentAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
          return;
        }
        if (str(snap.data()?.eventId) !== mine.eventId) return; // taken over: not ours to change
        if (sent) tx.update(marker, { state: "sent", sentAt: FieldValue.serverTimestamp() });
        else tx.delete(marker);
      });
      return;
    } catch (e) {
      if (attempt === SENT_WRITE_TRIES) console.warn("[metaCapi] click marker not settled:", mine.clinicId, mine.eventId, errText(e));
      else await sleep(150 * attempt);
    }
  }
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
      out.push({ clinicId: doc.id, examined: 0, sent: 0, retried: 0, failed: 1, skipped: 0, deferred: 0, error: errText(e) });
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
 * do. This is the ONLY place a test code is ever attached. The attempt is written to the log
 * marked `test: true` and with no `dueAt`, so the queue never picks it up.
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
