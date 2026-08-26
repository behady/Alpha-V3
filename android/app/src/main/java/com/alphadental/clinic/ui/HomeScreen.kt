package com.alphadental.clinic.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.DOCTOR_TITLES
import com.alphadental.clinic.data.Session
import java.util.Calendar
import kotlinx.coroutines.delay

/**
 * The home screen: three different dashboards wearing one name.
 *
 * A dentist between patients, a receptionist at the desk and an owner checking in
 * from elsewhere want genuinely different things first — so the role on the
 * account decides not just what data shows but what the screen IS: the dentist
 * gets "who is in my chair and who is next", reception gets "act fast" buttons
 * and the waiting room, the owner gets the money and the shape of the day.
 * Each dashboard carries its own shortcuts so the everyday tools are one tap
 * from here instead of a hunt through the More tab.
 *
 * All three open on the same dark slab and then go quiet: see [DashboardHeader]
 * for why the screen spends all of its contrast in one place.
 */
@Composable
fun HomeScreen(
    session: Session,
    appointments: List<Appointment>,
    offline: Boolean,
    pending: Int,
    arabic: Boolean,
    /** Null until read, or when this role does not see clinic revenue. */
    takingsToday: Double?,
    whatsappWaiting: Int,
    onShift: Boolean,
    shiftSince: Long,
    clocking: Boolean,
    clockError: String?,
    /** Already wrapped in the location-permission flow by the caller. */
    onPunch: () -> Unit,
    onDismissClockError: () -> Unit,
    onOpenAppointment: (Appointment) -> Unit,
    onSeeDay: () -> Unit,
    onOpenPatients: () -> Unit,
    /** Null for roles that do not see the Money tab. */
    onOpenMoney: (() -> Unit)?,
    /** Null for roles that do not see reports. */
    onOpenReports: (() -> Unit)?,
    onOpenOrtho: () -> Unit,
    onOpenInventory: () -> Unit,
    onOpenWhatsappQueue: () -> Unit,
    onOpenAssistant: () -> Unit,
    /** Null for roles that do not work the CRM inbox. */
    onOpenLeads: (() -> Unit)?,
    /** Today at a glance, once it has arrived. Null while loading, or if it failed. */
    briefing: com.alphadental.clinic.ai.BriefingClient.Briefing? = null,
    onOpenBriefing: () -> Unit = {},
) {
    val active = appointments.filterNot { normalizeStatus(it.status) in FINISHED }
    val nowMinutes = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

    // The owner's dashboard is the one that carries clinic money, so it is the one
    // whose slab shows the day's takings. The other two get a shorter slab.
    val ownerView = !session.isDentist && !session.isReception
    val seen = appointments.count { normalizeStatus(it.status) in SEEN }
    val noShow = appointments.count { normalizeStatus(it.status) == "No Show" }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        // No side gutter on the list itself: the header slab has to reach both
        // screen edges, so every other row asks for the gutter with row()/Gutter().
        contentPadding = PaddingValues(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            DashboardHeader(
                name = session.name,
                arabic = arabic,
                onShift = onShift,
                shiftSince = shiftSince,
                clocking = clocking,
                onPunch = onPunch,
            ) {
                if (ownerView) {
                    Spacer(Modifier.height(20.dp))
                    SlabTakings(
                        takingsToday = takingsToday,
                        seen = seen,
                        total = appointments.size,
                        noShow = noShow,
                        arabic = arabic,
                    )
                }
            }
        }

        // Today's briefing, but only when it has something to say. It arrives in
        // the background a moment after the dashboard, so it must not be a hole
        // in the layout while it is missing — one line, or nothing at all.
        if (briefing != null && !briefing.isEmpty) {
            row { BriefingLine(briefing, arabic, onOpenBriefing) }
        }

        if (clockError != null) {
            row {
                Surface(
                    onClick = onDismissClockError,
                    shape = Alpha.CardShape,
                    color = Alpha.DangerSoft,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        clockError,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.DangerText,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }

        if (offline) {
            row { OfflineBanner(pending, arabic) }
        }

        when {
            session.isDentist -> dentistHome(
                session, appointments, active, nowMinutes, arabic,
                onOpenAppointment, onOpenPatients, onOpenOrtho, onOpenInventory, onOpenAssistant,
            )

            session.isReception -> receptionHome(
                appointments, active, arabic, whatsappWaiting,
                onOpenAppointment, onOpenMoney, onOpenPatients, onOpenWhatsappQueue, onOpenAssistant, onOpenLeads,
            )

            else -> ownerHome(
                active, arabic, whatsappWaiting,
                onOpenAppointment, onOpenReports, onOpenMoney, onOpenInventory, onOpenAssistant, onOpenLeads,
            )
        }

        row {
            Surface(
                onClick = onSeeDay,
                shape = Alpha.PillShape,
                color = Alpha.Card,
                border = BorderStroke(1.dp, Alpha.Slate200),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    if (arabic) "عرض اليوم كاملاً ←" else "See the whole day →",
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate800,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 14.dp),
                )
            }
        }
    }
}

