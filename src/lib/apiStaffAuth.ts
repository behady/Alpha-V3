import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";

/**
 * Resolves the effective role for a user. Checks:
 * 1. The legacy flat `role` field on the root user doc.
 * 2. The `clinicRoles` map — if a specific clinicId is provided, checks that entry;
 *    otherwise checks if the user is Admin in ANY clinic.
 */
function resolveRole(data: Record<string, unknown>, clinicId?: string): string | null {
  // Legacy flat role
  const legacyRole = typeof data.role === "string" ? data.role : null;

  // Multi-clinic roles
  const clinicRoles = (data.clinicRoles || {}) as Record<string, string>;

  if (clinicId && clinicRoles[clinicId]) {
    return clinicRoles[clinicId];
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


