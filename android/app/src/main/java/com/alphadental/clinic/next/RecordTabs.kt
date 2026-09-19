package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.data.ClinicalNote
import com.alphadental.clinic.data.Prescription
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * The clinical record: what has been done to this patient, and what is planned.
 *
 * This is the list the file was missing. Recording a treatment wrote the note and
 * its ledger row correctly, but nothing on the phone ever showed the note back —
 * so the act of recording looked, to whoever pressed the button, exactly like
 * nothing happening.
 *
 * Planned work sits at the top on purpose. It is the only part of a patient's
 * file that is a to-do list rather than a history.
 */
fun LazyListScope.treatments(
    state: RecordState,
    onSetStatus: (String, String) -> Unit,
    onAdd: (() -> Unit)?,
    /** Null when this account may not change what is on the record. Rows are then inert. */
    onEdit: ((ClinicalNote) -> Unit)? = null,
) {
    val planned = state.planned
    val done = state.notes.filterNot { it.status == "Planned" }

    if (onAdd != null) {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                SettingsPill("Record a treatment", solid = true, onClick = onAdd)
            }
        }
    }

    if (onEdit != null && state.notes.isNotEmpty()) {
        item {
            Txt(
                "Tap a treatment to change what was done, its price or its dentist.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 4.dp),
                maxLines = 2,
            )
        }
    }

    if (planned.isNotEmpty()) {
        item { SectionLabel("Planned · ${planned.size}") }
        item {
            RowGroup {
                planned.forEachIndexed { i, note ->
                    if (i > 0) Rule()
                    NoteRow(note, state, onSetStatus, onEdit)
                }
            }
        }
    }

    if (done.isNotEmpty()) {
        item { SectionLabel("Done · ${done.size}") }
        item {
            RowGroup {
                done.forEachIndexed { i, note ->
                    if (i > 0) Rule()
                    NoteRow(note, state, onSetStatus, onEdit)
                }
            }
        }
    }

    if (state.notes.isEmpty()) {
        item {
            SettingsEmpty(
                if (onAdd == null) {
                    "Nothing has been recorded on this file."
                } else {
                    "Nothing recorded yet. The button above writes the treatment and its charge together."
                },
            )
        }
    }
}

@Composable
private fun NoteRow(
    note: ClinicalNote,
    state: RecordState,
    onSetStatus: (String, String) -> Unit,
    onEdit: ((ClinicalNote) -> Unit)?,
) {
    val planned = note.status == "Planned"

    Column(
        Modifier
            .fillMaxWidth()
            .then(if (onEdit == null) Modifier else Modifier.clickable { onEdit(note) })
            .padding(horizontal = T.gutter, vertical = 13.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt(
                note.procedure.ifBlank { "Treatment" },
                Type.rowName, T.ink, Modifier.weight(1f), maxLines = 2,
            )
            if (note.cost > 0) {
                Spacer(Modifier.width(10.dp))
                // The same ink whether planned or done, because the money is the
                // same either way: this system writes the ledger row when the
                // treatment is recorded, not when it is marked finished. Fading a
                // planned price would suggest it had not been charged yet.
                Txt(note.cost.toLong().toString(), Type.label.copy(fontSize = 13.sp), T.ink)
            }
        }

        val detail = listOf(
            noteDate(note.date),
            note.tooth.takeIf { it.isNotBlank() }?.let { "tooth $it" }.orEmpty(),
            note.doctor,
        ).filter { it.isNotBlank() }
        if (detail.isNotEmpty()) {
            Spacer(Modifier.height(2.dp))
            Txt(detail.joinToString(" · "), Type.caption, T.inkMuted, maxLines = 2)
        }

        if (note.note.isNotBlank()) {
            Spacer(Modifier.height(4.dp))
            Txt(note.note, Type.caption, T.inkMuted, maxLines = 6)
        }

        if (state.canRecord) {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.busyNote == note.id) {
                    Txt("Saving…", Type.caption, T.inkMuted)
                } else if (planned) {
                    SettingsPill("Mark done", solid = true) { onSetStatus(note.id, "Completed") }
                } else {
                    SettingsPill("Back to planned") { onSetStatus(note.id, "Planned") }
                }
                // A button, not just a tappable row. A whole card that quietly responds to a tap
                // is a thing people find by accident or never.
                onEdit?.let { edit -> SettingsPill("Edit") { edit(note) } }
            }
        } else if (planned) {
            Spacer(Modifier.height(4.dp))
            Txt("Planned", Type.caption, T.warn)
        }

        if (planned && note.cost > 0) {
            Spacer(Modifier.height(6.dp))
            Txt(
                // Said out loud, because it surprises people: the charge went on
                // when this was recorded, not when it gets marked done. Marking it
                // done moves no money.
                "Already on the account. Marking it done does not change what is owed.",
                Type.caption, T.inkFaint, maxLines = 2,
            )
        }
    }
}

