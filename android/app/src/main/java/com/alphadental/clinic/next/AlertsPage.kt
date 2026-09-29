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
 * Alerts & reports — the same page as the website's, on the phone.
 *
 * Three switches per alert (bell, push, WhatsApp), the reports with their own sections, detail,
 * comparisons, language and PDF, a "Send" choice (as it happens, hourly, with the evening), the
 * WhatsApp recipients with a number each, and the personal mutes at the bottom. Every value is
 * written into the same `alertPreferences` map the website writes, through the catalogue's own
 * resolver, so a switch flipped here reads the same in the browser.
 */
@Composable
internal fun AlertsPage(state: SettingsState, onBack: () -> Unit, actions: SettingsActions) {
    val stored = state.alertPrefs
    var form by remember(stored) { mutableStateOf(stored ?: emptyMap()) }
    val dirty = stored != null && form != stored
    val onCount = NotifyCatalog.EVENTS.count { e -> NotifyCatalog.resolve(e.id, form)?.any == true }

    fun mapAt(key: String): Map<String, Any?> =
        (form[key] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()

    fun subMap(parent: Map<String, Any?>, id: String): Map<String, Any?> =
        (parent[id] as? Map<*, *>)?.mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }?.toMap().orEmpty()

    fun patchEvent(id: String, edit: (Map<String, Any?>) -> Map<String, Any?>) {
        val events = mapAt("events")
        form = form + ("events" to (events + (id to edit(subMap(events, id)))))
    }

    fun patchTiming(id: String, key: String, value: Int) {
        val timings = mapAt("timings")
        form = form + ("timings" to (timings + (id to (subMap(timings, id) + (key to value)))))
    }

    fun patchQuiet(key: String, value: Any) {
        form = form + ("quietHours" to (mapAt("quietHours") + (key to value)))
    }

    /** `reports.<id>.<key>`; a key of the form `sections.money` goes one level deeper. */
    fun patchReport(id: String, key: String, value: Any) {
        val reports = mapAt("reports")
        val current = subMap(reports, id)
        val next = if (key.startsWith("sections.")) {
            val sections = subMap(current, "sections")
            current + ("sections" to (sections + (key.removePrefix("sections.") to value)))
        } else {
            current + (key to value)
        }
        form = form + ("reports" to (reports + (id to next)))
    }

    fun patchPerson(uid: String, key: String, value: Any) {
        val people = mapAt("people")
        form = form + ("people" to (people + (uid to (subMap(people, uid) + (key to value)))))
    }

    val quiet = form["quietHours"] as? Map<*, *>
    val quietOn = quiet?.get("enabled") == true
    val quietFrom = (quiet?.get("fromHour") as? Number)?.toInt() ?: 22
    val quietTo = (quiet?.get("toHour") as? Number)?.toInt() ?: 8

    // Everyone with a login, plus whoever is looking at the page if they are not on the list.
    val myUid = state.who?.uid.orEmpty()
    val people = remember(state.staff, myUid) {
        val rows = state.staff.filter { it.uid.isNotBlank() }.map { Triple(it.uid, it.name, it.role) }.toMutableList()
        if (myUid.isNotBlank() && rows.none { it.first == myUid }) rows.add(Triple(myUid, "", "Admin"))
        val order = mapOf("Owner" to 0, "Admin" to 1, "Dentist" to 2, "Receptionist" to 3, "Assistant" to 4)
        rows.sortedWith(compareBy({ order[it.third] ?: 9 }, { it.second }))
    }

    SettingsPage(
        title = Section.Alerts.label,
        caption = "$onCount of ${NotifyCatalog.EVENTS.size} switched on",
        state = state,
        onBack = onBack,
        ready = stored != null,
    ) {
        item {
            Txt(
                "Every alert, with three switches: the bell inside the app, the phone, and WhatsApp. " +
                    "The reports go out on WhatsApp as full reports at the hour you choose. Your own mutes are at the bottom.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp), maxLines = 5,
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

        // ---- WhatsApp recipients: a number per person, and a personal off switch.
        item { SectionLabel("WhatsApp recipients") }
        item {
            Txt(
                "Each person's WhatsApp number, and whether they get WhatsApp at all. A person with no number " +
                    "gets the phone and the bell only. The owner falls back to the number on WhatsApp setup.",
                Type.caption, T.inkFaint,
                Modifier.padding(start = T.gutter, end = T.gutter, bottom = 8.dp), maxLines = 4,
            )
        }
        item {
            RowGroup {
                if (people.isEmpty()) {
                    Txt("Nobody has been added on Staff & logins yet.", Type.caption, T.inkFaint, Modifier.padding(T.gutter), maxLines = 2)
                }
                people.forEachIndexed { i, (uid, name, role) ->
                    if (i > 0) Rule()
                    val person = NotifyCatalog.person(uid, form)
                    SettingsToggle(
                        title = name.ifBlank { roleName(role) },
                        caption = if (person.enabled) "${roleName(role)} · gets WhatsApp" else "${roleName(role)} · no WhatsApp",
                        checked = person.enabled, enabled = state.canEdit,
                    ) { patchPerson(uid, "whatsapp", it) }
                    SettingsField(
                        label = "WhatsApp number",
                        value = person.phone,
                        onChange = { patchPerson(uid, "phone", it) },
                        enabled = state.canEdit,
                        hint = "01xxxxxxxxx",
                    )
                }
            }
        }

        // ---- The catalogue, group by group.
        NotifyCatalog.GROUPS.forEach { group ->
            val events = NotifyCatalog.eventsIn(group.id)
            if (events.isEmpty()) return@forEach
            item { SectionLabel(group.en) }
            item {
                Txt(group.noteEn, Type.caption, T.inkFaint, Modifier.padding(start = T.gutter, end = T.gutter, bottom = 8.dp), maxLines = 4)
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
                            onBatching = { mode -> patchEvent(event.id) { it + ("batching" to mode) } },
                            onReport = { key, value -> patchReport(event.id, key, value) },
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
                    val clinicHasIt = resolved?.any == true
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
    onBatching: (String) -> Unit,
    onReport: (String, Any) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Txt(event.en, Type.rowName, T.ink, maxLines = 2)
                Spacer(Modifier.height(2.dp))
                Txt(event.whenEn, Type.caption, T.inkMuted, maxLines = 4)
            }
            Spacer(Modifier.width(10.dp))
            Channel("Bell", resolved.bell, enabled) { onChannel("bell", it) }
            Spacer(Modifier.width(8.dp))
            Channel("Push", resolved.push, enabled) { onChannel("push", it) }
            Spacer(Modifier.width(8.dp))
            if (event.waReady) {
                Channel("WhatsApp", resolved.whatsapp, enabled) { onChannel("whatsapp", it) }
            } else {
                // Raised by the Cloud Functions, which cannot reach a WhatsApp gateway yet.
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Txt("WhatsApp", Type.chip.copy(fontSize = 9.sp), T.inkFaint, uppercase = true)
                    Chip("—", on = false, enabled = false) {}
                }
            }
        }
        if (resolved.any) {
            // A report's own options.
            val report = event.report
            if (report != null && report != "dentistDay") {
                val rp = NotifyCatalog.reportPrefs(event.id, prefs)
                Spacer(Modifier.height(8.dp))
                if (report != "summary" && report != "payroll") {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                        Txt("Sections", Type.chip, T.inkFaint, uppercase = true)
                        Spacer(Modifier.width(8.dp))
                        NotifyCatalog.REPORT_SECTIONS.forEach { key ->
                            val on = rp.sections[key] == true
                            Chip(sectionName(key), on = on, enabled = enabled) { onReport("sections.$key", !on) }
                            Spacer(Modifier.width(6.dp))
                        }
                    }
                    if (rp.sections["money"] == true) {
                        Spacer(Modifier.height(6.dp))
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                            Txt("Money detail", Type.chip, T.inkFaint, uppercase = true)
                            Spacer(Modifier.width(8.dp))
                            NotifyCatalog.MONEY_DETAILS.forEach { d ->
                                Chip(detailName(d), on = rp.moneyDetail == d, enabled = enabled) { onReport("moneyDetail", d) }
                                Spacer(Modifier.width(6.dp))
                            }
                            Spacer(Modifier.width(6.dp))
                            Chip("Compare with last week", on = rp.comparisons, enabled = enabled) { onReport("comparisons", !rp.comparisons) }
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                    Txt("Language", Type.chip, T.inkFaint, uppercase = true)
                    Spacer(Modifier.width(8.dp))
                    Chip("العربية", on = rp.language == "ar", enabled = enabled) { onReport("language", "ar") }
                    Spacer(Modifier.width(6.dp))
                    Chip("English", on = rp.language == "en", enabled = enabled) { onReport("language", "en") }
                    if (report != "summary") {
                        Spacer(Modifier.width(12.dp))
                        Chip("Attach PDF", on = rp.pdf, enabled = enabled) { onReport("pdf", !rp.pdf) }
                    }
                }
            }

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
                when (t.kind) {
                    "hourOfDay" -> HourPicker(t.en, NotifyCatalog.timing(event.id, t.key, prefs), enabled, inset = false) { onTiming(t.key, it) }
                    "weekday" -> WeekdayPicker(t.en, NotifyCatalog.timing(event.id, t.key, prefs), enabled) { onTiming(t.key, it) }
                    else -> NumberPicker(
                        t.en, NotifyCatalog.timing(event.id, t.key, prefs), t.min, t.max,
                        unit = unitFor(t.kind), enabled = enabled,
                        step = stepFor(t.kind, t.max),
                    ) { onTiming(t.key, it) }
                }
            }
            // How the buzz arrives. Reports have an hour of their own; the bell is always immediate.
            if (event.waReady && event.report == null && (resolved.push || resolved.whatsapp)) {
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                    Txt("Send", Type.chip, T.inkFaint, uppercase = true)
                    Spacer(Modifier.width(8.dp))
                    NotifyCatalog.BATCHING.forEach { mode ->
                        Chip(batchingName(mode), on = resolved.batching == mode, enabled = enabled) { onBatching(mode) }
                        Spacer(Modifier.width(6.dp))
                    }
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

private val WEEKDAYS = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

/** The seven days; the chosen one is filled. Sunday first, as the catalogue counts. */
@Composable
private fun WeekdayPicker(label: String, value: Int, enabled: Boolean, onPick: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Txt(label, Type.chip, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.horizontalScroll(rememberScrollState())) {
            WEEKDAYS.forEachIndexed { i, d ->
                Chip(d, on = i == value, enabled = enabled) { onPick(i) }
                Spacer(Modifier.width(6.dp))
            }
        }
    }
}

/** A number with a minus and a plus, clamped to the catalogue's range. */
@Composable
private fun NumberPicker(label: String, value: Int, min: Int, max: Int, unit: String, enabled: Boolean, step: Int, onPick: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Txt(label, Type.caption, T.inkMuted, Modifier.weight(1f), maxLines = 1)
        Chip("−", on = false, enabled = enabled && value > min) { onPick((value - step).coerceAtLeast(min)) }
        Spacer(Modifier.width(8.dp))
        Txt(if (unit.isBlank()) "$value" else "$value $unit", Type.label.copy(fontSize = 13.sp), T.ink, maxLines = 1)
        Spacer(Modifier.width(8.dp))
        Chip("+", on = false, enabled = enabled && value < max) { onPick((value + step).coerceAtMost(max)) }
    }
}

private fun unitFor(kind: String): String = when (kind) {
    "hours" -> "h"
    "percent" -> "%"
    "egp" -> "EGP"
    "days" -> "days"
    "count", "dayOfMonth" -> ""
    else -> "min"
}

private fun stepFor(kind: String, max: Int): Int = when (kind) {
    "hours", "days", "dayOfMonth" -> 1
    "percent" -> 5
    "egp" -> if (max > 100000) 500 else 100
    "count" -> 5
    else -> if (max > 120) 15 else 5
}

private fun roleName(role: String): String = when (role) {
    "Receptionist" -> "Reception"
    else -> role
}

private fun sectionName(key: String): String = when (key) {
    "money" -> "Money"
    "appointments" -> "Appointments"
    "patients" -> "Patients & leads"
    else -> "Team"
}

private fun detailName(d: String): String = when (d) {
    "totals" -> "Totals"
    "dentists" -> "Per dentist"
    else -> "Full"
}

private fun batchingName(mode: String): String = when (mode) {
    "hourly" -> "Once an hour"
    "daily" -> "With the evening"
    else -> "As it happens"
}

private fun hourLabel(h: Int): String {
    val hour = if (h % 12 == 0) 12 else h % 12
    return "$hour ${if (h < 12) "AM" else "PM"}"
}

@Suppress("unused")
private val keepImports = listOf(RoundedCornerShape(0.dp), Modifier.background(androidx.compose.ui.graphics.Color.Transparent), Arrangement.Start)
