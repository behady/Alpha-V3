package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Attendance
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** What the team half of the attendance screen can do. */
data class TeamActions(
    val editStaff: (Attendance.StaffMember) -> Unit,
    val closeStaff: () -> Unit,
    val saveStaff: (Double, Double, Double, Map<Int, Attendance.DaySchedule>) -> Unit,
    val decideOvertime: (String, Boolean) -> Unit,
)

private val DAY_NAMES = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

/**
 * The team, for whoever runs it.
 *
 * Three lists the website keeps on its Attendance page and the phone did not have: what each
 * dentist is on and what that came to this period, the overtime nobody has said yes or no to,
 * and everybody's hours. Each one is read by anyone who may see the roster; changing a rate or a
 * schedule is an Owner-or-Admin write, because that is the rule the staff records are kept under.
 */
fun LazyListScope.team(state: AttendanceState, a: TeamActions) {
    state.staffError?.let { item { TeamBanner(it) } }

    // ---- dentists' share
    item { SectionLabel("Dentists' share · ${state.period.label.lowercase()}") }
    item {
        RowGroup {
            val dentists = state.dentists
            if (dentists.isEmpty()) {
                Txt(
                    "Nobody is marked as a dentist yet. A percentage is set on the person under " +
                        "Settings → The team.",
                    Type.body, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 15.dp), maxLines = 3,
                )
            }
            dentists.forEachIndexed { i, m ->
                if (i > 0) Rule()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Txt(m.name, Type.rowName, T.ink, maxLines = 1)
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            listOfNotNull(
                                "${trimPct(m.commissionPercentage)}% of collected work",
                                state.commissions[m.id]?.takeIf { it > 0 }?.let { "earned ${it.toLong()} EGP" }
                                    ?: "nothing collected yet",
                                m.history.lastOrNull()?.let { "was ${trimPct(it.previous)}%" },
                            ).joinToString(" · "),
                            Type.caption, T.inkMuted, maxLines = 2,
                        )
                    }
                    if (state.canEditTeam) {
                        Spacer(Modifier.width(8.dp))
                        SettingsPill("Edit") { a.editStaff(m) }
                    }
                }
            }
        }
    }

    // ---- overtime
    val pending = state.pendingOvertime
    item { SectionLabel(if (pending.isEmpty()) "Overtime" else "Overtime to decide · ${pending.size}") }
    item {
        RowGroup {
            if (pending.isEmpty()) {
                Txt(
                    "No overtime waiting on a decision this period.",
                    Type.body, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 15.dp),
                )
            }
            pending.forEachIndexed { i, (punch, member) ->
                if (i > 0) Rule()
                Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Txt(member.name, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
                        Txt("${spellMinutes(Attendance.overtimeMinutes(punch, member))} over", Type.label.copy(fontSize = 13.sp), T.warn)
                    }
                    Spacer(Modifier.height(2.dp))
                    Txt(
                        "${dayOf(punch.checkInMillis)} · worked ${spellMinutes(punch.durationMinutes)}",
                        Type.caption, T.inkMuted,
                    )
                    Spacer(Modifier.height(8.dp))
                    if (state.deciding == punch.id) {
                        Txt("Saving…", Type.caption, T.inkMuted)
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SettingsPill("Approve", solid = true) { a.decideOvertime(punch.id, true) }
                            SettingsPill("Reject") { a.decideOvertime(punch.id, false) }
                        }
                    }
                }
            }
        }
    }
    item {
        Txt(
            // The pay figures above come from the server; a decision made here changes what that
            // server returns next time, which is the honest way round.
            "Approved overtime is paid at the person's multiplier; rejected overtime is not paid. " +
                "The pay figures above re-read after each decision.",
            Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 3,
        )
    }

    // ---- schedules
    item { SectionLabel("Schedules and pay") }
    item {
        RowGroup {
            state.staff.forEachIndexed { i, m ->
                if (i > 0) Rule()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Txt(m.name, Type.rowName, T.ink, maxLines = 1)
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            listOfNotNull(
                                scheduleSummary(m),
                                m.baseSalary.takeIf { it > 0 }?.let { "${it.toLong()} EGP a month" },
                                if (m.overtimeMultiplier != 1.5) "overtime ×${trimPct(m.overtimeMultiplier)}" else null,
                            ).joinToString(" · "),
                            Type.caption, if (m.hasSchedule) T.inkMuted else T.warn, maxLines = 2,
                        )
                    }
                    if (state.canEditTeam) {
                        Spacer(Modifier.width(8.dp))
                        SettingsPill("Edit") { a.editStaff(m) }
                    }
                }
            }
        }
    }
    if (!state.canEditTeam) {
        item {
            Txt(
                "Rates and hours are changed by an Owner or Admin.",
                Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
            )
        }
    }
}

/**
 * One person's rate, salary, overtime multiplier and week.
 *
 * A changed percentage applies to work recorded from now on. Every charge already on the books
 * keeps the rate that was stamped on it when it was recorded — that is how the website behaves,
 * and it is the only behaviour that does not silently rewrite a dentist's pay for last month.
 * Individual payments can still be re-split one at a time on the website's Attendance page.
 */
