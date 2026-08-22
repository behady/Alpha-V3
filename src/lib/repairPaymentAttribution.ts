/**
 * Deciding which historical payments can be repaired, and which must be left exactly as they are.
 *
 * Two of the four screens that took payments wrote the amount and nothing else — no dentist, no
 * lab fee, no commission. Those rows paid the treating dentist zero and booked whole as clinic
 * profit. They are now written correctly, but the ones already in the database still read that way.
 *
 * The hard part is not recomputing them. It is knowing which ones NOT to touch.
 *
 * Commission figures on this clinic's ledger have been corrected by hand in the past. A repair
 * that recomputed every row from the dentist's standing rate would quietly reverse those
 * decisions, and nobody would notice until a dentist's payout was wrong in a month nobody was
 * looking at. So the classifier is deliberately timid: anything that carries a commission figure
 * at all is left alone, because a correct row and a hand-corrected row are indistinguishable from
 * the outside — and being wrong in that direction costs nothing, while being wrong the other way
 * silently rewrites somebody's pay.
 *
 * Rows written from now on carry `commissionSetManually` when an Admin sets the split by hand
 * (see the payout screen), so this ambiguity does not grow.
 *
 * Pure and Firebase-free, so the classification can be exercised with fixtures. This is arithmetic
 * that decides what people are paid; arithmetic nobody can test is arithmetic nobody should run.
 */

import { firstPaymentIdFor } from "@/lib/ledgerWrite";
import { recalcCommissionFromPayment } from "@/lib/ledgerCommission";

export type RepairClass = "MANUAL_OR_OK" | "AUTO_FIXABLE" | "REVIEW" | "UNRESOLVABLE";

export type LedgerRowLike = {
  id: string;
  type?: string | null;
  date?: string | null;
  paid?: number | null;
  amount?: number | null;
  procedureId?: string | null;
  doctorId?: string | null;
  doctorName?: string | null;
  doctor?: string | null;
  labFee?: number | null;
  doctorCommissionPercentage?: number | null;
  doctorCommissionAmount?: number | null;
  clinicProfit?: number | null;
  commissionSetManually?: boolean | null;
  patientId?: string | null;
  patientName?: string | null;
  description?: string | null;
};

export type StaffLike = { id: string; name?: string | null; commissionPercentage?: number | null };

export type RepairProposal = {
  doctorId: string;
  doctorName: string;
  doctorCommissionPercentage: number;
  doctorCommissionAmount: number;
  clinicProfit: number;
  labFee: number;
};

export type RepairVerdict = {
  paymentId: string;
  class: RepairClass;
  /** One sentence a human can act on, shown in the report. */
  reason: string;
  patientName: string;
  date: string;
  amount: number;
  current: {
    doctorId: string | null;
    doctorCommissionPercentage: number | null;
    doctorCommissionAmount: number | null;
    labFee: number | null;
  };
  /** What the row would become. Absent for MANUAL_OR_OK and UNRESOLVABLE. */
  proposal?: RepairProposal;
};

function num(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return value;
}

function paidOf(row: LedgerRowLike): number {
  // Payments resolve through `paid` first: some rows store the real value there and leave
  // `amount: 0` as a placeholder, so reading `amount` first would see zero.
  return Number(row.paid ?? row.amount ?? 0) || 0;
}

/**
 * Has anybody ever put a commission figure on this row?
 *
 * Either field being present is enough. A stored `0` counts: writing zero is a statement that
 * somebody worked it out and the answer was nothing, which is exactly what a locum on no
 * commission looks like — and re-deriving that from a rate the dentist has today would invent a
 * payout nobody agreed to.
 */
export function hasCommissionRecorded(row: LedgerRowLike): boolean {
  if (row.commissionSetManually === true) return true;
  return num(row.doctorCommissionPercentage) !== null || num(row.doctorCommissionAmount) !== null;
}

/** Has anybody ever attributed this row to a dentist? */
export function hasAttribution(row: LedgerRowLike): boolean {
  return Boolean(
    String(row.doctorId || "").trim() ||
      String(row.doctorName || "").trim() ||
      String(row.doctor || "").trim()
  );
}

