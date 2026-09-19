package com.alphadental.clinic.next.data

import com.google.firebase.firestore.DocumentSnapshot

/**
 * What the app reads out of Firestore, and nothing more.
 *
 * These models are written fresh, but the FIELD NAMES are not ours to choose:
 * the website writes these documents and this app reads them, so every name here
 * is a contract with `src/` and changing one means changing both. Where a field
 * is read defensively the comment says which website behaviour forced it.
 *
 * Collections, all under `clinics/{clinicId}`:
 *   appointments        one document per booking
 *   ledger              one document per money line
 *   settings/clinic_info the clinic's own profile
 * and `users/{uid}` carries which clinics an account belongs to.
 */

/** One booking. */
data class Visit(
    val id: String,
    val patientId: String,
    val patientName: String,
    /** "yyyy-MM-dd". Zero-padded, so a string range really is a date range. */
    val date: String,
    /** As the website stores it for display: "09:30 AM". */
    val time: String,
    val doctor: String,
    val treatment: String,
    val status: Stage,
    /** Minutes booked. Drives the chair's progress meter. */
    val duration: Int,
    /** The dentist by staff id, when the booking carries one. `doctor` is the display name. */
    val doctorId: String = "",
) {
    /**
     * Minutes past midnight, for ordering.
     *
     * The stored time is a display string, so sorting the raw strings puts
     * "10:00 AM" before "9:00 AM". Anything unparseable sorts to the END of the
     * day rather than the start, so a malformed record shows up somewhere
     * visible instead of silently sitting at the top of the list.
     */
    val minuteOfDay: Int by lazy(LazyThreadSafetyMode.NONE) { parseMinutes(time) }

    /** "MH" — two initials, because a waiting room holds two Mariams. */
    val initials: String
        get() {
            val parts = patientName.trim().split(" ").filter(String::isNotBlank)
            return when {
                parts.isEmpty() -> "•"
                parts.size == 1 -> parts[0].take(1).uppercase()
                else -> (parts[0].take(1) + parts[1].take(1)).uppercase()
            }
        }
}

private fun parseMinutes(time: String): Int {
    val m = Regex("""(\d{1,2}):(\d{2})\s*([AaPp][Mm])?""").find(time.trim()) ?: return 24 * 60
    var hour = m.groupValues[1].toIntOrNull() ?: return 24 * 60
    val minute = m.groupValues[2].toIntOrNull() ?: return 24 * 60
    val meridiem = m.groupValues[3].lowercase()
    if (meridiem == "pm" && hour != 12) hour += 12
    if (meridiem == "am" && hour == 12) hour = 0
    return hour * 60 + minute
}

/**
 * Where a visit has got to.
 *
 * A sealed set rather than the raw string, so a screen cannot compare against a
 * typo and silently never match. [from] absorbs the vocabulary the website used
 * before it settled — records written then still say "Arrived" and "Seated", and
 * the website maps rather than migrates them, so this must too or those visits
 * arrive unstyled.
 */
enum class Stage(val stored: String) {
    Unconfirmed("Scheduled"),
    Confirmed("Confirmed"),
    CheckedIn("Checked In"),
    InChair("In Chair"),
    CheckingOut("Checking Out"),
    Completed("Completed"),
    Late("Late"),
    Delayed("Delayed"),
    Cancelled("Cancelled"),
    NoShow("No Show"),
    Rescheduled("Rescheduled"),
    ;

    /** The visit is over, one way or another. */
    val isFinished: Boolean
        get() = this == Completed || this == Cancelled || this == NoShow

    /** The patient has been dealt with — the day's progress. */
    val isSeen: Boolean
        get() = this == Completed || this == CheckingOut

    companion object {
        fun from(raw: String?): Stage = when (raw?.trim()) {
            null, "" -> Unconfirmed
            "Arrived" -> CheckedIn
            "Seated", "In Progress" -> InChair
            "Pending" -> Unconfirmed
            else -> entries.firstOrNull { it.stored.equals(raw.trim(), ignoreCase = true) } ?: Unconfirmed
        }
    }
}

/** Who is signed in, and which clinic they are looking at. */
data class Who(
    val uid: String,
    val name: String,
    val email: String,
    val clinicId: String,
    val role: String,
    /** The tick-boxes from the website's Manage Access screen, for this clinic. */
    val permissions: Set<String>,
) {
    /** Owner and Admin are the same answer everywhere on the phone. */
    val isAdmin: Boolean get() = role == "Owner" || role == "Admin"

    /**
     * Whether a granted key allows this.
     *
     * Admins pass without consulting the list, as they do on the website. Note
     * this is a convenience, not a security boundary — Firestore rules are the
     * boundary, and this only decides whether to draw a button that would be
     * rejected anyway.
     */
    fun can(key: String): Boolean = isAdmin || key in permissions
}

