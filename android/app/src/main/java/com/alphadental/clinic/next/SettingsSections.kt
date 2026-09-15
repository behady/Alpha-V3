package com.alphadental.clinic.next

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicSettings
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** One page of settings, chosen by [Section]. */
@Composable
fun SettingsSection(
    section: Section,
    state: SettingsState,
    onBack: () -> Unit,
    actions: SettingsActions,
) {
    BackHandler { onBack() }
    when (section) {
        Section.Clinic -> ClinicPage(state, onBack, actions)
        Section.Branches -> BranchesPage(state, onBack, actions)
        Section.Labs -> LabsPage(state, onBack, actions)
        Section.Area -> AreaPage(state, onBack, actions)
        Section.Hours -> HoursPage(state, onBack, actions)
        Section.Drugs -> DrugsPage(state, onBack, actions)
        Section.Deleted -> DeletedPage(state, onBack, actions)
        Section.Prices -> PricesPage(state, onBack, actions)
        Section.Recall -> RecallPage(state, onBack, actions)
        Section.Reasons -> ListPage(
            section, state, onBack,
            values = state.reasons,
            hint = "A reason reception can pick",
            note = "An empty dropdown gets skipped, after which no report can say why anyone came in.",
            onSave = actions.saveReasons,
        )
        Section.Sources -> ListPage(
            section, state, onBack,
            values = state.sources,
            hint = "Somewhere a patient could have heard of you",
            note = "Every figure on the marketing screens is counted from this list.",
            onSave = actions.saveSources,
        )
        Section.Team -> TeamPage(state, onBack, actions)
        Section.Requests -> RequestsPage(state, onBack, actions)
        Section.Booking -> BookingPage(state, onBack, actions)
        Section.Bot -> BotPage(state, onBack, actions)
        Section.Alerts -> AlertsPage(state, onBack, actions)
        Section.DentistHome -> DentistHomePage(state, onBack, actions)
        Section.Logs -> LogsPage(state, onBack)
        Section.Ai -> AiPage(state, onBack)
        Section.Memory -> MemoryPage(state, onBack, actions)
        Section.Interface -> InterfacePage(state, onBack, actions)
    }
}

// ---------------------------------------------------------------------------
// The clinic
// ---------------------------------------------------------------------------

@Composable
private fun ClinicPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.profile
    var form by remember(stored) { mutableStateOf(stored ?: ClinicSettings.ClinicProfile()) }

    SettingsPage(
        title = Section.Clinic.label,
        caption = "What goes on a receipt",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            RowGroup {
                SettingsField("Clinic name", form.name, { form = form.copy(name = it) }, state.canEdit)
                SettingsField("Lead doctor", form.doctorName, { form = form.copy(doctorName = it) }, state.canEdit)
                SettingsField("Phone", form.phone, { form = form.copy(phone = it) }, state.canEdit)
                SettingsField("Email", form.email, { form = form.copy(email = it) }, state.canEdit)
                SettingsField("Address", form.address, { form = form.copy(address = it) }, state.canEdit, lines = 2)
                SettingsField(
                    "Currency", form.currency, { form = form.copy(currency = it) }, state.canEdit,
                    hint = "EGP",
                )
            }
        }
        item {
            Txt(
                // Worth saying, because a currency box invites the opposite belief.
                "The currency is the label printed beside a number. Nothing is ever converted.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 2,
            )
        }

        item { SectionLabel("Prescription header") }
        item {
            RowGroup {
                SettingsField(
                    "Printed above every prescription",
                    form.rxHeader,
                    { form = form.copy(rxHeader = it) },
                    state.canEdit,
                    hint = "Clinic name\nAddress\nPhone",
                    lines = 4,
                )
            }
        }

        item { SettingsSave(dirty = form != stored, enabled = state.canEdit) { actions.saveProfile(form) } }
    }
}

/**
 * When the clinic is open.
 *
 * Not decoration: the diary builds its free-slot rows from these three numbers,
 * and the booking sheet refuses to offer any time at all until they are set,
 * because a nine-to-five guess offers times the clinic is shut.
 */
@Composable
private fun HoursPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.schedule
    var form by remember(stored) { mutableStateOf(stored ?: ClinicSettings.Schedule()) }

    SettingsPage(
        title = Section.Hours.label,
        caption = "What the diary offers",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            RowGroup {
                SettingsField(
                    "Opens at", form.start, { form = form.copy(start = it) }, state.canEdit,
                    hint = "09:00",
                )
                Rule()
                SettingsField(
                    "Closes at", form.end, { form = form.copy(end = it) }, state.canEdit,
                    hint = "21:00",
                )
            }
        }
        item {
            Txt(
                "Both in 24-hour time. A clinic that closes after midnight is understood: an end " +
                    "before the start rolls over to the next day.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        }

        item { SectionLabel("How long an appointment slot is") }
        item {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(10, 15, 20, 30, 45, 60).forEach { minutes ->
                    SettingsPill("$minutes min", solid = form.slotMinutes == minutes) {
                        if (state.canEdit) form = form.copy(slotMinutes = minutes)
                    }
                }
            }
        }

        item { SectionLabel("Closed on") }
        item {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ClinicSettings.WEEK.forEach { day ->
                    val off = day in form.offDays
                    SettingsPill(day.replaceFirstChar(Char::uppercase).take(3), solid = off) {
                        if (state.canEdit) {
                            form = form.copy(
                                offDays = if (off) form.offDays - day else form.offDays + day,
                            )
                        }
                    }
                }
            }
        }
        item {
            Txt(
                if (form.offDays.isEmpty()) {
                    "Open every day. Booking still allows a closing day if somebody insists — it " +
                        "warns rather than refuses."
                } else {
                    "Closed " + form.offDays.joinToString(", ") { it.replaceFirstChar(Char::uppercase) } +
                        ". Booking warns before putting somebody in on one of those days."
                },
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        }

        if (stored?.configured == false) {
            item {
                Txt(
                    // The difference between "nine to nine" and "nobody has said".
                    "Nobody has set these yet, so the diary shows no free slots and the booking " +
                        "sheet asks for a time to be typed. Saving once fixes both.",
                    Type.caption, T.warn,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 4,
                )
            }
        }

        item {
            SettingsSave(
                dirty = form != stored,
                enabled = state.canEdit,
            ) { actions.saveSchedule(form) }
        }
    }
}

