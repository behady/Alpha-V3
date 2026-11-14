/**
 * One nudge when a patient goes quiet mid-conversation.
 *
 * A patient asks a price, gets the answer, and stops. Every sales desk knows that twenty
 * minutes later "still there?" recovers some of those — and that inside WhatsApp's 24-hour
 * window it costs nothing and needs no template. Every fifteen minutes this finds AI-led
 * conversations where the bot spoke last, the patient has been silent for 20–90 minutes, no
 * person has taken over, nothing was booked, the bot's last line was not itself a goodbye, the
 * person holds no visit today or later, and nobody on this chat was nudged in the past week —
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
/**
 * One nudge per person per week. "Once per silence" re-armed on every reply: on 14/11 a patient
 * who answered the nudge ("لا العنوان بعيد عليا", then "تسلمي") was nudged again 45 minutes later
 * with the same line, and another got a second nudge 45 minutes after the first.
 */
const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/*
 * The words. Every line reads the same to a man and a woman ("لو حبيت", "حضرتك", no imperatives),
 * and none carries the stored interest: "كشف عشان كشف", "كشف عشان زراعه مصري" were that field
 * pasted into a sentence nobody read before it went. The thread right above already says what
 * they asked about. "ميعاد" fits a check-up, a treatment and an ad offer alike.
 */
const OPENERS = ["لسه معانا؟ 😊", "براحة حضرتك خالص 😊", "في انتظار رد حضرتك 😊"];
const OFFER_ANY = "لو حبيت أحجزلك ميعاد أو عندك أي سؤال تاني، أنا هنا.";
// When the last turn offered times still ahead. It never says they are held: nothing holds them.
const OFFER_TIMES = "لو ميعاد من اللي بعتهالك مناسب أثبتهولك على طول، ولو يوم تاني أنسب أشوفلك غيره.";
// A patient the bot answers in English is nudged in English too; an Arabic line to them is the one
// message of the chat they cannot read. See speaksEnglish for who that is.
const OPENERS_EN = ["Still with us? 😊", "No rush at all 😊", "Whenever you're ready 😊"];
const OFFER_ANY_EN = "If you'd like, I can book you an appointment, or ask me anything else.";
const OFFER_TIMES_EN = "If one of the times I sent works for you, I'll confirm it right away, or I can find another day.";

/**
 * The bot's last line already closed the chat: "العفو 🙏 تحت أمر حضرتك في أي وقت." (thanks), or
 * "تمام، مستنينك 🦷 + the appointment" (ack / ack_confirmed, a patient confirming a visit).
 * "لسه معانا؟" after either argues with it. These are the fixed replies of AI mode.
 */
const CLOSED_REASONS = new Set(["thanks", "ack", "ack_confirmed"]);

/**
 * Does this person hold a visit today or later that still stands? Then they are not sold one.
 * The conversation says "booked" only when the BOT booked; a visit booked at the desk left people
 * with an appointment that week being asked "لو حبيت أحجزلك كشف". Same rule as
 * src/lib/leads/followupGuard.ts (already_booked).
 */
function standingAppointment(rows, todayKey) {
  return (rows || []).some((a) => {
    const day = String((a && a.date) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < todayKey) return false;
    const status = String((a && a.status) || "");
    return status !== "Cancelled" && status !== "No Show";
  });
}

/** Same chat, same line; different chats, different lines. An empty id gives the first. */
function pickIndex(id, n) {
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

/** Cairo date and minutes, as clinicNow() in src/lib/publicBooking.ts reads the clinic's clock. */
function cairoClock(now) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(now))) p[x.type] = x.value;
  return { dateKey: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/**
 * Did the bot's last turn leave a time on the table that is still at least half an hour away?
 * Slot keys are "2026-11-14|06:30 PM|doctor" (respond.ts nextSlots). Anything else reads as no.
 */
function offeredTimeAhead(c, now) {
  const slots = Array.isArray(c.pendingSlots) ? c.pendingSlots : [];
  const today = cairoClock(now);
  return slots.some((s) => {
    const [date, time] = String(s).split("|");
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(time || "").trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !m) return false;
    const hour = m[3] ? (Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0) : Number(m[1]);
    return date > today.dateKey || (date === today.dateKey && hour * 60 + Number(m[2]) > today.minutes + 30);
  });
}

