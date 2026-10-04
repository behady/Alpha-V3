/**
 * A dentist's insurance work for a period: the Completed service lines assigned to them on treated or
 * sent claims, each with the rate and share stamped when the line was assigned. A Planned or Ongoing
 * line earns nobody anything yet (no state stored = Completed, as every older claim).
 *
 * Insurance is paid separately from private work — the owner's decision. Private commission comes
 * from the ledger (`staffCommission.ts`); this comes from the claims register and never touches
 * the ledger, so neither can double-count the other. The two sit side by side on the team page.
 *
 * Pure: claims in, figures out. Nothing here is printed on the insurer's statement.
 */

import { lineStatusOf, type InsuranceClaim } from "@/lib/insurance/claims";

export type InsuranceWorkEntry = {
  claimId: string;
  lineIndex: number;
  /** The treated date when there is one, else the approval date. */
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

function workDate(claim: InsuranceClaim): string {
  return claim.treatedDate || claim.approvalDate;
}

/** Only treated or sent claims count: an approval nobody treated earns nobody anything. */
export function countsForPayroll(claim: InsuranceClaim): boolean {
  return COUNTED.has(claim.status);
}

/**
 * Every assigned line of every counted claim, grouped by dentist. Lines carry the share that was
 * stamped on them, so a rate changed today leaves last month's figure alone.
 */
export function insuranceWorkByStaff(claims: readonly InsuranceClaim[], wording: Record<string, string> = {}): Map<string, StaffInsuranceWork> {
  const out = new Map<string, StaffInsuranceWork>();
  for (const claim of claims) {
    if (!countsForPayroll(claim)) continue;
    for (const [k, d] of Object.entries(claim.dentists)) {
      const i = Number(k);
      const line = claim.lines[i];
      if (!line || lineStatusOf(claim, i) !== "Completed") continue;
      const bucket = out.get(d.staffId) ?? { total: 0, approved: 0, entries: [] };
      bucket.entries.push({
        claimId: claim.id,
        lineIndex: i,
        date: workDate(claim),
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
      if (claim.dentists[i] || lineStatusOf(claim, i) !== "Completed") return;
      count += 1;
      approved = round2(approved + line.approvedAmount);
    });
  }
  return { count, approved };
}