/** Statuses that mean the visit is over, one way or another. */
private val FINISHED = setOf("Completed", "Cancelled", "No Show")

/** Statuses that mean the patient has been dealt with — the day's progress. */
private val SEEN = setOf("Completed", "Checking Out")

/** How far the dashboard's rows sit from the screen edge. The slab ignores it. */
private val GUTTER = 16.dp

// ---------------------------------------------------------------------------
// The slab
// ---------------------------------------------------------------------------

/**
 * The dark band the dashboard opens on.
 *
 * Everything that frames the shift — who you are, what day it is, whether you are
 * clocked in, and for the owner what the day has taken — sits on one unbroken
 * dark surface, and the whole screen below it stays plain. Spending the contrast
 * budget in a single place is what keeps the list underneath readable: by the
 * time the eye arrives at the appointment cards the only colour left anywhere is
 * the status colours, so yellow genuinely does mean "ring this patient" rather
 * than competing with five other bright things for attention.
 */
@Composable
private fun DashboardHeader(
    name: String,
    arabic: Boolean,
    onShift: Boolean,
    shiftSince: Long,
    clocking: Boolean,
    onPunch: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    SlabSurface {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SlabAvatar(name)
            Spacer(Modifier.width(12.dp))
            // The greeting is context, the person is the headline — so the small
            // line goes on top and the name sits alone underneath, in the serif
            // that marks out the screen's few important words and figures.
            Column(Modifier.weight(1f)) {
                Text(
                    text = "${timeGreeting(arabic)} · ${todayLabel(arabic)}",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = onSlabDim,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = shortName(name),
                    fontSize = 23.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = onSlab,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            ClockChip(onShift, shiftSince, clocking, arabic, onPunch)
        }
        content()
    }
}

/** A quiet ring rather than a filled disc — a solid blob up here fought the name. */
@Composable
private fun SlabAvatar(name: String) {
    Box(
        modifier = Modifier
            .size(46.dp)
            .clip(CircleShape)
            .background(onSlab.copy(alpha = .12f))
            .border(1.dp, onSlab.copy(alpha = .22f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.trim().firstOrNull()?.uppercase() ?: "•",
            fontSize = 19.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = AlphaType.Display,
            color = onSlab,
        )
    }
}

/**
 * The owner's day, on the slab: what came through the door, then how far through
 * the bookings the clinic is.
 *
 * Deliberately what was collected, not what was charged — billed-but-unpaid would
 * flatter the figure badly, and this is the one number an owner acts on.
 */
@Composable
private fun SlabTakings(
    takingsToday: Double?,
    seen: Int,
    total: Int,
    noShow: Int,
    arabic: Boolean,
) {
    Row(verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f)) {
            Text(
                text = takingsToday?.let { "${it.toInt()} EGP" } ?: "—",
                fontSize = 34.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = AlphaType.Display,
                color = slabAccent,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = if (arabic) "تحصيل اليوم" else "Collected today",
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = onSlabDim,
            )
        }
        Text(
            text = if (arabic) "$seen من $total" else "$seen of $total seen",
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            color = onSlabDim,
        )
    }
    Spacer(Modifier.height(12.dp))
    SlabProgress(fraction = if (total == 0) 0f else seen.toFloat() / total)
    if (noShow > 0) {
        Spacer(Modifier.height(8.dp))
        Text(
            text = if (arabic) "$noShow لم يحضروا" else "$noShow no-show${if (noShow == 1) "" else "s"}",
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = Alpha.Pink,
        )
    }
}

