// Meta Conversions API for Business Messaging: the pure half, end to end without Firestore or Meta.
//
//   npx tsx tests/metaConversions.test.mts      (npm run test:capi)
//
// What this guards, in the order a conversion travels: the click id is read off the ad's first
// message on both WhatsApp channels; an appointment write becomes the right events (and the
// Firebase trigger's JavaScript twin agrees row for row); each event has one id forever; the click
// it is credited to is the right one; the request body is exactly the shape Meta documents and
// carries no credential; and Meta's answer is sorted into sent / retry / give up the way the
// runbook promises. The worker that does the I/O has its own emulator test
// (tests/metaConversionsWorker.test.mts).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseBaileysAdReply, parseMetaReferral, readStoredAd, type AdReferral } from "../src/lib/bot/adReferral";
import {
  MAX_ATTEMPTS,
  MAX_CLICK_AGE_MS,
  MAX_EVENT_AGE_MS,
  META_CAPI_GRAPH_VERSION,
  PURCHASE_SETTLE_MS,
  RETRY_DELAYS_MS,
  TRIGGER_EVENT,
  VISITED_STATUSES,
  attributionFromClicks,
  buildConversionPayload,
  classifyResponse,
  clickFromReferral,
  conversionEventId,
  conversionTriggers,
  eventsEndpoint,
  firstDueAt,
  isMetaId,
  isTooOld,
  mergeClicks,
  nextAttemptAt,
  phoneDigitsForHash,
  pickClick,
  readCapiSettings,
  readClick,
  recheckAppointment,
  redactPayload,
  type AdClick,
  type ConversionEventName,
} from "../src/lib/metaConversions";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 10, 14, 10, 0, 0); // a fixed "now" so nothing depends on the clock

// ================================================================================================
// 1. Referral parsing: the click id has to survive the trip from Meta's webhook to an AdClick.
// ================================================================================================

/**
 * The walk the Cloud API webhook route does (src/app/api/webhooks/meta-whatsapp/route.ts,
 * extractMessages): entry → changes → value → messages[] → referral. Re-stated here rather than
 * imported because the route keeps it private; if the route's walk changes, change this too.
 */
function walkReferrals(body: unknown): Array<{ from: string; type: string; ad: AdReferral | null }> {
  const out: Array<{ from: string; type: string; ad: AdReferral | null }> = [];
  const entries = (body as any)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      const messages = change?.value?.messages;
      if (!Array.isArray(messages)) continue; // status updates carry no messages
      for (const m of messages) out.push({ from: String(m?.from || ""), type: String(m?.type || ""), ad: parseMetaReferral(m?.referral) });
    }
  }
  return out;
}

const REFERRAL = {
  source_url: "https://fb.me/whiten",
  source_id: "120212345678901234",
  source_type: "ad",
  headline: "تبييض الأسنان بخصم 30%",
  body: "احجز كشفك النهاردة",
  media_type: "image",
  image_url: "https://scontent.example/img.jpg",
  ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a",
};

// (a) On an ordinary text message — the first message of an ad conversation.
const onText = parseMetaReferral({ ...REFERRAL });
assert.equal(onText?.ctwaClid, REFERRAL.ctwa_clid, "the click id is kept whole");
assert.equal(onText?.sourceId, REFERRAL.source_id);
assert.equal(onText?.headline, REFERRAL.headline);
assert.equal(onText?.sourceUrl, REFERRAL.source_url);

// (b) On a request_welcome: the chat was opened, nothing typed yet. Same referral, same click.
const welcomeBody = {
  object: "whatsapp_business_account",
  entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN1" }, messages: [{ from: "201001234567", id: "wamid.W", timestamp: "1763114400", type: "request_welcome", referral: { source_type: "ad", source_id: "777", ctwa_clid: "WELCOME_CLID" } }] } }] }],
};
const [welcome] = walkReferrals(welcomeBody);
assert.equal(welcome.type, "request_welcome");
assert.deepEqual(welcome.ad, { sourceId: "777", sourceType: "ad", ctwaClid: "WELCOME_CLID" });

