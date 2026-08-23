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
