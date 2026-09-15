package com.alphadental.clinic.next

import androidx.compose.foundation.clickable
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
import com.alphadental.clinic.data.TreatmentPlans
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** What the treatment-plan sheet can do. */
data class PlanActions(
    val startDraft: () -> Unit,
    val cancelDraft: () -> Unit,
    val search: (String) -> Unit,
    val addStep: (com.alphadental.clinic.data.Service?, String) -> Unit,
    val setTeeth: (String, String) -> Unit,
    val setQuantity: (String, Int) -> Unit,
    val setPrice: (String, Double) -> Unit,
    val setVisit: (String, Int) -> Unit,
    val removeStep: (String) -> Unit,
    val setTitle: (String) -> Unit,
    val setDescription: (String) -> Unit,
    val setDoctor: (String) -> Unit,
    val setStatus: (String, String) -> Unit,
    val save: () -> Unit,
    val close: () -> Unit,
)

/**
 * The plan put to the patient.
 *
 * Two screens in one sheet: the plans already on the file, and — once somebody
 * taps New — the one being drawn up. They are the same sheet because they are
 * the same conversation, and a dentist who has just finished listing the work
 * should not have to find their way back to show it.
 */
@Composable
fun PlanSheet(state: Plans, actions: PlanActions) {
    val patient = state.patient ?: return

    Sheet(
        title = if (state.isDrafting) "New plan" else "Treatment plans",
        caption = if (state.isDrafting && state.total > 0) {
            "${patient.name} · ${state.total.toLong()} EGP"
        } else {
            patient.name
        },
        busy = state.saving,
        error = state.error,
        action = if (state.isDrafting) "Save plan" else "Close",
        ready = if (state.isDrafting) state.ready && state.canWrite else true,
        onAction = if (state.isDrafting) actions.save else actions.close,
        onDismiss = if (state.isDrafting) actions.cancelDraft else actions.close,
    ) {
        if (state.isDrafting) PlanDraft(state, actions) else PlanList(state, actions)
    }
}

@Composable
private fun PlanList(state: Plans, actions: PlanActions) {
    state.saved?.let {
        Txt(it, Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 10.dp))
    }

    if (state.loading) {
        Txt(
            "Reading the file…", Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
        )
    }

    state.existing.forEachIndexed { i, plan ->
        if (i > 0) Rule()
        Row(
            Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt(
                plan.title.ifBlank { "Treatment plan" },
                Type.rowName, T.ink, Modifier.weight(1f), maxLines = 2,
            )
            Spacer(Modifier.width(10.dp))
            Txt("${plan.total.toLong()} EGP", Type.label, T.ink)
        }
        Txt(
            listOf(
                TreatmentPlans.statusLabel(plan.status, arabic = false),
                "${plan.visits.size} visit" + if (plan.visits.size == 1) "" else "s",
                plan.doctorName,
            ).filter { it.isNotBlank() }.joinToString(" · "),
            Type.caption, T.inkMuted,
            Modifier.padding(start = T.gutter, end = T.gutter, top = 2.dp),
            maxLines = 2,
        )

        if (state.canWrite) {
            SheetChoices("Mark it") {
                TreatmentPlans.STATUSES.forEach { status ->
                    SheetChoice(
                        TreatmentPlans.statusLabel(status, arabic = false),
                        plan.status == status,
                    ) { if (plan.status != status) actions.setStatus(plan.id, status) }
                }
            }
        }
        Spacer(Modifier.height(6.dp))
    }

    if (state.existing.isEmpty() && !state.loading) {
        Txt(
            "No plan on this file yet.",
            Type.body, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
        )
    }

    if (state.canWrite) {
        Rule()
        SheetAction("Draw up a new plan", "Pick the work, split it into visits", actions.startDraft)
    }

    Txt(
        // The boundary, said once. Nothing here touches money.
        "A plan is what you propose, not what you charge. Nothing is billed until the treatment " +
            "is recorded as done.",
        Type.caption, T.inkFaint,
        Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
        maxLines = 3,
    )
}

@Composable
private fun PlanDraft(state: Plans, actions: PlanActions) {
    SheetField("Call it", state.title, actions.setTitle, hint = "Upper arch, stage one")

    val lines = state.draft.orEmpty()
    lines.forEachIndexed { i, line ->
        if (i > 0) Rule()
        Row(
            Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt(line.name, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 2)
            Spacer(Modifier.width(10.dp))
            Txt("${line.total.toLong()}", Type.label, T.ink)
            Spacer(Modifier.width(12.dp))
            Txt("Remove", Type.caption, T.danger, Modifier.clickable { actions.removeStep(line.id) })
        }

        SheetField("Teeth", line.teeth, { actions.setTeeth(line.id, it) }, hint = "16, 17")
        SheetField(
            "Price each",
            if (line.unitPrice > 0) line.unitPrice.toLong().toString() else "",
            { actions.setPrice(line.id, it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
            numeric = true,
            hint = "0",
        )
        SheetChoices("How many") {
            listOf(1, 2, 3, 4, 6, 8).forEach { n ->
                SheetChoice("$n", line.quantity == n) { actions.setQuantity(line.id, n) }
            }
        }
        SheetChoices("In which visit") {
            // One more than the highest used, so a plan can always grow by one
            // appointment but never sprout ten empty ones.
            val highest = lines.maxOfOrNull { it.visit } ?: 1
            (1..(highest + 1)).forEach { n ->
                SheetChoice("Visit $n", line.visit == n) { actions.setVisit(line.id, n) }
            }
        }
        Spacer(Modifier.height(8.dp))
    }

    if (lines.isNotEmpty()) Rule()

    SheetField("Add a treatment", state.query, actions.search, hint = "Crown, root canal")

    if (state.query.trim().length >= 2 || lines.isEmpty()) {
        state.matches.forEach { service ->
            Rule()
            SheetAction(
                service.name,
                if (service.price > 0) "${service.price.toLong()} EGP" else "No price set",
            ) { actions.addStep(service, "") }
        }
        state.query.trim().takeIf { it.length >= 2 }?.let { typed ->
            Rule()
            SheetAction("Add \"$typed\"", "Not on the price list") { actions.addStep(null, typed) }
        }
    }

    Rule()
    SheetField("Notes for the patient", state.description, actions.setDescription, lines = 2, hint = "")

    if (state.doctors.isNotEmpty()) {
        SheetChoices("Proposed by") {
            state.doctors.forEach { name ->
                SheetChoice(name, state.doctor == name) { actions.setDoctor(name) }
            }
        }
    }

    if (state.visits.size > 1) {
        Txt(
            "${state.visits.size} visits, ${state.total.toLong()} EGP in total.",
            Type.caption, T.accentInk,
            Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
        )
    }

    Txt(
        "Saved as a draft. Mark it presented once you have shown it to them.",
        Type.caption, T.inkFaint,
        Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
        maxLines = 2,
    )
}
