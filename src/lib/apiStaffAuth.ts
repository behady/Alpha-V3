import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { CLINIC_INACTIVE_CODE, clinicActivity } from "@/lib/clinicStatus";
import { isFullAccessRole, isOwnerRole } from "@/lib/permissions";

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
  if (allRoles.includes("Owner")) return "Owner";
  if (allRoles.includes("Admin")) return "Admin";

  // Fall back to legacy
  return legacyRole;
}

export type StaffAuthOptions = {
  /**
   * Let this call through even when the clinic's subscription has lapsed.
   *
   * Pass it for reads. A clinic that stops paying keeps full read access to its own records —
   * that is what firestore.rules does (`isClinicActive` is consulted from `memberMayWrite`, not
   * from any read grant), and the server has to match it or the two doors into the same database
   * give different answers.
   *
   * The default is the other way round on purpose. A gate you have to remember to add is a gate
   * that will be missing from the route somebody writes next year — which is precisely how the
   * expiry check went absent from every money route: nobody removed it, the writes just moved to
   * a path that had never had it. Defaulting to deny means a new route is gated by existing, and
   * `allowInactive: true` is a decision somebody typed and can be grepped for.
   */
  allowInactive?: boolean;
};

export async function requireStaffUser(request: Request, clinicId?: string, options?: StaffAuthOptions) {
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

    // Stored as a boolean, but tolerate the string form firestore.rules also accepts.
    const isSuperAdmin = data.isSuperAdmin === true || data.isSuperAdmin === "true";

    // Is the clinic still entitled to be written to?
    //
    // firestore.rules has always asked this, and still does, for every write the browser makes
    // directly. It cannot ask it for a write made here: the Admin SDK bypasses rules by design.
    // So when payments, procedures and appointment deletes moved server-side to make the
    // permission checkboxes real, they moved out from behind the expiry gate at the same time,
    // and an expired clinic could go on taking money through a route that never asked.
    //
    // Asked once, here, rather than in each route, for the same reason the permission check lives
    // here: 37 routes reach Firestore through the Admin SDK, and a rule that has to be repeated
    // 37 times is a rule that is already wrong somewhere.
    //
    // Costs one document read per authed call that names a clinic. That is the price of the two
    // doors agreeing, and it is only paid once per request rather than once per write.
    //
    // Superadmins are exempt: reactivating a lapsed clinic is done from the superadmin panel, so
    // a gate that locked them out would lock the clinic out permanently.
    if (clinicId && !options?.allowInactive && !isSuperAdmin) {
      const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
      const activity = clinicActivity(clinicSnap.data() ?? null);
      if (!activity.active) {
        return {
          ok: false as const,
          response: NextResponse.json(
            // `reason` carries the machine code across this codebase (see MoneyApiError), so the
            // code goes there and the expired/suspended distinction gets its own field. Matching
            // the existing convention matters more than the field being better named: a client
            // that has to special-case one route's error shape will eventually not.
            { ok: false, error: activity.message, reason: CLINIC_INACTIVE_CODE, clinicStatus: activity.reason },
            { status: 403 }
          ),
        };
      }
    }
    // The per-clinic map first — clinicPermissions[clinicId] is what firestore.rules enforces and
    // what User Management writes, so reading anything else here would let the API and the rules
    // give different answers about the same person. The flat array is the fallback for accounts
    // at clinics that have not been migrated (this route can be called for any clinic), and for
    // clinic-agnostic calls where there is no map to consult. Absent means "none granted", not
    // "everything" — a user with no list is a user who has been given nothing.
    const clinicMap =
      clinicId && data.clinicPermissions && typeof data.clinicPermissions === "object"
        ? (data.clinicPermissions as Record<string, unknown>)[clinicId]
        : undefined;
    const source = Array.isArray(clinicMap) ? clinicMap : data.permissions;
    const permissions = Array.isArray(source)
      ? (source as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    const name =
      (typeof data.name === "string" && data.name.trim()) ||
      (typeof data.displayName === "string" && data.displayName.trim()) ||
      (typeof data.email === "string" && data.email.trim()) ||
      "Staff";
    return { ok: true as const, uid: decoded.uid, role, permissions, name, isSuperAdmin };
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

/**
 * Does this caller hold a specific granular permission in this clinic?
 *
 * Until money writes moved server-side, `finance.edit` and friends were checked only in the
 * browser, where they decide whether a button renders. Anyone signed in to the clinic could write
 * any ledger row straight through the Firestore SDK regardless — the lock was a sticker. The
 * routes that now own those writes check here instead, so the permission means something.
 *
 * A Clinic Admin passes every check by definition: the catalogue exists to grant slices of what an
 * Admin already has, and User Management does not (and should not) require an Admin to tick their
 * own boxes.
 */
export async function requireStaffPermission(
  request: Request,
  clinicId: string | undefined,
  permission: string,
  options?: StaffAuthOptions
) {
  const staff = await requireStaffUser(request, clinicId, options);
  if (!staff.ok) return staff;
  if (isFullAccessRole(staff.role)) return staff;
  if (staff.permissions.includes(permission)) return staff;
  return {
    ok: false as const,
    response: NextResponse.json(
      { ok: false, error: `You do not have permission to do this (${permission}).` },
      { status: 403 }
    ),
  };
}

/** Admin OR Owner. They can do the same things; only who may act on THEM differs. */
export async function requireAdminUser(request: Request, clinicId?: string, options?: StaffAuthOptions) {
  const staff = await requireStaffUser(request, clinicId, options);
  if (!staff.ok) return staff;
  if (!isFullAccessRole(staff.role)) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "Admin access required" }, { status: 403 }),
    };
  }
  return staff;
}

/**
 * The clinic's owner, and nobody else — not even another Admin of the same clinic.
 *
 * One action needs this: handing the clinic to someone else. Everything an owner does day to day
 * goes through requireAdminUser, because an Admin can do all of it too.
 */
export async function requireClinicOwner(request: Request, clinicId: string, options?: StaffAuthOptions) {
  const staff = await requireStaffUser(request, clinicId, options);
  if (!staff.ok) return staff;
  if (!isOwnerRole(staff.role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "Only the clinic owner can do this." },
        { status: 403 }
      ),
    };
  }
  return staff;
}



/**
 * Platform-owner access. Stricter than requireAdminUser, which any CLINIC Admin satisfies.
 *
 * Endpoints that act across tenants — or that accept credentials for another Firebase project,
 * as the migration does — must not be reachable by a clinic Admin. Otherwise the owner of one
 * clinic could write arbitrary data into another clinic's records.
 *
 * Two route files already carry a private copy of this check; this is the shared one for new
 * callers.
 */
export async function requireSuperAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const snap = await adminDb().collection("users").doc(decoded.uid).get();
    const data = snap.data();
    // Stored as a boolean, but tolerate the string form firestore.rules also accepts.
    if (!data || (data.isSuperAdmin !== true && data.isSuperAdmin !== "true")) {
      return {
        ok: false as const,
        response: NextResponse.json({ ok: false, error: "Super admins only" }, { status: 403 }),
      };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch (error) {
    console.error("requireSuperAdmin verifyIdToken failed", error);
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 }) };
  }
}
