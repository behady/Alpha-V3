package com.alphadental.clinic.next.data

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Everything the app reads from Firestore.
 *
 * Read-only except where a screen explicitly asks to move something on. The app
 * talks to Firestore directly — there is no server in between — so this object
 * is the whole back end, and the website's documents are its schema.
 *
 * Suspending reads run on IO. The day is a LISTENER rather than a fetch, because
 * a reception desk needs a patient's arrival to appear without anyone pulling to
 * refresh; everything else is a one-shot, because a number that was right a
 * minute ago beats a socket held open all day.
 */
object ClinicSource {

    private val db: FirebaseFirestore get() = FirebaseFirestore.getInstance()
    private val auth: FirebaseAuth get() = FirebaseAuth.getInstance()

    private fun clinic(clinicId: String) = db.collection("clinics").document(clinicId)

    /** "yyyy-MM-dd" for a given day, in the device's own zone — the clinic's day. */
    fun dateKey(date: Date = Date()): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(date)

    // ------------------------------------------------------------------ who

    /**
     * Who is signed in, and which clinic to show them.
     *
     * A user document carries `clinicRoles`, a map of clinicId to role, plus an
     * optional `defaultClinicId`. Both are consulted because a stored default can
     * outlive the clinic it names: deleting a clinic does not tidy the maps on
     * the accounts that belonged to it, and opening a dead id makes every read
     * come back empty — which looks exactly like a permissions fault and is the
     * kind of thing that costs a day to diagnose. So the default is only used if
     * that clinic still exists.
     */
    suspend fun signedIn(): Result<Who> = withContext(Dispatchers.IO) {
        runCatching {
            val user = auth.currentUser ?: error("Not signed in.")
            val snap = db.collection("users").document(user.uid).get().await()
            if (!snap.exists()) error("This account has no profile in the clinic system.")

            @Suppress("UNCHECKED_CAST")
            val roles = (snap.get("clinicRoles") as? Map<String, String>).orEmpty()
            if (roles.isEmpty()) error("This account is not linked to any clinic.")

            val preferred = snap.getString("defaultClinicId")?.takeIf { roles.containsKey(it) }
            val candidates = listOfNotNull(preferred) + roles.keys
            val clinicId = candidates.distinct().firstOrNull { clinic(it).get().await().exists() }
                ?: error("The clinic linked to this account no longer exists.")

            // A platform super admin is an Admin everywhere — that is how the
            // website has always read it. The phone once did not read it at all,
            // so an owner whose reach comes from this flag rather than from a
            // clinicRoles entry signed in to a dashboard with every gated tool
            // removed: same email, same password, a fraction of the app.
            // Tolerates the string form, for the same reason the rules file does.
            val superAdmin = snap.getBoolean("isSuperAdmin") == true ||
                snap.getString("isSuperAdmin") == "true"

            val role = when {
                superAdmin -> "Admin"
                else -> (roles[clinicId] ?: snap.getString("role"))?.trim()?.takeIf { it.isNotBlank() }
                    ?: "Assistant"
            }
            if (role == "Patient") error("This app is for clinic staff.")

            // The Manage Access tick-boxes, per clinic. The same document and the
            // same field the Firestore rules read, so a permission the phone
            // honours is one the server would allow — not a second, kinder opinion.
            @Suppress("UNCHECKED_CAST")
            val granted = (snap.get("clinicPermissions") as? Map<String, Any?>)
                ?.get(clinicId) as? List<*>

            Who(
                uid = user.uid,
                name = snap.getString("name").orEmpty().ifBlank { user.email.orEmpty() },
                email = user.email.orEmpty(),
                clinicId = clinicId,
                role = role,
                permissions = granted?.mapNotNull { it as? String }?.toSet().orEmpty(),
            )
        }
    }

