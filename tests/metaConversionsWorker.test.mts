/**
 * The Conversions API sender end to end, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/metaConversionsWorker.test.mts
 *
 * The real queue worker (lib/metaConversionsServer) and the real cron route, with nothing mocked
 * but Meta: every send goes to a fake `fetch` that records the request and answers from a script.
 * The global `fetch` is also replaced by one that fails the test if it is ever called, so nothing
 * here can reach graph.facebook.com. What it must prove:
 *   a. a booked patient with an ad click is reported once, in Meta's shape, with the token only in
 *      the Authorization header and nowhere on the stored row; a second run sends nothing;
 *   b. a click kept only on the WhatsApp conversation or on a bot lead is found, and carried over
 *      onto the patient; the WhatsApp card's WABA id and token are used when the card left them blank;
 *   c. no click anywhere → skipped, and Meta is never called;
 *   d. 5xx and 429 retry on schedule, other 4xx fail, and five failures give up;
 *   e. a Purchase waits for its settle time, then carries the visit's treatment charges;
 *   f. a switched-off clinic is never touched; switched on without a dataset fails loudly;
 *   g. the test-event code rides on events only while it is set; the test button needs one;
 *   h. only the scheduler's secret runs the cron;
 *   i. a row another run has locked is left alone.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-meta-capi-worker";
const SECRET = "test-cron-secret";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.CRON_SECRET = SECRET;

// Nothing in this file may reach the network. The worker gets a fake fetch passed in; this one
// catches anything that forgets to.
let strayFetches = 0;
globalThis.fetch = (async (input: unknown) => {
  strayFetches += 1;
  throw new Error(`unexpected network call to ${String(input)}`);
}) as typeof fetch;

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
const core = await import("../src/lib/metaConversions");
const server = await import("../src/lib/metaConversionsServer");
const { conversationKey } = await import("../src/lib/bot/conversation");
const { GET } = await import("../src/app/api/automation/meta-conversions/route");

const db = adminDb();
const NOW = Date.now();
const H = 60 * 60 * 1000;
const D = 24 * H;
const MIN = 60 * 1000;

const TOKEN = "EAAtest-capi-token-xyz";
const WA_TOKEN = "EAAtest-whatsapp-token-abc";
const DATASET = "123456789012345";
const WABA = "998877665544332";
const WA_WABA = "112233445566778";

const CLINICS = ["CA", "CB", "CC", "CD", "CE", "CF", "CG", "CH", "CI"];

// ── Fake Meta ───────────────────────────────────────────────────────────────────────────────

type Reply = { status: number; json: unknown };
interface Call {
  url: string;
  authorization: string;
  body: Record<string, any>;
}
const OK: Reply = { status: 200, json: { events_received: 1, fbtrace_id: "TRACE" } };

/** A fetch that records each request and answers from `script(eventId, body)`. */
function fakeMeta(script: (eventId: string, body: Record<string, any>) => Reply = () => OK) {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: headers.authorization || headers.Authorization || "", body });
    const r = script(String(body?.data?.[0]?.event_id || ""), body);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

// ── Seeding ─────────────────────────────────────────────────────────────────────────────────

async function wipe() {
  for (const id of CLINICS) {
    await db.recursiveDelete(db.doc(`clinics/${id}`));
    await db.recursiveDelete(db.doc(`clinic_secrets/${id}`));
  }
}

async function seedClinic(id: string, metaCapi: Record<string, unknown> | null, metaWhatsapp?: Record<string, unknown>) {
  await db.doc(`clinics/${id}`).set({ name: id, status: "Active" });
  await db.doc(`clinic_secrets/${id}`).set({
    ...(metaCapi ? { metaCapi } : {}),
    ...(metaWhatsapp ? { metaWhatsapp } : {}),
  });
}

const fullConfig = (extra: Record<string, unknown> = {}) => ({ enabled: true, datasetId: DATASET, wabaId: WABA, token: TOKEN, testEventCode: "", ...extra });