/**
 * The account, as a statement.
 *
 * The old tab was two lists — everything charged, then everything paid — which
 * answers neither of the questions anybody brings to a patient's money: what
 * happened, in order, and where does that leave them. A statement answers both:
 * one line per event, newest first, with the balance after each one down the
 * right-hand side. That running figure is the column a receptionist's finger
 * follows.
 */
fun LazyListScope.statement(
    state: RecordState,
    onTakePayment: (() -> Unit)?,
    /** Null when this account may not correct the books. The rows then do not react to a tap. */
    onEditRow: ((com.alphadental.clinic.next.data.Money) -> Unit)? = null,
) {
    val record = state.record ?: return
    val rows = record.ledger.filterNot { it.isExpense }

    item {
        val b = record.balance
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Figure("Charged", b.charged, Modifier.weight(1f))
            Figure("Paid", b.paid, Modifier.weight(1f))
            Figure(
                if (b.credit > 0) "In credit" else "Owed",
                if (b.credit > 0) b.credit else b.owed,
                Modifier.weight(1f),
                strong = true,
            )
        }
    }

    if (onEditRow != null) {
        item {
            Txt(
                // Said once, quietly, rather than putting a pencil on forty rows.
                if (state.canEditLedger) "Tap any line to see its detail or correct it." else "Tap any line to see its detail.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 4.dp),
            )
        }
    }

    if (onTakePayment != null && record.balance.owed > 0) {
        item {
            Row(Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, bottom = 10.dp)) {
                SettingsPill("Take a payment", solid = true, onClick = onTakePayment)
            }
        }
    }

    if (rows.isEmpty()) {
        item { SettingsEmpty("Nothing has been charged to this patient.") }
        return
    }

    // Oldest first to accumulate, then shown newest first: the balance beside a
    // row is the balance AFTER it, which is the number that is true today for
    // the top row and was true on that day for every row below.
    // Rows carry a day, not a time. On one day the charge is taken to have
    // come before the payment for it — that is the order things happen in a
    // clinic — so the balance beside the payment is the one after it.
    val ordered = rows.sortedWith(compareBy<com.alphadental.clinic.next.data.Money>({ it.date }, { !it.isCharge }, { it.id }))
    var running = 0.0
    val withBalance = ordered.map { m ->
        running += if (m.isCharge) m.amount else -m.amount
        m to running
    }.asReversed()

    withBalance.groupBy { (m, _) -> m.date.take(7) }.forEach { (month, group) ->
        item(key = "st-$month") { SectionLabel(monthName(month)) }
        item(key = "sg-$month") {
            RowGroup {
                group.forEachIndexed { i, (m, after) ->
                    if (i > 0) Rule()
                    StatementRow(m, after, onEditRow)
                }
            }
        }
    }
}

@Composable
private fun Figure(label: String, amount: Double, modifier: Modifier, strong: Boolean = false) {
    Column(modifier) {
        Txt(label, Type.eyebrow, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(3.dp))
        Txt(
            amount.toLong().toString(),
            if (strong) Type.heading else Type.label.copy(fontSize = 15.sp),
            if (strong && amount > 0) T.ink else T.inkMuted,
            maxLines = 1,
        )
    }
}

