/**
 * Meta (Facebook/Instagram) Lead Ads → the Leads inbox.
 *
 * The receiving door for lead-form submissions. Meta pings the webhook seconds after
 * someone submits an instant form; we fetch the submission via the Graph API and write
 * it into `clinics/{clinicId}/leads`, where the web app's Leads page already knows how
 * to show it (source "Meta ads", stage "new", follow-up today so it floats to the top).
 *
 * Config lives in the named "default" Firestore database (see firebase.json):
 *   meta_integrations/config       { verifyToken, appSecret, systemUserToken }
 *   meta_pages/{pageId}            { clinicId, pageAccessToken, pageName, enabled, health… }
 *   meta_lead_events/{leadgenId}   the replay queue — see below
 * None of those match a client rule, so browsers can never read the tokens.
 *
 * NOTHING MAY BE LOST. A clinic paying for ads and silently missing leads is the worst
 * failure this system can have, and Meta gives up quickly: it wants a 200 within seconds
 * and stops retrying soon after. So every ping is recorded in `meta_lead_events` first,
 * and a lead reaches the inbox even when Meta refuses to hand over the details — as a
 * **stub** the clinic can see and chase, which later heals itself in place when a retry
 * finally gets the real name and phone. `retryPendingLeadEvents` (scheduled) does that
 * healing, and also delivers leads that arrived before their page was connected.
 */

const crypto = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { sendClinicPush } = require("./clinicPush");
const { sendLeadWelcome } = require("./leadWelcome");

const GRAPH_VERSION = "v23.0";

/** Give up on an event after this many attempts, or this many days, whichever comes first. */
const MAX_ATTEMPTS = 24;
const MAX_AGE_DAYS = 7;

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

/**
 * Folds the spelling a campaign name happens to use down to something matchable.
 *
 * Arabic ad names are written every which way — with tashkeel, with tatweel, أ/إ/ا mixed, ة for ه —
 * and both sides of a comparison must come through here. A keyword that skips it sits in the list
 * looking like coverage it has never once provided.
 */
function normalizeForMatch(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "") // tashkeel and tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ") // separators, emoji, the "|" and "–" every ad name is full of
    .trim();
}

/** Arabic glues its article and conjunctions onto the noun; strip them before comparing. */
const AR_PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال", "و"];

function stripArabicPrefix(token) {
  for (const p of AR_PREFIXES) {
    if (token.startsWith(p) && token.length > p.length + 2) return token.slice(p.length);
  }
  return token;
}

/**
 * Whole-token keyword matching.
 *
 * Deliberately not `haystack.includes(keyword)`: Arabic's definite article turns substring
 * matching into a false-positive machine, because ال + a noun re-creates other words wholesale.
 * Hence two rules — compare against tokens (and their article-stripped form) rather than the
 * raw string, and let a stem shorter than four characters match only a whole token, never the
 * start of one, since a short stem plus an ordinary suffix is usually a different word.
 */
function matchesKeyword(haystack, keyword) {
  const needle = normalizeForMatch(keyword);
  if (!needle) return false;
  const tokens = normalizeForMatch(haystack).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;

  if (needle.includes(" ")) {
    // A phrase has to appear as a run of whole tokens, written either way.
    const written = ` ${tokens.join(" ")} `;
    const stripped = ` ${tokens.map(stripArabicPrefix).join(" ")} `;
    return written.includes(` ${needle} `) || stripped.includes(` ${needle} `);
  }

  return tokens.some((token) => {
    for (const form of new Set([token, stripArabicPrefix(token)])) {
      if (needle.length >= 4 ? form.startsWith(needle) : form === needle) return true;
    }
    return false;
  });
}