/**
 * The clinic's edits to the drug list.
 *
 * What is stored is not a list of drugs — it is what this clinic has done to the
 * built-in one. So the page shows the merged result, marks which rows have been
 * changed or removed, and lets a built-in be put back exactly as it ships. A
 * clinic that has changed nothing stores nothing and simply gets the library.
 */
@Composable
private fun DrugsPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var editing by remember { mutableStateOf<DrugEdit?>(null) }
    var query by remember { mutableStateOf("") }

    // Two indexes over the clinic's rows: overrides by the built-in they stand
    // in front of, and the drugs typed in from scratch.
    val overrides = state.drugRows.filter { it.catalogId.isNotBlank() }.associateBy { it.catalogId }
    val own = state.drugRows.filter { it.catalogId.isBlank() && it.name.isNotBlank() }

    val needle = query.trim().let { com.alphadental.clinic.data.DrugCatalog.normalize(it) }
    fun matches(vararg fields: String): Boolean =
        needle.isEmpty() || fields.any {
            com.alphadental.clinic.data.DrugCatalog.normalize(it).contains(needle)
        }

    SettingsPage(
        title = Section.Drugs.label,
        caption = "${com.alphadental.clinic.data.DrugCatalog.ALL.size} built in" +
            if (own.isNotEmpty()) " + ${own.size} of your own" else "",
        state = state,
        onBack = onBack,
        ready = true,
    ) {
        item {
            RowGroup {
                SettingsField("Search", query, { query = it }, hint = "Name, or what it is for")
            }
        }

        if (state.canEdit) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp)) {
                    SettingsPill("Add a drug of your own", solid = true) {
                        editing = DrugEdit("", "", "", "", "")
                    }
                }
            }
        }

        if (own.isNotEmpty()) {
            item { SectionLabel("Yours") }
            items(own.filter { matches(it.name, it.dose, it.doseAr) }) { row ->
                DrugRow(
                    name = row.name,
                    dose = row.dose,
                    doseAr = row.doseAr,
                    note = "Typed in here",
                    canEdit = state.canEdit,
                    onEdit = { editing = DrugEdit(row.id, "", row.name, row.dose, row.doseAr) },
                    onRemove = { actions.binDrug(row.id) },
                    removeLabel = "Delete",
                    onRestore = null,
                )
            }
        }

        item { SectionLabel("The built-in list") }
        items(
            com.alphadental.clinic.data.DrugCatalog.ALL.filter {
                matches(it.name, it.doseEn, it.doseAr, it.descEn)
            }
        ) { drug ->
            val doc = overrides[drug.id]
            val hidden = doc?.hidden == true
            DrugRow(
                name = if (hidden) drug.name else doc?.name?.ifBlank { drug.name } ?: drug.name,
                dose = if (hidden || doc == null) drug.doseEn else doc.dose,
                doseAr = if (hidden || doc == null) drug.doseAr else doc.doseAr,
                note = when {
                    hidden -> "Removed from the list"
                    doc != null -> "Changed by the clinic"
                    else -> ""
                },
                faded = hidden,
                canEdit = state.canEdit,
                onEdit = {
                    editing = DrugEdit(
                        doc?.id.orEmpty(), drug.id,
                        doc?.name?.takeIf { !hidden && it.isNotBlank() } ?: drug.name,
                        if (hidden || doc == null) drug.doseEn else doc.dose,
                        if (hidden || doc == null) drug.doseAr else doc.doseAr,
                    )
                },
                onRemove = if (hidden) null else ({
                    actions.hideDrug(doc?.id.orEmpty(), drug.id, doc?.name?.ifBlank { drug.name } ?: drug.name)
                }),
                removeLabel = "Remove",
                onRestore = if (doc != null) ({
                    // Back to exactly what ships: the same write an edit makes,
                    // with the library's own words in it.
                    actions.saveDrug(doc.id, drug.id, drug.name, drug.doseEn, drug.doseAr)
                }) else null,
            )
        }

        item {
            Txt(
                "Removing a built-in hides it rather than deleting it — there is nothing in the " +
                    "database to delete until you have changed it, and it has to stay restorable. " +
                    "A drug you typed in yourself goes to Recently deleted.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 5,
            )
        }
    }

    editing?.let { form ->
        DrugSheet(
            form = form,
            onSave = { name, dose, doseAr ->
                actions.saveDrug(form.docId, form.catalogId, name, dose, doseAr)
                editing = null
            },
            onDismiss = { editing = null },
        )
    }
}

/** What the drug sheet is editing: an existing row, a built-in, or nothing yet. */
data class DrugEdit(
    val docId: String,
    val catalogId: String,
    val name: String,
    val dose: String,
    val doseAr: String,
)

@Composable
private fun DrugSheet(
    form: DrugEdit,
    onSave: (String, String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember(form) { mutableStateOf(form.name) }
    var dose by remember(form) { mutableStateOf(form.dose) }
    var doseAr by remember(form) { mutableStateOf(form.doseAr) }

    Sheet(
        title = if (form.docId.isBlank() && form.catalogId.isBlank()) "New drug" else name.ifBlank { "Drug" },
        caption = if (form.catalogId.isNotBlank()) "Your version of a built-in" else "Your own",
        action = "Save",
        ready = name.isNotBlank(),
        onAction = { onSave(name, dose, doseAr) },
        onDismiss = onDismiss,
    ) {
        SheetField("Name", name, { name = it }, hint = "Augmentin 1gm")
        SheetField("How to take it", dose, { dose = it }, hint = "1 tablet every 12 hours after food")
        SheetField("In Arabic", doseAr, { doseAr = it }, hint = "قرص كل 12 ساعة بعد الأكل")
        Txt(
            // The line that actually reaches the patient.
            "The Arabic line is what the patient reads off the printed sheet. Left blank, that " +
                "half of the prescription is blank.",
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}

@Composable
private fun DrugRow(
    name: String,
    dose: String,
    doseAr: String,
    note: String,
    canEdit: Boolean,
    onEdit: () -> Unit,
    onRemove: (() -> Unit)?,
    removeLabel: String,
    onRestore: (() -> Unit)?,
    faded: Boolean = false,
) {
    RowGroup {
        Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
            Txt(name, Type.rowName, if (faded) T.inkFaint else T.ink, maxLines = 2)
            listOf(dose, doseAr).filter { it.isNotBlank() }.forEach { line ->
                Spacer(Modifier.height(2.dp))
                Txt(line, Type.caption, T.inkMuted, maxLines = 2)
            }
            if (note.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Txt(note, Type.caption, if (faded) T.warn else T.accentInk, maxLines = 1)
            }
            if (canEdit) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SettingsPill(if (faded) "Put it back" else "Edit", onClick = if (faded) (onRestore ?: onEdit) else onEdit)
                    if (!faded) onRestore?.let { SettingsPill("Reset", onClick = it) }
                    if (!faded) onRemove?.let { SettingsPill(removeLabel, danger = true, onClick = it) }
                }
            }
        }
    }
    Spacer(Modifier.height(8.dp))
}

