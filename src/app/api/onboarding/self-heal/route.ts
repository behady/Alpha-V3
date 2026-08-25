import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { OWNER_ROLE } from "@/lib/permissions";

/**
 * Gives a clinic owner back the Admin role on a clinic they already own.
 *
 * A signup can leave a clinic document behind without the matching entry in the owner's
 * `clinicRoles` map — the dotted-key `set()` bug did exactly that, and any crash between the
 * clinic write and the role write would do it again. The owner is then stuck in a loop with no
 * way out: ClinicContext sees zero roles and sends them to /onboarding, where creating "another"
 * clinic just adds a second orphan. They cannot repair themselves either, because every other
 * admin endpoint requires the very role that is missing.
 *
 * So the check here is ownership, not role: `clinics.ownerId == uid` is written by the same
 * transaction that was supposed to grant the role, and it is not client-controlled. A caller can
 * only ever heal clinics they are already recorded as owning, which grants no access they were
 * not meant to have. Idempotent — a healthy account gets `healed: []` and nothing is written.
 */
export async function POST(request: Request) {
  try {
    const authCheck = await requireAuthedUser(request);
    if (!authCheck.ok) return authCheck.response;
    const uid = authCheck.uid;

    const db = adminDb();
    const owned = await db.collection("clinics").where("ownerId", "==", uid).get();
    if (owned.empty) {
      return NextResponse.json({ ok: true, healed: [], clinicId: null });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    const roles = (userData.clinicRoles || {}) as Record<string, unknown>;

    const healed: string[] = [];
    const strayKeys: string[] = [];

    for (const clinicDoc of owned.docs) {
      const clinicId = clinicDoc.id;
      if (typeof roles[clinicId] !== "string" || !roles[clinicId]) healed.push(clinicId);
      // The malformed literal field left behind by the old dotted-key write.
      const stray = `clinicRoles.${clinicId}`;
      if (Object.prototype.hasOwnProperty.call(userData, stray)) strayKeys.push(stray);
    }

    if (healed.length > 0) {
      const patch: Record<string, unknown> = {
        clinicRoles: Object.fromEntries(healed.map((id) => [id, OWNER_ROLE])),
      };
      if (!userData.defaultClinicId) patch.defaultClinicId = healed[0];
      // Merge is a deep merge for maps, so roles in other clinics survive.
      await userRef.set(patch, { merge: true });
    }

    // A field name containing a dot has to be deleted through an escaped FieldPath, otherwise
    // Firestore reads it as a path and silently misses the real field.
    for (const stray of strayKeys) {
      await userRef.update(new FieldPath(stray), FieldValue.delete());
    }

    const primary =
      healed[0] ||
      (typeof userData.defaultClinicId === "string" ? userData.defaultClinicId : null) ||
      owned.docs[0].id;

    return NextResponse.json({ ok: true, healed, clinicId: primary });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Self-heal failed";
    reportServerError("Onboarding self-heal error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
