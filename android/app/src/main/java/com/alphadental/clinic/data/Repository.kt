package com.alphadental.clinic.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.android.gms.tasks.Task
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthInvalidUserException
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.SetOptions
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
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

    private const val TAG = "AlphaRepository"

    /**
     * Hand a write to Firestore and carry on, without waiting for the server.
     *
     * This is the single most important line in the file, and getting it wrong is what made the
     * app useless with no signal.
     *
     * A Firestore write task completes when the **server** acknowledges the write. With no signal
     * that acknowledgement never arrives — and the task does not fail either, it simply never
     * completes — so `await()` on one is indistinguishable from the app hanging. Every recording
     * action went through such an await, so checking a patient in, taking a payment or writing a
     * note appeared to do nothing at all offline. The data was already safely in the local
     * database each time; the coroutine waiting to be told so never returned.
     *
     * By the time the task is handed back here the write is already applied to the on-device
     * cache, every snapshot listener has fired with `hasPendingWrites` set — which is what the UI
     * shows as "Not sent yet" — and Firestore will keep retrying in the background, across app
     * restarts, until it lands.
     *
     * A permanent rejection, which in practice means the security rules said no, is logged rather
     * than shown. There is no honest way to raise it: by the time the server answers, the person
     * who made the change may have put the phone in their pocket and walked to another room.
     */
    private fun Task<*>.queueLocally(what: String) {
        addOnFailureListener { error -> Log.w(TAG, "$what was rejected by the server: ${error.message}") }
    }

    /**
     * A new document reference with an id, without touching the network.
     *
     * `add()` cannot be used for anything that has to work offline: it returns the reference
     * through a task that only completes on server acknowledgement. Firestore generates document
     * ids on the device, so asking for the reference first and writing into it gives the same
     * result and an id that is usable immediately.
     */
    private fun CollectionReference.newDoc(): DocumentReference = document()

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

    /**
     * Sign in with the Google ID token the Credential Manager handed back.
     *
     * The token is exchanged with Firebase Auth, which resolves it to the same
     * account the website's Google sign-in uses — same project, same provider,
     * same uid — so the staff profile and clinic roles line up automatically.
     */
    suspend fun signInWithGoogle(idToken: String): Result<Session> = runCatching {
        val credential = com.google.firebase.auth.GoogleAuthProvider.getCredential(idToken, null)
        Firebase.auth().signInWithCredential(credential).await()
        loadSession().getOrThrow()
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

        appointments(clinicId).document(appointment.id).update(updates).queueLocally("check-in")

        // The waiting-room list on the website is built from this collection, so a
        // patient checked in from the phone has to appear there too.
        if (next == "Checked In" && appointment.status != "Checked In") {
            Firebase.db().collection("clinics").document(clinicId).collection("attendance")
                .newDoc()
                .set(
                    mapOf(
                        "patientId" to appointment.patientId,
                        "patientName" to appointment.patientName,
                        "appointmentId" to appointment.id,
                        "checkInTime" to FieldValue.serverTimestamp(),
                        "doctor" to appointment.doctor,
                        "status" to "waiting",
                    )
                ).queueLocally("waiting-room entry")
        }
    }

    // -------------------------------------------------------------- prescriptions

    /** The clinic's saved drug shortcuts, so common medicines are two taps rather than typed. */
    suspend fun loadDrugShortcuts(clinicId: String): List<DrugShortcut> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("drugs").get().await()

        return snap.documents.mapNotNull { doc ->
            val name = doc.getString("name")?.trim().orEmpty()
            if (name.isEmpty()) return@mapNotNull null
            DrugShortcut(id = doc.id, name = name, dose = doc.getString("dose").orEmpty())
        }.sortedBy { it.name }
    }

    /** A patient's prescriptions, newest first. */
    suspend fun loadPrescriptions(clinicId: String, patientId: String): List<Prescription> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("prescriptions").whereEqualTo("patientId", patientId).get().await()

        return snap.documents.map { doc ->
            @Suppress("UNCHECKED_CAST")
            val raw = (doc.get("drugs") as? List<Map<String, Any?>>).orEmpty()
            Prescription(
                id = doc.id,
                date = doc.getString("date").orEmpty(),
                doctor = doc.getString("doctor").orEmpty(),
                diagnosis = doc.getString("diagnosis").orEmpty(),
                drugs = raw.map {
                    RxItem(
                        name = it["name"]?.toString().orEmpty(),
                        dose = it["dose"]?.toString().orEmpty(),
                        note = it["note"]?.toString().orEmpty(),
                    )
                },
            )
        }.sortedByDescending { it.date }
    }

    /**
     * Issue a prescription.
     *
     * Written in the same shape the website writes, so it opens and prints from there. Printing
     * itself stays on the website: the PDF is built by a JavaScript library with the clinic's
     * letterhead, and reproducing that layout natively would give two prescription designs that
     * drift apart — which on a legal document is worse than one extra tap.
     */
    suspend fun addPrescription(
        clinicId: String,
        patient: Patient,
        doctor: String,
        diagnosis: String,
        drugs: List<RxItem>,
    ): Result<String> = runCatching {
        require(drugs.isNotEmpty()) { "Add at least one medicine." }

        // newDoc + set, not add().await(): add() only completes on server acknowledgement, so a
        // prescription written with no signal hung forever. This was the one write the offline
        // sweep missed — its await sat on a different line from the add and dodged the grep.
        val ref = Firebase.db().collection("clinics").document(clinicId)
            .collection("prescriptions").newDoc()
        ref.set(
            mapOf(
                "patientId" to patient.id,
                "patientName" to patient.name,
                "date" to todayKey(),
                "doctor" to doctor,
                "diagnosis" to diagnosis.trim(),
                "drugs" to drugs.map {
                    mapOf("name" to it.name, "dose" to it.dose, "note" to it.note)
                },
                "mode" to "typed",
                "createdAt" to FieldValue.serverTimestamp(),
            )
        ).queueLocally("prescription")

        ref.id
    }

    // ------------------------------------------------------------------ inventory

    private fun inventory(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("inventory")

    suspend fun loadInventory(clinicId: String): List<InventoryItem> {
        val snap = inventory(clinicId).get().await()
        return snap.documents.mapNotNull { doc ->
            val name = doc.getString("name")?.trim().orEmpty()
            if (name.isEmpty()) return@mapNotNull null
            InventoryItem(
                id = doc.id,
                name = name,
                stock = (doc.get("stock") as? Number)?.toDouble() ?: 0.0,
                minStock = (doc.get("minStock") as? Number)?.toDouble() ?: 0.0,
                isPercentage = doc.getBoolean("isPercentage") == true,
                costPerUnit = (doc.get("costPerUnit") as? Number)?.toDouble() ?: 0.0,
            )
        }.sortedWith(compareByDescending<InventoryItem> { isLowStock(it) }.thenBy { it.name })
    }

    /**
     * Adjust stock by a delta.
     *
     * Clamped at zero, as the website does. A negative stock level is not a real state — it is a
     * miscount — and storing one makes every total downstream wrong in a way nobody traces back.
     */
    suspend fun adjustStock(clinicId: String, item: InventoryItem, delta: Double): Result<Unit> = runCatching {
        inventory(clinicId).document(item.id).update(
            mapOf(
                "stock" to (item.stock + delta).coerceAtLeast(0.0),
                "updatedAt" to FieldValue.serverTimestamp(),
            )
        ).queueLocally("stock adjustment")
    }

    // ----------------------------------------------------------------- attendance

    private fun attendance(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("attendance")

    /** The clinic's geofence, from settings/clinic_info. Null when it was never configured. */
    suspend fun loadGeofence(clinicId: String): Geofence? {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("settings").document("clinic_info").get().await()

        fun num(field: String): Double? = when (val v = snap.get(field)) {
            is Number -> v.toDouble()
            is String -> v.trim().toDoubleOrNull()
            else -> null
        }

        val fence = Geofence(
            lat = num("attendanceLat") ?: return null,
            lng = num("attendanceLng") ?: return null,
            radius = num("attendanceRadius") ?: 50.0,
        )
        return if (isUsableGeofence(fence)) fence else null
    }

    /** This user's staff record id, which attendance rows are filed against. */
    suspend fun findMyStaffId(clinicId: String, uid: String, email: String): String {
        val staff = Firebase.db().collection("clinics").document(clinicId).collection("staff")

        staff.whereEqualTo("uid", uid).limit(1).get().await().documents.firstOrNull()?.let { return it.id }

        // Older staff records were created before uid was stored, so fall back to the email and
        // stamp the uid on so the next lookup is direct — the website does the same.
        if (email.isNotBlank()) {
            staff.whereEqualTo("email", email).limit(1).get().await().documents.firstOrNull()?.let { doc ->
                runCatching { doc.reference.update("uid", uid).await() }
                return doc.id
            }
        }
        return ""
    }

    /** One clock-in that has not been clocked out. */
    data class OpenShift(val id: String, val checkInMillis: Long)

    /**
     * The shift this user currently has open, if any.
     *
     * Filtered on status rather than on "no checkOut" because a row is written with checkOut null
     * and later filled in; querying for a null field is not something Firestore does well.
     */
    suspend fun openShift(clinicId: String, uid: String): OpenShift? {
        val snap = attendance(clinicId)
            .whereEqualTo("userId", uid)
            .whereEqualTo("status", "active")
            .limit(1)
            .get()
            .await()

        val doc = snap.documents.firstOrNull() ?: return null
        val millis = (doc.getTimestamp("checkIn"))?.toDate()?.time ?: System.currentTimeMillis()
        return OpenShift(doc.id, millis)
    }

    /** Start a shift. */
    suspend fun clockIn(
        clinicId: String,
        uid: String,
        userName: String,
        staffId: String,
        verdict: GeofenceVerdict?,
        accuracy: Double?,
    ): Result<Unit> = runCatching {
        attendance(clinicId).newDoc().set(
            mapOf(
                "userId" to uid,
                "userName" to userName,
                "staffId" to staffId,
                // Local date, not UTC: a shift punched after midnight in Egypt was being filed
                // under the previous day on the website until this was fixed.
                "date" to todayKey(),
                "checkIn" to FieldValue.serverTimestamp(),
                "checkOut" to null,
                "durationMinutes" to 0,
                "status" to "active",
                // Kept so a disputed shift can be examined rather than argued about.
                "checkInDistanceM" to verdict?.distance,
                "checkInAccuracyM" to accuracy,
            )
        ).queueLocally("clock in")
    }

    /** End the open shift, recording how long it ran. */
    suspend fun clockOut(
        clinicId: String,
        shift: OpenShift,
        verdict: GeofenceVerdict?,
        accuracy: Double?,
    ): Result<Unit> = runCatching {
        val minutes = ((System.currentTimeMillis() - shift.checkInMillis) / 60_000L).coerceAtLeast(0L)

        attendance(clinicId).document(shift.id).update(
            mapOf(
                "checkOut" to FieldValue.serverTimestamp(),
                "durationMinutes" to minutes,
                "status" to "completed",
                "checkOutDistanceM" to verdict?.distance,
                "checkOutAccuracyM" to accuracy,
            )
        ).await()
    }

    // ------------------------------------------------------------- clinical notes

    private fun clinicalNotes(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("clinical_notes")

    /** A patient's recorded procedures, newest first. */
    suspend fun loadClinicalNotes(clinicId: String, patientId: String): List<ClinicalNote> {
        val snap = clinicalNotes(clinicId).whereEqualTo("patientId", patientId).get().await()

        return snap.documents
            .map { doc ->
                ClinicalNote(
                    id = doc.id,
                    procedure = doc.getString("procedure").orEmpty(),
                    tooth = doc.getString("tooth").orEmpty(),
                    note = doc.getString("note").orEmpty(),
                    cost = (doc.get("cost") as? Number)?.toDouble() ?: 0.0,
                    status = doc.getString("status").orEmpty().ifBlank { "Planned" },
                    doctor = doc.getString("doctor").orEmpty(),
                    date = doc.getString("date").orEmpty(),
                    ledgerId = doc.getString("ledgerId").orEmpty(),
                )
            }
            // Ordered here rather than in the query: sorting server-side on date would need a
            // composite index with patientId, and a missing index fails the whole read.
            .sortedByDescending { it.date }
    }

    /**
     * Record a procedure, and bill it.
     *
     * Two documents, linked both ways, exactly as the website writes them:
     *
     *  - the clinical note, which is the medical record
     *  - a ledger row of type "procedure", which is the charge
     *
     * The link matters in both directions. A note carrying a cost with no `ledgerId` is what the
     * Collect Dues screen reports as "treated, never invoiced" — so writing the note alone would
     * quietly file every procedure as lost revenue. The ledger row's `clinicalNoteId` is what lets
     * deleting the note later take its charge with it.
     *
     * A zero-cost note (a follow-up, a review) creates no ledger row at all, which is also what
     * the website does.
     */
    suspend fun addClinicalNote(
        clinicId: String,
        patient: Patient,
        procedure: String,
        teeth: List<String>,
        noteText: String,
        /** The price for ONE tooth. The total is this times the number of teeth — see pricingUnits. */
        unitCost: Double,
        status: String,
        doctor: Doctor?,
        service: Service?,
        byName: String,
    ): Result<String> = runCatching {
        require(procedure.isNotBlank()) { "Enter what was done." }

        val today = todayKey()
        val toothLabel = formatTeeth(teeth)
        val units = pricingUnits(teeth)

        // Four fillings is four times the money. The phone used to write the single-tooth price
        // whatever was selected, so exactly the treatments worth the most were the ones it
        // undercharged for.
        val cost = unitCost * units

        var ledgerId: String? = null

        if (cost > 0) {
            val commission = doctor?.commissionPercentage ?: 0.0
            val labFee = service?.estimatedLabFee ?: 0.0

            // Same split the payment screen uses, and the same reason: these numbers are what the
            // clinic's profit and the dentist's payout are calculated from later.
            val net = cost - labFee
            val doctorCommissionAmount = if (net > 0) net * (commission / 100.0) else 0.0

            val ledgerRow = mapOf(
                "patientId" to patient.id,
                "patientName" to patient.name,
                "type" to "procedure",
                "category" to "Treatment",
                "amount" to cost,
                "cost" to cost,
                // The composite shape the website writes, so the price-list matcher in its reports
                // can still recognise the service name at the front.
                "description" to "$procedure (T: $toothLabel)",
                "doctorId" to doctor?.id,
                "doctorName" to doctor?.name,
                "doctorCommissionPercentage" to commission,
                "labFee" to labFee,
                "doctorCommissionAmount" to doctorCommissionAmount,
                "clinicProfit" to (cost - doctorCommissionAmount - labFee),
                "date" to today,
                "paid" to 0,
                "createdAt" to FieldValue.serverTimestamp(),
            )
            val ledgerRef = ledger(clinicId).newDoc()
            ledgerRef.set(ledgerRow).queueLocally("procedure charge")
            ledgerId = ledgerRef.id
        }

        val noteRow = mapOf(
            "patientId" to patient.id,
            "procedure" to procedure.trim(),
            "procedures" to listOf(procedure.trim()),
            "tooth" to toothLabel,
            "note" to noteText.trim(),
            "cost" to cost,
            // The arithmetic behind the total, written because the website's invoice explains a
            // charge back to the patient as "350 × 3 teeth" rather than as a bare 1050.
            "unitCost" to unitCost,
            "unitsCount" to units,
            "pricingFormula" to pricingFormula(unitCost, units),
            "status" to status,
            "doctor" to (doctor?.name ?: ""),
            "doctorId" to doctor?.id,
            "serviceId" to service?.id,
            "serviceName" to service?.name,
            "serviceIds" to listOfNotNull(service?.id),
            "date" to today,
            "appointmentId" to null,
            "ledgerId" to ledgerId,
            "addedBy" to byName,
            "createdAt" to FieldValue.serverTimestamp(),
        )

        val noteRef = clinicalNotes(clinicId).newDoc()
        noteRef.set(noteRow).queueLocally("clinical note")
        val noteId = noteRef.id

        // Back-link, so deleting the note on the website removes its charge too. Safe to write
        // straight away even though the note has not reached the server: both writes are queued in
        // order and Firestore sends them in that order, so the charge never points at a note the
        // server has not seen.
        if (ledgerId != null) {
            ledger(clinicId).document(ledgerId).update("clinicalNoteId", noteId).queueLocally("note back-link")
        }

        noteId
    }

    /** Move a procedure between Planned, Ongoing and Completed. */
    suspend fun setNoteStatus(clinicId: String, noteId: String, status: String): Result<Unit> = runCatching {
        clinicalNotes(clinicId).document(noteId).update("status", status).queueLocally("note status")
    }


    /**
     * What the clinic has actually collected on a given day.
     *
     * Payments only — not what was charged. An owner glancing at the phone wants to know what came
     * through the door today, and mixing in unpaid procedures would flatter that number badly.
     */
    suspend fun takingsOn(clinicId: String, dateKey: String): Double {
        val snap = ledger(clinicId).whereEqualTo("date", dateKey).get().await()
        return snap.documents
            .filter { it.getString("type") == "payment" }
            .sumOf { doc ->
                (doc.get("paid") as? Number)?.toDouble()
                    ?: (doc.get("amount") as? Number)?.toDouble()
                    ?: 0.0
            }
    }

    /** One line on the day's money screen. */
    data class DayLedgerRow(
        val id: String,
        val patientName: String,
        val description: String,
        val type: String,
        val amount: Double,
        val method: String,
        val addedBy: String,
    ) {
        val isPayment: Boolean get() = type == "payment"
    }

    /** Everything that moved money on one day, newest-looking first. */
    suspend fun loadDayLedger(clinicId: String, dateKey: String): List<DayLedgerRow> {
        val snap = ledger(clinicId).whereEqualTo("date", dateKey).get().await()

        return snap.documents.map { doc ->
            val type = doc.getString("type").orEmpty()
            DayLedgerRow(
                id = doc.id,
                patientName = doc.getString("patientName").orEmpty(),
                description = doc.getString("description").orEmpty(),
                type = type,
                // Same per-type rule as everywhere else: a payment's real value can sit in `paid`
                // with `amount` left at 0 by an older write path.
                amount = if (type == "payment") {
                    (doc.get("paid") as? Number)?.toDouble() ?: (doc.get("amount") as? Number)?.toDouble() ?: 0.0
                } else {
                    (doc.get("amount") as? Number)?.toDouble() ?: (doc.get("cost") as? Number)?.toDouble() ?: 0.0
                },
                method = doc.getString("method").orEmpty(),
                addedBy = doc.getString("addedBy").orEmpty(),
            )
        }.sortedWith(compareByDescending<DayLedgerRow> { it.isPayment }.thenByDescending { it.amount })
    }

    /**
     * One ledger row the way the website's Finance page reads it: cash basis.
     *
     * Mirrors ledgerCashValue() and the page's filters exactly, so the phone and
     * the website never disagree about a day's money: expenses count their cost,
     * payments count what was actually paid (which can live in `paid` with
     * `amount` left at zero by an older write path), and treatment-plan rows are
     * excluded entirely — they live on the patient's ledger until they are paid.
     */
    data class FinanceRow(
        val id: String,
        val type: String,
        val date: String,
        val description: String,
        val category: String,
        val method: String,
        val patientName: String,
        val doctorName: String,
        val addedBy: String,
        /** Cash that moved on this row. */
        val cash: Double,
        val commission: Double,
        val labFee: Double,
        val clinicProfit: Double?,
        val hasClinicalNote: Boolean,
        val createdAtMillis: Long,
    ) {
        val isExpense: Boolean get() = type == "expense"

        /**
         * Only rows typed by hand may be deleted from the phone. A payment row is
         * part of a patient's story, and a procedure row cascades into clinical
         * notes — both belong to the website's fuller delete flow.
         */
        val isManual: Boolean get() = (type == "income" || type == "expense") && !hasClinicalNote
    }

    /** Everything the Finance screen shows for a period, newest first. */
    suspend fun loadFinance(clinicId: String, fromKey: String, toKey: String): List<FinanceRow> {
        val snap = ledger(clinicId)
            .whereGreaterThanOrEqualTo("date", fromKey)
            .whereLessThanOrEqualTo("date", toKey)
            .get()
            .await()

        return snap.documents.mapNotNull { doc ->
            val type = doc.getString("type").orEmpty()
            if (type == "procedure") return@mapNotNull null
            val cash = if (type == "expense") {
                (doc.get("cost") as? Number)?.toDouble() ?: (doc.get("amount") as? Number)?.toDouble() ?: 0.0
            } else {
                (doc.get("paid") as? Number)?.toDouble() ?: (doc.get("amount") as? Number)?.toDouble() ?: 0.0
            }
            // Zero-value rows are placeholders, not money that moved.
            if (cash <= 0) return@mapNotNull null

            FinanceRow(
                id = doc.id,
                type = type,
                date = doc.getString("date").orEmpty(),
                description = doc.getString("description").orEmpty(),
                category = doc.getString("category").orEmpty(),
                method = doc.getString("method").orEmpty(),
                patientName = doc.getString("patientName").orEmpty(),
                doctorName = doc.getString("doctorName").orEmpty()
                    .ifBlank { doc.getString("doctor").orEmpty() },
                addedBy = doc.getString("addedBy").orEmpty(),
                cash = cash,
                commission = (doc.get("doctorCommissionAmount") as? Number)?.toDouble() ?: 0.0,
                labFee = (doc.get("labFee") as? Number)?.toDouble() ?: 0.0,
                clinicProfit = (doc.get("clinicProfit") as? Number)?.toDouble(),
                hasClinicalNote = !doc.getString("clinicalNoteId").isNullOrBlank(),
                createdAtMillis = doc.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
            )
        }.sortedWith(compareByDescending<FinanceRow> { it.date }.thenByDescending { it.createdAtMillis })
    }

    /**
     * A manual income or expense line, written with the same shape the website's
     * "Manual Ledger Entry" form writes, so both read each other's rows.
     */
    suspend fun addFinanceEntry(
        clinicId: String,
        income: Boolean,
        amount: Double,
        description: String,
        category: String,
        dateKey: String,
        byName: String,
    ): Result<Unit> = runCatching {
        require(amount > 0) { "Enter an amount greater than zero." }
        require(description.isNotBlank()) { "A description is required." }
        ledger(clinicId).add(
            mapOf(
                "type" to if (income) "income" else "expense",
                "amount" to amount,
                "paid" to if (income) amount else 0,
                "cost" to if (!income) amount else 0,
                "description" to description.trim(),
                "category" to category.ifBlank { "General" },
                "date" to dateKey,
                "method" to "Cash",
                "isRecurring" to false,
                "addedBy" to byName,
                "patientId" to null,
                "doctor" to null,
                "createdAt" to FieldValue.serverTimestamp(),
                "updatedAt" to FieldValue.serverTimestamp(),
            )
        ).await()
        Unit
    }

    /** Deletes one manual row. Callers must check FinanceRow.isManual first. */
    suspend fun deleteFinanceEntry(clinicId: String, id: String): Result<Unit> = runCatching {
        ledger(clinicId).document(id).delete().await()
        Unit
    }

    /**
     * Every ledger row between two dates, inclusive.
     *
     * Dates are stored as "yyyy-MM-dd" strings, which sort the same way as the dates they stand
     * for, so a string range is a real date range here. That is only true because the format is
     * fixed-width and zero-padded — it would quietly break on "2026-8-1".
     */
    suspend fun loadLedgerRange(clinicId: String, fromKey: String, toKey: String): List<ReportRow> {
        val snap = ledger(clinicId)
            .whereGreaterThanOrEqualTo("date", fromKey)
            .whereLessThanOrEqualTo("date", toKey)
            .get()
            .await()

        return snap.documents.map { doc ->
            val type = doc.getString("type").orEmpty()
            ReportRow(
                type = type,
                // Same per-type rule as the day view: a payment's real value can sit in `paid`
                // with `amount` left at zero by an older write path.
                amount = if (type == "payment") {
                    (doc.get("paid") as? Number)?.toDouble() ?: (doc.get("amount") as? Number)?.toDouble() ?: 0.0
                } else {
                    (doc.get("amount") as? Number)?.toDouble() ?: (doc.get("cost") as? Number)?.toDouble() ?: 0.0
                },
                description = doc.getString("description").orEmpty(),
                doctorName = doc.getString("doctorName").orEmpty(),
                patientId = doc.getString("patientId").orEmpty(),
                date = doc.getString("date").orEmpty(),
            )
        }
    }

    // ---------------------------------------------------------------------- ortho

    private fun orthoCases(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("ortho_cases")

    private fun DocumentSnapshot.toOrthoVisits(): List<OrthoVisit> {
        @Suppress("UNCHECKED_CAST")
        val raw = get("visits") as? List<Map<String, Any?>> ?: return emptyList()
        return raw.map { row ->
            OrthoVisit(
                visitNo = (row["visitNo"] as? Number)?.toInt() ?: 0,
                date = row["date"] as? String ?: "",
                workDone = row["workDone"] as? String ?: "",
                nextStep = row["nextStep"] as? String ?: "",
            )
        }
    }

    /**
     * Every ortho case in the clinic.
     *
     * Read whole rather than filtered by status, because a clinic has tens of these rather than
     * thousands and the screen lets you switch between active and finished without another trip.
     */
    suspend fun loadOrthoCases(clinicId: String): List<OrthoCase> {
        val snap = orthoCases(clinicId).get().await()
        return snap.documents.map { doc ->
            OrthoCase(
                patientId = doc.id,
                patientName = doc.getString("patientName").orEmpty(),
                patientPhone = doc.getString("patientPhone").orEmpty(),
                startDate = doc.getString("startDate").orEmpty(),
                status = doc.getString("status").orEmpty().ifBlank { "Active" },
                diagnosis = doc.getString("diagnosis").orEmpty(),
                visits = doc.toOrthoVisits(),
            )
        }.sortedBy { it.patientName }
    }

    /**
     * Log an adjustment.
     *
     * Appended with arrayUnion rather than by rewriting the whole array. Two people at two chairs
     * both logging a visit would otherwise each write back the list as they last read it, and
     * whoever saved second would erase the other's entry. The visit number is worked out from the
     * list this phone has, so a genuine collision produces two visits sharing a number — which is
     * untidy but visible, and far better than one of them vanishing.
     */
    suspend fun addOrthoVisit(
        clinicId: String,
        patientId: String,
        visit: OrthoVisit,
    ): Result<Unit> = runCatching {
        orthoCases(clinicId).document(patientId).update(
            mapOf(
                "visits" to FieldValue.arrayUnion(
                    mapOf(
                        "visitNo" to visit.visitNo,
                        "date" to visit.date,
                        "workDone" to visit.workDone.trim(),
                        "nextStep" to visit.nextStep.trim(),
                    )
                ),
                "updatedAt" to FieldValue.serverTimestamp(),
            )
        ).queueLocally("ortho visit")
    }

    /** Move a case between Active, Retention and Completed. */
    suspend fun setOrthoStatus(clinicId: String, patientId: String, status: String): Result<Unit> = runCatching {
        val updates = mutableMapOf<String, Any>(
            "status" to status,
            "updatedAt" to FieldValue.serverTimestamp(),
        )
        // Stamped so the website's "finished this month" figures have a date to count.
        if (status == "Completed") updates["completedDate"] = todayKey()
        orthoCases(clinicId).document(patientId).update(updates).queueLocally("ortho status")
    }

    /**
     * The referral source of every patient registered between two dates, inclusive.
     *
     * Ranged on `createdAt`, which the website stamps at registration. Patients from before the
     * stamp existed simply do not match — correct here, since they are not "new in this period"
     * by any reading. The strings come back raw; grouping and the blank-means-walk-in rule live
     * in summariseSources, where they can be tested.
     */
    suspend fun loadNewPatientReferrals(clinicId: String, fromKey: String, toKey: String): List<String> {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val from = fmt.parse(fromKey) ?: return emptyList()
        val to = fmt.parse(toKey) ?: return emptyList()
        // End-exclusive upper bound one day on, so the last day's registrations count.
        val toExclusive = Date(to.time + 24L * 60 * 60 * 1000)

        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("patients")
            .whereGreaterThanOrEqualTo("createdAt", from)
            .whereLessThan("createdAt", toExclusive)
            .get()
            .await()

        return snap.documents.map { it.getString("referral").orEmpty() }
    }

    // ------------------------------------------------------------------- payments

    private fun ledger(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("ledger")

    /** A patient's whole ledger, as the payment screen needs it. */
    suspend fun loadLedger(clinicId: String, patientId: String): List<LedgerEntry> {
        val snap = ledger(clinicId).whereEqualTo("patientId", patientId).get().await()
        return snap.documents.map { doc ->
            LedgerEntry(
                id = doc.id,
                type = doc.getString("type").orEmpty(),
                description = doc.getString("description").orEmpty(),
                amount = (doc.get("amount") as? Number)?.toDouble(),
                cost = (doc.get("cost") as? Number)?.toDouble(),
                paid = (doc.get("paid") as? Number)?.toDouble(),
                procedureId = doc.getString("procedureId").orEmpty(),
                labFee = (doc.get("labFee") as? Number)?.toDouble() ?: 0.0,
                commissionPercentage = (doc.get("doctorCommissionPercentage") as? Number)?.toDouble(),
                doctorId = doc.getString("doctorId").orEmpty(),
                doctorName = doc.getString("doctorName").orEmpty()
                    .ifBlank { doc.getString("doctor").orEmpty() },
            )
        }
    }

    /**
     * The treating dentist's commission rate.
     *
     * Resolved by staff id where the procedure has one, and by name where it does not — older
     * ledger rows only carry a name. Returning zero on a miss is deliberate: recording no
     * commission is recoverable by editing the row, whereas inventing a rate silently pays a
     * dentist money the clinic never agreed to.
     */
    private suspend fun resolveCommission(clinicId: String, procedure: UnpaidProcedure): Triple<String, String, Double> {
        val staff = Firebase.db().collection("clinics").document(clinicId).collection("staff")

        if (procedure.doctorId.isNotBlank()) {
            val doc = staff.document(procedure.doctorId).get().await()
            if (doc.exists()) {
                return Triple(
                    doc.id,
                    doc.getString("name")?.trim().orEmpty().ifBlank { procedure.doctorName },
                    (doc.get("commissionPercentage") as? Number)?.toDouble() ?: 0.0,
                )
            }
        }

        if (procedure.doctorName.isNotBlank()) {
            val byName = staff.whereEqualTo("name", procedure.doctorName).limit(1).get().await()
            byName.documents.firstOrNull()?.let { doc ->
                return Triple(
                    doc.id,
                    doc.getString("name")?.trim().orEmpty().ifBlank { procedure.doctorName },
                    (doc.get("commissionPercentage") as? Number)?.toDouble() ?: 0.0,
                )
            }
        }

        return Triple(procedure.doctorId, procedure.doctorName, 0.0)
    }

    /**
     * Record a payment.
     *
     * Writes the same ledger shape QuickPaymentModal writes in the browser, including the doctor,
     * lab and clinic split — those fields feed the clinic's profit reporting, and a row missing
     * them is not merely untidy, it is money unaccounted for.
     *
     * `procedure` null means a general payment against the account, exactly as the website's
     * "Advance Payment" option does.
     */
    suspend fun recordPayment(
        clinicId: String,
        patient: Patient,
        procedure: UnpaidProcedure?,
        amount: Double,
        byName: String,
        byUid: String,
    ): Result<String> = runCatching {
        require(amount > 0) { "Enter an amount greater than zero." }
        procedure?.let {
            require(amount <= it.remaining + 0.001) { "That is more than the ${it.remaining.toInt()} still owed on this treatment." }
        }

        val today = todayKey()

        val data: Map<String, Any?> = if (procedure == null) {
            mapOf(
                "patientId" to patient.id,
                "patientName" to patient.name,
                "date" to today,
                "type" to "payment",
                "category" to "Advance Payment",
                "description" to "General Account Payment (Advance/Deposit)",
                "cost" to 0,
                "paid" to amount,
                "amount" to amount,
                "method" to "Cash",
                "addedBy" to byName,
                "createdAt" to FieldValue.serverTimestamp(),
            )
        } else {
            // The rate stored on the charge wins, because that is what the website pays out on:
            // its commission maths reads doctorCommissionPercentage off the procedure's own ledger
            // row. Reading the staff record instead meant a rate changed since the charge silently
            // rewrote what this payment owed the dentist — and meant a payment could not be taken
            // at all when the staff record was not in the offline cache. Only rows from before the
            // field existed fall back to the live lookup, and if that lookup cannot be reached the
            // payment records zero commission (recoverable by editing the row) rather than
            // refusing the money.
            val (doctorId, doctorName, commission) = if (procedure.commissionPercentage != null) {
                Triple(procedure.doctorId, procedure.doctorName, procedure.commissionPercentage)
            } else {
                runCatching { resolveCommission(clinicId, procedure) }
                    .getOrDefault(Triple(procedure.doctorId, procedure.doctorName, 0.0))
            }
            val split = splitPayment(
                amount = amount,
                paidBefore = procedure.paidSoFar,
                procedureLabFee = procedure.labFee,
                commissionPercentage = commission,
            )

            mapOf(
                "patientId" to patient.id,
                "patientName" to patient.name,
                "date" to today,
                "type" to "payment",
                "category" to "Treatment Payment",
                "description" to "Payment for: ${procedure.description}",
                "procedureId" to procedure.id,
                "doctorId" to doctorId.ifBlank { null },
                "doctorName" to doctorName.ifBlank { null },
                "doctorCommissionPercentage" to split.doctorCommissionPercentage,
                "labFee" to split.labFee,
                "doctorCommissionAmount" to split.doctorCommissionAmount,
                "clinicProfit" to split.clinicProfit,
                "cost" to 0,
                "paid" to amount,
                "amount" to amount,
                "method" to "Cash",
                "addedBy" to byName,
                "createdAt" to FieldValue.serverTimestamp(),
            )
        }

        val ref = ledger(clinicId).newDoc()
        ref.set(data).queueLocally("payment")

        // The same audit trail the website writes. Money moving with nothing in the log is the
        // one thing nobody can reconstruct afterwards — so this is queued alongside the payment
        // rather than skipped when there is no signal.
        runCatching {
            Firebase.db().collection("clinics").document(clinicId).collection("system_logs").newDoc().set(
                mapOf(
                    "action" to "Payment Received",
                    "details" to if (procedure == null) {
                        "General payment received from ${patient.name}: ${amount.toInt()} EGP"
                    } else {
                        "Treatment payment for ${patient.name}: ${amount.toInt()} EGP toward \"${procedure.description}\""
                    },
                    "userName" to byName,
                    "userId" to byUid,
                    "createdAt" to FieldValue.serverTimestamp(),
                )
            ).queueLocally("payment audit log")
        }

        ref.id
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
    /**
     * Whether a queued message is allowed to leave yet.
     *
     * `sendAfter` is how a clinic gets reminders at 2pm without the server having to wake up at
     * 2pm: the nightly sweep stamps the hour and this phone, which is polling anyway, holds the
     * message until then. Only reminders carry it — a cancellation is stamped with nothing and
     * goes on the next poll, because a patient told about it in the afternoon may already have
     * travelled in.
     *
     * A missing or unparseable stamp means "now". Refusing to send on a malformed timestamp would
     * strand the message with nothing to explain why, and the failure that matters here is a
     * patient never being told.
     */
    internal fun isSmsDue(sendAfter: String?, now: Long): Boolean {
        if (sendAfter.isNullOrBlank()) return true
        val due = runCatching { java.time.Instant.parse(sendAfter).toEpochMilli() }.getOrNull() ?: return true
        return due <= now
    }

    suspend fun claimQueuedSms(clinicId: String, deviceId: String, limit: Int): List<QueuedSms> {
        // Fetched wide, because most of what comes back may not be sendable yet. Between the sweep
        // and the clinic's chosen hour the outbox is full of held reminders, and Firestore returns
        // these in document-id order — so a narrow window could be entirely reminders while a
        // cancellation queued five minutes ago sits just outside it, unsent until the afternoon.
        // Ordering by sendAfter is not an option: Firestore drops documents missing the field,
        // which is exactly the immediate messages this is protecting.
        val pending = smsOutbox(clinicId)
            .whereIn("status", listOf("queued", "sending"))
            .limit(limit * 4L)
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

                    // The clinic picks an hour for reminders to go out; the server stamps it here
                    // and this phone is what enforces it. Checked inside the transaction so a
                    // message that comes due between the query and the claim is not skipped for
                    // another fifteen minutes.
                    if (!isSmsDue(snap.getString("sendAfter"), now)) return@runTransaction null

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

    // --- WhatsApp messages waiting for a person to press send -------------------------------

    /** One message on the clinic's to-send list. */
    data class PendingWhatsapp(
        val id: String,
        val to: String,
        val text: String,
        val patientName: String,
        val type: String,
        val createdAt: String,
    )

    private fun whatsappOutbox(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("whatsapp_outbox")

    /**
     * A reminder for a visit that has already happened is worse than none — the patient reads
     * "your appointment is tomorrow" about a day they have been and gone. Phones go flat and
     * people take holidays, so the list gives up on its own rather than growing forever.
     *
     * Matches the server's own expiry so the two never disagree about what is still worth sending.
     */
    private const val WHATSAPP_STALE_MS = 3L * 24 * 60 * 60 * 1000

    internal fun isWhatsappStale(createdAt: String?, now: Long): Boolean {
        if (createdAt.isNullOrBlank()) return false
        val created = runCatching { java.time.Instant.parse(createdAt).toEpochMilli() }.getOrNull() ?: return false
        return now - created > WHATSAPP_STALE_MS
    }

    /**
     * Watch the to-send list.
     *
     * A live listener rather than a fetch, because two people may be working through the same list
     * on different phones — as one sends, the row has to vanish from the other's screen. Without
     * that, the patient gets the same message twice from two staff members.
     */
    fun observePendingWhatsapp(clinicId: String): Flow<List<PendingWhatsapp>> = callbackFlow {
        val registration = whatsappOutbox(clinicId)
            .whereEqualTo("status", "queued")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                val now = System.currentTimeMillis()
                trySend(
                    snapshot.documents
                        .mapNotNull { doc ->
                            val createdAt = doc.getString("createdAt").orEmpty()
                            if (isWhatsappStale(createdAt, now)) return@mapNotNull null
                            val to = doc.getString("to").orEmpty()
                            val text = doc.getString("text").orEmpty()
                            // A message with no number or no body cannot be sent and would sit in
                            // the list forever looking like work nobody is doing.
                            if (to.isBlank() || text.isBlank()) return@mapNotNull null
                            PendingWhatsapp(
                                id = doc.id,
                                to = to,
                                text = text,
                                patientName = doc.getString("patientName").orEmpty(),
                                type = doc.getString("type").orEmpty(),
                                createdAt = createdAt,
                            )
                        }
                        // Oldest first: the order a person should work through them, and the order
                        // in which they stop being worth sending.
                        .sortedBy { it.createdAt }
                )
            }
        awaitClose { registration.remove() }
    }

    /**
     * Mark one message as sent.
     *
     * Called when the person comes back from WhatsApp, which is the only signal available — the
     * app cannot see whether they actually pressed send inside WhatsApp, so this records "handled"
     * rather than "delivered". Overstating it would be wrong, but leaving a sent message in the
     * list forever guarantees the patient is messaged twice, which is worse.
     */
    suspend fun markWhatsappSent(clinicId: String, messageId: String, deviceId: String): Result<Unit> = runCatching {
        whatsappOutbox(clinicId).document(messageId).update(
            mapOf(
                "status" to "sent",
                "sentAt" to java.time.Instant.now().toString(),
                "sentByDeviceId" to deviceId,
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
    suspend fun heartbeatSmsDevice(clinicId: String, deviceId: String, name: String, fcmToken: String?) {
        val row = mutableMapOf<String, Any>(
            "name" to name,
            "platform" to "android",
            "lastSeenAt" to java.time.Instant.now().toString(),
            "enabled" to true,
        )
        // The address the server wakes this phone on. Written with the heartbeat rather than once
        // at pairing, because FCM rotates tokens — a token stored once and never refreshed is a
        // phone that silently stops being reachable.
        if (!fcmToken.isNullOrBlank()) row["fcmToken"] = fcmToken

        Firebase.db().collection("clinics").document(clinicId)
            .collection("sms_devices").document(deviceId)
            .set(row, SetOptions.merge())
            .queueLocally("sms heartbeat")
    }

    /** Stop being the sender, so the clinic's list stops showing this phone as available. */
    fun releaseSmsDevice(clinicId: String, deviceId: String) {
        Firebase.db().collection("clinics").document(clinicId)
            .collection("sms_devices").document(deviceId)
            .set(mapOf("enabled" to false), SetOptions.merge())
            .queueLocally("sms sender release")
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
     * Change the clinic's working hours.
     *
     * Written as a merge into the `schedule` map on settings/clinic_info, the same document and the
     * same field names the website's Settings screen uses — including `configuredAt`, which is what
     * both sides read to tell "these are the clinic's real hours" from "nobody has set any yet".
     *
     * Day names are stored lowercase. The website normalises whatever case it stored on read, and
     * so does the phone, but writing them lowercase keeps the document itself unambiguous.
     */
    suspend fun saveSchedule(
        clinicId: String,
        startHHmm: String,
        endHHmm: String,
        slotDuration: Int,
        offDays: List<String>,
    ): Result<Unit> = runCatching {
        Firebase.db().collection("clinics").document(clinicId)
            .collection("settings").document("clinic_info")
            .set(
                mapOf(
                    "schedule" to mapOf(
                        "start" to startHHmm,
                        "end" to endHHmm,
                        "slotDuration" to slotDuration.toString(),
                        "offDays" to offDays.map { it.lowercase(java.util.Locale.US) },
                        "configuredAt" to java.time.Instant.now().toString(),
                    )
                ),
                SetOptions.merge(),
            )
            .queueLocally("clinic hours")
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
            .map {
                Doctor(
                    id = it.id,
                    name = it.getString("name").orEmpty(),
                    commissionPercentage = (it.get("commissionPercentage") as? Number)?.toDouble() ?: 0.0,
                )
            }
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
                estimatedLabFee = (doc.get("estimatedLabFee") as? Number)?.toDouble() ?: 0.0,
                category = doc.getString("category").orEmpty(),
                icon = doc.getString("icon").orEmpty(),
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
     *
     * This is the one action that genuinely cannot work offline, and the transaction is why: a
     * number that has to be unique across the whole clinic can only be issued by something that
     * can see every other request for one. Everything else in this file writes to the local
     * database and syncs later; registering a patient waits for signal, and says so rather than
     * failing with a shrug.
     */
    suspend fun createPatient(clinicId: String, name: String, phone: String): Result<Patient> = runCatching {
        val clinic = Firebase.db().collection("clinics").document(clinicId)
        val counterRef = clinic.collection("settings").document("counters")

        val nextId = runCatching {
            Firebase.db().runTransaction { tx ->
                val counter = tx.get(counterRef)
                val current = (counter.get("patientId") as? Number)?.toLong()
                val next = if (current != null) current + 1 else 1000L
                tx.set(counterRef, mapOf("patientId" to next), SetOptions.merge())
                next
            }.await()
        }.getOrElse {
            throw IllegalStateException(
                "A new patient needs a connection — their file number is issued by the clinic system. " +
                    "Everything else can be recorded offline."
            )
        }

        val data = mapOf(
            "fileId" to "PT-$nextId",
            "name" to name.trim(),
            "phone" to phone.trim(),
            "createdAt" to FieldValue.serverTimestamp(),
        )
        val ref = clinic.collection("patients").newDoc()
        ref.set(data).queueLocally("new patient")

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

        val ref = appointments(clinicId).newDoc()
        ref.set(data).queueLocally("booking")
        ref.id
    }

    /**
     * Move an appointment to a new day, time or doctor.
     *
     * Only the fields that actually change are sent, for the same reason status changes are —
     * a whole-document write would silently discard a colleague's concurrent edit to a field this
     * screen never showed.
     */
    suspend fun updateAppointment(
        clinicId: String,
        appointment: Appointment,
        dateKey: String,
        time: String,
        doctor: Doctor?,
        durationMinutes: Int,
        treatment: String,
        notes: String,
        service: Service?,
        cost: Double,
        byName: String,
    ): Result<Unit> = runCatching {
        val updates = mutableMapOf<String, Any>(
            "date" to normalizeDateKey(dateKey),
            "time" to normalizeTimeKey(time),
            "duration" to durationMinutes,
            "treatment" to treatment.trim(),
            "notes" to notes.trim(),
            "cost" to cost,
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
        // Cleared explicitly rather than left behind when the service is removed: a stale
        // serviceName on an appointment whose treatment has changed is worse than none, because
        // the website's reports group by it.
        updates["serviceId"] = service?.id ?: ""
        updates["serviceName"] = service?.name ?: ""
        if (service != null) updates["listPrice"] = service.price

        appointments(clinicId).document(appointment.id).update(updates).queueLocally("appointment edit")
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

        // The same snapshot again, this time as displayable lines for the Finance
        // tab — one read serves both the balance and the statement.
        val ledgerEntries = ledgerSnap.documents.mapNotNull { doc ->
            val type = doc.getString("type").orEmpty()
            if (type == "expense") return@mapNotNull null
            val amount = if (type == "payment") {
                (doc.get("paid") as? Number)?.toDouble() ?: (doc.get("amount") as? Number)?.toDouble() ?: 0.0
            } else {
                (doc.get("amount") as? Number)?.toDouble() ?: (doc.get("cost") as? Number)?.toDouble() ?: 0.0
            }
            if (amount <= 0) return@mapNotNull null
            PatientLedgerEntry(
                id = doc.id,
                date = doc.getString("date").orEmpty(),
                type = type,
                description = doc.getString("description").orEmpty(),
                amount = amount,
                addedBy = doc.getString("addedBy").orEmpty(),
                createdAtMillis = doc.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
            )
        }.sortedWith(compareByDescending<PatientLedgerEntry> { it.date }.thenByDescending { it.createdAtMillis })

        // The diagnosis chart the website edits, flattened to showable lines.
        @Suppress("UNCHECKED_CAST")
        val diagnosis = (patientSnap.get("teethData") as? Map<String, Any?>).orEmpty()
            .mapNotNull { (tooth, raw) ->
                val entry = raw as? Map<String, Any?> ?: return@mapNotNull null
                val statuses = (entry["statuses"] as? List<*>)?.filterIsInstance<String>().orEmpty()
                val notes = entry["notes"] as? String ?: ""
                if (statuses.isEmpty() && notes.isBlank()) return@mapNotNull null
                ToothDiagnosis(tooth = tooth, statuses = statuses, notes = notes)
            }
            .sortedBy { it.tooth.toIntOrNull() ?: Int.MAX_VALUE }

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
            ledger = ledgerEntries,
            diagnosis = diagnosis,
        )
    }

    /** The photos and x-rays the website uploaded for one patient, newest first. */
    suspend fun loadPatientMedia(clinicId: String, patientId: String): List<PatientMedia> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("patient_media")
            .whereEqualTo("patientId", patientId)
            .get()
            .await()
        return snap.documents.mapNotNull { doc ->
            val url = doc.getString("url").orEmpty()
            if (url.isBlank()) return@mapNotNull null
            PatientMedia(
                id = doc.id,
                url = url,
                category = doc.getString("category").orEmpty(),
                filename = doc.getString("filename").orEmpty(),
                uploadedBy = doc.getString("uploadedBy").orEmpty(),
                createdAtMillis = doc.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
            )
        }.sortedByDescending { it.createdAtMillis }
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
