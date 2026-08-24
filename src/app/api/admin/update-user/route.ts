import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { expandPermissions, sanitizePermissionList } from "@/lib/permissions";

const ALLOWED_KEYS = new Set(["role", "isDentist", "permissions", "staffId"]);

function sanitizePatch(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (key === "permissions") {
      if (!Array.isArray(value)) continue;
      out.permissions = value.filter((p) => typeof p === "string");
      continue;
    }
    if (key === "isDentist") {
      out.isDentist = value === true;
      continue;
    }
    if (key === "role" && typeof value === "string" && value.trim()) {
      out.role = value.trim();
      continue;
    }
    if (key === "staffId" && typeof value === "string" && value.trim()) {
      out.staffId = value.trim();
    }
  }
  return out;
}

async function resolveStaffDocId(
  clinicId: string,
  userDocId: string,
  userData: Record<string, unknown>
): Promise<string | null> {
  const db = adminDb();
  const staffCollection = `clinics/${clinicId}/staff`;

  const staffId = typeof userData.staffId === "string" ? userData.staffId : "";
  if (staffId) {
    const snap = await db.collection(staffCollection).doc(staffId).get();
    if (snap.exists) return staffId;
  }

  const uid =
    (typeof userData.uid === "string" && userData.uid) ||
    userDocId;

  const byUid = await db.collection(staffCollection).where("uid", "==", uid).limit(1).get();
  if (!byUid.empty) return byUid.docs[0].id;

  const byEmail =
    typeof userData.email === "string" && userData.email.trim()
      ? await db
          .collection(staffCollection)
          .where("email", "==", userData.email.trim().toLowerCase())
          .limit(1)
          .get()
      : null;
  if (byEmail && !byEmail.empty) return byEmail.docs[0].id;

  return null;
}

export async function POST(request: Request) {
  try {
    // Clone the request so we can read body twice (once for clinicId, once for auth)
    const body = await request.json();
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";

    // Required, not optional. With no clinic named, requireAdminUser degrades to "is this caller
    // an Admin anywhere" — and anyone is, a minute after self-signup creates them a trial clinic
    // they administer. That plus an arbitrary userDocId meant any account on the platform could
    // have its role, permissions and staffId rewritten by a stranger. Same hole, same fix as
    // staff/reset-password: name the clinic, prove the caller administers it, prove the target
    // works there.
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const userDocId = typeof body?.userDocId === "string" ? body.userDocId.trim() : "";
    const patch = sanitizePatch(body?.patch);

    if (!userDocId) {
      return NextResponse.json({ ok: false, error: "userDocId is required" }, { status: 400 });
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "No valid fields to update" }, { status: 400 });
    }

    const db = adminDb();
    const userRef = db.collection("users").doc(userDocId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ ok: false, error: "User profile not found" }, { status: 404 });
    }

    const userData = userSnap.data() || {};

    // The target must be a member of the clinic the caller administers — either a role on the
    // user document, or a staff record carrying their uid (a freshly invited person can have the
    // second before the first).
    const targetRoles = (userData.clinicRoles || {}) as Record<string, unknown>;
    let targetWorksHere = Boolean(targetRoles[clinicId]);
    if (!targetWorksHere) {
      const targetUid = (typeof userData.uid === "string" && userData.uid) || userDocId;
      const staffMatch = await db
        .collection(`clinics/${clinicId}/staff`)
        .where("uid", "==", targetUid)
        .limit(1)
        .get();
      targetWorksHere = !staffMatch.empty;
    }
    if (!targetWorksHere) {
      return NextResponse.json(
        { ok: false, error: "That account is not a member of this clinic." },
        { status: 403 }
      );
    }

    // Update root user document
    const userPatch: Record<string, unknown> = { ...patch, updatedAt: FieldValue.serverTimestamp() };
    
    // Also update clinicRoles if role is being changed and clinicId is provided
    if (patch.role && clinicId) {
      userPatch[`clinicRoles.${clinicId}`] = patch.role;
    }

    // clinicPermissions[clinicId] is the list every check actually consults — the Firestore rules
    // and the API routes both read it. The flat `permissions` and the staff document's copy are
    // kept written to the same value so no screen ever shows a different answer than the one being
    // enforced; three copies that could disagree is how the checkboxes spent years as decoration.
    //
    // Ticked boxes are stored VERBATIM (validated against the catalogue, nothing added). The first
    // version folded the role's baseline back in on every save, which meant a baseline permission
    // could never be unticked: the box cleared on screen and the grant survived in the map. The
    // baseline belongs at seeding time, where it is the starting ticks — not under an admin's
    // explicit decision. A role change without a permission edit still re-expands from the new
    // role, because switching someone to Dentist SHOULD deal them the Dentist floor.
    if (patch.permissions !== undefined) {
      const verbatim = sanitizePermissionList(patch.permissions);
      patch.permissions = verbatim;
      userPatch.permissions = verbatim;
      userPatch[`clinicPermissions.${clinicId}`] = verbatim;
    } else if (patch.role !== undefined) {
      const currentEffective =
        (userData.clinicPermissions as Record<string, string[]> | undefined)?.[clinicId] ??
        userData.permissions;
      const expanded = expandPermissions(String(patch.role), currentEffective);
      patch.permissions = expanded;
      userPatch.permissions = expanded;
      userPatch[`clinicPermissions.${clinicId}`] = expanded;
    }

    await userRef.update(userPatch);

    // Update clinic-scoped staff document
    if (clinicId) {
      const staffDocId = await resolveStaffDocId(clinicId, userDocId, userData);
      if (staffDocId) {
        await db
          .collection(`clinics/${clinicId}/staff`)
          .doc(staffDocId)
          .update({ ...patch, updatedAt: FieldValue.serverTimestamp() });

        // Also link staffId on user doc if missing
        if (userData.staffId !== staffDocId) {
          await userRef.update({ staffId: staffDocId });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    reportServerError("admin/update-user", error);
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