export type ClassifyContext = {
  /** Every payment settling the same procedure, including this one. */
  siblings: LedgerRowLike[];
  /** The procedure this payment settles, if it is still there. */
  procedure: LedgerRowLike | null;
  staff: StaffLike[];
};

/**
 * Which class does this payment fall into, and what would repairing it look like?
 *
 * The row-local rule is the subtle one. The lab fee belongs on a procedure's earliest payment, so
 * repairing one row can imply moving the fee off another. This never does that: if the payment
 * that should carry the lab fee is a row we are not allowed to touch, the repair is downgraded to
 * REVIEW rather than half-applied. Repairing one row must never silently change another.
 */
export function classifyPayment(row: LedgerRowLike, context: ClassifyContext): RepairVerdict {
  const amount = paidOf(row);
  const base = {
    paymentId: row.id,
    patientName: String(row.patientName || "Unknown patient"),
    date: String(row.date || ""),
    amount,
    current: {
      doctorId: String(row.doctorId || "").trim() || null,
      doctorCommissionPercentage: num(row.doctorCommissionPercentage),
      doctorCommissionAmount: num(row.doctorCommissionAmount),
      labFee: num(row.labFee),
    },
  };

  if (hasCommissionRecorded(row)) {
    return {
      ...base,
      class: "MANUAL_OR_OK",
      reason:
        row.commissionSetManually === true
          ? "The split on this payment was set by hand. Never recalculated."
          : "This payment already carries a commission figure. It may be correct or it may have been corrected by hand — the two look identical, so it is left untouched.",
    };
  }

  const procedureId = String(row.procedureId || "").trim();
  if (!procedureId || !context.procedure) {
    return {
      ...base,
      class: "UNRESOLVABLE",
      reason: procedureId
        ? "The treatment this payment settled no longer exists, so there is nothing to attribute it to."
        : "A payment on account, settling no particular treatment. Carrying no commission is correct for these.",
    };
  }

  const procedure = context.procedure;
  const procedureDoctorId = String(procedure.doctorId || "").trim();
  const procedureDoctorName = String(procedure.doctorName || procedure.doctor || "").trim();

  if (!procedureDoctorId && !procedureDoctorName) {
    return {
      ...base,
      class: "UNRESOLVABLE",
      reason: "The treatment this payment settled names no dentist, so there is nobody to attribute it to.",
    };
  }

  const staffMatch = procedureDoctorId
    ? context.staff.find((s) => s.id === procedureDoctorId)
    : context.staff.find(
        (s) => String(s.name || "").trim().toLowerCase() === procedureDoctorName.toLowerCase()
      );

  if (!staffMatch) {
    return {
      ...base,
      class: "REVIEW",
      reason: `The treatment names "${procedureDoctorName || procedureDoctorId}", who is not on the staff list. Their rate has to be confirmed by a person.`,
    };
  }

  const commissionPct = Number(staffMatch.commissionPercentage) || 0;
  const procedureLabFee = Math.max(0, Number(procedure.labFee) || 0);

  // Which sibling should be carrying the lab fee?
  const shouldCarryLabFee = firstPaymentIdFor(
    context.siblings.map((s) => ({ id: s.id, date: s.date ?? null }))
  );

  let appliedLabFee = 0;
  if (procedureLabFee > 0) {
    if (shouldCarryLabFee === row.id) {
      // This row should carry it. But if a sibling we may not touch is carrying it today, applying
      // it here would charge the lab twice across the procedure.
      const otherCarrier = context.siblings.find(
        (s) => s.id !== row.id && (Number(s.labFee) || 0) > 0
      );
      if (otherCarrier && hasCommissionRecorded(otherCarrier)) {
        return {
          ...base,
          class: "REVIEW",
          reason: `The lab fee belongs on this payment, but payment ${otherCarrier.id} is carrying it and cannot be touched. Moving it needs a person.`,
        };
      }
      appliedLabFee = procedureLabFee;
    } else if (shouldCarryLabFee) {
      // An earlier payment should carry it. If that row cannot be touched and is NOT carrying it,
      // repairing this one would leave the lab fee charged nowhere at all.
      const carrier = context.siblings.find((s) => s.id === shouldCarryLabFee);
      const carrierHasIt = (Number(carrier?.labFee) || 0) > 0;
      if (carrier && !carrierHasIt && hasCommissionRecorded(carrier)) {
        return {
          ...base,
          class: "REVIEW",
          reason: `The lab fee should sit on payment ${carrier.id}, which cannot be touched and is not carrying it. Sorting that out needs a person.`,
        };
      }
      appliedLabFee = 0;
    }
  }

  const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(
    amount,
    appliedLabFee,
    commissionPct
  );

  return {
    ...base,
    class: "AUTO_FIXABLE",
    reason: `Never attributed. Belongs to ${staffMatch.name || staffMatch.id} at ${commissionPct}%.`,
    proposal: {
      doctorId: staffMatch.id,
      doctorName: String(staffMatch.name || ""),
      doctorCommissionPercentage: commissionPct,
      doctorCommissionAmount,
      clinicProfit,
      labFee: appliedLabFee,
    },
  };
}

