/**
 * Tell a clinic's staff something, on whatever devices they have.
 *
 * The Cloud Functions twin of `src/lib/push.ts` — same contract, same token source
 * (`users/{uid}.fcmTokens`, written by both the browser and the Android app), same
 * clinic-scoped staff lookup so a notification can never leak to another clinic's people.
 *
 * Fire-and-forget by design: a notification is a courtesy about something that already
 * happened, so failing to deliver one must never fail the thing itself.
 */

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

async function sendClinicPush(db, clinicId, notification) {
  try {
    const staffSnap = await db.collection(`clinics/${clinicId}/staff`).get();
    const uids = [
      ...new Set(
        staffSnap.docs
          .map((doc) => String(doc.data()?.uid || "").trim())
          .filter(Boolean)
      ),
    ];
    if (uids.length === 0) return;

    const userSnaps = await db.getAll(...uids.map((uid) => db.collection("users").doc(uid)));

    // Remember which user owns which token, so a dead one is removed from the right list.
    const tokenOwner = new Map();
    for (const snap of userSnaps) {
      const tokens = snap.data()?.fcmTokens;
      if (!Array.isArray(tokens)) continue;
      for (const token of tokens) {
        if (typeof token === "string" && token) tokenOwner.set(token, snap.ref);
      }
    }
    const tokens = [...tokenOwner.keys()];
    if (tokens.length === 0) return;

    const result = await admin.messaging().sendEachForMulticast({ tokens, notification });

    const removals = new Map();
    result.responses.forEach((response, i) => {
      const code = response.error?.code || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        const owner = tokenOwner.get(tokens[i]);
        if (owner) removals.set(owner, [...(removals.get(owner) || []), tokens[i]]);
      }
    });
    await Promise.all(
      [...removals.entries()].map(([ref, dead]) =>
        ref.update({ fcmTokens: FieldValue.arrayRemove(...dead) }).catch(() => {})
      )
    );
  } catch (error) {
    console.warn(`clinicPush failed for ${clinicId}:`, error);
  }
}

module.exports = { sendClinicPush };