// (c) No referral: an organic chat. (d) A referral with nothing that identifies the ad.
assert.equal(parseMetaReferral(undefined), null);
assert.equal(parseMetaReferral(null), null);
assert.equal(parseMetaReferral({ source_type: "ad", media_type: "image" }), null, "type and media alone identify nothing");

// (e) The full Cloud API envelope, walked the way the webhook route walks it.
const envelope = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "201551558269", phone_number_id: "1314232971773536" },
            contacts: [{ profile: { name: "Mona" }, wa_id: "201001234567" }],
            messages: [
              { from: "201001234567", id: "wamid.A1", timestamp: "1763114400", type: "text", text: { body: "مرحباً، عايزة أعرف عن عرض التبييض" }, referral: { ...REFERRAL } },
              { from: "201001234567", id: "wamid.A2", timestamp: "1763114460", type: "text", text: { body: "بكام؟" } },
            ],
          },
        },
      ],
    },
  ],
};
const walked = walkReferrals(envelope);
assert.equal(walked.length, 2);
assert.equal(walked[0].ad?.ctwaClid, REFERRAL.ctwa_clid, "the first message carries the click");
assert.equal(walked[1].ad, null, "later messages in the same chat carry no referral");

// (f) A status-only change (delivered / read receipts): no messages, nothing to read.
const statusOnly = {
  object: "whatsapp_business_account",
  entry: [{ id: "W", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN1" }, statuses: [{ id: "wamid.X", status: "read", timestamp: "1", recipient_id: "201001234567" }] } }] }],
};
assert.deepEqual(walkReferrals(statusOnly), []);
assert.deepEqual(walkReferrals({}), []);
assert.deepEqual(walkReferrals(null), []);

// The QR gateway / WaPilot channel: WhatsApp Web's contextInfo.externalAdReply.
const baileys = parseBaileysAdReply({
  conversionSource: "FB_Ads",
  externalAdReply: { title: "تقويم شفاف", body: "قسّط على 12 شهر", mediaType: 1, sourceType: "ad", sourceId: "9001", sourceUrl: "https://fb.me/aligners", ctwaClid: "GW_CLID_1" },
});
assert.equal(baileys?.ctwaClid, "GW_CLID_1");
assert.equal(baileys?.mediaType, "image");

// The stored / forwarded shape (conversation doc `ad`, gateway `_data.ad`, a lead's meta block).
const stored = readStoredAd({ headline: "زراعة", sourceId: "55", ctwaClid: "STORED_CLID", junk: true });
assert.deepEqual(stored, { headline: "زراعة", sourceId: "55", ctwaClid: "STORED_CLID" });

// Every one of those becomes an AdClick — and only when it carries a click id.
assert.deepEqual(clickFromReferral(onText, T), {
  ctwaClid: REFERRAL.ctwa_clid,
  sourceId: REFERRAL.source_id,
  sourceUrl: REFERRAL.source_url,
  headline: REFERRAL.headline,
  clickedAt: T,
});
assert.deepEqual(clickFromReferral(welcome.ad, T), { ctwaClid: "WELCOME_CLID", sourceId: "777", clickedAt: T });
assert.deepEqual(clickFromReferral(baileys, T), { ctwaClid: "GW_CLID_1", sourceId: "9001", sourceUrl: "https://fb.me/aligners", headline: "تقويم شفاف", clickedAt: T });
assert.deepEqual(clickFromReferral(stored, T), { ctwaClid: "STORED_CLID", sourceId: "55", headline: "زراعة", clickedAt: T });
assert.equal(clickFromReferral({ headline: "no click id", sourceId: "1" }, T), null, "an ad without ctwa_clid cannot be credited");
assert.equal(clickFromReferral(null, T), null);
assert.equal(clickFromReferral(undefined, T), null);
assert.equal(clickFromReferral(onText, 0), null, "a click with no time is no click");

// ================================================================================================
// 2. Mapping: which appointment write means which event.
// ================================================================================================
assert.deepEqual(TRIGGER_EVENT, { booked: "LeadSubmitted", confirmed: "QualifiedLead", visited: "Purchase" });
assert.deepEqual([...VISITED_STATUSES], ["Checked In", "In Chair", "Checking Out", "Completed"]);

type Row = [label: string, before: { status?: unknown } | null, after: { status?: unknown; rescheduledFromId?: unknown } | null, expected: string[]];
const st = (status: string) => ({ status });
const TABLE: Row[] = [
  ["create Scheduled", null, st("Scheduled"), ["booked"]],
  ["create Confirmed (bot auto-confirm)", null, st("Confirmed"), ["booked", "confirmed"]],
  ["create with no status = Scheduled", null, {}, ["booked"]],
  ["create already Checked In (walk-in)", null, st("Checked In"), ["booked", "visited"]],
  ["create Cancelled", null, st("Cancelled"), []],
  ["Scheduled -> Confirmed", st("Scheduled"), st("Confirmed"), ["confirmed"]],
  ["missing -> Confirmed", {}, st("Confirmed"), ["confirmed"]],
  ["legacy Pending -> Confirmed", st("Pending"), st("Confirmed"), ["confirmed"]],
  ["Confirmed -> Confirmed (an edit)", st("Confirmed"), st("Confirmed"), []],
  ["Scheduled -> Scheduled (an edit)", st("Scheduled"), st("Scheduled"), []],
  ["missing -> missing", {}, {}, []],
  ["Confirmed -> Checked In", st("Confirmed"), st("Checked In"), ["visited"]],
  ["Checked In -> In Chair (same visit)", st("Checked In"), st("In Chair"), []],
  ["In Chair -> Checking Out (same visit)", st("In Chair"), st("Checking Out"), []],
  ["Checking Out -> Completed (same visit)", st("Checking Out"), st("Completed"), []],
  ["Checked In -> Completed (same visit)", st("Checked In"), st("Completed"), []],
  ["Scheduled -> Completed (skipped the desk)", st("Scheduled"), st("Completed"), ["visited"]],
  ["Scheduled -> legacy Arrived", st("Scheduled"), st("Arrived"), ["visited"]],
  ["legacy Arrived -> Checked In (same visit)", st("Arrived"), st("Checked In"), []],
  ["legacy Seated -> Completed (same visit)", st("Seated"), st("Completed"), []],
  ["Scheduled -> Cancelled", st("Scheduled"), st("Cancelled"), []],
  ["Confirmed -> No Show", st("Confirmed"), st("No Show"), []],
  ["Cancelled -> Confirmed (re-opened)", st("Cancelled"), st("Confirmed"), ["confirmed"]],
  ["Cancelled -> Scheduled (re-opened)", st("Cancelled"), st("Scheduled"), []],
  ["delete", st("Confirmed"), null, []],
  ["delete of a visit", st("Completed"), null, []],
  ["padded status", st("Scheduled"), st("  Confirmed "), ["confirmed"]],
  // A reschedule books a new document pointing at the old one; the old one becomes "Rescheduled".
  // The move is not a new lead, and the marker left on the old slot is not a live booking.
  ["create a rescheduled copy", null, { status: "Scheduled", rescheduledFromId: "OLD1" }, []],
  ["create a rescheduled copy already Confirmed", null, { status: "Confirmed", rescheduledFromId: "OLD1" }, ["confirmed"]],
  ["create a rescheduled copy already Checked In", null, { status: "Checked In", rescheduledFromId: "OLD1" }, ["visited"]],
  ["create with a blank rescheduledFromId", null, { status: "Scheduled", rescheduledFromId: "  " }, ["booked"]],
  ["create with a non-string rescheduledFromId", null, { status: "Scheduled", rescheduledFromId: 7 }, ["booked"]],
  ["create Rescheduled", null, st("Rescheduled"), []],
  ["Scheduled -> Rescheduled", st("Scheduled"), st("Rescheduled"), []],
  ["Confirmed -> Rescheduled", st("Confirmed"), st("Rescheduled"), []],
  ["Rescheduled -> Confirmed (moved back)", st("Rescheduled"), st("Confirmed"), ["confirmed"]],
];
for (const [label, before, after, expected] of TABLE) {
  assert.deepEqual(conversionTriggers(before, after), expected, `web: ${label}`);
}

// ================================================================================================
// 3. Idempotency keys and timing.
// ================================================================================================
const NAMES: ConversionEventName[] = ["LeadSubmitted", "QualifiedLead", "Purchase"];
assert.equal(conversionEventId("APPT1", "Purchase"), "APPT1_Purchase");
assert.equal(conversionEventId("APPT1", "LeadSubmitted"), conversionEventId("APPT1", "LeadSubmitted"), "stable: a re-delivered trigger names the same doc");
assert.equal(new Set(NAMES.map((n) => conversionEventId("APPT1", n))).size, 3, "one id per event kind");
assert.notEqual(conversionEventId("APPT1", "Purchase"), conversionEventId("APPT2", "Purchase"));
assert.equal(PURCHASE_SETTLE_MS, 3 * HOUR);
assert.equal(firstDueAt("visited", T), T + 3 * HOUR, "a Purchase waits for the day's charges");
assert.equal(firstDueAt("booked", T), T, "a booking goes out at once");
assert.equal(firstDueAt("confirmed", T), T);

// The re-check right before a send: is the moment still true?
assert.deepEqual(recheckAppointment("LeadSubmitted", null), { action: "skip", reason: "appointment_gone" });
assert.deepEqual(recheckAppointment("Purchase", null), { action: "skip", reason: "appointment_gone" });
for (const s of ["Scheduled", "Confirmed", "Checked In", "Completed", "Pending", undefined]) {
  assert.deepEqual(recheckAppointment("LeadSubmitted", { status: s }), { action: "send" }, `lead still a lead at ${s}`);
}
for (const s of ["Cancelled", "No Show", "Rescheduled", " Cancelled "]) {
  assert.deepEqual(recheckAppointment("LeadSubmitted", { status: s }), { action: "skip", reason: "cancelled" }, `lead ended at ${s}`);
}
for (const s of ["Confirmed", "Checked In", "In Chair", "Arrived", "Completed"]) {
  assert.deepEqual(recheckAppointment("QualifiedLead", { status: s }), { action: "send" }, `confirmation stands at ${s}`);
}
for (const s of ["Scheduled", undefined, "Cancelled", "No Show", "Rescheduled"]) {
  assert.deepEqual(recheckAppointment("QualifiedLead", { status: s }), { action: "delete", reason: "not_confirmed" }, `confirmation undone at ${s}`);
}
for (const s of ["Checked In", "Seated", "Checking Out", "Completed"]) {
  assert.deepEqual(recheckAppointment("Purchase", { status: s }), { action: "send" }, `visit stands at ${s}`);
}
for (const s of ["Confirmed", "Scheduled", "Cancelled"]) {
  assert.deepEqual(recheckAppointment("Purchase", { status: s }), { action: "delete", reason: "visit_undone" }, `visit undone at ${s}`);
}

// ================================================================================================
// 4. PARITY with the Firebase trigger's JavaScript twin (functions/metaConversionsPlan.js).
//    Cloud Functions cannot import this TypeScript, so the table lives twice. This is what keeps
//    the two from drifting: every row above runs through both.
// ================================================================================================
const require = createRequire(import.meta.url);
const plan = require("../functions/metaConversionsPlan.js") as {
  TRIGGER_EVENT: Record<string, string>;
  PURCHASE_SETTLE_MS: number;
  VISITED_STATUSES: readonly string[];
  conversionTriggers: (before: unknown, after: unknown) => string[];
  conversionEventId: (appointmentId: string, eventName: string) => string;
  firstDueAt: (trigger: string, eventTimeMs: number) => number;
  toMillis?: (v: unknown) => number;
  planConversionEvents?: (args: { clinicId: string; appointmentId: string; before: unknown; after: unknown; nowMs?: number }) => Array<{ id: string; data: Record<string, unknown> }>;
};
assert.equal(typeof plan.conversionTriggers, "function", "functions/metaConversionsPlan.js must export conversionTriggers");
for (const [label, before, after, expected] of TABLE) {
  assert.deepEqual(plan.conversionTriggers(before, after), expected, `functions twin: ${label}`);
}
assert.deepEqual({ ...plan.TRIGGER_EVENT }, { ...TRIGGER_EVENT }, "twin TRIGGER_EVENT");
assert.equal(plan.PURCHASE_SETTLE_MS, PURCHASE_SETTLE_MS, "twin PURCHASE_SETTLE_MS");
assert.deepEqual([...plan.VISITED_STATUSES], [...VISITED_STATUSES], "twin VISITED_STATUSES");
for (const n of NAMES) assert.equal(plan.conversionEventId("APPT1", n), conversionEventId("APPT1", n), `twin event id ${n}`);
for (const trig of ["booked", "confirmed", "visited"] as const) assert.equal(plan.firstDueAt(trig, T), firstDueAt(trig, T), `twin firstDueAt ${trig}`);

// The trigger's queue docs: one per event, the agreed fields, and never an undefined value
// (Firestore rejects the whole write if one field is undefined).
if (plan.planConversionEvents) {
  const docs = plan.planConversionEvents({ clinicId: "C1", appointmentId: "APPT1", before: null, after: { status: "Confirmed", patientId: "P1", createdAt: T - MIN }, nowMs: T });
  assert.deepEqual(docs.map((d) => d.id), ["APPT1_LeadSubmitted", "APPT1_QualifiedLead"]);
  for (const d of docs) {
    for (const [k, v] of Object.entries(d.data)) assert.notEqual(v, undefined, `queue doc ${d.id} field ${k} is undefined`);
    assert.equal(d.data.status, "pending");
    assert.equal(d.data.attempts, 0);
    assert.equal(d.data.clinicId, "C1");
    assert.equal(d.data.patientId, "P1");
  }
  assert.equal(docs[0].data.eventTimeMs, T - MIN, "a booking is timed at the appointment's creation");
  const visit = plan.planConversionEvents({ clinicId: "C1", appointmentId: "APPT1", before: { status: "Confirmed" }, after: { status: "Checked In" }, nowMs: T });
  assert.deepEqual(visit.map((d) => [d.id, d.data.dueAt, d.data.patientId]), [["APPT1_Purchase", T + 3 * HOUR, null]]);
  assert.deepEqual(plan.planConversionEvents({ clinicId: "C1", appointmentId: "APPT1", before: { status: "Checked In" }, after: { status: "Completed" }, nowMs: T }), []);
  const moved = plan.planConversionEvents({ clinicId: "C1", appointmentId: "APPT2", before: null, after: { status: "Scheduled", patientId: "P1", rescheduledFromId: "APPT1" }, nowMs: T });
  assert.deepEqual(moved, [], "a rescheduled copy queues no new lead");
}

// ================================================================================================
// 5. Which click: merging, choosing, and carrying clicks onto the patient.
// ================================================================================================
const click = (id: string, at: number, extra: Partial<AdClick> = {}): AdClick => ({ ctwaClid: id, clickedAt: at, ...extra });

// mergeClicks: newest copy of each id, newest first, at most 10, junk ignored.
const merged = mergeClicks(
  [click("A", T - 3 * DAY), null, "junk", { ctwaClid: "" , clickedAt: T }, { ctwaClid: "NOTIME" }, { ctwaClid: "B", at: T - 2 * DAY }],
  [click("A", T - DAY, { headline: "newer A" }), click("C", T - 5 * DAY)],
);
assert.deepEqual(merged.map((c) => c.ctwaClid), ["A", "B", "C"], "newest first, no duplicates");
assert.equal(merged[0].clickedAt, T - DAY, "a duplicate id keeps its newest time");
assert.equal(merged[0].headline, "newer A");
assert.equal(merged[1].clickedAt, T - 2 * DAY, "the legacy `at` field is read as the click time");
const many = Array.from({ length: 12 }, (_, i) => click(`K${i}`, T - i * HOUR));
const capped = mergeClicks([], many);
assert.equal(capped.length, 10, "capped at 10");
assert.equal(capped[0].ctwaClid, "K0");
assert.equal(capped[9].ctwaClid, "K9", "the two oldest fall off");
assert.equal(mergeClicks(undefined, []).length, 0);
assert.equal(mergeClicks("nonsense", []).length, 0);
assert.deepEqual(readClick({ ctwaClid: " X ", clickedAt: { seconds: T / 1000 } }), { ctwaClid: "X", clickedAt: T }, "a Firestore Timestamp shape is read");
assert.equal(readClick({ ctwaClid: "X" }), null);

// pickClick: the newest click at or before the event, and not older than 28 days.
const clicks = [click("OLD", T - 10 * DAY), click("RECENT", T - DAY), click("AFTER", T + HOUR), click("ANCIENT", T - 100 * DAY)];
assert.equal(pickClick(clicks, T)?.ctwaClid, "RECENT");
assert.equal(pickClick([click("EXACT", T)], T)?.ctwaClid, "EXACT", "a click at the event's own moment counts");
assert.equal(pickClick([click("AFTER", T + 1)], T), null, "a click after the booking did not cause it");
assert.equal(pickClick([click("STALE", T - 28 * DAY - 1)], T), null, "older than 28 days is not credited");
assert.equal(pickClick([click("EDGE", T - 28 * DAY)], T)?.ctwaClid, "EDGE", "exactly 28 days is still credited");
assert.equal(pickClick([click("WEEKS", T - 20 * DAY)], T)?.ctwaClid, "WEEKS", "a visit booked a few weeks after the ad is credited");
assert.equal(MAX_CLICK_AGE_MS, 28 * DAY);
assert.equal(pickClick([], T), null);

// attributionFromClicks: newest on top, history underneath, never a click-less object.
assert.equal(attributionFromClicks(null, []), null, "nothing in, nothing out");
assert.equal(attributionFromClicks({}, []), null);
assert.equal(attributionFromClicks({ clicks: [] }, [{ ctwaClid: "" } as AdClick]), null, "junk never makes an empty attribution");
const first = attributionFromClicks(undefined, [click("P1", T - 5 * DAY, { headline: "Whitening" })]);
assert.deepEqual(first, { ctwaClid: "P1", clickedAt: T - 5 * DAY, headline: "Whitening", clicks: [{ ctwaClid: "P1", clickedAt: T - 5 * DAY, headline: "Whitening" }] });
const second = attributionFromClicks(first, [click("P2", T - DAY)]);
assert.equal(second?.ctwaClid, "P2", "the newest click goes on top");
assert.deepEqual(second?.clicks.map((c) => c.ctwaClid), ["P2", "P1"], "the old click is kept underneath");
const third = attributionFromClicks(second, [click("P0", T - 30 * DAY)]);
assert.equal(third?.ctwaClid, "P2", "an older click arriving late does not take the top");
assert.deepEqual(third?.clicks.map((c) => c.ctwaClid), ["P2", "P1", "P0"]);
assert.equal(attributionFromClicks(third, [])?.clicks.length, 3, "merging nothing keeps everything");
const legacy = attributionFromClicks({ ctwaClid: "LEGACY", clickedAt: T - 2 * DAY }, []);
assert.deepEqual(legacy?.clicks.map((c) => c.ctwaClid), ["LEGACY"], "a top-level-only legacy record is kept as a click");
for (const a of [first, second, third, legacy]) {
  assert.ok(a && a.ctwaClid && a.clicks.length > 0, "an attribution always carries a click");
  for (const [k, v] of Object.entries(a!)) assert.notEqual(v, undefined, `attribution field ${k} is undefined`);
}

// ================================================================================================
// 6. The request body: exactly Meta's documented shape, no credentials in it.
// ================================================================================================
const payload = buildConversionPayload({
  eventName: "Purchase",
  eventTimeMs: T + 999,
  eventId: "APPT1_Purchase",
  wabaId: "102290129340398",
  match: { kind: "ctwa", ctwaClid: "CLID1" },
  value: 1234.567,
});
assert.deepEqual(payload, {
  data: [
    {
      event_name: "Purchase",
      event_time: Math.floor(T / 1000),
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      event_id: "APPT1_Purchase",
      user_data: { whatsapp_business_account_id: "102290129340398", ctwa_clid: "CLID1" },
      custom_data: { currency: "EGP", value: 1234.57 },
    },
  ],
  partner_agent: "alpha-dental",
});
assert.equal(Number.isInteger((payload.data as any)[0].event_time), true, "event_time is whole seconds");
assert.equal("test_event_code" in payload, false, "no test code unless one is set");

const base = { eventName: "LeadSubmitted" as const, eventTimeMs: T, eventId: "E", wabaId: "W", match: { kind: "ctwa" as const, ctwaClid: "C" } };
assert.equal(buildConversionPayload({ ...base, testEventCode: "  " }).test_event_code, undefined, "a blank test code is no test code");
assert.equal(buildConversionPayload({ ...base, testEventCode: " TEST123 " }).test_event_code, "TEST123");
const valueOf = (v: number | undefined) => (buildConversionPayload({ ...base, value: v }).data as any)[0].custom_data.value;
assert.equal(valueOf(undefined), 0, "no value is 0");
assert.equal(valueOf(-50), 0, "a negative value is 0");
assert.equal(valueOf(Number.NaN), 0);
assert.equal(valueOf(1500), 1500);
assert.equal(valueOf(0.005), 0.01);

const KEY_LOOKS_SECRET = /(access_?token|^token$|secret|authorization|password|appsecret)/i;
const keysOf = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), keysOf(x, out));
  return out;
};
for (const k of keysOf(buildConversionPayload({ ...base, testEventCode: "T1", value: 10 }))) assert.ok(!KEY_LOOKS_SECRET.test(k), `payload key ${k} looks like a credential`);