/** A thin rounded progress bar, sized and coloured for the dark slab. */
@Composable
private fun SlabProgress(fraction: Float) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(Alpha.PillShape)
            .background(onSlab.copy(alpha = .16f))
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .height(6.dp)
                .clip(Alpha.PillShape)
                .background(slabAccent)
        )
    }
}

// ---------------------------------------------------------------------------
// Dentist: who is in my chair, who is next, and the clinical tools.
// ---------------------------------------------------------------------------

private fun LazyListScope.dentistHome(
    session: Session,
    all: List<Appointment>,
    active: List<Appointment>,
    nowMinutes: Int,
    arabic: Boolean,
    onOpen: (Appointment) -> Unit,
    onOpenPatients: () -> Unit,
    onOpenOrtho: () -> Unit,
    onOpenInventory: () -> Unit,
    onOpenAssistant: () -> Unit,
) {
    // Filtered by doctor name because that is what an appointment stores — there is
    // no staff id on the record. If the names do not line up, fall back to the whole
    // day rather than showing a broken-looking empty list.
    val mine = active.filter { it.doctor.isNotBlank() && session.name.contains(it.doctor, ignoreCase = true) }
    val list = mine.ifEmpty { active }

    val inChair = list.firstOrNull { normalizeStatus(it.status) == "In Chair" }
    val next = list.firstOrNull { normalizeStatus(it.status) == "Checked In" }
        ?: list.firstOrNull { it.minutes() >= nowMinutes }

    if (inChair != null) {
        row { HeroAppointment(inChair, arabic, if (arabic) "في الكرسي الآن" else "IN THE CHAIR NOW") { onOpen(inChair) } }
    }

    if (next != null && next.id != inChair?.id) {
        row { SectionHeading(if (arabic) "التالي" else "UP NEXT") }
        row { AppointmentCard(next, arabic) { onOpen(next) } }
    }

    row {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            StatTile(
                value = list.size.toString(),
                caption = if (arabic) "مواعيد متبقية" else "Still to see",
                modifier = Modifier.weight(1f),
            )
            StatTile(
                value = all.count { normalizeStatus(it.status) == "Completed" }.toString(),
                caption = if (arabic) "اكتملت" else "Completed",
                tint = Alpha.Green,
                modifier = Modifier.weight(1f),
            )
        }
    }

    quickActions(
        listOf(
            QuickAction(Icons.Filled.People, if (arabic) "المرضى" else "Patients", onClick = onOpenPatients),
            QuickAction(Icons.Filled.Timeline, if (arabic) "التقويم" else "Ortho", onClick = onOpenOrtho),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
            QuickAction(Icons.Filled.Inventory2, if (arabic) "المخزون" else "Stock", onClick = onOpenInventory),
        ),
    )

    if (list.isEmpty()) {
        row { EmptyState(if (arabic) "لا توجد مواعيد اليوم." else "Nothing booked today.") }
    }
}

// ---------------------------------------------------------------------------
// Reception: act-fast buttons first, then the waiting room, then what's coming.
// ---------------------------------------------------------------------------

