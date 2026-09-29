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
 *
 * ── The same rules as every other patient message ────────────────────────────────────────────
 * This is the ONE message in the system sent to someone who has never written to the clinic,
 * which makes it the message most likely to be reported — and it used to leave with none of the
 * protections the web app's chokepoint (src/lib/whatsappDelivery.ts) applies: no stop check, no
 * opt-out footer, at any hour, and from the shared platform number when the clinic had none.
 * Those four are applied here now, mirroring the web app's rules field for field.
 */

const { FieldValue } = require("firebase-admin/firestore");
const { mergeWhatsappTemplate, resolveWhatsappTemplate } = require("./whatsappMessageDefaults");
const { normalizeToInternationalDigits } = require("./wapilotClient");

const DEFAULT_API_ROOT = "https://api.wapilot.net/api/v2";
const DEFAULT_SEND_PATH = "/{instanceId}/send-message";
const TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";

/** Clinic hours for unattended patient messages — the same 10:00–22:00 the gateway enforces. */
const SEND_WINDOW_START = 10;
const SEND_WINDOW_END = 22;

/** Mirrors src/lib/patientMessaging.ts — the two footers and the word they hinge on. */
const OPT_OUT_KEYWORD_AR = "إيقاف";
const FOOTER_AR = `— لإيقاف الرسائل أرسل: ${OPT_OUT_KEYWORD_AR}`;
const FOOTER_BILINGUAL = `— لإيقاف الرسائل أرسل: ${OPT_OUT_KEYWORD_AR} · To stop, reply: STOP`;

/**
 * This clinic's own WhatsApp number, or nothing.
 *
 * There used to be a second step — the shared WAPILOT_* platform number — so that a clinic with
 * no number of its own still greeted its leads. The web app removed that fallback on 2026-09-27
 * (src/lib/wapilotConfig.ts): the platform line carries staff alerts only, and a cold message to
 * a stranger from a number shared by every clinic is the single riskiest send in the system.
 * A clinic with no number gets the human queue, which is what it gets everywhere else.
 */
async function loadWapilotConfig(db, clinicId) {
  try {
    const secret = await db.doc(`clinic_secrets/${clinicId}`).get();
    const data = secret.exists ? secret.data().wapilot : null;
    if (!data || typeof data !== "object") return null;
    const instanceId = String(data.instanceId || "").trim();
    // `apiToken`/`apiBaseUrl` are what the app actually stores (src/lib/wapilotConfig.ts writes
    // and reads those names). The older names stay as fallbacks for hand-written records.
    const token = String(data.apiToken || data.token || data.accessToken || "").trim();
    if (!instanceId || !token) return null;
    return {
      instanceId,
      token,
      apiRoot: String(data.apiBaseUrl || data.apiRoot || DEFAULT_API_ROOT).replace(/\/$/, ""),
      sendUrlOverride: String(data.sendUrl || "").trim() || null,
      sendPathTemplate: String(data.sendPath || DEFAULT_SEND_PATH).trim() || DEFAULT_SEND_PATH,
      // Alpha's own gateway holds proactive messages for clinic hours itself, so the night rule
      // below is only needed for a third-party gateway that sends the moment it is asked.
      holdsForClinicHours: data.provider === "alpha",
      source: "clinic",
    };
  } catch (e) {
    console.warn(`leadWelcome: could not read clinic_secrets/${clinicId}:`, e);
    return null;
  }
}

