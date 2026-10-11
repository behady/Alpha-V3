import { NextResponse } from "next/server";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { allowedBranches } from "@/lib/branchAccess";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
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
  /** When the body sends no branch, use this instead of refusing (automatic rows). Gets the branches already read. */
  fallback?: (branches: ClinicBranch[]) => Promise<string | null>;
}): Promise<BranchCheck> {
  const locations = await adminClinicDoc(args.clinicId, "settings", LOCATIONS_DOC).get();
  const branches = parseClinicBranches(locations.exists ? locations.data() : null);
  if (branches.length === 0) return { ok: true, branchId: null };

  const sent = typeof args.branchId === "string" ? args.branchId : "";
  if (!sent) {
    const automatic = args.fallback ? await args.fallback(branches) : null;
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

/**
 * The branch for money nobody chose a branch for (a phone call that sent none, an AI action, an
 * insurer's payment): the ledger row's own, else the appointment's, else the patient's, else the
 * clinic's first. Each document is read only when its id is given and the tier before it found
 * nothing; a branch id that no longer exists is skipped. When the ledger row has no branch and no
 * appointmentId was given, the row's own appointmentId is used for the next tier. Null for a clinic
 * with no branches.
 */
export async function automaticBranch(
  clinicId: string,
  branches: ClinicBranch[],
  ids: { appointmentId?: string | null; patientId?: string | null; ledgerId?: string | null }
): Promise<string | null> {
  const live = (v: unknown): string | null => (typeof v === "string" && v !== "" && branches.some((b) => b.id === v) ? v : null);
  let appointmentId = ids.appointmentId || null;
  if (ids.ledgerId) {
    const row = await adminClinicDoc(clinicId, "ledger", ids.ledgerId).get();
    const data = row.exists ? row.data() : null;
    const hit = live(data?.branchId);
    if (hit) return hit;
    if (!appointmentId && typeof data?.appointmentId === "string") appointmentId = data.appointmentId;
  }
  if (appointmentId) {
    const appt = await adminClinicDoc(clinicId, "appointments", appointmentId).get();
    const hit = live(appt.exists ? appt.data()?.branchId : null);
    if (hit) return hit;
  }
  if (ids.patientId) {
    const patient = await adminClinicDoc(clinicId, "patients", ids.patientId).get();
    const hit = live(patient.exists ? patient.data()?.branchId : null);
    if (hit) return hit;
  }
  return branches[0]?.id ?? null;
}
