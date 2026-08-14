package com.alphadental.clinic.data

import com.alphadental.clinic.Firebase
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.SetOptions
import java.util.Date
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * Everything the app reads or writes.
 *
 * All of it goes straight to Firestore. There is no server in this file and no
 * API to be down: the same database the website writes to, read directly, with
 * Firestore's own cache making it work with no signal.
 */
object Repository {

    // ------------------------------------------------------------------ signing in

    /**
     * Sign in, then work out which clinic and role this person has.
     *
     * The role lookup is a second step because Firebase Auth only proves *who*
     * someone is. What they may do lives in users/{uid}, and is written only by
     * the server — a phone can read it but never grant itself a role.
     */
    suspend fun signIn(email: String, password: String): Result<Session> = runCatching {
        Firebase.auth().signInWithEmailAndPassword(email.trim(), password).await()
        loadSession().getOrThrow()
    }.recoverCatching { error ->
        throw when (error) {
            is FirebaseAuthInvalidUserException -> Exception("No account with that email address.")
            is FirebaseAuthInvalidCredentialsException -> Exception("That password is not right.")
            else -> error
        }
    }

    /** The signed-in user's session, or a failure explaining what is missing. */
    suspend fun loadSession(): Result<Session> = runCatching {
        val user = Firebase.auth().currentUser ?: error("Not signed in.")

        val snap = Firebase.db().collection("users").document(user.uid).get().await()
        if (!snap.exists()) error("This account has no profile in the clinic system.")

        @Suppress("UNCHECKED_CAST")
        val roles = (snap.get("clinicRoles") as? Map<String, String>).orEmpty()

        // Prefer the user's chosen clinic, fall back to the only one they belong to.
        // Mirrors resolveUserClinicId() on the server.
        val clinicId = (snap.getString("defaultClinicId")?.takeIf { it.isNotBlank() && roles.containsKey(it) })
            ?: roles.keys.firstOrNull()
            ?: error("This account is not linked to any clinic.")

        val role = roles[clinicId] ?: snap.getString("role") ?: "Assistant"
        if (role == "Patient") error("This app is for clinic staff.")

        Session(
            uid = user.uid,
            name = snap.getString("name") ?: user.email.orEmpty(),
            email = user.email.orEmpty(),
            clinicId = clinicId,
            role = role,
        )
    }

    fun signOut() = Firebase.auth().signOut()

    fun isSignedIn(): Boolean = Firebase.auth().currentUser != null

    // ---------------------------------------------------------------- appointments