export type RepairReport = {
  scannedAt: string;
  clinicId: string;
  verdicts: RepairVerdict[];
  counts: Record<RepairClass, number>;
  /** Commission that would be credited to dentists if every AUTO_FIXABLE row were applied. */
  commissionToCredit: number;
  notes: string[];
};

/**
 * Classify every payment in a clinic.
 *
 * Takes already-loaded rows so the decision is testable and so the script that reads Firestore
 * stays a thin shell around it.
 */
export function classifyAllPayments(
  clinicId: string,
  ledger: LedgerRowLike[],
  staff: StaffLike[],
  now: Date = new Date()
): RepairReport {
  const payments = ledger.filter((r) => String(r.type || "") === "payment");
  const procedureById = new Map(
    ledger.filter((r) => String(r.type || "") === "procedure").map((r) => [r.id, r])
  );

  const siblingsByProcedure = new Map<string, LedgerRowLike[]>();
  for (const payment of payments) {
    const procedureId = String(payment.procedureId || "").trim();
    if (!procedureId) continue;
    const list = siblingsByProcedure.get(procedureId) || [];
    list.push(payment);
    siblingsByProcedure.set(procedureId, list);
  }

  const verdicts = payments.map((payment) => {
    const procedureId = String(payment.procedureId || "").trim();
    return classifyPayment(payment, {
      siblings: siblingsByProcedure.get(procedureId) || [payment],
      procedure: procedureId ? procedureById.get(procedureId) || null : null,
      staff,
    });
  });

  const counts: Record<RepairClass, number> = {
    MANUAL_OR_OK: 0,
    AUTO_FIXABLE: 0,
    REVIEW: 0,
    UNRESOLVABLE: 0,
  };
  let commissionToCredit = 0;
  for (const verdict of verdicts) {
    counts[verdict.class] += 1;
    if (verdict.class === "AUTO_FIXABLE" && verdict.proposal) {
      commissionToCredit += verdict.proposal.doctorCommissionAmount;
    }
  }

  const notes: string[] = [];
  if (counts.MANUAL_OR_OK > 0) {
    notes.push(
      `${counts.MANUAL_OR_OK} payment(s) already carry a commission figure and were not examined further. ` +
        `A correct row and a hand-corrected one are indistinguishable, so none of them are touched.`
    );
  }
  if (counts.REVIEW > 0) {
    notes.push(`${counts.REVIEW} payment(s) need a person to decide. Nothing is applied to these without approval.`);
  }
  if (counts.UNRESOLVABLE > 0) {
    notes.push(
      `${counts.UNRESOLVABLE} payment(s) settle no treatment, or one that names no dentist. Carrying no commission is correct for those.`
    );
  }

  return {
    scannedAt: now.toISOString(),
    clinicId,
    verdicts,
    counts,
    commissionToCredit: Number(commissionToCredit.toFixed(2)),
    notes,
  };
}
