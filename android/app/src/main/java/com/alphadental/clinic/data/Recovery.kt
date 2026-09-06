package com.alphadental.clinic.data

import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Who owes the clinic money, and what happened when somebody rang them.
 *
 * Two separate facts, deliberately kept apart, exactly as the website keeps them. The ledger says
 * what is owed; the follow-up says what came of chasing it. A patient who promised to pay on
 * Saturday still owes the money — but the person making calls on Thursday needs to know not to
 * ring them again.
 *
 * The balance arithmetic mirrors `buildRecoveryList` on the website: charges are `procedure`
 * rows read by `amount`, money in is every other non-expense row read by `paid`, and clinic
 * overheads are skipped because no patient owes them.
 */
object Recovery {

    /** What the clinic did about one debt. */
    data class FollowUp(
        val status: String = "open",
        val lastContactedAt: String = "",
        val updatedByName: String = "",
    )

    val STATUSES = listOf("open", "promised", "settled", "ignored")

    fun statusLabel(status: String, arabic: Boolean): String = when (status) {
        "promised" -> if (arabic) "وعد بالدفع" else "Promised"
        "settled" -> if (arabic) "تم السداد" else "Settled"
        "ignored" -> if (arabic) "لا ترد" else "No answer"
        else -> if (arabic) "مفتوح" else "Open"
    }

    /** One person on the call list. */
    data class Debtor(
        val patientId: String,
        val patientName: String,
        val phone: String,
        /** Charged and unpaid. */
        val balance: Double,
        /** ISO date of the most recent ledger activity, or blank when nothing is dated. */
        val lastActivity: String,
        /** Days since that activity; null when there is no dated activity at all. */
        val ageDays: Long?,
        val followUp: FollowUp,
    )

    private fun clinic(clinicId: String) = Firebase.db().collection("clinics").document(clinicId)

    /** Below this a balance is rounding noise, not a debt worth anyone's afternoon. */
    private const val MIN_BALANCE = 1.0

    /**
     * Build the call list.
     *
     * The whole ledger is read, which is the same thing the website does and the reason this is
     * a screen somebody opens rather than something watched all day. It runs off the main thread
     * because a busy clinic's ledger is thousands of documents and mapping them on the UI thread
     * is a frozen app.
     */
    suspend fun loadDebtors(clinicId: String): List<Debtor> = withContext(Dispatchers.IO) {
        val ledger = clinic(clinicId).collection("ledger").get().await()

        data class Tally(var charged: Double = 0.0, var paid: Double = 0.0, var name: String = "", var last: String = "")
        val tallies = mutableMapOf<String, Tally>()

        for (doc in ledger.documents) {
            val patientId = doc.getString("patientId").orEmpty()
            if (patientId.isBlank()) continue
            val type = doc.getString("type").orEmpty()
            // Clinic overheads are the clinic's own spending; no patient owes them.
            if (type == "expense") continue

            val tally = tallies.getOrPut(patientId) { Tally(name = doc.getString("patientName").orEmpty()) }
            if (tally.name.isBlank()) tally.name = doc.getString("patientName").orEmpty()

            // A charge is measured by `amount`; money in by `paid`, which older writes left
            // alongside a zero `amount` — reading the wrong one makes a paid bill look unpaid.
            if (type == "procedure") {
                tally.charged += (doc.get("amount") as? Number)?.toDouble()
                    ?: (doc.get("cost") as? Number)?.toDouble() ?: 0.0
            } else {
                tally.paid += (doc.get("paid") as? Number)?.toDouble()
                    ?: (doc.get("amount") as? Number)?.toDouble() ?: 0.0
            }

            val date = doc.getString("date").orEmpty()
            if (date > tally.last) tally.last = date
        }

        val owing = tallies.filter { (_, t) -> t.charged - t.paid >= MIN_BALANCE }
        if (owing.isEmpty()) return@withContext emptyList()

        val followUps = runCatching {
            clinic(clinicId).collection("recovery_followups").get().await().documents.associate { d ->
                d.id to FollowUp(
                    status = d.getString("status").orEmpty().ifBlank { "open" },
                    lastContactedAt = d.getString("lastContactedAt").orEmpty(),
                    updatedByName = d.getString("updatedByName").orEmpty(),
                )
            }
        }.getOrDefault(emptyMap())

        // Phones come off the patient record rather than the ledger: a ledger row's copy of a
        // number is whatever it was on the day, and this list exists to dial it today.
        val phones = runCatching {
            clinic(clinicId).collection("patients").get().await().documents.associate { d ->
                d.id to Pair(d.getString("name").orEmpty(), d.getString("phone").orEmpty())
            }
        }.getOrDefault(emptyMap())

        val today = LocalDate.now()
        owing.map { (patientId, t) ->
            val age = runCatching { ChronoUnit.DAYS.between(LocalDate.parse(t.last), today) }.getOrNull()
            Debtor(
                patientId = patientId,
                patientName = phones[patientId]?.first?.takeIf { it.isNotBlank() } ?: t.name,
                phone = phones[patientId]?.second.orEmpty(),
                balance = t.charged - t.paid,
                lastActivity = t.last,
                ageDays = age,
                followUp = followUps[patientId] ?: FollowUp(),
            )
            // Biggest money first: this is a work queue and people start at the top.
        }.sortedByDescending { it.balance }
    }

    /** Record what came of the call. Keyed by patient, as the website keys it. */
    suspend fun setFollowUp(clinicId: String, debtor: Debtor, status: String, byName: String): Result<Unit> = runCatching {
        clinic(clinicId).collection("recovery_followups").document(debtor.patientId).set(
            mapOf(
                "status" to status,
                "patientName" to debtor.patientName,
                "lastContactedAt" to java.time.Instant.now().toString(),
                "updatedByName" to byName,
                "amountAtContact" to debtor.balance,
            ),
            SetOptions.merge(),
        ).await()
    }

    /** The reminder the clinic sends. Same wording as the website's, so patients hear one voice. */
    fun chaseMessage(debtor: Debtor, clinicName: String, arabic: Boolean): String = if (arabic) {
        "مرحباً ${debtor.patientName}، نود تذكيركم بوجود مبلغ ${debtor.balance.toInt()} جنيه مستحق لدى " +
            "${clinicName.ifBlank { "عيادتنا" }}. برجاء التواصل معنا لترتيب السداد. شكراً لكم."
    } else {
        "Hello ${debtor.patientName}, this is a friendly reminder that ${debtor.balance.toInt()} EGP is " +
            "outstanding on your account at ${clinicName.ifBlank { "our clinic" }}. Please get in touch to " +
            "arrange payment. Thank you."
    }
}
