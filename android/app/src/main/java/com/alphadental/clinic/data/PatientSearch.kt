package com.alphadental.clinic.data

import java.util.Locale

/**
 * Patient search matching, ported from lib/flexibleSearch.ts.
 *
 * Shared behaviour, so it is copied rather than reinvented: someone who finds a patient by typing
 * "ahmed hassan" on the website has to find the same patient typing the same thing on the phone.
 * Two rules carry that:
 *
 *  - **Name matching is tokenised and order-independent.** Every whitespace-separated token must
 *    appear somewhere in the name, in any order — so "hassan ahmed" finds "Ahmed Hassan". Egyptian
 *    patients are commonly recorded with three or four names and staff rarely type them in the
 *    stored order.
 *  - **Phone matching needs at least two digits**, and compares digits only. A single digit would
 *    match most of the register, and stored numbers carry +20, spaces and dashes that nobody types.
 */

fun normalizeSearchQuery(raw: String): String =
    raw.trim().lowercase(Locale.ROOT).replace(Regex("""\s+"""), " ")

/** Every whitespace-separated token must appear as a substring, in any order. */
fun matchesTokenizedSubstring(haystack: String, query: String): Boolean {
    val q = normalizeSearchQuery(query)
    if (q.isEmpty()) return true
    val stack = haystack.lowercase(Locale.ROOT)
    return q.split(" ").filter { it.isNotEmpty() }.all { stack.contains(it) }
}

/** Directory search: substring tokens on the name, digit substring on the phone. */
fun patientMatchesSearch(query: String, name: String?, phone: String?): Boolean {
    val q = normalizeSearchQuery(query)
    if (q.isEmpty()) return true

    val phoneDigits = phone.orEmpty().filter { it.isDigit() }
    val queryDigits = query.filter { it.isDigit() }
    if (queryDigits.length >= 2 && phoneDigits.contains(queryDigits)) return true

    return matchesTokenizedSubstring(name.orEmpty().trim(), q)
}

/**
 * Is this search term a phone number rather than a name?
 *
 * Matches the website's test: only digits and the punctuation people put in phone numbers. A term
 * like "01001234567" is answered by a fast indexed query on the phone field; a name has to be
 * filtered in memory because Firestore cannot search for text in the middle of a value.
 */
fun looksLikePhoneSearch(term: String): Boolean {
    val trimmed = term.trim()
    return trimmed.isNotEmpty() && Regex("""^[0-9+\-\s()]+$""").matches(trimmed)
}