async function seedPatient(clinicId: string, id: string, data: Record<string, unknown>) {
  await db.doc(`clinics/${clinicId}/patients/${id}`).set({ name: id, ...data });
}

async function seedAppointment(clinicId: string, id: string, patientId: string) {
  await db.doc(`clinics/${clinicId}/appointments/${id}`).set({ patientId, patientName: patientId, status: "Scheduled" });
}

/** Queue a row exactly as the Firebase trigger does. */
async function seedEvent(
  clinicId: string,
  appointmentId: string,
  trigger: "booked" | "confirmed" | "visited",
  eventTimeMs: number,
  opts: { patientId?: string | null; extra?: Record<string, unknown> } = {}
): Promise<string> {
  const eventName = core.TRIGGER_EVENT[trigger];
  const eventId = core.conversionEventId(appointmentId, eventName);
  await server.capiEventsCollection(clinicId).doc(eventId).create({
    clinicId,
    appointmentId,
    patientId: opts.patientId === undefined ? null : opts.patientId,
    trigger,
    eventName,
    eventId,
    eventTimeMs,
    status: "pending",
    dueAt: core.firstDueAt(trigger, eventTimeMs),
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(opts.extra || {}),
  });
  return eventId;
}

const eventDoc = async (clinicId: string, eventId: string) => (await server.capiEventsCollection(clinicId).doc(eventId).get()).data() || {};

// ── Runner ──────────────────────────────────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message.split("\n").join("\n       ") : String(e)}`);
  }
}

await wipe();

// ── a. the plain case ───────────────────────────────────────────────────────────────────────

await seedClinic("CA", fullConfig());
await seedPatient("CA", "PA", {
  phone: "+201111111111",
  adAttribution: { ctwaClid: "CLK_A", clickedAt: NOW - 2 * D, sourceId: "AD_1", clicks: [{ ctwaClid: "CLK_A", clickedAt: NOW - 2 * D, sourceId: "AD_1" }] },
});
await seedAppointment("CA", "AP_A", "PA");
const evA = await seedEvent("CA", "AP_A", "booked", NOW - H, { patientId: "PA" });

await check("a. a booked ad patient is reported once, in Meta's shape", async () => {
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CA", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.sent, 1);
  assert.equal(meta.calls.length, 1);
  const call = meta.calls[0];
  assert.equal(call.url, core.eventsEndpoint(DATASET));
  assert.equal(call.authorization, `Bearer ${TOKEN}`);
  assert.ok(!call.url.includes(TOKEN), "the token is never in the URL");
  assert.ok(!JSON.stringify(call.body).includes(TOKEN), "the token is never in the body");
  const ev = call.body.data[0];
  assert.equal(ev.event_name, "LeadSubmitted");
  assert.equal(ev.event_id, "AP_A_LeadSubmitted");
  assert.equal(ev.action_source, "business_messaging");
  assert.equal(ev.messaging_channel, "whatsapp");
  assert.equal(ev.event_time, Math.floor((NOW - H) / 1000));
  assert.deepEqual(ev.user_data, { whatsapp_business_account_id: WABA, ctwa_clid: "CLK_A" });
  assert.equal(call.body.test_event_code, undefined, "no test code set → none sent");

  const row = await eventDoc("CA", evA);
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 1);
  assert.equal(row.ctwaClid, "CLK_A");
  assert.equal(row.adSourceId, "AD_1");
  assert.equal(row.clickedAt, NOW - 2 * D);
  assert.equal(row.lockedUntil, undefined, "the claim lock is released");
  assert.ok(row.sentAt, "sentAt stamped");
  assert.equal(row.response.httpStatus, 200);
  assert.equal(row.response.eventsReceived, 1);
  assert.equal(row.test, undefined);
  assert.ok(!JSON.stringify(row).includes(TOKEN), "no token anywhere on the stored row");
  assert.ok(!/access_token/i.test(JSON.stringify(row)), "no access_token key on the stored row");
});

await check("a. a second run sends nothing (idempotent)", async () => {
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CA", { nowMs: NOW + 20 * MIN, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  assert.equal(run.examined, 0);
});

