package com.alphadental.clinic.next

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.NotifyCatalog
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * Every alert the system can raise, on one page — the website's Settings → Alerts.
 *
 * The clinic's answers (bell, push, who, when, quiet hours) are one map, edited here and saved
 * with the button, the way the website's Save works. The last section is personal: my own mutes,
 * saved on my own record the moment they are tapped, because they are nobody else's business and
 * need nobody's permission.
 */
@Composable
internal fun AlertsPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.alertPrefs
    var form by remember(stored) { mutableStateOf(stored ?: emptyMap()) }
    val dirty = stored != null && form != stored
    val onCount = NotifyCatalog.EVENTS.count { e -> NotifyCatalog.resolve(e.id, form)?.let { it.bell || it.push } == true }

    fun patchEvent(id: String, edit: (Map<String, Any?>) -> Map<String, Any?>) {
        val events = (form["events"] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()
        val current = (events[id] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()
        form = form + ("events" to (events + (id to edit(current))))
    }

    fun patchTiming(id: String, key: String, value: Int) {
        val timings = (form["timings"] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()
        val current = (timings[id] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()
        form = form + ("timings" to (timings + (id to (current + (key to value)))))
    }

    fun patchQuiet(key: String, value: Any) {
        val quiet = (form["quietHours"] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()
        form = form + ("quietHours" to (quiet + (key to value)))
    }

    val quiet = form["quietHours"] as? Map<*, *>
    val quietOn = quiet?.get("enabled") == true
    val quietFrom = (quiet?.get("fromHour") as? Number)?.toInt() ?: 22
    val quietTo = (quiet?.get("toHour") as? Number)?.toInt() ?: 8

    SettingsPage(
        title = Section.Alerts.label,
        caption = "$onCount of ${NotifyCatalog.EVENTS.size} switched on",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            Txt(
                "Who gets told what, and when. The bell is the list inside the app; push is the " +
                    "buzz on a phone. Everything here is the clinic's answer — your own mutes are at the bottom.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp), maxLines = 4,
            )
        }

        // ---- Quiet hours first: the one setting that changes every row below it.
        item { SectionLabel("Quiet hours") }
        item {
            RowGroup {
                SettingsToggle(
                    title = "Hold non-urgent alerts overnight",
                    caption = "Anything that can wait is delivered when quiet hours end. Patients waiting for a reply never wait.",
                    checked = quietOn, enabled = state.canEdit,
                ) { patchQuiet("enabled", it) }
                if (quietOn) {
                    Rule()
                    HourPicker("From", quietFrom, state.canEdit) { patchQuiet("fromHour", it) }
                    Rule()
                    HourPicker("Until", quietTo, state.canEdit) { patchQuiet("toHour", it) }
                }
            }
        }

        // ---- The catalogue, group by group.
        NotifyCatalog.GROUPS.forEach { group ->
            val events = NotifyCatalog.eventsIn(group.id)
            if (events.isEmpty()) return@forEach
            item { SectionLabel(group.en) }
            item {
                Txt(group.noteEn, Type.caption, T.inkFaint, Modifier.padding(start = T.gutter, end = T.gutter, bottom = 8.dp), maxLines = 3)
            }
            item {
                RowGroup {
                    events.forEachIndexed { i, event ->
                        if (i > 0) Rule()
                        val resolved = NotifyCatalog.resolve(event.id, form) ?: return@forEachIndexed
                        EventRow(
                            event = event,
                            resolved = resolved,
                            prefs = form,
                            enabled = state.canEdit,
                            onChannel = { key, on -> patchEvent(event.id) { it + (key to on) } },
                            onRole = { role ->
                                val now = resolved.roles.toMutableSet()
                                if (!now.remove(role)) now.add(role)
                                // The catalogue's order, so two admins produce the same document.
                                patchEvent(event.id) { it + ("roles" to NotifyCatalog.ROLES.filter { r -> r in now }) }
                            },
                            onTiming = { key, value -> patchTiming(event.id, key, value) },
                        )
                    }
                }
            }
        }

        item { SettingsSave(dirty = dirty, enabled = state.canEdit) { actions.saveAlertPrefs(form) } }
        if (!state.canEdit) item { SettingsReadOnly() }

        // ---- Mine only. Saves itself, outside the clinic's Save button.
        item { SectionLabel("Mine only") }
        item {
            Txt(
                "Switch off, for yourself, anything the clinic sends that you do not want. This " +
                    "changes nothing for anyone else and needs no permission.",
                Type.caption, T.inkFaint,
                Modifier.padding(start = T.gutter, end = T.gutter, bottom = 8.dp), maxLines = 3,
            )
        }
        item {
            RowGroup {
                NotifyCatalog.EVENTS.forEachIndexed { i, event ->
                    if (i > 0) Rule()
                    val resolved = NotifyCatalog.resolve(event.id, form)
                    val clinicHasIt = resolved?.let { it.bell || it.push } == true
                    val muted = event.id in state.myMutes
                    SettingsToggle(
                        title = event.en,
                        caption = if (!clinicHasIt) "The clinic has this off" else if (muted) "Muted for you" else "",
                        checked = !muted && clinicHasIt,
                        enabled = clinicHasIt && state.mutesLoaded,
                    ) { on -> actions.setMute(event.id, !on) }
                }
            }
        }
    }
}

@Composable
private fun EventRow(
    event: NotifyCatalog.Event,
    resolved: NotifyCatalog.Resolved,
    prefs: Map<String, Any?>,
    enabled: Boolean,
    onChannel: (String, Boolean) -> Unit,
    onRole: (String) -> Unit,
    onTiming: (String, Int) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Txt(event.en, Type.rowName, T.ink, maxLines = 2)
                Spacer(Modifier.height(2.dp))
                Txt(event.whenEn, Type.caption, T.inkMuted, maxLines = 3)
            }
            Spacer(Modifier.width(10.dp))
            Channel("Bell", resolved.bell, enabled) { onChannel("bell", it) }
            Spacer(Modifier.width(8.dp))
            Channel("Push", resolved.push, enabled) { onChannel("push", it) }
        }
        if (resolved.bell || resolved.push) {
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                Txt("Goes to", Type.chip, T.inkFaint, uppercase = true)
                Spacer(Modifier.width(8.dp))
                if (event.rolesFixed) {
                    Chip(roleName(event.roles.firstOrNull().orEmpty()) + " — fixed", on = true, enabled = false) {}
                } else {
                    val offered = event.rolesMax?.let { max -> NotifyCatalog.ROLES.filter { it in max } } ?: NotifyCatalog.ROLES
                    offered.forEach { role ->
                        Chip(roleName(role), on = role in resolved.roles, enabled = enabled) { onRole(role) }
                        Spacer(Modifier.width(6.dp))
                    }
                }
            }
            event.timings.forEach { t ->
                Spacer(Modifier.height(6.dp))
                if (t.kind == "hourOfDay") {
                    HourPicker(t.en, NotifyCatalog.timing(event.id, t.key, prefs), enabled, inset = false) { onTiming(t.key, it) }
                } else {
                    NumberPicker(
                        t.en, NotifyCatalog.timing(event.id, t.key, prefs), t.min, t.max,
                        unit = if (t.kind == "hours") "h" else "min", enabled = enabled,
                    ) { onTiming(t.key, it) }
                }
            }
        } else {
            Spacer(Modifier.height(4.dp))
            Txt("Off everywhere", Type.chip, T.inkFaint, uppercase = true)
        }
    }
}

