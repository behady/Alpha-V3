/**
 * The rules behind deleting a clinic from the superadmin console, and putting it back.
 *
 * Pure, so they can be tested without Firestore. The route in api/admin/clinic-trash does the
 * reading and writing; nothing here touches a database.
 *
 * Why this exists: the Delete button used to remove the clinic's header document in one click
 * behind a generic "are you sure?". One mis-click took a live clinic off the air — every staff
 * login bounced, every screen went blank — and the header could only be recovered because
 * point-in-time recovery happened to be switched on and somebody was awake within the window.
 * The subtree (patients, ledger, notes) was never in danger; the header is small and cheap to
 * keep, so from now on it is kept.
 *
 * Two rules:
 *
 *   1. The person deleting must type the clinic's exact name. A dialog you can dismiss with
 *      Enter is not a safeguard; a name you have to read and copy is.
 *   2. Nothing is deleted without a copy. The header moves to `deleted_clinics/{id}` first,
 *      stamped with who and when, and "Restore" moves it back. The copy is stripped of those
 *      stamps on the way back so a restored clinic is the clinic as it was.
 */

export const DELETED_CLINICS_COLLECTION = "deleted_clinics";

/** The fields the trash adds on top of the header. Removed again on restore. */
const TRASH_STAMPS = ["deletedAt", "deletedBy", "deletedByEmail"] as const;

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Case matters, surrounding whitespace does not. Case-insensitive matching would let "alpha
 * dental clinic" delete "Alpha Dental Clinic", which is exactly the sort of half-attention the
 * rule is there to catch; a doubled space or a trailing one is a keyboard accident, not
 * inattention.
 */
export function typedNameMatches(typed: unknown, actual: unknown): boolean {
  const want = normalizeName(actual);
  if (!want) return false;
  return normalizeName(typed) === want;
}

export type TrashStamp = { uid: string; email?: string | null; at: unknown };

/** The document written to `deleted_clinics`: the header, plus who and when. */
export function trashRecordFrom(header: Record<string, unknown>, stamp: TrashStamp): Record<string, unknown> {
  const record: Record<string, unknown> = { ...header, deletedAt: stamp.at, deletedBy: stamp.uid };
  if (stamp.email) record.deletedByEmail = stamp.email;
  return record;
}

/** The header to write back to `clinics`: the trash record without its stamps. */
export function headerFromTrash(record: Record<string, unknown>): Record<string, unknown> {
  const header: Record<string, unknown> = { ...record };
  for (const key of TRASH_STAMPS) delete header[key];
  return header;
}