/**
 * Thirty days to change your mind.
 *
 * Nothing in this system is deleted outright — every delete takes a snapshot
 * first and lands here, which is why the phone cannot delete from Firestore
 * directly and asks the server instead. Restoring refuses when what the record
 * pointed at has gone since, and that refusal is shown as the server words it.
 */
@Composable
private fun DeletedPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var confirming by remember { mutableStateOf<String?>(null) }

    SettingsPage(
        title = Section.Deleted.label,
        caption = if (state.bin.isEmpty()) "Nothing waiting" else "${state.bin.size} waiting",
        state = state,
        onBack = onBack,
        ready = true,
    ) {
        if (state.bin.isEmpty()) {
            item { SettingsEmpty("Nothing has been deleted, or nothing you are allowed to see.") }
        }

        items(state.bin) { entry ->
            RowGroup {
                Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                    Txt(entry.label, Type.rowName, T.ink, maxLines = 2)
                    Spacer(Modifier.height(2.dp))
                    Txt(
                        listOf(
                            entry.collectionLabel,
                            "by ${entry.deletedByName}",
                            entry.deletedAt.take(10),
                        ).filter { it.isNotBlank() }.joinToString(" · "),
                        Type.caption, T.inkMuted, maxLines = 2,
                    )
                    if (entry.hasFiles) {
                        Spacer(Modifier.height(2.dp))
                        Txt("Has files with it", Type.caption, T.inkFaint, maxLines = 1)
                    }
                    entry.expiresAt.takeIf { it.isNotBlank() }?.let {
                        Spacer(Modifier.height(2.dp))
                        Txt("Gone for good after ${it.take(10)}", Type.caption, T.warn, maxLines = 1)
                    }
                    if (state.canEdit) {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SettingsPill("Put it back", solid = true) { actions.restoreDeleted(entry.id) }
                            SettingsPill("Delete for good", danger = true) { confirming = entry.id }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    confirming?.let { id ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            containerColor = T.surface,
            title = { Txt("Delete for good?", Type.heading, T.ink) },
            text = {
                Txt(
                    "This cannot be undone, and it takes any files stored with it.",
                    Type.body, T.inkMuted, maxLines = 3,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    actions.purgeDeleted(id)
                    confirming = null
                }) { Txt("Delete for good", Type.label, T.danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = null }) {
                    Txt("Keep it", Type.label, T.inkMuted)
                }
            },
        )
    }
}

/**
 * What the assistant has taught itself about this clinic.
 *
 * Its learn_fact tool writes a rule whenever somebody corrects it or states a
 * policy — "Dr. Ahmed does not work Tuesdays" — and every answer afterwards is
 * shaped by that list. A rule recorded wrongly, or one that used to be true,
 * goes on quietly steering answers until somebody can find it.
 *
 * Deliberately read-and-remove. Nothing here adds a rule: rules are meant to be
 * learned from conversation, not typed into a settings form. The point of the
 * page is oversight, not entry.
 */
@Composable
private fun MemoryPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var confirming by remember { mutableStateOf<String?>(null) }

    SettingsPage(
        title = Section.Memory.label,
        caption = if (state.facts.isEmpty()) "Nothing learned yet" else "${state.facts.size} rules",
        state = state,
        onBack = onBack,
        ready = true,
    ) {
        if (state.facts.isEmpty()) {
            item {
                SettingsEmpty(
                    "The assistant has not been told anything about this clinic yet. It learns " +
                        "from being corrected in conversation.",
                )
            }
        }

        items(state.facts) { fact ->
            RowGroup {
                Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
                    Txt(fact, Type.body, T.ink, maxLines = 6)
                    Spacer(Modifier.height(10.dp))
                    Row {
                        SettingsPill("Forget this", danger = true) { confirming = fact }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        item {
            Txt(
                "These are yours, not the clinic's: the assistant learns from whoever it is " +
                    "talking to, and another account has its own list.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 3,
            )
        }
    }

    confirming?.let { fact ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            containerColor = T.surface,
            title = { Txt("Forget this?", Type.heading, T.ink) },
            text = { Txt(fact, Type.body, T.inkMuted, maxLines = 6) },
            confirmButton = {
                TextButton(onClick = {
                    actions.forget(fact)
                    confirming = null
                }) { Txt("Forget it", Type.label, T.danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = null }) {
                    Txt("Keep it", Type.label, T.inkMuted)
                }
            },
        )
    }
}

/**
 * Which screen the app opens on.
 *
 * One switch, and only one, because only one of the website's interface
 * settings means anything on a phone. The rest are about modals, drawers and a
 * left rail — none of which exist here — and a page of switches that changed
 * nothing would be worse than no page at all. The last line says so rather than
 * leaving somebody hunting for the others.
 */
@Composable
private fun InterfacePage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val current = state.homeTab.orEmpty().ifBlank { Tab.Today.name }

    SettingsPage(
        title = Section.Interface.label,
        caption = "Yours, not the clinic's",
        state = state,
        onBack = onBack,
        ready = state.homeTab != null,
    ) {
        item { SectionLabel("Open on") }
        item {
            Column {
                listOf(
                    Tab.Today to "Today — the day's takings, who is waiting, who is in the chair.",
                    Tab.Day to "The diary — one day at a time, with the free slots in it.",
                    Tab.Patients to "Patients — straight to the search box.",
                ).forEach { (tab, why) ->
                    RowGroup {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clickable { actions.saveHomeTab(tab.name) }
                                .padding(horizontal = T.gutter, vertical = 13.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Txt(tab.name, Type.rowName, T.ink, Modifier.weight(1f))
                                if (current == tab.name) {
                                    Txt("Opens here", Type.caption, T.accentInk, maxLines = 1)
                                }
                            }
                            Spacer(Modifier.height(2.dp))
                            Txt(why, Type.caption, T.inkMuted, maxLines = 3)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        item {
            Txt(
                "This is yours rather than the clinic's: another account on this phone gets its " +
                    "own answer, and it follows you to another phone.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }
        item {
            Txt(
                "The website's other interface settings — whether an editor opens in a panel or " +
                    "over the page, how dense the note list is — are about a layout this app does " +
                    "not have, so they are not repeated here.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 4,
            )
        }
    }
}

@Composable
private fun AreaPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.area
    var form by remember(stored) { mutableStateOf(stored ?: ClinicSettings.AttendanceRules()) }

    SettingsPage(
        title = Section.Area.label,
        caption = "Where staff may clock in",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            RowGroup {
                SettingsField("Latitude", form.lat, { form = form.copy(lat = it) }, state.canEdit, hint = "30.0444")
                SettingsField("Longitude", form.lng, { form = form.copy(lng = it) }, state.canEdit, hint = "31.2357")
                SettingsField(
                    "How far from it, in metres", form.radiusMetres,
                    { form = form.copy(radiusMetres = it.filter(Char::isDigit)) },
                    state.canEdit, hint = "50", numeric = true,
                )
            }
        }
        item {
            Txt(
                "Leave these blank to let staff clock in from anywhere. A radius smaller than " +
                    "about thirty metres will refuse people standing inside the clinic on a bad " +
                    "GPS fix, which reads to them as the app being broken.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 5,
            )
        }
        item { SettingsSave(dirty = form != stored, enabled = state.canEdit) { actions.saveArea(form) } }
    }
}

@Composable
private fun BranchesPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var rows by remember(state.branches) { mutableStateOf(state.branches) }

    SettingsPage(
        title = Section.Branches.label,
        caption = if (rows.isEmpty()) "None yet" else "${rows.size} in the clinic",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                rows.forEachIndexed { i, branch ->
                    if (i > 0) Rule()
                    Column {
                        SettingsField(
                            "Branch ${i + 1}", branch.name,
                            { rows = rows.toMutableList().also { l -> l[i] = branch.copy(name = it) } },
                            state.canEdit, hint = "Nasr City",
                        )
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                            Column(Modifier.weight(1f)) {
                                SettingsField(
                                    "Lab code", branch.code,
                                    { rows = rows.toMutableList().also { l -> l[i] = branch.copy(code = it.uppercase().take(4)) } },
                                    state.canEdit, hint = LabCases.branchCodeFor(branch, i),
                                )
                            }
                            if (state.canEdit) {
                                SettingsPill("Remove", danger = true) {
                                    rows = rows.filterIndexed { n, _ -> n != i }
                                }
                                Spacer(Modifier.width(T.gutter))
                            }
                        }
                    }
                }
                if (rows.isEmpty()) SettingsEmpty("No branches yet.")
            }
        }
        item {
            Txt(
                // Not cosmetic: the code is stamped into every lab case number.
                "The lab code is the three or four letters at the front of a lab case number — " +
                    "MAD-0142. Changing it does not renumber cases already raised.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 4,
            )
        }
        if (state.canEdit) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                    SettingsPill("Add a branch") {
                        rows = rows + LabCases.Branch(ClinicSettings.newBranchId(), "", "")
                    }
                }
            }
        }
        item {
            SettingsSave(dirty = rows != state.branches, enabled = state.canEdit) {
                actions.saveBranches(rows.filter { it.name.isNotBlank() })
            }
        }
        item {
            Txt(
                "Rooms are kept as they are. The website's Locations screen edits those.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun LabsPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var editing by remember { mutableStateOf<LabCases.Lab?>(null) }

    editing?.let { lab ->
        LabEditor(
            lab = lab,
            state = state,
            onBack = { editing = null },
            onSave = { next ->
                val list = state.labs.toMutableList()
                val at = list.indexOfFirst { it.id == next.id }
                if (at >= 0) list[at] = next else list.add(next)
                actions.saveLabs(list)
                editing = null
            },
            onRemove = {
                actions.saveLabs(state.labs.filterNot { it.id == lab.id })
                editing = null
            },
        )
        return
    }

    SettingsPage(
        title = Section.Labs.label,
        caption = if (state.labs.isEmpty()) "None yet" else "${state.labs.size} on the list",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                if (state.labs.isEmpty()) SettingsEmpty("No labs yet.")
                state.labs.forEachIndexed { i, lab ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().clickable { editing = lab }
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(lab.name.ifBlank { "Unnamed lab" }, Type.rowName, T.ink)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                listOfNotNull(
                                    lab.phone.takeIf { it.isNotBlank() },
                                    lab.driverName.takeIf { it.isNotBlank() },
                                ).joinToString(" · ").ifBlank { "No contact details" },
                                Type.caption, T.inkMuted,
                            )
                        }
                        if (lab.turnaroundDays > 0) {
                            Spacer(Modifier.width(10.dp))
                            Chip("${lab.turnaroundDays} days", T.surfaceSoft, T.inkMuted)
                        }
                    }
                }
            }
        }
        item {
            Txt(
                // The one field that changes what the lab board can do.
                "The turnaround is what fills a case's due date when this lab is picked. Without " +
                    "it nothing on the lab board can ever be late.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 4,
            )
        }
        if (state.canEdit) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                    SettingsPill("Add a lab", solid = true) {
                        editing = LabCases.Lab(ClinicSettings.newLabId(), "")
                    }
                }
            }
        } else {
            item { SettingsReadOnly() }
        }
    }
}