/** Templates are written for the fullest case; an empty placeholder must not leave a hole. */
function tidy(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Same folding the web app applies before comparing Arabic: alef forms, tashkeel, case. */
function foldArabic(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و");
}

/**
 * The opt-out line, unless the body already tells the reader how to stop.
 *
 * Mirrors `appendOptOutFooter` + `applyPatientOptOutFooter` in the web app: on unless the clinic
 * switched it off, Arabic-only when its templates are, and never added twice.
 */
function withOptOutFooter(text, settings) {
  const body = String(text || "");
  if (settings && settings.optOutFooterEnabled === false) return body;
  const folded = foldArabic(body);
  if (folded.includes(foldArabic(OPT_OUT_KEYWORD_AR)) && folded.includes("ارسل")) return body;
  if (/\bstop\b/i.test(body) && /repl(y|ies)|send/i.test(body)) return body;
  const footer = settings && settings.templatePack === "arabic" ? FOOTER_AR : FOOTER_BILINGUAL;
  return `${body.replace(/\s+$/, "")}\n\n${footer}`;
}

/** The last nine digits — the key `whatsapp_conversations` documents are filed under (src/lib/patientPhone.ts). */
function phoneMatchKey(raw) {
  let digits = String(raw || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  while (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/**
 * Has this number asked to be left alone? The three places a stop request can land, as the web
 * app's `whatsappOptOutReason` (src/lib/messagingConsent.ts) checks them.
 */
async function optOutReason(db, clinicId, phone) {
  const digits = normalizeToInternationalDigits(phone) || String(phone || "").replace(/\D/g, "");
  try {
    if (digits) {
      const number = await db.doc(`clinics/${clinicId}/messaging_opt_outs/${digits}`).get();
      if (number.exists) return "number";
    }
    const key = phoneMatchKey(phone);
    if (key) {
      const conversation = await db.doc(`clinics/${clinicId}/whatsapp_conversations/${key}`).get();
      if (conversation.exists && conversation.data().optedOut === true) return "conversation";
    }
    if (digits) {
      const patients = await db.collection(`clinics/${clinicId}/patients`).where("phone", "==", `+${digits}`).limit(1).get();
      if (!patients.empty && patients.docs[0].data().whatsappOptOut === true) return "patient";
    }
  } catch (e) {
    console.warn(`leadWelcome: opt-out lookup failed for ${clinicId}:`, e);
  }
  return null;
}

/** Is it clinic hours in Cairo right now? */
function insideSendWindow(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  return hour >= SEND_WINDOW_START && hour < SEND_WINDOW_END;
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
    // Both spellings: Wapilot's own API reads `text`; older gateways read `message`.
    body: JSON.stringify({ chat_id: `${digits}@c.us`, text, message: text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Wapilot ${res.status}: ${body.slice(0, 200)}`);
}

/**
 * The clinic's official WhatsApp credentials, when it has moved to the Meta Cloud API.
 *
 * This module was written when Wapilot was the only gateway. A clinic on the official channel has
 * no Wapilot config at all, so every greeting fell through to the human queue and sat there — 52
 * real leads, unanswered, before anyone noticed. The Cloud API is tried first now, exactly as the
 * web app does it.
 */
async function loadMetaConfig(db, clinicId) {
  try {
    const snap = await db.doc(`clinic_secrets/${clinicId}`).get();
    const meta = (snap.exists && snap.data().metaWhatsapp) || null;
    if (!meta || !meta.token || !meta.phoneNumberId) return null;
    return { token: String(meta.token), phoneNumberId: String(meta.phoneNumberId) };
  } catch (_) {
    return null;
  }
}

/** Has this number written to us inside WhatsApp's 24-hour window? Free text only delivers if so. */
async function hasOpenWindow(db, clinicId, phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return false;
  try {
    const key = digits.length > 10 ? digits.slice(-10) : digits;
    const snap = await db.collection(`clinics/${clinicId}/whatsapp_conversations`).get();
    for (const doc of snap.docs) {
      const c = doc.data() || {};
      const p = String(c.phone || doc.id).replace(/\D/g, "");
      if (!p.endsWith(key)) continue;
      const at = Number(c.lastInboundAt) || 0;
      return at > 0 && Date.now() - at < 23 * 60 * 60 * 1000;
    }
  } catch (_) {
    /* no window we can prove */
  }
  return false;
}

/**
 * Send through the official channel.
 *
 * A lead from an ad form has never written to us, so the 24-hour service window is shut and only a
 * pre-approved template delivers — free-form text is accepted by the API and then silently dropped,
 * which is indistinguishable from success. So: template first, and free text only when the patient
 * really did write to us recently (a click-to-WhatsApp lead does).
 */
async function sendViaMeta(config, phone, text, params, canFreeText) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) throw new Error("invalid_phone");
  const post = (payload) =>
    fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: digits, ...payload }),
    });

  if (!canFreeText) {
    const res = await post({
      type: "template",
      template: {
        name: "alpha_lead_welcome_ar",
        language: { code: "ar" },
        components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t || "-" })) }],
      },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Meta template ${res.status}: ${body.slice(0, 200)}`);
    return "template";
  }

  const res = await post({ type: "text", text: { body: text } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Meta text ${res.status}: ${body.slice(0, 200)}`);
  return "text";
}

/**
 * Puts the message on the clinic's to-send list. The document id is derived from the lead so a
 * replayed event cannot queue the same greeting twice — the trick `enqueueWhatsapp` uses on the
 * web side — and the Android queue sheet reads these fields as they are.
 */
async function queueForHuman(db, clinicId, lead, phone, text, reason) {
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
  return { status: "queued", mode: "manual", at: FieldValue.serverTimestamp(), text, ...(reason ? { reason } : {}) };
}

/**
 * Sends (or queues) the welcome message for one lead, exactly once.
 *
 * The guard is the lead's own `welcomeMessage` field rather than a flag held elsewhere: Meta
 * re-delivers events and the retry sweep replays them, and somebody who asked once must not be
 * greeted three times.
 */
async function sendLeadWelcome(db, clinicId, lead, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
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

  const stamp = async (record) => {
    await leadRef.set({ welcomeMessage: record, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return record;
  };

  // Before anything is composed: a number that said stop is not greeted, queued or retried.
  const optedOut = await optOutReason(db, clinicId, phone);
  if (optedOut) return stamp({ status: "skipped", reason: `opted_out_${optedOut}`, at: FieldValue.serverTimestamp() });

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
  const text = withOptOutFooter(
    tidy(
      mergeWhatsappTemplate(template, {
        patient_name: String(current.name || lead.name || "").trim(),
        clinic_name: clinicName,
        interest,
      })
    ),
    settings
  );
  if (!text.trim()) return null;

  const meta = await loadMetaConfig(db, clinicId);
  const config = meta ? null : await loadWapilotConfig(db, clinicId);
  // Absent an explicit choice, the server decides the way the rest of the system does:
  // unattended when a gateway exists, click-to-send when it does not.
  const wanted =
    settings.deliveryMode === "auto" || settings.deliveryMode === "manual"
      ? settings.deliveryMode
      : meta || config
        ? "auto"
        : "manual";

  if (wanted === "auto" && meta) {
    try {
      const canFreeText = await hasOpenWindow(db, clinicId, phone);
      const how = await sendViaMeta(
        meta,
        phone,
        text,
        [String(current.name || lead.name || "").trim() || "عميلنا العزيز", clinicName || "عيادتنا"],
        canFreeText
      );
      return stamp({ status: "sent", mode: "auto", channel: "meta", how, at: FieldValue.serverTimestamp(), text });
    } catch (e) {
      console.warn(`leadWelcome: Meta send failed for ${clinicId}, queueing instead:`, e);
      const queued = await queueForHuman(db, clinicId, lead, phone, text);
      return stamp({ ...queued, error: String((e && e.message) || e).slice(0, 300) });
    }
  }

  if (wanted === "auto" && config) {
    // A third-party gateway sends the moment it is asked, and a stranger messaged at 1 a.m. is
    // the message that gets reported. Outside clinic hours the greeting goes to the human queue,
    // where reception sends it first thing — a person's morning message beats a machine's night
    // one. Alpha's own gateway holds it for 10:00 itself, so it is asked at once.
    if (!config.holdsForClinicHours && !insideSendWindow(now)) {
      return stamp(await queueForHuman(db, clinicId, lead, phone, text, "outside_hours"));
    }
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

module.exports = { sendLeadWelcome, tidy, withOptOutFooter, insideSendWindow, phoneMatchKey };
