import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import { isOwnerRole } from "@/lib/permissions";

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

    /**
     * The owner is not removable, by anybody — including themselves.
     *
     * Removing them strips the role while `clinic.ownerId` goes on naming them, which leaves a
     * clinic owned by an account that no longer works there and a protection nobody can undo.
     * The way out is Transfer ownership: hand the clinic on first, then leave like anyone else.
     */
    const targetSnap = await db.collection("users").doc(userId).get();
    const targetRole = (targetSnap.data()?.clinicRoles || {})[clinicId];
    if (isOwnerRole(targetRole)) {
      return NextResponse.json(
        {
          error:
            "The clinic owner can't be removed. Use Transfer ownership to hand the clinic over first.",
        },
        { status: 403 }
      );
    }

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
    reportServerError("Delete Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

