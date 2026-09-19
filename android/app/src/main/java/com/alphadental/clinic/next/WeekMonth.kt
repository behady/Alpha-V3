package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.design.BigAction
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/*
 * The week and the month, the website's way.
 *
 * The website's week is a time grid — hours down the side, a column per day, each appointment a
 * coloured block the height of its duration, tinted by its stage. The phone draws the same grid
 * and lets it scroll sideways, three days to a screen, so a block is still wide enough to carry
 * a name and a time. The website has no month grid; its month is the small calendar on the left
 * that picks a day for the grid. The phone's month is that calendar, with the picked day's
 * bookings listed under it, so a month is browsed without leaving the month.
 */

private val HOUR = 64.dp
private val GUTTER = 44.dp
private val COLUMN = 118.dp
private val HEADER = 62.dp

// ====================================================================== week

fun LazyListScope.weekGrid(
    state: Day,
    onOpenVisit: (Visit) -> Unit,
    onOpenDay: (String) -> Unit,
) {
    if (state.counting && state.spanVisits.isEmpty() && state.counts.isEmpty()) {
        item { Spinner() }
        return
    }
    item(key = "week-grid") { WeekGrid(state, onOpenVisit, onOpenDay) }
    item {
        val total = state.counts.sumOf { it.booked }
        Txt(
            if (total == 0) "Nothing booked this week." else "$total booked this week. Tap a day's name to open it, or a block to open the visit.",
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
            maxLines = 2,
        )
    }
}

@Composable
private fun WeekGrid(state: Day, onOpenVisit: (Visit) -> Unit, onOpenDay: (String) -> Unit) {
    val days = state.counts.filter { it.inSpan }
    if (days.isEmpty()) return
    val hours = state.hours
    val from = (hours.startMinute / 60) * 60
    val to = ((hours.closes + 59) / 60) * 60
    // Anything booked outside the clinic's hours still has to be somewhere on the grid.
    val earliest = minOf(from, state.spanVisits.minOfOrNull { (it.minuteOfDay / 60) * 60 } ?: from)
    val latest = maxOf(to, state.spanVisits.maxOfOrNull { ((it.minuteOfDay + it.duration + 59) / 60) * 60 } ?: to)
    val hourCount = ((latest - earliest) / 60).coerceAtLeast(1)
    val scroll = rememberScrollState()
    val today = ClinicSource.dateKey()
    val byDay = remember(state.spanVisits) { state.spanVisits.groupBy { it.date } }

    Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        // ---- the hour gutter, fixed
        Column(Modifier.width(GUTTER)) {
            Spacer(Modifier.height(HEADER))
            repeat(hourCount) { i ->
                Box(Modifier.width(GUTTER).height(HOUR), contentAlignment = Alignment.TopEnd) {
                    Txt(
                        hourLabel(earliest + i * 60), Type.chip.copy(fontSize = 9.sp), T.inkFaint,
                        Modifier.padding(end = 6.dp).offset(y = (-6).dp), maxLines = 1,
                    )
                }
            }
        }
        // ---- the days, scrolling sideways
        Row(Modifier.horizontalScroll(scroll)) {
            days.forEachIndexed { i, day ->
                val isToday = day.dateKey == today
                val isShown = day.dateKey == state.dateKey
                // A day where bookings overlap gets a wider column, one full width per lane
                // (up to three), so every block keeps a readable name. The grid scrolls anyway.
                val laned = lanes(byDay[day.dateKey].orEmpty())
                val widest = (laned.maxOfOrNull { it.of } ?: 1).coerceIn(1, 3)
                val column = COLUMN * widest
                Column(Modifier.width(column)) {
                    // Header: weekday, date, how many. Tapping it opens the day.
                    Column(
                        Modifier
                            .width(column)
                            .height(HEADER)
                            .padding(horizontal = 4.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (isShown) T.slab else if (isToday) T.surfaceSoft else Color.Transparent)
                            .clickable { onOpenDay(day.dateKey) }
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Txt(weekdayShort(day.dateKey), Type.chip.copy(fontSize = 9.sp), if (isShown) T.onSlabSoft else T.inkFaint, uppercase = true)
                        Txt(day.dayOfMonth.toString(), Type.label.copy(fontSize = 17.sp), if (isShown) T.onSlab else T.ink)
                        if (day.booked > 0) Txt(
                            "${day.booked} booked", Type.chip.copy(fontSize = 9.sp),
                            if (isShown) T.onSlabSoft else if (day.done >= day.booked) T.inkFaint else T.accentInk,
                        )
                    }
                    // The column: hour lines, then blocks laid over them.
                    Box(
                        Modifier
                            .width(column)
                            .height(HOUR * hourCount)
                            .background(if (isToday) T.surfaceSoft.copy(alpha = 0.5f) else Color.Transparent),
                    ) {
                        Column {
                            repeat(hourCount) {
                                Box(Modifier.fillMaxWidth().height(HOUR)) {
                                    Box(Modifier.fillMaxWidth().height(1.dp).background(T.line))
                                    Box(Modifier.fillMaxWidth().height(1.dp).background(T.line.copy(alpha = 0.45f)).offset(y = HOUR / 2))
                                }
                            }
                        }
                        if (i > 0) Box(Modifier.width(1.dp).fillMaxSize().background(T.line))
                        // Two patients booked over the same minutes sit side by side, never on
                        // top of each other — the one thing a grid must never hide.
                        laned.forEach { (visit, lane, of) ->
                            val top = HOUR * ((visit.minuteOfDay - earliest) / 60f)
                            val h = HOUR * (visit.duration.coerceAtLeast(20) / 60f)
                            val w = column / of
                            WeekBlock(visit, Modifier.offset(x = w * lane, y = top).width(w).height(h)) { onOpenVisit(visit) }
                        }
                    }
                }
            }
        }
    }
}

