/**
 * Meta (Facebook/Instagram) Lead Ads → the Leads inbox.
 *
 * The receiving door for lead-form submissions. Meta pings the webhook seconds after
 * someone submits an instant form; we fetch the submission via the Graph API and write
 * it into `clinics/{clinicId}/leads`, where the web app's Leads page already knows how
 * to show it (source "Meta ads", stage "new", follow-up today so it floats to the top).
 *
 * Config lives in the named "default" Firestore database (see firebase.json):
 *   meta_integrations/config       { verifyToken, appSecret }
 *   meta_pages/{pageId}            { clinicId, pageAccessToken, pageName, enabled }
 * Neither collection matches any client rule, so browsers can never read the tokens.
 * `scripts/connect-meta-page.mjs` writes both docs — no console editing needed.
 *
 * The written lead is deduplicated by doc id (`meta_<leadgenId>`), because Meta retries
 * deliveries: a second ping for the same lead hits ALREADY_EXISTS and is dropped.
 */

const crypto = require("node:crypto");

const GRAPH_VERSION = "v23.0";

/**
 * Meta sends phones like "+201001234567", "p:+201001234567" or occasionally local
 * "01001234567". Best-effort E.164 with an Egypt default for bare local numbers —
 * the same convention the whole system stores (see lib/phoneNumber on the web side).
 */
function normalizeMetaPhone(raw) {
  let v = String(raw || "").trim().replace(/^p:/i, "").replace(/[\s\-().]/g, "");
  if (!v) return "";
  if (v.startsWith("00")) v = `+${v.slice(2)}`;
  if (v.startsWith("+")) return v;
  if (/^01\d{9}$/.test(v)) return `+2${v}`; // Egyptian mobile written locally
  if (/^\d{8,15}$/.test(v)) return `+${v}`; // digits that already carry a country code
  return v;
}

/** Pulls name/phone/email out of Meta's field_data; everything else becomes notes lines. */
function parseFieldData(fieldData) {
  const out = { name: "", phone: "", email: "", extra: [] };
  let firstName = "";
  let lastName = "";

  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    const key = String(field.name || "").toLowerCase();
    const value = Array.isArray(field.values) ? field.values.filter(Boolean).join(", ") : "";
    if (!value) continue;

    if (key === "full_name" || key === "name") out.name = value;
    else if (key === "first_name") firstName = value;
    else if (key === "last_name") lastName = value;
    else if (key === "phone_number" || key === "phone") out.phone = normalizeMetaPhone(value);
    else if (key === "email") out.email = value;
    else out.extra.push(`${field.name}: ${value}`);
  }

  if (!out.name) out.name = [firstName, lastName].filter(Boolean).join(" ");
  return out;
}

/** Constant-time check of Meta's X-Hub-Signature-256 header against the raw body. */
function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return false;
  const header = String(signatureHeader || "");
  if (!header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * Writes one lead into a clinic's inbox. Shared by every intake route (Meta webhook now,
 * Zapier/manual doors later): whatever the source, a lead is a lead.
 *
 * Returns "created" | "duplicate".
 */
async function writeLeadToClinic(db, clinicId, lead, todayStr) {
  const ref = db.collection(`clinics/${clinicId}/leads`).doc(lead.docId);
  const { FieldValue } = require("firebase-admin/firestore");
  try {
    await ref.create({
      name: lead.name || "Unknown",
      phone: lead.phone || "",
      interest: lead.interest || "",
      source: lead.source || "Meta ads",
      stage: "new",
      notes: lead.notes || "",
      followUpDate: todayStr, // hot lead: float to the top of the inbox today
      lostReason: null,
      patientId: null,
      branchId: null,
      branchName: null,
      createdBy: lead.createdBy || "meta-webhook",
      meta: lead.meta || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return "created";
  } catch (e) {
    if (e && (e.code === 6 || String(e.message || "").includes("ALREADY_EXISTS"))) {
      return "duplicate";
    }
    throw e;
  }
}

/** Fetches the full submission for a leadgen id using the page's token. */
async function fetchLeadFromGraph(leadgenId, pageAccessToken) {
  const fields = "created_time,field_data,ad_name,campaign_name,form_id,is_organic";
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}` +
    `?fields=${fields}&access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Graph API ${res.status}: ${JSON.stringify(body.error || body)}`);
  }
  return body;
}

/**
 * The webhook handler. GET is Meta's one-time subscription check; POST is lead traffic.
 * POST always answers 200 once the signature is valid — Meta retries non-200 responses
 * for days, and a poison event should be logged, not redelivered forever.
 */
async function handleMetaWebhook(req, res, db, todayStr) {
  const configSnap = await db.doc("meta_integrations/config").get();
  const config = configSnap.exists ? configSnap.data() : {};

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && config.verifyToken && token === config.verifyToken) {
      res.status(200).send(String(challenge || ""));
    } else {
      res.status(403).send("Verification failed");
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  if (!verifyMetaSignature(req.rawBody || Buffer.from(""), req.headers["x-hub-signature-256"], config.appSecret)) {
    console.warn("metaLeadsWebhook: bad or missing signature — dropping");
    res.status(401).send("Bad signature");
    return;
  }

  const body = req.body || {};
  const results = [];

  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      const pageId = String(value.page_id || entry.id || "");
      const leadgenId = String(value.leadgen_id || "");
      if (!pageId || !leadgenId) continue;

      try {
        const pageSnap = await db.doc(`meta_pages/${pageId}`).get();
        if (!pageSnap.exists || pageSnap.data().enabled === false) {
          console.warn(`metaLeadsWebhook: no connected clinic for page ${pageId} — skipping lead ${leadgenId}`);
          results.push({ leadgenId, status: "unmapped-page" });
          continue;
        }
        const { clinicId, pageAccessToken, pageName } = pageSnap.data();

        const graphLead = await fetchLeadFromGraph(leadgenId, pageAccessToken);
        const parsed = parseFieldData(graphLead.field_data);

        const noteLines = [];
        if (graphLead.campaign_name) noteLines.push(`Campaign: ${graphLead.campaign_name}`);
        if (graphLead.ad_name) noteLines.push(`Ad: ${graphLead.ad_name}`);
        if (graphLead.is_organic) noteLines.push("Organic (not from a paid ad)");
        if (parsed.email) noteLines.push(`Email: ${parsed.email}`);
        noteLines.push(...parsed.extra);

        const status = await writeLeadToClinic(db, clinicId, {
          docId: `meta_${leadgenId}`,
          name: parsed.name,
          phone: parsed.phone,
          interest: "",
          source: "Meta ads",
          notes: noteLines.join("\n"),
          createdBy: "meta-webhook",
          meta: {
            leadgenId,
            pageId,
            pageName: pageName || null,
            formId: String(graphLead.form_id || value.form_id || ""),
            adName: graphLead.ad_name || null,
            campaignName: graphLead.campaign_name || null,
            createdTime: graphLead.created_time || null,
          },
        }, todayStr);

        console.log(`metaLeadsWebhook: lead ${leadgenId} → clinic ${clinicId}: ${status}`);
        results.push({ leadgenId, status });
      } catch (e) {
        console.error(`metaLeadsWebhook: failed on lead ${leadgenId}:`, e);
        results.push({ leadgenId, status: "error" });
      }
    }
  }

  res.status(200).json({ received: results.length, results });
}

module.exports = {
  handleMetaWebhook,
  writeLeadToClinic,
  parseFieldData,
  normalizeMetaPhone,
  verifyMetaSignature,
};
