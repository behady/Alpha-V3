package com.alphadental.clinic.data

/**
 * How one payment is split between the doctor, the lab and the clinic.
 *
 * Ported from QuickPaymentModal on the website. This is not display arithmetic — these three
 * numbers are written onto the ledger row and are what the clinic's profit and the doctor's
 * payout are later calculated from. Getting them wrong does not look like a bug; it looks like
 * the practice made less money than it did, or the dentist is owed a different amount than they
 * are.
 *
 * Two rules here are easy to miss and both come straight from the website:
 *
 *  - **The lab fee is charged once**, against the first payment for that procedure only. A crown
 *    paid in three instalments must not pay the lab three times.
 *  - **Commission is taken on the net**, after the lab fee — the dentist's percentage is of what
 *    the clinic actually kept, not of the patient's gross payment.
 */
data class PaymentSplit(
    /** Lab fee applied to this payment. Zero on every payment after the first. */
    val labFee: Double,
    val doctorCommissionPercentage: Double,
    val doctorCommissionAmount: Double,
    val clinicProfit: Double,
)

/**
 * Split one payment.
 *
 * @param amount        what the patient is paying now
 * @param paidBefore    what they had already paid toward this same procedure
 * @param procedureLabFee the lab's charge for the procedure, if any
 * @param commissionPercentage the treating dentist's commission, 0 if none or unknown
 */
fun splitPayment(
    amount: Double,
    paidBefore: Double,
    procedureLabFee: Double,
    commissionPercentage: Double,
): PaymentSplit {
    // Charged once, on the first payment only.
    val appliedLabFee = if (paidBefore == 0.0) procedureLabFee else 0.0

    val net = amount - appliedLabFee

    // A payment smaller than the lab fee leaves nothing to commission. Without this guard the
    // dentist would be assigned a negative commission — which reads downstream as the doctor
    // owing the clinic money.
    val commission = if (net > 0) net * (commissionPercentage / 100.0) else 0.0

    return PaymentSplit(
        labFee = appliedLabFee,
        doctorCommissionPercentage = commissionPercentage,
        doctorCommissionAmount = commission,
        clinicProfit = amount - commission - appliedLabFee,
    )
}

/** A procedure on the ledger that still has money outstanding. */
data class UnpaidProcedure(
    val id: String,
    val description: String,
    val cost: Double,
    val paidSoFar: Double,
    val labFee: Double = 0.0,
    val doctorId: String = "",
    val doctorName: String = "",
) {
    val remaining: Double get() = (cost - paidSoFar).coerceAtLeast(0.0)
}

/**
 * Work out what each procedure still owes, from the patient's whole ledger.
 *
 * Payments are matched to a procedure by `procedureId`, which is what the website writes. A
 * general or advance payment carries no procedureId and so reduces no single procedure — it sits
 * against the account as a whole, which is why it is offered as its own option rather than being
 * spread across procedures automatically.
 */
fun unpaidProcedures(rows: List<LedgerEntry>): List<UnpaidProcedure> {
    val payments = rows.filter { it.type == "payment" }

    return rows
        .filter { it.type == "procedure" }
        .map { procedure ->
            val paid = payments
                .filter { it.procedureId == procedure.id }
                .sumOf { it.paid ?: 0.0 }

            UnpaidProcedure(
                id = procedure.id,
                description = procedure.description.ifBlank { "Procedure" },
                cost = procedure.amount ?: procedure.cost ?: 0.0,
                paidSoFar = paid,
                labFee = procedure.labFee,
                doctorId = procedure.doctorId,
                doctorName = procedure.doctorName,
            )
        }
        .filter { it.remaining > 0 }
        .sortedByDescending { it.remaining }
}

/** One ledger row, with the fields the payment screen needs. */
data class LedgerEntry(
    val id: String = "",
    val type: String = "",
    val description: String = "",
    val amount: Double? = null,
    val cost: Double? = null,
    val paid: Double? = null,
    val procedureId: String = "",
    val labFee: Double = 0.0,
    val doctorId: String = "",
    val doctorName: String = "",
)
