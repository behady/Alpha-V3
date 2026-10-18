/**
 * Patient broadcasts end to end against the Firestore emulator, with a fake WhatsApp gateway.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/broadcastEngine.test.mts
 *
 * Plays the slow release the way the cron will: who makes the list, how many leave per tick, the
 * daily ceiling, clinic hours, a STOP that arrives mid-broadcast, the gateway's backlog, and a
 * restricted number pausing everything. Nothing is mocked but the gateway, which is a small HTTP
 * server that records what it was asked to send.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-broadcast";
const CLINIC = "C1";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/* ---------------- the fake gateway ---------------- */
const gw = { state: "open", dailyCap: 200, sentToday: 0, queued: 0, sends: [] as { chat_id: string; text: string }[] };
const gateway = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === `/admin/instances/clinic_${CLINIC}`) {
      res.end(
        JSON.stringify({
          ok: true,
          instanceId: `clinic_${CLINIC}`,
          state: gw.state,
          phone: "201000000000",
          connectedAt: Date.now() - 30 * 86_400_000,
          sending: { windowOpen: true, window: "10-22", nextOpenAt: null, queued: gw.queued, waiting: 0, dailyCap: gw.dailyCap, sentToday: gw.sentToday },
        })
      );
      return;
    }
    if (req.method === "POST" && req.url === `/api/v2/clinic_${CLINIC}/send-message`) {
      const parsed = JSON.parse(body || "{}");
      gw.sends.push({ chat_id: parsed.chat_id, text: parsed.text });
      gw.sentToday += 1;
      res.end(JSON.stringify({ ok: true, id: `m${gw.sends.length}` }));
      return;
    }
    res.end("{}");
  });
});
await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
const GW = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;

process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.ALPHA_WA_GATEWAY_URL = GW;
process.env.ALPHA_WA_GATEWAY_ADMIN_KEY = "admin-key";
// Something down the delivery path imports the browser SDK module, which insists on these.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "test-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= PROJECT;

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { buildAudience, createBroadcast, mergeBroadcast, runBroadcastTick, steerBroadcast, BROADCASTS, BroadcastError } = await import("../src/lib/broadcast/server");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);

async function wipe() {
  const paths = [`clinics/${CLINIC}`, BROADCASTS, "clinic_secrets"];
  for (const p of paths) await db.recursiveDelete(p.includes("/") ? db.doc(p) : db.collection(p));
}
await wipe();

await clinic.set({ name: "Test clinic", status: "Active", features: { whatsappIntegration: true } });
await clinic.collection("settings").doc("clinic_info").set({ name: "DENT INN" });
await db.collection("clinic_secrets").doc(CLINIC).set({
  wapilot: { instanceId: `clinic_${CLINIC}`, apiToken: "tok", apiBaseUrl: `${GW}/api/v2`, provider: "alpha" },
});

let order = 0;
const patient = (id: string, name: string, phone: string, extra: Record<string, unknown> = {}) =>
  clinic.collection("patients").doc(id).set({ name, phone, createdAt: 1_700_000_000_000 + order++ * 1000, ...extra });

await patient("p01", "عبد الله محمد", "01011111111");
await patient("p02", "Mona Adel", "01022222222", { whatsappOptOut: true }); // asked to stop
await patient("p03", "Child of p01", "+201011111111"); // same number as p01, registered later
await patient("p04", "Landline", "0222907666"); // no WhatsApp on a landline
await patient("p05", "No phone", "");
await patient("p06", "Stranger stop", "01033333333"); // stop list, by number
await clinic.collection("messaging_opt_outs").doc("201033333333").set({ at: 1 });
for (let i = 7; i <= 22; i++) await patient(`p${String(i).padStart(2, "0")}`, `Patient ${i}`, `0115${String(1000000 + i)}`);

/* ---------------- the list ---------------- */
const audience = await buildAudience(CLINIC);
assert.equal(audience.recipients.length, 17, "p01 + p07..p22");
assert.equal(audience.excludedOptedOut, 2);
assert.equal(audience.excludedDuplicates, 1);
assert.equal(audience.excludedNoPhone, 2);
assert.equal(audience.recipients[0].patientId, "p01", "the older record keeps a shared number");

/* ---------------- launch ---------------- */
const message = `أهلاً أ/ {{first_name}} 🌷
معاك سهيلة من {{clinic_name}}.
افتتحنا فرعنا الجديد في التجمع الخامس.
لو حابب نحجزلك ابعتلنا 1
لو مش حابب توصلك رسايل مننا تاني ابعت STOP`;

