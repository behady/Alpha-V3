package com.alphadental.clinic.data

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Date and time normalisation, ported line-for-line from lib/appointmentTime.ts.
 *
 * This file is the app's half of a shared contract, and the contract is unforgiving. Appointments
 * are stored with a *display* time — `"02:00 PM"` — not a sortable one. The website already had a
 * live bug from writing `"14:00"` instead: the two strings never compared equal, so a slot the
 * clinic had filled still looked free to a patient booking online, and two people were booked into
 * the same chair.
 *
 * So nothing here invents a format. Every value the app writes goes through these functions first,
 * which means a booking made on the phone is byte-identical to one made in the browser.
 */

/** Canonical stored date: yyyy-MM-dd. */
fun normalizeDateKey(value: String?): String {
    val trimmed = value?.trim().orEmpty()
    if (trimmed.isEmpty()) return ""
    if (Regex("""^\d{4}-\d{2}-\d{2}$""").matches(trimmed)) return trimmed

    // Anything else is passed through untouched rather than guessed at — a half-parsed date
    // written into the database is worse than an obviously wrong one.
    return trimmed
}

/** Today in the phone's own timezone, in the stored format. */
fun todayKey(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

fun dateKeyOf(date: Date): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(date)

fun parseDateKey(value: String): Date =
    runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(value) }.getOrNull() ?: Date()

/** The day of week as the schedule settings spell it: "sunday", "monday", … */
fun weekdayNameOf(dateKey: String): String {
    val calendar = Calendar.getInstance().apply { time = parseDateKey(dateKey) }
    return when (calendar.get(Calendar.DAY_OF_WEEK)) {
        Calendar.SUNDAY -> "sunday"
        Calendar.MONDAY -> "monday"
        Calendar.TUESDAY -> "tuesday"
        Calendar.WEDNESDAY -> "wednesday"
        Calendar.THURSDAY -> "thursday"
        Calendar.FRIDAY -> "friday"
        else -> "saturday"
    }
}

/**
 * Canonical stored time: `hh:mm AM/PM` with a leading zero.
 *
 * Accepts 24-hour input and the Arabic ص/م markers, so whatever a caller has can be turned into
 * the one format the database holds.
 */
fun normalizeTimeKey(value: String?): String {
    val raw = value?.trim().orEmpty()
    if (raw.isEmpty()) return ""

    val normalized = raw
        .replace(Regex("""\s+"""), " ")
        .replace("ص", "AM")
        .replace("م", "PM")
        .uppercase(Locale.US)

    Regex("""^(\d{1,2}):(\d{2})\s?(AM|PM)$""").find(normalized)?.let { match ->
        val hours = match.groupValues[1].toInt()
        val mins = match.groupValues[2].toInt()
        if (hours in 1..12 && mins in 0..59) {
            return "%02d:%02d %s".format(hours, mins, match.groupValues[3])
        }
    }

    Regex("""^(\d{1,2}):(\d{2})$""").find(normalized)?.let { match ->
        val hours24 = match.groupValues[1].toInt()
        val mins = match.groupValues[2].toInt()
        if (hours24 in 0..23 && mins in 0..59) {
            val ampm = if (hours24 >= 12) "PM" else "AM"
            var hours12 = hours24 % 12
            if (hours12 == 0) hours12 = 12
            return "%02d:%02d %s".format(hours12, mins, ampm)
        }
    }

    return normalized
}

/** Minutes from midnight. Comparing these is the only safe way to test two times for overlap. */
fun parseApptTimeToMinutes(timeStr: String?): Int {
    if (timeStr.isNullOrBlank()) return 0
    val normalized = normalizeTimeKey(timeStr)
    val match = Regex("""^(\d{1,2}):(\d{2})\s?(AM|PM)$""", RegexOption.IGNORE_CASE).find(normalized)
        ?: return 0

    var h = match.groupValues[1].toInt()
    val m = match.groupValues[2].toInt()
    val ampm = match.groupValues[3].uppercase(Locale.US)
    if (ampm == "PM" && h < 12) h += 12
    if (ampm == "AM" && h == 12) h = 0
    return h * 60 + m
}

/** Minutes from midnight back to the canonical stored form. */
fun minutesToTimeKey(minutes: Int): String {
    val wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60)
    val h24 = wrapped / 60
    val m = wrapped % 60
    val ampm = if (h24 >= 12) "PM" else "AM"
    var h12 = h24 % 12
    if (h12 == 0) h12 = 12
    return "%02d:%02d %s".format(h12, m, ampm)
}

/**
 * The clinic's working hours, from settings/clinic_info.schedule.
 *
 * `isConfigured` is carried across from the website for the same reason it exists there: nothing
 * seeds this document at onboarding, so a clinic that never opened the Schedule tab parses as
 * "09:00–21:00, seven days a week". Without the flag there is no way to tell that apart from a
 * clinic that genuinely runs those hours, and the app would cheerfully offer a Friday evening slot
 * to a practice that closes at five.
 */
