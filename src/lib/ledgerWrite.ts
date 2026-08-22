/**
 * The one place a ledger row is built.
 *
 * Four screens took payments — the patient ledger, the quick-payment modal, the appointment side
 * panel, and the assistant — and each built its own row. Two of them left out the attribution
 * entirely: no doctorId, no lab fee, no commission, no clinic profit. Those payments were then
 * invisible to the commission report (which skips rows with no commission) and counted whole as
 * clinic profit, so a dentist was paid nothing for money they had earned.
 *
 * Every caller now goes through the builders here, so a correct row is the only row anyone can
 * write. Pure and Firebase-free on purpose: it runs unchanged in the browser and inside a
 * server-side transaction, and its arithmetic can be tested with fixtures.
 *
 * The rules encoded here, stated once so nobody has to infer them from four call sites:
 *
 *   - A payment linked to a procedure inherits that procedure's dentist. That dentist's
 *     commission percentage comes from their staff record, never from the request.
 *   - The lab fee is charged once, against the earliest payment for a procedure. Which payment is
 *     "earliest" is the caller's to determine — only a caller reading the sibling payments (inside
 *     a transaction, server-side) can know, and it must never be taken from client input.
 *   - Commission is calculated on what is left after the lab fee, because the lab is paid first.
 *   - A payment with no linked procedure, or whose procedure names no dentist, carries zeroes in
 *     every commission field. That is the documented rule for an unallocated payment, not an
 *     omission — and writing explicit zeroes is what makes the two cases distinguishable later.
 */

import { recalcCommissionFromPayment } from "@/lib/ledgerCommission";

export type StaffLite = {
  id: string;
  name?: string | null;
  commissionPercentage?: number | null;
};

export type ProcedureLite = {
  id: string;
  doctorId?: string | null;
  doctorName?: string | null;
  /** Older rows stored the display name here instead of doctorName. */
  doctor?: string | null;
  labFee?: number | null;
  description?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
};

export type ActorLite = { uid?: string | null; name?: string | null };

/** Rounded the way money is stored everywhere else in this app. */
function money(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

function normalizeName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * The dentist a payment should be attributed to.
 *
 * Resolution order matters: the staff id on the procedure is authoritative, and the display name
 * is only a way to find a staff record for rows old enough to lack the id. A name that matches
 * nothing returns null rather than a guess — attributing a payment to the wrong dentist is worse
 * than attributing it to none, because it moves real money on a payroll report.
 */
export function resolveDoctorForPayment(
  procedure: ProcedureLite | null | undefined,
  staff: StaffLite[]
): StaffLite | null {
  if (!procedure) return null;

  const byId = String(procedure.doctorId || "").trim();
  if (byId) {
    const match = staff.find((s) => s.id === byId);
    if (match) return match;
    // The procedure names a dentist who is no longer on staff. Keep the identity — the commission
    // percentage is unknown, so it resolves to zero below rather than being invented.
    return { id: byId, name: procedure.doctorName || procedure.doctor || "", commissionPercentage: 0 };
  }

  const byName = normalizeName(procedure.doctorName || procedure.doctor);
  if (!byName) return null;
  return staff.find((s) => normalizeName(s.name) === byName) || null;
}

export type BuildPaymentArgs = {
  patientId: string;
  patientName?: string | null;
  /** Amount collected, in clinic currency. Must be greater than zero. */
  amount: number;
  method?: string | null;
  description: string;
  /** YYYY-MM-DD. */
  date: string;
  /** The charge this payment settles, or null for a general/advance payment. */
  procedure?: ProcedureLite | null;
  /**
   * The lab fee to charge against THIS payment. Zero for every payment after the first.
   * Never derived here — see the module comment.
   */
  appliedLabFee?: number;
  staff?: StaffLite[];
  actor?: ActorLite;
  /** Defaults to "Treatment Payment" when a procedure is linked, "Advance Payment" otherwise. */
  category?: string | null;
};

/**
 * A complete payment row, minus the server timestamp the caller adds (`createdAt`), so this stays
 * usable from both SDKs.
 */
export function buildPaymentRow(args: BuildPaymentArgs): Record<string, unknown> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("A payment must be a positive amount.");
  }
  const patientId = String(args.patientId || "").trim();
  if (!patientId) throw new Error("A payment must belong to a patient.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ""))) {
    throw new Error("A payment needs a date in YYYY-MM-DD form.");
  }

  const procedure = args.procedure || null;
  const staff = args.staff || [];
  const doctor = resolveDoctorForPayment(procedure, staff);

  // A lab fee only makes sense against the procedure that incurred it.
  const appliedLabFee = procedure ? money(Math.max(0, Number(args.appliedLabFee) || 0)) : 0;
  const commissionPct = doctor ? Number(doctor.commissionPercentage) || 0 : 0;

  const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(
    amount,
    appliedLabFee,
    commissionPct
  );

  const actorName = String(args.actor?.name || "").trim() || "Staff";

  return {
    patientId,
    patientName: args.patientName || null,
    type: "payment" as const,
    category: args.category || (procedure ? "Treatment Payment" : "Advance Payment"),
    date: args.date,
    description: args.description || "Payment",
    // `paid` is the field every reader treats as the real amount; `amount` mirrors it so the
    // finance dashboard, which reads `amount` for non-procedure rows, agrees. Older rows left
    // `amount: 0` as a placeholder here, which is why lib/revenueRecovery has to resolve payments
    // through `paid` first.
    paid: money(amount),
    amount: money(amount),
    cost: 0,
    method: args.method || "Cash",
    procedureId: procedure ? procedure.id : null,
    doctorId: doctor ? doctor.id : null,
    doctorName: doctor ? doctor.name || null : null,
    // Written even when zero. An explicit 0 says "attributed, nothing owed"; an absent field says
    // "nobody ever worked this out", and the repair script depends on telling those apart.
    doctorCommissionPercentage: commissionPct,
    doctorCommissionAmount,
    clinicProfit,
    labFee: appliedLabFee,
    addedBy: actorName,
    receivedBy: actorName,
    createdBy: args.actor?.uid || null,
  };
}