@Composable
private fun LabEditor(
    lab: LabCases.Lab,
    state: SettingsState,
    onBack: () -> Unit,
    onSave: (LabCases.Lab) -> Unit,
    onRemove: () -> Unit,
) {
    BackHandler { onBack() }
    var form by remember(lab.id) { mutableStateOf(lab) }
    val known = state.labs.any { it.id == lab.id }

    SettingsPage(
        title = form.name.ifBlank { "New lab" },
        caption = if (known) "On the list" else "Not saved yet",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                SettingsField("Name", form.name, { form = form.copy(name = it) }, state.canEdit)
                SettingsField("Phone", form.phone, { form = form.copy(phone = it) }, state.canEdit)
                SettingsField(
                    "WhatsApp", form.whatsapp, { form = form.copy(whatsapp = it) }, state.canEdit,
                    hint = "Only if it differs from the phone",
                )
                SettingsField("Driver", form.driverName, { form = form.copy(driverName = it) }, state.canEdit)
                SettingsField("Address", form.address, { form = form.copy(address = it) }, state.canEdit, lines = 2)
                SettingsField("Notes", form.notes, { form = form.copy(notes = it) }, state.canEdit, lines = 2)
            }
        }
        item {
            RowGroup {
                SettingsStepper(
                    title = "Turnaround",
                    caption = "Working days from sending to expecting it back",
                    value = form.turnaroundDays,
                    suffix = if (form.turnaroundDays == 1) "day" else "days",
                    enabled = state.canEdit,
                    min = 0, max = 60,
                ) { form = form.copy(turnaroundDays = it) }
            }
        }
        item { SettingsSave(dirty = form != lab, enabled = state.canEdit) { onSave(form) } }
        if (state.canEdit && known) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                    SettingsPill("Remove this lab", danger = true, onClick = onRemove)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Treatment and money
