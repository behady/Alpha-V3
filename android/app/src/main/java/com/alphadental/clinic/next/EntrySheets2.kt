package com.alphadental.clinic.next

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.next.data.LOWER_LEFT
import com.alphadental.clinic.next.data.LOWER_RIGHT
import com.alphadental.clinic.next.data.UPPER_LEFT
import com.alphadental.clinic.next.data.UPPER_RIGHT
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** Where a half-recorded treatment waits. Suffixed with the patient, and cleared once saved. */
const val DRAFT_TREATMENT = "treatment"

/**
 * Record what was done, and bill it.
 *
 * The price shown is the price for ONE tooth, and the sheet says the total it
 * will actually charge, because those two numbers differ for most treatments and
 * the difference is the whole bill. Four fillings is four times the money.
 */
/**
 * The website's New Procedure modal, under the name every caller already uses.
 *
 * The phone's own sheet — searchable box, per-tooth price, tooth picker, dentist, done/planned —
 * did the same job in a different order with different words. Two forms for one act is one too
 * many to learn; the desk's is the one people know.
 */
@Composable
fun TreatmentSheet(
    patientName: String,
    services: List<Service>,
    doctors: List<Doctor>,
    charted: Map<Int, com.alphadental.clinic.next.data.Tooth> = emptyMap(),
    busy: Boolean,
    error: String?,
    onRecord: (ProcedureDraft) -> Unit,
    onDismiss: () -> Unit,
) = NewProcedureSheet(patientName, services, doctors, charted, busy, error, onRecord, onDismiss)

@Composable
private fun ToothPicker(
    chosen: Set<Int>,
    charted: Map<Int, com.alphadental.clinic.next.data.Tooth>,
    onChange: (Set<Int>) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Txt(
            if (chosen.isEmpty()) "TEETH" else "TEETH · ${chosen.sorted().joinToString(", ")}",
            Type.eyebrow, T.inkFaint,
            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp, bottom = 2.dp),
            uppercase = true,
        )
        ToothPickerChart(chosen = chosen, teeth = charted) { number ->
            onChange(if (number in chosen) chosen - number else chosen + number)
        }
        if (chosen.isEmpty()) {
            Txt(
                "Leave empty for treatment that is not about one tooth — a cleaning, a consultation.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 6.dp),
                maxLines = 2,
            )
        }
        Spacer(Modifier.height(4.dp))
    }
}

/**
 * Move a lab case along.
 *
 * Only the stages the case can actually reach next, which is the website's own
 * table: a case at the lab can come back or be cancelled, one on the desk can be
 * fitted or sent back, and try-in stages appear only for a case that was marked
 * as needing one.
 */
@Composable
fun LabMoveSheet(
    case: LabCases.LabCase,
    busy: Boolean,
    error: String?,
    onMove: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var next by remember(case.id) { mutableStateOf<String?>(null) }
    val options = LabCases.nextStatuses(case.status, case.needsTryIn)

    Sheet(
        title = case.code.ifBlank { "Lab case" },
        caption = "${case.patientName} · now ${case.meta.en.lowercase()}",
        busy = busy,
        error = error,
        action = "Move",
        ready = next != null,
        onAction = { next?.let(onMove) },
        onDismiss = onDismiss,
    ) {
        if (options.isEmpty()) {
            Txt(
                "This case has nowhere left to go.",
                Type.body, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
            )
            return@Sheet
        }

        SheetChoices("Move it to") {
            options.forEach { id ->
                SheetChoice(LabCases.statusFor(id).en, next == id) { next = id }
            }
        }

        next?.let { id ->
            Txt(
                when (id) {
                    "back" -> "Marks it as arrived at the clinic today, and rings the clinic's " +
                        "bell if that alert is switched on."
                    "fitted" -> "Stamps today as the day it was fitted. That is the date the " +
                        "reports count."
                    "cancelled" -> "The case stays on the board as cancelled rather than " +
                        "disappearing — what was sent and why it stopped is worth keeping."
                    "returned_to_lab" -> "Sent back. The original arrival date is kept, so the " +
                        "history still reads in the order it happened."
                    else -> "Records the move against your name, with today's date."
                },
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 4,
            )
        }

    }
}

