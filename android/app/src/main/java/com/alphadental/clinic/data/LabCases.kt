package com.alphadental.clinic.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Lab cases on the phone: where every crown, denture and guide is, right now.
 *
 * The website's Lab Tracking page raises the orders, prints them and settles the lab's bill. The
 * phone does the part that happens away from a desk — a driver arrives with a bag, a case is
 * fitted chairside — so it reads the same `lab_cases` documents live and moves them through the
 * same stages, writing exactly what `src/lib/labCaseWrite.ts` writes. Field names, status ids
 * and the event log's shape are the website's; a record moved on the phone has to read the same
 * on the board.
 *
 * The model half (statuses, next stages, due states, the code search) mirrors
 * `src/lib/labCases.ts`. If a rule changes there it changes here.
 */
object LabCases {

    private const val TAG = "AlphaLab"

    // ---------------------------------------------------------------------- statuses

    /** One stage, as the website defines it. `atLab` is what makes a due date meaningful. */
    data class Status(val id: String, val en: String, val ar: String, val atLab: Boolean, val closed: Boolean)

    val STATUSES = listOf(
        Status("draft", "Draft", "مسودة", atLab = false, closed = false),
        Status("at_lab", "At lab", "في المعمل", atLab = true, closed = false),
        Status("tryin_back", "Try-in back", "بروفة وصلت", atLab = false, closed = false),
        Status("returned_to_lab", "Back to lab", "رجعت للمعمل", atLab = true, closed = false),
        Status("back", "Back at clinic", "وصلت العيادة", atLab = false, closed = false),
        Status("fitted", "Fitted", "تم التركيب", atLab = false, closed = true),
        Status("cancelled", "Cancelled", "ملغاة", atLab = false, closed = true),
    )

    /** Never null: an unknown id (an older record) reads as a draft, as it does on the website. */
    fun statusFor(id: String): Status = STATUSES.firstOrNull { it.id == id } ?: STATUSES[0]

    fun statusLabel(id: String, arabic: Boolean): String = statusFor(id).let { if (arabic) it.ar else it.en }

    /**
     * Which stages a case may move to next. Try-in stages are offered only when the case is
     * marked as needing them; looping back to the lab from a try-in is always allowed.
     */
    fun nextStatuses(current: String, needsTryIn: Boolean): List<String> = when (current) {
        "draft" -> listOf("at_lab", "cancelled")
        "at_lab" -> if (needsTryIn) listOf("tryin_back", "back", "cancelled") else listOf("back", "cancelled")
        "tryin_back" -> listOf("returned_to_lab", "back", "cancelled")
        "returned_to_lab" -> if (needsTryIn) listOf("tryin_back", "back", "cancelled") else listOf("back", "cancelled")
        "back" -> listOf("fitted", "returned_to_lab")
        "fitted" -> listOf("returned_to_lab")
        "cancelled" -> listOf("draft")
        else -> emptyList()
    }

    // ---------------------------------------------------------------------- work types

    private val WORK_TYPES = mapOf(
        "zirconia" to ("Zirconia" to "زيركون"),
        "emax" to ("E.max" to "إي ماكس"),
        "pfm" to ("PFM" to "بورسلين على معدن"),
        "pmma" to ("PMMA temporary" to "مؤقت PMMA"),
        "implant_crown" to ("Implant crown" to "تاج زرعة"),
        "surgical_guide" to ("Surgical guide" to "دليل جراحي"),
        "cobalt_chrome" to ("Cobalt-chrome frame" to "هيكل كروم كوبالت"),
        "full_denture" to ("Full denture" to "طقم كامل"),
        "partial_denture" to ("Partial denture" to "طقم جزئي"),
        "acrylic_repair" to ("Acrylic repair / reline" to "إصلاح أو تبطين"),
        "night_guard" to ("Night guard" to "واقي ليلي"),
        "aligner" to ("Clear aligner" to "تقويم شفاف"),
    )

    fun workTypeLabel(id: String, arabic: Boolean): String {
        val row = WORK_TYPES[id] ?: return id.replace('_', ' ').ifBlank { "—" }
        return if (arabic) row.second else row.first
    }

    // ---------------------------------------------------------------------- the record

    data class Event(val status: String, val at: String, val by: String = "", val note: String = "")

