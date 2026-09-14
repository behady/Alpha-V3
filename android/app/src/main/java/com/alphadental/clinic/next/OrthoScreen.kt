package com.alphadental.clinic.next

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.OrthoVisit
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Orthodontic cases.
 *
 * Ordered by silence, not by name. An ortho patient who drifts away does not
 * cancel anything — they simply stop booking, and a wire left on an unattended
 * mouth for a year does harm rather than nothing. A list in alphabetical order
 * tells a clinic who is on it; this one tells them who has been forgotten.
 */
@Composable
fun OrthoScreen(
    state: Ortho,
    onBack: () -> Unit,
    actions: OrthoActions,
) {
    if (state.open != null) {
        OrthoCaseScreen(state, onBack = actions.close, actions = actions)
        return
    }

    var adding by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Ortho",
            eyebrow = when {
                state.loading -> "Cases"
                state.due.isNotEmpty() -> "${state.due.size} due a visit"
                state.active.isEmpty() -> "Nobody in treatment"
                else -> "Everybody seen recently"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (state.canEdit) {
                    SlabIcon(Icons.Filled.Add, "Open a case", onClick = { adding = true })
                }
            },
            stats = if (state.loading || state.error != null) emptyList() else listOf(
                Stat("In treatment", state.active.size.toString()),
                Stat("Due", state.due.size.toString()),
                Stat("Retention", state.retention.size.toString()),
                Stat("Finished", state.completed.size.toString()),
            ),
        )

        Filters(state, actions.filter)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            state.error != null && state.cases.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) { Txt(state.error, Type.body, T.inkFaint, maxLines = 3) }

            state.shown.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) { Txt(emptyFor(state.filter), Type.body, T.inkFaint, maxLines = 2) }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                state.error?.let { item { Banner(it) } }
                item {
                    RowGroup {
                        state.shown.forEachIndexed { i, row ->
                            if (i > 0) Rule()
                            CaseRow(row) { actions.open(row.case.patientId) }
                        }
                    }
                }
                if (state.filter == OrthoFilter.Due) {
                    item {
                        Txt(
                            // The number is stated rather than implied, because it
                            // is an ordinary review interval and not medicine.
                            "A case shows here once six weeks have passed without an adjustment. " +
                                "That is the usual wire-change interval, not a clinical rule.",
                            Type.caption, T.inkMuted,
                            Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                            maxLines = 3,
                        )
                    }
                }
            }
        }
    }

    if (adding) {
        StartCase(state, actions, onDismiss = { adding = false })
    }
}

@Composable
private fun Filters(state: Ortho, onFilter: (OrthoFilter) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OrthoFilter.entries.forEach { f ->
                    val count = when (f) {
                        OrthoFilter.Due -> state.due.size
                        OrthoFilter.Active -> state.active.size
                        OrthoFilter.Retention -> state.retention.size
                        OrthoFilter.Completed -> state.completed.size
                        OrthoFilter.All -> state.cases.size
                    }
                    val on = f == state.filter
                    Surface(
                        shape = T.pill,
                        color = if (on) T.slab else T.surface,
                        border = if (on) null else BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onFilter(f) },
                    ) {
                        Txt(
                            if (count > 0) "${f.label} · $count" else f.label,
                            Type.label.copy(fontSize = 12.sp),
                            if (on) T.onSlab else T.inkMuted,
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }
            Rule()
        }
    }
}