@Composable
fun StaffPaySheet(state: AttendanceState, a: TeamActions) {
    val m = state.editingStaff ?: return
    var pct by remember(m.id) { mutableStateOf(trimPct(m.commissionPercentage)) }
    var salary by remember(m.id) { mutableStateOf(if (m.baseSalary > 0) m.baseSalary.toLong().toString() else "") }
    var multiplier by remember(m.id) { mutableStateOf(trimPct(m.overtimeMultiplier)) }
    var week by remember(m.id) { mutableStateOf(m.schedule) }

    val pctValue = pct.toDoubleOrNull() ?: 0.0
    val multValue = multiplier.toDoubleOrNull() ?: 1.5

    Sheet(
        title = m.name,
        caption = m.role.ifBlank { "Staff" },
        busy = state.savingStaff,
        error = state.staffError,
        action = "Save",
        ready = pctValue in 0.0..100.0 && multValue >= 1.0,
        onAction = { a.saveStaff(pctValue, salary.toDoubleOrNull() ?: 0.0, multValue, week) },
        onDismiss = a.closeStaff,
    ) {
        SheetField(
            "Commission, % of what is collected", pct,
            { pct = it.filter { c -> c.isDigit() || c == '.' } },
            numeric = true, hint = "40",
        )
        if (pctValue != m.commissionPercentage) {
            Txt(
                "From now on. Work already on the books keeps the ${trimPct(m.commissionPercentage)}% it was " +
                    "recorded at — nothing already paid is re-split.",
                Type.caption, T.accentInk, Modifier.padding(horizontal = T.gutter, vertical = 6.dp), maxLines = 3,
            )
        }
        SheetField("Base salary, per month", salary, { salary = it.filter { c -> c.isDigit() || c == '.' } }, numeric = true, hint = "0 for commission only")
        SheetField("Overtime multiplier", multiplier, { multiplier = it.filter { c -> c.isDigit() || c == '.' } }, numeric = true, hint = "1.5")

        Rule()
        Txt("The week", Type.eyebrow, T.inkFaint, Modifier.padding(start = T.gutter, end = T.gutter, top = 12.dp), uppercase = true)
        (0..6).forEach { day ->
            val d = week[day] ?: Attendance.DaySchedule(false, "13:00", "21:00")
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Txt(DAY_NAMES[day], Type.rowName, T.ink, Modifier.width(44.dp))
                Surface(
                    shape = T.pill,
                    color = if (d.active) T.slab else T.surface,
                    border = if (d.active) null else BorderStroke(1.dp, T.line),
                    modifier = Modifier.clickable { week = week + (day to d.copy(active = !d.active)) },
                ) {
                    Txt(
                        if (d.active) "In" else "Off", Type.label.copy(fontSize = 12.sp),
                        if (d.active) T.onSlab else T.inkMuted,
                        Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
                Spacer(Modifier.width(10.dp))
                if (d.active) {
                    TimeBox(d.start) { week = week + (day to d.copy(start = it)) }
                    Txt("–", Type.caption, T.inkFaint, Modifier.padding(horizontal = 6.dp))
                    TimeBox(d.end) { week = week + (day to d.copy(end = it)) }
                }
            }
        }

        if (m.history.isNotEmpty()) {
            Rule()
            Txt("Rate history", Type.eyebrow, T.inkFaint, Modifier.padding(start = T.gutter, end = T.gutter, top = 12.dp), uppercase = true)
            m.history.sortedByDescending { it.atMillis }.forEach { h ->
                Txt(
                    "${trimPct(h.previous)}% → ${trimPct(h.percentage)}% · ${dayOf(h.atMillis)}" +
                        (if (h.by.isNotBlank()) " · by ${h.by}" else ""),
                    Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 4.dp), maxLines = 2,
                )
            }
        } else {
            Txt(
                "No rate changes recorded yet. Changes made here are kept with the date and who made them.",
                Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 3,
            )
        }
    }
}

/** "HH:mm" typed straight in; anything that does not parse is left as typed and refused on save. */
@Composable
private fun TimeBox(value: String, onChange: (String) -> Unit) {
    var text by remember(value) { mutableStateOf(value) }
    androidx.compose.material3.OutlinedTextField(
        value = text,
        onValueChange = { typed ->
            text = typed.filter { it.isDigit() || it == ':' }.take(5)
            if (Regex("^\\d{2}:\\d{2}$").matches(text)) onChange(text)
        },
        singleLine = true,
        textStyle = Type.label.copy(fontSize = 13.sp, color = T.ink),
        shape = T.cardShape,
        colors = androidx.compose.material3.TextFieldDefaults.colors(
            focusedContainerColor = T.surfaceSoft, unfocusedContainerColor = T.surfaceSoft,
            focusedTextColor = T.ink, unfocusedTextColor = T.ink,
            focusedIndicatorColor = T.lineStrong, unfocusedIndicatorColor = T.line, cursorColor = T.ink,
        ),
        modifier = Modifier.width(78.dp),
    )
}

@Composable
private fun TeamBanner(text: String) {
    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
        Txt(text, Type.caption, T.danger, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 4)
    }
}

private fun scheduleSummary(m: Attendance.StaffMember): String {
    if (!m.hasSchedule) return "No hours set — the default week is assumed"
    val on = (0..6).filter { m.schedule[it]?.active == true }
    if (on.isEmpty()) return "No working days"
    val first = m.schedule[on.first()]!!
    val sameHours = on.all { m.schedule[it]?.start == first.start && m.schedule[it]?.end == first.end }
    val days = if (on.size >= 2 && on == (on.first()..on.last()).toList()) "${DAY_NAMES[on.first()]}–${DAY_NAMES[on.last()]}"
    else on.joinToString(" ") { DAY_NAMES[it] }
    return if (sameHours) "$days ${first.start}–${first.end}" else "$days, hours vary"
}

private fun trimPct(v: Double): String = if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

private fun spellMinutes(minutes: Int): String {
    if (minutes <= 0) return "0m"
    val h = minutes / 60
    val m = minutes % 60
    return if (h > 0) "${h}h ${m}m" else "${m}m"
}

private fun dayOf(millis: Long): String =
    java.text.SimpleDateFormat("EEE d MMM", java.util.Locale.US).format(java.util.Date(millis))