// ---------------------------------------------------------------------------

private val PRICING_MODES = listOf(
    "flat" to "One price",
    "per_tooth" to "Per tooth",
    "per_arch" to "Per arch",
)

@Composable
private fun PricesPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var editing by remember { mutableStateOf<ClinicSettings.ServiceRow?>(null) }

    editing?.let { row ->
        PriceEditor(row, state, onBack = { editing = null }) {
            actions.saveService(it)
            editing = null
        }
        return
    }

    SettingsPage(
        title = Section.Prices.label,
        caption = if (state.services.isEmpty()) "Empty" else "${state.services.size} treatments",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                if (state.services.isEmpty()) SettingsEmpty("No treatments priced yet.")
                state.services.forEachIndexed { i, row ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().clickable { editing = row }
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(row.name.ifBlank { "Unnamed" }, Type.rowName, T.ink, maxLines = 2)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                listOfNotNull(
                                    row.category.takeIf { it.isNotBlank() },
                                    row.durationMinutes.takeIf { it > 0 }?.let { "$it min" },
                                    PRICING_MODES.firstOrNull { it.first == row.pricingMode }?.second,
                                ).joinToString(" · ").ifBlank { "No category" },
                                Type.caption, T.inkMuted,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Txt(money(row.price), Type.label.copy(fontSize = 13.sp), T.ink)
                    }
                }
            }
        }
        if (state.canEdit) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 10.dp)) {
                    SettingsPill("Add a treatment", solid = true) {
                        editing = ClinicSettings.ServiceRow("", "", 0.0, 30, 0.0, "", "flat", "")
                    }
                }
            }
        } else {
            item { SettingsReadOnly() }
        }
        item {
            Txt(
                // Not an oversight worth hiding: the rules closed client deletes
                // so a removed price can be recovered, and that route is the
                // website's.
                "Removing a treatment is done on the website, so a deleted price can be recovered.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun PriceEditor(
    row: ClinicSettings.ServiceRow,
    state: SettingsState,
    onBack: () -> Unit,
    onSave: (ClinicSettings.ServiceRow) -> Unit,
) {
    BackHandler { onBack() }
    var form by remember(row.id) { mutableStateOf(row) }
    var price by remember(row.id) { mutableStateOf(if (row.price > 0) trimNumber(row.price) else "") }
    var labFee by remember(row.id) { mutableStateOf(if (row.estimatedLabFee > 0) trimNumber(row.estimatedLabFee) else "") }
    var minutes by remember(row.id) { mutableStateOf(row.durationMinutes.takeIf { it > 0 }?.toString() ?: "") }

    val edited = form.copy(
        price = price.toDoubleOrNull() ?: 0.0,
        estimatedLabFee = labFee.toDoubleOrNull() ?: 0.0,
        durationMinutes = minutes.toIntOrNull() ?: 0,
    )

    SettingsPage(
        title = form.name.ifBlank { "New treatment" },
        caption = if (row.id.isBlank()) "Not saved yet" else "On the price list",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                SettingsField("Name", form.name, { form = form.copy(name = it) }, state.canEdit)
                SettingsField("Price", price, { price = it.filter { c -> c.isDigit() || c == '.' } }, state.canEdit, numeric = true)
                SettingsField("Category", form.category, { form = form.copy(category = it) }, state.canEdit, hint = "Restorative")
                SettingsField("How long it takes, in minutes", minutes, { minutes = it.filter(Char::isDigit) }, state.canEdit, numeric = true)
                SettingsField(
                    "What the lab charges for it", labFee,
                    { labFee = it.filter { c -> c.isDigit() || c == '.' } },
                    state.canEdit, numeric = true, hint = "0",
                )
            }
        }
        item { SectionLabel("How it is priced") }
        item {
            RowGroup {
                Row(
                    Modifier.horizontalScroll(rememberScrollState())
                        .padding(horizontal = T.gutter, vertical = 13.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PRICING_MODES.forEach { (id, label) ->
                        val on = form.pricingMode.ifBlank { "flat" } == id
                        SettingsPill(label, solid = on) {
                            if (state.canEdit) form = form.copy(pricingMode = id)
                        }
                    }
                }
                Rule()
                Txt(
                    "Per tooth multiplies the price by how many teeth are charged. It is what " +
                        "makes a filling on three teeth cost three fillings.",
                    Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 3,
                )
            }
        }
        item {
            SettingsSave(dirty = edited != row, enabled = state.canEdit && form.name.isNotBlank()) {
                onSave(edited)
            }
        }
    }
}