    /** The clinic's own name, for the slab. Read once — it changes about once a lifetime. */
    suspend fun clinicProfile(clinicId: String): Clinic = withContext(Dispatchers.IO) {
        val d = runCatching { clinic(clinicId).collection("settings").document("clinic_info").get().await() }
            .getOrNull()
        Clinic(
            name = d?.getString("name").orEmpty(),
            currency = d?.getString("currency")?.takeIf { it.isNotBlank() } ?: "EGP",
        )
    }

    /**
     * When the clinic opens, closes, and how long a slot is.
     *
     * Same document as the profile, so the two are usually one read apart — kept
     * separate because a screen that only needs the name should not pay for the
     * parsing, and because `configured` decides whether a free-slot count is
     * honest or invented.
     */
    suspend fun hours(clinicId: String): Hours = withContext(Dispatchers.IO) {
        val d = runCatching {
            clinic(clinicId).collection("settings").document("clinic_info").get().await()
        }.getOrNull()
        @Suppress("UNCHECKED_CAST")
        parseHours(d?.get("schedule") as? Map<String, Any?>)
    }

    // ------------------------------------------------------------- the day

    /**
     * Every appointment on one day, live, in diary order.
     *
     * A listener: a receptionist must see an arrival without refreshing. Sorted
     * here rather than in the query because the stored time is a display string
     * ("09:30 AM") that Firestore cannot order correctly.
     */
    fun watchDay(clinicId: String, dateKey: String): Flow<List<Visit>> = callbackFlow {
        val reg: ListenerRegistration = clinic(clinicId)
            .collection("appointments")
            .whereEqualTo("date", dateKey)
            .addSnapshotListener { snap, error ->
                if (error != null) {
                    // Close with the failure rather than swallowing it: a silently
                    // empty day is indistinguishable from a quiet one.
                    close(error)
                    return@addSnapshotListener
                }
                val visits = snap?.documents.orEmpty()
                    .map { it.toVisit() }
                    .sortedWith(compareBy({ it.minuteOfDay }, { it.patientName }))
                trySend(visits)
            }
        awaitClose { reg.remove() }
    }

    // -------------------------------------------------------------- patients

    /** One page of the register, plus where to carry on from. */
    data class Page(val people: List<Person>, val cursor: DocumentSnapshot?, val more: Boolean)

    private const val PAGE = 40L

    /**
     * The register in name order, a page at a time.
     *
     * Ordered by name because that is what makes paging stable and makes "load
     * more" mean anything — an unordered page can repeat and skip records as
     * documents change underneath it.
     */
    suspend fun browsePeople(clinicId: String, after: DocumentSnapshot? = null): Page =
        withContext(Dispatchers.IO) {
            var q = clinic(clinicId).collection("patients").orderBy("name").limit(PAGE)
            if (after != null) q = q.startAfter(after)
            val snap = q.get().await()
            Page(
                people = snap.documents.map { it.toPerson() },
                cursor = snap.documents.lastOrNull(),
                // A full page probably has more behind it. One wasted empty fetch
                // at the end beats hiding the button while patients remain.
                more = snap.documents.size.toLong() == PAGE,
            )
        }

    /**
     * Search the register.
     *
     * A phone number is answered by an indexed range query. A name cannot be:
     * Firestore has no substring search, so a bounded slice of the register is
     * scanned and filtered here — the same compromise the website makes, and the
     * reason the scan is capped rather than unbounded.
     */
    suspend fun searchPeople(clinicId: String, term: String): List<Person> =
        withContext(Dispatchers.IO) {
            val t = term.trim()
            if (t.isEmpty()) return@withContext browsePeople(clinicId).people

            if (looksLikePhone(t)) {
                val snap = clinic(clinicId).collection("patients")
                    .orderBy("phone")
                    .startAt(t)
                    //  is past every ordinary character, so this is a prefix range.
                    .endAt(t + "")
                    .limit(PAGE)
                    .get().await()
                return@withContext snap.documents.map { it.toPerson() }
            }

            val snap = clinic(clinicId).collection("patients")
                .orderBy("name")
                .limit(SEARCH_SCAN)
                .get().await()
            snap.documents.map { it.toPerson() }.filter { matchesSearch(t, it) }
        }

