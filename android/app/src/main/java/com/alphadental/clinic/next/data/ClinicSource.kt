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

    // ------------------------------------------------------------------ the door

    /**
     * Sign in with an email address and a password.
     *
     * Email only, and not because Google sign-in is unwanted: an Android app has
     * to be registered in the Firebase project with this build's signing
     * certificate before Google will hand back a token, and until that is done a
     * Google button is a button that always fails.
     *
     * Firebase's own messages are replaced. "ERROR_INVALID_CREDENTIAL" tells a
     * receptionist nothing; "That password is not right" tells them which of the
     * two boxes to look at.
     */
    suspend fun signIn(email: String, password: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            auth.signInWithEmailAndPassword(email.trim(), password).await()
            Unit
        }.recoverCatching { e -> throw Exception(signInMessage(e)) }
    }

    private fun signInMessage(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            e is com.google.firebase.auth.FirebaseAuthInvalidUserException ->
                "No account with that email address."
            e is com.google.firebase.auth.FirebaseAuthInvalidCredentialsException ->
                "That email address and password do not match."
            raw.contains("network", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. Try again once the phone is back online."
            // Firebase throttles an account after several wrong passwords, and
            // says so in a way nobody would guess from the screen.
            raw.contains("blocked all requests", true) || raw.contains("too many", true) ->
                "Too many attempts. Wait a few minutes, or reset the password."
            else -> "Could not sign in."
        }
    }

    /** Email a password reset link. Sent by Firebase, not by this app. */
    suspend fun sendReset(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            auth.sendPasswordResetEmail(email.trim()).await()
            Unit
        }.recoverCatching { e ->
            throw Exception(
                if (e is com.google.firebase.auth.FirebaseAuthInvalidUserException) {
                    "No account with that email address."
                } else {
                    "Could not send the reset email."
                }
            )
        }
    }

    /**
     * Sign in with the ID token Android's Credential Manager handed back.
     *
     * The token is exchanged with Firebase Auth, which resolves it to the same
     * account the website's Google sign-in uses — same project, same provider,
     * same uid — so the staff record and clinic roles line up with no extra
     * step. Nothing about the clinic is decided here; that is still users/{uid},
     * which only the server writes.
     */
    suspend fun signInWithGoogle(idToken: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val credential = com.google.firebase.auth.GoogleAuthProvider.getCredential(idToken, null)
            auth.signInWithCredential(credential).await()
            Unit
        }.recoverCatching { e -> throw Exception(signInMessage(e)) }
    }

    fun signOut() = auth.signOut()

    /** The signed-in account's uid, or null. Null is the whole gate's question. */
    fun uid(): String? = auth.currentUser?.uid

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

    // ------------------------------------------------------------- whatsapp
    //
    // READ ONLY. Sending goes through the clinic's live WhatsApp channel, where a
    // wrong message costs real money and a wrong recipient risks the number being
    // banned. Nothing here writes; replying is deliberately not wired up.

    private fun conversations(clinicId: String) =
        clinic(clinicId).collection("whatsapp_conversations")

    /**
     * The whole inbox, live.
     *
     * A listener because the queue is worked by two people at once: a message
     * answered at the desk has to stop showing as unread on the phone.
     */
    fun watchThreads(clinicId: String): Flow<List<Thread>> = callbackFlow {
        val reg = conversations(clinicId).addSnapshotListener { snap, error ->
            if (error != null) { close(error); return@addSnapshotListener }
            trySend(
                snap?.documents.orEmpty()
                    // Staff rehearsal rows live in this collection and are not
                    // conversations with anybody.
                    .filterNot { it.id.startsWith("play_") }
                    .map { it.toThread() }
                    // A row with no activity is a conversation the bot created and
                    // never spoke in. There is nothing to read there.
                    .filter { it.lastAt > 0L }
                    .sortedByDescending { it.lastAt }
            )
        }
        awaitClose { reg.remove() }
    }

    /**
     * The recent end of one thread, oldest first, live.
     *
     * Newest 200 at the query and then reversed: the recent end is what anyone
     * opens a thread for, and a year of history is not worth the read.
     */
    fun watchLines(clinicId: String, threadId: String): Flow<List<Line>> = callbackFlow {
        val reg = conversations(clinicId).document(threadId).collection("messages")
            .orderBy("at", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(200)
            .addSnapshotListener { snap, error ->
                if (error != null) { close(error); return@addSnapshotListener }
                trySend(snap?.documents.orEmpty().map { it.toLine() }.reversed())
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

    /**
     * One patient's whole file.
     *
     * Three reads in sequence rather than a join, because Firestore has none.
     * The visits are ordered here rather than in the query: ordering by date with
     * a patientId filter needs a composite index, and a missing index fails the
     * entire read — which turns a tidy query into a screen that shows nothing.
     */
    suspend fun record(clinicId: String, patientId: String): Result<Record> =
        withContext(Dispatchers.IO) {
            runCatching {
                val c = clinic(clinicId)
                val snap = c.collection("patients").document(patientId).get().await()
                if (!snap.exists()) error("That patient is no longer on file.")

                val ledgerSnap = c.collection("ledger")
                    .whereEqualTo("patientId", patientId).get().await()
                val visitSnap = c.collection("appointments")
                    .whereEqualTo("patientId", patientId).get().await()

                var charged = 0.0
                var paid = 0.0
                val lines = mutableListOf<Money>()

                ledgerSnap.documents.forEach { d ->
                    val type = d.text("type")
                    // The clinic's own overheads are not a patient debt.
                    if (type == "expense") return@forEach

                    val value = if (type == "payment") {
                        d.number("paid") ?: d.number("amount") ?: 0.0
                    } else {
                        d.number("amount") ?: d.number("cost") ?: 0.0
                    }
                    if (type == "procedure") charged += value else paid += value
                    if (value <= 0) return@forEach

                    lines += Money(
                        id = d.id,
                        date = d.text("date"),
                        type = type,
                        description = d.text("description"),
                        amount = value,
                        method = d.text("method"),
                        doctor = d.text("doctorName").ifBlank { d.text("doctor") },
                    )
                }

                val today = dateKey()
                val visits = visitSnap.documents.map { it.toVisit() }
                    .sortedWith(compareByDescending<Visit> { it.date }.thenByDescending { it.minuteOfDay })

                Record(
                    person = snap.toPerson(),
                    fileId = snap.text("fileId"),
                    dateOfBirth = snap.text("dateOfBirth"),
                    gender = snap.text("gender"),
                    allergies = snap.text("allergies"),
                    medicalHistory = snap.text("medicalHistory"),
                    balance = Balance(charged, paid),
                    upcoming = visits.filter { it.date >= today && !it.status.isFinished }
                        .sortedWith(compareBy({ it.date }, { it.minuteOfDay })),
                    past = visits.filter { it.date < today || it.status.isFinished },
                    ledger = lines.sortedByDescending { it.date },
                    teeth = snap.toTeeth(),
                )
            }
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

    /**
     * Every money line between two dates, inclusive.
     *
     * Dates are zero-padded "yyyy-MM-dd", so a string range really is a date
     * range — that is the assumption the whole screen rests on, and it holds
     * only because the website pads them.
     *
     * Expenses are kept rather than filtered: this is the clinic's money screen,
     * and a takings figure with no costs beside it is the number that makes a
     * bad month look like a good one.
     */
    suspend fun ledgerBetween(clinicId: String, fromKey: String, toKey: String): List<Money> =
        withContext(Dispatchers.IO) {
            val snap = clinic(clinicId).collection("ledger")
                .whereGreaterThanOrEqualTo("date", fromKey)
                .whereLessThanOrEqualTo("date", toKey)
                .get().await()

            snap.documents.map { d ->
                val type = d.text("type")
                Money(
                    id = d.id,
                    date = d.text("date"),
                    type = type,
                    description = d.text("description").ifBlank { d.text("patientName") },
                    // A payment's real value can sit in `paid` with `amount` left
                    // at zero by an older write path; a charge is the other way.
                    amount = if (type == "payment") {
                        d.number("paid") ?: d.number("amount") ?: 0.0
                    } else {
                        d.number("amount") ?: d.number("cost") ?: 0.0
                    },
                    method = d.text("method"),
                    doctor = d.text("doctorName").ifBlank { d.text("doctor") },
                )
            }.sortedByDescending { it.date }
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
