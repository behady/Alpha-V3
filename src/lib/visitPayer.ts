/**
 * Who pays for a visit, decided at the desk when it is booked — and whether the approval that
 * company needs is actually there.
 *
 * Before this a visit had no payer of its own. The insurer was guessed later from the patient's
 * file, and the treatment's "Who pays?" always started on the patient. So a new MetLife patient
 * could be booked, treated and charged to MetLife with no approval paper anywhere, and nothing on
 * any screen said so until the company refused the claim.
 *
 * The answer, in the order of how sure it is:
 *   1. the insurer of an approval this visit is linked to (the paper decides; the picker locks);
 *   2. what reception picked by hand;
 *   3. an insurer the patient is a member of (the patient's file);
 *   4. Private.
 *
 * Only companies that send approval paper (a payer with a known `format`: MetLife, NextCare, AXA)
 * ever need one. A contract company such as GASCO has no paper and never warns.
 *
 * Pure: no database, no React.
 */

import { findPayer, isInsurerFormat, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";

export type VisitPayerSource = "approval" | "picked" | "patient" | "default";

/** An active payer by id, or null. Private counts: it is a real answer, not an absence. */
function activePayer(payers: readonly Payer[], id: unknown): Payer | null {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key) return null;
  const p = findPayer(payers, key);
  return p && p.active ? p : null;
}

/**
 * The payer a visit stands on right now, and where that answer came from.
 *
 * `linkedPayerIds` are the insurers of the approvals the visit is linked to; `picked` is the
 * desk's own choice ("" = none yet); `patientInsurerIds` are the insurers on the patient's file.
 */
export function effectiveVisitPayer(args: {
  payers: readonly Payer[];
  linkedPayerIds: readonly string[];
  picked: string;
  patientInsurerIds: readonly string[];
}): { payerId: string; source: VisitPayerSource } {
  const { payers, linkedPayerIds, picked, patientInsurerIds } = args;
  for (const id of linkedPayerIds) {
    const p = activePayer(payers, id);
    if (p) return { payerId: p.id, source: "approval" };
  }
  const own = activePayer(payers, picked);
  if (own) return { payerId: own.id, source: "picked" };
  for (const id of patientInsurerIds) {
    const p = activePayer(payers, id);
    if (p && p.id !== PRIVATE_PAYER_ID) return { payerId: p.id, source: "patient" };
  }
  return { payerId: PRIVATE_PAYER_ID, source: "default" };
}

/** Does this company send approval paper — i.e. is treating without one a risk? */
export function needsApproval(payer: Payer | null | undefined): boolean {
  return !!payer && payer.active && payer.id !== PRIVATE_PAYER_ID && isInsurerFormat(payer.format);
}

/**
 * What the desk should be told about the approval for this visit.
 *
 *   "none"     — the company needs paper and the patient has no open approval from it at all;
 *   "unlinked" — there is an open approval from that company, but this visit is not linked to it;
 *   null       — nothing to say (linked, private, or a company with no paper).
 */
export function approvalWarning(args: {
  payer: Payer | null | undefined;
  linked: boolean;
  /** Insurers the patient has an approval with that still has services left to do. */
  openApprovalPayerIds: readonly string[];
}): "none" | "unlinked" | null {
  const { payer, linked, openApprovalPayerIds } = args;
  if (linked || !needsApproval(payer)) return null;
  return openApprovalPayerIds.includes(payer!.id) ? "unlinked" : "none";
}

/**
 * The payer stored on a visit, as screens that only have the appointment can read it:
 * the company (active) when one is set, "private" when the desk chose Private, null when the
 * visit predates the field or names a company that is gone.
 */
export function storedVisitPayer(apt: { payerId?: unknown } | null | undefined, payers: readonly Payer[]): Payer | null {
  return activePayer(payers, apt?.payerId);
}
