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
