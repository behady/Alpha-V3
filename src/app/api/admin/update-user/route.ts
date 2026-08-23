import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clinicPermissionsPatch } from "@/lib/server/clinicPermissions";

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

    // The field firestore.rules reads. `permissions` above is the flat list the browser's guards
    // consult; the rules have always looked up clinicPermissions[clinicId] instead, and nothing
    // wrote it — so every rule that consulted it passed for everyone. Written here whenever either
    // the ticked boxes or the role changes, because the stored value is the two combined.
    if (clinicId && (patch.permissions !== undefined || patch.role !== undefined)) {
      const effectiveRole =
        (typeof patch.role === "string" && patch.role) ||
        ((userData.clinicRoles as Record<string, string> | undefined)?.[clinicId] ?? null);
      const granted = patch.permissions !== undefined ? patch.permissions : userData.permissions;
      Object.assign(userPatch, clinicPermissionsPatch(clinicId, effectiveRole, granted));
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
    console.error("admin/update-user", error);
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