/**
 * What a dental ad is usually selling, and the words campaigns name it with.
 *
 * The fallback vocabulary only — a clinic that wrote its own service list gets its own wording
 * back instead, so a lead the webhook wrote and a lead reception typed land on the same row of
 * the marketing funnel rather than on two rows spelled differently.
 *
 * Each entry answers in the language the ad was written in, because that is the language the
 * person read before they filled the form, and the answer is quoted back to them on WhatsApp.
 */
const SERVICE_KEYWORDS = [
  // Most specific first: "Hollywood smile veneers" is a hollywood-smile campaign.
  { en: "Hollywood smile", ar: "ابتسامة هوليوود", enWords: ["hollywood"], arWords: ["هوليوود"] },
  { en: "Veneers", ar: "فينير", enWords: ["veneer", "lumineer", "emax"], arWords: ["فينير", "عدسات"] },
  { en: "Orthodontics", ar: "تقويم الأسنان", enWords: ["ortho", "braces", "invisalign", "aligner"], arWords: ["تقويم", "براكت"] },
  { en: "Dental implants", ar: "زراعة الأسنان", enWords: ["implant"], arWords: ["زراعه", "زرع"] },
  { en: "Teeth whitening", ar: "تبييض الأسنان", enWords: ["whitening", "bleaching"], arWords: ["تبييض", "تبيض"] },
  { en: "Crowns & bridges", ar: "تلبيسات وجسور", enWords: ["crown", "bridge", "zirconia"], arWords: ["تلبيس", "طربوش", "جسور", "زيركون"] },
  { en: "Root canal", ar: "علاج العصب", enWords: ["root canal", "endodontic"], arWords: ["عصب"] },
  { en: "Fillings", ar: "حشو الأسنان", enWords: ["filling", "composite"], arWords: ["حشو", "حشوات"] },
  { en: "Extraction", ar: "خلع الأسنان", enWords: ["extraction", "wisdom tooth"], arWords: ["خلع", "ضرس العقل"] },
  { en: "Dentures", ar: "تركيبات متحركة", enWords: ["denture"], arWords: ["طقم"] },
  { en: "Gum treatment", ar: "علاج اللثة", enWords: ["periodontal", "gum"], arWords: ["لثه"] },
  { en: "Kids dentistry", ar: "أسنان الأطفال", enWords: ["kids", "children", "pediatric", "pedodontic"], arWords: ["اطفال"] },
  { en: "Teeth cleaning", ar: "تنظيف الأسنان", enWords: ["cleaning", "scaling", "hygiene"], arWords: ["تنظيف", "تنضيف", "جير"] },
];

/** Field names a lead form uses when it asks which treatment the person came for. */
const SERVICE_QUESTION_HINTS = ["service", "treatment", "interested", "procedure", "خدمه", "علاج", "تهتم"];

/** The clinic's own service names first, then the built-in table. "" when nothing is recognised. */
function matchService(text, clinicServices) {
  if (!normalizeForMatch(text)) return "";

  // Longest first, so "Zirconia crown" wins over "Crown" on a campaign that says both.
  const own = [...(clinicServices || [])].sort((a, b) => b.length - a.length);
  for (const name of own) {
    if (matchesKeyword(text, name)) return name;
  }
  for (const entry of SERVICE_KEYWORDS) {
    if (entry.arWords.some((w) => matchesKeyword(text, w))) return entry.ar;
    if (entry.enWords.some((w) => matchesKeyword(text, w))) return entry.en;
  }
  return "";
}

/**
 * What this lead actually wants, in the clinic's own words wherever possible.
 *
 * Strictest evidence first: what the person picked on the form beats what the campaign was
 * called, and the clinic's own service names beat our built-in guesses.
 *
 * When nothing is recognised the answer is deliberately empty rather than the campaign name.
 * `interest` is read back out into the WhatsApp greeting, and "you asked about
 * Veneers-Sep26-Cairo-Broad-v2" is worse for the clinic than the generic sentence it already
 * sends. The campaign is still on the lead — in its notes, and in `meta.campaignName` where
 * the marketing funnel reads it.
 */
