/**
 * A dentist's insurance work for a period: the Completed service lines assigned to them on treated or
 * sent claims, each with the rate and share stamped when the line was assigned. A Planned or Ongoing
 * line earns nobody anything yet (no state stored = Completed, as every older claim), and a service
 * deleted from its approval earns nothing at all.
 *
 * Each service counts on the day IT was done (`lineDateOf`), not the day its approval was treated:
 * an approval issued on 20/10 with one service done that day and another on 5/11 is October's pay
 * for the first and November's for the second, whichever month the approval itself is billed in.
 *
 * Insurance is paid separately from private work — the owner's decision. Private commission comes
 * from the ledger (`staffCommission.ts`); this comes from the claims register and never touches
 * the ledger, so neither can double-count the other. The two sit side by side on the team page.
 *
 * Pure: claims in, figures out. Nothing here is printed on the insurer's statement.
 */

import { isLineRemoved, lineDateOf, lineStatusOf, type InsuranceClaim } from "@/lib/insurance/claims";

export type InsuranceWorkEntry = {
  claimId: string;
  lineIndex: number;
  /** The day this service was done: its own day, else the approval's treated date, else the approval date. */
  date: string;
  patientName: string;
  payerId: string;
  approvalNumber: string;
  /** The service as the clinic calls it (the learned wording), else the paper's description. */
  service: string;
  approved: number;
  rate: number;
  share: number;
};

export type StaffInsuranceWork = {
  total: number;
  approved: number;
  entries: InsuranceWorkEntry[];
};

export const NO_INSURANCE_WORK: StaffInsuranceWork = { total: 0, approved: 0, entries: [] };

const COUNTED = new Set<InsuranceClaim["status"]>(["treated", "sent"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A service that earns: on the approval (not deleted) and done. */
function earns(claim: InsuranceClaim, lineIndex: number): boolean {
  return !isLineRemoved(claim, lineIndex) && lineStatusOf(claim, lineIndex) === "Completed";
}

/** Only treated or sent claims count: an approval nobody treated earns nobody anything. */
export function countsForPayroll(claim: InsuranceClaim): boolean {
  return COUNTED.has(claim.status);
}

/**
 * Every assigned line of every counted claim, grouped by dentist. Lines carry the share that was
 * stamped on them, so a rate changed today leaves last month's figure alone.
 *
 * With a `period`, each service counts in the period IT was done (`lineDateOf`: its own day, else
 * the approval's treated date, else the approval date). The caller must therefore load every claim
 * with work in the period — by `workMonths`, and by either date for claims saved before it existed.
 */
export function insuranceWorkByStaff(
  claims: readonly InsuranceClaim[],
  wording: Record<string, string> = {},
  period?: { start: string; end: string },
): Map<string, StaffInsuranceWork> {
  const out = new Map<string, StaffInsuranceWork>();
  for (const claim of claims) {
    if (!countsForPayroll(claim)) continue;
    for (const [k, d] of Object.entries(claim.dentists)) {
      const i = Number(k);
      const line = claim.lines[i];
      if (!line || !earns(claim, i)) continue;
      const date = lineDateOf(claim, i);
      if (period && (date < period.start || date > period.end)) continue;
      const bucket = out.get(d.staffId) ?? { total: 0, approved: 0, entries: [] };
      bucket.entries.push({
        claimId: claim.id,
        lineIndex: i,
        date,
        patientName: claim.patientName,
        payerId: claim.payerId,
        approvalNumber: claim.approvalNumber,
        service: wording[line.code]?.trim() || line.description,
        approved: line.approvedAmount,
        rate: d.rate,
        share: d.share,
      });
      bucket.approved = round2(bucket.approved + line.approvedAmount);
      bucket.total = round2(bucket.total + d.share);
      out.set(d.staffId, bucket);
    }
  }
  for (const bucket of out.values()) bucket.entries.sort((a, b) => a.date.localeCompare(b.date) || a.approvalNumber.localeCompare(b.approvalNumber));
  return out;
}

/** Completed counted lines nobody has been assigned to yet: money that belongs to someone and is not on any sheet. */
export function unassignedLines(claims: readonly InsuranceClaim[]): { count: number; approved: number } {
  let count = 0;
  let approved = 0;
  for (const claim of claims) {
    if (!countsForPayroll(claim)) continue;
    claim.lines.forEach((line, i) => {
      if (claim.dentists[i] || !earns(claim, i)) return;
      count += 1;
      approved = round2(approved + line.approvedAmount);
    });
  }
  return { count, approved };
}

/**
 * The dentists' share still unpaid on the insurance services done in a period. It is stamped on the
 * approval's line (share, paid, deducted), not on a ledger row, so the ledger alone shows nothing owed.
 */
export function insurancePendingShare(claims: readonly InsuranceClaim[], period: { start: string; end: string }): number {
  let total = 0;
  for (const claim of claims) {
    if (!countsForPayroll(claim)) continue;
    for (const [k, d] of Object.entries(claim.dentists)) {
      const i = Number(k);
      if (!claim.lines[i] || !earns(claim, i)) continue;
      const date = lineDateOf(claim, i);
      if (date < period.start || date > period.end) continue;
      total += Math.max(0, d.share - (d.paid ?? 0) - (d.deducted ?? 0));
    }
  }
  return round2(total);
}
