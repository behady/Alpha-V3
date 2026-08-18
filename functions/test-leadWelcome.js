/**
 * Offline checks for the lead auto-reply — run with `node test-leadWelcome.js`.
 *
 * No Firebase, no network. What matters here is who gets messaged and who does not: this is the
 * one part of the system that talks to strangers, so the rules that keep it quiet (off by default,
 * once per lead, never without a phone) are pinned rather than trusted.
 */
const assert = require("node:assert");
const { sendLeadWelcome } = require("./leadWelcome");

/** Minimal stand-in for the Firestore surface leadWelcome touches. */
function fakeDb(docs, { gatewayOk = true } = {}) {
  const store = new Map(Object.entries(docs));
  const sent = [];
  const db = {
    store,
    sent,
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
  global.__lastSend = { url, chatId: body.chat_id, message: body.message };
  return global.__gatewayOk
    ? { ok: true, status: 200, text: async () => "ok" }
    : { ok: false, status: 500, text: async () => "gateway down" };
};

const CLINIC = "c1";
const LEAD_PATH = `clinics/${CLINIC}/leads/meta_L1`;
const lead = { docId: "meta_L1", name: "Mona Adel" };

const baseDocs = () => ({
  [LEAD_PATH]: { name: "Mona Adel", phone: "+201000000900", stage: "new" },
  [`clinics/${CLINIC}/settings/clinicProfile`]: { name: "Alpha Dental" },
});

(async () => {
  // --- off by default: a clinic that never asked for this must message nobody
  {
    const db = fakeDb({ ...baseDocs(), [`clinics/${CLINIC}/settings/whatsapp`]: {} });
    assert.equal(await sendLeadWelcome(db, CLINIC, lead), null);
    assert.equal(db.store.get(LEAD_PATH).welcomeMessage, undefined);
  }

  // --- no phone: nothing to send to, and no record pretending otherwise
  {
    const db = fakeDb({
      ...baseDocs(),
      [LEAD_PATH]: { name: "Pending lead", phone: "", stage: "new" },
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true },
    });
    assert.equal(await sendLeadWelcome(db, CLINIC, lead), null);
  }

  // --- manual mode: queued for a human, with the clinic's name filled in
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "manual" },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead);
    assert.equal(result.status, "queued");
    assert.equal(result.mode, "manual");
    const queued = db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`);
    assert.equal(queued.to, "+201000000900");
    assert.equal(queued.type, "lead_welcome");
    assert.equal(queued.status, "queued");
    assert.ok(queued.text.includes("Mona Adel"), "the greeting uses their name");
    assert.ok(queued.text.includes("Alpha Dental"), "the greeting names the clinic");
    assert.ok(!queued.text.includes("{{"), "no placeholder may survive into a sent message");
  }

  // --- auto mode with a working gateway: sent, not queued
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
      [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", token: "tok1" } },
    });
    const result = await sendLeadWelcome(db, CLINIC, lead);
    assert.equal(result.status, "sent");
    assert.equal(result.mode, "auto");
    assert.equal(global.__lastSend.chatId, "201000000900@c.us");
    assert.equal(db.store.get(`clinics/${CLINIC}/whatsapp_outbox/lead_meta_L1`), undefined);
  }

  // --- auto mode when the gateway fails: falls back to the queue rather than losing the reply
  {
    const db = fakeDb(
      {
        ...baseDocs(),
        [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "auto" },
        [`clinic_secrets/${CLINIC}`]: { wapilot: { instanceId: "inst1", token: "tok1" } },
      },
      { gatewayOk: false }
    );
    const result = await sendLeadWelcome(db, CLINIC, lead);
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
    const result = await sendLeadWelcome(db, CLINIC, lead);
    assert.equal(result.status, "queued");
  }

  // --- never twice: replayed events and retries must not greet the same person again
  {
    const db = fakeDb({
      ...baseDocs(),
      [`clinics/${CLINIC}/settings/whatsapp`]: { isLeadAutoReplyEnabled: true, deliveryMode: "manual" },
    });
    assert.ok(await sendLeadWelcome(db, CLINIC, lead));
    assert.equal(await sendLeadWelcome(db, CLINIC, lead), null, "a second attempt does nothing");
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
    assert.equal(await sendLeadWelcome(db, CLINIC, lead), null);
  }

  global.fetch = realFetch;
  console.log("leadWelcome: all checks passed");
})();
