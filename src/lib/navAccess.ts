/**
 * Sidebar / mobile nav visibility.
 * - Prefer access.<module> (matches PermissionGuard keys).
 * - Still honor legacy module.* action keys so existing users keep nav until migrated.
 */

export type NavAccessUser = {
  role?: string;
  permissions?: string[];
};

export function canAccessNavItem(navKey: string, user: NavAccessUser | null, isAdmin: boolean): boolean {
  if (!user) return false;
  if (isAdmin) return true;

  if (navKey === "dashboard") return true;

  const perms = user.permissions ?? [];

  /** All staff can open attendance (check-in); gate sensitive views on the page itself. */
  if (navKey === "attendance") return true;

  const accessGrant = `access.${navKey}`;
  if (perms.includes(accessGrant)) return true;

  if (perms.some((p) => p.startsWith(`${navKey}.`))) return true;
  if (perms.includes(navKey)) return true;

  return false;
}

export function canShowSettingsNavLink(user: NavAccessUser | null, isAdmin: boolean): boolean {
  if (!user) return false;
  if (isAdmin) return true;
  const perms = user.permissions ?? [];
  return perms.includes("settings") || perms.includes("access.settings");
}