/** One case. The stripe is how long the clinic has left it alone. */
@Composable
private fun CaseRow(row: OrthoRow, onOpen: () -> Unit) {
    val stripe = when {
        row.late -> T.danger
        row.due -> T.warn
        row.stage == OrthoStage.Completed -> Color.Transparent
        row.stage == OrthoStage.Retention -> T.lineStrong
        else -> T.ok
    }

    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(stripe))
        Column(Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(row.case.patientName.ifBlank { "No name" }, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 2)
                Spacer(Modifier.width(10.dp))
                StageChip(row.stage)
            }
            Spacer(Modifier.height(4.dp))
            Txt(
                listOfNotNull(
                    row.sinceLabel,
                    row.case.visits.size.takeIf { it > 0 }
                        ?.let { "$it adjustment${if (it == 1) "" else "s"}" },
                    row.monthsRunning?.takeIf { it > 0 }?.let { "$it months in" },
                ).joinToString(" · "),
                Type.caption,
                if (row.late) T.danger else if (row.due) T.warn else T.inkMuted,
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun StageChip(stage: OrthoStage) {
    val (fill, ink) = when (stage) {
        OrthoStage.Active -> Color(0xFFA7F3D0) to Color(0xFF065F46)
        OrthoStage.Retention -> Color(0xFFFEF9C3) to Color(0xFF854D0E)
        OrthoStage.Completed -> Color(0xFFE2E8F0) to Color(0xFF475569)
    }
    Chip(stage.label, fill, ink)
}

// ---------------------------------------------------------------------------
// One case
// ---------------------------------------------------------------------------

/**
 * A case, and the thing anybody opens it to do: log what was done today.
 *
 * The adjustment box is first, above the history, because that is the job. The
 * cephalometric readings are last — typed once from a tracing at the start and
 * rarely touched again.
 */
@Composable
private fun OrthoCaseScreen(state: Ortho, onBack: () -> Unit, actions: OrthoActions) {
    BackHandler { onBack() }
    val row = state.openCase

    if (row == null) {
        Column(Modifier.fillMaxSize().background(T.ground)) {
            Slab(
                title = "Case",
                bar = { SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack) },
            )
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
        }
        return
    }

    var editing by remember(row.case.patientId) { mutableStateOf<OrthoVisit?>(null) }

    editing?.let { visit ->
        VisitEditor(
            visit = visit,
            state = state,
            onBack = { editing = null },
            onSave = { actions.reviseVisit(visit.visitNo, it); editing = null },
            onRemove = { actions.reviseVisit(visit.visitNo, null); editing = null },
        )
        return
    }

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = row.case.patientName.ifBlank { "Case" },
            eyebrow = row.stage.label,
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (state.busy) {
                    CircularProgressIndicator(
                        color = T.onSlabFaint, strokeWidth = 2.dp, modifier = Modifier.size(18.dp),
                    )
                }
            },
            stats = listOf(
                Stat("Adjustments", row.case.visits.size.toString()),
                Stat("Months in", (row.monthsRunning ?: 0).toString()),
                Stat("Last seen", row.weeksSinceTouched?.let { "${it}w" } ?: "—"),
            ),
        )

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            state.error?.let { item { Banner(it) } }

            if (row.due) {
                item {
                    Surface(color = if (row.late) T.dangerTint else T.accentTint, modifier = Modifier.fillMaxWidth()) {
                        Txt(
                            "${row.sinceLabel.replaceFirstChar { it.uppercase() }}. Worth a call before the " +
                                "appliance sits any longer.",
                            Type.caption,
                            if (row.late) T.danger else T.accentInk,
                            Modifier.padding(horizontal = T.gutter, vertical = 13.dp),
                            maxLines = 3,
                        )
                    }
                }
            }

            if (state.canEdit) {
                item { SectionLabel("Today") }
                item { LogVisit(onLog = actions.logVisit) }
            }

            item { SectionLabel("Stage") }
            item {
                RowGroup {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState())
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OrthoStage.entries.forEach { s ->
                            val on = s == row.stage
                            Surface(
                                shape = T.pill,
                                color = if (on) T.slab else T.surface,
                                border = if (on) null else BorderStroke(1.dp, T.line),
                                modifier = Modifier.then(
                                    if (state.canEdit) Modifier.clickable { actions.setStage(s) } else Modifier
                                ),
                            ) {
                                Txt(
                                    s.label,
                                    Type.label.copy(fontSize = 12.sp),
                                    if (on) T.onSlab else T.inkMuted,
                                    Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                )
                            }
                        }
                    }
                    if (row.case.completedDate.isNotBlank()) {
                        Rule()
                        Txt(
                            "Finished ${prettyDate(row.case.completedDate)}",
                            Type.caption, T.inkMuted,
                            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                        )
                    }
                }
            }

            item { SectionLabel("Adjustments") }
            item {
                RowGroup {
                    if (row.visits.isEmpty()) {
                        Txt(
                            "Nothing logged yet.",
                            Type.body, T.inkMuted,
                            Modifier.padding(horizontal = T.gutter, vertical = 15.dp),
                        )
                    }
                    row.visits.forEachIndexed { i, visit ->
                        if (i > 0) Rule()
                        Column(
                            Modifier.fillMaxWidth()
                                .then(if (state.canEdit) Modifier.clickable { editing = visit } else Modifier)
                                .padding(horizontal = T.gutter, vertical = 12.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Txt(
                                    "Visit ${visit.visitNo}",
                                    Type.label.copy(fontSize = 12.sp), T.inkFaint,
                                )
                                Spacer(Modifier.weight(1f))
                                Txt(prettyDate(visit.date), Type.chip, T.inkFaint, uppercase = true)
                            }
                            Spacer(Modifier.height(4.dp))
                            Txt(visit.workDone.ifBlank { "No note" }, Type.rowName, T.ink, maxLines = 3)
                            if (visit.nextStep.isNotBlank()) {
                                Spacer(Modifier.height(3.dp))
                                Txt("Next: ${visit.nextStep}", Type.caption, T.inkMuted, maxLines = 2)
                            }
                        }
                    }
                }
            }

            item { SectionLabel("The case") }
            item { Details(row, state, actions) }

            item {
                Txt(
                    "Started ${prettyDate(row.case.startDate)}" +
                        if (row.case.patientPhone.isNotBlank()) " · ${row.case.patientPhone}" else "",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
                    maxLines = 2,
                )
            }
        }
    }
}

