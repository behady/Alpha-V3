package com.alphadental.clinic.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.time.Instant

/**
 * What the clinic owes each lab, and what it has paid — the phone's copy of `labAccounts.ts`.
 *
 * The one rule worth carrying over exactly: a case becomes money you owe ON DELIVERY, not on
 * dispatch. A crown sitting at the lab has been ordered, not received; once it is back in the
 * building you have the thing and you owe for it, fitted or not. A cancelled case is owed
 * nothing. A payment settles that debt in `lab_payments` and touches the ledger NOT AT ALL: the
 * lab fee was already booked as a cost when the treatment was saved, and a second entry would
 * charge the same crown against profit twice.
 */
object LabAccounts {

    private const val TAG = "LabAccounts"

    data class Payment(
        val id: String,
        val labId: String,
        /** Denormalised so a renamed lab does not rewrite the history of what was paid to it. */
        val labName: String,
        val amount: Double,
        /** yyyy-MM-dd on the clinic's own clock. */
        val date: String,
        val method: String,
        val reference: String = "",
        val note: String = "",
        val createdBy: String = "",
    )

    data class Method(val id: String, val en: String, val ar: String)

    val METHODS = listOf(
        Method("cash", "Cash", "كاش"),
        Method("transfer", "Bank transfer", "تحويل بنكي"),
        Method("instapay", "InstaPay", "إنستاباي"),
        Method("cheque", "Cheque", "شيك"),
        Method("other", "Other", "أخرى"),
    )

    fun methodLabel(id: String): String = METHODS.firstOrNull { it.id == id }?.en ?: id.replaceFirstChar { it.uppercase() }

    /** Delivered, so owed. */
    fun isBillable(status: String): Boolean = status == "back" || status == "fitted"

    /** Out at the lab: committed, chargeable soon, not yet a debt. */
    fun isCommitted(status: String): Boolean = LabCases.statusFor(status).atLab || status == "tryin_back"

    data class Account(
        val labId: String,
        val labName: String,
        val delivered: Double,
        val deliveredCount: Int,
        val committed: Double,
        val committedCount: Int,
        val paid: Double,
        /** delivered − paid. Negative means the clinic has paid ahead. */
        val outstanding: Double,
        val remakesAtLabCost: Int,
        val remakesTotal: Int,
        /** Delivered cases with no agreed price — the usual reason a balance and an invoice disagree. */
        val unpriced: Int,
    )

    private fun money(n: Double) = Math.round(n * 100) / 100.0

    /** One lab's account. Both lists are filtered here so a screen cannot total one lab's cases against another's payments. */
    fun accountFor(labId: String, labName: String, cases: List<LabCases.LabCase>, payments: List<Payment>): Account {
        var delivered = 0.0; var deliveredCount = 0
        var committed = 0.0; var committedCount = 0
        var remakesAtLabCost = 0; var remakesTotal = 0; var unpriced = 0
        for (c in cases) {
            if (c.labId != labId) continue
            if (c.remakeOfId.isNotBlank()) {
                remakesTotal += 1
                if (c.remakeFault == "lab") remakesAtLabCost += 1
            }
            if (isBillable(c.status)) {
                delivered += c.agreedPrice; deliveredCount += 1
                if (c.agreedPrice <= 0.0) unpriced += 1
            } else if (isCommitted(c.status)) {
                committed += c.agreedPrice; committedCount += 1
            }
        }
        val paid = payments.filter { it.labId == labId }.sumOf { it.amount }
        return Account(
            labId, labName, money(delivered), deliveredCount, money(committed), committedCount,
            money(paid), money(delivered - paid), remakesAtLabCost, remakesTotal, unpriced,
        )
    }

    /** Every configured lab, in the order the labs are configured, plus any lab a case names that settings no longer list. */
    fun accounts(labs: List<LabCases.Lab>, cases: List<LabCases.LabCase>, payments: List<Payment>): List<Account> {
        val known = labs.map { accountFor(it.id, it.name, cases, payments) }
        val ids = labs.map { it.id }.toSet()
        val strays = (cases.map { it.labId to it.labName } + payments.map { it.labId to it.labName })
            .filter { it.first.isNotBlank() && it.first !in ids }
            .distinctBy { it.first }
            .map { (id, name) -> accountFor(id, name.ifBlank { "Lab" }, cases, payments) }
        return known + strays
    }

