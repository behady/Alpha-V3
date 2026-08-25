import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { OWNER_ROLE } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Restores Admin access to clinic owners who were locked out of their own clinic.
 *
 * The self-signup endpoint used to grant the owner's role with `set()` and a dotted key
 * (`clinicRoles.<id>`). Firestore only reads dots as a path in `update()`; in `set()` the dot is
 * part of the field NAME. So those accounts ended up with a useless top-level field literally
 * called `clinicRoles.abc123` while the real `clinicRoles` map stayed empty. The clinic existed —
 * it showed up in the Super Admin list — but its owner had no role in it and was bounced back to
 * "create a clinic" forever.
 *
 * The write bug is fixed, but that only helps new signups. Every clinic created before the fix
 * still has a locked-out owner, and they cannot repair themselves: /api/admin/repair requires the
 * caller to already be an Admin *of that clinic*, which is the exact thing that is missing.
 *
 * So this is superadmin-only, and it works off `clinics.ownerId` rather than trusting the broken
 * field. Idempotent: re-running it changes nothing once accounts are healthy.
 */

async function requireSuperAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const snap = await adminDb().collection("users").doc(decoded.uid).get();
    const data = snap.data();
    if (!data || (data.isSuperAdmin !== true && data.isSuperAdmin !== "true")) {
      return {
        ok: false as const,
        response: NextResponse.json({ ok: false, error: "Super admins only" }, { status: 403 }),
      };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 }) };
  }
}

type Repair = { clinicId: string; clinicName: string; ownerId: string; action: string };

export async function POST(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  // Default to a dry run. Repairing every clinic on the platform is not something that should
  // happen because somebody opened a URL.
  const body = (await request.json().catch(() => ({}))) as { apply?: boolean };
  const apply = body.apply === true;

  try {
    const db = adminDb();
    const clinicsSnap = await db.collection("clinics").get();

    const repairs: Repair[] = [];
    const skipped: string[] = [];

    for (const clinicDoc of clinicsSnap.docs) {
      const clinic = clinicDoc.data() || {};
      const clinicId = clinicDoc.id;
      const ownerId = typeof clinic.ownerId === "string" ? clinic.ownerId.trim() : "";
      const clinicName = String(clinic.name || "(unnamed)");

      if (!ownerId) {
        skipped.push(`${clinicId} (${clinicName}): no ownerId recorded`);
        continue;
      }

      const userRef = db.collection("users").doc(ownerId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        skipped.push(`${clinicId} (${clinicName}): owner ${ownerId} has no user document`);
        continue;
      }

      const userData = userSnap.data() || {};
      const roles = (userData.clinicRoles || {}) as Record<string, unknown>;
      const alreadyGranted = typeof roles[clinicId] === "string" && roles[clinicId];

      // The malformed literal field, if this account was hit by the bug.
      const strayKey = `clinicRoles.${clinicId}`;
      const hasStray = Object.prototype.hasOwnProperty.call(userData, strayKey);

      if (alreadyGranted && !hasStray) continue;

      const actions: string[] = [];
      if (!alreadyGranted) actions.push("granted Owner");
      if (hasStray) actions.push("removed malformed field");

      repairs.push({ clinicId, clinicName, ownerId, action: actions.join(" + ") });

      if (apply) {
        const patch: Record<string, unknown> = {};
        if (!alreadyGranted) {
          // Nested object, not a dotted key — the whole point of this repair.
          patch.clinicRoles = { [clinicId]: OWNER_ROLE };
          if (!userData.defaultClinicId) patch.defaultClinicId = clinicId;
        }
        await userRef.set(patch, { merge: true });

        // Deleting a field whose name contains a dot needs an escaped FieldPath, otherwise
        // Firestore reads it as a path and silently misses the real field.
        if (hasStray) {
          await userRef.update(new FieldPath(strayKey), FieldValue.delete());
        }
      }
    }

    return NextResponse.json({
      ok: true,
      applied: apply,
      clinicsChecked: clinicsSnap.size,
      needingRepair: repairs.length,
      repairs,
      skipped,
      hint: apply ? undefined : "Nothing was changed. Send { \"apply\": true } to perform the repair.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Repair failed";
    reportServerError("repair-clinic-owners:", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
