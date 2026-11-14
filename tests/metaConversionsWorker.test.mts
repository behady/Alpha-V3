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
 *   f. a switched-off clinic is never touched; switched on without a dataset pauses, rows wait;
 *   g. a saved test code pauses live sending (rows wait, nothing goes out marked as a test); the
 *      test button needs a code and is the only thing that sends one;
 *   h. only the scheduler's secret runs the cron;
 *   i. a row another run has locked is left alone — measured on the real clock, so a row claimed
 *      late in a long run is still locked against the next run;
 *   j. the appointment is re-read before sending: gone, cancelled or no-show ends the row; a
 *      rescheduled lead and a delayed confirmation still go out; an undone confirmation or
 *      check-in that was never posted is deleted (and a later real one can queue again), one that
 *      was posted before ends skipped; a re-confirmation landing between our read and our delete
 *      leaves the row open and it is sent next run;
 *   k. one lead and one qualified lead per ad click: a second booking on the same click sends
 *      nothing, a booking on a new click does;
 *   l. a heap of finished and not-yet-due rows cannot crowd a due row out of the run's limit;
 *   m. the click marker is reserved before the send: two rows on one click in two interleaved
 *      runs send once; a reservation left by a dead run is taken over; a repeated referral keeps
 *      the click's first time;
 *   n. a row Meta accepted is never posted again, even when its "sent" cannot be written.
 *
 * Meta does not deduplicate these events, so every one of these guards is the only protection.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";

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
/** The Firebase trigger's own planner, to re-queue a moment exactly as the trigger would. */
const triggerPlan = createRequire(import.meta.url)("../functions/metaConversionsPlan.js") as {
  planConversionEvents: (args: { clinicId: string; appointmentId: string; before: unknown; after: unknown; nowMs?: number }) => Array<{ id: string; data: Record<string, unknown> }>;
};

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

const CLINICS = ["CA", "CB", "CC", "CD", "CE", "CF", "CG", "CH", "CI", "CJ", "CK", "CL", "CM", "CN"];

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

async function seedAppointment(clinicId: string, id: string, patientId: string, status = "Scheduled") {
  await db.doc(`clinics/${clinicId}/appointments/${id}`).set({ patientId, patientName: patientId, status });
}

const setStatus = (clinicId: string, id: string, status: string) => db.doc(`clinics/${clinicId}/appointments/${id}`).update({ status });

