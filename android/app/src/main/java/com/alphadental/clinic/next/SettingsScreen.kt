package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * How the clinic runs.
 *
 * An index of sub-screens rather than the website's single long page. The
 * website can show everything at once because it has the width to lay it out
 * side by side; the same page on a phone is a thousand-pixel scroll to reach one
 * switch, and people stop looking for settings they cannot find twice.
 */
@Composable
fun SettingsScreen(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val section = state.section
    if (section != null) {
        SettingsSection(section, state, onBack = actions.close, actions = actions)
        return
    }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Settings",
            eyebrow = state.profile?.name?.takeIf { it.isNotBlank() } ?: "The clinic",
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
        )

        if (state.who?.can("access.settings") != true) {
            Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
                Txt(
                    state.error ?: "This account is not allowed to open the clinic's settings.",
                    Type.body, T.inkFaint, maxLines = 3,
                )
            }
            return
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            // Said once, at the top. Every switch below is drawn disabled for a
            // reader, so without this the screen looks broken rather than shut.
            if (!state.canEdit) {
                item {
                    Surface(color = T.surfaceSoft, modifier = Modifier.fillMaxWidth()) {
                        Txt(
                            "You can read all of this. Changing it is an owner or admin decision, " +
                                "and the server enforces that too.",
                            Type.caption, T.inkBody,
                            Modifier.padding(horizontal = T.gutter, vertical = 13.dp),
                            maxLines = 3,
                        )
                    }
                }
            }

            SettingsGroup.entries.forEach { group ->
                val sections = Section.entries.filter { it.group == group }
                item { SectionLabel(group.label) }
                item {
                    RowGroup {
                        sections.forEachIndexed { i, s ->
                            if (i > 0) Rule()
                            IndexRow(s) { actions.open(s) }
                        }
                    }
                }
            }

            item {
                Txt(
                    "Opening hours, the odontogram and message wording are still edited on the website.",
                    Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
                    maxLines = 3,
                )
            }
        }
    }
}

@Composable
private fun IndexRow(section: Section, onOpen: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen)
            .padding(horizontal = T.gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(section.icon, null, tint = T.inkFaint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Txt(section.label, Type.rowName, T.ink)
            Spacer(Modifier.height(2.dp))
            Txt(section.caption, Type.caption, T.inkMuted, maxLines = 2)
        }
        Spacer(Modifier.width(10.dp))
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight, null,
            tint = T.lineStrong, modifier = Modifier.size(20.dp),
        )
    }
}

/**
 * The frame every sub-screen shares.
 *
 * Title, back arrow, an error line and a spinner while the section is being
 * read. Each section supplies only its own rows, which is what keeps sixteen of
 * them from each inventing a slightly different header.
 */
@Composable
fun SettingsPage(
    title: String,
    caption: String,
    state: SettingsState,
    onBack: () -> Unit,
    stats: List<Stat> = emptyList(),
    ready: Boolean = true,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = title,
            eyebrow = caption,
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (state.busy) {
                    CircularProgressIndicator(
                        color = T.onSlabFaint, strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                }
            },
            stats = stats,
        )

        if (!ready) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
            return
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            state.error?.let {
                item {
                    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                        Txt(
                            it, Type.caption, T.danger,
                            Modifier.padding(horizontal = T.gutter, vertical = 13.dp),
                            maxLines = 3,
                        )
                    }
                }
            }
            content()
        }
    }
}

// ---------------------------------------------------------------------------
// The parts every section is built from
// ---------------------------------------------------------------------------

@Composable
fun SettingsToggle(
    title: String,
    caption: String,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(title, Type.rowName, T.ink, maxLines = 2)
            if (caption.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Txt(caption, Type.caption, T.inkMuted, maxLines = 3)
            }
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            enabled = enabled,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = T.onSlab,
                checkedTrackColor = T.slab,
                uncheckedThumbColor = T.surface,
                uncheckedTrackColor = T.line,
                uncheckedBorderColor = T.lineStrong,
                disabledCheckedThumbColor = T.onSlab,
                disabledCheckedTrackColor = T.lineStrong,
                disabledUncheckedThumbColor = T.surface,
                disabledUncheckedTrackColor = T.line,
            ),
        )
    }
}

