/**
 * How the navigation is carved up.
 *
 * These three groups used to be headings in the left rail; they are now the top bar's dropdown
 * menus, which is why the grouping suddenly matters much more than it did. An item missing from
 * every group here is silently dropped from the navigation however well it is permissioned — add
 * the key to a group (or to DIRECT_KEYS) at the same time you add the item.
 *
 * Reorganised 2026-10-04 on the owner's own layout: Dashboard and Patients are plain buttons with
 * nothing under them, the money pages sit together under Accounting, and everything else is under
 * More. The group ids that tours and lessons anchor on come from `titleEn`
 * (`nav-group-accounting`, `nav-group-more`), so renaming a group in English moves those anchors.
 */

/**
 * Destinations that are buttons of their own in the top bar, right after Dashboard, rather than
 * items inside a menu. Dashboard is handled separately (it is always there and always first).
 */
export const DIRECT_KEYS = ["patients", "team"];

export const SECTION_GROUPS = [
  {
    titleEn: "Accounting",
    // Not "الحسابات": that is already the Finance page's own name, and a menu and the page inside
    // it with the same name read as one thing.
    titleAr: "المحاسبة",
    keys: ["insurance", "finance", "reports", "lab"],
  },
  {
    titleEn: "More",
    titleAr: "المزيد",
    // `store` sits next to `inventory` because that is where someone stands when they notice
    // they have run out of something.
    keys: ["chats", "appointments", "leads", "inventory", "store", "ortho", "attendance", "intelligence", "marketing"],
  },
];

export interface NavItem {
  key: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  /**
   * The destination is an add-on the clinic does not hold. Shown to admins with a lock so the
   * page (which says who to contact) is one click away; staff never see a locked item at all.
   */
  locked?: boolean;
}
