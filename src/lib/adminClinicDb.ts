import { adminDb } from "@/lib/firebaseAdmin";
import type { CollectionReference, DocumentReference, DocumentData } from "firebase-admin/firestore";

/**
 * Server-side equivalent of `getClinicCollection` / `getClinicDoc` from lib/db-utils.
 *
 * The client writes every clinical record under `clinics/{clinicId}/…`, but several API routes
 * were reading root-level collections (`db.collection("patients")`) instead. Those root
 * collections do not exist — the database only has `clinics`, `users`, and a handful of other
 * genuinely-global collections at the top level — so those reads silently return empty, and a
 * write would create orphan data the rest of the app can never see.
 *
 * Anything server-side that touches clinic data should go through here so the path is correct
 * by construction rather than by remembering to prefix it.
 */

/** Collections that genuinely live at the root and must never be clinic-prefixed. */
const GLOBAL_COLLECTIONS = new Set([
  "users",
  "clinics",
  "join_requests",
  "clinic_secrets",
  // Keys that let an outside AI assistant into a clinic. Root-level for the same reason
  // clinic_secrets is, and listed here for a second reason too: lib/mcp/tools.ts asks
  // `isGlobalCollection` whether a collection name an assistant supplied would escape the
  // clinic, and a name missing from this set is one that would resolve to the root.
  "mcp_keys",
]);

export function isGlobalCollection(path: string): boolean {
  return GLOBAL_COLLECTIONS.has(path);
}

function assertClinicId(clinicId: string | null | undefined, path: string): string {
  const id = (clinicId || "").trim();
  if (!id) {
    throw new Error(
      `A clinicId is required to access "${path}". Refusing to fall back to a root collection, which would read or write the wrong tenant's data.`
    );
  }
  return id;
}

/** Collection reference scoped to a clinic. Global collections are returned unprefixed. */
export function adminClinicCollection(
  clinicId: string | null | undefined,
  path: string
): CollectionReference<DocumentData> {
  const db = adminDb();
  if (isGlobalCollection(path)) return db.collection(path);
  return db.collection("clinics").doc(assertClinicId(clinicId, path)).collection(path);
}

/** Document reference scoped to a clinic. */
export function adminClinicDoc(
  clinicId: string | null | undefined,
  path: string,
  docId: string
): DocumentReference<DocumentData> {
  return adminClinicCollection(clinicId, path).doc(docId);
}

/** Stored as a boolean, but tolerate the string form firestore.rules also accepts. */
function isSuperAdminProfile(data: Record<string, unknown>): boolean {
  return data.isSuperAdmin === true || data.isSuperAdmin === "true";
}

/**
 * The clinic a request that names none is about — and it is always one the user works at.
 *
 * `defaultClinicId` used to be returned as stored. It sits on the user's own profile, which the
 * browser could write, so any signed-in account could point it at a stranger's clinic and every
 * route that omits clinicId would then act there: reading payroll, deleting ledger rows. It is
 * honoured now only when the user holds a role in the clinic it names; otherwise the first clinic
 * they do hold a role in. A superadmin's default is taken as is, because they may act anywhere.
 *
 * Shared with requireStaffUser (lib/apiStaffAuth) on purpose: the clinic the permission check is
 * made against and the clinic the route then writes to must be the same clinic, and two copies of
 * this rule is how they drift apart.
 */
export function fallbackClinicIdFor(data: Record<string, unknown>): string | null {
  const roles = (data.clinicRoles && typeof data.clinicRoles === "object" ? data.clinicRoles : {}) as Record<string, unknown>;
  const stored = typeof data.defaultClinicId === "string" ? data.defaultClinicId.trim() : "";
  if (stored && (roles[stored] || isSuperAdminProfile(data))) return stored;
  return Object.keys(roles).find((id) => Boolean(roles[id])) ?? null;
}

/**
 * Work out which clinic a request is acting on, and prove the caller belongs to it.
 *
 * Most API routes never accepted a clinicId, so there is no field to read on the way in. This
 * resolves one from the authenticated user instead: an explicitly requested clinic is honoured
 * only when the user actually holds a role there, otherwise it falls back to their default.
 *
 * Membership is checked here rather than trusted from the request, because a clinicId arriving
 * in a body is just a string an attacker can change.
 */
export async function resolveUserClinicId(uid: string, requestedClinicId?: string | null): Promise<string> {
  const userSnap = await adminDb().collection("users").doc(uid).get();
  const data = userSnap.data();
  if (!data) throw new Error("User profile not found.");

  const roles = (data.clinicRoles || {}) as Record<string, string>;
  const requested = (requestedClinicId || "").trim();

  if (requested) {
    if (!roles[requested] && !isSuperAdminProfile(data)) {
      throw new Error("You do not have access to that clinic.");
    }
    return requested;
  }

  const fallback = fallbackClinicIdFor(data);
  if (!fallback) throw new Error("This account is not linked to any clinic.");
  return fallback;
}
