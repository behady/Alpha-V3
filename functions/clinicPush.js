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

/**
 * options:
 *   roles   — only staff with one of these roles ("Admin", "Dentist", "Receptionist"…).
 *   uids    — exactly these people, bypassing the role filter (still clinic staff only).
 *   channel — Android notification channel id, so a phone can mute one category.
 *   data    — string map delivered with the message; `screen` tells the app what to open.
 */
async function sendClinicPush(db, clinicId, notification, options = {}) {
  try {
    const { roles = null, uids = null, channel = null, data = null } = options;

    const staffSnap = await db.collection(`clinics/${clinicId}/staff`).get();
    const staffUids = staffSnap.docs
      .filter((doc) => !roles || roles.includes(String(doc.data()?.role || "").trim()))
      .map((doc) => String(doc.data()?.uid || "").trim())
      .filter(Boolean);

    // Explicit uids are still checked against the clinic's own staff — this
    // helper must never be able to notify another clinic's people.
    const allStaff = new Set(
      staffSnap.docs.map((doc) => String(doc.data()?.uid || "").trim()).filter(Boolean)
    );
    const targetUids = [
      ...new Set(uids ? uids.filter((uid) => allStaff.has(uid)) : staffUids),
    ];
    if (targetUids.length === 0) return;

    const userSnaps = await db.getAll(...targetUids.map((uid) => db.collection("users").doc(uid)));

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

    const message = { tokens, notification };
    // Data rides on the notification: Android delivers it as intent extras on
    // tap, which is what lets the app open the right screen.
    const dataEntries = Object.entries({ ...(data || {}), ...(channel ? { channel } : {}) })
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)]);
    if (dataEntries.length > 0) message.data = Object.fromEntries(dataEntries);
    if (channel) message.android = { notification: { channelId: channel } };

    const result = await admin.messaging().sendEachForMulticast(message);

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