await check("a. the log lists the row with millisecond timestamps and no token", async () => {
  const rows = await server.listRecentConversionEvents("CA", 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, evA);
  assert.equal(typeof rows[0].createdAt, "number");
  assert.equal(typeof rows[0].sentAt, "number");
  assert.ok(!JSON.stringify(rows).includes(TOKEN));
});

// ── b. clicks found on the conversation and on a lead; WhatsApp card fallback ──────────────

const PHONE_B = "+201001234567";
await seedClinic("CB", { enabled: true, datasetId: DATASET }, { phoneNumberId: "555", wabaId: WA_WABA, token: WA_TOKEN });
await seedPatient("CB", "PB", { phone: PHONE_B });
await seedAppointment("CB", "AP_B", "PB");
await db.doc(`clinics/CB/whatsapp_conversations/${conversationKey(PHONE_B)}`).set({
  phoneKey: conversationKey(PHONE_B),
  adClicks: [{ ctwaClid: "CONV1", clickedAt: NOW - 3 * D, sourceId: "AD_C" }],
});
await db.collection("clinics/CB/leads").add({
  phone: PHONE_B,
  stage: "booked",
  meta: { ctwaClid: "LEAD1", sourceId: "AD_L", adName: "Implants" },
  createdAt: Timestamp.fromMillis(NOW - D),
});
// The trigger did not know the patient: the worker must read it off the appointment.
const evB = await seedEvent("CB", "AP_B", "booked", NOW - H, { patientId: null });

await check("b. clicks on the conversation and the lead are found; newest before the booking wins", async () => {
  const clicks = await server.clicksForPatient("CB", "PB");
  assert.deepEqual(clicks.map((c) => c.ctwaClid), ["LEAD1", "CONV1"]);
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CB", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.sent, 1);
  assert.equal(meta.calls[0].body.data[0].user_data.ctwa_clid, "LEAD1");
  const row = await eventDoc("CB", evB);
  assert.equal(row.status, "sent");
  assert.equal(row.patientId, "PB", "patient read off the appointment");
});

await check("b. the WhatsApp card's WABA id and token stand in for blank ones", async () => {
  const cfg = await server.loadCapiConfig("CB");
  assert.equal(cfg.ready, true);
  assert.equal(cfg.wabaFromWhatsapp, true);
  assert.equal(cfg.tokenFromWhatsapp, true);
  const meta = fakeMeta();
  await seedAppointment("CB", "AP_B2", "PB");
  await seedEvent("CB", "AP_B2", "booked", NOW - 30 * MIN, { patientId: "PB" });
  await server.processClinicQueue("CB", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].authorization, `Bearer ${WA_TOKEN}`);
  assert.equal(meta.calls[0].body.data[0].user_data.whatsapp_business_account_id, WA_WABA);
  const rows = JSON.stringify((await server.capiEventsCollection("CB").get()).docs.map((d) => d.data()));
  assert.ok(!rows.includes(WA_TOKEN), "the WhatsApp token is not stored on rows either");
});

await check("b. the clicks are carried over onto the patient", async () => {
  const p = (await db.doc("clinics/CB/patients/PB").get()).data() || {};
  assert.equal(p.adAttribution?.ctwaClid, "LEAD1");
  assert.deepEqual(p.adAttribution?.clicks.map((c: any) => c.ctwaClid), ["LEAD1", "CONV1"]);
});

// ── c. no click ─────────────────────────────────────────────────────────────────────────────

await seedClinic("CC", fullConfig());
await seedPatient("CC", "PC", { phone: "+201222222222" });
const evC = await seedEvent("CC", "AP_C", "booked", NOW - H, { patientId: "PC" });

await check("c. no click anywhere → skipped no_click, Meta never called", async () => {
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CC", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  assert.equal(run.skipped, 1);
  const row = await eventDoc("CC", evC);
  assert.equal(row.status, "skipped");
  assert.equal(row.reason, "no_click");
  const p = (await db.doc("clinics/CC/patients/PC").get()).data() || {};
  assert.equal(p.adAttribution, undefined, "nothing is written onto the patient");
});