/** The box the job actually happens in. */
@Composable
private fun LogVisit(onLog: (String, String) -> Unit) {
    var work by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }

    RowGroup {
        SettingsField("What was done", work, { work = it }, hint = "Archwire 018 NiTi, upper", lines = 2)
        SettingsField("What is next", next, { next = it }, hint = "Review in 5 weeks")
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt(
                "Dated today, and numbered after the last adjustment.",
                Type.caption, T.inkFaint, Modifier.weight(1f), maxLines = 2,
            )
            Spacer(Modifier.width(10.dp))
            SettingsPill("Log it", solid = work.isNotBlank()) {
                if (work.isNotBlank()) {
                    onLog(work.trim(), next.trim())
                    work = ""
                    next = ""
                }
            }
        }
    }
}

/** The diagnosis and the cephalometric readings. */
@Composable
private fun Details(row: OrthoRow, state: Ortho, actions: OrthoActions) {
    var diagnosis by remember(row.case.patientId, row.case.diagnosis) { mutableStateOf(row.case.diagnosis) }
    var ceph by remember(row.case.patientId, row.case.cephData) { mutableStateOf(row.case.cephData) }

    val dirty = diagnosis != row.case.diagnosis || ceph != row.case.cephData

    RowGroup {
        SettingsField(
            "Diagnosis", diagnosis, { diagnosis = it }, state.canEdit,
            hint = "Class II div 1, 6mm overjet", lines = 2,
        )
        Rule()
        Txt(
            "Cephalometric readings",
            Type.eyebrow, T.inkFaint,
            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp, bottom = 2.dp),
            uppercase = true,
        )
        com.alphadental.clinic.data.CEPH_FIELDS.forEach { (key, label) ->
            SettingsField(
                label,
                ceph[key].orEmpty(),
                { ceph = if (it.isBlank()) ceph - key else ceph + (key to it) },
                state.canEdit,
            )
        }
        SettingsSave(dirty = dirty, enabled = state.canEdit) { actions.saveDetails(diagnosis, ceph) }
    }
}

