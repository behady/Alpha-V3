import { NextResponse } from "next/server";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { allowedBranches } from "@/lib/branchAccess";
import { LOCATIONS_DOC, parseClinicBranches } from "@/lib/clinicLocations";
import { isFullAccessRole } from "@/lib/permissions";

export const BRANCH_REQUIRED_MESSAGE = "Choose the branch this money belongs to.";
export const BRANCH_FORBIDDEN_MESSAGE = "You can't record money for that branch.";

export type BranchCheck = { ok: true; branchId: string | null } | { ok: false; response: NextResponse };

const refuse = (status: number, error: string, code: string): BranchCheck => ({
  ok: false,
  response: NextResponse.json({ ok: false, error, code }, { status }),
});

/**
 * The one question every money route asks before it writes: which branch is this money for, and
 * may this person put money there?
 *
 * A clinic with no branches stamps nothing. Otherwise the body must name an existing branch;
 * admins may use any, everyone else only the branches `allowedBranches` leaves them.
 *
 * `fallback` is for rows nobody chose a branch for (the visit's own branch, say). It is used only
 * when the body sent none, and the id it returns is stamped WITHOUT the allowed-set check: it is
 * the visit's branch, not the person's choice. Only a branch the caller sent is checked.
 */
export async function assertBranchAllowed(args: {
  clinicId: string;
  uid: string;
  role: string;
  branchId: unknown;
  /** When the body sends no branch, use this instead of refusing (automatic rows). */
  fallback?: () => Promise<string | null>;
}): Promise<BranchCheck> {
  const locations = await adminClinicDoc(args.clinicId, "settings", LOCATIONS_DOC).get();
  const branches = parseClinicBranches(locations.exists ? locations.data() : null);
  if (branches.length === 0) return { ok: true, branchId: null };

  const sent = typeof args.branchId === "string" ? args.branchId : "";
  if (!sent) {
    const automatic = args.fallback ? await args.fallback() : null;
    return automatic ? { ok: true, branchId: automatic } : refuse(400, BRANCH_REQUIRED_MESSAGE, "branch_required");
  }
  if (!branches.some((b) => b.id === sent)) return refuse(400, BRANCH_REQUIRED_MESSAGE, "branch_required");

  const admin = isFullAccessRole(args.role);
  if (admin) return { ok: true, branchId: sent };

  const found = await adminClinicCollection(args.clinicId, "staff").where("uid", "==", args.uid).limit(1).get();
  const staff = found.empty ? null : (found.docs[0].data() as { branchIds?: unknown });
  const allowed = allowedBranches(branches, staff, false);
  return allowed.some((b) => b.id === sent) ? { ok: true, branchId: sent } : refuse(403, BRANCH_FORBIDDEN_MESSAGE, "branch_forbidden");
}
