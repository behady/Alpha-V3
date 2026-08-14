package com.alphadental.clinic.data

/**
 * What a stretch of days is worth, worked out from ledger rows.
 *
 * Kept free of Firestore so the arithmetic can be tested without a database — these are the
 * numbers an owner decides things on, and "roughly right" is not a category they have.
 *
 * Collected and charged are never added together. They answer different questions: one is money in
 * the drawer, the other is work billed for. A single "revenue" figure that mixed them would flatter
 * every period by counting treatment nobody has paid for yet.
 */

/** One ledger row, reduced to what a report needs. */
data class ReportRow(
    val type: String,
    val amount: Double,
    val description: String = "",
    val doctorName: String = "",
    val patientId: String = "",
    val date: String = "",
) {
    val isPayment: Boolean get() = type == "payment"
    val isCharge: Boolean get() = type != "payment" && type != "expense"
}

/** A named total with a count behind it, for the "top services" and "by dentist" lists. */
data class ReportLine(
    val label: String,
    val count: Int,
    val total: Double,
)

data class ReportSummary(
    /** Money actually taken in the period. */
    val collected: Double,
    /** Work billed for in the period, paid or not. */
    val charged: Double,
    /** Money paid out — lab bills, rent, whatever the clinic logged as an expense. */
    val expenses: Double,
    /** How many distinct patients put money in. */
    val payingPatients: Int,
    /** Charges grouped by what was done, biggest first. */
    val byService: List<ReportLine>,
    /** Payments grouped by the dentist credited, biggest first. */
    val byDoctor: List<ReportLine>,
) {
    /**
     * What was billed but not collected in this window.
     *
     * Deliberately NOT called "outstanding". A patient can pay in March for work charged in
     * February, so within any one period this is the difference between two flows and not a debt
     * anybody owes. The patient file is where a real balance lives.
     */
    val gap: Double get() = charged - collected
}

/**
 * The service name at the front of a ledger description.
 *
 * Charges are written as "Root canal (T: 36,37)" — the tooth list is part of the description, so
 * grouping on the raw string would file the same treatment under a different heading for every
 * combination of teeth it was ever done on.
 */
fun serviceLabelOf(description: String): String {
    val head = description.substringBefore("(").trim()
    return head.ifBlank { "General" }
}

private fun linesOf(rows: List<ReportRow>, label: (ReportRow) -> String): List<ReportLine> =
    rows.groupBy(label)
        .map { (name, group) -> ReportLine(name, group.size, group.sumOf { it.amount }) }
        .sortedByDescending { it.total }

fun summariseReport(rows: List<ReportRow>): ReportSummary {
    val payments = rows.filter { it.isPayment }
    val charges = rows.filter { it.isCharge }

    return ReportSummary(
        collected = payments.sumOf { it.amount },
        charged = charges.sumOf { it.amount },
        expenses = rows.filter { it.type == "expense" }.sumOf { it.amount },
        payingPatients = payments.mapNotNull { it.patientId.takeIf(String::isNotBlank) }.distinct().size,
        byService = linesOf(charges) { serviceLabelOf(it.description) },
        // Only payments are credited to a dentist. Grouping charges by doctor would report work
        // that has been done rather than money that has arrived, which is not what anybody asking
        // "how did Dr Ahmed do this month" means.
        byDoctor = linesOf(payments.filter { it.doctorName.isNotBlank() }) { it.doctorName },
    )
}