@Composable
private fun StatementRow(
    m: com.alphadental.clinic.next.data.Money,
    after: Double,
    onEdit: ((com.alphadental.clinic.next.data.Money) -> Unit)?,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onEdit == null) Modifier else Modifier.clickable { onEdit(m) })
            .padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // A thin mark rather than a coloured amount: payments and charges are
        // told apart by which column they sit in, the way a bank statement does
        // it, and the colour is kept for the one figure that matters.
        Box(
            Modifier
                .width(3.dp)
                .height(34.dp)
                .background(if (m.isCharge) T.line else T.ok, T.pill),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Txt(
                m.description.ifBlank { if (m.isCharge) "Treatment" else "Payment" },
                Type.rowName, T.ink, maxLines = 2,
            )
            Spacer(Modifier.height(2.dp))
            Txt(
                listOf(
                    noteDate(m.date),
                    m.method,
                    m.doctor,
                    // Who took the money, on a payment. On a charge the dentist above already says whose work it was.
                    if (m.isPayment && m.by.isNotBlank()) "taken by ${m.by}" else "",
                ).filter { it.isNotBlank() }.joinToString(" · "),
                Type.caption, T.inkMuted, maxLines = 2,
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            Txt(
                (if (m.isCharge) "" else "−") + m.amount.toLong().toString(),
                Type.label.copy(fontSize = 14.sp),
                if (m.isCharge) T.ink else T.ok,
            )
            Spacer(Modifier.height(2.dp))
            Txt(
                if (after > 0) "owes ${after.toLong()}" else if (after < 0) "credit ${(-after).toLong()}" else "settled",
                Type.caption, T.inkFaint, maxLines = 1,
            )
        }
    }
}

private fun monthName(yyyyMm: String): String {
    val d = runCatching {
        java.text.SimpleDateFormat("yyyy-MM", java.util.Locale.US).parse(yyyyMm)
    }.getOrNull() ?: return yyyyMm.ifBlank { "Undated" }
    return java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale.US).format(d)
}

/**
 * The prescriptions already written for this patient.
 *
 * Read-only, and that is the whole job: the phone writes a script from the More
 * menu, and a dentist about to write another one needs to see what the patient is
 * already taking first.
 */
