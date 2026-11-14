/**
 * One nudge when a patient goes quiet mid-conversation.
 *
 * A patient asks a price, gets the answer, and stops. Every sales desk knows that twenty
 * minutes later "still there?" recovers some of those — and that inside WhatsApp's 24-hour
 * window it costs nothing and needs no template. Every fifteen minutes this finds AI-led
 * conversations where the bot spoke last, the patient has been silent for 20–90 minutes, no
 * person has taken over, nothing was booked, and no nudge was sent since their last message —
 * and sends exactly one, on the line the clinic answers on: its official number when it has
 * one, otherwise its own QR line.
 *
 * It was written for the official number only. A clinic on its own line — the kind that runs
 * Click-to-WhatsApp ads — was skipped without a word while its settings showed the switch on:
 * 440 ad chats at one clinic ended with the assistant speaking last, and none was ever nudged.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = () => getFirestore(admin.app(), "default");

const MIN_QUIET_MS = 20 * 60 * 1000;
const MAX_QUIET_MS = 90 * 60 * 1000;
const WINDOW_MS = 23 * 60 * 60 * 1000;
const GRAPH = "https://graph.facebook.com/v21.0";
/** As leadWelcome.js and src/lib/wapilotConfig.ts spell them. */
const DEFAULT_GATEWAY_ROOT = "https://api.wapilot.net/api/v2";
const DEFAULT_GATEWAY_SEND_PATH = "/{instanceId}/send-message";

/** How long a "not now" holds the nudge off. Longer than any lead follow-up window. */
const DECLINE_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

function nudgeText(c) {
  const interest = String(c.lastInterest || "").trim();
  // First name only: "مروة محمد ابو ضيف، لسه معاك؟" is a form letter; "مروة، لسه معاكي؟" is a person.
  const name = String(c.patientName || "").trim().split(/\s+/)[0] || "";
  const hi = name ? `${name}، ` : "";
  // Someone who came from an ad is booking the offer they were shown, not a check-up. The
  // confirmation already leaves the consultation line out for them; so does this.
  if (c.ad && typeof c.ad === "object") return `${hi}لسه معانا؟ 😊 لو حبيت أحجزلك ميعاد أو عندك أي سؤال تاني، أنا هنا.`;
  // "لو حبيت" reads the same to a man and a woman; the masculine participle does not.
  // An interest that is itself the check-up reads "أحجزلك كشف عشان كشف"; say it once.
  return interest && !/كشف|فحص/.test(interest)
    ? `${hi}لسه معانا؟ 😊 لو حبيت أحجزلك كشف عشان ${interest} أو عندك أي سؤال تاني، أنا هنا.`
    : `${hi}لسه معانا؟ 😊 لو حبيت أحجزلك كشف أو عندك أي سؤال تاني، أنا هنا.`;
}

/** Is this conversation owed its one nudge right now? Pure: the job reads, this decides. */
function shouldNudge(docId, c, now) {
  if (String(docId).startsWith("play_") || c.aiUsed !== true) return false;
  if (c.needsHuman === true || c.botPaused === true || c.outcome === "booked" || c.optedOut === true) return false;
  // "Not now" means not now. Nudging after it is how a polite no becomes a STOP.
  if (Number(c.declinedAtMs) > 0 && now - Number(c.declinedAtMs) < DECLINE_HOLD_MS) return false;
  if (c.lastDirection !== "out" || c.lastAuthor !== "bot") return false;
  const lastIn = Number(c.lastInboundAt) || 0;
  const lastAt = Number(c.lastMessageAt) || 0;
  if (!lastIn || now - lastIn > WINDOW_MS) return false;
  const quiet = now - lastAt;
  if (quiet < MIN_QUIET_MS || quiet > MAX_QUIET_MS) return false;
  if ((Number(c.nudgedAtMs) || 0) >= lastIn) return false;
  // Mid-booking lists are a question already on the table; a nudge on top reads as nagging.
  if (typeof c.state === "string" && c.state.startsWith("booking_")) return false;
  return true;
}

/**
 * The line this clinic's nudge leaves on, from its `clinic_secrets` document, or null.
 *
 * The official number first, as everywhere else. Then the clinic's OWN gateway line — never the
 * shared platform number, which carries staff alerts only.
 */
