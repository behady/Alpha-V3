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
 * Three rules:
 *
 *   1. The person deleting must type the clinic's exact name. A dialog you can dismiss with
 *      Enter is not a safeguard; a name you have to read and copy is.
 *   2. Nothing is deleted without a copy. The header moves to `deleted_clinics/{id}` first,
 *      stamped with who and when, and "Restore" moves it back. The copy is stripped of those
 *      stamps on the way back so a restored clinic is the clinic as it was.
 *   3. The staff are let go, and remembered. A deleted clinic used to leave every member's
 *      `clinicRoles` pointing at it, and the app follows roles, not headers: the owner signed in
 *      and landed inside the "deleted" clinic with all its patients on screen, and could not sign
 *      up fresh with the same account because the app decided they already belonged somewhere.
 *      Now the delete removes the clinic from each member's roles and keeps who-had-what in the
 *      trash record, and Restore hands the roles back.
 */

export const DELETED_CLINICS_COLLECTION = "deleted_clinics";

/** The fields the trash adds on top of the header. Removed again on restore. */
const TRASH_STAMPS = ["deletedAt", "deletedBy", "deletedByEmail", "members"] as const;

/** A sentinel for "delete this field", so these rules do not import firebase-admin. */
export const REMOVE_FIELD = Symbol("remove-field");
export type Patch = Record<string, unknown>;

/** One member as read from `users/{uid}`; only the two fields the trash cares about. */
export type MemberProfile = {
  uid: string;
  clinicRoles?: Record<string, unknown> | null;
  defaultClinicId?: string | null;
};

/** What the trash record remembers about one member. */
export type TrashedMember = { role: unknown; wasDefault: boolean };

/**
 * The roles to remember and the patch for each member's profile, in one pass. The role is gone
 * from `clinicRoles`; if this clinic was their default, the default moves to another clinic they
 * still hold a role in, or is removed when this was their only one. That last case is exactly the
 * one that sends the owner to onboarding on their next sign-in, which is what "deleted" means.
 */
export function letGoMembers(
  clinicId: string,
  members: MemberProfile[]
): { remembered: Record<string, TrashedMember>; patches: Record<string, Patch> } {
  const remembered: Record<string, TrashedMember> = {};
  const patches: Record<string, Patch> = {};
  for (const member of members) {
    const roles = member.clinicRoles || {};
    if (!(clinicId in roles)) continue;
    const wasDefault = member.defaultClinicId === clinicId;
    remembered[member.uid] = { role: roles[clinicId], wasDefault };
    const patch: Patch = { [`clinicRoles.${clinicId}`]: REMOVE_FIELD };
    if (wasDefault) {
      const next = Object.keys(roles).find((id) => id !== clinicId && roles[id]);
      patch.defaultClinicId = next ?? REMOVE_FIELD;
    }
    patches[member.uid] = patch;
  }
  return { remembered, patches };
}

/**
 * The patch that gives one remembered member their role back. The default is restored only if
 * they have not settled on another clinic in the meantime: a person who joined a second clinic
 * while the first was in the trash keeps working where they are, with the restored clinic in
 * their switcher.
 */
export function welcomeBackPatch(
  clinicId: string,
  remembered: TrashedMember,
  current: MemberProfile | null
): Patch {
  const patch: Patch = { [`clinicRoles.${clinicId}`]: remembered.role };
  if (remembered.wasDefault && !current?.defaultClinicId) patch.defaultClinicId = clinicId;
  return patch;
}

/** The `members` map of a trash record, tolerating records written before members were kept. */
export function membersFromTrash(record: Record<string, unknown>): Record<string, TrashedMember> {
  const raw = record.members;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, TrashedMember> = {};
  for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || !("role" in value)) continue;
    const v = value as Record<string, unknown>;
    out[uid] = { role: v.role, wasDefault: v.wasDefault === true };
  }
  return out;
}

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

/** The document written to `deleted_clinics`: the header, who and when, and who worked there. */
export function trashRecordFrom(
  header: Record<string, unknown>,
  stamp: TrashStamp,
  members: Record<string, TrashedMember> = {}
): Record<string, unknown> {
  const record: Record<string, unknown> = { ...header, deletedAt: stamp.at, deletedBy: stamp.uid, members };
  if (stamp.email) record.deletedByEmail = stamp.email;
  return record;
}

/** The header to write back to `clinics`: the trash record without its stamps. */
export function headerFromTrash(record: Record<string, unknown>): Record<string, unknown> {
  const header: Record<string, unknown> = { ...record };
  for (const key of TRASH_STAMPS) delete header[key];
  return header;
}
