/**
 * Patient broadcasts end to end against the Firestore emulator, with a fake WhatsApp gateway.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/broadcastEngine.test.mts
 *
 * Plays the slow release the way the cron will: who makes the list, how many leave per tick, the
 * daily ceiling, clinic hours, stops that arrive mid-broadcast (by text and from the desk), the
 * flood guard, the gateway's backlog, a Cancel pressed while a tick is sending, and a restricted
 * number pausing everything. Nothing is mocked but the gateway, which is a small HTTP server that
 * records what it was asked to send.
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
const gw = {
  state: "open",
  dailyCap: 200,
  sentToday: 0,
  queued: 0,
  sends: [] as { chat_id: string; text: string }[],
  /** Runs before a send is answered — lets the test press Cancel mid-tick. */
  onSend: null as null | (() => Promise<void>),
};
const gateway = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
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
      if (gw.onSend) await gw.onSend();
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
const { broadcastRecipients, buildAudience, createBroadcast, runBroadcastTick, steerBroadcast, BROADCASTS, BroadcastError } = await import("../src/lib/broadcast/server");
const { mergeBroadcast } = await import("../src/lib/broadcast/shared");
const { WHATSAPP_OPT_OUT_FOOTER_AR } = await import("../src/lib/patientMessaging");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);

async function wipe() {
  await db.recursiveDelete(db.doc(`clinics/${CLINIC}`));
  await db.recursiveDelete(db.collection(BROADCASTS));
  await db.recursiveDelete(db.collection("clinic_secrets"));
}
await wipe();

await clinic.set({ name: "Test clinic", status: "Active", features: { whatsappIntegration: true } });
await clinic.collection("settings").doc("whatsapp").set({ optOutFooterEnabled: false, templatePack: "arabic" });
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
// A mother who said stop, and her son on the same phone registered after her: the number is out.
await patient("p23", "Mother", "01044444444", { whatsappOptOut: true });
await patient("p24", "Son", "+201044444444");
for (let i = 7; i <= 22; i++) await patient(`p${String(i).padStart(2, "0")}`, `Patient ${i}`, `0115${String(1000000 + i)}`);

/* ---------------- the list ---------------- */
const audience = await buildAudience(CLINIC);
assert.equal(audience.recipients.length, 17, "p01 + p07..p22");
assert.ok(!audience.recipients.some((r) => r.patientId === "p24"), "a stop on one record covers every record on that number");
assert.equal(audience.excludedOptedOut, 4, "p02, p06, mother and son");
assert.equal(audience.excludedDuplicates, 1);
assert.equal(audience.excludedNoPhone, 2);
assert.equal(audience.recipients[0].patientId, "p01", "the older record keeps a shared number");

/* ---------------- launch rules ---------------- */
const message = `أهلاً أ/ {{first_name}} 🌷
معاك سهيلة من {{clinic_name}}.
افتتحنا فرعنا الجديد في التجمع الخامس.
لو حابب نحجزلك ابعتلنا 1`; // no stop line on purpose — the broadcast must add one

await assert.rejects(
  createBroadcast({ clinicId: CLINIC, uid: "u", userName: "Sohila", name: "x", versions: [message], dailyLimit: 10 }),
  (e: unknown) => e instanceof BroadcastError && /clinic profile has none/.test((e as Error).message),
  "{{clinic_name}} with no clinic name is refused"
);
await clinic.collection("settings").doc("clinic_info").set({ name: "DENT INN" });

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
const row = async (i: number) => (await ref.collection("recipients").doc(String(i).padStart(6, "0")).get()).data()!;

// December: Cairo is UTC+2 all month, so these instants are unambiguous.
const cairo = (day: number, hh: number, mm: number) => new Date(Date.UTC(2026, 11, day, hh - 2, mm));

/* ---------------- a broadcast still being built is never ticked ---------------- */
await ref.update({ status: "building" });
assert.equal((await runBroadcastTick(b.id, cairo(1, 12, 0))).note, "not running or locked");
await ref.update({ status: "running" });

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
assert.ok(
  gw.sends[0].text.endsWith(WHATSAPP_OPT_OUT_FOOTER_AR),
  "the stop line is added even though this clinic switched the general footer off"
);

/* ---------------- the gateway's backlog ---------------- */
gw.queued = 10;
r = await runBroadcastTick(b.id, cairo(1, 10, 10));
assert.equal(r.sent, 0, "the gateway is still holding messages: add none");
gw.queued = 0;

/* ---------------- stops that arrive after launch ---------------- */
// Row 1 (p07): the desk ticks "no WhatsApp" on the profile. Row 2 (p08): the patient is deleted.
await clinic.collection("patients").doc("p07").update({ whatsappOptOut: true });
await clinic.collection("patients").doc("p08").delete();
// Row 3 (p09): the flood guard says this patient has had six automatic messages this hour.
await clinic.collection("whatsapp_conversations").doc("151000009").set({ autoWindowStartedAt: Date.now(), autoSentInWindow: 6 });