/** A visit, the lane it sits in, and how many lanes its cluster of overlaps needs. */
private data class Laned(val visit: Visit, val lane: Int, val of: Int)

/**
 * Overlapping visits share the column.
 *
 * Sweep the day in time order; a visit takes the first lane that is free when it starts. A run
 * of visits that overlap each other is one cluster, and every block in it is drawn at the
 * cluster's width, so nothing is covered and nothing is narrower than it has to be.
 */
private fun lanes(visits: List<Visit>): List<Laned> {
    val sorted = visits.sortedWith(compareBy({ it.minuteOfDay }, { it.patientName }))
    val out = mutableListOf<Laned>()
    var cluster = mutableListOf<Pair<Visit, Int>>()
    var laneEnds = mutableListOf<Int>()
    fun flush() {
        val of = laneEnds.size.coerceAtLeast(1)
        cluster.forEach { (v, lane) -> out += Laned(v, lane, of) }
        cluster = mutableListOf(); laneEnds = mutableListOf()
    }
    sorted.forEach { v ->
        val start = v.minuteOfDay
        val end = start + v.duration.coerceAtLeast(20)
        if (laneEnds.isNotEmpty() && laneEnds.all { it <= start }) flush()
        val lane = laneEnds.indexOfFirst { it <= start }.let { if (it < 0) { laneEnds += end; laneEnds.size - 1 } else { laneEnds[it] = end; it } }
        cluster += v to lane
    }
    flush()
    return out
}

/** One appointment on the grid: the website's card, at the size the grid gives it. */
@Composable
private fun WeekBlock(visit: Visit, modifier: Modifier, onClick: () -> Unit) {
    val colours = stageColours(visit.status)
    val struck = visit.status == Stage.Cancelled || visit.status == Stage.NoShow
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 3.dp, vertical = 1.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (struck) T.surfaceSoft else colours.chipFill)
            .border(1.dp, colours.stripe.copy(alpha = if (struck) 0.35f else 0.6f), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
    ) {
        Box(Modifier.width(3.dp).fillMaxSize().padding(vertical = 5.dp).clip(RoundedCornerShape(2.dp)).background(colours.stripe))
        Column(Modifier.padding(start = 8.dp, end = 5.dp, top = 4.dp, bottom = 3.dp)) {
            Txt(
                visit.patientName.ifBlank { "Unnamed" }, Type.label.copy(fontSize = 11.sp),
                if (struck) T.inkFaint else T.ink, maxLines = 1,
            )
            Txt(
                visit.time.ifBlank { "—" }, Type.chip.copy(fontSize = 9.sp),
                if (struck) T.inkFaint else colours.chipInk, maxLines = 1,
            )
            if (visit.treatment.isNotBlank()) Txt(
                visit.treatment, Type.caption.copy(fontSize = 10.sp),
                if (struck) T.inkFaint else T.inkMuted, maxLines = 1,
            )
        }
    }
}

// ====================================================================== month

fun LazyListScope.monthView(
    state: Day,
    onSelectDay: (String) -> Unit,
    onOpenDay: (String) -> Unit,
    onOpenVisit: (Visit) -> Unit,
) {
    if (state.counting && state.counts.isEmpty()) {
        item { Spinner() }
        return
    }
    item {
        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 6.dp)) {
            listOf("Sa", "Su", "Mo", "Tu", "We", "Th", "Fr").forEach { day ->
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Txt(day, Type.chip, T.inkFaint, uppercase = true)
                }
            }
        }
    }
    val today = ClinicSource.dateKey()
    state.counts.chunked(7).forEachIndexed { row, week ->
        item(key = "cal-$row") {
            Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 3.dp)) {
                week.forEach { day -> MonthSquare(day, state.dateKey, today, Modifier.weight(1f), onSelectDay) }
                repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }

    // ---- the picked day, underneath
    item { SectionLabel(prettyMonthDay(state.dateKey)) }
    val visits = state.visits
    if (visits.isEmpty()) {
        item {
            Txt(
                if (state.loading) "Reading the day…" else "Nothing booked on this day.",
                Type.body, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
            )
        }
    } else {
        item(key = "month-visits") {
            Box(Modifier.padding(bottom = 6.dp)) { VisitRows(visits, onOpen = onOpenVisit) }
        }
    }
    item {
        Column(Modifier.padding(top = 6.dp, bottom = 10.dp)) {
            BigAction(
                Icons.Filled.CalendarMonth,
                "Open ${shortMonthDay(state.dateKey)}",
                primary = false,
            ) { onOpenDay(state.dateKey) }
        }
    }
}

