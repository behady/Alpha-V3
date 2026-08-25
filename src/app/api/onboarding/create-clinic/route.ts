import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import { OWNER_ROLE } from "@/lib/permissions";

/**
 * Creates a Free Trial clinic and grants the caller Admin on it, atomically, server-side.
 * Firestore rules lock direct client writes to `clinics` and `users.clinicRoles` down to
 * superadmin-only, so self-signup must go through Admin SDK here instead.
 */
export async function POST(request: Request) {
  try {
    const authCheck = await requireAuthedUser(request);
    if (!authCheck.ok) return authCheck.response;
    const uid = authCheck.uid;

    const body = await request.json();
    const clinicName = typeof body?.clinicName === "string" ? body.clinicName.trim() : "";
    if (!clinicName) {
      return NextResponse.json({ ok: false, error: "Clinic name is required" }, { status: 400 });
    }

    const db = adminDb();
    const userRef = db.collection("users").doc(uid);

    /**
     * If this caller already owns a clinic they hold no role in, repair that one instead of
     * making another. Someone whose grant failed sees "you're not part of a clinic yet" and
     * presses Create again — without this, each press leaves behind one more orphan clinic that
     * only a superadmin can clean up. Clinics they *can* already reach are left alone, so
     * deliberately starting a second clinic still works.
     */
    const owned = await db.collection("clinics").where("ownerId", "==", uid).get();
    if (!owned.empty) {
      const existingRoles = ((await userRef.get()).data()?.clinicRoles || {}) as Record<string, unknown>;
      const orphan = owned.docs.find((d) => typeof existingRoles[d.id] !== "string" || !existingRoles[d.id]);
      if (orphan) {
        await userRef.set(
          { clinicRoles: { [orphan.id]: OWNER_ROLE }, defaultClinicId: orphan.id },
          { merge: true }
        );
        return NextResponse.json({ ok: true, clinicId: orphan.id, repaired: true });
      }
    }

    const clinicRef = db.collection("clinics").doc();
    const clinicId = clinicRef.id;

    await db.runTransaction(async (tx) => {
      tx.set(clinicRef, {
        name: clinicName,
        ownerId: uid,
        subscriptionTier: "Free Trial",
        status: "Active",
        createdAt: FieldValue.serverTimestamp(),
      });
      /**
       * The role has to be written as a NESTED OBJECT, not a dotted key.
       *
       * Firestore only interprets `"clinicRoles.<id>"` as a path to a nested field in `update()`.
       * In `set()` — even with merge — a dot in a key is part of the field NAME. So this used to
       * create a top-level field literally called `clinicRoles.abc123` and leave the real
       * `clinicRoles` map empty.
       *
       * The result was a signup that looked like it worked and wasn't: the clinic document was
       * created (so it appeared in the Super Admin list), but the owner had no role in it, so
       * ClinicContext saw zero clinics and bounced them straight back to "create a clinic".
       *
       * set+merge is still the right call over update(): it works whether or not the user document
       * exists yet, which matters because a first-time Google sign-in races with AuthContext
       * creating that document. Merge is a deep merge for maps, so roles in other clinics survive.
       */
      tx.set(
        userRef,
        {
          clinicRoles: { [clinicId]: OWNER_ROLE },
          defaultClinicId: clinicId,
        },
        { merge: true }
      );
    });

    return NextResponse.json({ ok: true, clinicId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create clinic";
    reportServerError("Create Clinic Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