    data class LabCase(
        val id: String,
        /** `MAD-0142` — printed large and written on the bag. */
        val code: String,
        val codeNumber: Long,
        val branchName: String,
        val patientId: String,
        val patientName: String,
        val patientPhone: String,
        val doctorName: String,
        val labId: String,
        val labName: String,
        val workType: String,
        val workDescription: String,
        val units: Int,
        val teeth: List<Int>,
        val bodyShade: String,
        val cervicalShade: String,
        val gumShade: String,
        val material: String,
        val implantSystem: String,
        val notes: String,
        val agreedPrice: Double,
        /** "driver" or "digital". */
        val sentVia: String,
        val status: String,
        val needsTryIn: Boolean,
        /** Calendar dates, "yyyy-MM-dd". */
        val sentAt: String,
        val dueDate: String,
        val receivedAt: String,
        val fittedAt: String,
        val events: List<Event>,
        val remakeOfCode: String,
        val remakeRound: Int,
    ) {
        val meta: Status get() = statusFor(status)
    }

    // ---------------------------------------------------------------------- urgency

    enum class Due { OVERDUE, DUE_TODAY, DUE_SOON, ON_TIME, NONE }

    /** Days between two yyyy-MM-dd strings, positive when `due` is ahead. Null when either is malformed. */
    fun daysUntil(due: String, today: String): Long? = runCatching {
        ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(due))
    }.getOrNull()

    /**
     * Only a case actually AT the lab can be late. One sitting on the reception desk waiting for
     * the patient is a different problem with a different colour.
     */
    fun dueStateFor(case: LabCase, today: String): Due {
        if (!case.meta.atLab || case.dueDate.isBlank()) return Due.NONE
        val d = daysUntil(case.dueDate, today) ?: return Due.NONE
        return when {
            d < 0 -> Due.OVERDUE
            d == 0L -> Due.DUE_TODAY
            d <= 2 -> Due.DUE_SOON
            else -> Due.ON_TIME
        }
    }

    data class Summary(val overdue: Int, val dueThisWeek: Int, val waitingForPatient: Int, val atLab: Int)

    /** The three numbers at the top of the board. "Back and waiting" is the one nobody else counts. */
    fun summarise(cases: List<LabCase>, today: String): Summary {
        var overdue = 0; var dueThisWeek = 0; var waiting = 0; var atLab = 0
        for (c in cases) {
            if (c.status == "back") waiting++
            if (c.meta.atLab) atLab++
            when (val state = dueStateFor(c, today)) {
                Due.OVERDUE -> overdue++
                Due.DUE_TODAY, Due.DUE_SOON -> dueThisWeek++
                Due.ON_TIME -> {
                    val d = daysUntil(c.dueDate, today)
                    if (d != null && d <= 7) dueThisWeek++
                }
                Due.NONE -> Unit
            }
        }
        return Summary(overdue, dueThisWeek, waiting, atLab)
    }

    /**
     * "MAD 142", "mad-142", "MAD142" and a bare "142" all find MAD-0142 — the code is read off a
     * bag, and a number typed without its padding is still the same number.
     */
    fun matchesCode(caseCode: String, query: String): Boolean {
        val q = query.trim().uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (q.isBlank()) return false
        val code = caseCode.uppercase().replace(Regex("[^A-Z0-9]"), "")
        if (code.isBlank()) return false
        if (code.contains(q)) return true
        val qDigits = q.filter { it.isDigit() }
        val codeDigits = code.filter { it.isDigit() }
        if (qDigits.isBlank() || codeDigits.isBlank()) return false
        return qDigits.toLongOrNull() != null && qDigits.toLong() == codeDigits.toLong()
    }

    // ---------------------------------------------------------------------- firestore

    private fun cases(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("lab_cases")

    private fun DocumentSnapshot.str(field: String): String = get(field)?.let { if (it is String) it else it.toString() }.orEmpty()
    private fun DocumentSnapshot.num(field: String): Double = (get(field) as? Number)?.toDouble() ?: 0.0

    private fun DocumentSnapshot.toCase(): LabCase {
        val teeth = (get("teeth") as? List<*>)?.mapNotNull { (it as? Number)?.toInt() ?: it?.toString()?.toIntOrNull() }.orEmpty()
        val events = (get("events") as? List<*>)?.mapNotNull { raw ->
            val m = raw as? Map<*, *> ?: return@mapNotNull null
            Event(
                status = m["status"]?.toString().orEmpty(),
                at = m["at"]?.toString().orEmpty(),
                by = m["by"]?.toString().orEmpty(),
                note = m["note"]?.toString().orEmpty(),
            )
        }.orEmpty()
        return LabCase(
            id = id,
            code = str("code"),
            codeNumber = num("codeNumber").toLong(),
            branchName = str("branchName"),
            patientId = str("patientId"),
            patientName = str("patientName"),
            patientPhone = str("patientPhone"),
            doctorName = str("doctorName"),
            labId = str("labId"),
            labName = str("labName"),
            workType = str("workType").ifBlank { "zirconia" },
            workDescription = str("workDescription"),
            units = num("units").toInt(),
            teeth = teeth,
            // `toothShade` is what the first version wrote, before body and cervical were split.
            bodyShade = str("bodyShade").ifBlank { str("toothShade") },
            cervicalShade = str("cervicalShade"),
            gumShade = str("gumShade"),
            material = str("material"),
            implantSystem = str("implantSystem"),
            notes = str("notes"),
            agreedPrice = num("agreedPrice"),
            sentVia = if (str("sentVia") == "digital") "digital" else "driver",
            status = str("status").ifBlank { "draft" },
            needsTryIn = getBoolean("needsTryIn") == true,
            sentAt = str("sentAt"),
            dueDate = str("dueDate"),
            receivedAt = str("receivedAt"),
            fittedAt = str("fittedAt"),
            events = events,
            remakeOfCode = str("remakeOfCode"),
            remakeRound = num("remakeRound").toInt(),
        )
    }

    /**
     * Every case, live, newest number first — the order the board uses.
     *
     * Live because two people hold the board at once: reception marks a bag received at the desk
     * while the dentist reads the same list in the surgery. Errors come through the flow as a
     * failed result so the screen can say so, rather than sitting on an empty list.
     */
    fun observeCases(clinicId: String): Flow<Result<List<LabCase>>> = callbackFlow {
        val registration = cases(clinicId)
            .orderBy("codeNumber", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "lab cases failed: ${error.message}")
                    trySend(Result.failure(error))
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                trySend(Result.success(snapshot.documents.map { it.toCase() }))
            }
        awaitClose { registration.remove() }
    }

    /**
     * Move a case to its next stage, stamping the dates that stage implies.
     *
     * The event log is appended and the whole array rewritten (not arrayUnion), as the website
     * does: two identical stage moves seconds apart are a real thing a nervous assistant does, and
     * arrayUnion would silently swallow the second. Each stage owns one date and only the first
     * arrival sets it — re-entering "back" after a remake must not rewrite the day the original
     * first came in.
     */
    suspend fun advance(clinicId: String, case: LabCase, next: String, by: String, today: String): Result<Unit> = runCatching {
        val stamp = Instant.now().toString()
        val events = case.events.map { e ->
            buildMap<String, Any> {
                put("status", e.status); put("at", e.at)
                if (e.by.isNotBlank()) put("by", e.by)
                if (e.note.isNotBlank()) put("note", e.note)
            }
        } + buildMap<String, Any> {
            put("status", next); put("at", stamp)
            if (by.isNotBlank()) put("by", by)
        }
        val body = mutableMapOf<String, Any>(
            "status" to next,
            "events" to events,
            "updatedAt" to stamp,
        )
        if (statusFor(next).atLab && case.sentAt.isBlank()) body["sentAt"] = today
        if (next == "back" && case.receivedAt.isBlank()) body["receivedAt"] = today
        if (next == "fitted" && case.fittedAt.isBlank()) body["fittedAt"] = today
        cases(clinicId).document(case.id).update(body as Map<String, Any>).await()
    }

    /**
     * Ring the website's bell when a case comes back, if the clinic asked for it.
     *
     * Mirrors `src/lib/labNotify.ts`: the "Lab Cases Received" toggle in Settings → Alerts is
     * read off the clinic document, and absent means off. Best-effort — the case has arrived
     * either way, and a failed reminder must never undo the status change that earned it.
     */
    suspend fun notifyBack(clinicId: String, case: LabCase, arabic: Boolean) {
        runCatching {
            val clinic = Firebase.db().collection("clinics").document(clinicId).get().await()
            val prefs = clinic.get("alertPreferences") as? Map<*, *>
            val inApp = prefs?.get("inApp") as? Map<*, *>
            if (inApp?.get("labReady") != true) return
            val who = case.patientName.trim().split(Regex("\\s+")).firstOrNull().orEmpty()
            val named = if (who.isBlank()) case.code else "${case.code} — $who"
            Firebase.db().collection("clinics").document(clinicId).collection("notifications").add(
                mapOf(
                    "title" to if (arabic) "حالة معمل وصلت" else "A lab case is back",
                    "body" to if (arabic) "$named وصلت من ${case.labName}. كلّم المريض واحجزله التركيب."
                    else "$named is back from ${case.labName}. Call the patient and book the fitting.",
                    "eventType" to "lab_ready",
                    "actionUrl" to "/lab",
                    "read" to false,
                    "createdAt" to FieldValue.serverTimestamp(),
                )
            ).await()
        }.onFailure { Log.w(TAG, "lab arrival notification failed: ${it.message}") }
    }
}
