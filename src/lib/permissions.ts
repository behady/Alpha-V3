/**
 * What each role may do, and which permission guards each collection.
 *
 * firestore.rules has referred to this file since the granular-permission layer was written. The
 * file did not exist, and neither did the field those rules read: they look up
 * `users/{uid}.clinicPermissions[clinicId]`, while the app has always written a flat
 * `users/{uid}.permissions` array. A missing map reads as null, and `holdsPermission` treats null
 * as "not backfilled yet, let them through" — so every permission check in the rules passed for
 * everyone, always. The checkboxes on the Users screen hid buttons and nothing more, which is the
 * exact bug the rules were written to fix.
 *
 * Two things have to be true for that layer to mean anything, and this file supplies both:
 *
 *  1. Something must write `clinicPermissions`. See src/lib/server/clinicPermissions.ts, which
 *     every route that seeds or edits permissions now goes through.
 *
 *  2. The stored list must hold the whole of what someone may do. It cannot be only the boxes an
 *     admin ticked, because the browser's guards also let people through on their *role*
 *     (`PermissionGuard`'s `allowedRoles`, and a dozen ad-hoc `user?.role === "Dentist"` checks).
 *     A dentist whose stored array is the three permissions the invite seeds can today edit a
 *     treatment chart through the UI. Store only those three and enforce them, and that dentist is
 *     locked out of their own job.
 *
 * So the stored list is the *effective* set: the role's baseline, plus whatever was ticked on top.
 * ROLE_BASELINE is what makes that expansion possible, and it is deliberately the floor of what a
 * role needs to work rather than everything it might want — an admin can always tick more, and
 * `expandPermissions` never removes what someone was explicitly granted.
 */

import { getAllPermissionIds } from "@/config/permissionsCatalog";

/**
 * The roles the app assigns. Anything else is treated as having no baseline.
 *
 * Ordered most- to least-privileged, because that is the order the Users screen lists them in.
 */
