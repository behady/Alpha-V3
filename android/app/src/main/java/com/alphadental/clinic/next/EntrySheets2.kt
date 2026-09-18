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
@Composable
fun TreatmentSheet(
    patientName: String,
    services: List<Service>,
    doctors: List<Doctor>,
    /** What is already charted on this patient, so the picker can show it. */
    charted: Map<Int, com.alphadental.clinic.next.data.Tooth> = emptyMap(),
    busy: Boolean,
    error: String?,
    onRecord: (String, List<String>, String, Double, Doctor?, Service?, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    // Kept across an accidental close, per patient: a half-recorded treatment must come back on
    // the file it was being written on, never on whoever's file is open next.
    val form = "$DRAFT_TREATMENT:$patientName"
    var procedure by draft(form, "procedure")
    var price by draft(form, "price")
    var note by draft(form, "note")
    // The chosen teeth and the chosen dentist are stored as ids and looked up again, because the
    // objects themselves come from lists that are reloaded every time the sheet opens.
    var toothText by draft(form, "teeth")
    var doctorId by draft(form, "doctor", doctors.firstOrNull()?.id.orEmpty())
    var serviceId by draft(form, "service")

    val teeth = remember(toothText) {
        toothText.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet()
    }
    val setTeeth = { next: Set<Int> -> toothText = next.sorted().joinToString(",") }
    val service = remember(serviceId, services) { services.firstOrNull { it.id == serviceId } }
    val doctor = remember(doctorId, doctors) { doctors.firstOrNull { it.id == doctorId } }

    var done by remember { mutableStateOf(true) }
    /** True while the search results are worth showing under the box. */
    var picking by remember { mutableStateOf(false) }

    val unit = price.toDoubleOrNull() ?: 0.0
    val mode = service?.pricingMode.orEmpty()
    // The same rule the repository bills by, shown before it is applied rather
    // than discovered on the ledger afterwards.
    val units = when {
        mode == "flat" -> 1
        mode == "per_arch" -> listOf(
            teeth.any { it in UPPER_RIGHT || it in UPPER_LEFT },
            teeth.any { it in LOWER_RIGHT || it in LOWER_LEFT },
        ).count { it }.coerceAtLeast(1)
        else -> teeth.size.coerceAtLeast(1)
    }
    val total = unit * units

    Sheet(
        title = "Record treatment",
        caption = patientName,
        busy = busy,
        error = error,
        action = if (total > 0) "Record and charge ${total.toLong()}" else "Record",
        // The server refuses a treatment with no dentist on it — it prices the work against that
        // person's commission — so the sheet asks for one rather than sending a request that
        // cannot succeed.
        ready = procedure.isNotBlank() && doctor != null,
        onAction = { onRecord(procedure, teeth.map(Int::toString), note, unit, doctor, service, done) },
        onDismiss = onDismiss,
    ) {
        // One box that both searches the price list and holds the answer.
        // A separate row of chips above a separate text field asked the same
        // question twice, and could only ever show the first two dozen prices —
        // a clinic with a hundred of them could not reach the rest.
        SheetField(
            label = "What was done",
            value = procedure,
            onChange = { typed ->
                procedure = typed
                // Typing over a chosen treatment un-chooses it: the price on the
                // line must not go on belonging to something no longer named.
                if (service != null && !typed.equals(service.name, ignoreCase = true)) serviceId = ""
                picking = true
            },
            hint = "Composite filling",
            // Tapping the box opens the price list. It used to take a typed letter, so anybody
            // who tapped it, saw nothing, and concluded there was no list was right about what
            // they saw and wrong about why.
            onFocus = { focused -> if (focused) picking = true },
            trailing = {
                Icon(
                    if (picking) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    if (picking) "Hide the price list" else "Show the price list",
                    tint = T.inkMuted,
                    modifier = Modifier
                        .clickable {
                            // Reopening after a treatment was chosen means changing the choice,
                            // so the chosen one is released rather than filtering the list down
                            // to itself.
                            if (!picking) serviceId = ""
                            picking = !picking
                        }
                        .padding(10.dp),
                )
            },
        )

        val needle = procedure.trim().lowercase()
        val matches = remember(needle, services, service) {
            when {
                needle.isEmpty() -> services
                // An exact hit means the name in the box IS the chosen treatment, so the list
                // under it would be one row repeating what is already typed.
                services.any { it.name.equals(needle, ignoreCase = true) } -> emptyList()
                else -> services.filter { it.name.lowercase().contains(needle) }
            }
        }

        if (picking) {
            if (services.isEmpty()) {
                Rule()
                Txt(
                    // Two very different problems that look identical from here, so both are named.
                    "No price list has loaded. Either nobody has added treatments in Settings → " +
                        "Prices yet, or this account cannot see them. You can still type what was " +
                        "done and set the price by hand.",
                    Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 4,
                )
            } else if (matches.isEmpty()) {
                Rule()
                Txt(
                    "Nothing on the price list matches that. It will be recorded exactly as typed, " +
                        "with whatever price you set below.",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 3,
                )
            } else {
                // Capped, but generously: the sheet scrolls, and a clinic with sixty prices was
                // able to reach eight of them.
                matches.take(40).forEach { s ->
                    Rule()
                    SheetAction(
                        s.name,
                        listOfNotNull(
                            if (s.price > 0) "${s.price.toLong()} EGP" else "No price set",
                            s.category.takeIf { it.isNotBlank() },
                        ).joinToString(" · "),
                    ) {
                        serviceId = s.id
                        procedure = s.name
                        if (s.price > 0) price = s.price.toLong().toString()
                        picking = false
                    }
                }
                Rule()
                Txt(
                    "Or leave it typed as it is — a treatment that is not on the price list is still " +
                        "recorded, it just brings no price with it.",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                    maxLines = 3,
                )
            }
        }

        service?.let { chosen ->
            Txt(
                "From the price list: ${chosen.name}" +
                    (if (chosen.price > 0) " · lists at ${chosen.price.toLong()}" else ""),
                Type.caption, T.accentInk,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                maxLines = 2,
            )
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
                "$units × ${unit.toLong()} = ${total.toLong()}. " +
                    when (mode) {
                        "per_arch" -> "This treatment is charged per arch."
                        else -> "This treatment is charged per tooth."
                    },
                Type.caption, T.accentInk,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                maxLines = 2,
            )
        }
        if (unit <= 0) {
            Txt(
                // Not an error: a review appointment genuinely costs nothing, and
                // the website writes no ledger row for one either.
                "At zero this is recorded as a note with no charge — a follow-up or a review.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                maxLines = 2,
            )
        }

        ToothPicker(teeth, charted, setTeeth)

        if (doctors.isNotEmpty()) {
            SheetChoices("Done by") {
                doctors.forEach { d ->
                    SheetChoice(d.name, doctor?.id == d.id) { doctorId = d.id }
                }
            }
            if (doctor == null) {
                Txt(
                    "Choose who did it. The charge is worked out against that dentist's rate, so " +
                        "there is no way to record this without one.",
                    Type.caption, T.warn,
                    Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                    maxLines = 3,
                )
            }
        } else {
            Txt(
                "Nobody in this clinic is marked as a dentist, so there is nobody to attribute " +
                    "this to. Add one under Settings → Dentists first.",
                Type.caption, T.danger,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }

        SheetChoices("Status") {
            SheetChoice("Done", done) { done = true }
            SheetChoice("Planned", !done) { done = false }
        }

        SheetField("Note", note, { note = it }, hint = "Anything worth remembering", lines = 2)

        doctor?.takeIf { it.commissionPercentage > 0 && total > 0 }?.let { d ->
            val labFee = service?.estimatedLabFee ?: 0.0
            val net = (total - labFee).coerceAtLeast(0.0)
            Txt(
                "${d.name} is on ${d.commissionPercentage.toLong()}%" +
                    (if (labFee > 0) ", after a lab fee of ${labFee.toLong()}" else "") +
                    " — about ${(net * d.commissionPercentage / 100.0).toLong()} on this.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        }
    }
}

/**
 * Which teeth — the mouth, not a row of numbers.
 *
 * The same chart the patient's file draws, with whatever is already charted on
 * each tooth still coloured underneath. Picking the teeth for a filling while
 * being able to see which of them are recorded as decayed is the entire reason a
 * dentist looks at a chart instead of reading out numbers.
 */
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
