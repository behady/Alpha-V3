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
const GLOBAL_COLLECTIONS = new Set(["users", "clinics", "join_requests", "clinic_secrets"]);

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
    if (!roles[requested] && data.isSuperAdmin !== true) {
      throw new Error("You do not have access to that clinic.");
    }
    return requested;
  }

  const fallback = (data.defaultClinicId as string | undefined) || Object.keys(roles)[0];
  if (!fallback) throw new Error("This account is not linked to any clinic.");
  return fallback;
}
