import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { OWNER_ROLE, expandPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gives a clinic's founder the Owner role, once.
 *
 * Every clinic created before the role existed granted its founder `Admin` and wrote their uid to
 * `clinics/{id}.ownerId`, and the two facts never met. On the Users screen the person paying for
 * the clinic looked exactly like the locum Admin they invited for a fortnight, and either could
 * demote, remove or re-password the other.
 *
 * A clinic Admin may run this for their own clinic — not because it needs their judgement, but
 * because it must run without one. The Users screen calls it on open, which is the first place
 * the distinction matters and the last place the owner would think to look for a migration
 * button. `repair-clinic-owners` is the superadmin equivalent for clinics whose owner cannot get
 * that far.
 *
 * Two things keep it safe to call on every visit:
 *
 *  - It only ever promotes an **Admin**. A founder who deliberately made themselves a Dentist and
 *    handed the running of the clinic to somebody else is left exactly where they are; this
 *    repairs a gap, it does not overrule a decision.
 *  - It refuses if any Owner already exists. A clinic with two owners is worse than one with none,
 *    and after a transfer `ownerId` names the new owner anyway.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const db = adminDb();

    const clinicSnap = await db.collection("clinics").doc(clinicId).get();
    const ownerId = clinicSnap.data()?.ownerId;
    if (typeof ownerId !== "string" || !ownerId) {
      return NextResponse.json({ ok: true, promoted: false, reason: "no-owner-recorded" });
    }

    const existingOwners = await db
      .collection("users")
      .where(`clinicRoles.${clinicId}`, "==", OWNER_ROLE)
      .limit(1)
      .get();
    if (!existingOwners.empty) {
      return NextResponse.json({ ok: true, promoted: false, reason: "already-has-owner" });
    }

    const ownerRef = db.collection("users").doc(ownerId);
    const ownerSnap = await ownerRef.get();
    if (!ownerSnap.exists) {
      return NextResponse.json({ ok: true, promoted: false, reason: "owner-account-missing" });
    }
    if ((ownerSnap.data()?.clinicRoles || {})[clinicId] !== "Admin") {
      return NextResponse.json({ ok: true, promoted: false, reason: "owner-is-not-an-admin" });
    }

    await ownerRef.update({
      [`clinicRoles.${clinicId}`]: OWNER_ROLE,
      // Owner and Admin both short-circuit every check, so this is the same empty list an Admin
      // carries — see expandPermissions. Written anyway so the field is never left describing the
      // role they used to hold.
      [`clinicPermissions.${clinicId}`]: expandPermissions(OWNER_ROLE, []),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The staff row is a display copy — the Users screen and the dentist pickers read it — so a
    // failure here costs a stale label, not access. Kept in step all the same.
    const staffRows = await db
      .collection(`clinics/${clinicId}/staff`)
      .where("uid", "==", ownerId)
      .get();
    await Promise.all(staffRows.docs.map((d) => d.ref.update({ role: OWNER_ROLE })));

    return NextResponse.json({ ok: true, promoted: true, ownerId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not set the clinic owner";
    reportServerError("ensure-owner", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
