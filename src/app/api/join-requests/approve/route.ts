import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import { clinicPermissionsPatch, clinicPermissionsSeed } from "@/lib/server/clinicPermissions";

const ALLOWED_ROLES = new Set(["Admin", "Dentist", "Assistant", "Receptionist"]);

/**
 * Approves a join request: adds the person to the clinic's staff and grants them a role.
 *
 * This has to be server-side. The screen used to do it from the browser, and it could not work:
 * firestore.rules forbid a user — including a Clinic Admin — from writing anyone's `clinicRoles`,
 * so the grant was always denied and approving only ever showed "Error processing request". Worse,
 * the client wrote the profile with a plain `set()` on the *root* users document (db-utils maps
 * "users" to the root collection, not a clinic subcollection), which would have erased the
 * person's roles in every other clinic had it been permitted.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const role = typeof body?.role === "string" && ALLOWED_ROLES.has(body.role) ? body.role : "Assistant";

    if (!requestId || !clinicId) {
      return NextResponse.json({ ok: false, error: "requestId and clinicId are required" }, { status: 400 });
    }

    // Admin of *this* clinic — not "an admin somewhere". The clinicId arrives in the body.
    const authCheck = await requireAdminUser(request, clinicId);
    if (!authCheck.ok) return authCheck.response;

    const db = adminDb();
    const reqRef = db.collection("join_requests").doc(requestId);
    const reqSnap = await reqRef.get();
    const reqData = reqSnap.data();

    if (!reqSnap.exists || !reqData) {
      return NextResponse.json({ ok: false, error: "Join request not found" }, { status: 404 });
    }
    // The caller proved they administer `clinicId`; the request must be for that same clinic,
    // otherwise an admin of one clinic could approve a request addressed to another.
    if (reqData.clinicId !== clinicId) {
      return NextResponse.json({ ok: false, error: "This request is for a different clinic" }, { status: 403 });
    }
    if (String(reqData.status || "").toLowerCase() !== "pending") {
      return NextResponse.json({ ok: false, error: "This request has already been handled" }, { status: 409 });
    }

    const targetUid = typeof reqData.userId === "string" ? reqData.userId : "";
    if (!targetUid) {
      return NextResponse.json({ ok: false, error: "Request has no user attached" }, { status: 400 });
    }

    // Older requests carry userName/userEmail; newer ones carry name/email.
    const name = String(reqData.name || reqData.userName || "New Team Member");
    const email = String(reqData.email || reqData.userEmail || "").toLowerCase();

    // "appointments.view" and "patients.view" are not permission ids — the catalogue spells those
    // access.appointments and access.patients — so the seed granted one real permission and two
    // strings that match nothing. Harmless while nothing enforced the list; not harmless now.
    // expandPermissions() supplies the role's floor, which is what this was reaching for.
    const seededPermissions = ["dashboard.view"];

    const staffRef = await db.collection(`clinics/${clinicId}/staff`).add({
      name,
      email,
      role,
      uid: targetUid,
      isDentist: false,
      permissions: seededPermissions,
      createdAt: FieldValue.serverTimestamp(),
    });

    const userRef = db.collection("users").doc(targetUid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      // Dotted key with update(): the only form Firestore reads as a path into the nested map.
      await userRef.update({
        [`clinicRoles.${clinicId}`]: role,
        staffId: staffRef.id,
        // The field firestore.rules reads. Per-clinic, so approving someone into a second clinic
        // cannot disturb the access they hold at the first.
        ...clinicPermissionsPatch(clinicId, role, seededPermissions),
      });
    } else {
      await userRef.set(
        {
          uid: targetUid,
          name,
          email,
          clinicRoles: { [clinicId]: role },
          staffId: staffRef.id,
          clinicPermissions: clinicPermissionsSeed(clinicId, role, seededPermissions),
        },
        { merge: true }
      );
    }

    await reqRef.set({ status: "approved", approvedAt: FieldValue.serverTimestamp() }, { merge: true });

    return NextResponse.json({ ok: true, staffId: staffRef.id, role });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to approve join request";
    console.error("Approve join request error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
