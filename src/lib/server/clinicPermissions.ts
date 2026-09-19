import { expandPermissions } from "@/lib/permissions";

/**
 * The one place that writes the field firestore.rules actually reads.
 *
 * The rules look up `users/{uid}.clinicPermissions[clinicId]`. Nothing wrote it, so every rule that
 * consulted it passed — see the header of src/lib/permissions.ts. Routes that seed or edit
 * permissions call through here so there is a single spelling of the field, a single expansion of
 * the role baseline, and no chance of one route writing it while another forgets.
 *
 * Returns a patch for `update()` — the dotted key is the only form Firestore reads as a path into
 * a nested map, so it merges into `clinicPermissions` rather than replacing the whole map and
 * wiping the person's access at every other clinic.
 */
export function clinicPermissionsPatch(
  clinicId: string,
  role: string | null | undefined,
  granted: unknown
): Record<string, unknown> {
  const id = String(clinicId || "").trim();
  if (!id) return {};
  return { [`clinicPermissions.${id}`]: expandPermissions(role, granted) };
}

/**
 * The fields the BROWSER reads, written beside the map the rules read.
 *
 * users/{uid} carries `role` and `permissions` flat, marked "legacy" in src/types/saas.ts and
 * read by every screen in the app: PermissionGuard is `user?.permissions?.includes(...)`, the
 * Add-patient button is `user?.permissions?.includes("patients.add")`, the clinical tab is
 * `user?.role === "Dentist"`. Nothing legacy about them in practice.
 *
 * The grant routes wrote the staff card and `clinicPermissions[clinicId]` and stopped there, so
 * someone who joined by invite or by approval arrived holding every permission their role is due
 * -- the server let their writes through, firestore.rules let their writes through -- and saw
 * "Access Restricted" on every page, because the one copy the browser looks at was never written.
 * A dentist could not open Patients until an admin went to the Users screen and re-saved their
 * switches, which is what finally wrote these two fields.
 *
 * Last clinic joined wins, which is the same rule /api/admin/update-user already follows: these
 * fields cannot say two clinics at once, and the page that sent the person here has just pointed
 * the session at the clinic they joined.
 */
export function staffIdentityPatch(
  role: string | null | undefined,
  permissions: string[]
): Record<string, unknown> {
  const name = String(role || "").trim();
  return {
    role: name,
    permissions,
    // Only Owner and Admin carry this as a separate fact -- isDentistStaff() reads the role
    // itself for everyone else. Writing it for a Dentist keeps the two in agreement anyway.
    isDentist: name === "Dentist",
  };
}

/**
 * The same value shaped for `set()` on a user document that does not exist yet, where a dotted key
 * would create a literal field called "clinicPermissions.abc123" instead of nesting.
 */
export function clinicPermissionsSeed(
  clinicId: string,
  role: string | null | undefined,
  granted: unknown
): Record<string, string[]> {
  const id = String(clinicId || "").trim();
  if (!id) return {};
  return { [id]: expandPermissions(role, granted) };
}