function nudgeRoute(secret) {
  const meta = (secret && secret.metaWhatsapp) || {};
  if (meta.token && meta.phoneNumberId) return { kind: "meta", token: String(meta.token), phoneNumberId: String(meta.phoneNumberId) };
  const w = (secret && secret.wapilot) || {};
  const instanceId = String(w.instanceId || "").trim();
  const token = String(w.apiToken || w.token || w.accessToken || "").trim();
  if (!instanceId || !token) return null;
  const root = String(w.apiBaseUrl || w.apiRoot || DEFAULT_GATEWAY_ROOT).replace(/\/$/, "");
  const sendPath = String(w.sendPath || DEFAULT_GATEWAY_SEND_PATH).trim() || DEFAULT_GATEWAY_SEND_PATH;
  const url = String(w.sendUrl || "").trim() || `${root}${sendPath.replace(/\{instanceId\}/g, encodeURIComponent(instanceId))}`;
  return { kind: "gateway", token, url };
}

/**
 * Where on that line the nudge goes, or "" when it cannot be addressed.
 *
 * The conversation stores the address the patient wrote from: a phone, or WhatsApp's privacy id
 * (`…@lid`) with no phone behind it. The gateway delivers to either; the official API only to a
 * phone.
 */
function nudgeAddress(c, kind) {
  const raw = String((c && c.phone) || "").trim();
  const isLid = /@lid$/i.test(raw);
  if (kind === "meta") return isLid ? "" : raw.replace(/\D/g, "");
  if (isLid) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@c.us` : "";
}

/** Send one nudge. Never throws: a line that refuses is a failed nudge, not a failed job. */
async function sendNudge(route, to, text, fetchImpl = fetch) {
  const channel = route.kind === "meta" ? "meta" : "wapilot";
  try {
    if (route.kind === "meta") {
      const res = await fetchImpl(`${GRAPH}/${route.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${route.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
      });
      const data = await res.json().catch(() => ({}));
      const id = res.ok && data && data.messages && data.messages[0] && data.messages[0].id;
      return id ? { ok: true, channel, waMessageId: id } : { ok: false, channel };
    }
    const res = await fetchImpl(route.url, {
      method: "POST",
      headers: { Token: route.token, "Content-Type": "application/json" },
      // Both spellings: Wapilot's own API reads `text`; older gateways read `message`.
      body: JSON.stringify({ chat_id: to, text, message: text }),
    });
    return { ok: Boolean(res.ok), channel };
  } catch (e) {
    console.warn("quietNudge: send failed:", e && e.message);
    return { ok: false, channel };
  }
}

exports.quietNudge = onSchedule(
  { schedule: "every 15 minutes", region: "us-central1", timeoutSeconds: 120, memory: "256MiB" },
  async () => {
    const now = Date.now();
    const clinics = await db().collection("clinics").get();
    for (const clinic of clinics.docs) {
      const clinicId = clinic.id;
      try {
        const settings = (await db().doc(`clinics/${clinicId}/settings/whatsapp`).get()).data() || {};
        if (settings.botEnabled !== true || settings.botMode !== "ai_first" || settings.botQuietNudge === false) continue;
        const secret = (await db().doc(`clinic_secrets/${clinicId}`).get()).data() || {};
        const route = nudgeRoute(secret);
        if (!route) continue;

        const snap = await db()
          .collection(`clinics/${clinicId}/whatsapp_conversations`)
          .where("lastMessageAt", ">=", now - MAX_QUIET_MS)
          .get();
        for (const doc of snap.docs) {
          const c = doc.data() || {};
          if (!shouldNudge(doc.id, c, now)) continue;
          const to = nudgeAddress(c, route.kind);
          if (!to) continue;

          const text = nudgeText(c);
          const sent = await sendNudge(route, to, text);
          const at = Date.now();
          await doc.ref.set({ nudgedAtMs: at, lastText: text.slice(0, 160), lastAt: at, lastDirection: "out", lastAuthor: "bot", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          await doc.ref.collection("messages").add({
            direction: "out",
            author: "bot",
            text,
            kind: "quiet_nudge",
            at,
            channel: sent.channel,
            ...(sent.ok ? { ...(sent.waMessageId ? { waMessageId: sent.waMessageId } : {}), status: "sent" } : { status: "failed" }),
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        console.error(`quietNudge failed for ${clinicId}:`, e);
      }
    }
  }
);

// For the offline checks (test-quietNudge.js); the deployed function is `quietNudge` alone.
exports.nudgeText = nudgeText;
exports.shouldNudge = shouldNudge;
exports.nudgeRoute = nudgeRoute;
exports.nudgeAddress = nudgeAddress;
exports.sendNudge = sendNudge;
