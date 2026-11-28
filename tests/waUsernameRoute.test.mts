/**
 * Username-only senders through the real Meta webhook, against the emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/waUsernameRoute.test.mts
 *
 * Posts what Meta posts for a person whose number WhatsApp hides (no `from`, only `from_user_id`)
 * and reads back the chat threads: the message is on the Chats page under their WhatsApp name, a
 * patient the clinic already knows by number keeps their one thread, "stop" is honoured, and a
 * reply goes out addressed to the user id rather than to its digits.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-wa-username-route";
const CLINIC = "C1";
const PNID = "106540352242922";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "test-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= PROJECT;

const { adminDb } = await import("../src/lib/firebaseAdmin");
const { NextRequest } = await import("next/server");
const { POST } = await import("../src/app/api/webhooks/meta-whatsapp/route");
const { sendMetaWhatsappText } = await import("../src/lib/metaWhatsapp");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);

async function wipe() {
  const convs = await clinic.collection("whatsapp_conversations").get();
  for (const c of convs.docs) {
    const msgs = await c.ref.collection("messages").get();
    await Promise.all(msgs.docs.map((m) => m.ref.delete()));
    await c.ref.delete();
  }
  for (const name of ["patients", "whatsapp_seen", "messaging_opt_outs"]) {
    const snap = await clinic.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/** One inbound text, in Meta's own layout. `from` and `wa_id` are left out when the number is hidden. */
function inbound(opts: { id: string; body: string; userId: string; phone?: string; name?: string; username?: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: PNID },
              contacts: [
                {
                  profile: { name: opts.name, ...(opts.username ? { username: opts.username } : {}) },
                  ...(opts.phone ? { wa_id: opts.phone } : {}),
                  user_id: opts.userId,
                },
              ],
              messages: [
                {
                  ...(opts.phone ? { from: opts.phone } : {}),
                  from_user_id: opts.userId,
                  id: opts.id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: opts.body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function post(body: unknown) {
  const req = new NextRequest("http://localhost/api/webhooks/meta-whatsapp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  // The reply is composed in `after()`, which needs a live request and has none here. What this
  // test reads — the thread — is written before that point, so a throw from it is not a failure.
  try {
    const res = await POST(req);
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function thread(key: string) {
  const conv = clinic.collection("whatsapp_conversations").doc(key);
  const [parent, msgs] = await Promise.all([conv.get(), conv.collection("messages").orderBy("at", "asc").get()]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines: Record<string, any>[] = msgs.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { exists: parent.exists, parent: (parent.data() || {}) as Record<string, unknown>, lines };
}

function run(name: string) {
  console.log(`✓ ${name}`);
}

await wipe();
await clinic.set({ name: "Test clinic", status: "Active" });
await db.collection("meta_wa_numbers").doc(PNID).set({ clinicId: CLINIC });

const HIDDEN = "EG.13491208655302741918";
const HIDDEN_KEY = "uid_EG_13491208655302741918";

// 1. Meta's documented username-only message: no `from`, no `wa_id`.
{
  await post(inbound({ id: "wamid.A1", body: "عايز احجز كشف", userId: HIDDEN, name: "Sheena Nelson", username: "realsheenanelson" }));
  const { exists, parent, lines } = await thread(HIDDEN_KEY);
  assert.equal(exists, true, "the chat exists — this is the row that never appeared");
  assert.deepEqual(lines.map((l) => [l.direction, l.author, l.text]), [["in", "patient", "عايز احجز كشف"]]);
  assert.equal(parent.phone, HIDDEN, "the id is kept whole: it is the only address a reply can use");
  assert.equal(parent.waUsername, "realsheenanelson");
  assert.equal(parent.waName, "Sheena Nelson");
  assert.equal(parent.channel, "meta");
  assert.equal(parent.unreadCount, 1);
  assert.ok(Number(parent.lastInboundAt) > 0, "their message opens the reply window like anyone's");
  run("a username-only sender lands on the Chats page under their WhatsApp name");
}

// 2. A patient known by number, whose number Meta later stops sending, keeps their one thread.
{
  const KNOWN = "EG.555000111222";
  await clinic.collection("patients").doc("P1").set({ name: "منى سعيد", phone: "+201012345678" });
  await post(inbound({ id: "wamid.B1", body: "مساء الخير", userId: KNOWN, phone: "201012345678", name: "Mona" }));
  const first = await thread("012345678");
  assert.equal(first.lines.length, 1);
  assert.equal(first.parent.waUserId, KNOWN, "the id is filed on the phone thread while the number is still visible");
  assert.equal(first.parent.patientId, "P1");

  await post(inbound({ id: "wamid.B2", body: "ممكن ميعاد بكرة؟", userId: KNOWN, name: "Mona", username: "mona.s" }));
  const again = await thread("012345678");
  assert.deepEqual(again.lines.map((l) => l.text), ["مساء الخير", "ممكن ميعاد بكرة؟"], "same thread, not a nameless second one");
  assert.equal((await thread("uid_EG_555000111222")).exists, false);
  assert.equal(again.parent.patientName, "منى سعيد");
  run("a known patient whose number goes hidden stays in their own thread");
}

// 3. A hidden sender says stop: kept on the conversation, which every sender checks.
{
  const STOPPER = "EG.777000999";
  await post(inbound({ id: "wamid.C1", body: "STOP", userId: STOPPER, name: "Omar", username: "omar_k" }));
  const { parent, lines } = await thread("uid_EG_777000999");
  assert.equal(lines[0]?.text, "STOP", "the request itself is on the thread");
  assert.equal(parent.optedOut, true);
  assert.equal((await clinic.collection("messaging_opt_outs").doc("uid_EG_777000999").get()).exists, true);
  const { whatsappOptOutReason } = await import("../src/lib/messagingConsent");
  assert.equal(await whatsappOptOutReason(CLINIC, STOPPER), "conversation");
  run("a hidden sender's stop is honoured");
}

// 4. A reply is addressed to the user id, verbatim — never to the digits inside it.
{
  const sent: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const cfg = { phoneNumberId: PNID, wabaId: "W", token: "T" } as Parameters<typeof sendMetaWhatsappText>[0]["config"];
    const a = await sendMetaWhatsappText({ config: cfg, to: HIDDEN, text: "أهلاً" });
    const b = await sendMetaWhatsappText({ config: cfg, to: "+201012345678", text: "أهلاً" });
    assert.equal(a.ok && b.ok, true);
    assert.equal(sent[0].recipient, HIDDEN);
    assert.equal("to" in sent[0], false);
    assert.equal(sent[1].to, "201012345678");
    assert.equal("recipient" in sent[1], false);
  } finally {
    globalThis.fetch = realFetch;
  }
  run("a reply goes to `recipient` for a hidden sender and `to` for a phone");
}

await wipe();
console.log("waUsernameRoute: all passed");
process.exit(0);