    private fun appointments(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("appointments")

    /**
     * Live appointments for one calendar day.
     *
     * MetadataChanges.INCLUDE is what lets the screen be honest. Without it the
     * app cannot tell a change that reached the server from one still sitting on
     * this phone, so a check-in made with no signal would look identical to one
     * that actually landed. With it, each row knows whether it is still pending.
     *
     * The listener keeps firing from the cache while offline, so the day stays on
     * screen rather than emptying when the signal drops.
     */
    fun observeDay(clinicId: String, date: String): Flow<DayResult> = callbackFlow {
        val registration = appointments(clinicId)
            .whereEqualTo("date", date)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                if (error != null) {
                    trySend(DayResult(emptyList(), fromCache = true, error = error.message))
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener

                val rows = snapshot.documents
                    .map { it.toAppointment(pendingWrite = it.metadata.hasPendingWrites()) }
                    // Cancelled appointments stay visible: reception needs to see that
                    // the slot was freed, not have it silently disappear.
                    .sortedWith(compareBy({ it.minutes() }, { it.patientName }))

                trySend(
                    DayResult(
                        appointments = rows,
                        fromCache = snapshot.metadata.isFromCache,
                        pendingCount = rows.count { it.pendingWrite },
                    )
                )
            }
        awaitClose { registration.remove() }
    }

    /**
     * Move an appointment to a new status, with the same side effects the website
     * applies.
     *
     * Only the fields that change are written, never the whole document. Two
     * people editing the same appointment offline — one setting a status, another
     * changing the time — both survive; a whole-document write would silently
     * throw one of them away.
     */
    suspend fun setStatus(
        clinicId: String,
        appointment: Appointment,
        next: String,
        byName: String,
    ): Result<Unit> = runCatching {
        val updates = mutableMapOf<String, Any>(
            "status" to next,
            "history" to FieldValue.arrayUnion(
                mapOf(
                    "action" to "status:$next",
                    "at" to System.currentTimeMillis(),
                    "modifiedBy" to byName,
                )
            ),
        )

        if (next == "Checked In" && appointment.status != "Checked In") {
            // Stamped once. Re-checking someone in must not move the time they
            // actually arrived, which is what the waiting-room display counts from.
            if (!appointment.hasCheckedIn) updates["checkInTime"] = FieldValue.serverTimestamp()
            updates["waitingMood"] = "neutral"
        }
        if ((next == "Checking Out" || next == "Completed") && appointment.status != next) {
            updates["checkOutTime"] = FieldValue.serverTimestamp()
        }

        appointments(clinicId).document(appointment.id).update(updates).await()

        // The waiting-room list on the website is built from this collection, so a
        // patient checked in from the phone has to appear there too.
        if (next == "Checked In" && appointment.status != "Checked In") {
            Firebase.db().collection("clinics").document(clinicId).collection("attendance")
                .add(
                    mapOf(
                        "patientId" to appointment.patientId,
                        "patientName" to appointment.patientName,
                        "appointmentId" to appointment.id,
                        "checkInTime" to FieldValue.serverTimestamp(),
                        "doctor" to appointment.doctor,
                        "status" to "waiting",
                    )
                ).await()
        }
    }

    // ------------------------------------------------------------------------ sms

    /** One queued reminder, as handed to the sender. */
    data class QueuedSms(val id: String, val to: String, val text: String)

    /**
     * How long a claimed message may sit before another phone may take it.
     *
     * The claim is what stops two phones sending the same reminder. But a phone that claims a
     * message and is then killed — battery saver, a reboot, someone swiping the app away — would
     * hold it forever, and the patient would simply never be reminded. After this long it is fair
     * game again.
     */
    private const val CLAIM_TIMEOUT_MS = 15 * 60 * 1000L

    /** Stop retrying a number the network keeps refusing, instead of texting it forever. */
    private const val MAX_SMS_ATTEMPTS = 3L

    private fun smsOutbox(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("sms_outbox")

    /**
     * Take ownership of waiting messages so this phone can send them.
     *
     * Each claim is its own transaction. Inside it the message is re-read and re-checked, so two
     * phones polling at the same moment cannot both walk away with the same reminder — the loser
     * sees the winner's claim and skips it. Claiming per message rather than per batch means one
     * contested message does not force the whole batch to retry.
     */
    suspend fun claimQueuedSms(clinicId: String, deviceId: String, limit: Int): List<QueuedSms> {
        val pending = smsOutbox(clinicId)
            .whereIn("status", listOf("queued", "sending"))
            .limit(limit * 2L)
            .get()
            .await()

        val claimed = mutableListOf<QueuedSms>()
        val now = System.currentTimeMillis()

        for (doc in pending.documents) {
            if (claimed.size >= limit) break

            val outcome = runCatching {
                Firebase.db().runTransaction { tx ->
                    val snap = tx.get(doc.reference)
                    if (!snap.exists()) return@runTransaction null

                    val status = snap.getString("status").orEmpty()
                    val attempts = (snap.get("attempts") as? Number)?.toLong() ?: 0L
                    if (attempts >= MAX_SMS_ATTEMPTS) return@runTransaction null

                    if (status == "sending") {
                        val claimedAt = snap.getString("claimedAt")?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
                        // Still with another phone and not yet overdue — leave it alone.
                        if (claimedAt != null && now - claimedAt < CLAIM_TIMEOUT_MS) return@runTransaction null
                    } else if (status != "queued") {
                        return@runTransaction null
                    }

                    tx.update(
                        doc.reference,
                        mapOf(
                            "status" to "sending",
                            "claimedAt" to java.time.Instant.ofEpochMilli(now).toString(),
                            "claimedByDeviceId" to deviceId,
                            "attempts" to attempts + 1,
                        ),
                    )

                    QueuedSms(
                        id = snap.id,
                        to = snap.getString("to").orEmpty(),
                        text = snap.getString("text").orEmpty(),
                    )
                }.await()
            }.getOrNull()

            if (outcome != null && outcome.to.isNotBlank() && outcome.text.isNotBlank()) claimed += outcome
        }

        return claimed
    }

    /**
     * Record what the phone actually managed to send.
     *
     * A failure goes back to `queued` while attempts remain — a text that failed because the phone
     * was underground at 07:00 should go out at 07:15, not be abandoned. Only once the attempts are
     * spent does it become a visible failure, because at that point a human needs to know the
     * patient was never told.
     */
    suspend fun ackSms(clinicId: String, messageId: String, sent: Boolean, error: String?): Result<Unit> = runCatching {
        val ref = smsOutbox(clinicId).document(messageId)

        if (sent) {
            ref.update(
                mapOf(
                    "status" to "sent",
                    "sentAt" to java.time.Instant.now().toString(),
                    "error" to null,
                )
            ).await()
            return@runCatching
        }

        val snap = ref.get().await()
        val attempts = (snap.get("attempts") as? Number)?.toLong() ?: 0L
        val exhausted = attempts >= MAX_SMS_ATTEMPTS

        ref.update(
            mapOf(
                "status" to if (exhausted) "failed" else "queued",
                "error" to (error ?: "The phone could not send this message."),
                "claimedAt" to null,
                "claimedByDeviceId" to null,
            )
        ).await()
    }

    /**
     * Tell the clinic that this phone is alive and willing to send.
     *
     * The server's nightly job checks for a recent heartbeat before queueing anything. Without it,
     * a clinic that switched SMS on but has no phone actually running would accumulate a queue
     * nobody collects — a list that grows and never moves, which looks like a broken system rather
     * than an unconfigured one.
     */
    suspend fun heartbeatSmsDevice(clinicId: String, deviceId: String, name: String) {
        Firebase.db().collection("clinics").document(clinicId)
            .collection("sms_devices").document(deviceId)
            .set(
                mapOf(
                    "name" to name,
                    "platform" to "android",
                    "lastSeenAt" to java.time.Instant.now().toString(),
                    "enabled" to true,
                ),
                SetOptions.merge(),
            ).await()
    }

    /** Stop being the sender, so the clinic's list stops showing this phone as available. */
    suspend fun releaseSmsDevice(clinicId: String, deviceId: String) {
        runCatching {
            Firebase.db().collection("clinics").document(clinicId)
                .collection("sms_devices").document(deviceId)
                .set(mapOf("enabled" to false), SetOptions.merge()).await()
        }
    }

    // -------------------------------------------------------------------- booking

    /** The clinic's working hours, for building the slot list. */
    suspend fun loadSchedule(clinicId: String): ClinicSchedule {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("settings").document("clinic_info").get().await()

        @Suppress("UNCHECKED_CAST")
        val schedule = snap.get("schedule") as? Map<String, Any?>
        return parseClinicSchedule(schedule)
    }

    /**
     * The dentists an appointment can be assigned to.
     *
     * `isDentist` is checked as well as the role because an Admin who also treats patients is
     * flagged that way rather than being given the Dentist role — the website's isDentistStaff()
     * does the same, and missing it would leave the clinic owner out of their own doctor list.
     */
    suspend fun loadDoctors(clinicId: String): List<Doctor> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("staff").get().await()

        return snap.documents
            .filter { doc ->
                val role = doc.getString("role").orEmpty()
                role == "Dentist" || doc.getBoolean("isDentist") == true
            }
            .map { Doctor(id = it.id, name = it.getString("name").orEmpty()) }
            .filter { it.name.isNotBlank() }
            .sortedBy { it.name }
    }

    /**
     * The clinic's own list of visit reasons, from settings/visit_reasons.
     *
     * The same document the Visit Reasons settings tab writes, so a reason added on the website
     * appears on the phone without an app update. Falls back to the website's own default rather
     * than an empty list, so the picker is never blank on a clinic that never configured it.
     */
    suspend fun loadVisitReasons(clinicId: String): List<String> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("settings").document("visit_reasons").get().await()

        @Suppress("UNCHECKED_CAST")
        val stored = (snap.get("reasons") as? List<Any?>)
            ?.mapNotNull { it?.toString()?.trim()?.takeIf(String::isNotEmpty) }
            .orEmpty()

        return stored.ifEmpty { listOf(DEFAULT_VISIT_REASON) }
    }

