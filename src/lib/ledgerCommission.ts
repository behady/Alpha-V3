export type ProcedureLedgerInfo = {
  description?: string;
  labFee?: number;
  labOrderService?: string;
  cost?: number;
  doctorCommissionPercentage?: number;
};

export type PaymentLedgerRow = {
  id: string;
  date?: string;
  procedureId?: string | null;
  labFee?: number;
  paid?: number;
  amount?: number;
  doctorCommissionAmount?: number;
  clinicProfit?: number;
  doctorCommissionPercentage?: number | null;
};

/** Earliest payment id per procedure (for one-time lab fee deduction). */
export function firstPaymentIdByProcedure(payments: PaymentLedgerRow[]): Map<string, string> {
  const byProc = new Map<string, PaymentLedgerRow[]>();
  for (const p of payments) {
    const procId = p.procedureId;
    if (!procId) continue;
    const list = byProc.get(procId) || [];
    list.push(p);
    byProc.set(procId, list);
  }

  const out = new Map<string, string>();
  byProc.forEach((list, procId) => {
    list.sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return da.localeCompare(db);
      return a.id.localeCompare(b.id);
    });
    if (list[0]) out.set(procId, list[0].id);
  });
  return out;
}

/** Lab fee on payment row, or from linked procedure ledger on first payment only. */
export function resolvePaymentLabFee(
  payment: PaymentLedgerRow,
  procedureMap: Map<string, ProcedureLedgerInfo>,
  firstPaymentIds: Map<string, string>
): number {
  const stored = Number(payment.labFee) || 0;
  if (stored > 0) return stored;

  const procId = payment.procedureId;
  if (!procId || firstPaymentIds.get(procId) !== payment.id) return 0;

  const proc = procedureMap.get(procId);
  return Number(proc?.labFee) || 0;
}

export function procedureServiceLabel(
  proc: ProcedureLedgerInfo | undefined,
  fallbackDescription?: string
): string {
  const labSvc = proc?.labOrderService?.trim();
  if (labSvc) return labSvc;
  return fallbackDescription || "—";
}

export function recalcCommissionFromPayment(
  paidAmount: number,
  labFee: number,
  commissionPct: number
): { netAmount: number; doctorCommissionAmount: number; clinicProfit: number } {
  const netAmount = paidAmount - labFee;
  const doctorCommissionAmount =
    netAmount > 0 ? Number((netAmount * (commissionPct / 100)).toFixed(2)) : 0;
  const clinicProfit = Number((paidAmount - doctorCommissionAmount - labFee).toFixed(2));
  return { netAmount, doctorCommissionAmount, clinicProfit };
}

export function commissionPctForPayment(
  payment: PaymentLedgerRow,
  paidAmount: number,
  labFee: number
): number {
  const stored = payment.doctorCommissionPercentage;
  if (typeof stored === "number" && !Number.isNaN(stored)) return stored;
  const net = paidAmount - labFee;
  if (net <= 0) return 0;
  return (Number(payment.doctorCommissionAmount || 0) / net) * 100;
}
