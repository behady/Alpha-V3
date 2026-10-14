/**
 * What an insurer still owes on a treatment row, and what the patient does.
 *
 * A treatment recorded from an insurance approval carries two figures the ordinary row does not:
 * `insurerCovered`, the part the insurer approved and will pay, and `patientShare`, the part the
 * patient pays at the counter. Until the insurer pays, the covered part is money the clinic is
 * owed — by the insurer, not by the patient. The patient's balance must therefore leave it out,
 * and the receivables report must show it under the insurer's name instead.
 *
 * `insurerPaidAt` is stamped on the row when the insurer's payment is recorded; from then on the
 * payment rows carry the money and nothing is outstanding.
 *
 * Pure, shared by the browser, the routes and the reports.
 */

export type InsurerRowLite = {
  type?: unknown;
  insurerCovered?: unknown;
  insurerPaidAt?: unknown;
  claimId?: unknown;
  payerId?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The insurer's unpaid part of this row: zero for ordinary rows, payments, and rows the insurer has
 * settled. On a company row with no paper (`isCompanyRow`, e.g. GASCO) it is everything not yet
 * paid on it — `paid` is the server's running total of every payment against the row, the
 * patient's cash and the company's alike — so the patient is never shown as owing the company's bill.
 */
export function insurerOutstanding(row: InsurerRowLite): number {
  if (String(row.type || "") !== "procedure") return 0;
  if (row.insurerPaidAt) return 0;
  if (isCompanyRow(row)) return Math.max(0, (num(row.cost) || num(row.amount)) - num(row.paid));
  return Math.max(0, num(row.insurerCovered));
}

/**
 * Was this row written by an insurance approval? Such a row is priced by the approval, not by the
 * catalogue or a discount: its price, dentist and payer change on the patient's Insurance tab only.
 */
export function isApprovalRow(row: { claimId?: unknown } | null | undefined): boolean {
  return typeof row?.claimId === "string" && row.claimId.trim() !== "";
}

/** The part of a treatment's cost the patient is answerable for: everything the insurer is not. */
export function patientPortion(row: InsurerRowLite & { cost?: unknown; amount?: unknown }): number {
  const cost = num(row.cost) || num(row.amount);
  return Math.max(0, cost - insurerOutstanding(row));
}

/** The method the claims route writes on the insurer's own payment against an approval row. */
export const INSURER_PAYMENT_METHOD = "Insurance";

export type AccountRowLite = {
  id: string;
  type?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
  discountAmount?: unknown;
  insurerCovered?: unknown;
  claimId?: unknown;
  procedureId?: unknown;
  method?: unknown;
  payerId?: unknown;
};

/**
 * Charged to a company with no approval paper (GASCO and the like): the desk picked the company,
 * not the patient, as who pays. The company owes all of it; whatever cash the patient put on it at
 * the counter is the patient's share. `"private"` is the clinic's own payer id (see payers.ts).
 */
export function isCompanyRow(row: { claimId?: unknown; payerId?: unknown } | null | undefined): boolean {
  if (!row || isApprovalRow(row)) return false;
  const payer = typeof row.payerId === "string" ? row.payerId.trim() : "";
  return payer !== "" && payer !== "private";
}

/** One treatment row seen from the patient's side of the counter. */
export type PatientSide = {
  approval: boolean;
  /** Charged to a company with no approval (`isCompanyRow`): nothing on it is owed by the patient. */
  company: boolean;
  /** What the insurer approved on this row (on a company row, what the company owes); 0 on ordinary rows. */
  insurerPart: number;
  /** What the insurer has paid against it. */
  insurerPaid: number;
  /** What the patient owes on it: the whole cost, or the share on an approval row. */
  patientDue: number;
  patientPaid: number;
  patientLeft: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The patient's own account: what they were charged, what they paid, what they still owe.
 *
 * An approval row costs the approved amount plus the patient's share, and the insurer's payment
 * lands on it beside the patient's. Added up as they stand, the insurer's part reads as the
 * patient's bill and the insurer's cheque as the patient's money. Here the insurer's part leaves
 * the cost on approval rows, the insurer's payments leave the paid, whether or not the insurer has
 * paid yet, so the figures are the patient's alone.
 *
 * A company row (`isCompanyRow`, e.g. GASCO with no paper) is the company's bill outright: the
 * desk chose the company as who pays, so the patient owes nothing on it. Cash the patient did put
 * on it counts as their share (cost and paid alike, so it nets to zero); the company's own payments
 * (`INSURER_PAYMENT_METHOD`, written by Finance → "Mark collected") leave the paid. Before
 * 2026-10-14 these rows counted in full as the patient's, and the desk was shown a GASCO patient
 * "owing" the whole visit.
 *
 * `paid` on a row is the server's running total of every payment against it, so the patient's
 * part of it is that total less the insurer's payments.
 */
export function patientAccount(rows: readonly AccountRowLite[]): {
  byCharge: Map<string, PatientSide>;
  cost: number;
  paid: number;
  remaining: number;
  discount: number;
} {
  const approvalIds = new Set(rows.filter((r) => String(r.type || "") === "procedure" && isApprovalRow(r)).map((r) => r.id));
  const companyIds = new Set(rows.filter((r) => String(r.type || "") === "procedure" && isCompanyRow(r)).map((r) => r.id));
  const insurerPaidOn = new Map<string, number>();
  let paid = 0;
  for (const r of rows) {
    if (String(r.type || "") !== "payment") continue;
    const amount = num(r.paid) || num(r.amount);
    const target = typeof r.procedureId === "string" ? r.procedureId : "";
    if (target && (approvalIds.has(target) || companyIds.has(target)) && String(r.method || "") === INSURER_PAYMENT_METHOD) {
      insurerPaidOn.set(target, (insurerPaidOn.get(target) ?? 0) + amount);
    } else {
      paid += amount;
    }
  }

  const byCharge = new Map<string, PatientSide>();
  let cost = 0;
  let discount = 0;
  for (const r of rows) {
    if (String(r.type || "") !== "procedure") continue;
    const rowCost = num(r.cost) || num(r.amount);
    const approval = approvalIds.has(r.id);
    const company = companyIds.has(r.id);
    const insurerPaid = round2(insurerPaidOn.get(r.id) ?? 0);
    const patientPaid = round2(Math.max(0, num(r.paid) - insurerPaid));
    const insurerPart = approval
      ? Math.min(rowCost, Math.max(0, num(r.insurerCovered)))
      : company
        ? round2(Math.max(0, rowCost - patientPaid))
        : 0;
    const patientDue = company ? Math.min(rowCost, patientPaid) : round2(rowCost - insurerPart);
    byCharge.set(r.id, { approval, company, insurerPart, insurerPaid, patientDue, patientPaid, patientLeft: round2(Math.max(0, patientDue - patientPaid)) });
    cost += patientDue;
    // The gap between the paper's gross and the approved price is the insurer's tariff, not a
    // discount the patient was given; a company row's discount is the company's.
    if (!approval && !company) discount += num(r.discountAmount);
  }
  return { byCharge, cost: round2(cost), paid: round2(paid), remaining: round2(cost - paid), discount: round2(discount) };
}
