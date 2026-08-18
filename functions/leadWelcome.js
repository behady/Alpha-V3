/**
 * The first message a new lead gets — sent while they are still holding the phone.
 *
 * An ad lead goes cold fast: the same person is usually filling three clinics' forms in one
 * sitting, and the clinic that answers first tends to win. Reception cannot beat that at 11pm,
 * so the system answers for them.
 *
 * Two ways out, and the clinic manager picks (Settings → WhatsApp):
 *   auto    — the gateway sends it unattended, seconds after the lead lands.
 *   manual  — the message is written and queued; a person taps send from the phone's queue.
 *
 * Manual is not a degraded mode. Automating an ordinary WhatsApp account is how a clinic's
 * number gets restricted, and for a clinic that means losing contact with its own patients.
 * That reasoning is already written down in src/types/whatsapp.ts; this reuses the decision
 * rather than inventing a second one.
 *
 * Whatever happens the reply is never silently dropped: a gateway that fails, or was never
 * configured, falls back to the queue so a human still sees it waiting.
 */

const { FieldValue } = require("firebase-admin/firestore");
const { mergeWhatsappTemplate, resolveWhatsappTemplate } = require("./whatsappMessageDefaults");
const { normalizeToInternationalDigits } = require("./wapilotClient");

const DEFAULT_API_ROOT = "https://api.wapilot.net/api/v2";
const DEFAULT_SEND_PATH = "/{instanceId}/send-message";

/**
 * This clinic's own WhatsApp number first, then the shared platform number — the same
 * resolution order as src/lib/wapilotConfig.ts, whose comment explains why per-clinic
 * credentials had to exist at all.
 */
async function loadWapilotConfig(db, clinicId) {
  const pick = (data) => {
    if (!data || typeof data !== "object") return null;
    const instanceId = String(data.instanceId || "").trim();
    const token = String(data.token || data.accessToken || "").trim();
    if (!instanceId || !token) return null;
    return {
      instanceId,
      token,
      apiRoot: String(data.apiRoot || DEFAULT_API_ROOT).replace(/\/$/, ""),
      sendUrlOverride: String(data.sendUrl || "").trim() || null,
      sendPathTemplate: String(data.sendPath || DEFAULT_SEND_PATH).trim() || DEFAULT_SEND_PATH,
    };
  };

  try {
    const secret = await db.doc(`clinic_secrets/${clinicId}`).get();
    const own = pick(secret.exists ? secret.data().wapilot : null);
    if (own) return { ...own, source: "clinic" };
  } catch (e) {
    console.warn(`leadWelcome: could not read clinic_secrets/${clinicId}:`, e);
  }

  const envConfig = pick({
    instanceId: process.env.WAPILOT_INSTANCE_ID,
    token: process.env.WAPILOT_API_TOKEN || process.env.WAPILOT_ACCESS_TOKEN,
    apiRoot: process.env.WAPILOT_API_BASE_URL,
  });
  return envConfig ? { ...envConfig, source: "platform" } : null;
}

/** Templates are written for the fullest case; an empty placeholder must not leave a hole. */
function tidy(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendViaGateway(config, phone, text) {
  const digits = normalizeToInternationalDigits(phone);
  if (!digits) throw new Error("Phone is not in a sendable international format");
  const url =
    config.sendUrlOverride ||
    `${config.apiRoot}${config.sendPathTemplate.replace(/\{instanceId\}/g, encodeURIComponent(config.instanceId))}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Token: config.token, "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: `${digits}@c.us`, message: text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Wapilot ${res.status}: ${body.slice(0, 200)}`);
}

/**
 * Puts the message on the clinic's to-send list. The document id is derived from the lead so a
 * replayed event cannot queue the same greeting twice — the trick `enqueueWhatsapp` uses on the
 * web side — and the Android queue sheet reads these fields as they are.
 */
async function queueForHuman(db, clinicId, lead, phone, text) {
  const ref = db.doc(`clinics/${clinicId}/whatsapp_outbox/lead_${lead.docId}`);
  const existing = await ref.get();
  if (!existing.exists) {
    await ref.set({
      to: phone,
      text,
      status: "queued",
      type: "lead_welcome",
      patientName: String(lead.name || "").trim(),
      createdAt: new Date().toISOString(),
    });
  }
  return { status: "queued", mode: "manual", at: FieldValue.serverTimestamp(), text };
}

/**
 * Sends (or queues) the welcome message for one lead, exactly once.
 *
 * The guard is the lead's own `welcomeMessage` field rather than a flag held elsewhere: Meta
 * re-delivers events and the retry sweep replays them, and somebody who asked once must not be
 * greeted three times.
 */
async function sendLeadWelcome(db, clinicId, lead) {
  const leadRef = db.doc(`clinics/${clinicId}/leads/${lead.docId}`);

  const snap = await leadRef.get();
  if (!snap.exists) return null;
  const current = snap.data() || {};
  if (current.welcomeMessage) return null; // already greeted — never twice
  const phone = String(current.phone || lead.phone || "").trim();
  if (!phone) return null; // a stub with no number yet; the retry greets once details land

  const settingsSnap = await db.doc(`clinics/${clinicId}/settings/whatsapp`).get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (settings.isLeadAutoReplyEnabled !== true) return null;

  const template = resolveWhatsappTemplate(settings, "lead_welcome");
  if (!template) return null; // the clinic switched this template off

  let clinicName = "";
  try {
    const profile = await db.doc(`clinics/${clinicId}/settings/clinicProfile`).get();
    clinicName = String((profile.exists && (profile.data().name || profile.data().clinicName)) || "").trim();
    if (!clinicName) {
      const clinicDoc = await db.doc(`clinics/${clinicId}`).get();
      clinicName = String((clinicDoc.exists && clinicDoc.data().name) || "").trim();
    }
  } catch (_) {
    /* a nameless greeting still beats no greeting */
  }

  const interest = String(current.interest || lead.interest || "").trim();
  const text = tidy(
    mergeWhatsappTemplate(template, {
      patient_name: String(current.name || lead.name || "").trim(),
      clinic_name: clinicName,
      interest,
    })
  );
  if (!text) return null;

  const stamp = async (record) => {
    await leadRef.set({ welcomeMessage: record, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return record;
  };

  const config = await loadWapilotConfig(db, clinicId);
  // Absent an explicit choice, the server decides the way the rest of the system does:
  // unattended when a gateway exists, click-to-send when it does not.
  const wanted =
    settings.deliveryMode === "auto" || settings.deliveryMode === "manual"
      ? settings.deliveryMode
      : config
        ? "auto"
        : "manual";

  if (wanted === "auto" && config) {
    try {
      await sendViaGateway(config, phone, text);
      return stamp({ status: "sent", mode: "auto", at: FieldValue.serverTimestamp(), text });
    } catch (e) {
      console.warn(`leadWelcome: gateway send failed for ${clinicId}, queueing instead:`, e);
      const queued = await queueForHuman(db, clinicId, lead, phone, text);
      return stamp({ ...queued, error: String((e && e.message) || e).slice(0, 300) });
    }
  }

  return stamp(await queueForHuman(db, clinicId, lead, phone, text));
}

module.exports = { sendLeadWelcome, tidy };