/** Queue whatever the Firebase trigger would queue for this appointment write, the way it does. */
async function trigger(clinicId: string, appointmentId: string, before: unknown, after: unknown, nowMs: number): Promise<string[]> {
  const ids: string[] = [];
  for (const { id, data } of triggerPlan.planConversionEvents({ clinicId, appointmentId, before, after, nowMs })) {
    await server.capiEventsCollection(clinicId).doc(id).create({ ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    ids.push(id);
  }
  return ids;
}

const clickPatient = (id: string, at: number) => ({ adAttribution: { ctwaClid: id, clickedAt: at, clicks: [{ ctwaClid: id, clickedAt: at }] } });

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
  assert.equal(row.dueAt, undefined, "a final row leaves the due-query");
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
  // A confirmation, not a second booking: the lead on this click was already credited above.
  await seedAppointment("CB", "AP_B2", "PB", "Confirmed");
  await seedEvent("CB", "AP_B2", "confirmed", NOW - 30 * MIN, { patientId: "PB" });
  await server.processClinicQueue("CB", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].body.data[0].event_name, "QualifiedLead");
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
await seedAppointment("CC", "AP_C", "PC");
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
// Three patients on three clicks: one click would credit only its first lead (see k).
for (const n of [1, 2, 3]) {
  await seedPatient("CD", `PD${n}`, clickPatient(`CLK_D${n}`, NOW - D));
  await seedAppointment("CD", `AP_D${n}`, `PD${n}`);
}
const evD1 = await seedEvent("CD", "AP_D1", "booked", NOW - H, { patientId: "PD1" });
const evD2 = await seedEvent("CD", "AP_D2", "booked", NOW - H, { patientId: "PD2" });
const evD3 = await seedEvent("CD", "AP_D3", "booked", NOW - H, { patientId: "PD3" });
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
  assert.equal(d1.dueAt, undefined, "a failed row leaves the due-query");
  assert.equal((await server.clickMarkerRef("CD", "CLK_D1", "LeadSubmitted").get()).exists, false, "a refused send credits no click");
  assert.equal((await eventDoc("CD", evD2)).status, "sent");
  assert.equal((await server.clickMarkerRef("CD", "CLK_D2", "LeadSubmitted").get()).exists, true, "a sent lead marks its click");
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
await seedAppointment("CE", "AP_E", "PE", "Checked In");
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

const rowF0 = await eventDoc("CF", evF);
const rowG0 = await eventDoc("CG", evG);

await check("f. the cron skips a switched-off clinic entirely; no dataset → paused, row untouched", async () => {
  const meta = fakeMeta();
  const runs = await server.processAllEnabledClinics({ nowMs: NOW, fetchImpl: meta.impl });
  const ids = runs.map((r) => r.clinicId);
  assert.ok(!ids.includes("CF"), "CF is not run");
  const g = runs.find((r) => r.clinicId === "CG");
  assert.ok(g, "CG is run");
  assert.equal(g!.paused, "not_configured");
  assert.equal(g!.examined, 0);
  assert.deepEqual(await eventDoc("CF", evF), rowF0, "CF's row is untouched");
  assert.deepEqual(await eventDoc("CG", evG), rowG0, "CG's row is untouched: a half-finished setup ends nothing");
  assert.equal(meta.calls.length, 0);
});

await check("f. run by hand, a switched-off clinic is paused: its rows wait, nothing sent", async () => {
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CF", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.paused, "disabled");
  assert.equal(run.examined, 0);
  assert.equal(meta.calls.length, 0);
  assert.deepEqual(await eventDoc("CF", evF), rowF0);
});

await check("f. once the setup is finished, the waiting row goes out", async () => {
  await db.doc("clinic_secrets/CG").update({ "metaCapi.datasetId": DATASET });
  await seedAppointment("CG", "AP_G", "PG");
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CG", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.paused, undefined);
  assert.equal(run.sent, 1);
  assert.equal((await eventDoc("CG", evG)).status, "sent");
});

// ── g. test-event code ──────────────────────────────────────────────────────────────────────

await seedClinic("CH", fullConfig({ testEventCode: "TEST123" }));
await seedPatient("CH", "PH", { adAttribution: { ctwaClid: "CLK_H", clickedAt: NOW - D, clicks: [{ ctwaClid: "CLK_H", clickedAt: NOW - D }] } });
await seedAppointment("CH", "AP_H", "PH");
const evH = await seedEvent("CH", "AP_H", "booked", NOW - H, { patientId: "PH" });
const rowH0 = await eventDoc("CH", evH);
await db.doc("clinics/CH/whatsapp_conversations/100000001").set({
  adAt: NOW - 2 * D,
  lastMessageAt: NOW - 10 * MIN,
  ad: { ctwaClid: "OLD_CONV", headline: "Old" },
  adClicks: [{ ctwaClid: "NEW_CONV", clickedAt: NOW - 10 * MIN }],
});

await check("g. a saved test code pauses live sending: the row waits, nothing goes out", async () => {
  const cfg = await server.loadCapiConfig("CH");
  assert.equal(cfg.testMode, true);
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CH", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.paused, "test_mode");
  assert.equal(run.examined, 0);
  assert.equal(meta.calls.length, 0, "a real event is never sent marked as a test");
  assert.deepEqual(await eventDoc("CH", evH), rowH0, "the row is untouched");
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
  assert.equal(row.dueAt, undefined, "a test row is never in the queue");
  assert.ok(!JSON.stringify(row).includes(TOKEN));
  assert.deepEqual(await eventDoc("CH", evH), rowH0, "the waiting live row is not touched by the test");
});

await check("g. with the test code cleared, the waiting row goes out live, with no test code", async () => {
  await db.doc("clinic_secrets/CH").update({ "metaCapi.testEventCode": "" });
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CH", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.paused, undefined);
  assert.equal(run.sent, 1);
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].body.test_event_code, undefined);
  assert.equal(meta.calls[0].body.data[0].user_data.ctwa_clid, "CLK_H");
  const row = await eventDoc("CH", evH);
  assert.equal(row.status, "sent");
  assert.equal(row.test, undefined, "a live row is never marked as a test");
  assert.equal(row.payload.test_event_code, undefined);
});

// ── i. lock ─────────────────────────────────────────────────────────────────────────────────

await seedClinic("CI", fullConfig());
await seedPatient("CI", "PI", clickPatient("CLK_I", NOW - D));
await seedAppointment("CI", "AP_I", "PI");
const evI = await seedEvent("CI", "AP_I", "booked", NOW - H, { patientId: "PI", extra: { lockedUntil: NOW + MIN } });

