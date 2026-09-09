import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { clinicPermissionsPatch, clinicPermissionsSeed } from "@/lib/server/clinicPermissions";
import { expandPermissions } from "@/lib/permissions";
import { INVITES_COLLECTION, inviteStatus, isInvitableRole, normalizeInviteCode } from "@/lib/inviteLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The colleague's side of an invite link.
 *
 *   GET  ?code=…      → what the link is for, before signing in: clinic name, role, status.
 *                       No auth: this is what the join page shows to someone who is not signed
 *                       in yet, so they know what they are signing in to. It reveals a clinic's
 *                       name to whoever holds the link, which the WhatsApp message already did.
 *   POST { code }     → signed-in caller joins the clinic with the invite's role.
 *
 * The grant is the same one /api/join-requests/approve makes — a staff card, the role in
 * `clinicRoles`, the role's permission floor in `clinicPermissions` — so a person who arrived by
 * link and a person who was approved by hand are indistinguishable afterwards. It runs in one
 * transaction with the invite's use count, so two people opening a single-use link at the same
 * moment cannot both get in.
 */
export async function GET(request: Request) {
  try {
    const code = normalizeInviteCode(new URL(request.url).searchParams.get("code"));
    if (!code) return NextResponse.json({ ok: false, error: "code is required" }, { status: 400 });
    const snap = await adminDb().collection(INVITES_COLLECTION).doc(code).get();
    if (!snap.exists) return NextResponse.json({ ok: true, found: false });
    const data = snap.data() || {};
    return NextResponse.json({
      ok: true,
      found: true,
      status: inviteStatus(data),
      clinicName: typeof data.clinicName === "string" ? data.clinicName : "",
      role: data.role,
    });
  } catch (error) {
    reportServerError("invite peek error:", error);
    return NextResponse.json({ ok: false, error: "Could not read the invite" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthedUser(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const code = normalizeInviteCode(body?.code);
    if (!code) return NextResponse.json({ ok: false, error: "code is required" }, { status: 400 });

    const db = adminDb();
    const inviteRef = db.collection(INVITES_COLLECTION).doc(code);
    const userRef = db.collection("users").doc(auth.uid);

    // Who the caller actually is, from Auth — not from anything the body might claim.
    const authUser = await adminAuth().getUser(auth.uid);

    const result = await db.runTransaction(async (tx) => {
      const [inviteSnap, userSnap] = await Promise.all([tx.get(inviteRef), tx.get(userRef)]);
      if (!inviteSnap.exists) return { error: "This invite link does not exist.", code: "invite-not-found", status: 404 as const };
      const invite = inviteSnap.data() || {};
      const clinicId = typeof invite.clinicId === "string" ? invite.clinicId : "";
      const role = invite.role;
      if (!clinicId || !isInvitableRole(role)) {
        return { error: "This invite is not usable.", code: "invite-unusable", status: 400 as const };
      }

      const userData = userSnap.data() || {};
      const existingRoles = (userData.clinicRoles || {}) as Record<string, unknown>;
      // Already in: the link has nothing to give, and must not spend a use on saying so.
      if (typeof existingRoles[clinicId] === "string" && existingRoles[clinicId]) {
        return { clinicId, role: existingRoles[clinicId] as string, alreadyMember: true };
      }

      const state = inviteStatus(invite);
      if (state !== "active") {
        const why =
          state === "revoked"
            ? "This invite link was cancelled by the clinic."
            : state === "expired"
              ? "This invite link has expired. Ask the clinic for a new one."
              : "This invite link has already been used. Ask the clinic for a new one.";
        return { error: why, code: `invite-${state}` as const, status: 410 as const };
      }

      const email = String(authUser.email || userData.email || "").toLowerCase();
      const name = String(authUser.displayName || userData.name || email || "New Team Member");
      const seededPermissions = expandPermissions(role, ["dashboard.view"]);

      const staffRef = db.collection(`clinics/${clinicId}/staff`).doc();
      tx.set(staffRef, {
        name,
        email,
        role,
        uid: auth.uid,
        isDentist: role === "Dentist",
        permissions: seededPermissions,
        createdAt: FieldValue.serverTimestamp(),
        joinedVia: `invite:${code}`,
      });

      if (userSnap.exists) {
        tx.update(userRef, {
          [`clinicRoles.${clinicId}`]: role,
          staffId: staffRef.id,
          ...(userData.defaultClinicId ? {} : { defaultClinicId: clinicId }),
          ...clinicPermissionsPatch(clinicId, role, seededPermissions),
        });
      } else {
        tx.set(
          userRef,
          {
            uid: auth.uid,
            name,
            email,
            clinicRoles: { [clinicId]: role },
            defaultClinicId: clinicId,
            staffId: staffRef.id,
            clinicPermissions: clinicPermissionsSeed(clinicId, role, seededPermissions),
          },
          { merge: true }
        );
      }

      tx.update(inviteRef, {
        usedCount: FieldValue.increment(1),
        usedBy: FieldValue.arrayUnion({ uid: auth.uid, name, email, at: new Date() }),
        lastUsedAt: FieldValue.serverTimestamp(),
      });

      return { clinicId, role: role as string, staffId: staffRef.id, clinicName: invite.clinicName ?? "" };
    });

    if ("error" in result) {
      return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not accept the invite";
    reportServerError("invite accept error:", error);
    return NextResponse.json({ ok: false, code: "invite-failed", error: message }, { status: 500 });
  }
}