/** The clinic's own details, for the slab. */
data class Clinic(val name: String, val currency: String)

/**
 * Reads a field the website may have stored as a string OR a number.
 *
 * Phone numbers and ids get written both ways depending on which form created
 * the record, and `getString` on a number returns null rather than coercing —
 * which is how a perfectly good record reads as blank.
 */
internal fun DocumentSnapshot.text(field: String): String = when (val v = get(field)) {
    null -> ""
    is String -> v
    else -> v.toString()
}

internal fun DocumentSnapshot.number(field: String): Double? = (get(field) as? Number)?.toDouble()

/** One appointment document, as this app sees it. */
internal fun DocumentSnapshot.toVisit(): Visit = Visit(
    id = id,
    patientId = text("patientId"),
    patientName = text("patientName"),
    date = text("date"),
    time = text("time"),
    doctor = text("doctor"),
    treatment = text("treatment"),
    status = Stage.from(text("status")),
    duration = number("duration")?.toInt()?.takeIf { it > 0 } ?: 30,
    doctorId = text("doctorId"),
)

/**
 * When the clinic is open, and how long a slot is.
 *
 * Stored on `settings/clinic_info` under `schedule`, written by the website. The
 * defaults are a nine-to-nine day in half-hours, which is a guess — [configured]
 * says whether anyone has actually set it, so a screen can decline to claim
 * "5 free slots" at a practice that never told us when it closes.
 */
data class Hours(
    val startMinute: Int = 9 * 60,
    val endMinute: Int = 21 * 60,
    val slot: Int = 30,
    val offDays: Set<String> = emptySet(),
    val configured: Boolean = false,
) {
    /** A clinic closing after midnight has an end before its start; roll it forward. */
    val closes: Int get() = if (endMinute <= startMinute) endMinute + 24 * 60 else endMinute

    fun isOpenOn(dateKey: String): Boolean {
        if (offDays.isEmpty()) return true
        val day = runCatching {
            java.text.SimpleDateFormat("EEEE", java.util.Locale.US)
                .format(java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(dateKey)!!)
        }.getOrNull()?.lowercase() ?: return true
        return day !in offDays
    }
}

/** Mirrors the website's parseClinicSchedule, including its tolerance for strings. */
internal fun parseHours(raw: Map<String, Any?>?): Hours {
    val m = raw.orEmpty()

    fun minutes(value: Any?, fallback: Int): Int {
        val text = value as? String ?: return fallback
        val parts = text.trim().split(":")
        val h = parts.getOrNull(0)?.toIntOrNull() ?: return fallback
        val min = parts.getOrNull(1)?.toIntOrNull() ?: 0
        return h.coerceIn(0, 23) * 60 + min.coerceIn(0, 59)
    }

    val slot = when (val v = m["slotDuration"]) {
        is Number -> v.toInt()
        is String -> v.toIntOrNull() ?: 30
        else -> 30
    }.let { if (it <= 0) 30 else it }

    return Hours(
        startMinute = minutes(m["start"], 9 * 60),
        endMinute = minutes(m["end"], 21 * 60),
        slot = slot,
        offDays = (m["offDays"] as? List<*>)
            ?.mapNotNull { it?.toString()?.trim()?.lowercase()?.takeIf(String::isNotEmpty) }
            ?.toSet().orEmpty(),
        configured = m["configuredAt"] != null ||
            ((m["start"] as? String)?.isNotBlank() == true && (m["end"] as? String)?.isNotBlank() == true),
    )
}

/** Someone on the clinic's register. */
data class Person(
    val id: String,
    val name: String,
    val phone: String,
    /** What they still owe, as the website keeps it on the patient document. */
    val balance: Double,
    /** Under the name on the card, as the site shows it. Often blank. */
    val address: String = "",
) {
    val initials: String
        get() {
            val parts = name.trim().split(" ").filter(String::isNotBlank)
            return when {
                parts.isEmpty() -> "•"
                parts.size == 1 -> parts[0].take(1).uppercase()
                else -> (parts[0].take(1) + parts[1].take(1)).uppercase()
            }
        }

    /** The letter this name files under, for the directory's dividers. */
    val initial: String get() = name.trim().firstOrNull()?.uppercase() ?: "#"
}

/**
 * A phone can be stored under any of five keys.
 *
 * Which one depends on the form that created the record — the website has grown
 * several. Reading only `phone` is how a patient with a perfectly good mobile
 * shows up with none.
 */
private val PHONE_KEYS = listOf("phone", "phoneNumber", "mobile", "whatsapp", "contactNumber")

