package com.alphadental.clinic.next

import androidx.compose.foundation.background
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
) {
    Box(Modifier.fillMaxSize().background(T.ground)) {

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = T.barClearance),
        ) {
            item { DashboardSlab(state) }

            state.error?.let { message ->
                item { Notice(message) }
            }

            state.inChair?.let { visit ->
                item {
                    Box(Modifier.padding(horizontal = T.gutter, vertical = 14.dp)) {
                        ChairCard(visit, state.who?.can("appointments.edit") == true, onCheckOut) {
                            onOpenVisit(visit)
                        }
                    }
                }
            }

            if (state.waiting.isNotEmpty()) {
                item { SectionLabel("Waiting room · ${state.waiting.size}", action = "See the day") }
                item { VisitRows(state.waiting, onOpen = onOpenVisit) }
            }

            if (state.upcoming.isNotEmpty()) {
                item { SectionLabel("Next up") }
                item { VisitRows(state.upcoming.take(6), onOpen = onOpenVisit) }
            }

            if (!state.loading && state.visits.isEmpty()) {
                item { Empty("Nothing booked today.") }
            }

            item { Tools(state, onClock) }
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
        }
    }
}

@Composable
private fun DashboardSlab(state: Dashboard) {
    val money = state.takings
    Slab(
        title = if (money != null) "Takings today" else "Today",
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
            SlabIcon(Icons.Filled.Notifications, "Notifications", marked = state.waiting.isNotEmpty())
            Spacer(Modifier.width(8.dp))
            Initials(state.who?.name.orEmpty())
        },
        figure = money?.let {
            {
                val delta = state.deltaPercent
                SlabFigure(
                    amount = figure(it),
                    currency = state.currency,
                    note = delta?.let { "vs. ${weekday()} avg" },
                    noteValue = delta?.let { d -> if (d >= 0) "+$d%" else "$d%" },
                )
            }
        },
        stats = buildList {
            add(Stat("Booked", state.visits.size.toString()))
            add(Stat("Seen", state.seen.toString()))
            add(Stat("Waiting", state.waiting.size.toString()))
            // Only once it is known and there is any. A permanent "0 owed" teaches
            // people to stop reading the strip.
            state.owed?.takeIf { it > 0 }?.let { add(Stat("Owed", figure(it))) }
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
@Composable
private fun Tools(state: Dashboard, onClock: () -> Unit) {
    val tools = listOfNotNull(
        Tool(Icons.Filled.Add, "New booking", "Book a patient in"),
        Tool(Icons.AutoMirrored.Filled.Chat, "WhatsApp", "Messages from patients"),
        Tool(Icons.Filled.People, "Find a patient", "Search the register"),
        // The only one wired so far. A tile that does nothing when tapped is
        // worse than one that is not there, so the rest go as they are built.
        Tool(Icons.Filled.Schedule, "Clock in", "Start or end your shift", onClock),
    )
    Column(Modifier.padding(top = 20.dp)) {
        RowGroup {
            tools.chunked(2).forEachIndexed { i, pair ->
                if (i > 0) Rule()
                Row(Modifier.height(IntrinsicSize.Min)) {
                    ToolCell(pair[0], Modifier.weight(1f))
                    Box(Modifier.width(1.dp).fillMaxHeight().background(T.line))
                    if (pair.size > 1) ToolCell(pair[1], Modifier.weight(1f))
                    else Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

private data class Tool(
    val icon: ImageVector,
    val label: String,
    val caption: String,
    val onClick: (() -> Unit)? = null,
)

@Composable
private fun ToolCell(tool: Tool, modifier: Modifier = Modifier) {
    Row(
        modifier
            .then(if (tool.onClick != null) Modifier.clickable(onClick = tool.onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 15.dp)
    ) {
        Icon(tool.icon, null, tint = T.inkFaint, modifier = Modifier.size(18.dp).padding(top = 1.dp))
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Txt(tool.label, Type.label, T.ink)
            Spacer(Modifier.height(3.dp))
            Txt(tool.caption, Type.caption.copy(fontSize = 11.5.sp), T.inkMuted, maxLines = 2)
        }
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
