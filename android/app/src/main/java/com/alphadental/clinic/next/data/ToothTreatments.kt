package com.alphadental.clinic.next.data

import androidx.compose.ui.graphics.Color
import com.alphadental.clinic.data.ClinicalNote
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.ui.DentalIcons

/**
 * What has been DONE to a tooth, as distinct from what is wrong with it.
 *
 * A copy of the website's `src/lib/toothTreatments.ts`, kept in step by hand. The chart used to
 * show only diagnoses — a red tooth meant caries and stayed red after the filling — so the owner
 * asked for the work itself to show. The website answers that with two channels: a treatment
 * that changes the tooth's FORM (extracted, implant, crown, veneer) replaces the artwork, and one
 * that is a MARK (root canal, filling, gum treatment, anything else) is drawn over it. A tooth
 * can carry one of each: root-filled and then crowned is both.
 *
 * States are decided from the service's category on the price list, never from the procedure's
 * wording, so "Composite Filling" and "حشو كمبوزيت" land on the same mark. A hand-typed procedure
 * that matches no price-list entry falls back to the same keyword guess the price list uses when
 * a service is created — without that, a clinic that types instead of picks sees an empty chart.
 */
enum class TreatmentState(
    val label: String,
    /** "form" replaces the tooth's own artwork; "mark" draws over it. */
    val form: Boolean,
    val colour: Color,
    /** Higher wins when a tooth carries several of the same channel. */
    val precedence: Int,
) {
    // The legend swatch is the material the chart paints: gutta-percha pink for a root canal,
    // porcelain for a crown, composite for a filling, titanium for an implant. A dentist reads
    // the chart the way they read a mouth, and a filled tooth is not blue in a mouth.
    Extracted("Extracted", form = true, colour = Color(0xFF334155), precedence = 100),
    Implant("Implant", form = true, colour = Color(0xFF9CA3AF), precedence = 90),
    Crowned("Crown", form = true, colour = Color(0xFFCBD5E1), precedence = 80),
    Veneered("Veneer", form = true, colour = Color(0xFFE2E8F0), precedence = 70),
    RootCanal("Root canal", form = false, colour = Color(0xFFE26B7A), precedence = 60),
    Filled("Filling", form = false, colour = Color(0xFFA69C82), precedence = 50),
    Perio("Gum treatment", form = false, colour = Color(0xFF0891B2), precedence = 40),
    Treated("Treated", form = false, colour = Color(0xFF64748B), precedence = 10),
}

/** One thing that happened to one tooth. */
data class ToothTreatment(
    val state: TreatmentState,
    val noteId: String,
    val procedure: String,
    /** Planned, Ongoing or Completed. Only Completed and Ongoing are drawn as done. */
    val status: String,
    val date: String,
) {
    val done: Boolean get() = status == "Completed" || status == "Ongoing"
}

/** What the chart draws for one tooth, after precedence. */
data class ToothMarks(
    val form: TreatmentState? = null,
    val mark: TreatmentState? = null,
    /** The winning procedures as written, so the drawing can tell zirconia from PFM, composite from amalgam. */
    val formProcedure: String = "",
    val markProcedure: String = "",
    /** Work planned on this tooth and not yet done. Drawn as a dashed hint, never as done. */
    val pending: List<ToothTreatment> = emptyList(),
    val all: List<ToothTreatment> = emptyList(),
) {
    val any: Boolean get() = form != null || mark != null || pending.isNotEmpty()
}

object ToothTreatments {

    /** The website's table, verbatim. Categories that are not true of a single tooth map to nothing. */
    private val CATEGORY_TO_STATE: Map<String, TreatmentState?> = mapOf(
        "surgery" to TreatmentState.Extracted,
        "implants" to TreatmentState.Implant,
        "crowns" to TreatmentState.Crowned,
        "veneers" to TreatmentState.Veneered,
        "endo" to TreatmentState.RootCanal,
        "restorative" to TreatmentState.Filled,
        "perio" to TreatmentState.Perio,
        "pediatric" to TreatmentState.Treated,
        "other" to TreatmentState.Treated,
        "diagnostics" to null,
        "prevention" to null,
        "whitening" to null,
        "ortho" to null,
        "prostho" to null,
    )

    fun forCategory(category: String?): TreatmentState? =
        if (category.isNullOrBlank()) null else CATEGORY_TO_STATE[category]

    /**
     * Every treatment on every tooth, newest first within each tooth.
     *
     * A note naming several teeth and several procedures gives every one of those teeth every
     * state, because nothing records which tooth got which — when the states disagree, the honest
     * answer is the generic "treated" on each, exactly as the website does it.
     */
    fun byTooth(notes: List<ClinicalNote>, services: List<Service>): Map<Int, List<ToothTreatment>> {
        val categoryById = services.associate { it.id to it.category.ifBlank { DentalIcons.suggestCategory(it.name) } }
        val out = mutableMapOf<Int, MutableList<ToothTreatment>>()

        for (note in notes) {
            val teeth = (note.teeth.mapNotNull { it.trim().toIntOrNull() } +
                note.tooth.split(Regex("[,\\s]+")).mapNotNull { it.trim().toIntOrNull() })
                .filter { it in 11..18 || it in 21..28 || it in 31..38 || it in 41..48 }
                .distinct()
            if (teeth.isEmpty()) continue

            val ids = note.serviceIds.filter { it.isNotBlank() }
            val names = listOf(note.procedure).filter { it.isNotBlank() }
            val categories: List<String> = if (ids.isNotEmpty()) {
                ids.mapNotNull { categoryById[it] }
            } else {
                // The name guess never abstains — anything unknown comes back "other" — and a
                // guess with no evidence must not make a clinical assertion. Only a category a
                // human chose on the price list may say "treated" on its own.
                names.map { DentalIcons.suggestCategory(it) }.filter { it != "other" }
            }
            val states = categories.mapNotNull { forCategory(it) }.distinct()
            if (states.isEmpty()) continue
            val attributable = if (states.size == 1) states else listOf(TreatmentState.Treated)

            for (n in teeth) {
                val list = out.getOrPut(n) { mutableListOf() }
                for (s in attributable) {
                    list += ToothTreatment(s, note.id, note.procedure, note.status.ifBlank { "Planned" }, note.date)
                }
            }
        }
        return out.mapValues { (_, list) -> list.sortedByDescending { it.date } }
    }

    /** The form and the mark that win on one tooth, and what is still only planned. */
    fun resolve(entries: List<ToothTreatment>?): ToothMarks {
        if (entries.isNullOrEmpty()) return ToothMarks()
        val done = entries.filter { it.done }
        val formEntry = done.filter { it.state.form }.maxByOrNull { it.state.precedence }
        val markEntry = done.filter { !it.state.form }.maxByOrNull { it.state.precedence }
        return ToothMarks(
            form = formEntry?.state, mark = markEntry?.state,
            formProcedure = formEntry?.procedure.orEmpty(), markProcedure = markEntry?.procedure.orEmpty(),
            pending = entries.filter { !it.done }, all = entries,
        )
    }
}
