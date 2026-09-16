package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Person
import androidx.compose.ui.graphics.Color
import com.alphadental.clinic.next.design.BigAction
import com.alphadental.clinic.next.design.IconTile
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.design.BrandMark
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabFigure
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * The dashboard.
 *
 * It opens on the day's takings, because that is the number a clinic opens the
 * app to see. Whose day it is moved to the mark and the avatar on the top row,
 * where an app's identity normally lives — a greeting is pleasant and tells
 * nobody anything.
 *
 * Below the slab the screen goes quiet: one card for whoever is in the chair,
 * then ruled rows, then four tools. That is the whole hierarchy, and it is the
 * point — the old dashboard had ten shortcuts and three stat tiles competing
 * with the appointments, so nothing read first.
 */
@Composable
fun DashboardScreen(
    state: Dashboard,
    onCheckOut: (Visit) -> Unit,
    onOpenVisit: (Visit) -> Unit = {},
    onClock: () -> Unit = {},
    onBook: () -> Unit = {},
    onLeads: () -> Unit = {},
    onReports: () -> Unit = {},
    onBell: () -> Unit = {},
    onAccount: () -> Unit = {},
    /** The signed-in person's shift, for the pill on the slab. Null while unknown. */
    shift: MyShift? = null,
    onPunch: () -> Unit = {},
    onNewPatient: (() -> Unit)? = null,
    onQuickPay: (() -> Unit)? = null,
    /** A day tapped on the strip: the diary opens on it. */
    onPickDay: (String) -> Unit = {},
) {
    Box(Modifier.fillMaxSize().background(T.ground)) {

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = T.barClearance),
        ) {
            item { DashboardSlab(state, onBell, onAccount, shift, onPunch, onClock) }

            state.error?.let { message ->
                item { Notice(message) }
            }

            // ---- Daily overview: income beside a two-by-two of the day's stages.
            item {
                Txt(
                    "Daily overview",
                    Type.eyebrow.copy(letterSpacing = 1.6.sp),
                    T.ink,
                    Modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp),
                    uppercase = true,
                )
            }
            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    IncomeCard(state, Modifier.weight(1f))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MiniStat(Icons.Filled.Check, Color(0xFF0EA5E9), "Confirm", state.confirmed, Modifier.weight(1f))
                            MiniStat(Icons.Filled.Schedule, Color(0xFFF59E0B), "Delay", state.delayed, Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MiniStat(Icons.Filled.Check, Color(0xFF10B981), "Done", state.done, Modifier.weight(1f))
                            MiniStat(Icons.Filled.Close, Color(0xFFF43F5E), "Cancel", state.cancelled, Modifier.weight(1f))
                        }
                    }
                }
            }

            // ---- The three things a desk does, stacked, the site's way.
            item {
                Column(
                    Modifier.padding(top = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    onNewPatient?.let { BigAction(Icons.Filled.Person, "New Patient", primary = true, onClick = it) }
                    BigAction(Icons.Filled.CalendarMonth, "New Visit", primary = false, onClick = onBook)
                    onQuickPay?.let { BigAction(Icons.Filled.AccountBalanceWallet, "Quick Pay", primary = false, onClick = it) }
                }
            }

            // ---- The day: a strip of dates over the appointments.
            item {
                Row(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt("Today, ${shortDate()}", Type.heading, T.ink, Modifier.weight(1f))
                    androidx.compose.material3.Surface(
                        shape = T.pill,
                        color = Color(0xFFECFDF5),
                        modifier = Modifier.clickable { onPickDay(com.alphadental.clinic.next.data.ClinicSource.dateKey()) },
                    ) {
                        Txt(
                            "Today", Type.chip.copy(fontSize = 10.sp), Color(0xFF047857),
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp), uppercase = true,
                        )
                    }
                }
            }
            item { WeekStrip(onPickDay) }

            state.inChair?.let { visit ->
                item {
                    Box(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        ChairCard(visit, state.who?.can("appointments.edit") == true, onCheckOut) {
                            onOpenVisit(visit)
                        }
                    }
                }
            }

            val listed = (state.waiting + state.upcoming).distinctBy { it.id }
            if (listed.isEmpty() && !state.loading && state.inChair == null) {
                item { Empty("No appointments") }
            }
            items(listed.size) { i ->
                Box(Modifier.padding(vertical = 5.dp)) { VisitCard(listed[i]) { onOpenVisit(listed[i]) } }
            }
            item { Spacer(Modifier.height(8.dp)) }
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
        }
    }
}

