// src/lib/aiWritePolicy.ts
import { COLLECTION_WRITE_PERMISSIONS, isFullAccessRole } from "@/lib/permissions";

/**
 * What the assistant may change, and who is allowed to ask it to.
 *
 * Two separate questions, and conflating them is what left a hole here for months:
 *
 *   1. WHICH collections the assistant may touch at all — the sets below. Same answer for
 *      everybody; it exists to stop a crafted patient note steering the model at payroll.
 *   2. WHETHER THIS PERSON may make this change — `requiredWritePermission`. Different answer
 *      per caller, and it was not being asked.
 *
 * Only (1) was enforced. Every staff role shares one chat surface, and /api/gemini reaches
 * Firestore through the Admin SDK, which bypasses firestore.rules entirely — so a receptionist
 * with no clinical permission could ask the assistant to write a clinical note, and someone with
 * no finance permission could have it post a charge. Both are refused the instant they try it
 * from the screen that owns the action.
 *
 * Kept out of the route so both questions can be tested without standing up firebase-admin.
 */

/**
 * Reading is broad; writing is deliberately narrower.
 *
 * `staff` holds payroll (baseSalary, commissionPercentage) and `services` is the price list —
 * firestore.rules restricts both to Clinic Admins, but this route runs on the Admin SDK, which
 * bypasses rules entirely. Write access was previously checked against the READABLE set, so any
 * staff member with chat access could ask the assistant to edit their own salary. This set lists
 * exactly the collections the documented assistant workflows actually write.
 */
export const AI_WRITABLE_COLLECTIONS = new Set([
  "patients",
  "appointments",
  "tickets",
  "ledger",
  "clinical_notes",
  "inventory",
  "inventory_transactions",
]);

/** Deleting financial or clinical history is not something a chat turn should be able to do. */
export const AI_DELETABLE_COLLECTIONS = new Set([
  "appointments",
  "tickets",
  "ledger",
  "inventory_transactions",
]);

/**
 * The permission this write demands, or null when it needs none beyond clinic membership.
 *
 * COLLECTION_WRITE_PERMISSIONS is the same table firestore.rules mirrors, so the chat and the
 * browser give the same answer to the same question. **Absent means "no extra permission
 * needed", not "unknown, deny"** — `tickets` is absent because the rules hand it to any active
 * clinic member (see `memberMayWrite`), which requireStaffUser has already established. Denying
 * it here would make the assistant refuse what the page allows, which is its own kind of bug.
 */
export function requiredWritePermission(
  collection: string,
  mode: "create" | "update" | "delete",
): string | null {
  return COLLECTION_WRITE_PERMISSIONS[mode][String(collection || "").trim()] ?? null;
}

/** Whether this caller may make this change. Owner and Admin pass without consulting a list. */
export function mayWrite(
  collection: string,
  mode: "create" | "update" | "delete",
  role: string | null | undefined,
  permissions: readonly string[] | undefined,
): boolean {
  if (isFullAccessRole(role)) return true;
  const required = requiredWritePermission(collection, mode);
  if (!required) return true;
  return !!permissions?.includes(required);
}
