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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
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
import com.alphadental.clinic.next.data.ClinicSource
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
import java.util.Calendar
import java.util.Locale

/**
 * The leads inbox.
 *
 * One screen, one job: ring the person who has been waiting longest. Everything
 * is ordered by that — overdue follow-ups first, then whoever has gone uncalled
 * the longest — because the entire cost of a lead is the time it spends waiting,
 * and a list in arrival order buries the worst case at the bottom.
 */
@Composable
fun LeadsScreen(
    state: Leads,
    onBack: () -> Unit,
    actions: LeadActions,
) {
    if (state.open != null) {
        LeadScreen(state, onBack = actions.close, actions = actions)
        return
    }

    var adding by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Leads",
            eyebrow = when {
                state.loading -> "Enquiries"
                state.due.isNotEmpty() -> "${state.due.size} to chase today"
                state.toCall.isNotEmpty() -> "${state.toCall.size} waiting for a call"
                else -> "Everybody has been called"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (state.canEdit) SlabIcon(Icons.Filled.Add, "Add a lead", onClick = { adding = true })
            },
            stats = if (state.loading || (state.error != null && state.leads.isEmpty())) emptyList() else listOf(
                Stat("To call", state.toCall.size.toString()),
                Stat("Due", state.due.size.toString()),
                Stat("Working", state.working.size.toString()),
                Stat("In the chair", state.won.size.toString()),
            ),
        )

        Filters(state, actions.filter)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            state.error != null && state.leads.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center,
            ) { Txt(state.error, Type.body, T.inkFaint, maxLines = 3) }

            state.shown.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center,
            ) { Txt(emptyFor(state.filter), Type.body, T.inkFaint, maxLines = 2) }

            else -> LazyColumn(
                Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                state.error?.let { item { Banner(it, T.dangerTint, T.danger) } }
                item {
                    RowGroup {
                        state.shown.forEachIndexed { i, row ->
                            if (i > 0) Rule()
                            LeadRowView(row) { actions.open(row.lead.id) }
                        }
                    }
                }
            }
        }
    }

    if (adding) AddLead(state, actions) { adding = false }
}

@Composable
private fun Filters(state: Leads, onFilter: (LeadFilter) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LeadFilter.entries.forEach { f ->
                    val count = when (f) {
                        LeadFilter.ToCall -> state.toCall.size
                        LeadFilter.Due -> state.due.size
                        LeadFilter.Working -> state.working.size
                        LeadFilter.Won -> state.won.size
                        LeadFilter.Lost -> state.lost.size
                        LeadFilter.All -> state.leads.size
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

/** One lead. The stripe is how long somebody has been waiting. */
@Composable
private fun LeadRowView(row: LeadRow, onOpen: () -> Unit) {
    val stripe = when {
        row.followUpDue -> T.danger
        row.cold -> T.warn
        row.uncalled -> T.accent
        row.stage == LeadStage.Won -> T.ok
        row.stage == LeadStage.Lost -> Color.Transparent
        else -> T.lineStrong
    }

    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(stripe))
        Column(Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(row.lead.name.ifBlank { row.lead.phone.ifBlank { "No name" } }, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
                Spacer(Modifier.width(8.dp))
                StageChip(row.stage)
            }
            Spacer(Modifier.height(4.dp))
            Txt(
                listOfNotNull(
                    row.lead.interest.takeIf { it.isNotBlank() },
                    row.lead.source.takeIf { it.isNotBlank() },
                ).joinToString(" · ").ifBlank { "No details" },
                Type.caption, T.inkMuted, maxLines = 1,
            )
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(
                    row.followUpLabel ?: row.ageLabel,
                    Type.chip,
                    when {
                        row.followUpDue -> T.danger
                        row.cold -> T.warn
                        else -> T.inkFaint
                    },
                    uppercase = true,
                )
                if (row.known) {
                    Spacer(Modifier.width(8.dp))
                    // Worth knowing before dialling: this is not a stranger.
                    Chip("Already a patient", T.surfaceSoft, T.inkMuted)
                }
            }
        }
    }
}