// ── d. retries ──────────────────────────────────────────────────────────────────────────────

await seedClinic("CD", fullConfig());
await seedPatient("CD", "PD", { adAttribution: { ctwaClid: "CLK_D", clickedAt: NOW - D, clicks: [{ ctwaClid: "CLK_D", clickedAt: NOW - D }] } });
const evD1 = await seedEvent("CD", "AP_D1", "booked", NOW - H, { patientId: "PD" });
const evD2 = await seedEvent("CD", "AP_D2", "booked", NOW - H, { patientId: "PD" });
const evD3 = await seedEvent("CD", "AP_D3", "booked", NOW - H, { patientId: "PD" });
const serverError: Reply = { status: 500, json: { error: { message: "Service temporarily unavailable", code: 2 } } };
const badRequest: Reply = { status: 400, json: { error: { message: "Invalid parameter", code: 100, fbtrace_id: "FB400" } } };
const throttled: Reply = { status: 429, json: {} };
const d3Calls: number[] = [];

await check("d. 500 and 429 retry in 5 minutes", async () => {
  const meta = fakeMeta((id) => {
    if (id === evD3) d3Calls.push(1);
    return id === evD2 ? throttled : serverError;
  });
  const run = await server.processClinicQueue("CD", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.retried, 3);
  for (const id of [evD1, evD2, evD3]) {
    const row = await eventDoc("CD", id);
    assert.equal(row.status, "retry", id);
    assert.equal(row.attempts, 1, id);
    assert.equal(row.dueAt, NOW + 5 * MIN, id);
    assert.equal(row.lockedUntil, undefined, id);
  }
  assert.equal((await eventDoc("CD", evD1)).response.httpStatus, 500);
});

await check("d. nothing is retried before it is due", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CD", { nowMs: NOW + 4 * MIN, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
});

await check("d. a 400 fails for good; a 429 that clears is sent", async () => {
  const meta = fakeMeta((id) => {
    if (id === evD3) d3Calls.push(1);
    return id === evD1 ? badRequest : id === evD2 ? OK : serverError;
  });
  await server.processClinicQueue("CD", { nowMs: NOW + 5 * MIN, fetchImpl: meta.impl });
  const d1 = await eventDoc("CD", evD1);
  assert.equal(d1.status, "failed");
  assert.equal(d1.attempts, 2);
  assert.equal(d1.response.httpStatus, 400);
  assert.equal(d1.response.errorCode, 100);
  assert.equal(d1.response.fbtraceId, "FB400");
  assert.equal((await eventDoc("CD", evD2)).status, "sent");
  const d3 = await eventDoc("CD", evD3);
  assert.equal(d3.status, "retry");
  assert.equal(d3.attempts, 2);
  assert.equal(d3.dueAt, NOW + 5 * MIN + 20 * MIN);
});

await check("d. five failures give up as out_of_attempts", async () => {
  const meta = fakeMeta((id) => {
    if (id === evD3) d3Calls.push(1);
    return serverError;
  });
  for (let i = 0; i < 5; i++) {
    const row = await eventDoc("CD", evD3);
    if (row.status !== "retry") break;
    await server.processClinicQueue("CD", { nowMs: row.dueAt, fetchImpl: meta.impl });
  }
  const d3 = await eventDoc("CD", evD3);
  assert.equal(d3.status, "failed");
  assert.equal(d3.reason, "out_of_attempts");
  assert.equal(d3.attempts, core.MAX_ATTEMPTS);
  assert.equal(d3Calls.length, core.MAX_ATTEMPTS, "exactly MAX_ATTEMPTS sends");
  const again = fakeMeta();
  await server.processClinicQueue("CD", { nowMs: NOW + 30 * D, fetchImpl: again.impl });
  assert.equal(again.calls.length, 0, "a failed row is never picked up again");
});