// The phone fallback: structured for later, selected by nothing yet.
const byPhone = buildConversionPayload({ ...base, match: { kind: "phone", phoneSha256: "abc123", pageId: "PAGE9" } });
assert.deepEqual((byPhone.data as any)[0].user_data, { whatsapp_business_account_id: "W", ph: "abc123", page_id: "PAGE9" });
assert.equal(phoneDigitsForHash("+20 100-123-4567"), "201001234567");

// redactPayload blanks credential-shaped keys at any depth and leaves the rest alone.
const raw = { access_token: "EAAG-secret", data: [{ event_name: "Purchase", nested: { token: "t", keep: 1, list: [{ Authorization: "Bearer x", ok: "y" }] } }] };
const red = redactPayload(raw);
assert.deepEqual(red, { access_token: "[redacted]", data: [{ event_name: "Purchase", nested: { token: "[redacted]", keep: 1, list: [{ Authorization: "[redacted]", ok: "y" }] } }] });
assert.equal(raw.access_token, "EAAG-secret", "the original is not modified");
assert.deepEqual(redactPayload(payload), payload, "a real payload has nothing to redact");

// The endpoint: version from one constant, dataset id in the path, never a token in the URL.
assert.match(META_CAPI_GRAPH_VERSION, /^v\d+\.\d+$/);
const url = eventsEndpoint(" 1234567890 ");
assert.equal(url, `https://graph.facebook.com/${META_CAPI_GRAPH_VERSION}/1234567890/events`);
assert.ok(!/token|access/i.test(url), "no credential in the URL");

