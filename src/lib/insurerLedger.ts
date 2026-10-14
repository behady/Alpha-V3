/**
 * An insurance company's rows on the Finance page: each treatment it is the payer of, split into
 * what the patient paid at the counter and what the company has paid, and what is still owed.
 *
 * For a contract company with no paper (GASCO and the like) there is no claim and no approval: the
 * company owes the whole price. Cash the patient paid is the patient's credit and never comes off
 * the company's bill (the owner's rule, 2026-10-14). A payment is the company's when its method is
 * the insurer's (`INSURER_PAYMENT_METHOD`); every other payment against the treatment is the
 * patient's, shown for reference only. On an approval row the patient's share is real, so there
 * the patient's cash does count.
 *
 * Pure, shared by the Finance page and its tests. The route recomputes the same figures from the
 * database before it writes, so a stale screen cannot collect more than is owed.
 */

import { INSURER_PAYMENT_METHOD, isApprovalRow } from "@/lib/ledgerInsurer";
import { sumPayments } from "@/lib/ledgerWrite";

export type LedgerLite = {
  id: string;
  type?: unknown;
  payerId?: unknown;
  payerName?: unknown;
  claimId?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
  method?: unknown;
  procedureId?: unknown;
  date?: unknown;
  patientId?: unknown;
  patientName?: unknown;
  description?: unknown;
  branchId?: unknown;
  doctorName?: unknown;
};

export type InsurerRow = {
  charge: LedgerLite;
  cost: number;
  patientPaid: number;
  insurerPaid: number;
  outstanding: number;
  /** Something is still owed by the company. */
  collectable: boolean;
  /**
   * The row was written by an approval paper: its collection goes through the claim (the claims
   * route pays every treatment on that approval at once), not through `insurer-collect`.
   */
  viaClaim: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * What a payment row is worth: `paid` is the real figure, `amount` mirrors it (older rows left
 * `amount: 0`). The same rule as `sumPayments`, which is what the patient file and the payment
 * routes add up with — `paid ?? amount`, so a payment explicitly `paid: 0` is worth nothing here too.
 */
const paymentValue = (r: LedgerLite) =>
  sumPayments([{ paid: r.paid as number | null | undefined, amount: r.amount as number | null | undefined }]);

/** True when a treatment row names the dentist who did it (by id, or by name on older rows). */
export function treatmentHasDentist(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return Boolean(text(row.doctorId) || text(row.doctorName) || text(row.doctor));
}

/** The treatments this company is the payer of, each with its split. In the order the rows came. */
export function insurerRows(rows: readonly LedgerLite[], payerId: string): InsurerRow[] {
  const patient = new Map<string, number>();
  const insurer = new Map<string, number>();
  for (const r of rows) {
    if (String(r.type || "") !== "payment") continue;
    const target = text(r.procedureId);
    if (!target) continue;
    const bucket = String(r.method || "") === INSURER_PAYMENT_METHOD ? insurer : patient;
    bucket.set(target, (bucket.get(target) ?? 0) + paymentValue(r));
  }

  const out: InsurerRow[] = [];
  for (const r of rows) {
    if (String(r.type || "") !== "procedure") continue;
    if (text(r.payerId) !== payerId) continue;
    const cost = round2(num(r.cost) || num(r.amount));
    const patientPaid = round2(patient.get(r.id) ?? 0);
    const insurerPaid = round2(insurer.get(r.id) ?? 0);
    const viaClaim = isApprovalRow(r);
    const outstanding = round2(Math.max(0, cost - (viaClaim ? patientPaid : 0) - insurerPaid));
    out.push({ charge: r, cost, patientPaid, insurerPaid, outstanding, collectable: outstanding > 0.009, viaClaim });
  }
  return out;
}

export function insurerTotals(rows: readonly InsurerRow[]): { billed: number; patientPaid: number; insurerPaid: number; outstanding: number } {
  let billed = 0;
  let patientPaid = 0;
  let insurerPaid = 0;
  let outstanding = 0;
  for (const r of rows) {
    billed += r.cost;
    patientPaid += r.patientPaid;
    insurerPaid += r.insurerPaid;
    outstanding += r.outstanding;
  }
  return { billed: round2(billed), patientPaid: round2(patientPaid), insurerPaid: round2(insurerPaid), outstanding: round2(outstanding) };
}