@Composable
private fun RecallPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val r = state.recall
    SettingsPage(
        title = Section.Recall.label,
        caption = "When a patient is due back",
        state = state,
        onBack = onBack,
        ready = r != null,
    ) {
        if (r == null) return@SettingsPage
        item {
            RowGroup {
                SettingsStepper(
                    title = "Due back after",
                    caption = "How long from a visit until the recall list asks for them",
                    value = r.intervalMonths, suffix = if (r.intervalMonths == 1) "month" else "months",
                    enabled = state.canEdit, min = 1, max = 60,
                ) { actions.saveRecall(r.copy(intervalMonths = it)) }
                Rule()
                SettingsStepper(
                    title = "Counts as dormant after",
                    caption = "Silence this long and they show up on the reactivation list",
                    value = r.reactivationMonths, suffix = if (r.reactivationMonths == 1) "month" else "months",
                    enabled = state.canEdit, min = 1, max = 60,
                ) { actions.saveRecall(r.copy(reactivationMonths = it)) }
            }
        }
        item {
            Txt(
                "Two different jobs read these, so they are two different questions: one is when " +
                    "a healthy patient is due a check-up, the other is when somebody has been gone " +
                    "long enough to be worth chasing.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 5,
            )
        }
        if (!state.canEdit) item { SettingsReadOnly() }
    }
}

/** Visit reasons and patient sources: one document, one array of plain strings. */
@Composable
private fun ListPage(
    section: Section,
    state: SettingsState,
    onBack: () -> Unit,
    values: List<String>,
    hint: String,
    note: String,
    onSave: (List<String>) -> Unit,
) {
    var rows by remember(values) { mutableStateOf(values) }

    SettingsPage(
        title = section.label,
        caption = "${rows.size} on the list",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                if (rows.isEmpty()) SettingsEmpty("Nothing on the list.")
                rows.forEachIndexed { i, value ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            SettingsField(
                                "${i + 1}", value,
                                { rows = rows.toMutableList().also { l -> l[i] = it } },
                                state.canEdit, hint = hint,
                            )
                        }
                        if (state.canEdit) {
                            SettingsPill("Remove", danger = true) {
                                rows = rows.filterIndexed { n, _ -> n != i }
                            }
                            Spacer(Modifier.width(T.gutter))
                        }
                    }
                }
            }
        }
        item {
            Txt(
                note, Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }
        if (state.canEdit) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                    SettingsPill("Add one") { rows = rows + "" }
                }
            }
        }
        item {
            SettingsSave(dirty = rows != values, enabled = state.canEdit) {
                onSave(rows.map { it.trim() }.filter { it.isNotBlank() })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

@Composable
private fun TeamPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    var editing by remember { mutableStateOf<ClinicSettings.StaffRow?>(null) }

    editing?.let { row ->
        StaffEditor(row, state, onBack = { editing = null }) {
            actions.saveStaff(it)
            editing = null
        }
        return
    }

    SettingsPage(
        title = Section.Team.label,
        caption = "Who works here",
        state = state,
        onBack = onBack,
        stats = if (state.staff.isEmpty()) emptyList() else listOf(
            Stat("Working", state.activeStaff.toString()),
            Stat("On the list", state.staff.size.toString()),
        ),
    ) {
        item {
            RowGroup {
                if (state.staff.isEmpty()) SettingsEmpty("Nobody on the list yet.")
                state.staff.forEachIndexed { i, person ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().clickable { editing = person }
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(person.name.ifBlank { person.email.ifBlank { "Unnamed" } }, Type.rowName, T.ink)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                listOfNotNull(
                                    person.role.ifBlank { "No role" },
                                    // Somebody with no account cannot sign in, which
                                    // is a different thing from being switched off.
                                    if (person.uid.isBlank()) "no account yet" else null,
                                ).joinToString(" · "),
                                Type.caption, T.inkMuted,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        if (!person.active) Chip("Off", T.dangerTint, T.danger)
                    }
                }
            }
        }
        if (state.canEdit) {
            item {
                Row(Modifier.padding(horizontal = T.gutter, vertical = 10.dp)) {
                    SettingsPill("Add somebody", solid = true) {
                        editing = ClinicSettings.StaffRow(
                            "", "", "", "", "Receptionist", "", true, emptyList(), 0.0, 0.0,
                        )
                    }
                }
            }
        } else {
            item { SettingsReadOnly() }
        }
        item {
            Txt(
                "Adding a row here does not create a login. The person signs up, asks to join, " +
                    "and is let in from the website — which is the only place that may grant an " +
                    "account a role.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 4,
            )
        }
    }
}

@Composable
private fun StaffEditor(
    row: ClinicSettings.StaffRow,
    state: SettingsState,
    onBack: () -> Unit,
    onSave: (ClinicSettings.StaffRow) -> Unit,
) {
    BackHandler { onBack() }
    var form by remember(row.id) { mutableStateOf(row) }
    var commission by remember(row.id) { mutableStateOf(if (row.commissionPercentage > 0) trimNumber(row.commissionPercentage) else "") }
    var salary by remember(row.id) { mutableStateOf(if (row.baseSalary > 0) trimNumber(row.baseSalary) else "") }

    val edited = form.copy(
        commissionPercentage = commission.toDoubleOrNull() ?: 0.0,
        baseSalary = salary.toDoubleOrNull() ?: 0.0,
    )
    val blanket = form.role == "Owner" || form.role == "Admin"

    SettingsPage(
        title = form.name.ifBlank { "New person" },
        caption = if (row.id.isBlank()) "Not saved yet" else form.role.ifBlank { "No role" },
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                SettingsField("Name", form.name, { form = form.copy(name = it) }, state.canEdit)
                SettingsField("Email", form.email, { form = form.copy(email = it) }, state.canEdit)
                SettingsField("Phone", form.phone, { form = form.copy(phone = it) }, state.canEdit)
            }
        }

        item { SectionLabel("Role") }
        item {
            RowGroup {
                Row(
                    Modifier.horizontalScroll(rememberScrollState())
                        .padding(horizontal = T.gutter, vertical = 13.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ClinicSettings.ROLES.forEach { role ->
                        SettingsPill(role, solid = form.role == role) {
                            if (state.canEdit) form = form.copy(role = role)
                        }
                    }
                }
                Rule()
                SettingsToggle(
                    title = "Works here",
                    caption = if (form.active) {
                        "Switched on. They can sign in and appear in the diary."
                    } else {
                        "Switched off. They keep their record but cannot work."
                    },
                    checked = form.active,
                    enabled = state.canEdit,
                ) { form = form.copy(active = it) }
            }
        }

        item { SectionLabel("Pay") }
        item {
            RowGroup {
                SettingsField(
                    "Commission, as a percentage", commission,
                    { commission = it.filter { c -> c.isDigit() || c == '.' } },
                    state.canEdit, numeric = true, hint = "0",
                )
                SettingsField(
                    "Monthly salary", salary,
                    { salary = it.filter { c -> c.isDigit() || c == '.' } },
                    state.canEdit, numeric = true, hint = "0",
                )
            }
        }

        item { SectionLabel("What they may open") }
        if (blanket) {
            item {
                RowGroup {
                    Txt(
                        "${form.role}s hold everything without any of these being ticked — the " +
                            "Firestore rules treat them the same way, so ticking boxes here would " +
                            "change nothing.",
                        Type.body, T.inkMuted,
                        Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                        maxLines = 4,
                    )
                }
            }
        } else {
            // The group name sits inside the card rather than above it: the
            // outer heading already said what all of this is, and two headings of
            // the same weight in a row read as two separate sections.
            item {
                RowGroup {
                    ClinicSettings.PERMISSION_GROUPS.forEachIndexed { g, (group, keys) ->
                        if (g > 0) Rule()
                        Txt(
                            group, Type.eyebrow, T.inkFaint,
                            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp, bottom = 2.dp),
                            uppercase = true,
                        )
                        keys.forEach { (key, label) ->
                            SettingsToggle(
                                title = label,
                                caption = "",
                                checked = key in form.permissions,
                                enabled = state.canEdit,
                            ) { on ->
                                form = form.copy(
                                    permissions = if (on) form.permissions + key
                                    else form.permissions - key,
                                )
                            }
                        }
                    }
                }
            }
        }

        item {
            SettingsSave(dirty = edited != row, enabled = state.canEdit && form.name.isNotBlank()) {
                onSave(edited)
            }
        }
    }
}