internal fun DocumentSnapshot.toPerson(): Person = Person(
    id = id,
    name = getString("name").orEmpty(),
    phone = PHONE_KEYS.firstNotNullOfOrNull { getString(it)?.takeIf(String::isNotBlank) }.orEmpty(),
    balance = number("balance") ?: 0.0,
    address = text("address"),
)

/**
 * Does this patient match what was typed?
 *
 * Ported from the website's flexible search, not reinvented: someone who finds a
 * patient by typing "ahmed hassan" on the website must find the same patient
 * typing the same thing here. Two rules carry that.
 *
 *  - **Names match tokenised and in any order**, so "hassan ahmed" finds
 *    "Ahmed Hassan". Egyptian patients are commonly recorded with three or four
 *    names and staff rarely type them in the stored order.
 *  - **Phone matching needs at least two digits** and compares digits only. One
 *    digit would match most of the register, and stored numbers carry +20,
 *    spaces and dashes that nobody types.
 */
fun matchesSearch(query: String, person: Person): Boolean {
    val q = query.trim().lowercase().replace(Regex("""\s+"""), " ")
    if (q.isEmpty()) return true

    val queryDigits = query.filter(Char::isDigit)
    if (queryDigits.length >= 2 && person.phone.filter(Char::isDigit).contains(queryDigits)) return true

    val name = person.name.lowercase()
    return q.split(" ").filter(String::isNotEmpty).all { name.contains(it) }
}

/** Is this a phone number rather than a name? Matches the website's test. */
fun looksLikePhone(term: String): Boolean {
    val t = term.trim()
    return t.isNotEmpty() && Regex("""^[0-9+\-\s()]+$""").matches(t)
}

/** One money line on a patient's file. */
data class Money(
    val id: String,
    val date: String,
    /** "procedure" charges; anything else that is not an expense is a payment. */
    val type: String,
    val description: String,
    val amount: Double,
    val method: String,
    val doctor: String,
    /** What the dentist keeps of this row, and what the lab took. On cash rows. */
    val commission: Double = 0.0,
    val labFee: Double = 0.0,
    /** Knocked off the list price. On charge rows. */
    val discount: Double = 0.0,
    /**
     * Who recorded this row — the receptionist who took the cash, the dentist who charged the
     * work. Both the website and the phone write it as `addedBy`. It was read by nobody, which
     * is how "who took that payment?" became a question with no answer on the phone.
     */
    val by: String = "",
    /** On a payment: the charge it settles. Blank for money put on account. */
    val procedureId: String = "",
    /** The dentist whose work this money is for, by staff id. What the commission tally groups on. */
    val doctorId: String = "",
    /** Whose file this line is on. Blank on a clinic expense. */
    val patientName: String = "",
    val patientId: String = "",
) {
    val isCharge: Boolean get() = type == "procedure"

    /** The clinic's own overheads — not a patient's debt, and not income. */
    val isExpense: Boolean get() = type == "expense"

    val isPayment: Boolean get() = type == "payment"
}

/**
 * What a patient owes.
 *
 * Never negative: someone who overpaid holds a credit, not a debt, and showing
 * "owes -200" invites a receptionist to ask them for money they do not owe.
 */
data class Balance(val charged: Double, val paid: Double) {
    val owed: Double get() = (charged - paid).coerceAtLeast(0.0)
    val credit: Double get() = (paid - charged).coerceAtLeast(0.0)
}

/** A patient's whole file, as one screen needs it. */
data class Record(
    val person: Person,
    val fileId: String,
    val dateOfBirth: String,
    val gender: String,
    /** Free text the clinic typed. Blank means nobody has written any. */
    val allergies: String,
    /**
     * Blank means NOT ASKED, not "healthy".
     *
     * The website used to default this to "None (Healthy)" — an assertion of
     * absence no clinician ever made, and indistinguishable downstream from a
     * real negative screening. It is blank now, and this screen must say
     * "not recorded" rather than inventing a clean bill of health.
     */
    val medicalHistory: String,
    /** Only ever shown on the details form; nothing else reads it. */
    val address: String = "",
    /**
     * The patient has asked not to be messaged — or the clinic has decided so for them.
     *
     * `whatsappOptOut` has existed for a long time; `smsOptOut` is newer and, when UNSET, follows
     * it (see the website's lib/patientMessaging). Kept as a nullable here for exactly that
     * reason: null is "never decided separately", which is not the same as false.
     */
    val whatsappOptOut: Boolean = false,
    val smsOptOut: Boolean? = null,
    val balance: Balance,
    val upcoming: List<Visit>,
    val past: List<Visit>,
    val ledger: List<Money>,
    /** The chart, keyed by FDI number. Teeth with nothing recorded are absent. */
    val teeth: Map<Int, Tooth> = emptyMap(),
) {
    /** What actually applies to text messages: its own flag, or WhatsApp's when it has none. */
    val smsBlocked: Boolean get() = smsOptOut ?: whatsappOptOut

    /** Everything ever charged to this patient — what they are worth to the clinic. */
    val lifetime: Double get() = balance.charged

    val lastSeen: String? get() = past.firstOrNull()?.date

    /**
     * Age in years, if a date of birth was recorded.
     *
     * Null rather than zero when it is missing or unparseable: "0" beside a name
     * is a claim about a newborn, and the field is frequently left empty.
     */
    val age: Int?
        get() {
            val dob = runCatching {
                java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(dateOfBirth)
            }.getOrNull() ?: return null
            val born = java.util.Calendar.getInstance().apply { time = dob }
            val now = java.util.Calendar.getInstance()
            var years = now.get(java.util.Calendar.YEAR) - born.get(java.util.Calendar.YEAR)
            if (now.get(java.util.Calendar.DAY_OF_YEAR) < born.get(java.util.Calendar.DAY_OF_YEAR)) years--
            return years.takeIf { it in 0..130 }
        }
}

