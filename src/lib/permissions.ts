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

/** The four roles the app assigns. Anything else is treated as having no baseline. */
export const ROLES = ["Admin", "Dentist", "Assistant", "Receptionist"] as const;
export type Role = (typeof ROLES)[number];

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

  if (role === "Admin") return [];

  const baseline = ROLE_BASELINE[String(role || "")] || [];
  return [...new Set([...baseline, ...explicit])].sort();
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
  if (role === "Admin") return true;
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
