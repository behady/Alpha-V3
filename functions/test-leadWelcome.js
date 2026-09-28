/**
 * Offline checks for the lead auto-reply — run with `node test-leadWelcome.js`.
 *
 * No Firebase, no network. What matters here is who gets messaged and who does not: this is the
 * one part of the system that talks to strangers, so the rules that keep it quiet (off by default,
 * once per lead, never without a phone, never to someone who said stop, never at night through a
 * gateway that cannot wait, never from the shared platform number) are pinned rather than trusted.
 */
const assert = require("node:assert");
const { sendLeadWelcome, withOptOutFooter, insideSendWindow } = require("./leadWelcome");

/** Minimal stand-in for the Firestore surface leadWelcome touches. */
function fakeDb(docs, { gatewayOk = true } = {}) {
  const store = new Map(Object.entries(docs));
  const sent = [];
  // `where("phone", "==", x)` over a collection path: the one query the module makes.
  const collection = (path) => ({
    where: (field, _op, value) => ({
      limit: () => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([p, d]) => p.startsWith(`${path}/`) && p.slice(path.length + 1).indexOf("/") === -1 && d[field] === value)
            .map(([p, d]) => ({ id: p.split("/").pop(), data: () => d }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
    get: async () => {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${path}/`) && p.slice(path.length + 1).indexOf("/") === -1)
        .map(([p, d]) => ({ id: p.split("/").pop(), data: () => d }));
      return { empty: docs.length === 0, docs };
    },
  });
  const db = {
    store,
    sent,
    collection,
    doc: (path) => ({
      path,
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
      set: async (data, opts) => {
        const prev = opts && opts.merge ? store.get(path) || {} : {};
        store.set(path, { ...prev, ...data });
      },
    }),
  };
  global.__gatewayOk = gatewayOk;
  return db;
}

// The gateway call is the only network in this module; stub fetch and record what would go out.
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  global.__lastSend = { url, chatId: body.chat_id, message: body.message, text: body.text };
  return global.__gatewayOk
    ? { ok: true, status: 200, text: async () => "ok" }
    : { ok: false, status: 500, text: async () => "gateway down" };
};

const CLINIC = "c1";
const LEAD_PATH = `clinics/${CLINIC}/leads/meta_L1`;
const lead = { docId: "meta_L1", name: "Mona Adel" };

/** Fixed clocks, so the clinic-hours rule is what is tested rather than the time the test runs. */
const NOON_CAIRO = new Date("2026-09-28T09:00:00Z"); // 12:00 in Cairo (UTC+3 in September)
const ONE_AM_CAIRO = new Date("2026-09-28T22:00:00Z"); // 01:00 the next day in Cairo
const DAY = { now: NOON_CAIRO };

const baseDocs = () => ({
  [LEAD_PATH]: { name: "Mona Adel", phone: "+201000000900", stage: "new" },
  [`clinics/${CLINIC}/settings/clinicProfile`]: { name: "Alpha Dental" },
});

(async () => {
  // --- off by default: a clinic that never asked for this must message nobody
  {
    const db = fakeDb({ ...baseDocs(), [`clinics/${CLINIC}/settings/whatsapp`]: {} });
    assert.equal(await sendLeadWelcome(db, CLINIC, lead, DAY), null);
    assert.equal(db.store.get(LEAD_PATH).welcomeMessage, undefined);
  }

  // --- no phone: nothing to send to, and no record pretending otherwise
  {
    const db = fakeDb({
      ...baseDocs(),
      [LEAD_PATH]: { name: "Pending lead", phone: "", stage: "new" },
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true },
    });
    assert.equal(await sendLeadWelcome(db, CLINIC, lead, DAY), null);
  }

  // --- manual mode: queued for a human, with the clinic's name filled in and the stop line on
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "manual" },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "queued");
    assert.equal(result.mode, "manual");
    const queued = db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`);
    assert.equal(queued.to, "+201000000900");
    assert.equal(queued.type, "lead_welcome");
    assert.equal(queued.status, "queued");
    assert.ok(queued.text.includes("Mona Adel"), "the greeting uses their name");
    assert.ok(queued.text.includes("Alpha Dental"), "the greeting names the clinic");
    assert.ok(!queued.text.includes("{{"), "no placeholder may survive into a sent message");
    assert.ok(queued.text.includes("إيقاف"), "the opt-out footer is on the greeting");
  }

  // --- auto mode with a working gateway: sent, not queued
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", apiToken: "tok1" } },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "sent");
    assert.equal(result.mode, "auto");
    assert.equal(global.__lastSend.chatId, "201000000900@c.us");
    assert.ok(global.__lastSend.text.includes("إيقاف"), "the sent text carries the opt-out footer");
    assert.equal(db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`), undefined);
  }

  // --- THE ONE THAT MATTERS: the field name the app actually stores
  // This test used to seed `token`, which nothing writes — so it passed for months while every
  // real clinic fell through to the manual queue with its credentials filled in and auto selected.
  // Eight live ad leads sat unanswered before anyone noticed. Both spellings are pinned.
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", apiToken: "tok1", apiBaseUrl: "https://api.example.test/v2" } },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "sent", "apiToken is the name the app saves — it must be read");
    assert.equal(result.mode, "auto");
  }
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", token: "legacy" } },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "sent", "the legacy spelling must keep working for hand-written records");
  }

  // --- auto mode when the gateway fails: falls back to the queue rather than losing the reply
  {
    const db = fakeDb(
      {
        ...baseDocs(),
        [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
        [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", apiToken: "tok1" } },
      },
      { gatewayOk: false }
    );
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "queued");
    assert.ok(result.error, "the failure is recorded, not hidden");
    assert.ok(db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`), "a human can still send it");
  }

  // --- auto mode with no gateway configured: quietly becomes the manual queue
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "queued");
  }

  // --- NEVER from the shared platform number: WAPILOT_* env vars no longer stand in for a clinic
  {
    process.env.WAPILOT_INSTANCE_ID = "platform-inst";
    process.env.WAPILOT_API_TOKEN = "platform-token";
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
    });
    global.__lastSend = null;
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "queued", "no clinic number means the human queue, not the platform line");
    assert.equal(global.__lastSend, null, "nothing left through the shared number");
    delete process.env.WAPILOT_INSTANCE_ID;
    delete process.env.WAPILOT_API_TOKEN;
  }

  // --- a number that said STOP is not greeted — from any of the three places a stop can land
  for (const [label, extra] of [
    ["stranger list", { [`clinics/${CLINIC}/messaging_opt_outs/201000000900`]: { phone: "+201000000900" } }],
    // Conversations are filed under the last nine digits (src/lib/patientPhone.ts phoneMatchKey).
    ["conversation flag", { [`clinics/${CLINIC}/whatsapp_conversations/000000900`]: { optedOut: true } }],
    ["patient record", { [`clinics/${CLINIC}/patients/p1`]: { phone: "+201000000900", whatsappOptOut: true } }],
  ]) {
    const db = fakeDb({
      ...baseDocs(),
      ...extra,
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", apiToken: "tok1" } },
    });
    global.__lastSend = null;
    const result = await sendLeadWelcome(db, CLINIC, lead, DAY);
    assert.equal(result.status, "skipped", `${label}: skipped`);
    assert.ok(String(result.reason).startsWith("opted_out"), `${label}: the reason says why`);
    assert.equal(global.__lastSend, null, `${label}: nothing sent`);
    assert.equal(db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`), undefined, `${label}: nothing queued either`);
    assert.equal(await sendLeadWelcome(db, CLINIC, lead, DAY), null, `${label}: and never retried`);
  }

  // --- at night a third-party gateway waits for a person; Alpha's own gateway holds it itself
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", apiToken: "tok1" } },
    });
    global.__lastSend = null;
    const result = await sendLeadWelcome(db, CLINIC, lead, { now: ONE_AM_CAIRO });
    assert.equal(result.status, "queued");
    assert.equal(result.reason, "outside_hours");
    assert.equal(global.__lastSend, null, "Wapilot is not asked to message a stranger at 1 a.m.");
    assert.ok(db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`), "reception sends it in the morning");
  }
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "clinic_c1", apiToken: "tok1", apiBaseUrl: "https://wa.alphadental.app/api/v2", provider: "alpha" } },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead, { now: ONE_AM_CAIRO });
    assert.equal(result.status, "sent", "our gateway takes it now and holds it for 10:00 itself");
  }

  // --- never twice: replayed events and retries must not greet the same person again
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "manual" },
    });
    assert.ok(await sendLeadWelcome(db, CLINIC, lead, DAY));
    assert.equal(await sendLeadWelcome(db, CLINIC, lead, DAY), null, "a second attempt does nothing");
  }

  // --- a template the clinic switched off means silence, even with the feature on
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: {
        isLeadAutoReplyEnabled: true,
        templates: [{ type: "lead_welcome", isActive: false, message: "hi" }],
      },
    });
    assert.equal(await sendLeadWelcome(db, CLINIC, lead, DAY), null);
  }

  // --- the footer: on by default, Arabic-only when the templates are, off when switched off, never twice
  assert.ok(withOptOutFooter("hello", {}).includes("To stop, reply: STOP"));
  assert.ok(!withOptOutFooter("hello", { templatePack: "arabic" }).includes("STOP"));
  assert.equal(withOptOutFooter("hello", { optOutFooterEnabled: false }), "hello");
  const once = withOptOutFooter("hello", {});
  assert.equal(withOptOutFooter(once, {}), once, "a body that already says how to stop is left alone");

  // --- the clock: 10:00–22:00 Cairo, whatever the server's zone
  assert.equal(insideSendWindow(NOON_CAIRO), true);
  assert.equal(insideSendWindow(ONE_AM_CAIRO), false);
  assert.equal(insideSendWindow(new Date("2026-09-28T07:00:00Z")), true, "10:00 Cairo opens");
  assert.equal(insideSendWindow(new Date("2026-09-28T19:00:00Z")), false, "22:00 Cairo closes");

  global.fetch = realFetch;
  console.log("leadWelcome: all checks passed");
})();