/**
 * One WhatsApp conversation.
 *
 * Written by the bot and the website; this app only reads it. The fields that
 * matter most to someone at a desk are [needsHuman] and [unread] — the queue is
 * worked, not browsed.
 */
data class Thread(
    val id: String,
    val phone: String,
    val patientId: String,
    val patientName: String,
    val lastText: String,
    val lastAt: Long,
    /** "in" from the patient, "out" from the clinic. */
    val lastDirection: String,
    val unread: Int,
    /** The bot gave up and asked for a person. */
    val needsHuman: Boolean,
    val handoffReason: String,
    /** "urgent", "complaint" or "normal". */
    val severity: String,
    val botPaused: Boolean,
    /** They asked not to be messaged. Nothing may be sent to them. */
    val optedOut: Boolean,
    val assignedName: String,
    val archived: Boolean,
) {
    /** Who this is: their name if the clinic knows it, else the number. */
    val title: String get() = patientName.ifBlank { phone.ifBlank { id } }

    val initials: String
        get() {
            // A thread with no name is a bare phone number, and the first two
            // characters of one are not initials — "+20 111…" was showing "+1".
            if (patientName.isBlank()) return "#"
            val parts = patientName.trim().split(" ").filter(String::isNotBlank)
            return when {
                parts.isEmpty() -> "#"
                parts.size == 1 -> parts[0].take(1).uppercase()
                else -> (parts[0].take(1) + parts[1].take(1)).uppercase()
            }
        }

    val urgent: Boolean get() = severity == "urgent" || severity == "complaint"
}

/** One message in a thread. */
data class Line(
    val id: String,
    /** "in" from the patient, "out" from the clinic. */
    val direction: String,
    /** "patient", "bot", "staff" or "system". */
    val author: String,
    val text: String,
    val at: Long,
    /** "image", "audio", "video", "document"… when the message carried a file. */
    val media: String,
    /** A voice note's words, attached a few seconds after it arrives. */
    val transcript: String,
    /** Meta's own ticks: "sent", "delivered", "read", "failed". Blank inbound. */
    val status: String,
    val name: String,
) {
    val fromPatient: Boolean get() = direction == "in"
    val fromBot: Boolean get() = author == "bot"
    val failed: Boolean get() = status == "failed"
}

internal fun DocumentSnapshot.millis(field: String): Long = (get(field) as? Number)?.toLong() ?: 0L

internal fun DocumentSnapshot.toThread(): Thread = Thread(
    id = id,
    phone = text("phone"),
    patientId = text("patientId"),
    patientName = text("patientName"),
    lastText = text("lastText"),
    // Three fields carry "when something last happened" depending on which
    // writer touched the row; the newest of them is the truth.
    lastAt = maxOf(millis("lastAt"), millis("lastMessageAt"), millis("handoffAtMs")),
    lastDirection = text("lastDirection"),
    unread = millis("unreadCount").toInt(),
    needsHuman = getBoolean("needsHuman") == true,
    handoffReason = text("handoffReason"),
    severity = text("severity"),
    botPaused = getBoolean("botPaused") == true,
    optedOut = getBoolean("optedOut") == true,
    assignedName = text("assignedName"),
    archived = getBoolean("archived") == true,
)

internal fun DocumentSnapshot.toLine(): Line = Line(
    id = id,
    direction = text("direction"),
    author = text("author"),
    text = text("text"),
    at = millis("at"),
    media = text("media"),
    transcript = text("transcript"),
    status = text("status"),
    name = text("name"),
)