private fun LazyListScope.receptionHome(
    all: List<Appointment>,
    active: List<Appointment>,
    arabic: Boolean,
    whatsappWaiting: Int,
    onOpen: (Appointment) -> Unit,
    onOpenMoney: (() -> Unit)?,
    onOpenPatients: () -> Unit,
    onOpenWhatsappQueue: () -> Unit,
    onOpenAssistant: () -> Unit,
    onOpenLeads: (() -> Unit)?,
) {
    quickActions(
        listOfNotNull(
            onOpenLeads?.let { QuickAction(Icons.Filled.PersonSearch, if (arabic) "عملاء" else "Leads", onClick = it) },
            onOpenMoney?.let { QuickAction(Icons.Filled.Payments, if (arabic) "الحسابات" else "Money", onClick = it) },
            QuickAction(Icons.Filled.People, if (arabic) "المرضى" else "Patients", onClick = onOpenPatients),
            QuickAction(
                Icons.Filled.Send, if (arabic) "واتساب" else "WhatsApp",
                badge = whatsappWaiting, onClick = onOpenWhatsappQueue,
            ),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
        ),
    )

    row {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            StatTile(all.size.toString(), if (arabic) "اليوم" else "Booked today", modifier = Modifier.weight(1f))
            val waiting = active.count { normalizeStatus(it.status) == "Checked In" }
            StatTile(
                waiting.toString(),
                if (arabic) "في الانتظار" else "Waiting",
                tint = if (waiting == 0) Alpha.Slate900 else Alpha.Green,
                modifier = Modifier.weight(1f),
            )
            val noShow = all.count { normalizeStatus(it.status) == "No Show" }
            StatTile(
                noShow.toString(),
                if (arabic) "لم يحضروا" else "No shows",
                tint = if (noShow == 0) Alpha.Slate900 else Alpha.Pink,
                modifier = Modifier.weight(1f),
            )
        }
    }

    val waiting = active.filter { normalizeStatus(it.status) == "Checked In" }
    if (waiting.isNotEmpty()) {
        row { SectionHeading(if (arabic) "في غرفة الانتظار" else "IN THE WAITING ROOM") }
        items(waiting, key = { "w-${it.id}" }) { appointment ->
            Gutter { AppointmentCard(appointment, arabic) { onOpen(appointment) } }
        }
    }

    row { SectionHeading(if (arabic) "القادم" else "COMING UP") }
    val upcoming = active.filterNot { normalizeStatus(it.status) == "Checked In" }.take(6)
    if (upcoming.isEmpty()) {
        row { EmptyState(if (arabic) "لا شيء متبقٍ اليوم." else "Nothing left today.") }
    } else {
        items(upcoming, key = { "u-${it.id}" }) { appointment ->
            Gutter { AppointmentCard(appointment, arabic) { onOpen(appointment) } }
        }
    }
}

// ---------------------------------------------------------------------------
// Owner: the management tools and what is still to come. The money and the
// day's progress moved up onto the slab.
// ---------------------------------------------------------------------------

