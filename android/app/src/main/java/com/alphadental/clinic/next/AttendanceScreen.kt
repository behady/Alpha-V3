package com.alphadental.clinic.next

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.PayrollClient
import com.alphadental.clinic.data.Attendance
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
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Attendance.
 *
 * This phone's own shift is at the top and belongs to everyone — clocking in is
 * not an admin act, and a receptionist who may not see the roster still has to
 * start their day. Everything below it is the clinic's, and appears only for
 * whoever the website would show it to.
 */
@Composable
fun AttendanceScreen(
    state: AttendanceState,
    onBack: () -> Unit,
    onPunch: () -> Unit,
    onPeriod: (Period) -> Unit,
    /** The team half. Null in the preview. */
    team: TeamActions? = null,
) {
    if (state.editingStaff != null && team != null) StaffPaySheet(state, team)

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Attendance",
            eyebrow = when {
                state.loading -> "The clinic's day"
                !state.canSeeEveryone -> "Your shift"
                state.missing > 0 -> "${state.missing} not in yet"
                state.onShift > 0 -> "${state.onShift} on shift"
                else -> "Nobody clocked in"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
            stats = if (state.loading || !state.canSeeEveryone) emptyList() else listOf(
                Stat("On shift", state.onShift.toString()),
                Stat("Late", state.late.toString()),
                Stat("Not in", state.missing.toString()),
                Stat("Off", state.off.toString()),
            ),
        )

        if (state.loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
            return
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            state.error?.let { item { Banner(it, T.dangerTint, T.danger) } }

            item { SectionLabel("Your shift") }
            item { MyShiftCard(state, onPunch) }

            if (!state.canSeeEveryone) {
                item {
                    Txt(
                        "Everybody else's hours are an owner or admin view. Yours are always yours.",
                        Type.caption, T.inkFaint,
                        Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
                        maxLines = 2,
                    )
                }
                return@LazyColumn
            }

            item { SectionLabel("Today") }
            item {
                RowGroup {
                    if (state.roster.isEmpty()) {
                        Txt(
                            "Nobody is on the staff list yet.",
                            Type.body, T.inkMuted,
                            Modifier.padding(horizontal = T.gutter, vertical = 15.dp),
                        )
                    }
                    state.roster.forEachIndexed { i, row ->
                        if (i > 0) Rule()
                        RosterRow(row)
                    }
                }
            }

            item { SectionLabel("Hours and pay") }
            item { Periods(state.period, onPeriod) }
            item { Payroll(state) }

            if (team != null) team(state, team)
        }
    }
}

/**
 * The one control that belongs to whoever is holding the phone.
 *
 * A single button that knows which of the two things it is. Two buttons, one of
 * them always wrong, is how people clock in twice.
 */