@Composable
private fun StageChip(stage: LeadStage) {
    val (fill, ink) = when (stage) {
        LeadStage.New -> Color(0xFFE0E7FF) to Color(0xFF3730A3)
        LeadStage.Contacted -> Color(0xFFBAE6FD) to Color(0xFF075985)
        LeadStage.Booked -> Color(0xFFFEF9C3) to Color(0xFF854D0E)
        LeadStage.Won -> Color(0xFFA7F3D0) to Color(0xFF065F46)
        LeadStage.Lost -> Color(0xFFFFE4E6) to Color(0xFFE11D48)
    }
    Chip(stage.label, fill, ink)
}

// ---------------------------------------------------------------------------
// One lead
// ---------------------------------------------------------------------------

/**
 * A lead, and the two buttons that matter.
 *
 * Calling and messaging are at the top because they are the job; the pipeline
 * is underneath because moving a lead along is a record of the call, not a
 * substitute for it.
 */
@Composable
private fun LeadScreen(state: Leads, onBack: () -> Unit, actions: LeadActions) {
    BackHandler { onBack() }
    val row = state.openLead

    if (row == null) {
        Column(Modifier.fillMaxSize().background(T.ground)) {
            Slab(title = "Lead", bar = { SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack) })
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
        }
        return
    }

    var losing by remember(row.lead.id) { mutableStateOf(false) }
    var converting by remember(row.lead.id) { mutableStateOf(false) }
    var notes by remember(row.lead.id, row.lead.notes) { mutableStateOf(row.lead.notes) }

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = row.lead.name.ifBlank { "Lead" },
            eyebrow = row.stage.label,
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (state.busy) {
                    CircularProgressIndicator(color = T.onSlabFaint, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                }
            },
        )

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            state.error?.let { item { Banner(it, T.dangerTint, T.danger) } }
            state.converted?.let { item { Banner(it, T.accentTint, T.accentInk) } }

            if (row.known) {
                item {
                    Banner(
                        "This number is already on file as ${row.lead.existingPatientName}. Converting " +
                            "links to that record rather than making a second one.",
                        T.surfaceSoft, T.inkBody,
                    )
                }
            }

            if (row.lead.phone.isNotBlank()) {
                item {
                    RowGroup {
                        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp)) {
                            Action(Icons.Filled.Call, "Call", Modifier.weight(1f)) { actions.call(row.lead.phone) }
                            Spacer(Modifier.width(10.dp))
                            Action(Icons.AutoMirrored.Filled.Chat, "WhatsApp", Modifier.weight(1f)) {
                                actions.message(row.lead.phone)
                            }
                        }
                        Rule()
                        Fact("Number", row.lead.phone)
                    }
                }
            }

            item { SectionLabel("Where it is") }
            item {
                RowGroup {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState())
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        LeadStage.settable.forEach { s ->
                            val on = s == row.stage
                            Surface(
                                shape = T.pill,
                                color = if (on) T.slab else T.surface,
                                border = if (on) null else BorderStroke(1.dp, T.line),
                                modifier = Modifier.then(
                                    if (state.canEdit) {
                                        Modifier.clickable {
                                            if (s == LeadStage.Lost) losing = true else actions.setStage(s, null)
                                        }
                                    } else Modifier
                                ),
                            ) {
                                Txt(
                                    s.label, Type.label.copy(fontSize = 12.sp),
                                    if (on) T.onSlab else T.inkMuted,
                                    Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                )
                            }
                        }
                    }

                    if (row.stage == LeadStage.Lost && row.lead.lostReason.isNotBlank()) {
                        Rule()
                        Fact("Lost because", row.lead.lostReason)
                    }

                    if (state.canEdit && row.stage != LeadStage.Won) {
                        Rule()
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Txt("They came in", Type.rowName, T.ink)
                                Spacer(Modifier.height(2.dp))
                                Txt(
                                    // Said plainly, because this is the one button
                                    // here that creates a record elsewhere.
                                    "Opens or links a patient file, and marks the lead won.",
                                    Type.caption, T.inkMuted, maxLines = 2,
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            SettingsPill("Convert", solid = true) { converting = true }
                        }
                    }
                }
            }

            item { SectionLabel("Chase") }
            item {
                RowGroup {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt("Follow up", Type.rowName, T.ink)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                row.lead.followUpDate.takeIf { it.isNotBlank() }
                                    ?.let { "${prettyDate(it)} · ${row.followUpLabel}" }
                                    ?: "No date set, so it sorts by age alone",
                                Type.caption,
                                if (row.followUpDue) T.danger else T.inkMuted,
                                maxLines = 2,
                            )
                        }
                    }
                    if (state.canEdit) {
                        Rule()
                        Row(
                            Modifier.horizontalScroll(rememberScrollState())
                                .padding(horizontal = T.gutter, vertical = 13.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            listOf(
                                "Tomorrow" to 1,
                                "In 3 days" to 3,
                                "Next week" to 7,
                                "In a month" to 30,
                            ).forEach { (label, days) ->
                                SettingsPill(label) { actions.followUp(dayKey(days)) }
                            }
                            if (row.lead.followUpDate.isNotBlank()) {
                                SettingsPill("Clear", danger = true) { actions.followUp(null) }
                            }
                        }
                    }
                }
            }

            item { SectionLabel("Notes") }
            item {
                RowGroup {
                    SettingsField(
                        "What they said", notes, { notes = it }, state.canEdit,
                        hint = "Asked about instalments", lines = 3,
                    )
                    SettingsSave(dirty = notes != row.lead.notes, enabled = state.canEdit) {
                        actions.setNotes(notes)
                    }
                }
            }

            item { SectionLabel("Where it came from") }
            item {
                RowGroup {
                    Fact("Source", row.lead.source.ifBlank { "Not recorded" })
                    Rule()
                    Fact("Asked about", row.lead.interest.ifBlank { "Not recorded" })
                    Rule()
                    Fact("Arrived", row.ageLabel)
                    Rule()
                    Fact(
                        "First contact",
                        if (row.lead.hasFirstContact) "Logged" else "Nobody has touched it yet",
                    )
                }
            }
        }
    }

    if (losing) {
        LostReason(
            name = row.lead.name,
            onDismiss = { losing = false },
            onConfirm = { reason -> actions.setStage(LeadStage.Lost, reason); losing = false },
        )
    }

    if (converting) {
        AlertDialog(
            onDismissRequest = { converting = false },
            containerColor = T.surface,
            title = { Txt("They came in?", Type.heading, T.ink) },
            text = {
                Txt(
                    if (row.known) {
                        "This number is already on file as ${row.lead.existingPatientName}. The lead will " +
                            "be linked to that record — no second file is made."
                    } else {
                        "A patient file is opened for ${row.lead.name.ifBlank { "this lead" }} and given the " +
                            "next file number. The lead is marked won."
                    },
                    Type.body, T.inkMuted, maxLines = 5,
                )
            },
            confirmButton = {
                TextButton(onClick = { actions.convert(); converting = false }) {
                    Txt("Convert", Type.label, T.ink)
                }
            },
            dismissButton = {
                TextButton(onClick = { converting = false }) { Txt("Not yet", Type.label, T.inkMuted) }
            },
        )
    }
}