private fun LazyListScope.ownerHome(
    active: List<Appointment>,
    arabic: Boolean,
    whatsappWaiting: Int,
    onOpen: (Appointment) -> Unit,
    onOpenReports: (() -> Unit)?,
    onOpenMoney: (() -> Unit)?,
    onOpenInventory: () -> Unit,
    onOpenAssistant: () -> Unit,
    onOpenLeads: (() -> Unit)?,
) {
    quickActions(
        listOfNotNull(
            onOpenLeads?.let { QuickAction(Icons.Filled.PersonSearch, if (arabic) "عملاء" else "Leads", onClick = it) },
            onOpenReports?.let { QuickAction(Icons.Filled.BarChart, if (arabic) "التقارير" else "Reports", onClick = it) },
            onOpenMoney?.let { QuickAction(Icons.Filled.Payments, if (arabic) "الحسابات" else "Money", onClick = it) },
            QuickAction(Icons.Filled.Inventory2, if (arabic) "المخزون" else "Stock", onClick = onOpenInventory),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
        ),
    )

    row { SectionHeading(if (arabic) "ما زال قادماً" else "STILL TO COME") }
    if (active.isEmpty()) {
        row { EmptyState(if (arabic) "انتهى اليوم." else "The day is done.") }
    } else {
        items(active.take(5), key = { "o-${it.id}" }) { appointment ->
            Gutter { AppointmentCard(appointment, arabic) { onOpen(appointment) } }
        }
    }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * One line of the day's briefing, and a way into the rest of it.
 *
 * It leads with the ageing balances because that is the part of the briefing the
 * dashboard cannot already tell you — money on the books nobody has chased. With
 * nothing ageing it falls back to the unconfirmed count, which is still a thing
 * to act on rather than a thing to admire, and says nothing at all when the day
 * is genuinely clear.
 */
@Composable
private fun BriefingLine(
    briefing: com.alphadental.clinic.ai.BriefingClient.Briefing,
    arabic: Boolean,
    onClick: () -> Unit,
) {
    val stale = briefing.staleBalances.size
    val headline = when {
        stale > 0 && arabic ->
            "${briefing.staleBalanceTotal.toInt()} ج.م على $stale مريض بلا حركة"
        stale > 0 ->
            "${briefing.staleBalanceTotal.toInt()} EGP owed by $stale patient" +
                "${if (stale == 1) "" else "s"}, nothing recent"
        briefing.stillScheduled > 0 && arabic ->
            "${briefing.stillScheduled} موعد لم يُؤكَّد بعد"
        briefing.stillScheduled > 0 ->
            "${briefing.stillScheduled} appointment" +
                "${if (briefing.stillScheduled == 1) "" else "s"} still unconfirmed"
        arabic -> "ملخص اليوم"
        else -> "Today at a glance"
    }

    Surface(
        onClick = onClick,
        shape = Alpha.CardShape,
        color = Alpha.Card,
        border = BorderStroke(1.dp, Alpha.Slate200),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(if (stale > 0) Alpha.Pink else Alpha.Green)
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = headline,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Alpha.Slate800,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = if (arabic) "عرض ←" else "See →",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate500,
            )
        }
    }
}

/** One dashboard row, held in the list's side gutter. */
@Composable
private fun Gutter(content: @Composable () -> Unit) {
    Box(Modifier.padding(horizontal = GUTTER)) { content() }
}

/** A whole list row in the gutter — the common case. */
private fun LazyListScope.row(content: @Composable () -> Unit) {
    item { Gutter(content) }
}

private data class QuickAction(
    val icon: ImageVector,
    val label: String,
    val badge: Int = 0,
    val onClick: () -> Unit,
)

/**
 * The shortcuts, deliberately colourless.
 *
 * They spent a version as six different hues, which made the busiest row on the
 * screen the one carrying the least information — a shortcut being violet says
 * nothing a person needs to know. Outlined pills instead: the icon says which
 * tool it is, and the dashboard's whole colour budget is left to the appointment
 * statuses further down, where a colour marks something somebody has to act on.
 *
 * The row scrolls sideways rather than wrapping, so a sixth tool costs no height.
 */
private fun LazyListScope.quickActions(actions: List<QuickAction>) {
    item {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                // Inside the scroll, so the last chip can still clear the edge.
                .padding(horizontal = GUTTER),
        ) {
            actions.forEach { QuickChip(it) }
        }
    }
}

@Composable
private fun QuickChip(action: QuickAction) {
    Surface(
        onClick = action.onClick,
        shape = Alpha.PillShape,
        color = Alpha.Card,
        border = BorderStroke(1.dp, Alpha.Slate200),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
        ) {
            Icon(action.icon, contentDescription = null, tint = Alpha.Slate700, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(7.dp))
            Text(
                text = action.label,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate900,
                maxLines = 1,
            )
            if (action.badge > 0) {
                Spacer(Modifier.width(6.dp))
                Box(
                    modifier = Modifier
                        .size(17.dp)
                        .clip(CircleShape)
                        .background(Alpha.Danger),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (action.badge > 9) "9+" else action.badge.toString(),
                        fontSize = 9.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                }
            }
        }
    }
}

