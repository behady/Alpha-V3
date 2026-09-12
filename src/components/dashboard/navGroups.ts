/**
 * How the navigation is carved up.
 *
 * These three groups used to be headings in the left rail; they are now the top bar's dropdown
 * menus, which is why the grouping suddenly matters much more than it did. An item missing from
 * every group here is silently dropped from the navigation however well it is permissioned — add
 * the key to a group at the same time you add the item.
 */
export const SECTION_GROUPS = [
  {
    titleEn: "Front Desk",
    titleAr: "مكتب الاستقبال",
    keys: ["chats", "patients", "appointments", "leads"],
  },
  {
    titleEn: "Operations",
    titleAr: "العمليات",
    // `store` sits next to `inventory` because that is where someone stands when they notice
    // they have run out of something.
    keys: ["finance", "inventory", "store", "lab", "attendance"],
  },
  {
    titleEn: "Insights & Growth",
    titleAr: "الرؤى والنمو",
    keys: ["intelligence", "marketing", "reports"],
  },
];

export interface NavItem {
  key: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
}