@Composable
private fun MyShiftCard(state: AttendanceState, onPunch: () -> Unit) {
    val mine = state.mine
    RowGroup {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt(
                    if (mine.on) "On shift" else "Not clocked in",
                    Type.heading,
                    if (mine.on) T.ok else T.ink,
                )
                Spacer(Modifier.height(3.dp))
                Txt(
                    if (mine.on) {
                        "Started ${clock(mine.openSince ?: 0)} · ${spell(mine.minutes)} so far"
                    } else {
                        "Your day has not started yet"
                    },
                    Type.caption, T.inkMuted, maxLines = 2,
                )
            }
            Spacer(Modifier.width(12.dp))
            Surface(
                shape = T.pill,
                color = if (mine.on) T.surface else T.accent,
                border = if (mine.on) BorderStroke(1.dp, T.lineStrong) else null,
                modifier = Modifier.clickable(enabled = !mine.busy, onClick = onPunch),
            ) {
                Box(Modifier.padding(horizontal = 20.dp, vertical = 13.dp), contentAlignment = Alignment.Center) {
                    if (mine.busy) {
                        CircularProgressIndicator(
                            color = if (mine.on) T.inkFaint else T.onAccent,
                            strokeWidth = 2.dp, modifier = Modifier.size(17.dp),
                        )
                    } else {
                        Txt(
                            if (mine.on) "Clock out" else "Clock in",
                            Type.label.copy(fontSize = 13.sp),
                            if (mine.on) T.ink else T.onAccent,
                        )
                    }
                }
            }
        }
        mine.error?.let {
            Rule()
            Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp)) {
                Txt(it, Type.caption, T.danger, maxLines = 3)
                if (mine.needsLocation) {
                    // Asked here rather than at launch. A cold permission dialog
                    // the moment the app opens gets refused; one that arrives
                    // after the sentence explaining why does not.
                    Spacer(Modifier.height(10.dp))
                    val ask = rememberLauncherForActivityResult(
                        ActivityResultContracts.RequestPermission()
                    ) { granted -> if (granted) onPunch() }
                    Surface(
                        shape = T.pill,
                        color = T.slab,
                        modifier = Modifier.clickable { ask.launch(Manifest.permission.ACCESS_FINE_LOCATION) },
                    ) {
                        Txt(
                            "Allow location", Type.label.copy(fontSize = 12.sp), T.onSlab,
                            Modifier.padding(horizontal = 16.dp, vertical = 9.dp),
                        )
                    }
                }
            }
        }
        if (mine.staffId.isBlank()) {
            Rule()
            Txt(
                // Worth saying: the punch still records, but it will not line up
                // with a person on the roster or in the pay figures.
                "This account is not linked to a staff record, so the shift will not appear against " +
                    "a name on the roster. An admin can link it on the website.",
                Type.caption, T.warn,
                Modifier.padding(horizontal = T.gutter, vertical = 13.dp),
                maxLines = 4,
            )
        }
    }
}

/** One person, today. The stripe is whether they are here. */
@Composable
private fun RosterRow(row: Attendance.RosterRow) {
    val stripe = when (row.state) {
        Attendance.State.ON_SHIFT -> if (row.lateMinutes > 0) T.warn else T.ok
        Attendance.State.NOT_ARRIVED -> T.danger
        Attendance.State.EXPECTED -> T.lineStrong
        Attendance.State.DONE -> T.lineStrong
        Attendance.State.DAY_OFF -> Color.Transparent
    }

    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(stripe))
        Row(
            Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt(row.member.name.ifBlank { "Unnamed" }, Type.rowName, T.ink, maxLines = 1)
                Spacer(Modifier.height(3.dp))
                Txt(
                    listOfNotNull(
                        row.member.role.takeIf { it.isNotBlank() },
                        row.expected?.let { "${it.start}–${it.end}" },
                        row.punch?.checkInMillis?.let { "in at ${clock(it)}" },
                        row.minutesToday.takeIf { it > 0 }?.let { spell(it) },
                    ).joinToString(" · "),
                    Type.caption, T.inkMuted, maxLines = 2,
                )
            }
            Spacer(Modifier.width(10.dp))
            Column(horizontalAlignment = Alignment.End) {
                StateChip(row.state)
                if (row.lateMinutes > 0 && row.state != Attendance.State.DAY_OFF) {
                    Spacer(Modifier.height(4.dp))
                    Txt("${row.lateMinutes} min late", Type.chip, T.warn, uppercase = true)
                }
                if (!row.member.hasSchedule) {
                    Spacer(Modifier.height(4.dp))
                    // Said, because everything about this row is guesswork
                    // otherwise — the lateness included.
                    Txt("default hours", Type.chip, T.inkFaint, uppercase = true)
                }
            }
        }
    }
}

@Composable
private fun StateChip(state: Attendance.State) {
    val (label, fill, ink) = when (state) {
        Attendance.State.ON_SHIFT -> Triple("In", Color(0xFFA7F3D0), Color(0xFF065F46))
        Attendance.State.DONE -> Triple("Done", Color(0xFFE2E8F0), Color(0xFF475569))
        Attendance.State.NOT_ARRIVED -> Triple("Not in", Color(0xFFFFE4E6), Color(0xFFE11D48))
        Attendance.State.EXPECTED -> Triple("Later", Color(0xFFE0E7FF), Color(0xFF3730A3))
        Attendance.State.DAY_OFF -> Triple("Off", Color(0xFFF1F5F9), Color(0xFF94A3B8))
    }
    Chip(label, fill, ink)
}

