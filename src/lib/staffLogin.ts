import { auth } from "@/lib/firebase";
import { isFullAccessRole } from "@/lib/permissions";

/**
 * Create a colleague's login and their staff card at one clinic.
 *
 * One call for the two screens that add people — Settings → Staff & logins, and the team step of
 * the clinic setup — so the body /api/staff/create receives cannot drift between them. The route
 * runs on the Admin SDK (the browser cannot create an Auth account) and refuses anyone who is not
 * an admin of `clinicId`.
 *
 * `isDentist` only means something for a full-access role; for any other it is sent as false, as
 * the Staff screen always did.
 *
 * Resolves `isNewUser: false` with the server's sentence when the email already had an account and
 * was given this clinic too — the one outcome the caller has no wording of its own for.
 */
export async function createStaffLogin(input: {
  clinicId: string | null;
  name: string;
  email: string;
  password: string;
  role: string;
  isDentist: boolean;
}): Promise<{ isNewUser: boolean; message?: string }> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch("/api/staff/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      name: input.name.trim(),
      role: input.role,
      createDbRecords: true,
      clinicId: input.clinicId,
      isDentist: isFullAccessRole(input.role) ? input.isDentist : false,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string; isNewUser?: boolean; message?: string };
  if (!response.ok) throw new Error(result.error || "Failed to create auth login");
  return { isNewUser: result.isNewUser !== false, message: result.message };
}
