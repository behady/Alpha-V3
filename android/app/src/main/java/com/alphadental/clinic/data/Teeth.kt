package com.alphadental.clinic.data

/**
 * Reading and writing the `tooth` field on a clinical note.
 *
 * One procedure can cover several teeth, and the website stores that as a single comma-joined
 * string — "16,17,26" — falling back to "Gen" for work that is not tooth-specific. This is one
 * database shared with the website, so the phone has to read and write exactly that shape.
 *
 * Mirrors parseTeethString in components/clinical-notes/utils.ts, with one deliberate difference:
 * the website's list is permanent teeth only, while the chart on the phone also draws the child
 * arch. Child teeth are accepted here so a note recorded on a milk tooth still lights up the chart
 * rather than silently reading as untoothed.
 */

/** FDI permanent teeth, both arches. */
val ADULT_TEETH: List<String> = listOf(
    "18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28",
    "48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38",
)

/** FDI primary teeth. */
val CHILD_TEETH: List<String> = listOf(
    "55", "54", "53", "52", "51", "61", "62", "63", "64", "65",
    "85", "84", "83", "82", "81", "71", "72", "73", "74", "75",
)

private val KNOWN_TEETH: Set<String> = (ADULT_TEETH + CHILD_TEETH).toSet()

/** What "no particular tooth" is stored as. Matches the website. */
const val GENERAL_TOOTH = "Gen"

private val SEPARATORS = Regex("[\\s,;/-]+")

/**
 * The teeth a stored value refers to.
 *
 * Anything that is not a tooth number — "Gen", free text somebody typed years ago, an empty
 * string — comes back as an empty list rather than as a fake tooth. Duplicates are dropped, and
 * order is kept as written so a note reads back the way it was entered.
 */
fun parseTeeth(raw: String?): List<String> {
    if (raw.isNullOrBlank()) return emptyList()
    return raw.split(SEPARATORS)
        .map { it.trim() }
        .filter { it in KNOWN_TEETH }
        .distinct()
}

/** How a selection is stored. Empty means the work was not tooth-specific. */
fun formatTeeth(teeth: List<String>): String =
    if (teeth.isEmpty()) GENERAL_TOOTH else teeth.joinToString(",")

/**
 * How many times the price is charged.
 *
 * The website multiplies a service's price by the number of teeth it was applied to — four
 * fillings is four times the money — and records the arithmetic alongside the total so an invoice
 * can be explained back to a patient. Treating a multi-tooth procedure as one unit here would have
 * the phone quietly undercharge for exactly the treatments worth the most.
 */
fun pricingUnits(teeth: List<String>): Int = maxOf(teeth.size, 1)

/** Quadrants 1 and 2 (adult) or 5 and 6 (baby) are the upper arch. Mirrors isUpperToothCode(). */
fun isUpperTooth(code: String): Boolean =
    code.trim().firstOrNull()?.digitToIntOrNull() in setOf(1, 2, 5, 6)

/**
 * How many times the unit price is charged, respecting the service's billing rule.
 *
 * Mirrors pricingUnitsFor() in clinical-notes/utils.ts exactly: a flat-fee service
 * charges once however many teeth are marked, per-arch charges once per jaw
 * touched, and everything else — including services from before rules existed —
 * charges per tooth, which is what the system always did.
 */
fun pricingUnitsFor(mode: String?, teeth: List<String>): Int = when (mode) {
    "flat" -> 1
    "per_arch" -> {
        if (teeth.isEmpty()) 1
        else teeth.map { if (isUpperTooth(it)) "upper" else "lower" }.toSet().size.coerceAtLeast(1)
    }
    else -> maxOf(teeth.size, 1)
}

/** The same string the website writes into `pricingFormula`, e.g. "350.0*3". */
fun pricingFormula(unitCost: Double, units: Int): String = "$unitCost*$units"
