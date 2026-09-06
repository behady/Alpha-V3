/**
 * Nobody left waiting silently.
 *
 * The WhatsApp assistant promises "someone from reception will get back to you" and marks the
 * conversation for a person. That mark sat on a document, and on a quiet afternoon it stayed
 * there. Every fifteen minutes this looks at every open handoff: past fifteen minutes with no
 * human reply, reception and admins are pushed again; past forty-five, the owner is. Each
 * reminder is sent once per handoff — a re-opened handoff (a newer handoffAtMs) counts afresh.
 */

const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");
const { sendClinicPush } = require("./clinicPush");

const db = () => getFirestore(admin.app(), "default");

const STAFF_AFTER_MS = 15 * 60 * 1000;
const OWNER_AFTER_MS = 45 * 60 * 1000;
/** A handoff older than this is a stale one (the bot's own hold is 24h); not worth a page. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A patient message counts as swallowed by a claim only if the claim was this recent. */
const CLAIM_LINK_MS = 60 * 60 * 1000;

function minutesLabel(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} ساعة و${m % 60} دقيقة` : `${m} دقيقة`;
}

exports.handoffSla = onSchedule(
  { schedule: "every 15 minutes", region: "us-central1", timeoutSeconds: 120, memory: "256MiB" },
  async () => {
    const now = Date.now();
    const clinics = await db().collection("clinics").get();
    for (const clinic of clinics.docs) {
      const clinicId = clinic.id;
      if (!isActiveClinic(clinic.data())) continue;
      try {
        const snap = await db().collection(`clinics/${clinicId}/whatsapp_conversations`).where("needsHuman", "==", true).get();
        for (const doc of snap.docs) {
          const c = doc.data() || {};
          const at = Number(c.handoffAtMs) || 0;
          if (!at) continue;
          const age = now - at;
          if (age < STAFF_AFTER_MS || age > MAX_AGE_MS) continue;
          // Somebody answered or claimed it after the handoff: nothing is waiting.
          if ((Number(c.handledAtMs) || 0) >= at || (Number(c.humanActiveAtMs) || 0) >= at || c.botPaused === true) continue;

          const who = c.patientName || c.phone || doc.id;
          const what = String(c.lastInbound || "").replace(/\s+/g, " ").slice(0, 80);
          const severity = c.severity === "urgent" ? "⚠️ " : c.severity === "complaint" ? "🙏 " : "";

          if (age >= OWNER_AFTER_MS && (Number(c.slaOwnerPingedAtMs) || 0) < at) {
            await sendClinicPush(
              db(),
              clinicId,
              {
                title: `${severity}مريض مستني رد من ${minutesLabel(age)}`,
                body: `${who}${what ? ` — ${what}` : ""}. محدش من الاستقبال رد لسه.`,
              },
              { roles: ["Owner", "Admin"], channel: "alpha_bookings", data: { screen: "chats" } }
            );
            await doc.ref.set({ slaOwnerPingedAtMs: now, slaStaffPingedAtMs: Number(c.slaStaffPingedAtMs) || now }, { merge: true });
          } else if ((Number(c.slaStaffPingedAtMs) || 0) < at) {
            await sendClinicPush(
              db(),
              clinicId,
              {
                title: `${severity}لسه مستني رد — ${minutesLabel(age)}`,
                body: `${who}${what ? ` — ${what}` : ""}`,
              },
              { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_bookings", data: { screen: "chats" } }
            );
            await doc.ref.set({ slaStaffPingedAtMs: now }, { merge: true });
          }
        }

        /*
         * Second pass: the patient who wrote while a staff claim was live.
         *
         * A receptionist who types one word claims the thread — needsHuman is cleared and the bot
         * stays quiet for the claim window. If she then walks away, the patient's next question
         * reaches nobody: the bot is muted, the pass above cannot see it because the flag is gone,
         * and the quiet nudge only fires when the BOT spoke last. That message sat unanswered with
         * nothing but an unread badge to show for it. This finds exactly that shape.
         */
        const waiting = await db()
          .collection(`clinics/${clinicId}/whatsapp_conversations`)
          .where("lastInboundAt", ">=", now - MAX_AGE_MS)
          .get();
        for (const doc of waiting.docs) {
          const c = doc.data() || {};
          if (doc.id.startsWith("play_")) continue;
          // The pass above owns flagged threads; an explicit take-over owns its own.
          if (c.needsHuman === true || c.botPaused === true || c.optedOut === true) continue;
          if (c.lastDirection !== "in") continue;
          const lastIn = Number(c.lastInboundAt) || 0;
          const claimed = Number(c.humanActiveAtMs) || 0;
          if (!claimed || claimed >= lastIn) continue;
          if (lastIn - claimed > CLAIM_LINK_MS) continue;
          const age = now - lastIn;
          if (age < STAFF_AFTER_MS || age > MAX_AGE_MS) continue;
          if ((Number(c.slaWaitPingedAtMs) || 0) >= lastIn) continue;
          const who = c.patientName || c.phone || doc.id;
          const what = String(c.lastText || "").replace(/\s+/g, " ").slice(0, 80);
          await sendClinicPush(
            db(),
            clinicId,
            { title: `مريض رد ومحدش رد عليه — ${minutesLabel(age)}`, body: `${who}${what ? ` — ${what}` : ""}` },
            {
              roles: age >= OWNER_AFTER_MS ? ["Owner", "Admin"] : ["Owner", "Admin", "Receptionist"],
              channel: "alpha_bookings",
              data: { screen: "chats" },
            }
          );
          await doc.ref.set({ slaWaitPingedAtMs: now }, { merge: true });
        }
      } catch (e) {
        console.error(`handoffSla failed for ${clinicId}:`, e);
      }
    }
  }
);
