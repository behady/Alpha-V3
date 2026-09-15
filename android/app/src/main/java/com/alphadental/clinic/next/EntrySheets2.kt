package com.alphadental.clinic.next

import androidx.compose.foundation.layout.Column
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
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

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
    busy: Boolean,
    error: String?,
    onRecord: (String, List<String>, String, Double, Doctor?, Service?, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var service by remember { mutableStateOf<Service?>(null) }
    var procedure by remember { mutableStateOf("") }
    var price by remember { mutableStateOf("") }
    var teeth by remember { mutableStateOf(setOf<Int>()) }
    var doctor by remember { mutableStateOf(doctors.firstOrNull()) }
    var note by remember { mutableStateOf("") }
    var done by remember { mutableStateOf(true) }

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
        ready = procedure.isNotBlank(),
        onAction = { onRecord(procedure, teeth.map(Int::toString), note, unit, doctor, service, done) },
        onDismiss = onDismiss,
    ) {
        if (services.isNotEmpty()) {
            SheetChoices("From the price list") {
                services.take(24).forEach { s ->
                    SheetChoice(s.name, service?.id == s.id) {
                        if (service?.id == s.id) {
                            service = null
                        } else {
                            service = s
                            procedure = s.name
                            if (s.price > 0) price = s.price.toLong().toString()
                        }
                    }
                }
            }
        }

        SheetField("What was done", procedure, { procedure = it }, hint = "Composite filling")

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

        ToothPicker(teeth) { teeth = it }

        if (doctors.isNotEmpty()) {
            SheetChoices("Done by") {
                doctors.forEach { d ->
                    SheetChoice(d.name, doctor?.id == d.id) {
                        doctor = if (doctor?.id == d.id) null else d
                    }
                }
            }
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
 * Which teeth.
 *
 * FDI numbers in their four quadrants, upper row first, because that is how a
 * chart is read and how a dentist says them out loud. Typing "36, 37" would be
 * fewer pixels and more mistakes — and every one of those mistakes is a bill.
 */
@Composable
private fun ToothPicker(chosen: Set<Int>, onChange: (Set<Int>) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Txt(
            if (chosen.isEmpty()) "TEETH" else "TEETH · ${chosen.sorted().joinToString(", ")}",
            Type.eyebrow, T.inkFaint,
            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp, bottom = 4.dp),
            uppercase = true,
        )
        // 18 → 11, then 21 → 28. The patient's right is on the reader's left,
        // which is how a chart is drawn and how a dentist reads one out.
        listOf(
            UPPER_RIGHT + UPPER_LEFT,
            LOWER_RIGHT + LOWER_LEFT,
        ).forEach { row ->
            SheetChoices("") {
                row.forEach { number ->
                    SheetChoice(number.toString(), number in chosen) {
                        onChange(if (number in chosen) chosen - number else chosen + number)
                    }
                }
            }
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