/** A line of money that did not come from a patient's file. */
@Composable
fun FinanceEntrySheet(
    busy: Boolean,
    error: String?,
    onAdd: (Boolean, Double, String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var income by remember { mutableStateOf(false) }
    var amount by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }

    val common = listOf("Materials", "Lab", "Salaries", "Rent", "Utilities", "Marketing", "Equipment")
    val value = amount.toDoubleOrNull() ?: 0.0

    Sheet(
        title = if (income) "Money in" else "Money out",
        caption = "Recorded against today",
        busy = busy,
        error = error,
        action = if (value > 0) "Record ${value.toLong()}" else "Record",
        ready = value > 0 && description.isNotBlank(),
        onAction = { onAdd(income, value, description, category) },
        onDismiss = onDismiss,
    ) {
        SheetChoices("Which way") {
            SheetChoice("Expense", !income) { income = false }
            SheetChoice("Income", income) { income = true }
        }

        SheetField(
            "Amount", amount,
            { amount = it.filter { c -> c.isDigit() || c == '.' } },
            numeric = true, hint = "0",
        )

        SheetField(
            "What it was", description, { description = it },
            hint = if (income) "Insurance settlement" else "Cairo Dental Lab · 3 crowns",
        )

        SheetChoices("Category") {
            common.forEach { c -> SheetChoice(c, category == c) { category = if (category == c) "" else c } }
        }

        SheetField("Or type one", category, { category = it }, hint = "General")

        Txt(
            if (income) {
                "Income counts as cash in on the day. A patient's payment does not belong here — " +
                    "take that on their file, so it settles the treatment it was for."
            } else {
                "An expense counts as cash out on the day, and appears in Reports under what the " +
                    "clinic spends on."
            },
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 4,
        )
    }
}

/**
 * Change a treatment that is already on the file, or take it off.
 *
 * The file could record work and never correct it. A price typed with a digit missing, the wrong
 * tooth, the wrong dentist, the same filling entered twice — all of them permanent, and all of them
 * things that happen at a chair between patients. The only buttons a recorded treatment had were
 * "Mark done" and "Back to planned", which change a word and no money.
 *
 * Saving reprices the whole thing on the server, exactly as recording it did: the charge behind it
 * moves with it, and the dentist's commission and the lab fee are worked out again from the new
 * figures. That is why every field is sent rather than the one that changed.
 */