@Composable
private fun Periods(current: Period, onPeriod: (Period) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Period.entries.forEach { p ->
            val on = p == current
            Surface(
                shape = T.pill,
                color = if (on) T.slab else T.surface,
                border = if (on) null else BorderStroke(1.dp, T.line),
                modifier = Modifier.clickable { onPeriod(p) },
            ) {
                Txt(
                    p.label, Type.label.copy(fontSize = 12.sp),
                    if (on) T.onSlab else T.inkMuted,
                    Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}

/**
 * The pay sheet, as the server computed it.
 *
 * Drawn, never derived. The notes the server attaches are printed word for word
 * — they are the qualifications on the figures, and paraphrasing a qualification
 * is how it stops being one.
 */
@Composable
private fun Payroll(state: AttendanceState) {
    when {
        state.payrollLoading -> {
            RowGroup {
                Box(
                    Modifier.fillMaxWidth().padding(vertical = 26.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                }
            }
        }

        state.payrollError != null -> Banner(state.payrollError, T.surfaceSoft, T.inkBody)

        state.payroll == null -> RowGroup {
            Txt(
                "Nothing to show for this period.",
                Type.body, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 15.dp),
            )
        }

        else -> {
            val pay = state.payroll
            Column {
                RowGroup {
                    Fact("Labour cost", "${money(pay.labourCost)} EGP")
                    if (pay.overtimePendingMinutes > 0) {
                        Rule()
                        Fact(
                            "Overtime awaiting approval",
                            "${spell(pay.overtimePendingMinutes)} · ${money(pay.overtimePendingCost)} EGP",
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
                RowGroup {
                    pay.staff.forEachIndexed { i, person ->
                        if (i > 0) Rule()
                        Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Txt(person.name, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
                                Spacer(Modifier.width(10.dp))
                                Txt(
                                    if (person.hasSchedule) "${money(person.estimatedPay)} EGP" else "no rate",
                                    Type.label.copy(fontSize = 13.sp),
                                    if (person.hasSchedule) T.ink else T.inkFaint,
                                )
                            }
                            Spacer(Modifier.height(3.dp))
                            Txt(
                                listOfNotNull(
                                    "${person.daysWorked} days",
                                    spell(person.minutesWorked),
                                    person.lateMinutes.takeIf { it > 0 }?.let { "${it} min late" },
                                    person.absentDays.takeIf { it > 0 }?.let { "$it absent" },
                                    person.overtimeApprovedMinutes.takeIf { it > 0 }
                                        ?.let { "${spell(it)} overtime" },
                                    person.overtimePendingMinutes.takeIf { it > 0 }
                                        ?.let { "${spell(it)} pending" },
                                ).joinToString(" · "),
                                Type.caption,
                                if (person.absentDays > 0) T.warn else T.inkMuted,
                                maxLines = 2,
                            )
                        }
                    }
                }
                if (pay.notes.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Column(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                        pay.notes.forEach {
                            Txt("· $it", Type.caption, T.inkFaint, maxLines = 3)
                            Spacer(Modifier.height(4.dp))
                        }
                    }
                }
                Txt(
                    "These come from the server, not from this phone, so they cannot disagree with " +
                        "the figures at the desk. Correcting a punch is done there.",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                    maxLines = 4,
                )
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
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

/** "3h 40m", "45m". Minutes alone stop being readable somewhere around ninety. */
private fun spell(minutes: Int): String {
    if (minutes <= 0) return "0m"
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h == 0 -> "${m}m"
        m == 0 -> "${h}h"
        else -> "${h}h ${m}m"
    }
}

private fun clock(millis: Long): String =
    SimpleDateFormat("HH:mm", Locale.US).format(Date(millis))

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())
