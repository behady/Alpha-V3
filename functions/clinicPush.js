/**
 * Tell a clinic's staff something, on whatever devices they have.
 *
 * The Cloud Functions twin of `src/lib/notificationDelivery.ts` — same catalogue, same documents,
 * same four questions answered in one place: is this alert switched on, who is it addressed to,
 * has any of those people muted it for themselves, and is it quiet hours.
 *
 * Two bugs this file used to have, both now impossible because the answers come from one resolver:
 *
 *  - It read roles ONLY from `clinics/{id}/staff`, but signup writes the owner's role to
 *    `users.clinicRoles` and `clinics/{id}.ownerId` and creates no staff document. So every alert
 *    addressed to the owner reached nobody, at every clinic where the owner had not also been
 *    added by hand on the Users screen — including the 21:00 money digest written for them.
 *  - Nothing it sent could be switched off. The one settings toggle that existed was read from
 *    `clinics/{id}` while the settings screen saved it to `clinics/{id}/settings/clinic_info`.
 *
 * Fire-and-forget by design: a notification is a courtesy about something that already happened,
 * so failing to deliver one must never fail the thing itself.
 */

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const {
  isMutedFor,
  notifyEvent,
  pushAllowedNow,
  resolveNotify,
} = require("./notificationCatalog");

const TIMEZONE = process.env.CLINIC_TIMEZONE || "Africa/Cairo";

/** The clinic's own hour, for quiet hours. */
function clinicHourNow(now = new Date()) {
  try {
    const n = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(now)
    );
    return Number.isFinite(n) ? n % 24 : now.getHours();
  } catch {
    return now.getHours();
  }
}

/** Where this clinic's answers live. The settings document, which is what the app writes. */
async function readAlertPreferences(db, clinicId) {
  try {
    const snap = await db.doc(`clinics/${clinicId}/settings/clinic_info`).get();
    const prefs = snap.data()?.alertPreferences;
    return prefs && typeof prefs === "object" ? prefs : {};
  } catch {
    // Defaults, not silence: a transient read error must never be able to suppress a
    // patient-is-waiting alert.
    return {};
  }
}

/**
 * Everybody who works at this clinic, with their role — staff rows plus the owner.
 *
 * The owner is added separately and outranks whatever their staff row says, because ownership is
 * recorded on the clinic document and the role that matters for addressing is "Owner".
 */
async function readClinicMembers(db, clinicId) {
  const byUid = new Map();
  try {
    const staffSnap = await db.collection(`clinics/${clinicId}/staff`).get();
    for (const doc of staffSnap.docs) {
      const uid = String(doc.data()?.uid || "").trim();
      if (uid) byUid.set(uid, { uid, role: String(doc.data()?.role || "").trim() });
    }
  } catch {
    /* The owner alone is better than nobody. */
  }
  try {
    const clinicSnap = await db.collection("clinics").doc(clinicId).get();
    const ownerId = String(clinicSnap.data()?.ownerId || "").trim();
    if (ownerId) byUid.set(ownerId, { uid: ownerId, role: "Owner" });
  } catch {
    /* Staff alone. */
  }
  return [...byUid.values()];
}

function matchRoles(members, roles) {
  if (!roles || roles.length === 0) return [];
  const wanted = new Set(roles);
  // An Owner is an Admin everywhere else in this app, so an alert addressed to Admin reaches
  // them. Not the reverse: "Owner" means the owner.
  const ownerCountsAsAdmin = wanted.has("Admin");
  return members
    .filter((m) => wanted.has(m.role) || (ownerCountsAsAdmin && m.role === "Owner"))
    .map((m) => m.uid);
}

/** The bell's link, from the screen name the phone would open. Mirrors the web helper. */
function screenToUrl(screen) {
  switch (screen) {
    case "day":
      return "/appointments";
    case "chats":
      return "/chats";
    case "leads":
      return "/leads";
    case "money":
      return "/reports";
    case "inventory":
      return "/inventory";
    case "marketing":
      return "/marketing";
    case "settings":
      return "/settings";
    case "lab":
      return "/lab";
    default:
      return null;
  }
}

/**
 * options:
 *   event   — a notificationCatalog id. Supplying it is what makes the alert controllable.
 *   roles   — only staff with one of these roles. Ignored when `event` names its own audience.
 *   uids    — exactly these people, bypassing the role filter (still clinic staff only).
 *   channel — Android notification channel id, so a phone can mute one category.
 *   data    — string map delivered with the message; `screen` tells the app what to open.
 *   actionUrl — where the bell row goes on tap; derived from `data.screen` when omitted.
 */
async function sendClinicPush(db, clinicId, notification, options = {}) {
  try {
    const { event = null, roles = null, uids = null, channel = null, data = null, actionUrl = null } = options;

    const prefs = event ? await readAlertPreferences(db, clinicId) : {};
    const resolved = event ? resolveNotify(event, prefs) : null;
    if (event && !resolved) {
      console.warn(`sendClinicPush: unknown event "${event}" — sending ungated`);
    }
    if (resolved && !resolved.bell && !resolved.push) return;

    const members = await readClinicMembers(db, clinicId);
    const allUids = new Set(members.map((m) => m.uid));

    let targetUids;
    if (uids) {
      targetUids = [...new Set(uids.map((u) => String(u || "").trim()).filter((u) => allUids.has(u)))];
    } else if (resolved) {
      targetUids = [...new Set(matchRoles(members, resolved.roles))];
    } else {
      targetUids = [
        ...new Set(roles && roles.length > 0 ? matchRoles(members, roles) : members.map((m) => m.uid)),
      ];
    }
    if (targetUids.length === 0) return;

    const userSnaps = await db.getAll(...targetUids.map((uid) => db.collection("users").doc(uid)));

    // Per-person mutes only ever subtract — nobody can switch on what their clinic switched off.
    const kept = event
      ? userSnaps.filter((snap) => !isMutedFor(event, snap.data()?.notificationMutes, clinicId))
      : userSnaps;
    if (kept.length === 0) return;

    const audience = kept.map((snap) => snap.id);
    const meta = event ? notifyEvent(event) : undefined;

    if (!resolved || resolved.bell) {
      try {
        await db.collection(`clinics/${clinicId}/notifications`).add({
          title: notification.title,
          body: notification.body,
          eventType: event || "generic",
          group: meta?.group || null,
          actionUrl: actionUrl || screenToUrl(data?.screen) || null,
          audience,
          readBy: [],
          dismissedBy: [],
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.warn("Bell row failed:", error);
      }
    }

    // Quiet hours silence the buzz, never the record: the bell row above is already written.
    if (event && !pushAllowedNow(event, prefs, clinicHourNow())) return;

    const tokenOwner = new Map();
    for (const snap of kept) {
      const tokens = snap.data()?.fcmTokens;
      if (!Array.isArray(tokens)) continue;
      for (const token of tokens) {
        if (typeof token === "string" && token) tokenOwner.set(token, snap.ref);
      }
    }
    const tokens = [...tokenOwner.keys()];
    if (tokens.length === 0) return;

    const message = { tokens, notification };
    // Data rides on the notification: Android delivers it as intent extras on tap, which is what
    // lets the app open the right screen.
    const dataEntries = Object.entries({
      ...(data || {}),
      ...(channel ? { channel } : {}),
      ...(event ? { event } : {}),
    })
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

module.exports = {
  sendClinicPush,
  readAlertPreferences,
  readClinicMembers,
  clinicHourNow,
  screenToUrl,
};
