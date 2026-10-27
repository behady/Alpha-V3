/**
 * Old chats and phone-typed messages through the real inbound webhook, against the emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/threadHistoryRoute.test.mts
 *
 * Posts what the QR gateway posts and reads back the chat threads: old messages filed in order,
 * nothing doubled, nothing unread, no reply, and a message typed on the clinic's phone landing as
 * the team's with the bot stepping aside.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-thread-history-route";
const CLINIC = "C1";
const TOKEN = "test-inbound-token";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.WHATSAPP_INBOUND_TOKEN = TOKEN;
// Something in the bot's import graph loads the browser SDK, which refuses to start unconfigured.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "test-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= PROJECT;

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { NextRequest } = await import("next/server");
const { POST } = await import("../src/app/api/webhooks/whatsapp-inbound/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);

async function wipe() {
  const convs = await clinic.collection("whatsapp_conversations").get();
  for (const c of convs.docs) {
    const msgs = await c.ref.collection("messages").get();
    await Promise.all(msgs.docs.map((m) => m.ref.delete()));
    await c.ref.delete();
  }
  const pats = await clinic.collection("patients").get();
  await Promise.all(pats.docs.map((p) => p.ref.delete()));
}

async function post(body: unknown) {
  const req = new NextRequest(`http://localhost/api/webhooks/whatsapp-inbound?clinicId=${CLINIC}&token=${TOKEN}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req);
  return (await res.json()) as Record<string, unknown>;
}

async function thread(key: string) {
  const conv = clinic.collection("whatsapp_conversations").doc(key);
  const [parent, msgs] = await Promise.all([conv.get(), conv.collection("messages").orderBy("at", "asc").get()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: Record<string, any>[] = msgs.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { parent: (parent.data() || {}) as Record<string, unknown>, lines };
}

function run(name: string) {
  console.log(`✓ ${name}`);
}

await wipe();
await clinic.set({ name: "Test clinic", status: "Active" });
await clinic.collection("patients").doc("P1").set({ name: "سارة علي", phone: "+201012345678" });

const T = Math.floor(Date.now() / 1000) - 30 * 86400; // a month ago, in seconds
const history = (messages: unknown[]) => ({ event: "messages.history", session: "clinic_C1", payload: { source: "sync_2", messages } });

// 1. A history batch: three messages in one chat, out of order, one repeated.
{
  const r = await post(
    history([
      { id: "H2", from: "201012345678@c.us", fromMe: true, body: "اهلا بحضرتك، الكشف 300", type: "chat", timestamp: T + 60 },
      { id: "H1", from: "201012345678@c.us", fromMe: false, body: "بكام الكشف؟", type: "chat", timestamp: T },
      { id: "H3", from: "201012345678@c.us", fromMe: false, body: "", type: "audio", timestamp: T + 120 },
      { id: "H1", from: "201012345678@c.us", fromMe: false, body: "بكام الكشف؟", type: "chat", timestamp: T },
    ])
  );
  assert.equal(r.history, 3);
  const { parent, lines } = await thread("012345678");
  assert.deepEqual(
    lines.map((l) => [l.direction, l.author, l.text]),
    [
      ["in", "patient", "بكام الكشف؟"],
      ["out", "staff", "اهلا بحضرتك، الكشف 300"],
      ["in", "patient", "[audio]"],
    ]
  );
  assert.equal(lines[0].at, T * 1000);
  assert.equal(lines[1].kind, "from_phone");
  assert.equal(parent.unreadCount, undefined, "old messages are not news");
  assert.equal(parent.lastInboundAt, undefined, "old messages do not open a reply window");
  assert.equal(parent.lastText, "[audio]");
  assert.equal(parent.patientId, "P1", "the chat is named after the patient with that number");
  assert.equal(parent.patientName, "سارة علي");
  run("old chats are filed in order, once, unread untouched, named after the patient");
}

// 2. The same batch again (WhatsApp resends history on a relink) adds nothing.
{
  const r = await post(history([{ id: "H1", from: "201012345678@c.us", fromMe: false, body: "بكام الكشف؟", type: "chat", timestamp: T }]));
  assert.equal(r.history, 0);
  assert.equal((await thread("012345678")).lines.length, 3);
  run("a resent copy adds nothing");
}

// 3. A system send already on the thread under its gateway id is not doubled by the copy.
{
  const conv = clinic.collection("whatsapp_conversations").doc("099999999");
  await conv.set({ phone: "+201099999999", lastAt: (T + 500) * 1000, lastText: "تم تأكيد حجزك" });
  await conv.collection("messages").add({ direction: "out", author: "system", text: "تم تأكيد حجزك", at: (T + 500) * 1000, waMessageId: "SYS1" });
  // …nor a patient message received live, which carries no id.
  await conv.collection("messages").add({ direction: "in", author: "patient", text: "شكرا", at: (T + 530) * 1000 });
  const r = await post(
    history([
      { id: "SYS1", from: "201099999999@c.us", fromMe: true, body: "تم تأكيد حجزك", type: "chat", timestamp: T + 501 },
      { id: "LIVE1", from: "201099999999@c.us", fromMe: false, body: "شكرا", type: "chat", timestamp: T + 529 },
      { id: "OLD0", from: "201099999999@c.us", fromMe: false, body: "عايز احجز", type: "chat", timestamp: T + 10 },
    ])
  );
  assert.equal(r.history, 1);
  const { parent, lines } = await thread("099999999");
  assert.equal(lines.length, 3);
  assert.equal(lines[0].text, "عايز احجز");
  assert.equal(parent.lastText, "تم تأكيد حجزك", "an older line never replaces the newer preview");
  run("system sends and live messages already on the thread are not doubled; old lines do not move the preview");
}

// 4. A message typed on the clinic's phone, live, as the gateway posts it.
{
  const now = Math.floor(Date.now() / 1000);
  const r = await post({
    event: "message",
    session: "clinic_C1",
    payload: {
      id: "PH1",
      from: "201012345678@c.us",
      to: "201012345678@c.us",
      fromMe: true,
      body: "تمام يا فندم، مستنينك بكرة",
      type: "chat",
      timestamp: now,
      _data: { chatId: "201012345678@c.us" },
    },
  });
  assert.equal(r.phoneSent, true);
  const { parent, lines } = await thread("012345678");
  const last = lines[lines.length - 1];
  assert.equal(last.text, "تمام يا فندم، مستنينك بكرة");
  assert.equal(last.author, "staff");
  assert.equal(last.direction, "out");
  assert.equal(last.kind, "from_phone");
  assert.equal(parent.lastText, "تمام يا فندم، مستنينك بكرة");
  assert.equal(typeof parent.humanActiveAtMs, "number", "the bot steps aside after a person replies");
  assert.equal(parent.needsHuman, false);
  // The same echo twice (gateway retry) is one line.
  await post({
    event: "message",
    payload: { id: "PH1", from: "201012345678@c.us", fromMe: true, body: "تمام يا فندم، مستنينك بكرة", type: "chat", timestamp: now, _data: { chatId: "201012345678@c.us" } },
  });
  assert.equal((await thread("012345678")).lines.length, lines.length);
  run("a message typed on the clinic's phone shows as the team's, once, and pauses the bot");
}

// 5. Another gateway's echo of the system's own send (no `_data.chatId`) is still not filed.
{
  const before = (await thread("012345678")).lines.length;
  await post({ event: "message", payload: { id: "true_201012345678@c.us_X", from: "201012345678@c.us", fromMe: true, body: "رسالة من النظام", timestamp: Math.floor(Date.now() / 1000) } });
  assert.equal((await thread("012345678")).lines.length, before);
  run("other gateways' echoes are left alone");
}

// 6. A patient writing live is now recorded with its id, so a later copy recognises it.
{
  const now = Math.floor(Date.now() / 1000);
  await post({ event: "message", payload: { id: "LIVE9", from: "201055555555@c.us", fromMe: false, body: "مساء الخير", type: "chat", timestamp: now, _data: { chatId: "201055555555@c.us" } } });
  const { lines } = await thread("055555555");
  assert.equal(lines[0]?.messageId, "LIVE9");
  run("live patient messages keep WhatsApp's id");
}

// 7. Staff chats stay out of the inbox, history included.
{
  await clinic.collection("settings").doc("whatsapp").set({ ownerNumber: "+201077777777" }, { merge: true });
  await clinic.set({ ownerId: "owner-1" }, { merge: true });
  const r = await post(history([{ id: "ST1", from: "201077777777@c.us", fromMe: true, body: "التقرير؟", type: "chat", timestamp: T }]));
  assert.equal(r.history, 0);
  run("chats with the clinic's own staff are not filed");
}

console.log("all thread-history route checks passed");
process.exit(0);