@Composable
private fun RequestsPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    SettingsPage(
        title = Section.Requests.label,
        caption = if (state.requests.isEmpty()) "Nobody waiting" else "${state.requests.size} waiting",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                if (state.requests.isEmpty()) SettingsEmpty("Nobody is asking to join.")
                state.requests.forEachIndexed { i, r ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(r.name.ifBlank { r.email }, Type.rowName, T.ink)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                listOfNotNull(
                                    r.email.takeIf { it.isNotBlank() && it != r.name },
                                    r.role.takeIf { it.isNotBlank() },
                                    r.atMillis.takeIf { it > 0 }?.let { stamp(it) },
                                ).joinToString(" · "),
                                Type.caption, T.inkMuted, maxLines = 2,
                            )
                        }
                        if (state.canEdit) {
                            Spacer(Modifier.width(10.dp))
                            SettingsPill("Turn away", danger = true) { actions.rejectRequest(r.id) }
                        }
                    }
                }
            }
        }
        item {
            Txt(
                // Stated rather than left as a missing button, because the absence
                // looks like an oversight otherwise.
                "Letting somebody in has to grant a role on their account, and no Firestore rule " +
                    "lets any client write another person's roles — an approval sent from here " +
                    "would mark the request accepted and grant nothing. That stays on the website.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 5,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// What patients see
// ---------------------------------------------------------------------------

@Composable
private fun BookingPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.booking
    var form by remember(stored) { mutableStateOf(stored ?: ClinicSettings.OnlineBooking()) }

    SettingsPage(
        title = Section.Booking.label,
        caption = if (form.enabled) "Open to patients" else "Closed",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            RowGroup {
                SettingsToggle(
                    title = "Patients can book themselves in",
                    caption = "The clinic's public booking page takes appointments without anybody at the desk.",
                    checked = form.enabled,
                    enabled = state.canEdit,
                ) { form = form.copy(enabled = it); actions.saveBooking(form.copy(enabled = it)) }
                Rule()
                SettingsToggle(
                    title = "Let them choose a dentist",
                    caption = "Off means the clinic decides who sees them.",
                    checked = form.enableDoctorSelection,
                    enabled = state.canEdit && form.enabled,
                ) {
                    form = form.copy(enableDoctorSelection = it)
                    actions.saveBooking(form.copy(enableDoctorSelection = it))
                }
                Rule()
                SettingsField(
                    "How long a booked slot is, in minutes",
                    form.defaultDurationMinutes,
                    { form = form.copy(defaultDurationMinutes = it.filter(Char::isDigit)) },
                    state.canEdit,
                    numeric = true, hint = "30",
                )
            }
        }
        item {
            SettingsSave(dirty = form != stored, enabled = state.canEdit) { actions.saveBooking(form) }
        }
    }
}

