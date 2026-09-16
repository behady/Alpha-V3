package com.alphadental.clinic.next

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.next.data.DrugPick
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** Everything the prescription sheet can do, passed in one parcel. */
data class ScriptActions(
    val search: (String) -> Unit,
    val add: (DrugPick) -> Unit,
    val addTyped: (String) -> Unit,
    val setDose: (Int, String) -> Unit,
    val setDoseAr: (Int, String) -> Unit,
    val setNote: (Int, String) -> Unit,
    val remove: (Int) -> Unit,
    val setDiagnosis: (String) -> Unit,
    val setDoctor: (String) -> Unit,
    val save: () -> Unit,
    val close: () -> Unit,
)

/**
 * Writing a prescription.
 *
 * Search, tap, done: the doses arrive with the drug, because a dentist choosing
 * Augmentin already knows the dose and typing it out on a phone keyboard is how
 * a script gets written on paper instead.
 *
 * Both dose lines are editable, and the Arabic one is not optional decoration —
 * it is the line the patient reads. The sheet shows it as a field rather than
 * hiding it behind an expander for that reason.
 */
@Composable
fun PrescriptionSheet(state: Script, actions: ScriptActions) {
    val patient = state.patient ?: return

    Sheet(
        title = "Prescription",
        caption = patient.name,
        busy = state.saving,
        error = state.error,
        action = if (state.drugs.isEmpty()) "Save" else "Save ${state.drugs.size} medicine" +
            (if (state.drugs.size == 1) "" else "s"),
        ready = state.ready && state.canWrite,
        onAction = actions.save,
        onDismiss = actions.close,
    ) {
        if (!state.canWrite) {
            Txt(
                "This account can see the file but not write on it.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 2,
            )
            return@Sheet
        }

        state.drugs.forEachIndexed { i, line ->
            if (i > 0) Rule()
            Row(
                Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Txt(line.name, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 2)
                Spacer(Modifier.width(10.dp))
                Txt(
                    "Remove", Type.caption, T.danger,
                    Modifier.clickable { actions.remove(i) },
                )
            }
            SheetField("How to take it", line.dose, { actions.setDose(i, it) }, hint = "1 × 3 daily, 5 days")
            SheetField("In Arabic", line.doseAr, { actions.setDoseAr(i, it) }, hint = "قرص ٣ مرات يوميًا")
            SheetField("Note", line.note, { actions.setNote(i, it) }, hint = "After food")
            Spacer(Modifier.height(8.dp))
        }

        if (state.drugs.isNotEmpty()) Rule()

        SheetField(
            label = "Add a medicine",
            value = state.query,
            onChange = actions.search,
            hint = "Augmentin, مسكن, antibiotic",
        )

        if (state.loading) {
            Txt(
                "Fetching the clinic's list…", Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
            )
        }

        // Only once something has been typed. Dropping all 53 built-ins plus the
        // clinic's own into the sheet the moment it opens buries the lines
        // already written under a wall of medicines nobody asked for.
        if (state.query.trim().length >= 2) {
            val hits = state.matches
            if (hits.isEmpty()) {
                SheetAction(
                    "Add \"${state.query.trim()}\"",
                    "Not on any list — it will be written exactly as typed",
                ) { actions.addTyped(state.query) }
            } else {
                hits.take(8).forEach { pick ->
                    Rule()
                    SheetAction(
                        pick.name,
                        listOf(pick.dose, pick.doseAr).filter { it.isNotBlank() }.joinToString(" · "),
                    ) { actions.add(pick) }
                }
                Rule()
                SheetAction(
                    "Add \"${state.query.trim()}\" as typed",
                    "If none of the above is the one",
                ) { actions.addTyped(state.query) }
            }
        }

        Rule()

        SheetField("What for", state.diagnosis, actions.setDiagnosis, hint = "Acute pulpitis, upper left 6")

        if (state.doctors.isNotEmpty()) {
            SheetChoices("Prescribed by") {
                state.doctors.forEach { name ->
                    SheetChoice(name, state.doctor == name) { actions.setDoctor(name) }
                }
            }
        }

        Txt(
            // Said where somebody would otherwise hunt for a print button.
            "Saved to the patient's file. Printing it, or sending it on WhatsApp, is done on the " +
                "website — a phone has nowhere to print to.",
            Type.caption, T.inkFaint,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}
