package com.alphadental.clinic.data

/**
 * What a patient owes, worked out the same way the website works it out.
 *
 * Ported from lib/paymentRecovery.ts rather than reinvented, because this number gets read down a
 * phone to a patient. Two rules in here look like details and are not:
 *
 * 1. A payment's real value can live in `paid` while `amount` is left at 0 as a placeholder. An
 *    older payment screen in this system writes exactly that shape, and it is still in live data.
 *    Reading `amount` first would silently ignore those payments and tell a patient who has paid
 *    in full that they still owe the lot.
 *
 * 2. Clinic expenses live in the same collection. They are the clinic's own spending and no
 *    patient owes them, so they are skipped entirely.
 */

/** One row of the ledger, only the fields the balance depends on. */
data class LedgerRow(
    val type: String = "",
    val amount: Double? = null,
    val cost: Double? = null,
    val paid: Double? = null,
)

data class Balance(
    val charged: Double,
    val paid: Double,
) {
    /**
     * What is still owed. Never negative: a patient who overpaid has a credit, not a debt, and
     * showing "owes -200" invites someone to ask them for money they do not owe.
     */
    val owed: Double get() = (charged - paid).coerceAtLeast(0.0)

    /** True when they have paid more than they were charged. */
    val inCredit: Boolean get() = paid > charged

    val creditAmount: Double get() = (paid - charged).coerceAtLeast(0.0)
}

/** The money value of one row, resolved per row type. See the note above. */
fun rowAmount(row: LedgerRow): Double = if (row.type == "payment") {
    row.paid ?: row.amount ?: 0.0
} else {
    row.amount ?: row.cost ?: 0.0
}

/** Total charged and total paid across a patient's ledger. */
fun balanceOf(rows: List<LedgerRow>): Balance {
    var charged = 0.0
    var paid = 0.0

    for (row in rows) {
        // The clinic's own overheads are not a patient debt.
        if (row.type == "expense") continue

        if (row.type == "procedure") charged += rowAmount(row) else paid += rowAmount(row)
    }

    return Balance(charged = charged, paid = paid)
}