/**
 * The big status-tinted card for the one appointment that matters right now.
 * Its whole surface takes the status colour, so "someone is in the chair"
 * is readable from across the room.
 */
@Composable
private fun HeroAppointment(
    appointment: Appointment,
    arabic: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    val style = statusStyle(appointment.status)
    Surface(
        onClick = onClick,
        shape = Alpha.BigCardShape,
        color = style.card,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(style.accent)
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    label,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = style.pillText,
                    letterSpacing = 1.2.sp,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialBadge(appointment.patientName, style)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        appointment.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val detail = listOfNotNull(
                        appointment.time.takeIf { it.isNotBlank() },
                        appointment.treatment.takeIf { it.isNotBlank() },
                    ).joinToString("  ·  ")
                    if (detail.isNotBlank()) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            detail,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate600,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Clock in/out as a pill on the slab: the dot says the state, the text says how
 * long, and one tap punches. The full card still lives on the More tab.
 *
 * Off shift it inverts the slab and reads as the day's first button. On shift it
 * drops back to a translucent state chip — clocking out matters less than
 * clocking in, and a second bright thing up here would fight the takings.
 */
@Composable
private fun ClockChip(
    onShift: Boolean,
    since: Long,
    clocking: Boolean,
    arabic: Boolean,
    onPunch: () -> Unit,
) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(onShift) {
        while (onShift) {
            now = System.currentTimeMillis()
            delay(30_000)
        }
    }

    val ink = slabColor
    val paper = onSlab
    Surface(
        onClick = onPunch,
        enabled = !clocking,
        shape = Alpha.PillShape,
        color = if (onShift) paper.copy(alpha = .14f) else paper,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (clocking) {
                CircularProgressIndicator(
                    color = if (onShift) paper else ink,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(12.dp),
                )
            } else {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(if (onShift) slabAccent else ink)
                )
            }
            Spacer(Modifier.width(7.dp))
            Text(
                text = when {
                    clocking && arabic -> "لحظة..."
                    clocking -> "One sec..."
                    onShift && since > 0 -> elapsedLabel(now - since, arabic)
                    onShift && arabic -> "داخل الدوام"
                    onShift -> "On shift"
                    arabic -> "تسجيل حضور"
                    else -> "Clock in"
                },
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = if (onShift) paper else ink,
            )
        }
    }
}

/**
 * "Dr. Ahmed" rather than "Ahmed Mohamed Hassan".
 *
 * Mirrors getWelcomeName() on the website: keep a title if there is one, otherwise
 * just the first name.
 */
private fun shortName(name: String): String {
    val parts = name.trim().split(" ").filter { it.isNotBlank() }
    return when {
        parts.isEmpty() -> ""
        parts.size > 1 && parts[0].trimEnd('.').lowercase() in DOCTOR_TITLES -> "${parts[0]} ${parts[1]}"
        else -> parts[0]
    }
}

/** Follows the clock — a dashboard opened at 8 pm should not say good morning. */
private fun timeGreeting(arabic: Boolean): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when {
        arabic && hour < 12 -> "صباح الخير"
        arabic -> "مساء الخير"
        hour < 12 -> "Good morning"
        hour < 18 -> "Good afternoon"
        else -> "Good evening"
    }
}

/** "Sat, 16 Aug" in the greeting line, in the app's language. */
private fun todayLabel(arabic: Boolean): String {
    val locale = if (arabic) java.util.Locale("ar", "EG") else java.util.Locale.US
    return java.text.SimpleDateFormat("EEE, d MMM", locale).format(java.util.Date())
}