// ── e. Purchase ─────────────────────────────────────────────────────────────────────────────

await seedClinic("CE", fullConfig());
await seedPatient("CE", "PE", { adAttribution: { ctwaClid: "CLK_E", clickedAt: NOW - 5 * D, clicks: [{ ctwaClid: "CLK_E", clickedAt: NOW - 5 * D }] } });
await seedAppointment("CE", "AP_E", "PE");
const ledger = db.collection("clinics/CE/ledger");
await ledger.add({ appointmentId: "AP_E", type: "procedure", cost: 300, amount: 300, discountAmount: 50 });
await ledger.add({ appointmentId: "AP_E", type: "procedure", cost: 0, amount: 200 }); // old row: amount only
await ledger.add({ appointmentId: "AP_E", type: "procedure", cost: 700, amount: 700, status: "deleted" });
await ledger.add({ appointmentId: "AP_E", type: "payment", paid: 1000, amount: 1000 });
await ledger.add({ appointmentId: "AP_OTHER", type: "procedure", cost: 999 });
const evE = await seedEvent("CE", "AP_E", "visited", NOW - H, { patientId: "PE" });

await check("e. a Purchase is not sent before its settle time", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CE", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  const row = await eventDoc("CE", evE);
  assert.equal(row.status, "pending");
  assert.equal(row.dueAt, NOW - H + core.PURCHASE_SETTLE_MS);
});

await check("e. after settling it carries the visit's treatment charges", async () => {
  assert.equal(await server.appointmentChargeValue("CE", "AP_E"), 500);
  const meta = fakeMeta();
  await server.processClinicQueue("CE", { nowMs: NOW - H + core.PURCHASE_SETTLE_MS, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  const ev = meta.calls[0].body.data[0];
  assert.equal(ev.event_name, "Purchase");
  assert.equal(ev.event_id, "AP_E_Purchase");
  assert.deepEqual(ev.custom_data, { currency: "EGP", value: 500 });
  const row = await eventDoc("CE", evE);
  assert.equal(row.status, "sent");
  assert.equal(row.value, 500);
});

// ── f. switched off / not configured ────────────────────────────────────────────────────────

await seedClinic("CF", fullConfig({ enabled: false }));
await seedPatient("CF", "PF", { adAttribution: { ctwaClid: "CLK_F", clickedAt: NOW - D, clicks: [{ ctwaClid: "CLK_F", clickedAt: NOW - D }] } });
const evF = await seedEvent("CF", "AP_F", "booked", NOW - H, { patientId: "PF" });
await seedClinic("CG", { enabled: true, wabaId: WABA, token: TOKEN });
await seedPatient("CG", "PG", { adAttribution: { ctwaClid: "CLK_G", clickedAt: NOW - D, clicks: [{ ctwaClid: "CLK_G", clickedAt: NOW - D }] } });
const evG = await seedEvent("CG", "AP_G", "booked", NOW - H, { patientId: "PG" });

await check("f. the cron skips a switched-off clinic entirely; no dataset → failed not_configured", async () => {
  const meta = fakeMeta();
  const runs = await server.processAllEnabledClinics({ nowMs: NOW, fetchImpl: meta.impl });
  const ids = runs.map((r) => r.clinicId);
  assert.ok(!ids.includes("CF"), "CF is not run");
  assert.ok(ids.includes("CG"), "CG is run");
  assert.equal((await eventDoc("CF", evF)).status, "pending", "CF's row is untouched");
  const g = await eventDoc("CG", evG);
  assert.equal(g.status, "failed");
  assert.equal(g.reason, "not_configured");
  assert.match(String(g.response?.error), /datasetId/);
  assert.equal(meta.calls.length, 0);
});

await check("f. run by hand, a switched-off clinic's rows are marked skipped/disabled, nothing sent", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CF", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  const f = await eventDoc("CF", evF);
  assert.equal(f.status, "skipped");
  assert.equal(f.reason, "disabled");
});

// ── g. test-event code ──────────────────────────────────────────────────────────────────────

await seedClinic("CH", fullConfig({ testEventCode: "TEST123" }));
await seedPatient("CH", "PH", { adAttribution: { ctwaClid: "CLK_H", clickedAt: NOW - D, clicks: [{ ctwaClid: "CLK_H", clickedAt: NOW - D }] } });
const evH = await seedEvent("CH", "AP_H", "booked", NOW - H, { patientId: "PH" });
await db.doc("clinics/CH/whatsapp_conversations/100000001").set({
  adAt: NOW - 2 * D,
  lastMessageAt: NOW - 10 * MIN,
  ad: { ctwaClid: "OLD_CONV", headline: "Old" },
  adClicks: [{ ctwaClid: "NEW_CONV", clickedAt: NOW - 10 * MIN }],
});

await check("g. a set test code rides on the event and marks the row", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CH", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].body.test_event_code, "TEST123");
  const row = await eventDoc("CH", evH);
  assert.equal(row.status, "sent");
  assert.equal(row.test, true);
  assert.equal(row.payload.test_event_code, "TEST123");
});