/* ---------------- the last tick of the day sends the rest of today's ceiling, no more ---------------- */
r = await runBroadcastTick(b.id, cairo(1, 20, 55));
assert.equal(r.sent, 9, "10 a day, one already sent; skips and deferrals do not count against it");
assert.equal((await row(1)).status, "skipped");
assert.equal((await row(1)).error, "asked to stop");
assert.equal((await row(2)).error, "patient removed");
assert.equal((await row(3)).status, "deferred", "the flood guard puts the patient back in the line, not out of it");
let s = await state();
assert.equal(s.rowCount, 18, "one row appended at the end");
assert.equal(s.sent, 10);
assert.equal(s.sentOnDay, 10);
r = await runBroadcastTick(b.id, cairo(1, 20, 56));
assert.equal(r.sent, 0, "today's ceiling is used");

/* ---------------- a STOP by text between days ---------------- */
const next = (await ref.collection("recipients").doc(String(s.cursor).padStart(6, "0")).get()).data()!;
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

/* ---------------- day two finishes it, including the deferred patient ---------------- */
await clinic.collection("whatsapp_conversations").doc("151000009").delete();
r = await runBroadcastTick(b.id, cairo(2, 20, 55));
s = await state();
assert.equal(s.status, "done", r.note);
assert.equal(s.skipped, 3, "desk stop, removed patient, text stop");
assert.equal(s.sent, 14, "17 patients less those three");
assert.ok(gw.sends.some((x) => x.chat_id === "201151000009@c.us"), "the deferred patient got it at the end");
assert.equal(new Set(gw.sends.map((x) => x.chat_id)).size, gw.sends.length, "nobody twice");

/* ---------------- the patients list ---------------- */
const list = await broadcastRecipients(CLINIC, b.id);
assert.equal(list.length, 17, "every patient once — the deferred row's first copy is hidden");
assert.equal(list.filter((x) => x.state === "sent").length, 14);
assert.equal(list.filter((x) => x.state === "not_sent").length, 3);
assert.equal(list.filter((x) => x.state === "waiting").length, 0);
assert.ok(list.filter((x) => x.state === "sent").every((x) => typeof x.sentAt === "number" && x.sentAt > 0), "every sent row has its time");
assert.deepEqual(
  list.filter((x) => x.state === "not_sent").map((x) => x.reason).sort(),
  ["asked to stop", "asked to stop", "patient removed"]
);
await assert.rejects(broadcastRecipients("OTHER", b.id), BroadcastError, "another clinic cannot list it");

/* ---------------- Cancel pressed while a tick is sending ---------------- */
const c = await createBroadcast({ clinicId: CLINIC, uid: "u", userName: "Sohila", name: "Again", versions: [message], dailyLimit: 150 });
const cref = db.collection(BROADCASTS).doc(c.id);
gw.sentToday = 0;
const before = gw.sends.length;
gw.onSend = async () => {
  gw.onSend = null;
  await steerBroadcast(CLINIC, c.id, "cancel");
};
r = await runBroadcastTick(c.id, cairo(3, 20, 55));
const cs = (await cref.get()).data()!;
assert.equal(cs.status, "cancelled", "the tick did not overwrite the cancel");
assert.equal(gw.sends.length - before, 1, "nothing more left after the cancel");
assert.equal(cs.sent, 1, "the one that went out is counted");
assert.equal(cs.tickLockUntil, 0);
const clist = await broadcastRecipients(CLINIC, c.id);
assert.equal(clist.filter((x) => x.state === "sent").length, 1);
assert.equal(clist.filter((x) => x.state === "waiting").length, clist.length - 1, "the rest are listed as never reached");

/* ---------------- greetings ---------------- */
const footer = WHATSAPP_OPT_OUT_FOOTER_AR;
assert.equal(mergeBroadcast("أهلاً أ/ {{first_name}} 🌷\nابعت STOP", { name: "", clinicName: "X", footer }), "أهلاً 🌷\nابعت STOP", "no name: no empty title");
assert.equal(mergeBroadcast("أهلاً أ/ {{first_name}} 🌷\nابعت STOP", { name: "منى", clinicName: "X", footer }), "أهلاً أ/ منى 🌷\nابعت STOP");

/* ---------------- tenancy ---------------- */
await assert.rejects(steerBroadcast("OTHER", b.id, "pause"), BroadcastError, "another clinic cannot touch it");

await wipe();
gateway.close();
console.log("broadcast engine tests passed");
process.exit(0);
