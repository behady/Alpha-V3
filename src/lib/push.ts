import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb, adminMessaging } from "@/lib/firebaseAdmin";

/**
 * Tell a clinic's staff something, on whatever devices they have.
 *
 * Tokens come from the same `users/{uid}.fcmTokens` list the browser and the Android app both
 * register into, so the sender never knows or cares which kind of device answers. Staff are found
 * through the clinic's own staff collection — a push helper that read the users collection at
 * large would be one bug away from notifying another clinic's people.
 *
 * Every caller treats this as fire-and-forget. A notification is a courtesy about something that
 * already happened; failing to deliver one must never fail the thing itself, which is why this
 * swallows its errors and why nothing here is awaited on any critical path.
 *
 * Dead tokens are pruned as they are discovered. Phones get wiped and reinstalled; without
 * pruning, every send walks an ever-growing list of ghosts.
 */
export interface ClinicPushOptions {
  /** Only staff with one of these roles ("Admin", "Dentist", "Receptionist"…). */
  roles?: string[];
  /** Exactly these people, bypassing the role filter (still clinic staff only). */
  uids?: string[];
  /** Android notification channel id, so a phone can mute one category. */
  channel?: string;
  /** String map delivered with the message; `screen` tells the app what to open. */
  data?: Record<string, string>;
}

export async function sendClinicPush(
  clinicId: string,
  notification: { title: string; body: string },
  options: ClinicPushOptions = {}
): Promise<void> {
  try {
    const { roles = null, uids = null, channel = null, data = null } = options;

    const staffSnap = await adminClinicCollection(clinicId, "staff").get();
    const roleUids = staffSnap.docs
      .filter((doc) => !roles || roles.includes(String(doc.data()?.role || "").trim()))
      .map((doc) => String(doc.data()?.uid || "").trim())
      .filter(Boolean);

    // Explicit uids are still checked against the clinic's own staff — this
    // helper must never be able to notify another clinic's people.
    const allStaff = new Set(
      staffSnap.docs.map((doc) => String(doc.data()?.uid || "").trim()).filter(Boolean)
    );
    const targetUids = [...new Set(uids ? uids.filter((uid) => allStaff.has(uid)) : roleUids)];
    if (targetUids.length === 0) return;

    const db = adminDb();
    const userRefs = targetUids.map((uid) => db.collection("users").doc(uid));
    const userSnaps = await db.getAll(...userRefs);

    // Remember which user owns which token, so a dead one can be removed from the right list.
    const tokenOwner = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const snap of userSnaps) {
      const tokens = snap.data()?.fcmTokens;
      if (!Array.isArray(tokens)) continue;
      for (const token of tokens) {
        if (typeof token === "string" && token) tokenOwner.set(token, snap.ref);
      }
    }
    const tokens = [...tokenOwner.keys()];
    if (tokens.length === 0) return;

    // Data rides on the notification: Android delivers it as intent extras on
    // tap, which is what lets the app open the right screen.
    const dataEntries = Object.entries({ ...(data || {}), ...(channel ? { channel } : {}) })
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)] as [string, string]);

    const result = await adminMessaging().sendEachForMulticast({
      tokens,
      notification,
      ...(dataEntries.length > 0 ? { data: Object.fromEntries(dataEntries) } : {}),
      ...(channel ? { android: { notification: { channelId: channel } } } : {}),
    });

    const removals = new Map<FirebaseFirestore.DocumentReference, string[]>();
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
    console.warn("Clinic push failed:", error);
  }
}
