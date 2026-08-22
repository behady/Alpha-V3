/**
 * Keeping a procedure and its payments in agreement, inside a transaction.
 *
 * `lib/syncProcedurePaymentLabFee` does this in the browser, but it imports the client Firebase
 * SDK and issues its writes one at a time — so a tab closed halfway through leaves the lab fee on
 * no payment at all, or on two. This is the same reconciliation expressed against the Admin SDK
 * inside a single transaction: either every row agrees afterwards or nothing changed.
 *
 * What has to stay true after any change to a procedure's payments:
 *
 *   - the procedure's `paid` equals the sum of its payments;
 *   - exactly one payment — the earliest, by date then id — carries the lab fee;
 *   - every payment's commission is computed on its own amount, after that lab fee.
 *
 * All three break together, which is why they are recalculated together. Adding a payment,
 * editing one's amount, and deleting one all change which payment is earliest.
 */

import type { Transaction } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { recalcProcedurePayments, sumPayments } from "@/lib/ledgerWrite";

export type PaymentRowLite = {
  id: string;
  date?: string | null;
  paid?: number | null;
  amount?: number | null;
};

/**
 * Every payment settling a procedure.
 *
 * Read through the transaction so the set cannot change underneath the recalculation — two
 * receptionists taking a payment at the same moment would otherwise each compute a lab fee
 * against a set that did not include the other's row, and both would carry it.
 */
export async function readProcedurePayments(
  txn: Transaction,
  clinicId: string,
  procedureLedgerId: string
): Promise<PaymentRowLite[]> {
  const query = adminClinicCollection(clinicId, "ledger")
    .where("procedureId", "==", procedureLedgerId)
    .where("type", "==", "payment");
  const snap = await txn.get(query);
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      date: typeof data.date === "string" ? data.date : null,
      paid: typeof data.paid === "number" ? data.paid : null,
      amount: typeof data.amount === "number" ? data.amount : null,
    };
  });
}

/**
 * Rewrite the procedure's `paid` and every linked payment's lab fee and commission.
 *
 * `payments` is what the set will look like AFTER this transaction's own changes — the caller
 * passes the rows it is about to write, including a payment being added and excluding one being
 * deleted. Reading them back from the transaction would miss those, since a transaction's own
 * writes are not visible to its reads.
 */
export function applyProcedureSync(
  txn: Transaction,
  args: {
    clinicId: string;
    procedureLedgerId: string;
    payments: PaymentRowLite[];
    labFee: number;
    commissionPct: number;
  }
): { totalPaid: number; updatedPaymentIds: string[] } {
  const { clinicId, procedureLedgerId, payments, labFee, commissionPct } = args;

  const totalPaid = sumPayments(payments);
  txn.update(adminClinicDoc(clinicId, "ledger", procedureLedgerId), { paid: totalPaid });

  const rebalanced = recalcProcedurePayments({ payments, labFee, commissionPct });
  for (const row of rebalanced) {
    txn.update(adminClinicDoc(clinicId, "ledger", row.id), {
      labFee: row.labFee,
      doctorCommissionPercentage: row.doctorCommissionPercentage,
      doctorCommissionAmount: row.doctorCommissionAmount,
      clinicProfit: row.clinicProfit,
    });
  }

  return { totalPaid, updatedPaymentIds: rebalanced.map((r) => r.id) };
}

/**
 * The commission percentage and lab fee a procedure's payments should be computed against.
 *
 * The percentage comes from the dentist's staff record rather than from whatever the procedure row
 * happens to have stored, so a rate corrected in Settings takes effect on the next payment instead
 * of being frozen at the value copied when the treatment was first recorded.
 */
export async function readProcedureCommissionBasis(
  txn: Transaction,
  clinicId: string,
  procedure: Record<string, unknown>
): Promise<{ labFee: number; commissionPct: number }> {
  const labFee = Math.max(0, Number(procedure.labFee) || 0);
  const doctorId = typeof procedure.doctorId === "string" ? procedure.doctorId.trim() : "";

  if (!doctorId) {
    // No dentist on the charge: nothing to pay out. Falling back to the percentage stored on the
    // row would attribute money to nobody in particular.
    return { labFee, commissionPct: 0 };
  }

  const staffSnap = await txn.get(adminClinicDoc(clinicId, "staff", doctorId));
  if (!staffSnap.exists) {
    // The dentist has left. Keep whatever the row recorded rather than silently zeroing a payout
    // that was already agreed.
    return { labFee, commissionPct: Number(procedure.doctorCommissionPercentage) || 0 };
  }
  return { labFee, commissionPct: Number(staffSnap.data()?.commissionPercentage) || 0 };
}