// ================================================================================================
// 7. Meta's answer: sent, retry later, or give up.
// ================================================================================================
const ok = classifyResponse(200, { events_received: 1, messages: [], fbtrace_id: "TRACE1" });
assert.equal(ok.kind, "sent");
assert.equal(ok.eventsReceived, 1);
assert.equal(ok.fbtraceId, "TRACE1");
assert.equal(classifyResponse(200, { events_received: 0 }).kind, "failed", "accepted but zero events is a failure");
for (const s of [500, 502, 503]) assert.equal(classifyResponse(s, {}).kind, "retry", `HTTP ${s} retries`);
assert.equal(classifyResponse(0, null).kind, "retry", "a network error / timeout retries");
assert.equal(classifyResponse(429, { error: { message: "Too many calls", code: 4 } }).kind, "retry");
const bad = classifyResponse(400, { error: { message: "Invalid parameter", type: "OAuthException", code: 100, fbtrace_id: "TRACE2" } });
assert.equal(bad.kind, "failed", "a bad request never retries");
assert.equal(bad.errorCode, 100);
assert.equal(bad.fbtraceId, "TRACE2", "fbtrace_id is read from the error too");
assert.ok(bad.error?.includes("Invalid parameter"));
assert.equal(classifyResponse(400, { error: { message: "Temporary", is_transient: true, code: 2 } }).kind, "retry", "Meta's own is_transient flag retries");
for (const code of [4, 17, 613]) assert.equal(classifyResponse(400, { error: { message: "throttled", code } }).kind, "retry", `throttle code ${code} retries`);
assert.equal(classifyResponse(401, { error: { message: "Error validating access token", code: 190 } }).kind, "failed", "a bad token never retries");
assert.equal(classifyResponse(403, { error: { message: "Permissions error", code: 200 } }).kind, "failed");
assert.equal(classifyResponse(404, "not json").kind, "failed");