@Composable
private fun DashboardSlab(
    state: Dashboard,
    onBell: () -> Unit,
    onAccount: () -> Unit,
    shift: MyShift?,
    onPunch: () -> Unit,
    onOpenAttendance: () -> Unit,
) {
    Slab(
        aside = shift?.let { mine -> { ClockPill(mine, onPunch, onOpenAttendance) } },
        title = "Dashboard",
        eyebrow = fullDate(),
        bar = {
            BrandMark()
            Spacer(Modifier.width(10.dp))
            Txt(
                state.clinicName.ifBlank { "Your clinic" },
                Type.caption.copy(fontWeight = FontWeight.SemiBold),
                T.onSlabSoft,
                Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.weight(1f))
            // The dot means somebody is in the waiting room; the tap goes to
            // the diary, which is where that somebody is dealt with.
            SlabIcon(
                Icons.Filled.Notifications, "Waiting room",
                marked = state.waiting.isNotEmpty(), onClick = onBell,
            )
            Spacer(Modifier.width(8.dp))
            Box(Modifier.clickable(onClick = onAccount)) { Initials(state.who?.name.orEmpty()) }
        },
    )
}

/** The person's own initial, on the slab — identity, not a control. */
@Composable
private fun Initials(name: String) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(T.slabFill),
        contentAlignment = Alignment.Center,
    ) {
        Txt(name.trim().firstOrNull()?.uppercase() ?: "•", Type.label, T.onSlab)
    }
}

/**
 * The one card the dashboard is allowed: whoever is in the chair.
 *
 * Everything else here is a row on a ruled surface, which is exactly what lets
 * this read as lifted. The meter is how far into the booked time they are —
 * the thing the person holding the phone is actually judging.
 */
