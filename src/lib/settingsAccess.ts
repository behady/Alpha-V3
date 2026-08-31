/**
 * The one place that decides who may open and who may save a settings section.
 *
 * Phase 1 of the settings rebuild. Every screen, the sidebar, the mobile picker and the search
 * box ask this — nothing re-implements the check inline, which is how the old screen ended up
 * disagreeing with the database in three separate ways:
 *
 *   - The sidebar's Clinic Management group was wrapped in an admin check, so a person holding
 *     `access.settings` never saw the sections that permission is for. The mobile dropdown and a
 *     typed `?tab=` still let them in, so the grant worked in some places and not others.
 *
 *   - Prices was gated on `access.settings`, which firestore.rules accepts for nothing that
 *     screen writes. The tab opened and every save was rejected after the work was done.
 *
 *   - Nothing anywhere checked whether the clinic was still active, though every write clause in
 *     firestore.rules does. An expired clinic could fill in a form and only learn on save.
 *
 * The mirror is deliberate and exact:
 *
 *   admin        ⇢ isClinicAdmin(clinicId)    — Owner and Admin both, per isFullAccessRole()
 *   permission   ⇢ holdsPermission(...)       — the shared helper, which admins bypass, as in rules
 *   editing      ⇢ && isClinicActive(clinicId) — reads are allowed on an expired clinic, writes are not
 *
 * tests/settingsRegistry.test.mts asserts each section's declared access against the rules text,
 * so a section cannot claim something this function would grant but the database would refuse.
 */

import { holdsPermission } from "@/lib/permissions";
import type { SettingsAccess, SettingsSection } from "@/config/settingsRegistry";

/** Everything about the signed-in person that any access decision depends on. */
export interface SettingsViewer {
  /** Owner or Admin at this clinic, or a platform super-admin. */
  isAdmin: boolean;
  /** The clinic is expired or suspended — firestore.rules refuses every write. */
  isReadOnly: boolean;
  role: string | null | undefined;
  permissions: string[] | null | undefined;
}

export type AccessDenial =
  | { reason: "admin-only" }
  | { reason: "missing-permission"; permission: string }
  | { reason: "clinic-inactive" };

export type AccessDecision = { allowed: true } | ({ allowed: false } & AccessDenial);

const ALLOWED: AccessDecision = { allowed: true };

function satisfies(access: SettingsAccess, viewer: SettingsViewer): AccessDecision {
  switch (access.kind) {
    case "member":
    case "self":
      // Any signed-in member of the clinic. `self` narrows to the person's own record, which the
      // rules enforce by comparing uid on the document — there is nothing for a menu to check.
      return ALLOWED;
    case "admin":
      return viewer.isAdmin ? ALLOWED : { allowed: false, reason: "admin-only" };
    case "permission":
      return holdsPermission(viewer.role, viewer.permissions, access.id)
        ? ALLOWED
        : { allowed: false, reason: "missing-permission", permission: access.id };
  }
}

/** May this person open the section at all? Reads do not depend on the clinic being active. */
export function canViewSection(section: SettingsSection, viewer: SettingsViewer): AccessDecision {
  return satisfies(section.view, viewer);
}

/**
 * May this person save changes here?
 *
 * Answered separately from `canViewSection` on purpose: several sections are worth reading by
 * everyone and changeable only by an admin. Theme already worked this way and was the only one —
 * it shows "admin only" rather than failing on save, which is the behaviour the rest now copy.
 */
export function canEditSection(section: SettingsSection, viewer: SettingsViewer): AccessDecision {
  if (viewer.isReadOnly) return { allowed: false, reason: "clinic-inactive" };
  return satisfies(section.edit, viewer);
}

/** Sections this person may open, in registry order, minus any whose feature is switched off. */
export function visibleSections(
  sections: SettingsSection[],
  viewer: SettingsViewer,
  hasFeature: (feature: string) => boolean
): SettingsSection[] {
  return sections.filter(
    (section) =>
      (!section.feature || hasFeature(section.feature)) &&
      canViewSection(section, viewer).allowed
  );
}

/** What to tell someone who cannot save here. Plain sentences — these are shown as-is. */
export function denialMessage(denial: AccessDenial, language: string): string {
  const ar = language === "ar";
  switch (denial.reason) {
    case "admin-only":
      return ar
        ? "هذا القسم للمدير فقط. يمكنك الاطلاع عليه دون تعديل."
        : "Only an admin can change this. You can look, but not save.";
    case "missing-permission":
      return ar
        ? `تحتاج صلاحية "${denial.permission}" لتعديل هذا القسم. اطلبها من مدير العيادة.`
        : `You need the "${denial.permission}" permission to change this. Ask your clinic admin for it.`;
    case "clinic-inactive":
      return ar
        ? "اشتراك العيادة منتهي، لذلك لا يمكن حفظ أي تعديل. جدّد الاشتراك لاستئناف التعديل."
        : "This clinic's subscription has ended, so nothing can be saved. Renew it to make changes again.";
  }
}