/**
 * Why a lead was lost.
 *
 * Asked rather than assumed, and it is the reason the rules refuse to let a
 * client delete a lead at all: a lost lead with an awkward reason is the record
 * most worth keeping.
 */
@Composable
private fun LostReason(name: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var reason by remember { mutableStateOf("") }
    val common = listOf("Price", "Too far", "Went elsewhere", "No answer", "Not serious")

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = T.surface,
        title = { Txt("Why was ${name.ifBlank { "this lead" }} lost?", Type.heading, T.ink, maxLines = 2) },
        text = {
            Column(Modifier.fillMaxWidth()) {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    common.forEach { r -> SettingsPill(r, solid = reason == r) { reason = r } }
                }
                Spacer(Modifier.height(12.dp))
                androidx.compose.material3.OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    singleLine = true,
                    placeholder = { Txt("Or type a reason", Type.body, T.inkFaint) },
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
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(reason) }) { Txt("Mark lost", Type.label, T.danger) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Txt("Keep it open", Type.label, T.inkMuted) } },
    )
}

/** A lead taken at the desk — a walk-in, a phone call. */
@Composable
private fun AddLead(state: Leads, actions: LeadActions, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var interest by remember { mutableStateOf("") }
    var source by remember { mutableStateOf(state.sources.firstOrNull() ?: "Walk-in") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = T.surface,
        title = { Txt("A new enquiry", Type.heading, T.ink) },
        text = {
            Column(Modifier.fillMaxWidth()) {
                Field("Name", name) { name = it }
                Spacer(Modifier.height(10.dp))
                Field("Phone", phone) { phone = it }
                Spacer(Modifier.height(10.dp))
                Field("Asked about", interest) { interest = it }
                Spacer(Modifier.height(12.dp))
                Txt("Where from", Type.eyebrow, T.inkFaint, uppercase = true)
                Spacer(Modifier.height(6.dp))
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.sources.forEach { s -> SettingsPill(s, solid = source == s) { source = s } }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank(),
                onClick = { actions.add(name, phone, source, interest); onDismiss() },
            ) { Txt("Add", Type.label, if (name.isBlank()) T.inkFaint else T.ink) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Txt("Cancel", Type.label, T.inkMuted) } },
    )
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Txt(label, Type.eyebrow, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(5.dp))
        androidx.compose.material3.OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
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
    }
}