@Composable
private fun Channel(label: String, on: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Txt(label, Type.chip.copy(fontSize = 9.sp), T.inkFaint, uppercase = true)
        Switch(checked = on, enabled = enabled, onCheckedChange = onChange)
    }
}

@Composable
private fun Chip(label: String, on: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        shape = T.pill,
        color = if (on) T.slab else T.surface,
        border = if (on) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
        modifier = if (enabled) Modifier.clickable(onClick = onClick) else Modifier,
    ) {
        Txt(
            label, Type.chip.copy(fontSize = 10.sp),
            if (on) T.onSlab else T.inkMuted,
            Modifier.padding(horizontal = 10.dp, vertical = 6.dp), maxLines = 1,
        )
    }
}

/** A row of the day's hours; the chosen one is filled. */
@Composable
private fun HourPicker(label: String, value: Int, enabled: Boolean, inset: Boolean = true, onPick: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = if (inset) T.gutter else 0.dp, vertical = if (inset) 10.dp else 0.dp)) {
        Txt(label, Type.chip, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            (0 until 24).forEach { h ->
                Chip(hourLabel(h), on = h == value, enabled = enabled) { onPick(h) }
                Spacer(Modifier.width(6.dp))
            }
        }
    }
}

/** A number with a minus and a plus, clamped to the catalogue's range. */
@Composable
private fun NumberPicker(label: String, value: Int, min: Int, max: Int, unit: String, enabled: Boolean, onPick: (Int) -> Unit) {
    val step = if (unit == "h") 1 else if (max > 120) 15 else 5
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Txt(label, Type.caption, T.inkMuted, Modifier.weight(1f), maxLines = 1)
        Chip("−", on = false, enabled = enabled && value > min) { onPick((value - step).coerceAtLeast(min)) }
        Spacer(Modifier.width(8.dp))
        Txt("$value $unit", Type.label.copy(fontSize = 13.sp), T.ink, maxLines = 1)
        Spacer(Modifier.width(8.dp))
        Chip("+", on = false, enabled = enabled && value < max) { onPick((value + step).coerceAtMost(max)) }
    }
}

private fun roleName(role: String): String = when (role) {
    "Receptionist" -> "Reception"
    else -> role
}

private fun hourLabel(h: Int): String {
    val hour = if (h % 12 == 0) 12 else h % 12
    return "$hour ${if (h < 12) "AM" else "PM"}"
}

@Suppress("unused")
private val keepImports = listOf(RoundedCornerShape(0.dp), Modifier.background(androidx.compose.ui.graphics.Color.Transparent), Arrangement.Start)