await check("g. the test button refuses without a test code", async () => {
  const meta = fakeMeta();
  const r = await server.sendTestConversion("CA", { fetchImpl: meta.impl, ctwaClid: "X" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "test_code_required");
  assert.equal(meta.calls.length, 0);
});

await check("g. the test button sends with the newest clinic click and logs a test row", async () => {
  assert.equal((await server.latestClinicClick("CH"))?.ctwaClid, "NEW_CONV");
  const meta = fakeMeta();
  const r = await server.sendTestConversion("CH", { fetchImpl: meta.impl, nowMs: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.ctwaClid, "NEW_CONV");
  assert.equal(r.eventId, `test_${NOW}`);
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].body.test_event_code, "TEST123");
  assert.equal(meta.calls[0].body.data[0].event_name, "LeadSubmitted");
  const row = await eventDoc("CH", r.eventId);
  assert.equal(row.test, true);
  assert.equal(row.status, "sent");
  assert.equal(row.attempts, 1);
  assert.equal(row.patientId, null);
  assert.ok(!JSON.stringify(row).includes(TOKEN));
});

// ── i. lock ─────────────────────────────────────────────────────────────────────────────────

await seedClinic("CI", fullConfig());
await seedPatient("CI", "PI", { adAttribution: { ctwaClid: "CLK_I", clickedAt: NOW - D, clicks: [{ ctwaClid: "CLK_I", clickedAt: NOW - D }] } });
const evI = await seedEvent("CI", "AP_I", "booked", NOW - H, { patientId: "PI", extra: { lockedUntil: NOW + MIN } });

await check("i. a row locked by another run is left alone until the lock lapses", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CI", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  assert.equal((await eventDoc("CI", evI)).status, "pending");
  await server.processClinicQueue("CI", { nowMs: NOW + 2 * MIN, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  assert.equal((await eventDoc("CI", evI)).status, "sent");
});

// ── h. the cron route ───────────────────────────────────────────────────────────────────────

const call = (auth?: string) =>
  GET(new Request("http://localhost/api/automation/meta-conversions", { headers: auth ? { authorization: auth } : {} }));

await check("h. no secret or a wrong one is refused", async () => {
  const none = await call();
  assert.notEqual(none.status, 200);
  const wrong = await call("Bearer not-the-secret");
  assert.notEqual(wrong.status, 200);
});

await check("h. the scheduler's secret runs every switched-on clinic", async () => {
  const res = await call(`Bearer ${SECRET}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // CA, CB, CC, CD, CE, CG, CH, CI are switched on; CF is not.
  assert.equal(body.clinics, 8);
  for (const k of ["sent", "retried", "failed", "skipped"]) assert.equal(typeof body[k], "number", k);
  assert.equal(body.sent, 0, "everything was already settled");
});

await check("no stray network calls anywhere", () => {
  assert.equal(strayFetches, 0);
});

await wipe();

console.log(`\nmetaConversionsWorker: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
