/**
 * One nudge when a patient goes quiet mid-conversation.
 *
 * A patient asks a price, gets the answer, and stops. Every sales desk knows that twenty
 * minutes later "still there?" recovers some of those — and that inside WhatsApp's 24-hour
 * window it costs nothing and needs no template. Every fifteen minutes this finds AI-led
 * conversations where the bot spoke last, the patient has been silent for 20–90 minutes, no
 * person has taken over, nothing was booked, and no nudge was sent since their last message —
 * and sends exactly one, through the clinic's own Cloud API credentials.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = () => getFirestore(admin.app(), "default");

const MIN_QUIET_MS = 20 * 60 * 1000;
const MAX_QUIET_MS = 90 * 60 * 1000;
const WINDOW_MS = 23 * 60 * 60 * 1000;
const GRAPH = "https://graph.facebook.com/v21.0";

function nudgeText(c) {
  const interest = String(c.lastInterest || "").trim();
  const name = String(c.patientName || "").trim();
  const hi = name ? `${name}، ` : "";
  return interest
    ? `${hi}لسه معاك؟ 😊 لو حابب أحجزلك كشف عشان ${interest} أو عندك أي سؤال تاني، أنا هنا.`
    : `${hi}لسه معاك؟ 😊 لو حابب أحجزلك كشف أو عندك أي سؤال تاني، أنا هنا.`;
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
        const meta = secret.metaWhatsapp || {};
        if (!meta.token || !meta.phoneNumberId) continue;

        const snap = await db()
          .collection(`clinics/${clinicId}/whatsapp_conversations`)
          .where("lastMessageAt", ">=", now - MAX_QUIET_MS)
          .get();
        for (const doc of snap.docs) {
          const c = doc.data() || {};
          if (doc.id.startsWith("play_") || c.aiUsed !== true) continue;
          if (c.needsHuman === true || c.botPaused === true || c.outcome === "booked" || c.optedOut === true) continue;
          if (c.lastDirection !== "out" || c.lastAuthor !== "bot") continue;
          const lastIn = Number(c.lastInboundAt) || 0;
          const lastAt = Number(c.lastMessageAt) || 0;
          if (!lastIn || now - lastIn > WINDOW_MS) continue;
          const quiet = now - lastAt;
          if (quiet < MIN_QUIET_MS || quiet > MAX_QUIET_MS) continue;
          if ((Number(c.nudgedAtMs) || 0) >= lastIn) continue;
          // Mid-booking lists are a question already on the table; a nudge on top reads as nagging.
          if (typeof c.state === "string" && c.state.startsWith("booking_")) continue;
          const to = String(c.phone || "").replace(/\D/g, "");
          if (!to) continue;

          const text = nudgeText(c);
          const res = await fetch(`${GRAPH}/${meta.phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${meta.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
          });
          const data = await res.json().catch(() => ({}));
          const at = Date.now();
          await doc.ref.set({ nudgedAtMs: at, lastText: text.slice(0, 160), lastAt: at, lastDirection: "out", lastAuthor: "bot", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          await doc.ref.collection("messages").add({
            direction: "out",
            author: "bot",
            text,
            kind: "quiet_nudge",
            at,
            channel: "meta",
            ...(res.ok && data?.messages?.[0]?.id ? { waMessageId: data.messages[0].id, status: "sent" } : { status: "failed" }),
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        console.error(`quietNudge failed for ${clinicId}:`, e);
      }
    }
  }
);