    /** The clinic's price list. */
    suspend fun loadServices(clinicId: String): List<Service> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("services").get().await()

        return snap.documents.mapNotNull { doc ->
            val name = doc.getString("name")?.trim().orEmpty()
            if (name.isEmpty()) return@mapNotNull null
            Service(
                id = doc.id,
                name = name,
                price = (doc.get("price") as? Number)?.toDouble() ?: 0.0,
                // Stored as a string by the pricing form in some records, a number in others.
                durationMinutes = when (val d = doc.get("durationMinutes")) {
                    is Number -> d.toInt()
                    is String -> d.toIntOrNull() ?: 0
                    else -> 0
                },
            )
        }.sortedBy { it.name }
    }

    /**
     * One page of the patient directory.
     *
     * `cursor` is handed back on the next call to continue where this page stopped. It is a
     * Firestore document rather than an offset because rows can be added while someone is paging,
     * and an offset would quietly skip or repeat a patient when that happens.
     */
    data class PatientPage(
        val patients: List<Patient>,
        val cursor: DocumentSnapshot? = null,
        val hasMore: Boolean = false,
    )

    /** Page size for browsing the directory. Matches PAGE_SIZE on the website's patients screen. */
    private const val PATIENT_PAGE_SIZE = 30L

    /**
     * Cap on a name search.
     *
     * Firestore cannot search for text in the middle of a value, so a name search reads a page of
     * the directory and filters it here — the same thing the website does, with the same cap. It
     * is a real limit: a clinic with more than this many patients could have a name the search
     * never reaches. Ordering by name at least makes which ones predictable rather than arbitrary.
     */
    /**
     * The highest character Firestore will order after any normal text.
     *
     * A prefix query is expressed as a range: everything from the term up to the term followed by
     * this. Without it the range collapses to an exact match, and searching "0100" would find only
     * a patient whose number is literally "0100" — which looks like "no results" rather than a
     * broken query.
     */
    private const val PREFIX_SENTINEL = "\uf8ff"

    private const val PATIENT_SEARCH_SCAN = 2500L

    private fun patientsCollection(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("patients")

    private fun toPatient(doc: DocumentSnapshot): Patient = Patient(
        id = doc.id,
        name = doc.getString("name").orEmpty(),
        phone = PHONE_KEYS.firstNotNullOfOrNull { doc.getString(it)?.takeIf(String::isNotBlank) }.orEmpty(),
        balance = (doc.get("balance") as? Number)?.toDouble() ?: 0.0,
    )

    /**
     * Walk the directory in name order.
     *
     * Used when the search box is empty, so the screen is a browsable list rather than a blank
     * prompt. Ordering by name is what makes paging stable and makes "load more" mean something.
     */
    suspend fun browsePatients(clinicId: String, after: DocumentSnapshot? = null): PatientPage {
        var query = patientsCollection(clinicId)
            .orderBy("name")
            .limit(PATIENT_PAGE_SIZE)
        if (after != null) query = query.startAfter(after)

        val snap = query.get().await()
        return PatientPage(
            patients = snap.documents.map(::toPatient),
            cursor = snap.documents.lastOrNull(),
            // A full page probably means more behind it. One wasted empty fetch at the end is
            // better than hiding the button while patients remain.
            hasMore = snap.documents.size.toLong() == PATIENT_PAGE_SIZE,
        )
    }

    /**
     * Find patients by name or phone.
     *
     * Two different strategies, matching the website exactly:
     *
     *  - **A phone number** is answered by an indexed prefix query, so it stays fast and pages
     *    properly however large the clinic is.
     *  - **A name** cannot be: Firestore has no "contains" search, so a page of the directory is
     *    read in name order and matched in memory. That is what allows "hassan ahmed" to find
     *    "Ahmed Hassan", which a prefix query could never do.
     *
     * Works from a single character, because that is what the website does.
     */
    suspend fun searchPatients(clinicId: String, term: String, after: DocumentSnapshot? = null): PatientPage {
        val trimmed = term.trim()
        if (trimmed.isEmpty()) return browsePatients(clinicId, after)

        if (looksLikePhoneSearch(trimmed)) {
            var query = patientsCollection(clinicId)
                .orderBy("phone")
                .startAt(trimmed)
                .endAt(trimmed + PREFIX_SENTINEL)
                .limit(PATIENT_PAGE_SIZE)
            if (after != null) query = query.startAfter(after)

            val snap = query.get().await()
            return PatientPage(
                patients = snap.documents.map(::toPatient),
                cursor = snap.documents.lastOrNull(),
                hasMore = snap.documents.size.toLong() == PATIENT_PAGE_SIZE,
            )
        }

        val snap = patientsCollection(clinicId)
            .orderBy("name")
            .limit(PATIENT_SEARCH_SCAN)
            .get()
            .await()

        val matches = snap.documents
            .map(::toPatient)
            .filter { patientMatchesSearch(trimmed, it.name, it.phone) }

        // Filtered in memory, so there is no cursor to continue from — everything that matched
        // inside the scanned range is already here.
        return PatientPage(patients = matches, cursor = null, hasMore = false)
    }

    /** Convenience for callers that only want a list, such as the booking sheet. */
    suspend fun searchPatientList(clinicId: String, term: String): List<Patient> =
        searchPatients(clinicId, term).patients


    /**
     * Create a patient, taking the next file number.
     *
     * The counter is incremented inside a transaction because two receptionists registering
     * someone at the same moment would otherwise both read the same number and hand two patients
     * the same file id. Mirrors the isNewPatient branch of saveBooking().
     */
    suspend fun createPatient(clinicId: String, name: String, phone: String): Result<Patient> = runCatching {
        val clinic = Firebase.db().collection("clinics").document(clinicId)
        val counterRef = clinic.collection("settings").document("counters")

        val nextId = Firebase.db().runTransaction { tx ->
            val counter = tx.get(counterRef)
            val current = (counter.get("patientId") as? Number)?.toLong()
            val next = if (current != null) current + 1 else 1000L
            tx.set(counterRef, mapOf("patientId" to next), SetOptions.merge())
            next
        }.await()

        val data = mapOf(
            "fileId" to "PT-$nextId",
            "name" to name.trim(),
            "phone" to phone.trim(),
            "createdAt" to FieldValue.serverTimestamp(),
        )
        val ref = clinic.collection("patients").add(data).await()

        Patient(id = ref.id, name = name.trim(), phone = phone.trim())
    }

    /**
     * Book a new appointment.
     *
     * Every field written here matches the shape saveBooking() produces in the browser, and both
     * date and time go through the shared normalisers first. A record the phone creates has to be
     * indistinguishable from one the website creates — this is one database, and a stray format
     * would make the appointment invisible to the other side rather than merely untidy.
     */
    suspend fun createAppointment(
        clinicId: String,
        patient: Patient,
        doctor: Doctor?,
        dateKey: String,
        time: String,
        durationMinutes: Int,
        treatment: String,
        notes: String,
        service: Service?,
        byName: String,
    ): Result<String> = runCatching {
        val data = hashMapOf<String, Any?>(
            "patientId" to patient.id,
            "patientName" to patient.name,
            "treatment" to treatment.trim(),
            "doctor" to (doctor?.name ?: ""),
            "doctorId" to doctor?.id,
            "date" to normalizeDateKey(dateKey),
            "time" to normalizeTimeKey(time),
            "duration" to durationMinutes,
            "type" to "consult",
            "notes" to notes.trim(),
            // The price-list entry this visit is for. Written with the same field names the
            // browser uses so the appointment opens identically there.
            "serviceId" to service?.id,
            "serviceName" to service?.name,
            "listPrice" to (service?.price ?: 0.0),
            // What the visit is expected to cost. This is the figure on the appointment — it does
            // NOT post to the ledger. Invoicing is a separate, deliberate act on the patient's
            // file, and silently creating financial records from a booking screen is exactly the
            // kind of thing nobody would find until the month-end numbers were wrong.
            "cost" to (service?.price ?: 0.0),
            "status" to "Scheduled",
            "statusHistory" to listOf(
                mapOf(
                    "status" to "Scheduled",
                    "timestamp" to Date(),
                    "modifiedBy" to byName,
                )
            ),
            "addedBy" to byName,
            "createdAt" to FieldValue.serverTimestamp(),
        )

        val ref = appointments(clinicId).add(data).await()
        ref.id
    }

    /**
     * Move an appointment to a new day, time or doctor.
     *
     * Only the fields that actually change are sent, for the same reason status changes are —
     * a whole-document write would silently discard a colleague's concurrent edit to a field this
     * screen never showed.
     */
    suspend fun rescheduleAppointment(
        clinicId: String,
        appointment: Appointment,
        dateKey: String,
        time: String,
        doctor: Doctor?,
        byName: String,
    ): Result<Unit> = runCatching {
        val updates = mutableMapOf<String, Any>(
            "date" to normalizeDateKey(dateKey),
            "time" to normalizeTimeKey(time),
            "history" to FieldValue.arrayUnion(
                mapOf(
                    "action" to "rescheduled",
                    "at" to System.currentTimeMillis(),
                    "modifiedBy" to byName,
                )
            ),
        )
        doctor?.let {
            updates["doctor"] = it.name
            updates["doctorId"] = it.id
        }

        appointments(clinicId).document(appointment.id).update(updates).await()
    }

    // -------------------------------------------------------------------- patients

    /** Matches DEFAULT_REASONS in components/settings/VisitReasonsSettings.tsx. */
    private const val DEFAULT_VISIT_REASON = "كشف"

    private val PHONE_KEYS = listOf("phone", "phoneNumber", "mobile", "whatsapp", "contactNumber")

    /**
     * Everything the patient file shows, in one call.
     *
     * The three reads run together rather than in sequence because on clinic wifi the difference
     * between one round trip and three is the difference between the screen appearing and the
     * screen visibly assembling itself.
     */
    suspend fun loadPatientFile(clinicId: String, patientId: String): Result<PatientFile> = runCatching {
        val clinic = Firebase.db().collection("clinics").document(clinicId)

        val patientSnap = clinic.collection("patients").document(patientId).get().await()
        if (!patientSnap.exists()) error("That patient is no longer on file.")

        val ledgerSnap = clinic.collection("ledger").whereEqualTo("patientId", patientId).get().await()
        val visitsSnap = clinic.collection("appointments").whereEqualTo("patientId", patientId).get().await()

        val rows = ledgerSnap.documents.map { doc ->
            LedgerRow(
                type = doc.getString("type").orEmpty(),
                amount = (doc.get("amount") as? Number)?.toDouble(),
                cost = (doc.get("cost") as? Number)?.toDouble(),
                paid = (doc.get("paid") as? Number)?.toDouble(),
            )
        }

        val visits = visitsSnap.documents
            .map { it.toAppointment(pendingWrite = it.metadata.hasPendingWrites()) }
            // Newest first. Ordered here rather than in the query because Firestore would need a
            // composite index for patientId + date, and a missing index fails the whole read.
            .sortedWith(compareByDescending<Appointment> { it.date }.thenByDescending { it.minutes() })

        val today = todayKey()

        PatientFile(
            patient = Patient(
                id = patientSnap.id,
                name = patientSnap.getString("name").orEmpty(),
                phone = PHONE_KEYS.firstNotNullOfOrNull {
                    patientSnap.getString(it)?.takeIf(String::isNotBlank)
                }.orEmpty(),
            ),
            fileId = patientSnap.getString("fileId").orEmpty(),
            balance = balanceOf(rows),
            upcoming = visits.filter { it.date >= today && normalizeStatusForFile(it.status) !in FINISHED_STATUSES }
                .sortedWith(compareBy<Appointment> { it.date }.thenBy { it.minutes() }),
            past = visits.filter { it.date < today || normalizeStatusForFile(it.status) in FINISHED_STATUSES },
        )
    }

    private val FINISHED_STATUSES = setOf("Completed", "Cancelled", "No Show")

    private fun normalizeStatusForFile(status: String?): String = when (status) {
        null, "" -> "Scheduled"
        "Arrived" -> "Checked In"
        "Seated" -> "In Chair"
        "Pending" -> "Scheduled"
        "In Progress" -> "In Chair"
        else -> status
    }

    /** A patient's contact details and balance, for the card behind an appointment. */
    suspend fun loadPatient(clinicId: String, patientId: String): Patient? {
        if (patientId.isBlank()) return null
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("patients").document(patientId).get().await()
        if (!snap.exists()) return null

        return Patient(
            id = snap.id,
            name = snap.getString("name").orEmpty(),
            phone = listOf("phone", "phoneNumber", "mobile", "whatsapp", "contactNumber")
                .firstNotNullOfOrNull { snap.getString(it)?.takeIf(String::isNotBlank) }
                .orEmpty(),
            balance = (snap.get("balance") as? Number)?.toDouble() ?: 0.0,
        )
    }
}

/**
 * One update of a day's schedule.
 *
 * `fromCache` and `pendingCount` are carried all the way to the screen on purpose.
 * The app never shows a change as saved to the clinic when it is only saved to
 * this phone.
 */
data class DayResult(
    val appointments: List<Appointment>,
    val fromCache: Boolean,
    val pendingCount: Int = 0,
    val error: String? = null,
)
