"use client";

import type { Payer } from "@/lib/payers";
import { needsApproval, storedVisitPayer } from "@/lib/visitPayer";
import { parseClaimLinks } from "@/lib/insurance/appointments";

/**
 * "No approval" on an appointment card: the desk booked the visit under a company that sends
 * approval paper (MetLife, NextCare, AXA…) and the visit is linked to none of its approvals.
 *
 * Reads only what the appointment itself stores (lib/visitPayer), so a visit booked before the
 * "Who pays?" picker existed shows nothing here.
 */
export default function NoApprovalTag({
  appointment,
  payers,
  isAr,
  size = "sm",
}: {
  appointment: { payerId?: unknown; claimId?: unknown; claimLine?: unknown; claimLinks?: unknown };
  payers: readonly Payer[];
  isAr: boolean;
  size?: "xs" | "sm";
}) {
  const payer = storedVisitPayer(appointment, payers);
  if (!needsApproval(payer) || parseClaimLinks(appointment).length > 0) return null;
  const name = isAr ? payer!.nameAr || payer!.name : payer!.name;
  return (
    <span
      title={isAr ? `مفيش موافقة من ${name}` : `No ${name} approval linked`}
      className={`shrink-0 inline-flex items-center rounded-full bg-accent font-bold text-ink-on-accent whitespace-nowrap ${
        size === "xs" ? "h-4 px-1.5 text-[9px]" : "h-5 px-2 text-[10px]"
      }`}
    >
      {isAr ? "مفيش موافقة" : "No approval"}
    </span>
  );
}