function detectInterest({ fieldData, campaignName, adName, clinicServices }) {
  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    const answer = (Array.isArray(field.values) ? field.values.filter(Boolean).join(", ") : "").trim();
    if (!answer) continue;
    if (!SERVICE_QUESTION_HINTS.some((hint) => matchesKeyword(field.name, hint))) continue;
    // Their own answer to "which service?" — trustworthy enough to quote even unrecognised,
    // unlike an ad name, as long as it is short enough to be a service and not an essay.
    const picked = matchService(answer, clinicServices) || (answer.length <= 40 ? answer : "");
    // A paragraph in a free-text box tells us nothing, but the campaign that carried it still
    // might — so an unreadable answer falls through rather than ending the search.
    if (picked) return picked;
  }

  return matchService(campaignName, clinicServices) || matchService(adName, clinicServices) || "";
}

/**
 * The clinic's own service names — the first vocabulary a campaign name is read against.
 * A lookup failure costs a label, never the lead.
 */
async function loadClinicServices(db, clinicId) {
  try {
    const snap = await db.collection(`clinics/${clinicId}/services`).limit(200).get();
    return snap.docs
      .map((d) => String(d.data().name || "").trim())
      .filter(Boolean);
  } catch (e) {
    console.warn("loadClinicServices failed:", e);
    return [];
  }
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
 * What the clinic already knows about an arriving phone number.
 *
 * The Cloud Functions twin of `findLeadMatches` in src/lib/leads.ts — kept in step with it
 * so a lead that walks in through Facebook carries the same badges as one reception typed.
 * Lookup failures are swallowed: a lead missing its badges is a small loss, a lead not
 * written at all is the failure this whole system exists to prevent.
 */
async function findLeadMatches(db, clinicId, phone, ignoreLeadId) {
  const empty = { existingPatientId: null, existingPatientName: null, duplicateOfLeadId: null };
  const clean = String(phone || "").trim();
  if (!clean) return empty;
  try {
    const [patients, leads] = await Promise.all([
      db.collection(`clinics/${clinicId}/patients`).where("phone", "==", clean).limit(1).get(),
      db.collection(`clinics/${clinicId}/leads`).where("phone", "==", clean).limit(2).get(),
    ]);
    const patient = patients.empty ? null : patients.docs[0];
    const earlier = leads.docs.find((d) => d.id !== ignoreLeadId) || null;
    return {
      existingPatientId: patient ? patient.id : null,
      existingPatientName: patient ? String(patient.data().name || "") : null,
      duplicateOfLeadId: earlier ? earlier.id : null,
    };
  } catch (e) {
    console.warn("findLeadMatches failed:", e);
    return empty;
  }
}

/**
 * Writes one lead into a clinic's inbox — or heals the stub left by an earlier failed try.
 *
 * Healing deliberately fills in only the facts Meta owns (name, phone, interest, notes,
 * meta) and never touches `stage`: reception may already have called the stub and moved
 * it along, and a late-arriving detail fetch must not drag that work backwards.
 *
 * Returns "created" | "stub" | "healed" | "duplicate".
 */
async function writeLeadToClinic(db, clinicId, lead, todayStr) {
  const ref = db.collection(`clinics/${clinicId}/leads`).doc(lead.docId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      tx.set(ref, {
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
        existingPatientId: lead.existingPatientId || null,
        existingPatientName: lead.existingPatientName || null,
        duplicateOfLeadId: lead.duplicateOfLeadId || null,
        createdBy: lead.createdBy || "meta-webhook",
        meta: lead.meta || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        stageChangedAt: FieldValue.serverTimestamp(),
      });
      return lead.pending ? "stub" : "created";
    }

    const existing = snap.data() || {};
    const wasStub = Boolean(existing.meta && existing.meta.fetchFailed);
    if (wasStub && !lead.pending) {
      tx.update(ref, {
        name: lead.name || existing.name || "Unknown",
        phone: lead.phone || existing.phone || "",
        interest: lead.interest || existing.interest || "",
        notes: lead.notes || existing.notes || "",
        meta: lead.meta || null,
        // The stub had no phone, so its badges could not be looked up until now.
        existingPatientId: lead.existingPatientId || existing.existingPatientId || null,
        existingPatientName: lead.existingPatientName || existing.existingPatientName || null,
        duplicateOfLeadId: lead.duplicateOfLeadId || existing.duplicateOfLeadId || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return "healed";
    }
    return "duplicate";
  });
}

/**
 * Fetches the full submission for a leadgen id using the page's token.
 * Retries transient failures briefly in-process: most Graph blips clear in a second, and
 * clearing one here means the clinic never sees a stub at all.
 */
async function fetchLeadFromGraph(leadgenId, pageAccessToken, attempts = 3) {
  const fields = "created_time,field_data,ad_name,campaign_name,form_id,is_organic";
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}` +
    `?fields=${fields}&access_token=${encodeURIComponent(pageAccessToken)}`;

  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body;

      const code = body.error?.code;
      // 190 = token dead, 200/104 = permission. Retrying those is pointless; fail fast.
      const permanent = code === 190 || code === 200 || code === 104;
      lastError = new Error(`Graph API ${res.status}: ${body.error?.message || JSON.stringify(body)}`);
      if (permanent) throw lastError;
    } catch (e) {
      lastError = e;
      if (String(e.message || "").includes("Graph API 4")) throw e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw lastError || new Error("Graph API: unknown failure");
}

/** Notes body for a lead whose details Meta would not hand over (yet). */
function stubNotes(error) {
  return [
    "⚠️ Facebook has not released this person's details yet — we keep retrying and they will fill in here automatically.",
    "⚠️ فيسبوك لسه مطلعش بيانات الشخص ده — بنحاول تاني لوحدنا والبيانات هتظهر هنا أول ما تتاح.",
    `(${String(error || "").slice(0, 200)})`,
  ].join("\n");
}

/**
 * Delivers one lead event: page → clinic, Graph → details, details → inbox, inbox → phones.
 * The single path shared by live webhook traffic and the scheduled retry, so a replayed
 * lead behaves exactly like a fresh one.
 *
 * Returns { status, leadResult } where status is what the event doc should now say.
 */
async function processLeadEvent(db, event, todayStr) {
  const { pageId, leadgenId } = event;
  const pageSnap = await db.doc(`meta_pages/${pageId}`).get();

  if (!pageSnap.exists || pageSnap.data().enabled === false) {
    // Not a failure — the page may simply not be connected to a clinic yet. Keep the
    // event so connecting it later delivers the backlog instead of losing it.
    return { status: "unmapped", error: `Page ${pageId} is not connected to a clinic` };
  }

  const { clinicId, pageAccessToken, pageName } = pageSnap.data();
  const pageRef = pageSnap.ref;

  let graphLead = null;
  let fetchError = "";
  try {
    graphLead = await fetchLeadFromGraph(leadgenId, pageAccessToken);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  const metaBase = {
    leadgenId,
    pageId,
    pageName: pageName || null,
    formId: String(graphLead?.form_id || event.formId || ""),
    adName: graphLead?.ad_name || null,
    campaignName: graphLead?.campaign_name || null,
    createdTime: graphLead?.created_time || event.createdTime || null,
  };

  let leadResult;
  let parsedName = "";
  let parsedInterest = "";

  if (graphLead) {
    const parsed = parseFieldData(graphLead.field_data);
    const noteLines = [];
    if (graphLead.campaign_name) noteLines.push(`Campaign: ${graphLead.campaign_name}`);
    if (graphLead.ad_name) noteLines.push(`Ad: ${graphLead.ad_name}`);
    if (graphLead.is_organic) noteLines.push("Organic (not from a paid ad)");
    if (parsed.email) noteLines.push(`Email: ${parsed.email}`);
    noteLines.push(...parsed.extra);

    parsedName = parsed.name;
    const [clinicServices, matches] = await Promise.all([
      loadClinicServices(db, clinicId),
      findLeadMatches(db, clinicId, parsed.phone, `meta_${leadgenId}`),
    ]);
    parsedInterest = detectInterest({
      fieldData: graphLead.field_data,
      campaignName: graphLead.campaign_name,
      adName: graphLead.ad_name,
      clinicServices,
    });
    leadResult = await writeLeadToClinic(
      db,
      clinicId,
      {
        docId: `meta_${leadgenId}`,
        name: parsed.name,
        phone: parsed.phone,
        interest: parsedInterest,
        source: "Meta ads",
        notes: noteLines.join("\n"),
        createdBy: "meta-webhook",
        ...matches,
        meta: { ...metaBase, fetchFailed: false },
      },
      todayStr
    );
  } else {
    leadResult = await writeLeadToClinic(
      db,
      clinicId,
      {
        docId: `meta_${leadgenId}`,
        name: "Facebook lead (details pending)",
        phone: "",
        interest: "",
        source: "Meta ads",
        notes: stubNotes(fetchError),
        createdBy: "meta-webhook",
        pending: true,
        meta: { ...metaBase, fetchFailed: true, fetchError: fetchError.slice(0, 500) },
      },
      todayStr
    );
  }

  // Connection health, so a broken page is visible in the admin screen before a clinic
  // complains about a quiet week.
  const health = { lastEventAt: FieldValue.serverTimestamp() };
  if (graphLead) {
    health.lastLeadAt = FieldValue.serverTimestamp();
    health.lastError = null;
    if (leadResult === "created" || leadResult === "healed") health.leadsReceived = FieldValue.increment(1);
  } else {
    health.lastError = fetchError.slice(0, 500);
    health.lastErrorAt = FieldValue.serverTimestamp();
  }
  await pageRef.set(health, { merge: true }).catch(() => {});

  // Answer them while they are still holding the phone, if the clinic asked for that. Failures
  // here are logged and dropped: a greeting that did not go out must never undo a lead that did.
  if (leadResult === "created" || leadResult === "healed") {
    try {
      const welcome = await sendLeadWelcome(db, clinicId, {
        docId: `meta_${leadgenId}`,
        name: parsedName,
      });
      if (welcome) console.log(`leadWelcome: ${leadgenId} → ${welcome.status} (${welcome.mode})`);
    } catch (e) {
      console.error(`leadWelcome failed for ${leadgenId}:`, e);
    }
  }

  // Speed to contact decides whether an ad lead converts, so announce it now. Never awaited
  // in a way that could fail the delivery above.
  if (leadResult === "created" || leadResult === "stub") {
    const who = graphLead ? parsedName || "New lead" : "Facebook lead (details pending)";
    // Staff see the campaign when no service was recognised — internally that name is useful.
    const topic = parsedInterest || graphLead?.campaign_name || "";
    const detail = topic ? `${who} — ${topic}` : who;
    await sendClinicPush(
      db,
      clinicId,
      {
        title: "New lead | عميل محتمل جديد 📣",
        body: `${detail}\nFacebook · ${pageName || pageId}`,
      },
      // The inbox is reception's and the owner's; tapping opens it directly.
      { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_leads", data: { screen: "leads" } }
    ).catch(() => {});
  }

  return {
    status: graphLead ? "delivered" : "pending",
    clinicId,
    leadResult,
    error: fetchError,
  };
}

/** Records/updates an event's place in the replay queue. */
async function recordEvent(db, event, outcome) {
  const ref = db.doc(`meta_lead_events/${event.leadgenId}`);
  const patch = {
    pageId: event.pageId,
    leadgenId: event.leadgenId,
    formId: event.formId || null,
    createdTime: event.createdTime || null,
    status: outcome.status,
    lastAttemptAt: FieldValue.serverTimestamp(),
    attempts: FieldValue.increment(1),
    lastError: outcome.error ? String(outcome.error).slice(0, 500) : null,
    clinicId: outcome.clinicId || null,
    firstSeenAt: FieldValue.serverTimestamp(),
  };
  const snap = await ref.get();
  if (snap.exists) delete patch.firstSeenAt; // keep the original sighting
  await ref.set(patch, { merge: true });
}

/**
 * The webhook handler. GET is Meta's one-time subscription check; POST is lead traffic.
 * POST always answers 200 once the signature is valid — Meta retries non-200 responses
 * for days, and by then the replay queue has the event anyway.
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
      const event = {
        pageId: String(value.page_id || entry.id || ""),
        leadgenId: String(value.leadgen_id || ""),
        formId: String(value.form_id || ""),
        createdTime: value.created_time || null,
      };
      if (!event.pageId || !event.leadgenId) continue;

      let outcome;
      try {
        outcome = await processLeadEvent(db, event, todayStr);
      } catch (e) {
        console.error(`metaLeadsWebhook: lead ${event.leadgenId} failed:`, e);
        outcome = { status: "pending", error: e instanceof Error ? e.message : String(e) };
      }
      await recordEvent(db, event, outcome).catch((e) =>
        console.error(`metaLeadsWebhook: could not record event ${event.leadgenId}:`, e)
      );
      console.log(
        `metaLeadsWebhook: lead ${event.leadgenId} → ${outcome.status}` +
          (outcome.leadResult ? ` (${outcome.leadResult})` : "") +
          (outcome.error ? ` — ${outcome.error}` : "")
      );
      results.push({ leadgenId: event.leadgenId, status: outcome.status });
    }
  }

  res.status(200).json({ received: results.length, results });
}

/**
 * Scheduled sweep of everything not yet delivered: heals stubs whose details Meta finally
 * released, and delivers leads that arrived before their page was connected to a clinic.
 * Events that are too old or too often tried are marked `expired` so the queue stays finite —
 * their stub lead remains in the inbox regardless, which is the point.
 */
async function retryPendingLeadEvents(db, todayStr, limit = 50) {
  const snap = await db
    .collection("meta_lead_events")
    .where("status", "in", ["pending", "unmapped"])
    .limit(limit)
    .get();

  const summary = { examined: snap.size, delivered: 0, stillPending: 0, expired: 0 };
  const cutoffMs = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  for (const doc of snap.docs) {
    const data = doc.data();
    const firstSeen = data.firstSeenAt instanceof Timestamp ? data.firstSeenAt.toMillis() : 0;
    if ((data.attempts || 0) >= MAX_ATTEMPTS || (firstSeen && firstSeen < cutoffMs)) {
      await doc.ref.set({ status: "expired", lastAttemptAt: FieldValue.serverTimestamp() }, { merge: true });
      summary.expired += 1;
      continue;
    }

    const event = {
      pageId: String(data.pageId || ""),
      leadgenId: String(data.leadgenId || doc.id),
      formId: data.formId || "",
      createdTime: data.createdTime || null,
    };

    let outcome;
    try {
      outcome = await processLeadEvent(db, event, todayStr);
    } catch (e) {
      outcome = { status: "pending", error: e instanceof Error ? e.message : String(e) };
    }
    await recordEvent(db, event, outcome).catch(() => {});
    if (outcome.status === "delivered") summary.delivered += 1;
    else summary.stillPending += 1;
  }

  return summary;
}

module.exports = {
  handleMetaWebhook,
  retryPendingLeadEvents,
  processLeadEvent,
  writeLeadToClinic,
  parseFieldData,
  detectInterest,
  matchesKeyword,
  normalizeMetaPhone,
  verifyMetaSignature,
};