export type BuildManualEntryArgs = {
  type: "income" | "expense";
  amount: number;
  description: string;
  category?: string | null;
  date: string;
  method?: string | null;
  isRecurring?: boolean;
  actor?: ActorLite;
};

/**
 * A clinic income or expense line — money that belongs to no patient.
 *
 * The `paid` / `cost` split is what the finance dashboard reads: income lands in `paid`, expense
 * in `cost`, and `amount` carries the figure for both. Getting that mapping wrong makes a row
 * silently worth nothing, so it lives here rather than being rewritten at the call site.
 */
export function buildManualEntryRow(args: BuildManualEntryArgs): Record<string, unknown> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("An entry must be a positive amount.");
  }
  if (args.type !== "income" && args.type !== "expense") {
    throw new Error("An entry must be income or expense.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ""))) {
    throw new Error("An entry needs a date in YYYY-MM-DD form.");
  }

  const isIncome = args.type === "income";
  return {
    type: args.type,
    amount: money(amount),
    paid: isIncome ? money(amount) : 0,
    cost: isIncome ? 0 : money(amount),
    description: args.description || "No Description",
    category: args.category || "General",
    date: args.date,
    method: args.method || "Cash",
    isRecurring: isIncome ? false : Boolean(args.isRecurring),
    // Clinic-level money is nobody's patient record and nobody's commission.
    patientId: null,
    doctor: null,
    addedBy: String(args.actor?.name || "").trim() || "System",
    createdBy: args.actor?.uid || null,
  };
}

/**
 * Which of a procedure's payments carries the lab fee.
 *
 * Earliest by date, ties broken by document id so the answer is stable across reads. Callers pass
 * the payments they have already loaded; this makes no assumption about where they came from.
 */
export function firstPaymentIdFor(
  payments: Array<{ id: string; date?: string | null }>
): string | null {
  if (payments.length === 0) return null;
  const sorted = [...payments].sort((a, b) => {
    const byDate = String(a.date || "").localeCompare(String(b.date || ""));
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
  return sorted[0].id;
}

/**
 * The lab fee and commission every payment of a procedure should be carrying.
 *
 * Used after any change to the set — a new payment, an edited amount, a deleted one — because all
 * three change which payment is first and therefore where the lab fee sits. Returns one entry per
 * payment so a caller can write them in a single batch.
 */
export function recalcProcedurePayments(args: {
  payments: Array<{ id: string; date?: string | null; paid?: number | null; amount?: number | null }>;
  labFee: number;
  commissionPct: number;
}): Array<{ id: string; labFee: number; doctorCommissionPercentage: number; doctorCommissionAmount: number; clinicProfit: number }> {
  const labFee = money(Math.max(0, Number(args.labFee) || 0));
  const commissionPct = Number(args.commissionPct) || 0;
  const firstId = firstPaymentIdFor(args.payments);

  return args.payments.map((payment) => {
    const paid = Number(payment.paid ?? payment.amount ?? 0) || 0;
    const appliedLabFee = payment.id === firstId ? labFee : 0;
    const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(
      paid,
      appliedLabFee,
      commissionPct
    );
    return {
      id: payment.id,
      labFee: appliedLabFee,
      doctorCommissionPercentage: commissionPct,
      doctorCommissionAmount,
      clinicProfit,
    };
  });
}

/** Total collected against a procedure, from rows the caller has already loaded. */
export function sumPayments(
  payments: Array<{ paid?: number | null; amount?: number | null }>
): number {
  return money(payments.reduce((sum, p) => sum + (Number(p.paid ?? p.amount ?? 0) || 0), 0));
}