@Composable
fun TreatmentEditSheet(
    note: com.alphadental.clinic.data.ClinicalNote,
    services: List<Service>,
    doctors: List<Doctor>,
    charted: Map<Int, com.alphadental.clinic.next.data.Tooth> = emptyMap(),
    busy: Boolean,
    error: String?,
    canDelete: Boolean,
    onSave: (String, List<String>, String, Double, Doctor?, String) -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    var procedure by remember(note.id) { mutableStateOf(note.procedure) }
    var price by remember(note.id) {
        // The PER-TOOTH price, which is what the server wants back. A note written before that
        // field existed only has its total, and dividing it by the teeth is the same sum the
        // server did on the way in.
        val unit = if (note.unitCost > 0) note.unitCost
        else note.cost / note.teeth.size.coerceAtLeast(1)
        mutableStateOf(if (unit > 0) unit.toLong().toString() else "")
    }
    var teeth by remember(note.id) {
        mutableStateOf(note.teeth.mapNotNull { it.trim().toIntOrNull() }.toSet())
    }
    var doctor by remember(note.id) {
        mutableStateOf(doctors.firstOrNull { it.id == note.doctorId })
    }
    var text by remember(note.id) { mutableStateOf(note.note) }
    var done by remember(note.id) { mutableStateOf(note.status != "Planned") }
    var picking by remember(note.id) { mutableStateOf(false) }
    /** Removing money asks twice. The first tap arms it, the second does it. */
    var armed by remember(note.id) { mutableStateOf(false) }

    val service = remember(procedure, services) {
        services.firstOrNull { it.name.equals(procedure.trim(), ignoreCase = true) }
    }
    val unit = price.toDoubleOrNull() ?: 0.0
    val units = when (service?.pricingMode.orEmpty()) {
        "flat" -> 1
        "per_arch" -> listOf(
            teeth.any { it in UPPER_RIGHT || it in UPPER_LEFT },
            teeth.any { it in LOWER_RIGHT || it in LOWER_LEFT },
        ).count { it }.coerceAtLeast(1)
        else -> teeth.size.coerceAtLeast(1)
    }
    val total = unit * units

    Sheet(
        title = "Change this treatment",
        caption = noteDate(note.date),
        busy = busy,
        error = error,
        action = if (total > 0) "Save · ${total.toLong()}" else "Save",
        // No dentist is a valid answer (General), so only the procedure is required.
        ready = procedure.isNotBlank(),
        onAction = {
            onSave(
                procedure, teeth.map(Int::toString), text, unit, doctor,
                if (done) "Completed" else "Planned",
            )
        },
        onDismiss = onDismiss,
    ) {
        SheetField(
            label = "What was done",
            value = procedure,
            onChange = { procedure = it; picking = true },
            hint = "Composite filling",
            onFocus = { focused -> if (focused) picking = true },
            trailing = if (services.isEmpty()) null else ({
                Icon(
                    if (picking) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    if (picking) "Hide the price list" else "Show the price list",
                    tint = T.inkMuted,
                    modifier = Modifier.clickable { picking = !picking }.padding(10.dp),
                )
            }),
        )

        if (picking && services.isNotEmpty()) {
            val needle = procedure.trim().lowercase()
            val matches = when {
                needle.isEmpty() -> services
                services.any { it.name.equals(needle, ignoreCase = true) } -> emptyList()
                else -> services.filter { it.name.lowercase().contains(needle) }
            }
            matches.take(40).forEach { s ->
                Rule()
                SheetAction(s.name, if (s.price > 0) "${s.price.toLong()} EGP" else "No price set") {
                    procedure = s.name
                    if (s.price > 0) price = s.price.toLong().toString()
                    picking = false
                }
            }
            if (matches.isNotEmpty()) Rule()
        }

        SheetField(
            label = if (units > 1) "Price for one tooth" else "Price",
            value = price,
            onChange = { price = it.filter { c -> c.isDigit() || c == '.' } },
            numeric = true,
            hint = "0 for a follow-up",
        )

        if (unit > 0 && units > 1) {
            Txt(
                "$units × ${unit.toLong()} = ${total.toLong()}.",
                Type.caption, T.accentInk,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                maxLines = 2,
            )
        }

        ToothPicker(teeth, charted) { teeth = it }

        if (doctors.isNotEmpty()) {
            SheetChoices("Done by") {
                // General: work the clinic did rather than a person. Saved the same way, and the
                // charge simply earns nobody a commission.
                SheetChoice("General", doctor == null) { doctor = null }
                doctors.forEach { d ->
                    SheetChoice(d.name, doctor?.id == d.id) { doctor = d }
                }
            }
            if (doctor == null) {
                Txt(
                    "No dentist on this treatment. It is charged to the clinic and earns nobody " +
                        "a commission.",
                    Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                    maxLines = 3,
                )
            }
        }

        SheetChoices("Status") {
            SheetChoice("Done", done) { done = true }
            SheetChoice("Planned", !done) { done = false }
        }

        SheetField("Note", text, { text = it }, hint = "Anything worth remembering", lines = 2)

        Txt(
            "Saving works the charge out again from these figures, so the money on the account " +
                "moves with the treatment.",
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
            maxLines = 3,
        )

        if (canDelete) {
            Rule()
            Txt(
                if (armed) "Tap again to remove it for good" else "Remove this treatment",
                Type.label.copy(fontSize = 13.sp),
                T.danger,
                Modifier
                    .clickable(enabled = !busy) { if (armed) onDelete() else armed = true }
                    .padding(horizontal = T.gutter, vertical = 16.dp),
            )
            Txt(
                "The charge behind it goes too. If money has already been paid against it the " +
                    "server refuses, and says so — the payment has to be removed first.",
                Type.caption, T.inkFaint,
                Modifier.padding(start = T.gutter, end = T.gutter, bottom = 14.dp),
                maxLines = 4,
            )
        }
    }
}