export const ROLES = ["Owner", "Admin", "Dentist", "Receptionist", "Assistant"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The clinic belongs to exactly one person, and this is how the app finally says so.
 *
 * `clinics/{id}.ownerId` has always named them, and nothing has ever read it for access: on the
 * Users screen the person paying for the clinic looked exactly like the locum Admin they invited
 * for a fortnight, and either could demote, delete or re-password the other. Owner does not add
 * powers — it and Admin pass every check identically — it adds *protection*: only the owner may
 * change the owner, and the role moves only through /api/admin/transfer-ownership, which carries
 * `ownerId` with it so the two facts can never disagree.
 */
export const OWNER_ROLE = "Owner" satisfies Role;

/** Passes every permission check without consulting a list. Owner and Admin, identically. */
export function isFullAccessRole(role: string | null | undefined): boolean {
  return role === "Owner" || role === "Admin";
}

/** Whether this role is the clinic's owner. */
export function isOwnerRole(role: string | null | undefined): boolean {
  return role === OWNER_ROLE;
}

/**
 * Roles an admin may pick from the dropdown.
 *
 * Owner is absent by design: handing over a clinic is a transfer, not an edit, and it takes the
 * outgoing owner's own action. Routes that accept a role reject it outright rather than relying
 * on the browser to leave it out.
 */
export const ASSIGNABLE_ROLES = ROLES.filter((r) => r !== OWNER_ROLE);

/**
 * The floor for each role.
 *
 * Admin is absent on purpose. `isClinicAdmin(clinicId)` short-circuits `holdsPermission` in the
 * rules and `requireStaffPermission` in apiStaffAuth, so an Admin passes every check without
 * consulting a list. Giving them one here would create a second source of truth that could drift.
 *
 * Chosen to match what each role can already do through the UI today, so that enforcing these
 * lists takes nothing away from anyone. Deletes are the exception and are granted to nobody by
 * default: they are the irreversible actions, and an admin can hand them out per person.
 */
export const ROLE_BASELINE: Record<string, string[]> = {
  Dentist: [
    "dashboard.view",
    "access.patients",
    "access.appointments",
    "access.clinical",
    "access.ortho",
    "access.lab",
    "access.reports",
    "patients.add",
    "patients.edit",
    "appointments.add",
    "appointments.edit",
    "clinical.edit",
    "inventory.edit", // they consume materials during a visit
    // Saving a billed procedure writes the clinical note AND its ledger row — see the
    // "add to ledger" field in ServiceEditorDrawer, and `create-entry: finance.add` in the
    // ledger route. Without this a dentist completing a treatment gets the note saved and a
    // permission error for the charge. `access.finance` stays off: posting the charge a
    // treatment produces is not the same as reading the clinic's takings.
    "finance.add",
  ],
  Assistant: [
    "dashboard.view",
    "access.patients",
    "access.appointments",
    "access.clinical",
    "access.inventory",
    "access.lab",
    "patients.add",
    "patients.edit",
    "appointments.add",
    "appointments.edit",
    "clinical.edit",
    "inventory.add",
    "inventory.edit",
  ],
  Receptionist: [
    "dashboard.view",
    "access.patients",
    "access.appointments",
    "access.finance",
    "access.reports",
    "patients.add",
    "patients.edit",
    "appointments.add",
    "appointments.edit",
    "appointments.delete", // cancelling a booking is reception's job
    "finance.add", // takes payments; editing and deleting them is not theirs
  ],
};

/**
 * The effective permission set to store for someone: their role's floor, plus anything explicitly
 * granted, de-duplicated and stable-sorted.
 *
 * An Admin returns an empty list rather than every permission. Nothing consults a list for them,
 * and materialising one would leave a stale copy behind the first time the catalogue changed.
 */
export function expandPermissions(role: string | null | undefined, granted: unknown): string[] {
  // Only ids the catalogue actually offers. Old accounts carry grants from a retired catalogue —
  // "finance.view", "settings.edit", "appointments.view" — which match no check anywhere and would
  // otherwise be copied forward forever, making every permission list longer and less readable
  // than the access it describes. Dropping them changes nothing enforceable: an id no rule and no
  // guard ever compares against grants exactly as much absent as present.
  const catalogue = new Set(getAllPermissionIds());
  const explicit = Array.isArray(granted)
    ? granted.filter((p): p is string => typeof p === "string" && catalogue.has(p))
    : [];

  // Owner and Admin short-circuit every check, so a materialised list for them would be a
  // second source of truth that goes stale the first time the catalogue changes.
  if (isFullAccessRole(role)) return [];

  const baseline = ROLE_BASELINE[String(role || "")] || [];
  return [...new Set([...baseline, ...explicit])].sort();
}

/**
 * The switches a role arrives with, as the Permissions screen shows them.
 *
 * `expandPermissions` answers "what should be stored", and for a full-access role that is
 * deliberately nothing. This answers the different question the UI asks — "what does this role
 * start with" — so the preset bar can name a number, the reset button has something to write,
 * and Owner/Admin can be drawn with every box on rather than an empty list that reads as no
 * access at all.
 */
export function rolePreset(role: string | null | undefined): string[] {
  if (isFullAccessRole(role)) return [...getAllPermissionIds()].sort();
  return [...new Set(ROLE_BASELINE[String(role || "")] || [])].sort();
}

/**
 * How far someone's switches have drifted from their role's preset.
 *
 * Shown as "Receptionist preset · 2 added · 1 removed", so an admin can tell a standard
 * receptionist from one that has been tuned by hand without reading thirteen toggles. A person
 * with no stored list at all is a legacy account the backfill has not reached; reporting that as
 * "matches the preset" would be a quiet lie, since the rules currently let them write anything.
 */
export function presetDiff(
  role: string | null | undefined,
  stored?: unknown
): { added: string[]; removed: string[]; matchesPreset: boolean; hasRecord: boolean } {
  if (!Array.isArray(stored)) {
    return { added: [], removed: [], matchesPreset: false, hasRecord: false };
  }
  const preset = new Set(rolePreset(role));
  const held = new Set(sanitizePermissionList(stored));
  const added = [...held].filter((p) => !preset.has(p)).sort();
  const removed = [...preset].filter((p) => !held.has(p)).sort();
  return {
    added,
    removed,
    matchesPreset: added.length === 0 && removed.length === 0,
    hasRecord: true,
  };
}

/**
 * An admin's ticked boxes, taken at their word: filtered to real catalogue ids, de-duplicated,
 * stable-sorted — and nothing added.
 *
 * This is the save-time counterpart to expandPermissions, and the difference between them is the
 * point. expandPermissions folds the role's baseline in, which is right when nobody has decided
 * anything yet — seeding a new account, backfilling one that predates the permission system. It is
 * wrong for an admin's explicit edit: re-adding the baseline under a save meant a baseline
 * permission could never be unticked — the box cleared on screen and the grant survived in the
 * enforced map, which is the checkbox lying in the other direction from the bug this whole layer
 * exists to fix. Once a person edits the list, the list is the decision.
 */
export function sanitizePermissionList(granted: unknown): string[] {
  const catalogue = new Set(getAllPermissionIds());
  const explicit = Array.isArray(granted)
    ? granted.filter((p): p is string => typeof p === "string" && catalogue.has(p))
    : [];
  return [...new Set(explicit)].sort();
}

/**
 * Does this person hold a permission, given their role and stored list?
 *
 * The single implementation behind every check that is not a Firestore rule. Mirrors
 * `holdsPermission` in firestore.rules: Admin passes everything, and a null permission means the
 * thing is open to any clinic member.
 */
export function holdsPermission(
  role: string | null | undefined,
  permissions: string[] | null | undefined,
  permission: string | null
): boolean {
  if (permission == null) return true;
  if (isFullAccessRole(role)) return true;
  return Array.isArray(permissions) && permissions.includes(permission);
}

/**
 * Which permission guards a write to each clinic subcollection.
 *
 * Mirrors permCreate/permUpdate/permDelete in firestore.rules. A collection absent from a map is
 * open to any clinic member for that verb — shared working data with no separate checkbox.
 * `tests/permissions.test.mts` asserts these agree with the rules file, because two copies of a
 * security decision drift silently and only one of them is enforced.
 */
export const COLLECTION_WRITE_PERMISSIONS: {
  create: Record<string, string>;
  update: Record<string, string>;
  delete: Record<string, string>;
} = {
  create: {
    patients: "patients.add",
    patient_media: "patients.edit",
    appointments: "appointments.add",
    ledger: "finance.add",
    inventory: "inventory.add",
    inventory_transactions: "inventory.edit",
    clinical_notes: "clinical.edit",
    treatment_plans: "clinical.edit",
    prescriptions: "clinical.edit",
    diagnosis_chats: "clinical.edit",
    ortho_cases: "clinical.edit",
    ortho_sessions: "clinical.edit",
    services: "access.settings",
    categories: "access.settings",
    drugs: "access.settings",
    marketing_campaigns: "access.marketing",
    marketing_cases: "access.marketing",
    marketing_consents: "access.marketing",
    marketing_content: "access.marketing",
    marketing_settings: "access.marketing",
  },
  update: {
    patients: "patients.edit",
    patient_media: "patients.edit",
    appointments: "appointments.edit",
    ledger: "finance.edit",
    inventory: "inventory.edit",
    inventory_transactions: "inventory.edit",
    clinical_notes: "clinical.edit",
    treatment_plans: "clinical.edit",
    prescriptions: "clinical.edit",
    diagnosis_chats: "clinical.edit",
    ortho_cases: "clinical.edit",
    ortho_sessions: "clinical.edit",
    services: "access.settings",
    categories: "access.settings",
    drugs: "access.settings",
    marketing_campaigns: "access.marketing",
    marketing_cases: "access.marketing",
    marketing_consents: "access.marketing",
    marketing_content: "access.marketing",
    marketing_settings: "access.marketing",
  },
  delete: {
    patients: "patients.delete",
    patient_media: "patients.edit",
    appointments: "appointments.delete",
    ledger: "finance.delete",
    inventory: "inventory.delete",
    inventory_transactions: "inventory.delete",
    clinical_notes: "clinical.delete",
    treatment_plans: "clinical.delete",
    prescriptions: "clinical.delete",
    diagnosis_chats: "clinical.delete",
    ortho_cases: "clinical.delete",
    ortho_sessions: "clinical.delete",
    services: "access.settings",
    categories: "access.settings",
    drugs: "access.settings",
    marketing_campaigns: "access.marketing",
    marketing_cases: "access.marketing",
    marketing_consents: "access.marketing",
    marketing_content: "access.marketing",
    marketing_settings: "access.marketing",
  },
};
