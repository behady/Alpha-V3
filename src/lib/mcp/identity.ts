import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Who a key speaks for, resolved from the account rather than from a login.
 *
 * Every other server route starts from a Firebase ID token and reads the user out of it. An MCP
 * call has no token and no browser session — it arrives from Anthropic's servers carrying a key
 * that was minted months ago — so the staff member has to be looked up fresh on each call.
 *
 * Fresh is the point. A key holds a uid, not a snapshot of what that uid could do. Revoke a
 * permission in User Management and the next question the assistant asks is answered under the
 * new permissions, because this reads the live document every time rather than trusting anything
 * recorded when the key was created.
 */
export type McpIdentity = {
  uid: string;
  role: string | null;
  permissions: string[];
  name: string;
};

/**
 * Mirrors `resolveRole` in apiStaffAuth, narrowed to the clinic-named case.
 *
 * A key always names a clinic, so the clinic-agnostic fallbacks there — "is this person an Admin
 * anywhere?" — have nothing to do here, and inheriting them would hand a role in this clinic to
 * somebody who only holds one elsewhere.
 */
export async function resolveMcpIdentity(uid: string, clinicId: string): Promise<McpIdentity | null> {
  const snap = await adminDb().collection("users").doc(uid).get();
  const data = snap.data();
  if (!data) return null;

  const isSuperAdmin = data.isSuperAdmin === true || data.isSuperAdmin === "true";
  const clinicRoles = (data.clinicRoles || {}) as Record<string, string>;
  const role = isSuperAdmin ? "Admin" : clinicRoles[clinicId] || null;

  // No role in this clinic means the person was removed from it after the key was minted. The
  // key is then dead by consequence rather than by revocation, which is the behaviour anyone
  // firing a staff member would expect without having to remember a second screen.
  if (!role || role === "Patient") return null;

  const clinicMap =
    data.clinicPermissions && typeof data.clinicPermissions === "object"
      ? (data.clinicPermissions as Record<string, unknown>)[clinicId]
      : undefined;
  const source = Array.isArray(clinicMap) ? clinicMap : data.permissions;
  const permissions = Array.isArray(source)
    ? (source as unknown[]).filter((p): p is string => typeof p === "string")
    : [];

  const name =
    (typeof data.name === "string" && data.name.trim()) ||
    (typeof data.displayName === "string" && data.displayName.trim()) ||
    (typeof data.email === "string" && data.email.trim()) ||
    "Staff";

  return { uid, role, permissions, name };
}