@Composable
private fun BotPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.bot
    var form by remember(stored) { mutableStateOf(stored ?: ClinicSettings.BotSettings()) }

    SettingsPage(
        title = Section.Bot.label,
        caption = if (form.enabled) "Answering patients" else "Silent",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            RowGroup {
                SettingsToggle(
                    title = "The bot answers",
                    caption = "Patients who message the clinic get a reply without waiting for the desk.",
                    checked = form.enabled, enabled = state.canEdit,
                ) { form = form.copy(enabled = it) }
                Rule()
                SettingsToggle(
                    title = "Answer numbers it does not know",
                    // The cost of the other setting, said plainly.
                    caption = "Off by default. On means answering wrong numbers and spam too.",
                    checked = form.answerStrangers, enabled = state.canEdit && form.enabled,
                ) { form = form.copy(answerStrangers = it) }
                Rule()
                SettingsToggle(
                    title = "Let it confirm bookings itself",
                    caption = "Off means a person at the desk confirms what the bot arranged.",
                    checked = form.autoConfirmBookings, enabled = state.canEdit && form.enabled,
                ) { form = form.copy(autoConfirmBookings = it) }
            }
        }

        item { SectionLabel("How it answers") }
        item {
            RowGroup {
                Row(
                    Modifier.horizontalScroll(rememberScrollState())
                        .padding(horizontal = T.gutter, vertical = 13.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SettingsPill("Scripted", solid = form.mode != "ai_first") {
                        if (state.canEdit) form = form.copy(mode = "", aiEnabled = false)
                    }
                    SettingsPill("AI first", solid = form.mode == "ai_first") {
                        if (state.canEdit) form = form.copy(mode = "ai_first", aiEnabled = true)
                    }
                }
                Rule()
                Txt(
                    "Scripted answers only what the clinic wrote. AI first lets the model answer " +
                        "and falls back to the script — it is better at odd questions and it costs " +
                        "credits per reply.",
                    Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 4,
                )
                Rule()
                SettingsToggle(
                    title = "Ask a dentist's questions about symptoms",
                    caption = "Off means a symptom books a call-back instead.",
                    checked = form.clinicalMode == "dentist", enabled = state.canEdit,
                ) { form = form.copy(clinicalMode = if (it) "dentist" else "") }
                Rule()
                SettingsField(
                    "What it calls itself", form.personaName,
                    { form = form.copy(personaName = it) }, state.canEdit, hint = "سارة",
                )
                Rule()
                SettingsStepper(
                    title = "Stay out after a staff reply",
                    caption = "Once somebody at the desk answers, the bot keeps quiet this long.",
                    value = form.humanClaimMinutes,
                    suffix = if (form.humanClaimMinutes == 1) "minute" else "minutes",
                    enabled = state.canEdit, min = 0, max = 240,
                ) { form = form.copy(humanClaimMinutes = it) }
            }
        }

        item { SectionLabel("What it may say") }
        item {
            RowGroup {
                ClinicSettings.BOT_FACT_KEYS.forEachIndexed { i, (key, label) ->
                    if (i > 0) Rule()
                    SettingsField(
                        label,
                        form.facts[key].orEmpty(),
                        { form = form.copy(facts = form.facts + (key to it)) },
                        state.canEdit,
                        hint = "Left blank, it will not answer this",
                        lines = 2,
                    )
                }
            }
        }
        item {
            Txt(
                "These are quoted word for word. A blank one is not guessed at — the bot says it " +
                    "will check and hands the thread to the desk.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }
        item { SettingsSave(dirty = form != stored, enabled = state.canEdit) { actions.saveBot(form) } }
    }
}

// ---------------------------------------------------------------------------
// This app
// ---------------------------------------------------------------------------

@Composable
private fun AlertsPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    SettingsPage(
        title = Section.Alerts.label,
        caption = "What rings the bell",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                ClinicSettings.ALERT_KEYS.forEachIndexed { i, (key, label) ->
                    if (i > 0) Rule()
                    SettingsToggle(
                        title = label,
                        caption = "",
                        checked = state.alerts[key] ?: ClinicSettings.alertDefault(key),
                        enabled = state.canEdit,
                    ) { actions.setAlert(key, it) }
                }
            }
        }
        item {
            Txt(
                "An alert nobody chose is the kind that teaches people to ignore the bell, so " +
                    "only arrival is on to begin with.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }
        if (!state.canEdit) item { SettingsReadOnly() }
    }
}

@Composable
private fun DentistHomePage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val show = state.dentistShare
    SettingsPage(
        title = Section.DentistHome.label,
        caption = "What a dentist sees",
        state = state,
        onBack = onBack,
        ready = show != null,
    ) {
        if (show == null) return@SettingsPage
        item {
            RowGroup {
                SettingsToggle(
                    title = "Show a dentist their share of the day",
                    caption = "Off means they see their list and their patients, but no money.",
                    checked = show, enabled = state.canEdit,
                ) { actions.setDentistShare(it) }
            }
        }
        item {
            Txt(
                "This is about a dentist's own home screen. It changes nothing about who may open " +
                    "the clinic's money screens — that is a permission, on each person's record.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 4,
            )
        }
        if (!state.canEdit) item { SettingsReadOnly() }
    }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

@Composable
private fun LogsPage(state: SettingsState, onBack: () -> Unit) {
    SettingsPage(
        title = Section.Logs.label,
        caption = "Newest first",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                if (state.logs.isEmpty()) SettingsEmpty("Nothing recorded yet.")
                state.logs.forEachIndexed { i, log ->
                    if (i > 0) Rule()
                    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Txt(log.action.ifBlank { "Something" }, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 2)
                            Spacer(Modifier.width(10.dp))
                            Txt(stamp(log.atMillis), Type.chip, T.inkFaint, uppercase = true)
                        }
                        if (log.details.isNotBlank()) {
                            Spacer(Modifier.height(3.dp))
                            Txt(log.details, Type.caption, T.inkMuted, maxLines = 2)
                        }
                        if (log.by.isNotBlank()) {
                            Spacer(Modifier.height(2.dp))
                            Txt(log.by, Type.caption, T.inkFaint)
                        }
                    }
                }
            }
        }
        item {
            Txt(
                "Read-only everywhere, this app included. A log somebody can edit is not a log.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun AiPage(state: SettingsState, onBack: () -> Unit) {
    SettingsPage(
        title = Section.Ai.label,
        caption = "Credits used",
        state = state,
        onBack = onBack,
    ) {
        item {
            RowGroup {
                if (state.ai.isEmpty()) SettingsEmpty("Nothing used yet.")
                state.ai.forEachIndexed { i, month ->
                    if (i > 0) Rule()
                    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Txt(monthName(month.month), Type.rowName, T.ink, Modifier.weight(1f))
                            Spacer(Modifier.width(10.dp))
                            Txt(trimNumber(month.creditsUsed), Type.label.copy(fontSize = 13.sp), T.ink)
                        }
                        if (month.byFeature.isNotEmpty()) {
                            Spacer(Modifier.height(3.dp))
                            Txt(
                                month.byFeature.entries
                                    .sortedByDescending { it.value }
                                    .joinToString(" · ") { "${it.key} ${trimNumber(it.value)}" },
                                Type.caption, T.inkMuted, maxLines = 3,
                            )
                        }
                    }
                }
            }
        }
        item {
            Txt(
                "Credits, not money. What a credit costs the clinic is on its plan.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 2,
            )
        }
    }
}

// ---------------------------------------------------------------------------

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())

/** 4500.0 reads as "4500", 4.5 as "4.5". A trailing ".0" on a price looks like a bug. */
private fun trimNumber(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

private fun stamp(millis: Long): String {
    if (millis <= 0L) return ""
    return SimpleDateFormat("d MMM, HH:mm", Locale.US).format(Date(millis))
}

/** "2026-09" reads as "September 2026". */
private fun monthName(key: String): String {
    val d = runCatching { SimpleDateFormat("yyyy-MM", Locale.US).parse(key) }.getOrNull() ?: return key
    return SimpleDateFormat("MMMM yyyy", Locale.US).format(d)
}
