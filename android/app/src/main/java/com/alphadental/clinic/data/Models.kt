package com.alphadental.clinic.data

import com.google.firebase.firestore.DocumentSnapshot

/**
 * Who is signed in, and what they are allowed to be.
 *
 * Role comes from users/{uid}.clinicRoles[clinicId] — the same field the website
 * and the security rules read. It is never taken from anywhere the phone could
 * influence, because it decides which dashboard opens and what may be edited.
 */
data class Session(
    val uid: String,
    val name: String,
    val email: String,
    val clinicId: String,
    val role: String,
) {
    val isAdmin: Boolean get() = role == "Admin"
    val isDentist: Boolean get() = role == "Dentist"
    val isReception: Boolean get() = role == "Receptionist" || role == "Assistant"
}

/**
 * One appointment, read straight from clinics/{clinicId}/appointments.
 *
 * Field names are the website's, not tidied-up versions of them. A record written
 * by the phone has to be indistinguishable from one written by the browser — this
 * is one database, and a renamed field would simply vanish from the other side.
 */
data class Appointment(
    val id: String = "",
    val patientId: String = "",
    val patientName: String = "",
    /** Calendar date, "yyyy-MM-dd". */
    val date: String = "",
    /** Display time as the website stores it, e.g. "09:30 AM". */
    val time: String = "",
    val doctor: String = "",
    val status: String = "Scheduled",
    val treatment: String = "",
    val phone: String = "",
    /** Minutes. Drives how many slots this appointment blocks when booking around it. */
    val duration: Int = 30,
    val doctorId: String = "",
    val notes: String = "",
    val hasCheckedIn: Boolean = false,
    /** True while this record is still only on this phone. */
    val pendingWrite: Boolean = false,
) {
    /**
     * Minutes past midnight, for ordering.
     *
     * Appointments are stored with a display string like "09:30 AM" rather than a
     * sortable number, so sorting the raw strings puts 10:00 AM before 9:00 AM.
     * Anything unparseable sorts to the end of the day instead of the start, so a
     * malformed record is visible rather than silently sitting at the top.
     */
    fun minutes(): Int = parseTimeToMinutes(time)
}

fun parseTimeToMinutes(raw: String?): Int {
    if (raw.isNullOrBlank()) return Int.MAX_VALUE
    val text = raw.trim().uppercase()
    val isPm = text.contains("PM")
    val isAm = text.contains("AM")
    val digits = text.replace("AM", "").replace("PM", "").trim()
    val parts = digits.split(":")
    if (parts.isEmpty()) return Int.MAX_VALUE

    val hour = parts[0].trim().toIntOrNull() ?: return Int.MAX_VALUE
    val minute = parts.getOrNull(1)?.trim()?.toIntOrNull() ?: 0

    var h = hour
    if (isPm && h != 12) h += 12
    if (isAm && h == 12) h = 0
    return h * 60 + minute
}

/** Reads a field that may have been stored as either a string or a number. */
private fun DocumentSnapshot.str(field: String): String = when (val v = get(field)) {
    null -> ""
    is String -> v
    else -> v.toString()
}

fun DocumentSnapshot.toAppointment(pendingWrite: Boolean): Appointment = Appointment(
    id = id,
    patientId = str("patientId"),
    patientName = str("patientName"),
    date = str("date"),
    time = str("time"),
    doctor = str("doctor"),
    status = str("status").ifBlank { "Scheduled" },
    treatment = str("treatment"),
    // The website looks for a phone under several different keys depending on how
    // the patient was created; mirror pickPatientPhone's first two.
    phone = str("phone").ifBlank { str("patientPhone") },
    duration = (get("duration") as? Number)?.toInt()?.takeIf { it > 0 } ?: 30,
    doctorId = str("doctorId"),
    notes = str("notes"),
    hasCheckedIn = get("checkInTime") != null,
    pendingWrite = pendingWrite,
)

/** A dentist who can be assigned to an appointment. */
data class Doctor(
    val id: String = "",
    val name: String = "",
)

/**
 * One entry from the clinic's price list.
 *
 * `durationMinutes` is optional on the record. Where it is set, booking that service should block
 * that much of the chair rather than one default slot — a crown and a check-up are not the same
 * length, and treating them as such is how a day silently overbooks itself.
 */
data class Service(
    val id: String = "",
    val name: String = "",
    val price: Double = 0.0,
    val durationMinutes: Int = 0,
)

/**
 * A patient's file as the app shows it.
 *
 * Upcoming and past are kept apart rather than as one list with a cutoff, because they answer
 * different questions: "when are they next in" and "what have we done for them".
 */
data class PatientFile(
    val patient: Patient,
    val fileId: String = "",
    val balance: Balance,
    val upcoming: List<Appointment> = emptyList(),
    val past: List<Appointment> = emptyList(),
)

/** A patient, only as much of one as the schedule screen needs. */
data class Patient(
    val id: String = "",
    val name: String = "",
    val phone: String = "",
    val balance: Double = 0.0,
)