data class ClinicSchedule(
    val startHour: Int = 9,
    val startMinute: Int = 0,
    val endHour: Int = 21,
    val endMinute: Int = 0,
    val slotDuration: Int = 30,
    val offDays: List<String> = emptyList(),
    val isConfigured: Boolean = false,
) {
    fun startMinutes(): Int = startHour * 60 + startMinute

    fun endMinutes(): Int {
        val start = startMinutes()
        var end = endHour * 60 + endMinute
        // A clinic that closes after midnight has an end before its start; roll it forward so the
        // slot loop does not produce an empty day.
        if (end <= start) end += 24 * 60
        return end
    }

    fun isOffDay(dateKey: String): Boolean = offDays.contains(weekdayNameOf(dateKey))
}

/** Mirrors parseClinicSchedule() in lib/clinicSchedule.ts. */
fun parseClinicSchedule(scheduleMap: Map<String, Any?>?): ClinicSchedule {
    val sched = scheduleMap.orEmpty()

    fun parseHM(value: Any?, fallbackH: Int, fallbackM: Int): Pair<Int, Int> {
        val text = value as? String
        if (text.isNullOrBlank()) return fallbackH to fallbackM
        val parts = text.trim().split(":")
        val h = parts.getOrNull(0)?.toIntOrNull() ?: fallbackH
        val m = parts.getOrNull(1)?.toIntOrNull() ?: fallbackM
        return h.coerceIn(0, 23) to m.coerceIn(0, 59)
    }

    val start = parseHM(sched["start"], 9, 0)
    val end = parseHM(sched["end"], 21, 0)

    val slot = when (val raw = sched["slotDuration"]) {
        is Number -> raw.toInt()
        is String -> raw.toIntOrNull() ?: 30
        else -> 30
    }.let { if (it <= 0) 30 else it }

    @Suppress("UNCHECKED_CAST")
    val offDays = (sched["offDays"] as? List<Any?>)
        ?.mapNotNull { it?.toString()?.lowercase(Locale.US)?.trim()?.takeIf(String::isNotEmpty) }
        .orEmpty()

    val configured = sched["configuredAt"] != null ||
        ((sched["start"] as? String)?.isNotBlank() == true && (sched["end"] as? String)?.isNotBlank() == true)

    return ClinicSchedule(
        startHour = start.first,
        startMinute = start.second,
        endHour = end.first,
        endMinute = end.second,
        slotDuration = slot,
        offDays = offDays,
        isConfigured = configured,
    )
}

/** One bookable time, and whether anything already occupies it. */
data class Slot(
    val time: String,
    val minutes: Int,
    val takenBy: String? = null,
) {
    val isFree: Boolean get() = takenBy == null
}

/**
 * Every slot in the clinic's day, marked with whoever already holds it.
 *
 * Overlap is judged on minutes, never on the display strings — see the note at the top of this
 * file. A booking's duration is honoured, so a 60-minute appointment blocks two 30-minute slots
 * rather than only the one it starts in.
 *
 * Cancelled and no-show appointments release their slot: the chair is genuinely free, and leaving
 * it blocked is how a clinic ends up turning patients away from an empty surgery.
 */
fun buildSlots(
    schedule: ClinicSchedule,
    existing: List<Appointment>,
    slotDuration: Int = schedule.slotDuration,
    ignoreAppointmentId: String? = null,
): List<Slot> {
    val busy = existing
        .filter { it.id != ignoreAppointmentId }
        .filterNot { normalizeStatusForBooking(it.status) in setOf("Cancelled", "No Show") }
        .map { appointment ->
            val start = parseApptTimeToMinutes(appointment.time)
            val length = if (appointment.duration > 0) appointment.duration else slotDuration
            Triple(start, start + length, appointment.patientName)
        }

    val slots = mutableListOf<Slot>()
    var cursor = schedule.startMinutes()
    val end = schedule.endMinutes()

    while (cursor + slotDuration <= end) {
        val slotEnd = cursor + slotDuration
        val clash = busy.firstOrNull { (busyStart, busyEnd, _) -> cursor < busyEnd && slotEnd > busyStart }
        slots += Slot(time = minutesToTimeKey(cursor), minutes = cursor, takenBy = clash?.third)
        cursor += slotDuration
    }

    return slots
}

/** Local copy of the status normaliser so this file stays free of UI imports. */
private fun normalizeStatusForBooking(status: String?): String = when (status) {
    null, "" -> "Scheduled"
    "Arrived" -> "Checked In"
    "Seated" -> "In Chair"
    "Pending" -> "Scheduled"
    "In Progress" -> "In Chair"
    else -> status
}
