/**
 * "See it with sample data": a look around the demo clinic, with nothing to break.
 *
 * A fresh clinic's dashboard is empty, and empty looks broken — no patients, no takings, a
 * calendar with nothing on it. The demo clinic (seeded by scripts/seed-demo-clinic.mjs, marked
 * `__demo: true` on every document) is a full working week of a fake practice. This module is
 * the rule for letting a new owner walk through it:
 *
 *   - they get the Assistant role there, so every screen opens and the clinic shows up in
 *     their switcher;
 *   - their permission list in that clinic is the VIEW ids only. firestore.rules and every
 *     server route gate writes on that list (`holdsPermission` / `requireStaffPermission`),
 *     and neither expands a role's floor, so a tourist can open everything and change nothing;
 *   - a banner says where they are, with a way back and a way to remove the sample clinic.
 *
 * Pure, so the permission set can be tested against the catalogue: an id that is not a "view"
 * id here would let a tourist write into the demo, and the test is what stops that.
 */

export const DEMO_TOUR_ROLE = "Assistant";

/**
 * Every "open this module" id, and nothing that adds, edits, deletes or exports. Read from the
 * catalogue by convention: the view ids are `dashboard.view` and the `access.*` family.
 */
export const DEMO_TOUR_PERMISSIONS: readonly string[] = [
  "dashboard.view",
  "access.patients",
  "access.appointments",
  "access.lab",
  "access.finance",
  "access.inventory",
  // Opens the supply store catalogue and nothing else. `store.order` is an action and is absent,
  // so a tourist can price a basket at the partner's shop and can never send him a real order.
  "access.store",
  "access.reports",
  "access.marketing",
  "access.settings",
  "access.clinical",
  "access.ortho",
];

/** The marker the seed stamps on every demo document, the clinic header included. */
export function isDemoClinic(clinic: { __demo?: unknown } | null | undefined): boolean {
  return clinic?.__demo === true;
}

/**
 * Where "Back to my clinic" goes: the person's default clinic unless that IS the demo, then the
 * first clinic they hold a role in that is not the demo. Null when the demo is all they have.
 */
export function homeClinicFor(
  roles: Record<string, unknown> | null | undefined,
  defaultClinicId: string | null | undefined,
  demoClinicId: string
): string | null {
  if (defaultClinicId && defaultClinicId !== demoClinicId && roles?.[defaultClinicId]) return defaultClinicId;
  for (const id of Object.keys(roles || {})) {
    if (id !== demoClinicId && roles?.[id]) return id;
  }
  return null;
}
