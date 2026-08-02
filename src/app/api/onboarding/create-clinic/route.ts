import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";

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
    const clinicRef = db.collection("clinics").doc();
    const clinicId = clinicRef.id;
    const userRef = db.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      tx.set(clinicRef, {
        name: clinicName,
        ownerId: uid,
        subscriptionTier: "Free Trial",
        status: "Active",
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        userRef,
        {
          [`clinicRoles.${clinicId}`]: "Admin",
          defaultClinicId: clinicId,
        },
        { merge: true }
      );
    });

    return NextResponse.json({ ok: true, clinicId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create clinic";
    console.error("Create Clinic Error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