@Composable
private fun MonthSquare(day: DayCount, shown: String, today: String, modifier: Modifier, onSelect: (String) -> Unit) {
    if (!day.inSpan) {
        Spacer(modifier.aspectRatio(1f))
        return
    }
    val isShown = day.dateKey == shown
    val isToday = day.dateKey == today
    Box(
        modifier
            .aspectRatio(1f)
            .padding(2.dp)
            .clip(T.cardShape)
            .background(if (isShown) T.slab else T.surface)
            .then(if (isToday && !isShown) Modifier.border(1.5.dp, T.accent, T.cardShape) else Modifier)
            .clickable { onSelect(day.dateKey) },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Txt(day.dayOfMonth.toString(), Type.label, if (isShown) T.onSlab else T.ink)
            if (day.booked > 0) {
                Spacer(Modifier.height(2.dp))
                Txt(
                    day.booked.toString(), Type.chip,
                    // Grey once everybody has been seen: a full day already dealt with is not
                    // the same news as a full day ahead.
                    if (isShown) T.onSlab else if (day.done >= day.booked) T.inkFaint else T.accentInk,
                )
            }
        }
    }
}

// ====================================================================== pieces

@Composable
private fun Spinner() {
    Box(Modifier.fillMaxWidth().padding(30.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
    }
}

private fun hourLabel(minute: Int): String {
    val h24 = (minute / 60) % 24
    val h = if (h24 % 12 == 0) 12 else h24 % 12
    return "$h ${if (h24 < 12) "AM" else "PM"}"
}

private fun parse(dateKey: String) = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey) }.getOrNull()

private fun weekdayShort(dateKey: String): String = parse(dateKey)?.let { SimpleDateFormat("EEE", Locale.US).format(it) } ?: ""

private fun prettyMonthDay(dateKey: String): String = parse(dateKey)?.let { SimpleDateFormat("EEEE d MMMM", Locale.US).format(it) } ?: dateKey

private fun shortMonthDay(dateKey: String): String = parse(dateKey)?.let { SimpleDateFormat("EEE d MMM", Locale.US).format(it) } ?: dateKey

/** The slab's title for a span: the website's "September, 19 - 25 2026" for a week, the month for a month. */
fun spanTitle(dateKey: String, span: Span): String {
    val date = parse(dateKey) ?: return dateKey
    return when (span) {
        Span.Day -> SimpleDateFormat("EEEE d MMMM", Locale.US).format(date)
        Span.Month -> SimpleDateFormat("MMMM yyyy", Locale.US).format(date)
        Span.Week -> {
            val cal = Calendar.getInstance().apply { time = date }
            cal.add(Calendar.DAY_OF_YEAR, -((cal.get(Calendar.DAY_OF_WEEK) - Calendar.SATURDAY + 7) % 7))
            val start = cal.time
            cal.add(Calendar.DAY_OF_YEAR, 6)
            val end = cal.time
            val sm = SimpleDateFormat("MMM", Locale.US)
            val d = SimpleDateFormat("d", Locale.US)
            if (sm.format(start) == sm.format(end)) "${sm.format(start)} ${d.format(start)} – ${d.format(end)}"
            else "${sm.format(start)} ${d.format(start)} – ${sm.format(end)} ${d.format(end)}"
        }
    }
}

/** "This week", "Next week", "Last week"; "This month"; or nothing. */
fun spanEyebrow(dateKey: String, span: Span): String? {
    val date = parse(dateKey) ?: return null
    val now = Calendar.getInstance()
    val cal = Calendar.getInstance().apply { time = date }
    return when (span) {
        Span.Day -> null
        Span.Month -> {
            val months = (cal.get(Calendar.YEAR) - now.get(Calendar.YEAR)) * 12 + cal.get(Calendar.MONTH) - now.get(Calendar.MONTH)
            when (months) { 0 -> "This month"; 1 -> "Next month"; -1 -> "Last month"; else -> null }
        }
        Span.Week -> {
            fun weekStart(c: Calendar): Long {
                val x = c.clone() as Calendar
                x.add(Calendar.DAY_OF_YEAR, -((x.get(Calendar.DAY_OF_WEEK) - Calendar.SATURDAY + 7) % 7))
                x.set(Calendar.HOUR_OF_DAY, 12); x.set(Calendar.MINUTE, 0); x.set(Calendar.SECOND, 0); x.set(Calendar.MILLISECOND, 0)
                return x.timeInMillis
            }
            val weeks = Math.round((weekStart(cal) - weekStart(now)) / (7.0 * 24 * 60 * 60 * 1000)).toInt()
            when (weeks) { 0 -> "This week"; 1 -> "Next week"; -1 -> "Last week"; else -> null }
        }
    }
}