/**
 * Does the bot speak English in this chat? The patient's script alone (lastLatin) says no such
 * thing: "Ok", "tmam" and Franco-Arabic all set it, and the model answers those in Arabic, so an
 * Arabic chat would get its one English line. The bot's own last line must be Latin too: lastText,
 * the thread preview written beside lastAuthor "bot" — the same witness the photo disclaimer uses.
 */
function speaksEnglish(c) {
  const last = String(c.lastText || "");
  return c.lastLatin === true && /[A-Za-z]/.test(last) && !/[؀-ۿ]/.test(last);
}

function nudgeText(c, id = "", now = Date.now()) {
  // First name only: "مروة محمد ابو ضيف، لسه معاك؟" is a form letter; "مروة، لسه معاكي؟" is a person.
  const name = String(c.patientName || "").trim().split(/\s+/)[0] || "";
  const hi = name ? `${name}، ` : "";
  const times = offeredTimeAhead(c, now);
  if (speaksEnglish(c)) return `${name ? `Hi ${name}! ` : ""}${OPENERS_EN[pickIndex(id, OPENERS_EN.length)]} ${times ? OFFER_TIMES_EN : OFFER_ANY_EN}`;
  return `${hi}${OPENERS[pickIndex(id, OPENERS.length)]} ${times ? OFFER_TIMES : OFFER_ANY}`;
}

/** Is this conversation owed its one nudge right now? Pure: the job reads, this decides. */
function shouldNudge(docId, c, now) {
  if (String(docId).startsWith("play_") || c.aiUsed !== true) return false;
  if (c.needsHuman === true || c.botPaused === true || c.outcome === "booked" || c.optedOut === true) return false;
  // "Not now" means not now. Nudging after it is how a polite no becomes a STOP.
  if (Number(c.declinedAtMs) > 0 && now - Number(c.declinedAtMs) < DECLINE_HOLD_MS) return false;
  if (c.lastDirection !== "out" || c.lastAuthor !== "bot") return false;
  // The bot's own "العفو، تحت أمر حضرتك في أي وقت" or "تمام، مستنينك" closed the chat.
  if (CLOSED_REASONS.has(String(c.lastReason || ""))) return false;
  const lastIn = Number(c.lastInboundAt) || 0;
  const lastAt = Number(c.lastMessageAt) || 0;
  if (!lastIn || now - lastIn > WINDOW_MS) return false;
  const quiet = now - lastAt;
  if (quiet < MIN_QUIET_MS || quiet > MAX_QUIET_MS) return false;
  // At most one nudge a week per chat, however many times they wrote back in between.
  const nudgedAt = Number(c.nudgedAtMs) || 0;
  if (nudgedAt >= lastIn || now - nudgedAt < NUDGE_COOLDOWN_MS) return false;
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
          if (typeof c.patientId === "string" && c.patientId) {
            // One read, only for the few that passed shouldNudge: the single-field query the lead
            // follow-up already runs, so no index. A failed read sends nothing.
            const appts = await db().collection(`clinics/${clinicId}/appointments`).where("patientId", "==", c.patientId).limit(50).get().catch(() => null);
            if (!appts || standingAppointment(appts.docs.map((a) => a.data() || {}), cairoClock(now).dateKey)) continue;
          }

          const text = nudgeText(c, doc.id, now);
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
exports.offeredTimeAhead = offeredTimeAhead;
exports.standingAppointment = standingAppointment;
exports.shouldNudge = shouldNudge;
exports.nudgeRoute = nudgeRoute;
exports.nudgeAddress = nudgeAddress;
exports.sendNudge = sendNudge;
