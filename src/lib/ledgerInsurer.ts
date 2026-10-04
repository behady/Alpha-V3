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
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** The insurer's unpaid part of this row: zero for ordinary rows, payments, and rows the insurer has settled. */
export function insurerOutstanding(row: InsurerRowLite): number {
  if (String(row.type || "") !== "procedure") return 0;
  if (row.insurerPaidAt) return 0;
  return Math.max(0, num(row.insurerCovered));
}

/** The part of a treatment's cost the patient is answerable for: everything the insurer is not. */
export function patientPortion(row: InsurerRowLite & { cost?: unknown; amount?: unknown }): number {
  const cost = num(row.cost) || num(row.amount);
  return Math.max(0, cost - insurerOutstanding(row));
}
