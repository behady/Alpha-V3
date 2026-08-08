import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

/**
 * Resolves the effective role for a user.
 *
 * When a clinicId is named, a role in THAT clinic is the only thing that grants access.
 * This previously fell through to "is this user an Admin in any clinic at all?", which meant
 * the Admin of one clinic was handed Admin on every other clinic they had no role in. The
 * clinicId arrives in a request body, so it is caller-controlled — `gemini/route.ts` reads it
 * straight off `body` — and that fallback turned it into a cross-tenant read/write of patient
 * records. Superadmins are allowed through explicitly instead, matching `resolveUserClinicId`
 * in lib/adminClinicDb and the `isSuperAdmin()` rule in firestore.rules.
 *
 * The legacy flat `role` field and the admin-anywhere check still apply to clinic-agnostic
 * calls, where there is no specific tenant to check membership against.
 */
function resolveRole(data: Record<string, unknown>, clinicId?: string): string | null {
  // Legacy flat role
  const legacyRole = typeof data.role === "string" ? data.role : null;

  // Multi-clinic roles
  const clinicRoles = (data.clinicRoles || {}) as Record<string, string>;

  // Stored as a boolean, but tolerate the string form the rules file also accepts.
  if (data.isSuperAdmin === true || data.isSuperAdmin === "true") return "Admin";

  if (clinicId) {
    return clinicRoles[clinicId] || null;
  }

  // Check if admin in any clinic
  const allRoles = Object.values(clinicRoles);
  if (allRoles.includes("Admin")) return "Admin";

  // Fall back to legacy
  return legacyRole;
}

export async function requireStaffUser(request: Request, clinicId?: string) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const userSnap = await adminDb().collection("users").doc(decoded.uid).get();
    const data = userSnap.data();
    if (!data) {
      return { ok: false as const, response: NextResponse.json({ ok: false, error: "User profile not found" }, { status: 403 }) };
    }

    const role = resolveRole(data as Record<string, unknown>, clinicId);
    if (!role || role === "Patient") {
      return { ok: false as const, response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
    }
    return { ok: true as const, uid: decoded.uid, role };
  } catch (error) {
    console.error("requireStaffUser verifyIdToken failed", error);
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 }) };
  }
}

/**
 * Verifies the caller's ID token without requiring any existing clinic role —
 * for endpoints a brand-new user (no clinicRoles yet) must be able to call, e.g. self-signup.
 */
export async function requireAuthedUser(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { ok: true as const, uid: decoded.uid };
  } catch (error) {
    console.error("requireAuthedUser verifyIdToken failed", error);
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 }) };
  }
}

export async function requireAdminUser(request: Request, clinicId?: string) {
  const staff = await requireStaffUser(request, clinicId);
  if (!staff.ok) return staff;
  if (staff.role !== "Admin") {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Admin access required" }, { status: 403 }),
    };
  }
  return staff;
}