    /** One line of a lab's statement: a delivery or a payment, with the balance after it. */
    data class Line(
        val date: String,
        val code: String,
        val patient: String,
        val work: String,
        val charge: Double,
        val payment: Double,
        val balance: Double,
        /** The payment's id, so the row can be removed; blank on a delivery. */
        val paymentId: String = "",
    )

    /**
     * Deliveries and payments interleaved by date, oldest first, with a running balance — the way a
     * lab reads its own book: "you took these six crowns and paid me twice in between".
     */
    fun statement(labId: String, cases: List<LabCases.LabCase>, payments: List<Payment>): List<Line> {
        val rows = mutableListOf<Line>()
        for (c in cases) {
            if (c.labId != labId || !isBillable(c.status)) continue
            rows += Line(
                date = c.receivedAt.ifBlank { c.fittedAt.ifBlank { c.sentAt } },
                code = c.code,
                patient = c.patientName.trim().split(Regex("\\s+")).firstOrNull().orEmpty(),
                work = c.workDescription.ifBlank { LabCases.workTypeLabel(c.workType, false) },
                charge = c.agreedPrice, payment = 0.0, balance = 0.0,
            )
        }
        for (p in payments) {
            if (p.labId != labId) continue
            rows += Line(
                date = p.date, code = "", patient = "",
                work = listOf(methodLabel(p.method), p.reference, p.note).filter { it.isNotBlank() }.joinToString(" · "),
                charge = 0.0, payment = p.amount, balance = 0.0, paymentId = p.id,
            )
        }
        rows.sortWith(compareBy({ it.date }, { it.code }))
        var balance = 0.0
        return rows.map { r -> balance = money(balance + r.charge - r.payment); r.copy(balance = balance) }
    }

    // ------------------------------------------------------------------ Firestore

    private fun collection(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("lab_payments")

    private fun DocumentSnapshot.str(field: String): String = get(field)?.toString().orEmpty()

    private fun DocumentSnapshot.toPayment() = Payment(
        id = id,
        labId = str("labId"),
        labName = str("labName"),
        amount = (get("amount") as? Number)?.toDouble() ?: 0.0,
        date = str("date"),
        method = str("method").ifBlank { "cash" },
        reference = str("reference"),
        note = str("note"),
        createdBy = str("createdBy"),
    )

    /** Every payment, live, so a payment recorded at the desk lands on the phone's balance without a refresh. */
    fun observePayments(clinicId: String): Flow<Result<List<Payment>>> = callbackFlow {
        val registration = collection(clinicId).addSnapshotListener { snapshot, error ->
            if (error != null) {
                Log.w(TAG, "lab payments failed: ${error.message}")
                trySend(Result.failure(error))
                return@addSnapshotListener
            }
            if (snapshot == null) return@addSnapshotListener
            trySend(Result.success(snapshot.documents.map { it.toPayment() }))
        }
        awaitClose { registration.remove() }
    }

    /** The website's `recordLabPayment`, field for field. Gated on finance.add by the rules. */
    suspend fun record(
        clinicId: String, labId: String, labName: String, amount: Double, date: String,
        method: String, reference: String, note: String, by: String,
    ): Result<String> = runCatching {
        require(amount.isFinite() && amount > 0) { "A lab payment needs an amount greater than zero." }
        require(labId.isNotBlank()) { "A lab payment needs a lab." }
        val body = buildMap<String, Any> {
            put("labId", labId)
            if (labName.isNotBlank()) put("labName", labName)
            put("method", method.ifBlank { "cash" })
            if (reference.isNotBlank()) put("reference", reference.trim())
            if (note.isNotBlank()) put("note", note.trim())
            if (by.isNotBlank()) put("createdBy", by)
            put("amount", money(amount))
            put("date", date)
            put("createdAt", Instant.now().toString())
            put("createdAtServer", FieldValue.serverTimestamp())
        }
        val ref = collection(clinicId).document()
        ref.set(body).await()
        ref.id
    }

    /** A mistyped amount, a duplicate entry. Gated on finance.delete. */
    suspend fun delete(clinicId: String, id: String): Result<Unit> = runCatching {
        collection(clinicId).document(id).delete().await()
    }
}
