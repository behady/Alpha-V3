package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.ui.draw.clip
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Visit
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
 * The diary, one day at a time.
 *
 * This is the screen a receptionist keeps open, so it is built for scanning
 * rather than reading: the rows carry the day and everything else gets out of
 * the way. It has no headline figure — a diary has nothing to announce, and a
 * 46sp number nobody needed is just a large grey box.
 *
 * The gaps between appointments are shown as rows of their own. That is the
 * difference between a list of bookings and a diary: the answer to "can you fit
 * me in at four" should be on the screen, not something to work out.
 */
@Composable
fun DayScreen(
    state: Day,
    onShiftDay: (Int) -> Unit,
    onToday: () -> Unit,
    onOpenVisit: (Visit) -> Unit = {},
    onBookGap: (DayEntry.Gap) -> Unit = {},
    onSpan: (Span) -> Unit = {},
    onOpenDay: (String) -> Unit = {},
    /** A day tapped in the month: shown underneath, without leaving the month. */
    onSelectDay: (String) -> Unit = {},
    /** Book into the day on screen. On the slab, where the assistant's bubble cannot cover it. */
    onBookNow: (() -> Unit)? = null,
) {
    Box(Modifier.fillMaxSize().background(T.ground)) {

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = T.barClearance),
        ) {
            item { DaySlab(state, onShiftDay, onToday, onBookNow) }

            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Span.entries.forEach { s ->
                        SettingsPill(s.label, solid = state.span == s) { onSpan(s) }
                    }
                }
            }

            when (state.span) {
                Span.Week -> { weekGrid(state, onOpenVisit, onOpenDay); return@LazyColumn }
                Span.Month -> { monthView(state, onSelectDay, onOpenDay, onOpenVisit); return@LazyColumn }
                Span.Day -> Unit
            }

            state.error?.let { message ->
                item {
                    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                        Txt(message, Type.body, T.danger, Modifier.padding(T.gutter), maxLines = 3)
                    }
                }
            }

            val entries = state.entries
            if (entries.isEmpty() && !state.loading) {
                item { DayEmpty(state) }
            }

            // Grouped by part of the day, because that is how anyone at a desk
            // talks about it — "is there anything in the afternoon".
            entries.groupBy { partOfDay(it.minute) }
                .forEach { (part, group) ->
                    item(key = "h-$part") { SectionLabel(part) }
                    item(key = "g-$part") {
                        RowGroup {
                            group.forEachIndexed { i, entry ->
                                if (i > 0) Rule()
                                when (entry) {
                                    is DayEntry.Booking ->
                                        VisitRow(entry.visit) { onOpenVisit(entry.visit) }
                                    is DayEntry.Gap -> GapRow(entry) { onBookGap(entry) }
                                }
                            }
                        }
                    }
                }
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
        }
    }
}

