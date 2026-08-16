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
export async function sendClinicPush(
  clinicId: string,
  notification: { title: string; body: string }
): Promise<void> {
  try {
    const staffSnap = await adminClinicCollection(clinicId, "staff").get();
    const uids = staffSnap.docs
      .map((doc) => String(doc.data()?.uid || "").trim())
      .filter(Boolean);
    if (uids.length === 0) return;

    const db = adminDb();
    const userRefs = [...new Set(uids)].map((uid) => db.collection("users").doc(uid));
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

    const result = await adminMessaging().sendEachForMulticast({
      tokens,
      notification,
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
