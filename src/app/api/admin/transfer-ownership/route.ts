import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireClinicOwner } from "@/lib/apiStaffAuth";
import { OWNER_ROLE, expandPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hands a clinic to somebody else.
 *
 * The only way Owner is ever granted or given up, and the reason /api/admin/update-user drops the
 * role instead of storing it. Ownership is two facts that have to agree — `clinics/{id}.ownerId`
 * and the `Owner` entry in that person's `clinicRoles` — and different parts of the app read one
 * or the other. Letting the role dropdown set it would let them drift apart: a clinic whose
 * `ownerId` names one person while a different account holds the role that protects them.
 *
 * The outgoing owner becomes an Admin rather than losing their place. They keep every day-to-day
 * power they had, since Owner and Admin pass the same checks, and give up only the protection —
 * which is the whole of what changes hands here.
 *
 * The three writes go in one transaction because a half-applied transfer is the worst outcome
 * available: two owners, or none. None is unrecoverable from inside the clinic — every guard then
 * refuses to let anyone promote anyone — and would need a superadmin to unpick.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const toUserDocId = typeof body?.toUserDocId === "string" ? body.toUserDocId.trim() : "";

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }
    if (!toUserDocId) {
      return NextResponse.json(
        { ok: false, error: "Choose who to hand the clinic to." },
        { status: 400 }
      );
    }

    // Not requireAdminUser: another Admin of the same clinic must not be able to do this.
    const auth = await requireClinicOwner(request, clinicId);
    if (!auth.ok) return auth.response;

    const db = adminDb();

    const targetSnap = await db.collection("users").doc(toUserDocId).get();
    const targetData = targetSnap.data();
    if (!targetSnap.exists || !targetData) {
      return NextResponse.json({ ok: false, error: "User profile not found" }, { status: 404 });
    }
    if (targetData.isSuperAdmin === true || targetData.isSuperAdmin === "true") {
      return NextResponse.json(
        { ok: false, error: "That account can't own a clinic." },
        { status: 403 }
      );
    }

    const targetUid = (typeof targetData.uid === "string" && targetData.uid) || toUserDocId;
    if (targetUid === auth.uid) {
      return NextResponse.json({ ok: false, error: "You already own this clinic." }, { status: 400 });
    }

    // Ownership goes to a colleague, never to an email typed into a box — they have to be on the
    // team first, which is also the only way an admin can have looked at their access.
    if (!(targetData.clinicRoles || {})[clinicId]) {
      return NextResponse.json(
        { ok: false, error: "That person is not a member of this clinic." },
        { status: 403 }
      );
    }

    const clinicRef = db.collection("clinics").doc(clinicId);
    const fromRef = db.collection("users").doc(auth.uid);
    const toRef = db.collection("users").doc(toUserDocId);

    // Owner and Admin both short-circuit every permission check, so both lists are empty by
    // design — see expandPermissions. Written on each side so neither is left carrying a list
    // that describes the role they used to hold.
    const ownerPermissions = expandPermissions(OWNER_ROLE, []);
    const adminPermissions = expandPermissions("Admin", []);

    await db.runTransaction(async (tx) => {
      const fromSnap = await tx.get(fromRef);
      if (!fromSnap.exists) throw new Error("Your own profile is missing.");

      tx.update(toRef, {
        [`clinicRoles.${clinicId}`]: OWNER_ROLE,
        [`clinicPermissions.${clinicId}`]: ownerPermissions,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.update(fromRef, {
        [`clinicRoles.${clinicId}`]: "Admin",
        [`clinicPermissions.${clinicId}`]: adminPermissions,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // The other half of the fact, in the same transaction so the two can never disagree.
      tx.update(clinicRef, { ownerId: targetUid, updatedAt: FieldValue.serverTimestamp() });
    });

    /**
     * The staff rows follow, outside the transaction.
     *
     * They are a display copy — the Users screen and the dentist pickers read them, no rule ever
     * does — so a failure here costs a stale label on one screen rather than a clinic in an
     * inconsistent state. Best effort on purpose: the transfer is already done.
     */
    await Promise.all(
      [
        { uid: targetUid, role: OWNER_ROLE, permissions: ownerPermissions },
        { uid: auth.uid, role: "Admin", permissions: adminPermissions },
      ].map(async ({ uid, role, permissions }) => {
        try {
          const rows = await db
            .collection(`clinics/${clinicId}/staff`)
            .where("uid", "==", uid)
            .get();
          await Promise.all(
            rows.docs.map((d) =>
              d.ref.update({ role, permissions, updatedAt: FieldValue.serverTimestamp() })
            )
          );
        } catch (error) {
          reportServerError("transfer-ownership: staff row not updated", error);
        }
      })
    );

    return NextResponse.json({ ok: true, newOwnerUid: targetUid });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Transfer failed";
    reportServerError("transfer-ownership", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
