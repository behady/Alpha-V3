/**
 * Branch access — who may work in which branch, and which rows a branch view shows.
 *
 * Three rules, and nothing else:
 *  1. Admins always see every branch.
 *  2. A staff member with no ticked branches (or whose ticked branches have all since been
 *     deleted) sees every branch. An empty or stale list must never lock somebody out.
 *  3. The scope "" means "All branches" and passes every row, including old rows that carry no
 *     branchId. Any real branch id passes only the rows stamped with exactly that id.
 */

import type { ClinicBranch } from "@/lib/clinicLocations";

type HasBranchId = { branchId?: unknown } | null | undefined;

/** The branches this person may work in (rules 1 and 2 above). */
export function allowedBranches(
  branches: readonly ClinicBranch[],
  staff: { branchIds?: unknown } | null | undefined,
  isAdmin: boolean
): ClinicBranch[] {
  if (isAdmin) return [...branches];
  const ticked = staff?.branchIds;
  if (!Array.isArray(ticked) || ticked.length === 0) return [...branches];
  const mine = branches.filter((b) => ticked.includes(b.id));
  return mine.length > 0 ? mine : [...branches];
}

/** Rule 3: does this row show under the chosen branch scope? `""` = All branches. */
export function rowInScope(row: { branchId?: unknown }, scopeBranchId: string): boolean {
  if (scopeBranchId === "") return true;
  return row.branchId === scopeBranchId;
}

/**
 * The branch to stamp on a money row nobody chose a branch for (a cron, a webhook, an AI action):
 * the appointment's, else the patient's, else the clinic's first branch, else null for a clinic
 * with no branches. A branch id that no longer exists is skipped.
 */
export function branchForAutomaticRow(args: {
  appointment?: HasBranchId;
  patient?: HasBranchId;
  branches: readonly { id: string }[];
}): string | null {
  const exists = (id: unknown): id is string =>
    typeof id === "string" && id !== "" && args.branches.some((b) => b.id === id);
  if (exists(args.appointment?.branchId)) return args.appointment!.branchId as string;
  if (exists(args.patient?.branchId)) return args.patient!.branchId as string;
  return args.branches[0]?.id ?? null;
}

/** True only for an array whose every element is a non-empty string. */
export function isValidBranchIds(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");
}
