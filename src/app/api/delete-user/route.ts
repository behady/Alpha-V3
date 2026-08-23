import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, userId, staffId, clinicId } = body;

    const authCheck = await requireAdminUser(request, clinicId);
    if (!authCheck.ok) return authCheck.response;

    if (!userId || !clinicId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminDb();

    // 1. Remove from clinic staff collection
    if (staffId) {
      await db.collection(`clinics/${clinicId}/staff`).doc(staffId).delete();
    }

    // 2. Remove clinicRole from root user doc — and the permission map that goes with it.
    // clinicPermissions is what firestore.rules reads; leaving it behind is harmless for access
    // (no role means no read and no blanket write) but it would resurrect the old grants intact
    // if the person were ever re-invited, which is not what re-inviting means.
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      [`clinicRoles.${clinicId}`]: FieldValue.delete(),
      [`clinicPermissions.${clinicId}`]: FieldValue.delete(),
    });

    // We intentionally do NOT delete the global Auth user (adminAuth().deleteUser(uid))
    // to preserve their access to other clinics if they have any, since this is a multi-tenant system.

    return NextResponse.json({ success: true, message: "User removed from clinic" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to remove user";
    console.error("Delete Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

