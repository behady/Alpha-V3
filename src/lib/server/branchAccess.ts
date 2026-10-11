import { NextResponse } from "next/server";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { allowedBranches } from "@/lib/branchAccess";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
import { isFullAccessRole } from "@/lib/permissions";

export const BRANCH_REQUIRED_MESSAGE = "Choose the branch this money belongs to.";
export const BRANCH_FORBIDDEN_MESSAGE = "You can't record money for that branch.";

/** `branch` is the settings entry for `branchId` (null with no branch) and `branches` the whole list, so a caller needs no second read of settings/locations. */
export type BranchCheck = { ok: true; branchId: string | null; branch: ClinicBranch | null; branches: ClinicBranch[] } | { ok: false; response: NextResponse };

const refuse = (status: number, error: string, code: string): BranchCheck => ({
  ok: false,
  response: NextResponse.json({ ok: false, error, code }, { status }),
});

/** The branches this non-admin person may use: their staff row's ticks, or every branch when they have none. Never empty. */
async function allowedFor(clinicId: string, uid: string, branches: ClinicBranch[]): Promise<ClinicBranch[]> {
  const found = await adminClinicCollection(clinicId, "staff").where("uid", "==", uid).limit(1).get();
  const staff = found.empty ? null : (found.docs[0].data() as { branchIds?: unknown });
  return allowedBranches(branches, staff, false);
}

/**
 * The one question every money route asks before it writes: which branch is this money for, and
 * may this person put money there?
 *
 * A clinic with no branches stamps nothing. Otherwise the body must name an existing branch;
 * admins may use any, everyone else only the branches `allowedBranches` leaves them.
 *
 * `fallback` is for rows nobody chose a branch for (the visit's own branch, say). It is used only
 * when the body sent none. An admin gets the id it returns as is; anyone else gets it only if it is
 * one of the branches `allowedBranches` leaves them, otherwise their first allowed branch: never a
 * refusal (a phone payment must still be written), and a fallback branch never lands money where
 * this person may not work. Only a branch the caller sent is refused when it is not theirs.
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
  if (branches.length === 0) return { ok: true, branchId: null, branch: null, branches };
  const pick = (id: string): BranchCheck => ({ ok: true, branchId: id, branch: branches.find((b) => b.id === id) ?? null, branches });

  const sent = typeof args.branchId === "string" ? args.branchId : "";
  const admin = isFullAccessRole(args.role);
  if (!sent) {
    const automatic = args.fallback ? await args.fallback(branches) : null;
    if (!automatic) return refuse(400, BRANCH_REQUIRED_MESSAGE, "branch_required");
    if (admin) return pick(automatic);
    const allowed = await allowedFor(args.clinicId, args.uid, branches);
    return pick(allowed.some((b) => b.id === automatic) ? automatic : allowed[0].id);
  }
  if (!branches.some((b) => b.id === sent)) return refuse(400, BRANCH_REQUIRED_MESSAGE, "branch_required");

  if (admin) return pick(sent);

  const allowed = await allowedFor(args.clinicId, args.uid, branches);
  return allowed.some((b) => b.id === sent) ? pick(sent) : refuse(403, BRANCH_FORBIDDEN_MESSAGE, "branch_forbidden");
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
