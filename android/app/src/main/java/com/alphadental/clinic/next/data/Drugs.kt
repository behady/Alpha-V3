package com.alphadental.clinic.next.data

import com.alphadental.clinic.data.DrugCatalog
import com.alphadental.clinic.data.DrugShortcut

/**
 * The clinic's drug list, as anything that prescribes needs to see it.
 *
 * This lives on its own because two screens now draw from it — the old
 * prescription sheet and the rebuilt one — and the merge below has to agree with
 * src/lib/drugList.ts exactly. Two copies of it would agree until the first time
 * one was fixed.
 */

/**
 * One row of the picker: the built-in library and the clinic's own drugs, flattened into the one
 * shape the list draws.
 *
 * [haystack] is every word the row may be found by, normalised once at merge time — a search that
 * re-derived it per keystroke would fold 53 drugs' worth of Arabic on every letter typed.
 */
data class DrugPick(
    val name: String,
    val dose: String,
    val doseAr: String,
    val noteEn: String,
    val noteAr: String,
    val cautionEn: String,
    val cautionAr: String,
    val haystack: String,
)

/**
 * The same merge src/lib/drugList.ts performs on the web, and it has to stay the same one.
 *
 * `catalogId` is the join key: a clinic row carrying one stands in front of that built-in and
 * supplies its name and both doses, the same row with `hidden` removes the built-in entirely, and
 * a row carrying no `catalogId` is a drug the clinic typed in themselves and is listed first. A
 * clinic that has changed nothing stores nothing and simply gets the library.
 *
 * The description and the caution are never taken from the clinic row even when one exists: those
 * are ours to keep accurate and were never the dentist's to edit.
 */
fun mergeDrugPicks(shortcuts: List<DrugShortcut>): List<DrugPick> {
    val overrides = HashMap<String, DrugShortcut>()
    val own = mutableListOf<DrugShortcut>()

    for (doc in shortcuts) {
        val catalogId = doc.catalogId.trim()
        // Last one wins, if a clinic somehow ends up with two rows for the same built-in.
        if (catalogId.isNotEmpty()) overrides[catalogId] = doc
        else if (doc.name.isNotBlank()) own += doc
    }

    val ownPicks = own
        .map { doc ->
            val name = doc.name.trim()
            DrugPick(
                name = name,
                dose = doc.dose,
                doseAr = doc.doseAr,
                noteEn = "",
                noteAr = "",
                cautionEn = "",
                cautionAr = "",
                haystack = DrugCatalog.normalize(listOf(name, doc.dose, doc.doseAr).joinToString(" ")),
            )
        }
        .sortedBy { it.name.lowercase() }

    val catalogPicks = DrugCatalog.ALL.mapNotNull { drug ->
        val doc = overrides[drug.id]
        if (doc?.hidden == true) return@mapNotNull null
        val name = doc?.name?.trim().orEmpty().ifBlank { drug.name }
        // An override supplies the doses whatever they are, blank included: a dentist who cleared
        // the Arabic line meant to clear it, and quietly restoring ours would undo the edit.
        val shownDose = if (doc != null) doc.dose else drug.doseEn
        val shownDoseAr = if (doc != null) doc.doseAr else drug.doseAr
        DrugPick(
            name = name,
            dose = shownDose,
            doseAr = shownDoseAr,
            noteEn = drug.noteEn,
            noteAr = drug.noteAr,
            cautionEn = drug.cautionEn,
            cautionAr = drug.cautionAr,
            haystack = DrugCatalog.normalize(
                (
                    listOf(
                        name,
                        shownDose,
                        shownDoseAr,
                        drug.descEn,
                        drug.descAr,
                        DrugCatalog.categoryLabel(drug.cat, arabic = false),
                        DrugCatalog.categoryLabel(drug.cat, arabic = true),
                    ) + drug.keywords
                ).joinToString(" ")
            ),
        )
    }

    return ownPicks + catalogPicks
}

/**
 * Every whitespace-separated term must appear somewhere in the row, in any order, so "aug 1" and
 * "مضاد حيوي حساسيه" both land. An empty query returns the list untouched.
 *
 * Both sides of the comparison go through the catalog's normaliser, which is why an Arabic query
 * typed with a plain alef finds a drug written with a hamza — a plain `contains` on the raw text
 * would miss most of what a dentist actually types.
 */
fun searchDrugPicks(picks: List<DrugPick>, query: String): List<DrugPick> {
    val q = DrugCatalog.normalize(query)
    if (q.isEmpty()) return picks
    val terms = q.split(" ").filter { it.isNotEmpty() }
    return picks.filter { pick -> terms.all { pick.haystack.contains(it) } }
}
