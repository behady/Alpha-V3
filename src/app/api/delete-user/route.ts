import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import { isOwnerRole } from "@/lib/permissions";
import { staffIdentityPatch } from "@/lib/server/clinicPermissions";

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
    const target = targetSnap.data() || {};
    const targetRoles = (target.clinicRoles || {}) as Record<string, unknown>;
    const targetRole = typeof targetRoles[clinicId] === "string" ? (targetRoles[clinicId] as string) : null;
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
    const patch: Record<string, unknown> = {
      [`clinicRoles.${clinicId}`]: FieldValue.delete(),
      [`clinicPermissions.${clinicId}`]: FieldValue.delete(),
    };

    // The default and the flat copies go with the role when they were about this clinic.
    //
    // Left behind, `defaultClinicId` kept naming a clinic the person had been removed from, and
    // the flat `role`/`permissions` kept describing the job they no longer held there. Access no
    // longer trusts either (requireStaffUser and resolveUserClinicId check clinicRoles), but the
    // browser renders from the flat copies, and a stale default lands the person on a clinic they
    // cannot open. The default moves to another clinic they still work at, the same way the
    // clinic trash does it (lib/clinicTrash letGoMembers), and the flat copies are rewritten from
    // that clinic — or removed when this was the only one.
    const remaining = Object.keys(targetRoles).filter((id) => id !== clinicId && targetRoles[id]);
    const wasDefault = target.defaultClinicId === clinicId;
    if (wasDefault || remaining.length === 0) {
      const next = remaining.find((id) => id === target.defaultClinicId) ?? remaining[0];
      if (next) {
        const nextRole = typeof targetRoles[next] === "string" ? (targetRoles[next] as string) : "";
        const nextPerms = ((target.clinicPermissions || {}) as Record<string, unknown>)[next];
        Object.assign(
          patch,
          staffIdentityPatch(
            nextRole,
            Array.isArray(nextPerms) ? nextPerms.filter((p): p is string => typeof p === "string") : []
          )
        );
        if (wasDefault) patch.defaultClinicId = next;
      } else {
        patch.defaultClinicId = FieldValue.delete();
        patch.role = FieldValue.delete();
        patch.permissions = FieldValue.delete();
        patch.isDentist = FieldValue.delete();
      }
    }

    const userRef = db.collection("users").doc(userId);
    await userRef.update(patch);

    // We intentionally do NOT delete the global Auth user (adminAuth().deleteUser(uid))
    // to preserve their access to other clinics if they have any, since this is a multi-tenant system.

    return NextResponse.json({ success: true, message: "User removed from clinic" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to remove user";
    reportServerError("Delete Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

