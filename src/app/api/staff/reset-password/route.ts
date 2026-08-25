import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { isOwnerRole } from "@/lib/permissions";

/**
 * An admin sets a new password for a member of their own clinic — the recovery path for "I forgot
 * it", and for re-invited staff, whose old password survives re-inviting (the invite route reuses
 * an existing Auth account, so the password field on the invite form is ignored for them).
 *
 * "Their own clinic" is the entire point of this file. This used to check only "is the caller an
 * Admin somewhere" and then reset ANY uid it was handed — and anyone can become an Admin somewhere
 * in about a minute, because self-signup creates you a clinic and makes you its Admin. Admin of
 * your own empty trial clinic, plus any uid you could learn, equalled signing in as that person at
 * THEIR clinic. So the caller must administer a named clinic, and the target must demonstrably
 * work there:
 *
 *  - a `clinicRoles` entry for that clinic on the target's user document, or
 *  - a staff record in that clinic carrying the target's uid — which is what a freshly invited
 *    person may have before their user document ever gets a role written.
 *
 * Anyone else is "not yours to reset", however real the uid is.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const uid = typeof body?.uid === "string" ? body.uid.trim() : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";

    if (!clinicId) {
      return NextResponse.json({ error: "clinicId is required" }, { status: 400 });
    }

    // Admin of *this* clinic — not "an admin somewhere".
    const authCheck = await requireAdminUser(request, clinicId);
    if (!authCheck.ok) return authCheck.response;

    if (!uid || !newPassword) {
      return NextResponse.json({ error: "Missing user ID or password" }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }

    const db = adminDb();

    const userSnap = await db.collection("users").doc(uid).get();
    const hasRoleHere = Boolean((userSnap.data()?.clinicRoles || {})[clinicId]);

    /**
     * Never the owner's password, from here.
     *
     * This route exists so an admin can unlock the receptionist standing in front of them. Point
     * it at the owner and it stops being that: an Admin who sets the owner's password can sign in
     * as the one account nobody else can demote, and the clinic changes hands without anyone
     * agreeing to it. The owner uses the emailed reset link, which only whoever holds that inbox
     * can complete.
     */
    if (isOwnerRole((userSnap.data()?.clinicRoles || {})[clinicId]) && authCheck.uid !== uid) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The clinic owner's password can't be set from here. They can use the \"Forgot password\" link on the sign-in screen.",
        },
        { status: 403 }
      );
    }

    let worksHere = hasRoleHere;
    if (!worksHere) {
      const staffMatch = await db
        .collection(`clinics/${clinicId}/staff`)
        .where("uid", "==", uid)
        .limit(1)
        .get();
      worksHere = !staffMatch.empty;
    }

    if (!worksHere) {
      return NextResponse.json(
        { error: "That account is not a member of this clinic." },
        { status: 403 }
      );
    }

    await adminAuth().updateUser(uid, { password: newPassword });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reset password";
    reportServerError("Reset Password Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