@Composable
private fun DaySlab(state: Day, onShiftDay: (Int) -> Unit, onToday: () -> Unit, onBookNow: (() -> Unit)?) {
    val unit = when (state.span) { Span.Day -> "day"; Span.Week -> "week"; Span.Month -> "month" }
    Slab(
        title = spanTitle(state.dateKey, state.span),
        eyebrow = if (state.span == Span.Day) relativeDay(state.dateKey) else spanEyebrow(state.dateKey, state.span),
        bar = {
            SlabIcon(Icons.Filled.ChevronLeft, "Previous $unit") { onShiftDay(-1) }
            Spacer(Modifier.width(8.dp))
            SlabIcon(Icons.Filled.ChevronRight, "Next $unit") { onShiftDay(1) }
            Spacer(Modifier.weight(1f))
            // The yellow one. The gap rows below offer to book too, but the assistant's bubble
            // floats over the bottom of the list and hid the last of them.
            onBookNow?.let { book ->
                Surface(shape = T.pill, color = T.accent, modifier = Modifier.clickable(onClick = book)) {
                    Txt(
                        "Book", Type.label.copy(fontSize = 12.sp), T.slab,
                        Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                Spacer(Modifier.width(8.dp))
            }
            // Only when it would do something. A button that is always there and
            // usually does nothing teaches people to stop looking at that corner.
            if (!state.isToday) {
                Surface(
                    shape = T.pill,
                    color = T.slabFill,
                    modifier = Modifier.clickable(onClick = onToday),
                ) {
                    Txt(
                        "Back to today",
                        Type.caption.copy(fontSize = 12.sp),
                        T.onSlab,
                        Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }
            }
        },
        stats = if (state.span != Span.Day) buildList {
            val days = state.counts.filter { it.inSpan }
            add(Stat("Booked", days.sumOf { it.booked }.toString()))
            add(Stat("Done", days.sumOf { it.done }.toString()))
            add(Stat("Days", days.count { it.booked > 0 }.toString() + "/" + days.size))
        } else buildList {
            add(Stat("Booked", state.visits.size.toString()))
            add(Stat("Done", state.done.toString()))
            // Unconfirmed is the one figure here that is a job: somebody still has
            // to ring those patients.
            add(Stat("Unconfirmed", state.unconfirmed.toString()))
            // Only when the clinic has said when it opens. A free-slot count
            // derived from a nine-to-nine guess is a confident number about a day
            // we know nothing about.
            state.freeSlots?.let { add(Stat("Free", it.toString())) }
        },
    )
}

/**
 * A gap in the day, offered as something to book into.
 *
 * Quiet on purpose — it is an absence, not an appointment, so it carries no
 * stage stripe and no chip, and the only thing with any weight on the row is
 * the button that does something about it.
 */
/**
 * A week or a month as squares.
 *
 * Not a grid of appointments: on a phone that is six pixels per patient and
 * unreadable. What a week view is actually asked is "which day is quiet" and
 * "is anything on the 24th", and a count answers both — then a tap drops into
 * the day, which is the screen that can show the detail.
 *
 * Saturday first, because that is the Egyptian working week and the one the
 * payroll period already uses.
 */
private fun LazyListScope.calendar(state: Day, onOpenDay: (String) -> Unit) {
    if (state.counting && state.counts.isEmpty()) {
        item {
            Box(Modifier.fillMaxWidth().padding(30.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp),
                )
            }
        }
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

    state.counts.chunked(7).forEachIndexed { row, week ->
        item(key = "cal-$row") {
            Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 3.dp)) {
                week.forEach { day -> DaySquare(day, state.dateKey, Modifier.weight(1f), onOpenDay) }
                // A short last week keeps its squares the same size as a full one.
                repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }

    item {
        val total = state.counts.sumOf { it.booked }
        Txt(
            if (total == 0) {
                "Nothing booked in this stretch."
            } else {
                "$total booked. Tap a day to open it."
            },
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
            maxLines = 2,
        )
    }
}

@Composable
private fun DaySquare(day: DayCount, today: String, modifier: Modifier, onOpen: (String) -> Unit) {
    if (!day.inSpan) {
        Spacer(modifier.aspectRatio(1f))
        return
    }
    val isShown = day.dateKey == today
    Box(
        modifier
            .aspectRatio(1f)
            .padding(2.dp)
            .clip(T.cardShape)
            .background(if (isShown) T.slab else T.surface)
            .clickable { onOpen(day.dateKey) },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Txt(
                day.dayOfMonth.toString(),
                Type.label,
                if (isShown) T.onSlab else T.ink,
            )
            if (day.booked > 0) {
                Spacer(Modifier.height(2.dp))
                Txt(
                    day.booked.toString(),
                    Type.chip,
                    // Grey once everybody has been seen: a full day already
                    // dealt with is not the same news as a full day ahead.
                    if (isShown) T.onSlab
                    else if (day.done >= day.booked) T.inkFaint
                    else T.accentInk,
                )
            }
        }
    }
}

@Composable
private fun GapRow(gap: DayEntry.Gap, onBook: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(T.surfaceSoft)
            .padding(start = T.gutter, end = 12.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(52.dp)) {
            val (label, meridiem) = clockLabel(gap.minute)
            Txt(label, Type.label.copy(fontSize = 13.sp), T.inkFaint)
            Txt(meridiem, Type.chip, T.inkFaint, uppercase = true)
        }
        Spacer(Modifier.width(10.dp))
        Txt("Free · ${durationLabel(gap.minutes)}", Type.rowName, T.inkMuted, Modifier.weight(1f))
        Spacer(Modifier.width(10.dp))
        Surface(
            shape = T.pill,
            color = T.surface,
            border = androidx.compose.foundation.BorderStroke(1.dp, T.lineStrong),
            modifier = Modifier.clickable(onClick = onBook),
        ) {
            Txt("Book", Type.label.copy(fontSize = 12.sp), T.ink, Modifier.padding(horizontal = 14.dp, vertical = 7.dp))
        }
    }
}

@Composable
private fun DayEmpty(state: Day) {
    val message = when {
        !state.hours.isOpenOn(state.dateKey) -> "The clinic is closed on this day."
        else -> "Nothing booked on this day."
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
        Txt(message, Type.body, T.inkFaint)
    }
}

// ---------------------------------------------------------------------------

/** "Morning", "Afternoon", "Evening" — how a desk talks about the day. */
private fun partOfDay(minute: Int): String = when {
    minute < 12 * 60 -> "Morning"
    minute < 17 * 60 -> "Afternoon"
    else -> "Evening"
}

/** "Saturday 13 September". */
private fun prettyDay(dateKey: String): String {
    val date = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey) }.getOrNull()
        ?: return dateKey
    return SimpleDateFormat("EEEE d MMMM", Locale.US).format(date)
}

/** Minutes past midnight as a clock face and its meridiem, separately. */
private fun clockLabel(minute: Int): Pair<String, String> {
    val m = minute % (24 * 60)
    val hour24 = m / 60
    val hour = when {
        hour24 % 12 == 0 -> 12
        else -> hour24 % 12
    }
    return "%02d:%02d".format(hour, m % 60) to if (hour24 < 12) "AM" else "PM"
}

/** "45 minutes", "2 hours", "1 hour 30". */
private fun durationLabel(minutes: Int): String {
    if (minutes < 60) return "$minutes minutes"
    val hours = minutes / 60
    val rest = minutes % 60
    val h = if (hours == 1) "1 hour" else "$hours hours"
    return if (rest == 0) h else "$h $rest"
}

/**
 * "Today", "Tomorrow", "Yesterday" — or nothing.
 *
 * The date is the screen's name; this is the thing worth saying about it. Null
 * for any other day, because "Monday 14 September" already said it.
 */
private fun relativeDay(dateKey: String): String? {
    val today = com.alphadental.clinic.next.data.ClinicSource.dateKey()
    if (dateKey == today) return "Today"
    val cal = java.util.Calendar.getInstance()
    cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
    if (dateKey == com.alphadental.clinic.next.data.ClinicSource.dateKey(cal.time)) return "Tomorrow"
    cal.add(java.util.Calendar.DAY_OF_YEAR, -2)
    if (dateKey == com.alphadental.clinic.next.data.ClinicSource.dateKey(cal.time)) return "Yesterday"
    return null
}