await assert.rejects(
  createBroadcast({ clinicId: CLINIC, uid: "u", userName: "Sohila", name: "x", versions: ["See https://x.com {{first_name}}"], dailyLimit: 10 }),
  BroadcastError,
  "a link is refused at launch, not only on screen"
);

const b = await createBroadcast({ clinicId: CLINIC, uid: "u", userName: "Sohila", name: "Branch", versions: [message], dailyLimit: 10 });
assert.equal(b.total, 17);
assert.equal(b.status, "running");
await assert.rejects(
  createBroadcast({ clinicId: CLINIC, uid: "u", userName: "Sohila", name: "Second", versions: [message], dailyLimit: 10 }),
  BroadcastError,
  "only one broadcast at a time"
);

const ref = db.collection(BROADCASTS).doc(b.id);
const state = async () => (await ref.get()).data()!;

// December: Cairo is UTC+2 all month, so these instants are unambiguous.
const cairo = (day: number, hh: number, mm: number) => new Date(Date.UTC(2026, 11, day, hh - 2, mm));

/* ---------------- clinic hours ---------------- */
let r = await runBroadcastTick(b.id, cairo(1, 8, 0));
assert.equal(r.sent, 0, "08:00 is before clinic hours");
r = await runBroadcastTick(b.id, cairo(1, 21, 30));
assert.equal(r.sent, 0, "21:30 is after the broadcast window");
assert.equal(gw.sends.length, 0);

/* ---------------- spreading the day ---------------- */
r = await runBroadcastTick(b.id, cairo(1, 10, 0));
assert.equal(r.sent, 1, "at opening, 10 a day over 66 ticks is one per tick");
assert.equal(gw.sends[0].chat_id, "201011111111@c.us");
assert.ok(gw.sends[0].text.startsWith("أهلاً أ/ عبد الله 🌷"), gw.sends[0].text);
assert.ok(gw.sends[0].text.includes("معاك سهيلة من DENT INN."), "clinic name from the profile");
assert.equal(gw.sends[0].text.match(/STOP|إيقاف/g)?.length, 1, "the clinic's own stop line, no second footer");

/* ---------------- the gateway's backlog ---------------- */
gw.queued = 10;
r = await runBroadcastTick(b.id, cairo(1, 10, 10));
assert.equal(r.sent, 0, "the gateway is still holding messages: add none");
gw.queued = 0;

/* ---------------- the last tick of the day sends the rest of today's ceiling, no more ---------------- */
r = await runBroadcastTick(b.id, cairo(1, 20, 55));
assert.equal(r.sent, 9, "10 a day, one already sent");
r = await runBroadcastTick(b.id, cairo(1, 20, 56));
assert.equal(r.sent, 0, "today's ceiling is used");
let s = await state();
assert.equal(s.sent, 10);
assert.equal(s.cursor, 10);

/* ---------------- a STOP between days is honoured ---------------- */
const next = (await ref.collection("recipients").doc("000010").get()).data()!;
await clinic.collection("messaging_opt_outs").doc(String(next.phone).replace(/\D/g, "")).set({ at: 2 });

/* ---------------- a restricted number pauses everything ---------------- */
gw.state = "restricted";
gw.sentToday = 0;
r = await runBroadcastTick(b.id, cairo(2, 12, 0));
assert.equal(r.sent, 0);
s = await state();
assert.equal(s.status, "paused");
assert.equal(s.pausedReason, "restricted");
await assert.rejects(steerBroadcast(CLINIC, b.id, "resume"), BroadcastError, "cannot resume a restricted line");

gw.state = "open";
await steerBroadcast(CLINIC, b.id, "resume");

/* ---------------- day two finishes it ---------------- */
r = await runBroadcastTick(b.id, cairo(2, 20, 55));
s = await state();
assert.equal(s.skipped, 1, "the patient who said STOP overnight");
assert.equal(s.sent, 16, "everyone else");
assert.equal(s.status, "done");
assert.equal(gw.sends.length, 16);
assert.equal(new Set(gw.sends.map((x) => x.chat_id)).size, 16, "nobody twice");

/* ---------------- greetings ---------------- */
assert.equal(mergeBroadcast("أهلاً أ/ {{first_name}} 🌷", { name: "", clinicName: "X" }), "أهلاً 🌷", "no name: no empty title");
assert.equal(mergeBroadcast("أهلاً أ/ {{first_name}} 🌷", { name: "منى", clinicName: "X" }), "أهلاً أ/ منى 🌷");

/* ---------------- tenancy ---------------- */
await assert.rejects(steerBroadcast("OTHER", b.id, "pause"), BroadcastError, "another clinic cannot touch it");

await wipe();
gateway.close();
console.log("broadcast engine tests passed");
process.exit(0);