@Composable
private fun Action(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        shape = T.pill,
        color = T.slab,
        modifier = modifier.clickable(onClick = onClick),
    ) {
        Row(
            Modifier.padding(vertical = 13.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, tint = T.onSlab, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Txt(label, Type.label.copy(fontSize = 13.sp), T.onSlab)
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, Type.body, T.inkMuted, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Txt(value, Type.label.copy(fontSize = 13.sp), T.ink, maxLines = 2)
    }
}

@Composable
private fun Banner(text: String, fill: Color, ink: Color) {
    Surface(color = fill, modifier = Modifier.fillMaxWidth()) {
        Txt(text, Type.caption, ink, Modifier.padding(horizontal = T.gutter, vertical = 13.dp), maxLines = 4)
    }
}

private fun emptyFor(filter: LeadFilter): String = when (filter) {
    LeadFilter.ToCall -> "Everybody has been called."
    LeadFilter.Due -> "Nothing to chase today."
    LeadFilter.Working -> "Nothing in progress."
    LeadFilter.Won -> "No lead has come in yet."
    LeadFilter.Lost -> "Nothing lost."
    LeadFilter.All -> "No enquiries yet."
}

private fun dayKey(offset: Int): String = ClinicSource.dateKey(
    Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, offset) }.time
)

private fun prettyDate(key: String): String {
    if (key.isBlank()) return "no date"
    val d = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull() ?: return key
    return SimpleDateFormat("d MMM", Locale.US).format(d)
}

/** Everything the leads screens can ask for. */
data class LeadActions(
    val filter: (LeadFilter) -> Unit,
    val open: (String) -> Unit,
    val close: () -> Unit,
    val setStage: (LeadStage, String?) -> Unit,
    val convert: () -> Unit,
    val followUp: (String?) -> Unit,
    val setNotes: (String) -> Unit,
    val add: (String, String, String, String) -> Unit,
    val call: (String) -> Unit,
    val message: (String) -> Unit,
)