@Composable
private fun ChairCard(
    visit: Visit,
    canEdit: Boolean,
    onCheckOut: (Visit) -> Unit,
    onOpen: () -> Unit,
) {
    val elapsed = minutesSince(visit.minuteOfDay)
    val fraction = if (visit.duration <= 0 || elapsed == null) 0f else elapsed.toFloat() / visit.duration
    val over = fraction > 1f

    Surface(
        shape = T.cardShape,
        color = T.surface,
        shadowElevation = if (T.dark) 0.dp else 2.dp,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Column {
            Row(
                Modifier.padding(start = 16.dp, end = 16.dp, top = 15.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(44.dp).clip(CircleShape).background(T.slab),
                    contentAlignment = Alignment.Center,
                ) {
                    Txt(visit.initials, Type.label.copy(letterSpacing = 0.3.sp), T.onSlab)
                }
                Spacer(Modifier.width(13.dp))
                Column(Modifier.weight(1f)) {
                    Txt(visit.patientName.ifBlank { "No name" }, Type.heading, T.ink)
                    val detail = listOf(visit.treatment, visit.doctor).filter { it.isNotBlank() }
                    if (detail.isNotEmpty()) {
                        Spacer(Modifier.height(3.dp))
                        Txt(detail.joinToString(" · "), Type.caption, T.inkMuted, maxLines = 2)
                    }
                }
                Spacer(Modifier.width(10.dp))
                StageChip(visit.status)
            }

            // The stage is already said by the chip; the meter is about time, so
            // it takes the app's ink and only turns when the chair runs over.
            Box(Modifier.fillMaxWidth().height(3.dp).background(T.line)) {
                Box(
                    Modifier
                        .fillMaxWidth(fraction.coerceIn(0f, 1f))
                        .height(3.dp)
                        .background(if (over) T.warn else T.slab)
                )
            }

            Row(
                Modifier.padding(start = 16.dp, end = 12.dp, top = 11.dp, bottom = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Txt(
                    elapsedLine(visit, elapsed),
                    Type.caption.copy(fontWeight = FontWeight.SemiBold),
                    if (over) T.warn else T.inkBody,
                    Modifier.weight(1f),
                    maxLines = 2,
                )
                if (canEdit) {
                    Spacer(Modifier.width(10.dp))
                    Surface(
                        shape = T.pill,
                        color = T.accent,
                        modifier = Modifier.clickable { onCheckOut(visit) },
                    ) {
                        Txt(
                            "Check out",
                            Type.label.copy(fontSize = 12.5.sp),
                            T.onAccent,
                            Modifier.padding(horizontal = 15.dp, vertical = 9.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The four tools the dashboard carries.
 *
 * Four, not fourteen. Everything else lives in More — a dashboard that offers
 * every tool in the product is a menu, and the appointments underneath it stop
 * being the point of the screen.
 */
/**
 * The four things somebody opens the app to do.
 *
 * One row rather than a two-by-two block of captioned rows. The captions were
 * explaining words that need no explaining — everybody knows what "Clock in"
 * means — and four tall cells with hairlines between them read as a settings
 * table that had wandered onto the dashboard.
 *
 * Every one of them goes somewhere. Two of these used to be drawn and wired to
 * nothing, which is the worst state a button can be in: it looks like the app
 * is broken rather than unfinished.
 */
@Composable
private fun Tools(onBook: () -> Unit, onLeads: () -> Unit, onReports: () -> Unit) {
    // Three, and none of them repeats the bar underneath: patients and messages
    // already have a tab each, so a tile for them was a second door to the same
    // room. Clocking in moved up to the slab, beside the day it belongs to.
    val tools = listOf(
        Tool(Icons.Filled.Add, "Book", onBook),
        Tool(Icons.Filled.PersonSearch, "Leads", onLeads),
        Tool(Icons.Filled.BarChart, "Reports", onReports),
    )

    Column(Modifier.padding(top = 4.dp, bottom = 10.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            tools.forEach { tool -> ToolCell(tool, Modifier.weight(1f)) }
        }
    }
}

private data class Tool(
    val icon: ImageVector,
    val label: String,
    val onClick: () -> Unit,
)

/** Today's income, the site's card: a wallet badge, the figure large in the middle. */
@Composable
private fun IncomeCard(state: Dashboard, modifier: Modifier) {
    androidx.compose.material3.Surface(
        shape = T.card, color = T.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, T.line), shadowElevation = 1.dp,
        modifier = modifier,
    ) {
        Column(Modifier.padding(16.dp).height(148.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt("Today's income", Type.chip.copy(fontSize = 9.5.sp), T.inkMuted, Modifier.weight(1f), uppercase = true)
                IconTile(Icons.Filled.AccountBalanceWallet, Color(0xFFECFDF5), Color(0xFF059669), size = 28)
            }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // The unit on its own line: beside a six-figure sum at this
                    // size it was the thing that got cut to "E…".
                    Txt(
                        state.takings?.let { figure(it) } ?: "—",
                        Type.figure.copy(fontSize = 34.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
                        T.ink,
                    )
                    Spacer(Modifier.height(2.dp))
                    Txt(state.currency, Type.chip, T.inkMuted, uppercase = true)
                }
            }
        }
    }
}

/** One of the four small stage counters. */
@Composable
private fun MiniStat(icon: ImageVector, tint: Color, label: String, value: Int, modifier: Modifier) {
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(19.dp), color = T.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White), shadowElevation = 1.dp,
        modifier = modifier.height(70.dp),
    ) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(12.dp))
                Spacer(Modifier.width(4.dp))
                Txt(label, Type.chip.copy(fontSize = 9.5.sp), T.ink, uppercase = true)
            }
            Spacer(Modifier.height(4.dp))
            Txt(
                value.toString(),
                Type.stat.copy(fontSize = 22.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
                T.ink,
            )
        }
    }
}

/**
 * Two weeks of dates, today in the middle and black.
 *
 * The site scrolls this strip; here it scrolls too, and a tap opens the diary on
 * that day, which is the screen that can show it.
 */
@Composable
private fun WeekStrip(onPickDay: (String) -> Unit) {
    val today = java.util.Calendar.getInstance()
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
    val dayName = java.text.SimpleDateFormat("EEE", java.util.Locale.US)
    val scroll = androidx.compose.foundation.rememberScrollState()
    androidx.compose.material3.Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.horizontalScroll(scroll).padding(horizontal = 12.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            (-7..7).forEach { offset ->
                val cal = (today.clone() as java.util.Calendar).apply { add(java.util.Calendar.DAY_OF_YEAR, offset) }
                val key = fmt.format(cal.time)
                val isToday = offset == 0
                androidx.compose.material3.Surface(
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
                    color = if (isToday) T.slab else T.surfaceSoft,
                    border = if (isToday) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
                    shadowElevation = if (isToday) 3.dp else 0.dp,
                    modifier = Modifier.width(48.dp).height(56.dp).clickable { onPickDay(key) },
                ) {
                    Column(
                        Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Txt(
                            if (isToday) "Today" else dayName.format(cal.time),
                            Type.chip.copy(fontSize = 8.sp),
                            if (isToday) T.onSlabSoft else T.inkMuted,
                            uppercase = true,
                        )
                        Spacer(Modifier.height(3.dp))
                        Txt(
                            cal.get(java.util.Calendar.DAY_OF_MONTH).toString(),
                            Type.label.copy(fontSize = 13.sp),
                            if (isToday) T.onSlab else T.ink,
                        )
                    }
                }
            }
        }
    }
    // Land on today rather than on last week: seven days back is what scrolls
    // into view first otherwise, which reads as the wrong week.
    androidx.compose.runtime.LaunchedEffect(Unit) { scroll.scrollTo(7 * 56 * 3 / 2) }
}

private fun shortDate(): String =
    java.text.SimpleDateFormat("MMM d", java.util.Locale.US).format(java.util.Date())

/**
 * Clocked in or not, and the one tap that changes it.
 *
 * Lives on the slab beside the day's title because that is what it is about —
 * this day, and whether the person holding the phone is on it yet. The
 * attendance screen still exists for the rest: the week, the roster, the
 * location permission when Android has refused it. This is the shortcut.
 */
@Composable
private fun ClockPill(mine: MyShift, onPunch: () -> Unit, onOpenAttendance: () -> Unit) {
    Surface(
        shape = T.pill,
        color = if (mine.on) T.slabFill else T.accent,
        // Android's refusal is the one thing the pill cannot fix in place: the
        // attendance screen owns the permission button, so go there.
        modifier = Modifier.clickable(enabled = !mine.busy) {
            if (mine.needsLocation) onOpenAttendance() else onPunch()
        },
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (mine.busy) {
                CircularProgressIndicator(
                    color = if (mine.on) T.onSlabFaint else T.onAccent,
                    strokeWidth = 2.dp, modifier = Modifier.size(14.dp),
                )
            } else {
                Icon(
                    Icons.Filled.Schedule, null,
                    tint = if (mine.on) T.onSlab else T.onAccent,
                    modifier = Modifier.size(15.dp),
                )
                Spacer(Modifier.width(6.dp))
                Txt(
                    when {
                        mine.needsLocation -> "Allow location"
                        mine.on -> "Out · ${mine.minutes / 60}h ${mine.minutes % 60}m"
                        else -> "Clock in"
                    },
                    Type.label.copy(fontSize = 12.sp),
                    if (mine.on) T.onSlab else T.onAccent,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * One action: a square of surface with the icon in it, and the word under.
 *
 * Square rather than round because the rest of the app is built from rectangles
 * with a 14dp radius, and a row of circles here would be the only circles on the
 * screen.
 */
@Composable
private fun ToolCell(tool: Tool, modifier: Modifier = Modifier) {
    Column(
        modifier.clickable(onClick = tool.onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            color = T.surface,
            shape = T.cardShape,
            modifier = Modifier.fillMaxWidth().aspectRatio(1.15f),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(tool.icon, null, tint = T.ink, modifier = Modifier.size(21.dp))
            }
        }
        Spacer(Modifier.height(7.dp))
        Txt(tool.label, Type.caption, T.inkMuted, maxLines = 1)
    }
}

@Composable
private fun Notice(message: String) {
    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
        Txt(message, Type.body, T.danger, Modifier.padding(horizontal = T.gutter, vertical = 14.dp), maxLines = 3)
    }
}

@Composable
private fun Empty(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 44.dp), contentAlignment = Alignment.Center) {
        Txt(text, Type.body, T.inkFaint)
    }
}

// ---------------------------------------------------------------------------
// Small formatters
// ---------------------------------------------------------------------------

/** "18,450" — a figure a person reads, not a number a computer stored. */
private fun figure(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())

/** "Saturday 13 September". */
private fun fullDate(): String = SimpleDateFormat("EEEE d MMMM", Locale.US).format(Date())

/** "Sat" — the day the comparison is against. */
private fun weekday(): String = SimpleDateFormat("EEE", Locale.US).format(Date())

private fun minutesSince(minuteOfDay: Int): Int? {
    if (minuteOfDay >= 24 * 60) return null
    val now = Calendar.getInstance()
    return now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE) - minuteOfDay
}

/** "Started 10:05 · 38 min in, 20 booked". */
private fun elapsedLine(visit: Visit, elapsed: Int?): String {
    val start = visit.time.trim()
    if (elapsed == null || elapsed < 0) return "Booked for $start"
    val over = elapsed - visit.duration
    return if (over > 0) "Started $start · $over min over"
    else "Started $start · $elapsed min in, ${visit.duration} booked"
}
