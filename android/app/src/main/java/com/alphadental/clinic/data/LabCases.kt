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

    // ---------------------------------------------------------------------- work type fields

    /**
     * Which fields a kind of work actually has. An order form that asks a surgical guide for a
     * tooth shade is a form people stop reading, so the phone asks per type, as the website does.
     */
    data class WorkType(
        val id: String,
        val en: String,
        val ar: String,
        val bodyShade: Boolean,
        val cervicalShade: Boolean,
        val gumShade: Boolean,
        val implant: Boolean,
        val guide: Boolean,
        val units: Boolean,
        val digitalByDefault: Boolean,
        val tryInByDefault: Boolean,
    ) {
        fun label(arabic: Boolean): String = if (arabic) ar else en
    }

    /** Mirrors LAB_WORK_TYPES in src/lib/labCases.ts, flags included. */
    val WORK_TYPE_LIST = listOf(
        WorkType("zirconia", "Zirconia", "زيركون", true, true, false, false, false, true, false, false),
        WorkType("emax", "E.max", "إي ماكس", true, true, false, false, false, true, false, false),
        WorkType("pfm", "PFM", "بورسلين على معدن", true, true, false, false, false, true, false, false),
        WorkType("pmma", "PMMA temporary", "مؤقت PMMA", true, false, false, false, false, true, false, false),
        WorkType("implant_crown", "Implant crown", "تاج زرعة", true, true, false, true, false, true, false, false),
        WorkType("surgical_guide", "Surgical guide", "دليل جراحي", false, false, false, true, true, false, true, false),
        WorkType("cobalt_chrome", "Cobalt-chrome frame", "هيكل كروم كوبالت", false, false, false, false, false, false, false, true),
        WorkType("full_denture", "Full denture", "طقم كامل", true, false, true, false, false, false, false, true),
        WorkType("partial_denture", "Partial denture", "طقم جزئي", true, false, true, false, false, false, false, true),
        WorkType("acrylic_repair", "Acrylic repair / reline", "إصلاح أو تبطين", true, false, true, false, false, false, false, false),
        WorkType("night_guard", "Night guard", "واقي ليلي", false, false, false, false, false, false, false, false),
        WorkType("aligner", "Clear aligner", "تقويم شفاف", false, false, false, false, false, false, true, false),
    )

    /** Never null: an unknown id reads as zirconia's shape, as on the website. */
    fun workTypeFor(id: String): WorkType = WORK_TYPE_LIST.firstOrNull { it.id == id } ?: WORK_TYPE_LIST[0]

    val BLEACH_SHADES = listOf("BL1", "BL2", "BL3", "BL4")
    val CLASSICAL_SHADES = listOf(
        "A1", "A2", "A3", "A3.5", "A4",
        "B1", "B2", "B3", "B4",
        "C1", "C2", "C3", "C4",
        "D2", "D3", "D4",
    )

    /** Body and cervical come from the SAME VITA guide; there is no second scale. */
    val TOOTH_SHADES = BLEACH_SHADES + CLASSICAL_SHADES

    /** Suggestions, not a closed list: no single gum guide every lab works to. */
    val GUM_SHADES = listOf("Pink", "Light pink", "Dark pink", "Veined", "Original")

    /** These store the ID, never the translated label - a case raised in Arabic must read in English. */
    data class Option(val id: String, val en: String, val ar: String) {
        fun label(arabic: Boolean): String = if (arabic) ar else en
    }

    val RETENTION_OPTIONS = listOf(
        Option("screw", "Screw-retained", "بمسمار"),
        Option("cement", "Cement-retained", "بلاصق"),
    )
    val ABUTMENT_OPTIONS = listOf(
        Option("stock", "Stock abutment", "دعامة جاهزة"),
        Option("custom", "Custom abutment", "دعامة مخصصة"),
        Option("tibase", "Ti-base", "قاعدة تيتانيوم"),
    )
    val GUIDE_TYPE_OPTIONS = listOf(
        Option("pilot", "Pilot guide", "دليل مبدئي"),
        Option("full", "Fully guided", "دليل كامل"),
    )

    /** An unrecognised value reads as itself: older cases stored the label, and it beats a blank. */
    fun optionLabel(options: List<Option>, value: String, arabic: Boolean): String {
        if (value.isBlank()) return ""
        return options.firstOrNull { it.id == value }?.label(arabic) ?: value
    }

    // ---------------------------------------------------------------------- the directory

    /** One lab the clinic sends work to, from settings/labs. */
    data class Lab(
        val id: String,
        val name: String,
        val phone: String = "",
        val whatsapp: String = "",
        val driverName: String = "",
        /** What makes the amber and red warnings mean anything: picking the lab fills the due date. */
        val turnaroundDays: Int = 0,
        /** What this lab charges per kind of work. Sparse: an absent entry means no agreed price. */
        val prices: Map<String, Double> = emptyMap(),
        val notes: String = "",
        val address: String = "",
    ) {
        /** A lab that gave one number and never a separate WhatsApp is the common case. */
        val messagingNumber: String get() = whatsapp.ifBlank { phone }.trim()
    }

    /** One branch, for the code its cases are stamped with. */
    data class Branch(val id: String, val name: String, val code: String)

    /** The three letters a branch stamps: its own if set, else derived from the name. */
    fun branchCodeFor(branch: Branch?, index: Int = 0): String {
        val explicit = branch?.code.orEmpty().filter { it.isLetterOrDigit() }.uppercase()
        if (explicit.isNotBlank()) return explicit.take(4)
        val letters = branch?.name.orEmpty().filter { it.isLetter() }
        return if (letters.length >= 2) letters.take(3).uppercase() else "B${index + 1}"
    }

    const val DEFAULT_BRANCH_CODE = "LAB"

    fun formatCode(branchCode: String, n: Int, remakeRound: Int = 0): String {
        val base = branchCode.ifBlank { DEFAULT_BRANCH_CODE } + "-" + n.coerceAtLeast(0).toString().padStart(4, '0')
        return if (remakeRound > 1) "$base-R$remakeRound" else base
    }

    suspend fun loadLabs(clinicId: String): List<Lab> {
        val snap = clinic(clinicId).collection("settings").document("labs").get().await()
        val raw = snap.get("labs") as? List<*> ?: return emptyList()
        return raw.mapNotNull { entry ->
            val m = entry as? Map<*, *> ?: return@mapNotNull null
            val id = m["id"]?.toString().orEmpty()
            val name = m["name"]?.toString().orEmpty()
            if (id.isBlank() || name.isBlank()) return@mapNotNull null
            val prices = ((m["prices"] as? Map<*, *>) ?: emptyMap<Any, Any>()).mapNotNull { (k, v) ->
                val key = k?.toString() ?: return@mapNotNull null
                val price = (v as? Number)?.toDouble() ?: v?.toString()?.toDoubleOrNull() ?: return@mapNotNull null
                key to price
            }.toMap()
            Lab(
                id = id,
                name = name,
                phone = m["phone"]?.toString().orEmpty(),
                whatsapp = m["whatsapp"]?.toString().orEmpty(),
                driverName = m["driverName"]?.toString().orEmpty(),
                turnaroundDays = (m["turnaroundDays"] as? Number)?.toInt() ?: 0,
                prices = prices,
                notes = m["notes"]?.toString().orEmpty(),
                address = m["address"]?.toString().orEmpty(),
            )
        }
    }

    suspend fun loadBranches(clinicId: String): List<Branch> {
        val snap = clinic(clinicId).collection("settings").document("locations").get().await()
        val raw = snap.get("branches") as? List<*> ?: return emptyList()
        return raw.mapNotNull { entry ->
            val m = entry as? Map<*, *> ?: return@mapNotNull null
            val id = m["id"]?.toString().orEmpty()
            val name = m["name"]?.toString().orEmpty()
            if (id.isBlank()) return@mapNotNull null
            Branch(id, name, m["code"]?.toString().orEmpty())
        }
    }

    /** yyyy-MM-dd, `days` from today - what a lab's turnaround fills the due date in with. */
    fun dueInDays(days: Int): String = LocalDate.now().plusDays(days.toLong().coerceAtLeast(0)).toString()

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

    private fun clinic(clinicId: String) = Firebase.db().collection("clinics").document(clinicId)

    private fun cases(clinicId: String) = clinic(clinicId).collection("lab_cases")

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
     * Everything a new or edited order carries. Mirrors NewLabCaseInput on the website.
     *
     * `code`, `codeNumber` and the event log are not here: those are minted and stamped by
     * `createCase` below, exactly as `createLabCase` does, so a case raised on the phone is
     * indistinguishable from one raised at the desk.
     */
    data class Draft(
        val branchId: String = "",
        val branchName: String = "",
        val branchCode: String = "",
        val patientId: String = "",
        val patientName: String = "",
        val patientPhone: String = "",
        val doctorId: String = "",
        val doctorName: String = "",
        val labId: String = "",
        val labName: String = "",
        val workType: String = "zirconia",
        val workDescription: String = "",
        val units: Int = 0,
        val teeth: List<Int> = emptyList(),
        val bodyShade: String = "",
        val cervicalShade: String = "",
        val gumShade: String = "",
        val material: String = "",
        val implantSystem: String = "",
        val implantPlatform: String = "",
        val abutmentType: String = "",
        val retention: String = "",
        val guideType: String = "",
        val sleeveSystem: String = "",
        val notes: String = "",
        val agreedPrice: Double = 0.0,
        /** "driver" for a bag a driver collects, "digital" for files. Decides the signature strip. */
        val sentVia: String = "driver",
        val status: String = "at_lab",
        val needsTryIn: Boolean = false,
        val sentAt: String = "",
        val dueDate: String = "",
    )

    /** What a saved case tells the edit form. */
    fun draftOf(case: LabCase): Draft = Draft(
        branchName = case.branchName,
        patientId = case.patientId,
        patientName = case.patientName,
        patientPhone = case.patientPhone,
        doctorName = case.doctorName,
        labId = case.labId,
        labName = case.labName,
        workType = case.workType,
        workDescription = case.workDescription,
        units = case.units,
        teeth = case.teeth,
        bodyShade = case.bodyShade,
        cervicalShade = case.cervicalShade,
        gumShade = case.gumShade,
        material = case.material,
        implantSystem = case.implantSystem,
        notes = case.notes,
        agreedPrice = case.agreedPrice,
        sentVia = case.sentVia,
        status = case.status,
        needsTryIn = case.needsTryIn,
        sentAt = case.sentAt,
        dueDate = case.dueDate,
    )

    /**
     * Take the next number for a branch code, atomically.
     *
     * Keyed by the printed CODE rather than the branch id, and that choice is load-bearing: two
     * branches given the same three letters would otherwise each be handed MAD-0142 and put two
     * patients' work under one number on two bags. Sharing a counter means sharing a sequence
     * instead - ugly in a report, harmless on a bag.
     */
    private suspend fun mintNumber(clinicId: String, branchCode: String): Int {
        val key = branchCode.filter { it.isLetterOrDigit() }.uppercase().ifBlank { DEFAULT_BRANCH_CODE }
        val ref = clinic(clinicId).collection("lab_counters").document("branches")
        return Firebase.db().runTransaction { txn ->
            val snap = txn.get(ref)
            val current = (snap.get(key) as? Number)?.toInt() ?: 0
            val next = if (current >= FIRST_CASE_NUMBER) current + 1 else FIRST_CASE_NUMBER
            if (snap.exists()) txn.update(ref, key, next) else txn.set(ref, mapOf(key to next))
            next
        }.await()
    }

    private const val FIRST_CASE_NUMBER = 1

    /** Empty strings and nulls are dropped, as compact() does on the website. */
    private fun compact(vararg pairs: Pair<String, Any?>): Map<String, Any> = buildMap {
        for ((k, v) in pairs) {
            when (v) {
                null -> Unit
                is String -> if (v.isNotBlank()) put(k, v.trim())
                is Number -> if (v.toDouble().isFinite() && v.toDouble() != 0.0) put(k, v)
                else -> put(k, v)
            }
        }
    }

    data class Created(val id: String, val code: String, val codeNumber: Int)

    /**
     * Raise an order and give it its code.
     *
     * The number is minted BEFORE the document is written, so a failed write leaves a gap in the
     * sequence rather than a case with no code: a missing number in a printed series is a
     * curiosity, an unlabelled bag is the exact problem this feature exists to prevent.
     */
    suspend fun createCase(clinicId: String, draft: Draft, by: String, remakeOf: LabCase? = null, remakeReason: String = "", remakeFault: String = ""): Result<Created> = runCatching {
        val branchCode = draft.branchCode.uppercase().ifBlank { DEFAULT_BRANCH_CODE }
        val round = if (remakeOf != null) maxOf(2, remakeOf.remakeRound + 1) else 0
        val codeNumber = mintNumber(clinicId, branchCode)
        val code = formatCode(branchCode, codeNumber, round)
        val stamp = Instant.now().toString()

        val body = compact(
            "code" to code,
            "codeNumber" to codeNumber,
            "branchCode" to branchCode,
            "branchId" to draft.branchId,
            "branchName" to draft.branchName,
            "patientId" to draft.patientId,
            "patientName" to draft.patientName,
            // The first name is what goes on the paper that leaves the building.
            "patientFirstName" to draft.patientName.trim().split(Regex("\\s+")).firstOrNull().orEmpty(),
            "patientPhone" to draft.patientPhone,
            "doctorId" to draft.doctorId,
            "doctorName" to draft.doctorName,
            "labId" to draft.labId,
            "labName" to draft.labName,
            "workType" to draft.workType,
            "workDescription" to draft.workDescription,
            "units" to draft.units,
            "bodyShade" to draft.bodyShade,
            "cervicalShade" to draft.cervicalShade,
            "gumShade" to draft.gumShade,
            "material" to draft.material,
            "implantSystem" to draft.implantSystem,
            "implantPlatform" to draft.implantPlatform,
            "abutmentType" to draft.abutmentType,
            "retention" to draft.retention,
            "guideType" to draft.guideType,
            "sleeveSystem" to draft.sleeveSystem,
            "notes" to draft.notes,
            "sentAt" to draft.sentAt,
            "dueDate" to draft.dueDate,
            "createdBy" to by,
            "remakeOfId" to remakeOf?.id,
            "remakeOfCode" to remakeOf?.code,
            "remakeReason" to remakeReason,
            "remakeFault" to remakeFault,
            "remakeRound" to (if (round > 1) round else null),
        ) + mapOf(
            // Written unconditionally: agreedPrice 0 is a real answer (a remake the lab is
            // redoing at its own cost) that compact() would have dropped.
            "teeth" to draft.teeth,
            "agreedPrice" to draft.agreedPrice,
            "sentVia" to if (draft.sentVia == "digital") "digital" else "driver",
            "status" to draft.status,
            "needsTryIn" to draft.needsTryIn,
            "events" to listOf(compact("status" to draft.status, "at" to stamp, "by" to by)),
            "createdAt" to stamp,
            "updatedAt" to stamp,
            "createdAtServer" to FieldValue.serverTimestamp(),
        )

        val ref = cases(clinicId).document()
        ref.set(body).await()
        Created(ref.id, code, codeNumber)
    }

    /**
     * Edit a saved order. Status moves go through `advance` instead, which owns the event log.
     *
     * A field the person cleared is written as "" rather than omitted: compact() dropping it is
     * right for a create and wrong for an edit, where the old value would otherwise survive.
     */
    suspend fun updateCase(clinicId: String, id: String, draft: Draft): Result<Unit> = runCatching {
        val body = mutableMapOf<String, Any>(
            "labId" to draft.labId,
            "labName" to draft.labName,
            "workType" to draft.workType,
            "workDescription" to draft.workDescription,
            "teeth" to draft.teeth,
            "bodyShade" to draft.bodyShade,
            "cervicalShade" to draft.cervicalShade,
            "gumShade" to draft.gumShade,
            "material" to draft.material,
            "implantSystem" to draft.implantSystem,
            "implantPlatform" to draft.implantPlatform,
            "abutmentType" to draft.abutmentType,
            "retention" to draft.retention,
            "guideType" to draft.guideType,
            "sleeveSystem" to draft.sleeveSystem,
            "notes" to draft.notes,
            "dueDate" to draft.dueDate,
            "agreedPrice" to draft.agreedPrice,
            "sentVia" to if (draft.sentVia == "digital") "digital" else "driver",
            "needsTryIn" to draft.needsTryIn,
            "units" to draft.units,
            "updatedAt" to Instant.now().toString(),
        )
        if (draft.patientId.isNotBlank()) {
            body["patientId"] = draft.patientId
            body["patientName"] = draft.patientName
            body["patientPhone"] = draft.patientPhone
            body["patientFirstName"] = draft.patientName.trim().split(Regex("\\s+")).firstOrNull().orEmpty()
        }
        if (draft.doctorName.isNotBlank()) body["doctorName"] = draft.doctorName
        cases(clinicId).document(id).update(body).await()
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
