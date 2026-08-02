import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import {
  firstPaymentIdByProcedure,
  recalcCommissionFromPayment,
  type PaymentLedgerRow,
} from "@/lib/ledgerCommission";

/** Find procedure ledger row for a clinical note (ledgerId or clinicalNoteId link). */
export async function resolveProcedureLedgerIdForNote(
  clinicalNoteId: string,
  ledgerId?: string | null
): Promise<string | null> {
  if (ledgerId) {
    const snap = await getDoc(getClinicDoc("ledger", ledgerId));
    if (snap.exists() && snap.data()?.type === "procedure") return ledgerId;
  }

  const snap = await getDocs(
    query(
      getClinicCollection("ledger"),
      where("clinicalNoteId", "==", clinicalNoteId),
      where("type", "==", "procedure")
    )
  );
  if (!snap.empty) return snap.docs[0].id;
  return null;
}

export async function sumPaymentsForProcedure(procedureLedgerId: string): Promise<number> {
  const snap = await getDocs(
    query(
      getClinicCollection("ledger"),
      where("procedureId", "==", procedureLedgerId),
      where("type", "==", "payment")
    )
  );
  return snap.docs.reduce((sum, d) => {
    const data = d.data();
    return sum + (Number(data.paid) || Number(data.amount) || 0);
  }, 0);
}

async function fetchProcedurePayments(procedureLedgerId: string): Promise<PaymentLedgerRow[]> {
  const snap = await getDocs(
    query(
      getClinicCollection("ledger"),
      where("procedureId", "==", procedureLedgerId),
      where("type", "==", "payment")
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as object) }) as PaymentLedgerRow)
    .sort((a, b) => {
      const cmp = String(a.date || "").localeCompare(String(b.date || ""));
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    });
}

/** Update procedure ledger + recalc every linked payment (lab fee on first payment only). */
export async function syncProcedureAndPaymentsFromClinicalNote(
  procedureLedgerId: string,
  procedureFields: Record<string, unknown>,
  labFee: number,
  commissionPct: number
): Promise<void> {
  if (!procedureLedgerId) return;

  const totalPaid = await sumPaymentsForProcedure(procedureLedgerId);
  const { paid: _omitPaid, ...rest } = procedureFields;
  void _omitPaid;

  await updateDoc(getClinicDoc("ledger", procedureLedgerId), {
    ...rest,
    paid: totalPaid,
  });

  const payments = await fetchProcedurePayments(procedureLedgerId);
  if (payments.length === 0) return;

  const firstPaymentId = firstPaymentIdByProcedure(payments).get(procedureLedgerId);

  await Promise.all(
    payments.map(async (payment) => {
      const payNum = Number(payment.paid || payment.amount || 0);
      const appliedLabFee = payment.id === firstPaymentId ? labFee : 0;
      const { doctorCommissionAmount, clinicProfit } = recalcCommissionFromPayment(
        payNum,
        appliedLabFee,
        commissionPct
      );
      await updateDoc(getClinicDoc("ledger", payment.id), {
        labFee: appliedLabFee,
        doctorCommissionPercentage: commissionPct,
        doctorCommissionAmount,
        clinicProfit,
      });
    })
  );
}
