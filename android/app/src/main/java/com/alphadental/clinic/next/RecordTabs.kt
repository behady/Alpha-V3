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

    if (planned.isNotEmpty()) {
        item { SectionLabel("Planned · ${planned.size}") }
        item {
            RowGroup {
                planned.forEachIndexed { i, note ->
                    if (i > 0) Rule()
                    NoteRow(note, state, onSetStatus)
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
                    NoteRow(note, state, onSetStatus)
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
) {
    val planned = note.status == "Planned"

    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
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
 * The prescriptions already written for this patient.
 *
 * Read-only, and that is the whole job: the phone writes a script from the More
 * menu, and a dentist about to write another one needs to see what the patient is
 * already taking first.
 */
fun LazyListScope.scripts(state: RecordState, onWrite: (() -> Unit)?) {
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
                }
            }
            Spacer(Modifier.height(8.dp))
        }
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
                options.forEach { option ->
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
private fun noteDate(key: String): String {
    val d = runCatching {
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(key)
    }.getOrNull() ?: return key
    return java.text.SimpleDateFormat("d MMM", java.util.Locale.US).format(d)
}