@Composable
private fun VisitEditor(
    visit: OrthoVisit,
    state: Ortho,
    onBack: () -> Unit,
    onSave: (OrthoVisit) -> Unit,
    onRemove: () -> Unit,
) {
    BackHandler { onBack() }
    var work by remember(visit.visitNo) { mutableStateOf(visit.workDone) }
    var next by remember(visit.visitNo) { mutableStateOf(visit.nextStep) }
    var date by remember(visit.visitNo) { mutableStateOf(visit.date) }

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = "Visit ${visit.visitNo}",
            eyebrow = prettyDate(visit.date),
            bar = { SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack) },
        )
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            item {
                RowGroup {
                    SettingsField("Date", date, { date = it }, state.canEdit, hint = "2026-09-14")
                    SettingsField("What was done", work, { work = it }, state.canEdit, lines = 2)
                    SettingsField("What is next", next, { next = it }, state.canEdit)
                }
            }
            item {
                SettingsSave(
                    dirty = work != visit.workDone || next != visit.nextStep || date != visit.date,
                    enabled = state.canEdit,
                ) { onSave(visit.copy(workDone = work, nextStep = next, date = date)) }
            }
            if (state.canEdit) {
                item {
                    Row(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                        SettingsPill("Remove this visit", danger = true, onClick = onRemove)
                    }
                }
                item {
                    Txt(
                        // Said because the array rewrite is the risky part, and
                        // somebody should know the numbering does not close up.
                        "Removing a visit leaves the numbers of the others alone, so the history " +
                            "still reads in the order it happened.",
                        Type.caption, T.inkFaint,
                        Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                        maxLines = 3,
                    )
                }
            }
        }
    }
}

/** Open a case on somebody who has not got one. */
@Composable
private fun StartCase(state: Ortho, actions: OrthoActions, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = T.surface,
        title = { Txt("Open a case", Type.heading, T.ink) },
        text = {
            Column(Modifier.fillMaxWidth()) {
                Txt(
                    "Find the patient. Somebody who already has a case is not listed.",
                    Type.caption, T.inkMuted, maxLines = 2,
                )
                Spacer(Modifier.height(10.dp))
                androidx.compose.material3.OutlinedTextField(
                    value = state.search,
                    onValueChange = actions.search,
                    singleLine = true,
                    placeholder = { Txt("Name or phone", Type.body, T.inkFaint) },
                    shape = T.cardShape,
                    colors = androidx.compose.material3.TextFieldDefaults.colors(
                        focusedContainerColor = T.surfaceSoft,
                        unfocusedContainerColor = T.surfaceSoft,
                        focusedTextColor = T.ink,
                        unfocusedTextColor = T.ink,
                        focusedIndicatorColor = T.lineStrong,
                        unfocusedIndicatorColor = T.line,
                        cursorColor = T.ink,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                if (state.searching) {
                    CircularProgressIndicator(
                        color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(18.dp),
                    )
                }
                state.found.forEach { person ->
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable { actions.startCase(person); onDismiss() }
                            .padding(vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(person.name, Type.rowName, T.ink)
                            if (person.phone.isNotBlank()) {
                                Spacer(Modifier.height(2.dp))
                                Txt(person.phone, Type.caption, T.inkMuted)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Txt("Close", Type.label, T.inkMuted)
            }
        },
    )
}

@Composable
private fun Banner(text: String) {
    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
        Txt(text, Type.caption, T.danger, Modifier.padding(horizontal = T.gutter, vertical = 13.dp), maxLines = 3)
    }
}

private fun emptyFor(filter: OrthoFilter): String = when (filter) {
    OrthoFilter.Due -> "Every case in treatment has been seen recently."
    OrthoFilter.Active -> "Nobody is in treatment."
    OrthoFilter.Retention -> "Nobody is in retention."
    OrthoFilter.Completed -> "No cases finished yet."
    OrthoFilter.All -> "No orthodontic cases yet."
}

/** "14 Sep 2026", or the raw key when it is not a date. */
private fun prettyDate(key: String): String {
    if (key.isBlank()) return "no date"
    val d = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull() ?: return key
    return SimpleDateFormat("d MMM yyyy", Locale.US).format(d)
}

/** Everything the ortho screens can ask the model to do. */
data class OrthoActions(
    val filter: (OrthoFilter) -> Unit,
    val open: (String) -> Unit,
    val close: () -> Unit,
    val logVisit: (String, String) -> Unit,
    val reviseVisit: (Int, OrthoVisit?) -> Unit,
    val setStage: (OrthoStage) -> Unit,
    val saveDetails: (String, Map<String, String>) -> Unit,
    val search: (String) -> Unit,
    val startCase: (com.alphadental.clinic.next.data.Person) -> Unit,
)