await check("i. a row locked by another run is left alone until the lock lapses (real clock)", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CI", { nowMs: NOW, clock: () => NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  assert.equal((await eventDoc("CI", evI)).status, "pending");
  await server.processClinicQueue("CI", { nowMs: NOW, clock: () => NOW + 2 * MIN, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  assert.equal((await eventDoc("CI", evI)).status, "sent");
});

await seedPatient("CI", "PI2", clickPatient("CLK_I2", NOW - D));
await seedAppointment("CI", "AP_I2", "PI2");
const evI2 = await seedEvent("CI", "AP_I2", "booked", NOW - H, { patientId: "PI2" });

await check("i. a row claimed four minutes into a long run is still locked against the next run", async () => {
  // Run 1 started at NOW but reaches this row at NOW+4min. While its send is in flight, run 2
  // starts at NOW+4.5min. With the lock timed from the run's START (NOW+2min) run 2 would take
  // the row and send it a second time — and Meta would count both.
  const inner = fakeMeta();
  // `as` keeps TypeScript from narrowing this to null: it is assigned inside the fetch below.
  let innerRun = null as Awaited<ReturnType<typeof server.processClinicQueue>> | null;
  let outerCalls = 0;
  const outerFetch = (async () => {
    outerCalls += 1;
    innerRun = await server.processClinicQueue("CI", { nowMs: NOW + 4 * MIN, clock: () => NOW + 4 * MIN + 30_000, fetchImpl: inner.impl });
    return new Response(JSON.stringify(OK.json), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const outer = await server.processClinicQueue("CI", { nowMs: NOW, clock: () => NOW + 4 * MIN, fetchImpl: outerFetch });
  assert.equal(outerCalls, 1);
  assert.equal(outer.sent, 1);
  assert.ok(innerRun, "the second run ran during the first one's send");
  assert.equal(innerRun!.examined, 0, "the second run claimed nothing");
  assert.equal(inner.calls.length, 0, "the second run sent nothing");
  assert.equal((await eventDoc("CI", evI2)).status, "sent");
});

// ── j. the appointment is re-read before sending ────────────────────────────────────────────

await seedClinic("CJ", fullConfig());
await seedPatient("CJ", "PJ", clickPatient("CLK_J", NOW - D));
const evJGone = await seedEvent("CJ", "AP_J_GONE", "booked", NOW - H, { patientId: "PJ" }); // no appointment doc
await seedAppointment("CJ", "AP_J_CXL", "PJ", "Cancelled");
const evJCxl = await seedEvent("CJ", "AP_J_CXL", "booked", NOW - H, { patientId: "PJ" });
await seedAppointment("CJ", "AP_J_NS", "PJ", "No Show"); // confirmed, then never came
const evJNs = await seedEvent("CJ", "AP_J_NS", "confirmed", NOW - H, { patientId: "PJ" });
await seedAppointment("CJ", "AP_J_CONF", "PJ", "Scheduled"); // confirmed, then un-confirmed
const evJConf = await seedEvent("CJ", "AP_J_CONF", "confirmed", NOW - H);
await seedAppointment("CJ", "AP_J_VISIT", "PJ", "Confirmed"); // checked in, then undone
const evJVisit = await seedEvent("CJ", "AP_J_VISIT", "visited", NOW - 4 * H);
// The same two undos, but each row was already posted once (a timeout or a 5xx): Meta may have
// counted it, so it must end here and never be queued again.
await seedAppointment("CJ", "AP_J_CONF2", "PJ", "Scheduled");
const evJConf2 = await seedEvent("CJ", "AP_J_CONF2", "confirmed", NOW - H, { patientId: "PJ", extra: { status: "retry", attempts: 2 } });
await seedAppointment("CJ", "AP_J_VISIT2", "PJ", "Scheduled");
const evJVisit2 = await seedEvent("CJ", "AP_J_VISIT2", "visited", NOW - 4 * H, { patientId: "PJ", extra: { status: "retry", attempts: 1 } });

await check("j. gone, cancelled, no-show end the row; never-posted undos are deleted, posted ones end skipped; Meta never called", async () => {
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CJ", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  assert.equal(run.skipped, 7);
  const gone = await eventDoc("CJ", evJGone);
  assert.equal(gone.status, "skipped");
  assert.equal(gone.reason, "appointment_gone");
  assert.equal(gone.dueAt, undefined);
  for (const id of [evJCxl, evJNs]) {
    const row = await eventDoc("CJ", id);
    assert.equal(row.status, "skipped", id);
    assert.equal(row.reason, "cancelled", id);
    assert.equal(row.dueAt, undefined, id);
  }
  assert.equal((await server.capiEventsCollection("CJ").doc(evJConf).get()).exists, false, "an undone, never-posted confirmation's row is deleted");
  assert.equal((await server.capiEventsCollection("CJ").doc(evJVisit).get()).exists, false, "an undone, never-posted check-in's row is deleted");
  for (const [id, reason, attempts] of [[evJConf2, "not_confirmed", 2], [evJVisit2, "visit_undone", 1]] as const) {
    const row = await eventDoc("CJ", id);
    assert.equal(row.status, "skipped", `${id}: a posted row is never deleted`);
    assert.equal(row.reason, reason, id);
    assert.equal(row.attempts, attempts, `${id}: no try spent`);
    assert.equal(row.dueAt, undefined, `${id}: out of the queue for good`);
    assert.equal(row.lockedUntil, undefined, id);
  }
});

await check("j. a rescheduled lead and a delayed confirmation still go out", async () => {
  // A patient of their own: the lead and the qualified lead on PJ's click are spent below.
  await seedPatient("CJ", "PJ2", clickPatient("CLK_J2", NOW - D));
  await seedAppointment("CJ", "AP_J_RES", "PJ2", "Rescheduled");
  const evJRes = await seedEvent("CJ", "AP_J_RES", "booked", NOW - H, { patientId: "PJ2" });
  await seedAppointment("CJ", "AP_J_DLY", "PJ2", "Delayed");
  const evJDly = await seedEvent("CJ", "AP_J_DLY", "confirmed", NOW - H, { patientId: "PJ2" });
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CJ", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.sent, 2);
  assert.deepEqual(meta.calls.map((c) => c.body.data[0].event_id).sort(), [evJDly, evJRes].sort());
  assert.equal((await eventDoc("CJ", evJRes)).status, "sent", "the booking happened; it only moved");
  assert.equal((await eventDoc("CJ", evJDly)).status, "sent", "a delayed booking is still a confirmed one");
});

await check("j. the undo transaction re-reads: still undone → deleted; confirmed again → kept", async () => {
  await seedAppointment("CJ", "AP_J_TX", "PJ", "Scheduled");
  const id = await seedEvent("CJ", "AP_J_TX", "confirmed", NOW - H, { patientId: "PJ" });
  const ref = server.capiEventsCollection("CJ").doc(id);
  await setStatus("CJ", "AP_J_TX", "Confirmed");
  assert.equal(await server.dropUndoneRow("CJ", ref, "QualifiedLead", "AP_J_TX"), "kept");
  assert.equal((await ref.get()).exists, true);
  await ref.update({ attempts: 1 });
  await setStatus("CJ", "AP_J_TX", "Scheduled");
  assert.equal(await server.dropUndoneRow("CJ", ref, "QualifiedLead", "AP_J_TX"), "kept", "a posted row is never deleted");
  await ref.update({ attempts: 0 });
  assert.equal(await server.dropUndoneRow("CJ", ref, "QualifiedLead", "AP_J_TX"), "deleted");
  assert.equal((await ref.get()).exists, false);
  assert.equal(await server.dropUndoneRow("CJ", ref, "QualifiedLead", "AP_J_TX"), "gone");
});

await check("j. a later real confirmation and arrival queue again and are sent", async () => {
  await setStatus("CJ", "AP_J_CONF", "Confirmed");
  // No patientId on the write: the sender must read it off the appointment.
  const conf = await trigger("CJ", "AP_J_CONF", { status: "Scheduled" }, { status: "Confirmed" }, NOW);
  assert.deepEqual(conf, [evJConf], "the trigger's create() is free again");
  await setStatus("CJ", "AP_J_VISIT", "Checked In");
  const visit = await trigger("CJ", "AP_J_VISIT", { status: "Confirmed", patientId: "PJ" }, { status: "Checked In", patientId: "PJ" }, NOW);
  assert.deepEqual(visit, [evJVisit]);
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CJ", { nowMs: NOW + core.PURCHASE_SETTLE_MS, fetchImpl: meta.impl });
  assert.equal(run.sent, 2);
  assert.deepEqual(meta.calls.map((c) => c.body.data[0].event_id).sort(), [evJConf, evJVisit].sort());
  assert.equal((await eventDoc("CJ", evJConf)).patientId, "PJ", "the patient is read off the appointment when the row has none");
});

await check("j. a re-confirmation between our read and our delete leaves the row open; the next run sends it", async () => {
  await seedPatient("CJ", "PJ3", clickPatient("CLK_J3", NOW - D));
  await seedAppointment("CJ", "AP_J_RACE", "PJ3", "Scheduled");
  const id = await seedEvent("CJ", "AP_J_RACE", "confirmed", NOW - H, { patientId: "PJ3" });
  let hooked = 0;
  let swallowed = false;
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CJ", {
    nowMs: NOW,
    fetchImpl: meta.impl,
    testHooks: {
      // We have read "Scheduled" and are about to delete. The desk re-confirms right now, and the
      // trigger's create() for that confirmation hits our row and is swallowed as ALREADY_EXISTS.
      beforeUndoneDelete: async (eventId) => {
        if (eventId !== id) return;
        hooked += 1;
        await setStatus("CJ", "AP_J_RACE", "Confirmed");
        swallowed = await trigger("CJ", "AP_J_RACE", { status: "Scheduled" }, { status: "Confirmed", patientId: "PJ3" }, NOW).then(
          () => false,
          () => true
        );
      },
    },
  });
  assert.equal(hooked, 1);
  assert.equal(swallowed, true, "the trigger's create() met our row");
  assert.equal(meta.calls.length, 0);
  assert.equal(run.deferred, 1);
  const row = await eventDoc("CJ", id);
  assert.equal(row.status, "pending", "the row survives: it is the only record of the confirmation");
  assert.equal(row.attempts, 0);
  assert.equal(row.lockedUntil, undefined, "released");
  const meta2 = fakeMeta();
  const run2 = await server.processClinicQueue("CJ", { nowMs: NOW, fetchImpl: meta2.impl });
  assert.equal(run2.sent, 1);
  assert.equal(meta2.calls.length, 1);
  assert.equal(meta2.calls[0].body.data[0].event_id, id);
  assert.equal((await eventDoc("CJ", id)).status, "sent");
});

await check("j. a rescheduled copy queues no new lead (pure)", () => {
  const plan = triggerPlan.planConversionEvents({ clinicId: "CJ", appointmentId: "AP_J_NEW", before: null, after: { status: "Scheduled", patientId: "PJ", rescheduledFromId: "AP_J_RES" }, nowMs: NOW });
  assert.deepEqual(plan, []);
  const fresh = triggerPlan.planConversionEvents({ clinicId: "CJ", appointmentId: "AP_J_NEW", before: null, after: { status: "Scheduled", patientId: "PJ" }, nowMs: NOW });
  assert.deepEqual(fresh.map((d) => d.id), ["AP_J_NEW_LeadSubmitted"], "a plain new booking still is one");
});

// ── k. once per click ───────────────────────────────────────────────────────────────────────

await seedClinic("CK", fullConfig());
await seedPatient("CK", "PK", clickPatient("CLK_K1", NOW - 3 * D));
for (const id of ["AP_K1", "AP_K2", "AP_K3"]) await seedAppointment("CK", id, "PK");
const evK1 = await seedEvent("CK", "AP_K1", "booked", NOW - 2 * D, { patientId: "PK" });

await check("k. the first booking on a click is sent and marks the click", async () => {
  const meta = fakeMeta();
  await server.processClinicQueue("CK", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  const marker = await server.clickMarkerRef("CK", "CLK_K1", "LeadSubmitted").get();
  assert.equal(marker.exists, true);
  const m = marker.data() || {};
  assert.equal(m.clinicId, "CK");
  assert.equal(m.eventName, "LeadSubmitted");
  assert.equal(m.eventId, evK1);
  assert.equal(m.appointmentId, "AP_K1");
  assert.equal(m.state, "sent", "the reservation became a credit");
  assert.equal(typeof m.reservedAt, "number");
  assert.ok(m.sentAt);
  assert.ok(m.createdAt);
  assert.equal(marker.ref.parent.id, server.CAPI_CLICKS_SUBCOLLECTION);
  assert.ok(!marker.id.includes("CLK_K1"), "the marker id is a hash, not the raw click id");
});

await check("k. a second booking on the same click sends nothing (already_credited)", async () => {
  const evK2 = await seedEvent("CK", "AP_K2", "booked", NOW - H, { patientId: "PK" });
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CK", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  assert.equal(run.skipped, 1);
  const row = await eventDoc("CK", evK2);
  assert.equal(row.status, "skipped");
  assert.equal(row.reason, "already_credited");
  assert.equal(row.ctwaClid, "CLK_K1");
  assert.equal(row.dueAt, undefined);
});

await check("k. a booking on a new click is sent", async () => {
  await db.doc("clinics/CK/patients/PK").update({
    adAttribution: { ctwaClid: "CLK_K2", clickedAt: NOW - 30 * MIN, clicks: [{ ctwaClid: "CLK_K2", clickedAt: NOW - 30 * MIN }, { ctwaClid: "CLK_K1", clickedAt: NOW - 3 * D }] },
  });
  const evK3 = await seedEvent("CK", "AP_K3", "booked", NOW - 10 * MIN, { patientId: "PK" });
  const meta = fakeMeta();
  await server.processClinicQueue("CK", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].body.data[0].user_data.ctwa_clid, "CLK_K2");
  assert.equal((await eventDoc("CK", evK3)).status, "sent");
});

// ── l. starvation ───────────────────────────────────────────────────────────────────────────

await seedClinic("CL", fullConfig());
await seedPatient("CL", "PL", clickPatient("CLK_L", NOW - D));
for (let i = 0; i < 5; i++) {
  // Finished rows, as the sender leaves them: no dueAt.
  await server.capiEventsCollection("CL").doc(`A_done_${i}_LeadSubmitted`).create({ clinicId: "CL", appointmentId: `A_done_${i}`, status: "skipped", reason: "no_click", eventTimeMs: NOW - D, attempts: 0 });
  // Visits still inside their settle window: open, but not due for hours.
  await seedEvent("CL", `B_wait_${i}`, "visited", NOW, { patientId: "PL" });
}
await seedAppointment("CL", "Z_due", "PL");
const evL = await seedEvent("CL", "Z_due", "booked", NOW - H, { patientId: "PL" });

await check("l. more than `limit` finished and not-yet-due rows cannot hide a due one", async () => {
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CL", { nowMs: NOW, fetchImpl: meta.impl, limit: 3 });
  assert.equal(run.sent, 1);
  assert.equal(meta.calls.length, 1);
  assert.equal(meta.calls[0].body.data[0].event_id, evL);
  assert.equal((await eventDoc("CL", evL)).status, "sent");
  assert.equal((await eventDoc("CL", "B_wait_0_Purchase")).status, "pending", "the waiting visits are untouched");
});

// ── m. the click marker is a reservation ────────────────────────────────────────────────────

await seedClinic("CM", fullConfig());
await seedPatient("CM", "PM", clickPatient("CLK_M", NOW - D));
await seedAppointment("CM", "AP_M1", "PM");
await seedAppointment("CM", "AP_M2", "PM");
const evM1 = await seedEvent("CM", "AP_M1", "booked", NOW - 2 * H, { patientId: "PM" });
const evM2 = await seedEvent("CM", "AP_M2", "booked", NOW - H, { patientId: "PM" });

await check("m. two rows on one click in two interleaved runs: exactly one send", async () => {
  // Run 1 is mid-send on M1 (holding M1's lock) when run 2 starts and claims M2 — a different row,
  // so the row lock does not stop it. Without a reservation both would see "no marker" and both
  // would go out as leads on the same click, and Meta would count two.
  const inner = fakeMeta();
  let innerRun = null as Awaited<ReturnType<typeof server.processClinicQueue>> | null;
  let outerCalls = 0;
  const outerFetch = (async (_url: unknown, init?: RequestInit) => {
    outerCalls += 1;
    assert.equal(JSON.parse(String(init?.body)).data[0].event_id, evM1);
    innerRun = await server.processClinicQueue("CM", { nowMs: NOW, fetchImpl: inner.impl });
    return new Response(JSON.stringify(OK.json), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const outer = await server.processClinicQueue("CM", { nowMs: NOW, fetchImpl: outerFetch });
  assert.equal(outerCalls, 1);
  assert.equal(outer.sent, 1);
  assert.ok(innerRun);
  assert.equal(inner.calls.length, 0, "the second run did not send M2");
  assert.equal(innerRun!.deferred, 1, "M2 was put back, not ended");
  const m2 = await eventDoc("CM", evM2);
  assert.equal(m2.status, "pending");
  assert.equal(m2.attempts, 0, "no try spent");
  assert.equal(m2.dueAt, NOW + 5 * MIN);
  assert.equal(m2.lockedUntil, undefined);
  const marker = (await server.clickMarkerRef("CM", "CLK_M", "LeadSubmitted").get()).data() || {};
  assert.equal(marker.state, "sent");
  assert.equal(marker.eventId, evM1);

  const later = fakeMeta();
  const run3 = await server.processClinicQueue("CM", { nowMs: NOW + 5 * MIN, fetchImpl: later.impl });
  assert.equal(later.calls.length, 0);
  assert.equal(run3.skipped, 1);
  const m2b = await eventDoc("CM", evM2);
  assert.equal(m2b.status, "skipped");
  assert.equal(m2b.reason, "already_credited");
});

await check("m. a reservation left by a dead run is taken over", async () => {
  await seedPatient("CM", "PM2", clickPatient("CLK_M2", NOW - D));
  await seedAppointment("CM", "AP_M3", "PM2");
  const ev = await seedEvent("CM", "AP_M3", "booked", NOW - H, { patientId: "PM2" });
  const ref = server.clickMarkerRef("CM", "CLK_M2", "LeadSubmitted");
  await ref.set({ state: "sending", reservedAt: Date.now() - 10 * MIN, eventId: "GHOST_LeadSubmitted", appointmentId: "GHOST", clinicId: "CM", eventName: "LeadSubmitted" });
  const meta = fakeMeta();
  const run = await server.processClinicQueue("CM", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(run.sent, 1);
  assert.equal(meta.calls.length, 1);
  assert.equal((await eventDoc("CM", ev)).status, "sent");
  const m = (await ref.get()).data() || {};
  assert.equal(m.state, "sent");
  assert.equal(m.eventId, ev, "the marker now names the row that really sent");
});

await check("m. a reservation whose owner already sent counts as a credit (its marker write was lost)", async () => {
  await seedPatient("CM", "PM3", clickPatient("CLK_M3", NOW - D));
  await seedAppointment("CM", "AP_M4", "PM3");
  await seedAppointment("CM", "AP_M5", "PM3");
  const owner = await seedEvent("CM", "AP_M4", "booked", NOW - 2 * H, { patientId: "PM3", extra: { status: "sent" } });
  const ev = await seedEvent("CM", "AP_M5", "booked", NOW - H, { patientId: "PM3" });
  const ref = server.clickMarkerRef("CM", "CLK_M3", "LeadSubmitted");
  await ref.set({ state: "sending", reservedAt: Date.now(), eventId: owner, appointmentId: "AP_M4", clinicId: "CM", eventName: "LeadSubmitted" });
  const meta = fakeMeta();
  await server.processClinicQueue("CM", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 0);
  const row = await eventDoc("CM", ev);
  assert.equal(row.status, "skipped");
  assert.equal(row.reason, "already_credited");
  assert.equal((await ref.get()).data()?.state, "sent", "the marker is corrected");
});

await check("m. a repeated referral keeps the click's first time: the booking is still credited", async () => {
  // First tap two days ago (on the chat); the same ad tapped again ten minutes ago, AFTER the
  // booking an hour ago, and that later copy reached the patient record.
  const PHONE_M = "+201009998887";
  await seedPatient("CM", "PM4", { phone: PHONE_M, ...clickPatient("CLK_M4", NOW - 10 * MIN) });
  await db.doc(`clinics/CM/whatsapp_conversations/${conversationKey(PHONE_M)}`).set({ phoneKey: conversationKey(PHONE_M), adClicks: [{ ctwaClid: "CLK_M4", clickedAt: NOW - 2 * D }] });
  await seedAppointment("CM", "AP_M6", "PM4");
  const ev = await seedEvent("CM", "AP_M6", "booked", NOW - H, { patientId: "PM4" });
  const clicks = await server.clicksForPatient("CM", "PM4");
  assert.deepEqual(clicks.map((c) => [c.ctwaClid, c.clickedAt]), [["CLK_M4", NOW - 2 * D]]);
  const meta = fakeMeta();
  await server.processClinicQueue("CM", { nowMs: NOW, fetchImpl: meta.impl });
  assert.equal(meta.calls.length, 1, "not no_click");
  const row = await eventDoc("CM", ev);
  assert.equal(row.status, "sent");
  assert.equal(row.clickedAt, NOW - 2 * D);
  const p = (await db.doc("clinics/CM/patients/PM4").get()).data() || {};
  assert.equal(p.adAttribution?.clickedAt, NOW - 2 * D, "the carry-over writes the first time back onto the patient");
});

// ── n. a sent row whose "sent" cannot be written ────────────────────────────────────────────

await seedClinic("CN", fullConfig());
await seedPatient("CN", "PN", clickPatient("CLK_N", NOW - D));
await seedAppointment("CN", "AP_N", "PN");
const evN = await seedEvent("CN", "AP_N", "booked", NOW - H, { patientId: "PN" });

await check("n. Meta took it but the row write keeps failing: it stays locked and is never posted again", async () => {
  const meta = fakeMeta();
  const tries: number[] = [];
  const quiet = console.error;
  console.error = () => {}; // the deliberate failure logs loudly; keep the test output readable
  let run: Awaited<ReturnType<typeof server.processClinicQueue>>;
  try {
    run = await server.processClinicQueue("CN", {
      nowMs: NOW,
      fetchImpl: meta.impl,
      testHooks: {
        beforeSentWrite: (eventId, attempt) => {
          if (eventId !== evN) return;
          tries.push(attempt);
          throw new Error("simulated write failure");
        },
      },
    });
  } finally {
    console.error = quiet;
  }
  assert.equal(meta.calls.length, 1);
  assert.equal(run.sent, 1);
  assert.equal(run.failed, 0, "not handed back as a failure");
  assert.deepEqual(tries, [1, 2, 3], "the write was tried three times");
  const row = await eventDoc("CN", evN);
  assert.equal(row.status, "pending", "the 'sent' write never landed");
  assert.equal(row.sentUnrecorded, true);
  assert.ok(row.lockedUntil > Date.now() + 23 * H, "the lock was stretched, not released");

  // The next cron runs: nothing is claimed, nothing posted.
  const again = fakeMeta();
  const run2 = await server.processClinicQueue("CN", { nowMs: NOW + 10 * MIN, fetchImpl: again.impl });
  assert.equal(run2.examined, 0);
  assert.equal(again.calls.length, 0);

  // A day later the lock lapses: the row is recorded as sent, still without a post.
  const dayLater = fakeMeta();
  const run3 = await server.processClinicQueue("CN", { nowMs: NOW + 25 * H, clock: () => Date.now() + 25 * H, fetchImpl: dayLater.impl });
  assert.equal(run3.examined, 1);
  assert.equal(dayLater.calls.length, 0, "never posted a second time");
  const done = await eventDoc("CN", evN);
  assert.equal(done.status, "sent");
  assert.equal(done.reason, "recorded_late");
  assert.equal(done.sentUnrecorded, undefined);
  assert.equal(done.dueAt, undefined);
  assert.equal(done.lockedUntil, undefined);
});

await check("n. without the stretch, the claim lock alone still keeps the row from being re-posted", async () => {
  // Same failure, and the stretch write fails too (the database is unreachable): the claim lock
  // that came with the claim is left in place, not deleted.
  await seedAppointment("CN", "AP_N2", "PN");
  // A new click, so the lead marker of CLK_N is not what stops it.
  await db.doc("clinics/CN/patients/PN").update({
    adAttribution: { ctwaClid: "CLK_N2", clickedAt: NOW - 30 * MIN, clicks: [{ ctwaClid: "CLK_N2", clickedAt: NOW - 30 * MIN }, { ctwaClid: "CLK_N", clickedAt: NOW - D }] },
  });
  const ev = await seedEvent("CN", "AP_N2", "booked", NOW - 10 * MIN, { patientId: "PN" });
  const ref = server.capiEventsCollection("CN").doc(ev);
  const realUpdate = ref.constructor.prototype.update;
  const meta = fakeMeta();
  const quiet = console.error;
  console.error = () => {};
  // Every update on this one row fails once the send has happened.
  let posted = false;
  ref.constructor.prototype.update = function (this: { path: string }, ...args: unknown[]) {
    if (posted && this.path === ref.path) return Promise.reject(new Error("simulated outage"));
    return realUpdate.apply(this, args);
  };
  try {
    await server.processClinicQueue("CN", {
      nowMs: NOW,
      fetchImpl: (async (url: unknown, init?: RequestInit) => {
        const r = await meta.impl(url as string, init);
        posted = true;
        return r;
      }) as typeof fetch,
    });
  } finally {
    ref.constructor.prototype.update = realUpdate;
    console.error = quiet;
  }
  assert.equal(meta.calls.length, 1);
  const row = await eventDoc("CN", ev);
  assert.equal(row.status, "pending");
  assert.ok(row.lockedUntil > Date.now(), "the claim lock is still there");
  const again = fakeMeta();
  await server.processClinicQueue("CN", { nowMs: NOW, fetchImpl: again.impl });
  assert.equal(again.calls.length, 0, "the next run cannot take it while the lock holds");
  // Settle it so the cron check below finds nothing left to send.
  await server.capiEventsCollection("CN").doc(ev).update({ status: "sent", dueAt: FieldValue.delete(), lockedUntil: FieldValue.delete() });
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
  // Every clinic but CF is switched on.
  assert.equal(body.clinics, CLINICS.length - 1);
  for (const k of ["sent", "retried", "failed", "skipped", "paused"]) assert.equal(typeof body[k], "number", k);
  assert.equal(body.sent, 0, "everything was already settled");
  assert.equal(body.paused, 0, "CG's setup and CH's test code were both finished above");
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
