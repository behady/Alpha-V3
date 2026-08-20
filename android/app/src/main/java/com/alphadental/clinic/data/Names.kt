package com.alphadental.clinic.data

/**
 * Titles a doctor's name may already carry, in either language. Shared by the
 * home-screen greeting and by [withDoctorTitle].
 */
val DOCTOR_TITLES = setOf("dr", "د", "دكتور", "doctor", "prof", "أستاذ", "استاذ")

/**
 * "Dr. Ahmed" — and never "Dr. Dr. Ahmed". Doctor names are stored exactly as
 * they were typed, and half the clinic types the title in, so the prefix is
 * only added when the name does not already start with one.
 */
fun withDoctorTitle(name: String): String {
    val trimmed = name.trim()
    val first = trimmed.split(" ").firstOrNull()?.trimEnd('.', '،', '/') ?: return trimmed
    return if (first.lowercase() in DOCTOR_TITLES) trimmed else "Dr. $trimmed"
}