/** A labelled box. The label sits above rather than inside, so it survives typing. */
@Composable
fun SettingsField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    enabled: Boolean = true,
    hint: String = "",
    numeric: Boolean = false,
    lines: Int = 1,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 11.dp)) {
        Txt(label, Type.eyebrow, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            singleLine = lines == 1,
            minLines = lines,
            placeholder = if (hint.isBlank()) null else ({ Txt(hint, Type.body, T.inkFaint) }),
            keyboardOptions = KeyboardOptions(
                keyboardType = if (numeric) KeyboardType.Number else KeyboardType.Text,
            ),
            shape = T.cardShape,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = T.surfaceSoft,
                unfocusedContainerColor = T.surfaceSoft,
                disabledContainerColor = T.surfaceSoft,
                focusedTextColor = T.ink,
                unfocusedTextColor = T.ink,
                disabledTextColor = T.inkMuted,
                focusedIndicatorColor = T.lineStrong,
                unfocusedIndicatorColor = T.line,
                disabledIndicatorColor = T.line,
                cursorColor = T.ink,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Minus, a number, plus. Cheaper to hit than a keyboard for a value with a range. */
@Composable
fun SettingsStepper(
    title: String,
    caption: String,
    value: Int,
    suffix: String,
    enabled: Boolean,
    min: Int,
    max: Int,
    onChange: (Int) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(title, Type.rowName, T.ink, maxLines = 2)
            Spacer(Modifier.height(2.dp))
            Txt(caption, Type.caption, T.inkMuted, maxLines = 3)
        }
        Spacer(Modifier.width(10.dp))
        if (enabled) {
            SettingsPill("−") { onChange((value - 1).coerceAtLeast(min)) }
            Spacer(Modifier.width(8.dp))
        }
        Txt("$value $suffix", Type.label.copy(fontSize = 14.sp), T.ink)
        if (enabled) {
            Spacer(Modifier.width(8.dp))
            SettingsPill("+") { onChange((value + 1).coerceAtMost(max)) }
        }
    }
}

@Composable
fun SettingsPill(label: String, solid: Boolean = false, danger: Boolean = false, onClick: () -> Unit) {
    Surface(
        shape = T.pill,
        color = if (solid) T.slab else T.surface,
        border = if (solid) null else BorderStroke(1.dp, if (danger) T.dangerTint else T.line),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Txt(
            label,
            Type.label.copy(fontSize = 12.sp),
            when {
                solid -> T.onSlab
                danger -> T.danger
                else -> T.inkMuted
            },
            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

/** The one button a form has. Disabled until something has actually changed. */
@Composable
fun SettingsSave(dirty: Boolean, enabled: Boolean, onSave: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(
            if (!enabled) "Read only" else if (dirty) "Not saved yet" else "Saved",
            Type.caption,
            if (dirty && enabled) T.warn else T.inkFaint,
            Modifier.weight(1f),
        )
        if (enabled) SettingsPill("Save", solid = dirty) { if (dirty) onSave() }
    }
}

/** Said once per section rather than beside every disabled control. */
@Composable
fun SettingsReadOnly() {
    Txt(
        "Only an owner or admin can change this.",
        Type.caption, T.inkFaint,
        Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
        maxLines = 2,
    )
}

@Composable
fun SettingsEmpty(text: String) {
    Txt(
        text, Type.body, T.inkMuted,
        Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
        maxLines = 3,
    )
}

/** Everything a section can ask the model to do. */
data class SettingsActions(
    val open: (Section) -> Unit,
    val close: () -> Unit,
    val saveProfile: (com.alphadental.clinic.data.ClinicSettings.ClinicProfile) -> Unit,
    val saveArea: (com.alphadental.clinic.data.ClinicSettings.AttendanceRules) -> Unit,
    val saveSchedule: (com.alphadental.clinic.data.ClinicSettings.Schedule) -> Unit,
    val setAlert: (String, Boolean) -> Unit,
    val saveBooking: (com.alphadental.clinic.data.ClinicSettings.OnlineBooking) -> Unit,
    val saveRecall: (com.alphadental.clinic.data.ClinicSettings.Recall) -> Unit,
    val saveBot: (com.alphadental.clinic.data.ClinicSettings.BotSettings) -> Unit,
    val setDentistShare: (Boolean) -> Unit,
    val saveReasons: (List<String>) -> Unit,
    val saveSources: (List<String>) -> Unit,
    val saveBranches: (List<com.alphadental.clinic.data.LabCases.Branch>) -> Unit,
    val saveLabs: (List<com.alphadental.clinic.data.LabCases.Lab>) -> Unit,
    val saveService: (com.alphadental.clinic.data.ClinicSettings.ServiceRow) -> Unit,
    val saveStaff: (com.alphadental.clinic.data.ClinicSettings.StaffRow) -> Unit,
    val rejectRequest: (String) -> Unit,
)
