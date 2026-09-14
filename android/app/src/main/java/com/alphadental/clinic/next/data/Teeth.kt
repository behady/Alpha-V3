package com.alphadental.clinic.next.data

import androidx.compose.ui.graphics.Color
import com.alphadental.clinic.data.DIAGNOSIS_CATEGORIES
import com.alphadental.clinic.data.DIAGNOSIS_OPTIONS
import com.google.firebase.firestore.DocumentSnapshot

/**
 * The tooth chart, as it is stored.
 *
 * `patients/{id}.teethData` is a map of FDI tooth number to `{ statuses: [ids],
 * notes: string }`, written by the website. The status ids are a shared
 * vocabulary between the two surfaces, so nothing here invents or renames one —
 * this reads them and looks their meaning up in the catalogue the old package
 * already carries, rather than making a third copy of it to drift.
 */

/** One tooth, and what has been recorded about it. */
data class Tooth(
    /** FDI number: 11–18, 21–28, 31–38, 41–48. */
    val number: Int,
    val statuses: List<String>,
    val notes: String,
) {
    val hasAnything: Boolean get() = statuses.isNotEmpty() || notes.isNotBlank()

    /**
     * The one condition that decides the tooth's colour.
     *
     * A tooth often carries several — "previously treated" and "secondary
     * caries" sit together all the time — and a chart that showed the first one
     * stored would colour by whichever order somebody happened to tick them in.
     * The most serious wins, so a tooth that needs attention never hides behind
     * a note about a filling it already has.
     */
    val leading: String? get() = statuses.minByOrNull { severityOf(it) }
}

/** The FDI quadrants, laid out as a dentist sees the patient rather than as the numbers ascend. */
val UPPER_RIGHT = listOf(18, 17, 16, 15, 14, 13, 12, 11)
val UPPER_LEFT = listOf(21, 22, 23, 24, 25, 26, 27, 28)
val LOWER_RIGHT = listOf(48, 47, 46, 45, 44, 43, 42, 41)
val LOWER_LEFT = listOf(31, 32, 33, 34, 35, 36, 37, 38)

/**
 * Which catalogue category a status id belongs to.
 *
 * Derived from the id's prefix rather than stored twice. The order below is
 * load-bearing: "perio" must be tested BEFORE "peri", or every periodontal
 * status would be read as a periapical one — they differ by a single letter and
 * mean different halves of the mouth.
 */
private val CATEGORY_BY_PREFIX = listOf(
    "healthy" to "healthy",
    "caries" to "caries",
    "pulp" to "pulp",
    "perio" to "perio",
    "peri" to "periapical",
    "sens" to "sensitivity",
    "wear" to "wear",
    "trauma" to "trauma",
    "dev" to "development",
    "rest" to "restoration",
    "surg" to "surgery",
)

fun categoryOf(statusId: String): String =
    CATEGORY_BY_PREFIX.firstOrNull { statusId.startsWith(it.first) }?.second ?: "healthy"

/**
 * How much a condition matters, lowest first.
 *
 * Not alphabetical and not the catalogue's own order: this is a clinical
 * ranking, used only to decide which colour a tooth wears when it carries
 * several conditions at once.
 */
private val SEVERITY = listOf(
    "surgery", "caries", "pulp", "periapical", "trauma",
    "perio", "wear", "development", "sensitivity", "restoration", "healthy",
)

fun severityOf(statusId: String): Int =
    SEVERITY.indexOf(categoryOf(statusId)).let { if (it < 0) SEVERITY.size else it }

/** The catalogue's colour for a status, so the phone and the website agree. */
fun colourOf(statusId: String): Color =
    DIAGNOSIS_CATEGORIES.firstOrNull { it.id == categoryOf(statusId) }?.color
        ?: Color(0xFF94A3B8)

/** What the clinic called this condition. */
fun labelOf(statusId: String): String =
    DIAGNOSIS_OPTIONS.firstOrNull { it.id == statusId }?.en
    // An id the catalogue does not know is shown as itself rather than dropped:
    // a diagnosis recorded on the website and silently missing here is worse
    // than an ugly label.
        ?: statusId.replace('_', ' ').replaceFirstChar { it.uppercase() }

/** The category's own name, for grouping what is listed under a tooth. */
fun categoryNameOf(statusId: String): String =
    DIAGNOSIS_CATEGORIES.firstOrNull { it.id == categoryOf(statusId) }?.en ?: "Other"

/**
 * Read the chart off a patient document.
 *
 * Teeth with nothing recorded are left out rather than stored as empty: the
 * chart draws all thirty-two regardless, and an absent entry means "nothing has
 * been said about this tooth", which is not the same as "healthy".
 */
internal fun DocumentSnapshot.toTeeth(): Map<Int, Tooth> {
    @Suppress("UNCHECKED_CAST")
    val raw = get("teethData") as? Map<String, Any?> ?: return emptyMap()
    return raw.mapNotNull { (key, value) ->
        val number = key.trim().toIntOrNull() ?: return@mapNotNull null
        val entry = value as? Map<*, *> ?: return@mapNotNull null
        val statuses = (entry["statuses"] as? List<*>)
            ?.mapNotNull { it as? String }
            ?.filter { it.isNotBlank() }
            .orEmpty()
        val notes = (entry["notes"] as? String).orEmpty()
        if (statuses.isEmpty() && notes.isBlank()) return@mapNotNull null
        number to Tooth(number, statuses.sortedBy { severityOf(it) }, notes)
    }.toMap()
}