assert.equal(MAX_ATTEMPTS, 5);
assert.deepEqual([...RETRY_DELAYS_MS], [5 * MIN, 20 * MIN, HOUR, 3 * HOUR]);
assert.equal(nextAttemptAt(1, T), T + 5 * MIN);
assert.equal(nextAttemptAt(2, T), T + 20 * MIN);
assert.equal(nextAttemptAt(3, T), T + HOUR);
assert.equal(nextAttemptAt(4, T), T + 3 * HOUR);
assert.equal(nextAttemptAt(5, T), null, "the fifth failure gives up");
assert.equal(nextAttemptAt(6, T), null);
let at = T;
for (let tries = 1; tries < MAX_ATTEMPTS; tries++) at = nextAttemptAt(tries, at)!;
assert.ok(at - T < 5 * HOUR, "all retries finish inside five hours");
assert.ok(T + PURCHASE_SETTLE_MS + (at - T) - T < MAX_EVENT_AGE_MS, "even a delayed Purchase's last retry is far inside Meta's 7 days");

// ================================================================================================
// 8. Age, settings and ids.
// ================================================================================================
assert.equal(MAX_EVENT_AGE_MS, 7 * DAY);
assert.equal(isTooOld(T - 7 * DAY, T), false, "exactly seven days is still accepted");
assert.equal(isTooOld(T - 7 * DAY - 1, T), true);
assert.equal(isTooOld(T, T), false);

assert.deepEqual(readCapiSettings(undefined), { enabled: false, datasetId: "", wabaId: "", token: "", testEventCode: "" });
assert.deepEqual(
  readCapiSettings({ enabled: true, datasetId: " 123456789 ", wabaId: " 987654321 ", token: " tok ", testEventCode: " TEST1 ", extra: 1 }),
  { enabled: true, datasetId: "123456789", wabaId: "987654321", token: "tok", testEventCode: "TEST1" },
);
assert.equal(readCapiSettings({ enabled: "true" }).enabled, false, "only a real true switches it on");
assert.equal(readCapiSettings({ datasetId: 123 }).datasetId, "", "a non-string id is ignored");

assert.equal(isMetaId("1234567890"), true);
assert.equal(isMetaId(" 123456 "), true);
assert.equal(isMetaId("1234"), false, "too short");
assert.equal(isMetaId("12a456789"), false);
assert.equal(isMetaId(""), false);

console.log("metaConversions: all checks passed");