fun LazyListScope.scripts(
    state: RecordState,
    onWrite: (() -> Unit)?,
    onPrint: (Prescription) -> Unit = {},
    onShare: (Prescription) -> Unit = {},
    onSend: (Prescription) -> Unit = {},
    onCopy: ((Prescription) -> Unit)? = null,
) {
    if (onWrite != null) {
        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                SettingsPill("Write a prescription", solid = true, onClick = onWrite)
            }
        }
    }

    if (state.scripts.isEmpty()) {
        item { SettingsEmpty("No prescription has been written for this patient.") }
        return
    }

    state.scripts.forEachIndexed { index, script ->
        item(key = "rx-${script.id}") {
            RowGroup {
                Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
                    Txt(
                        listOf(noteDate(script.date), script.doctor)
                            .filter { it.isNotBlank() }.joinToString(" · "),
                        Type.caption, T.inkMuted, maxLines = 1,
                    )
                    if (script.diagnosis.isNotBlank()) {
                        Spacer(Modifier.height(3.dp))
                        Txt(script.diagnosis, Type.rowName, T.ink, maxLines = 2)
                    }
                    script.drugs.forEach { drug ->
                        Spacer(Modifier.height(8.dp))
                        Txt(drug.name, Type.body, T.ink, maxLines = 2)
                        listOf(drug.dose, drug.doseAr, drug.note)
                            .filter { it.isNotBlank() }
                            .forEach { line ->
                                Spacer(Modifier.height(2.dp))
                                Txt(line, Type.caption, T.inkMuted, maxLines = 3)
                            }
                    }

                    Spacer(Modifier.height(12.dp))
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (state.busyScript == script.id) {
                            Txt("Working…", Type.caption, T.inkMuted)
                        } else {
                            SettingsPill("WhatsApp", solid = true) { onSend(script) }
                            SettingsPill("Share PDF") { onShare(script) }
                            SettingsPill("Print") { onPrint(script) }
                            // A prescription once issued is not rewritten — the
                            // pharmacy may already hold it. What a dentist wants
                            // on the second visit is the same script again with
                            // one line changed, which is a new one.
                            onCopy?.let { SettingsPill("Write again") { it(script) } }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    item {
        Txt(
            "A prescription is not edited once written — a pharmacy may already hold it. " +
                "\"Write again\" opens a new one with the same medicines, to change and issue.",
            Type.caption, T.inkFaint,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}

/**
 * Charting a tooth.
 *
 * The same catalogue the website charts from, grouped by category and coloured
 * the same way, because a chart learned on one screen has to be the same chart on
 * the other. A tooth can carry several conditions at once — "previously treated"
 * and "secondary caries" live together constantly — so these are ticks rather
 * than a single choice.
 */
@Composable
fun ToothSheet(
    state: RecordState,
    onToggle: (String) -> Unit,
    onNote: (String) -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tooth = state.charting ?: return

    Sheet(
        title = "Tooth ${tooth.number}",
        caption = if (tooth.statuses.isEmpty()) "Nothing recorded" else "${tooth.statuses.size} recorded",
        busy = state.savingTooth,
        error = state.error,
        action = if (tooth.statuses.isEmpty() && tooth.notes.isBlank()) "Clear this tooth" else "Save",
        ready = state.canRecord,
        onAction = onSave,
        onDismiss = onDismiss,
    ) {
        if (!state.canRecord) {
            Txt(
                "This account can read the chart but not change it.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 2,
            )
            return@Sheet
        }

        com.alphadental.clinic.data.DIAGNOSIS_CATEGORIES.forEach { category ->
            val options = com.alphadental.clinic.data.DIAGNOSIS_OPTIONS
                .filter { it.category == category.id }
            if (options.isEmpty()) return@forEach

            Row(
                Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // The category's own colour, as a dot. It is the colour the tooth
                // turns on the chart, so the two are learned together.
                Box(Modifier.size(9.dp).background(category.color, T.pill))
                Spacer(Modifier.width(8.dp))
                Txt(category.en, Type.eyebrow, T.inkFaint, uppercase = true)
            }
            SheetChoices("") {
                // Ticked first. These rows scroll sideways, and a condition
                // already recorded that sits four chips off the right-hand edge
                // is a condition nobody can see they recorded.
                options
                    .sortedByDescending { it.id in tooth.statuses }
                    .forEach { option ->
                        SheetChoice(option.en, option.id in tooth.statuses) { onToggle(option.id) }
                    }
            }
        }

        SheetField("Note on this tooth", tooth.notes, onNote, lines = 2, hint = "")

        Txt(
            "Clearing every tick and the note removes this tooth from the chart, rather than " +
                "leaving it recorded as nothing.",
            Type.caption, T.inkFaint,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}

/** Who the patient is, as opposed to what has been done to them. */
@Composable
fun DetailsSheet(
    state: RecordState,
    onSave: (String, String, String, String, String, String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val record = state.record ?: return

    var name by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.person.name)
    }
    var phone by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.person.phone)
    }
    var dob by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.dateOfBirth)
    }
    var gender by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.gender)
    }
    var allergies by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.allergies)
    }
    var history by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.medicalHistory)
    }
    var address by androidx.compose.runtime.remember(record) {
        androidx.compose.runtime.mutableStateOf(record.address)
    }

    Sheet(
        title = "Patient details",
        caption = record.fileId.ifBlank { record.person.name },
        busy = state.savingDetails,
        error = state.detailsError,
        action = "Save",
        ready = name.isNotBlank() && state.canEditDetails,
        onAction = { onSave(name, phone, dob, gender, allergies, history, address) },
        onDismiss = onDismiss,
    ) {
        if (!state.canEditDetails) {
            Txt(
                "This account can open patient files but not change who is on them.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 3,
            )
            return@Sheet
        }

        SheetField("Name", name, { name = it }, hint = "Mariam Hassan")
        SheetField("Phone", phone, { phone = it }, hint = "+20 100 000 0000")
        SheetField("Date of birth", dob, { dob = it }, hint = "1990-04-18")

        SheetChoices("Gender") {
            listOf("Male", "Female").forEach { g ->
                SheetChoice(g, gender.equals(g, ignoreCase = true)) {
                    gender = if (gender.equals(g, ignoreCase = true)) "" else g
                }
            }
        }

        SheetField("Address", address, { address = it }, lines = 2, hint = "")

        SheetField("Allergies", allergies, { allergies = it }, lines = 2, hint = "Penicillin")
        Txt(
            // The one field on this form that can hurt somebody.
            "Left blank this reads as \"nobody has asked\", which is what the file will say. It " +
                "does not mean none.",
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
            maxLines = 3,
        )

        SheetField("Medical history", history, { history = it }, lines = 3, hint = "Diabetic, on warfarin")

        Txt(
            "The file number is issued once by the clinic and cannot be changed here.",
            Type.caption, T.inkFaint,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 2,
        )
    }
}

/** "2026-09-15" as "15 Sep". Anything unparseable is shown as stored. */
fun noteDate(key: String): String {
    val d = runCatching {
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(key)
    }.getOrNull() ?: return key
    return java.text.SimpleDateFormat("d MMM", java.util.Locale.US).format(d)
}