    /** A cap on the name scan. Large enough for a real register, small enough to answer. */
    private const val SEARCH_SCAN = 800L

    /**
     * Who owes the clinic money, most first.
     *
     * A separate query rather than a filter over the browsed page: the people who
     * owe are rarely the first forty alphabetically, and a "who owes" list that
     * only knows about the As is worse than none.
     */
    suspend fun debtors(clinicId: String, limit: Long = 20): List<Person> =
        withContext(Dispatchers.IO) {
            runCatching {
                clinic(clinicId).collection("patients")
                    .whereGreaterThan("balance", 0)
                    .orderBy("balance", com.google.firebase.firestore.Query.Direction.DESCENDING)
                    .limit(limit)
                    .get().await()
                    .documents.map { it.toPerson() }
            }.getOrDefault(emptyList())
        }

    // ----------------------------------------------------------------- money

    /**
     * What was actually collected on a day.
     *
     * Payments only, deliberately — billed-but-unpaid would flatter the figure
     * badly, and this is the number an owner opens the app to see. `paid` is the
     * field the website writes; `amount` is the older name, still on historical
     * rows.
     */
    suspend fun takings(clinicId: String, dateKey: String): Double = withContext(Dispatchers.IO) {
        val snap = clinic(clinicId).collection("ledger")
            .whereEqualTo("date", dateKey)
            .get().await()
        snap.documents
            .filter { it.text("type") == "payment" }
            .sumOf { it.number("paid") ?: it.number("amount") ?: 0.0 }
    }

    /**
     * What the same weekday usually takes, over the last [weeks] of them.
     *
     * The comparison a clinic actually makes is "was that a good Saturday", not
     * "was that more than Friday" — a Saturday and a Tuesday are different
     * businesses. Days that took nothing are left OUT of the average rather than
     * counted as zero, because a closed day is not a bad day and including it
     * would flatter every open one.
     *
     * Null when there is nothing to compare against, which is the honest answer
     * for a clinic that has been running a fortnight.
     */
    suspend fun weekdayAverage(clinicId: String, dateKey: String, weeks: Int = 4): Double? =
        withContext(Dispatchers.IO) {
            val cal = Calendar.getInstance().apply { time = parseKey(dateKey) }
            val taken = buildList {
                repeat(weeks) {
                    cal.add(Calendar.DAY_OF_YEAR, -7)
                    val amount = runCatching { takings(clinicId, dateKey(cal.time)) }.getOrNull() ?: 0.0
                    if (amount > 0) add(amount)
                }
            }
            if (taken.isEmpty()) null else taken.average()
        }

    /**
     * Everything the books are owed, across every patient.
     *
     * Charges minus payments, per patient, floored at zero and summed. Floored
     * because a patient who overpaid holds a credit, not a negative debt, and
     * letting one patient's credit cancel another's arrears would understate what
     * the clinic is owed.
     */
    suspend fun owed(clinicId: String): Double = withContext(Dispatchers.IO) {
        val snap = clinic(clinicId).collection("ledger").get().await()
        val perPatient = mutableMapOf<String, Double>()
        snap.documents.forEach { d ->
            val patient = d.text("patientId").ifBlank { return@forEach }
            val value = d.number("paid") ?: d.number("amount") ?: 0.0
            val delta = if (d.text("type") == "payment") -value else value
            perPatient[patient] = (perPatient[patient] ?: 0.0) + delta
        }
        perPatient.values.sumOf { it.coerceAtLeast(0.0) }
    }

    // ---------------------------------------------------------------- writes

    /** Move a visit on. The only write the dashboard performs. */
    suspend fun setStage(clinicId: String, visitId: String, stage: Stage): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                clinic(clinicId).collection("appointments").document(visitId)
                    .update("status", stage.stored).await()
                Unit
            }
        }

    private fun parseKey(key: String): Date =
        runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull() ?: Date()
}
