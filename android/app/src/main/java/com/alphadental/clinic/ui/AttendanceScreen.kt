package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.PayrollClient
import com.alphadental.clinic.data.Attendance
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Who is in the building, and who has been — for the owner who is not there.
 *
 * Two halves. The top is today, live: on shift, late, gone home, not yet in, day off — the
 * question asked from the car at ten past one. The bottom is the period: days worked, hours,
 * lateness and absences per person, drawn from the same server figures the desk's payroll and
 * the weekly brief use, so this screen and the website never quote different hours at anyone.
 *
 * Read-only on purpose. Correcting a punch, approving overtime and setting someone's hours are
 * desk conversations with a person in front of you; the website has them.
 */
@Composable
fun AttendanceScreen(
    roster: List<Attendance.RosterRow>,
    rosterLoaded: Boolean,
    rosterError: String?,
    payroll: PayrollClient.Payroll?,
    payrollLoading: Boolean,
    payrollError: String?,
    /** "week", "month" or "last". */
    range: String,
    /** Whether the person may see money; hours are for anyone with the screen. */
    showPay: Boolean,
    arabic: Boolean,
    onRange: (String) -> Unit,
    onRefresh: () -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }

    val onShift = roster.count { it.state == Attendance.State.ON_SHIFT }
    val late = roster.count { it.state == Attendance.State.NOT_ARRIVED || (it.state == Attendance.State.ON_SHIFT && it.lateMinutes > 0) }
    val done = roster.count { it.state == Attendance.State.DONE }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp),
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (arabic) "الحضور" else "Attendance",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "من في العيادة الآن، ومن كان" else "Who is in right now, and who has been",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
            }

            RefreshBox(refreshing = payrollLoading && payroll != null, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    // --- today ---
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            StatTile(onShift.toString(), if (arabic) "في العيادة" else "On shift", tint = if (onShift > 0) Alpha.Green else Alpha.Slate900, modifier = Modifier.weight(1f))
                            StatTile(late.toString(), if (arabic) "متأخر" else "Late", tint = if (late > 0) Alpha.DangerText else Alpha.Slate900, modifier = Modifier.weight(1f))
                            StatTile(done.toString(), if (arabic) "أنهى يومه" else "Done", modifier = Modifier.weight(1f))
                        }
                    }
                    rosterError?.let { item { LoadErrorBanner(it, arabic, onRefresh) } }
                    item { SectionHeading(if (arabic) "اليوم" else "TODAY") }
                    when {
                        !rosterLoaded && rosterError == null -> item {
                            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                            }
                        }
                        roster.isEmpty() -> item {
                            EmptyState(if (arabic) "لا يوجد موظفون مسجلون بعد." else "No staff on the list yet.")
                        }
                        else -> items(roster, key = { it.member.id }) { row -> RosterCard(row, arabic) }
                    }

                    // --- the period ---
                    item {
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                            SectionHeading(if (arabic) "الساعات" else "HOURS", modifier = Modifier.weight(1f))
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            RangeChip(if (arabic) "هذا الأسبوع" else "This week", range == "week") { onRange("week") }
                            RangeChip(if (arabic) "هذا الشهر" else "This month", range == "month") { onRange("month") }
                            RangeChip(if (arabic) "الشهر الماضي" else "Last month", range == "last") { onRange("last") }
                        }
                    }
                    payrollError?.let { item { LoadErrorBanner(it, arabic, onRefresh) } }
                    when {
                        payrollLoading && payroll == null && payrollError == null -> item {
                            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                            }
                        }
                        payroll != null && payroll.staff.isEmpty() -> item {
                            EmptyState(if (arabic) "لا توجد ساعات مسجلة في هذه الفترة." else "No hours recorded in this period.")
                        }
                        payroll != null -> {
                            items(payroll.staff, key = { "p-${it.staffId}-${it.name}" }) { pay -> HoursCard(pay, showPay, arabic) }
                            if (payroll.notes.isNotEmpty()) item {
                                Text(
                                    payroll.notes.joinToString("\n"),
                                    fontSize = 11.5.sp,
                                    color = Alpha.Slate400,
                                    modifier = Modifier.padding(top = 4.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RangeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Ink else Alpha.Card,
        border = if (selected) null else BorderStroke(1.dp, Alpha.Slate200),
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color.White else Alpha.Slate700,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun RosterCard(row: Attendance.RosterRow, arabic: Boolean) {
    val (tint, label) = when (row.state) {
        Attendance.State.ON_SHIFT -> Alpha.Green to (if (arabic) "في العيادة" else "On shift")
        Attendance.State.DONE -> Alpha.Slate500 to (if (arabic) "أنهى يومه" else "Done")
        Attendance.State.NOT_ARRIVED -> Alpha.DangerText to (if (arabic) "لم يصل" else "Not arrived")
        Attendance.State.EXPECTED -> Alpha.Slate500 to (if (arabic) "متوقع" else "Expected")
        Attendance.State.DAY_OFF -> Alpha.Slate400 to (if (arabic) "إجازة" else "Day off")
    }
    val detail = when (row.state) {
        Attendance.State.ON_SHIFT -> buildString {
            append(if (arabic) "منذ " else "since ").append(clock(row.punch!!.checkInMillis))
            append(" · ").append(duration(row.minutesToday, arabic))
            if (row.lateMinutes > 0) append(" · ").append(if (arabic) "تأخر ${row.lateMinutes} د" else "${row.lateMinutes} min late")
        }
        Attendance.State.DONE -> buildString {
            append(clock(row.punch!!.checkInMillis))
            row.punch.checkOutMillis?.let { append(" – ").append(clock(it)) }
            append(" · ").append(duration(row.minutesToday, arabic))
            if (row.lateMinutes > 0) append(" · ").append(if (arabic) "تأخر ${row.lateMinutes} د" else "${row.lateMinutes} min late")
        }
        Attendance.State.NOT_ARRIVED ->
            (if (arabic) "كان متوقعاً ${row.expected!!.start}" else "was due at ${row.expected!!.start}") +
                " · " + (if (arabic) "${row.lateMinutes} د" else "${row.lateMinutes} min")
        Attendance.State.EXPECTED -> if (arabic) "متوقع ${row.expected!!.start}" else "due at ${row.expected!!.start}"
        Attendance.State.DAY_OFF -> if (row.member.hasSchedule) "" else if (arabic) "لم تُحدد ساعاته" else "no hours set"
    }

    AlphaCard(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(tint.copy(alpha = if (Alpha.dark) .22f else .12f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    row.member.name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = tint,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    row.member.name.ifBlank { "—" },
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate900,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOf(row.member.role, detail).filter { it.isNotBlank() }.joinToString(" · "),
                    fontSize = 12.sp,
                    color = Alpha.Slate500,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            Surface(shape = Alpha.PillShape, color = tint.copy(alpha = if (Alpha.dark) .22f else .12f)) {
                Text(label, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, color = tint, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
            }
        }
    }
}

@Composable
private fun HoursCard(pay: PayrollClient.StaffPay, showPay: Boolean, arabic: Boolean) {
    AlphaCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(pay.name, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(pay.role, fontSize = 12.sp, color = Alpha.Slate500)
                }
                Text(
                    duration(pay.minutesWorked, arabic),
                    fontSize = 17.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Fact(if (arabic) "${pay.daysWorked} يوم" else "${pay.daysWorked} day${if (pay.daysWorked == 1) "" else "s"}", Alpha.Slate100, Alpha.Slate700)
                if (pay.lateMinutes > 0) Fact(if (arabic) "تأخير ${duration(pay.lateMinutes, arabic)}" else "late ${duration(pay.lateMinutes, arabic)}", Alpha.WarnBg, Alpha.WarnText)
                if (pay.absentDays > 0) Fact(if (arabic) "غياب ${pay.absentDays}" else "${pay.absentDays} absent", Alpha.DangerSoft, Alpha.DangerText)
                if (pay.overtimePendingMinutes > 0) Fact(if (arabic) "إضافي معلّق ${duration(pay.overtimePendingMinutes, arabic)}" else "OT pending ${duration(pay.overtimePendingMinutes, arabic)}", Alpha.Slate100, Alpha.Slate600)
                if (!pay.hasSchedule) Fact(if (arabic) "بدون ساعات محددة" else "no hours set", Alpha.Slate50, Alpha.Slate400)
            }
            if (showPay && pay.estimatedPay > 0) {
                Spacer(Modifier.height(6.dp))
                Text(
                    (if (arabic) "الأجر التقديري " else "Estimated pay ") + "${pay.estimatedPay.toInt()} ${if (arabic) "ج.م" else "EGP"}",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.Slate600,
                )
            }
        }
    }
}

@Composable
private fun Fact(label: String, bg: Color, fg: Color) {
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(label, fontSize = 10.5.sp, fontWeight = FontWeight.Bold, color = fg, maxLines = 1, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
    }
}

private fun clock(millis: Long): String = SimpleDateFormat("h:mm a", Locale.ENGLISH).format(Date(millis))

private fun duration(minutes: Int, arabic: Boolean): String {
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h == 0 -> if (arabic) "$m د" else "${m}m"
        m == 0 -> if (arabic) "$h س" else "${h}h"
        else -> if (arabic) "$h س $m د" else "${h}h ${m}m"
    }
}
