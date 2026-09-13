package com.alphadental.clinic.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Science
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
import com.alphadental.clinic.data.withDoctorTitle
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
    /** WhatsApp threads waiting for a person. Null opener for roles that may not read them. */
    chatsWaiting: Int = 0,
    onOpenChats: (() -> Unit)? = null,
    /** Null for roles without access.lab. */
    onOpenLab: (() -> Unit)? = null,
    /** The team's roster. Null for anyone who is not an admin or granted the key. */
    onOpenAttendance: (() -> Unit)? = null,
    onOpenAssistant: () -> Unit,
    /** Null for roles that do not work the CRM inbox. */
    onOpenLeads: (() -> Unit)?,
    /** Today at a glance, once it has arrived. Null while loading, or if it failed. */
    briefing: com.alphadental.clinic.ai.BriefingClient.Briefing? = null,
    onOpenBriefing: () -> Unit = {},
    /** A pull on the dashboard re-reads the slab: takings, shift, briefing. The day is live. */
    refreshing: Boolean = false,
    onRefresh: () -> Unit = {},
    /** A newer build is published. One line under the slab; see UpdateBanner. */
    update: com.alphadental.clinic.UpdateCheck.Update? = null,
    onDownloadUpdate: () -> Unit = {},
    onDismissUpdate: () -> Unit = {},
) {
    val active = appointments.filterNot { normalizeStatus(it.status) in FINISHED }
    val nowMinutes = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

    // The owner's dashboard is the one that carries clinic money, so it is the one
    // whose slab shows the day's takings. The other two get a shorter slab.
    val ownerView = !session.isDentist && !session.isReception
    val seen = appointments.count { normalizeStatus(it.status) in SEEN }
    val noShow = appointments.count { normalizeStatus(it.status) == "No Show" }

    RefreshBox(refreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            // No side gutter on the list itself: the header slab has to reach both
            // screen edges, so every other row asks for the gutter with row()/Gutter().
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                DashboardSlab(
                    name = session.name,
                    arabic = arabic,
                    ownerView = ownerView,
                    takingsToday = takingsToday,
                    booked = appointments.size,
                    seen = seen,
                    waiting = active.count { normalizeStatus(it.status) == "Checked In" },
                    noShow = noShow,
                    onShift = onShift,
                    shiftSince = shiftSince,
                    clocking = clocking,
                    onPunch = onPunch,
                )
            }

            // A newer version of this app, when one is published. Above the briefing because it
        // is the one line on this screen that is about the phone rather than the clinic.
        if (update != null) {
            row {
                UpdateBanner(
                    versionName = update.versionName,
                    sizeBytes = update.sizeBytes,
                    notes = update.notes,
                    arabic = arabic,
                    onDownload = onDownloadUpdate,
                    onDismiss = onDismissUpdate,
                )
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
                    onOpenAppointment, onOpenPatients, onOpenOrtho, onOpenInventory, onOpenLab, onOpenAssistant,
                )

                session.isReception -> receptionHome(
                    appointments, active, arabic, whatsappWaiting, chatsWaiting,
                    onOpenAppointment, onOpenMoney, onOpenPatients, onOpenWhatsappQueue, onOpenChats, onOpenLab, onOpenAssistant, onOpenLeads,
                )

                else -> ownerHome(
                    active, arabic, whatsappWaiting, chatsWaiting,
                    onOpenAppointment, onOpenReports, onOpenMoney, onOpenInventory, onOpenChats, onOpenLab, onOpenAttendance, onOpenAssistant, onOpenLeads,
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
 * Everything that frames the shift — whose day it is, what day it is, whether
 * you are clocked in, and what the clinic has taken — sits on one unbroken dark
 * surface, and the whole screen below it stays plain. Spending the contrast
 * budget in a single place is what keeps the list underneath readable: by the
 * time the eye arrives at the appointments the only colour left anywhere is the
 * status colours, so amber genuinely does mean "ring this patient" rather than
 * competing with five other bright things for attention.
 *
 * The counts used to be three tiles a third of the way down the screen, in the
 * same white card as everything else. They are figures about the day, so they
 * belong on the surface that states the day — and moving them up bought back a
 * whole row of appointments.
 */
@Composable
private fun DashboardSlab(
    name: String,
    arabic: Boolean,
    ownerView: Boolean,
    /** Null for roles that may not see clinic revenue, and while it is still loading. */
    takingsToday: Double?,
    booked: Int,
    seen: Int,
    waiting: Int,
    noShow: Int,
    onShift: Boolean,
    shiftSince: Long,
    clocking: Boolean,
    onPunch: () -> Unit,
) {
    Slab(
        title = shortName(name),
        eyebrow = timeGreeting(arabic) + " \u00B7 " + todayLabel(arabic),
        bar = {
            SlabAvatar(name)
            Spacer(Modifier.weight(1f))
            ClockChip(onShift, shiftSince, clocking, arabic, onPunch)
        },
        // Shown whenever the figure exists rather than whenever the person is an
        // owner: the permission already decided this upstream, and asking twice
        // is how a manager who may see the money gets a dashboard that hides it.
        figure = takingsToday?.let { money ->
            {
                SlabFigure(
                    amount = money.toInt().toString(),
                    currency = if (arabic) "ج.م" else "EGP",
                    note = if (arabic) "تحصيل اليوم" else "collected today",
                    size = if (ownerView) 46 else 38,
                )
            }
        },
        stats = buildList {
            add(SlabStat(if (arabic) "محجوز" else "Booked", booked.toString()))
            add(SlabStat(if (arabic) "تمت" else "Seen", seen.toString()))
            add(SlabStat(if (arabic) "بالانتظار" else "Waiting", waiting.toString()))
            // Only when there are any. A permanent "0 no-shows" teaches people to
            // stop reading the strip.
            if (noShow > 0) add(SlabStat(if (arabic) "لم يحضروا" else "No show", noShow.toString()))
        },
    )
}

/** A quiet ring rather than a filled disc — a solid blob up here fought the name. */
@Composable
private fun SlabAvatar(name: String) {
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(Alpha.SlabFill)
            .border(1.dp, Alpha.SlabLine, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.trim().firstOrNull()?.uppercase() ?: "\u2022",
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = AlphaType.Display,
            color = Alpha.SlabInk,
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
    onOpenLab: (() -> Unit)?,
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
        item { SectionLabel(if (arabic) "التالي" else "Up next") }
        appointmentRows(listOf(next), arabic, onOpen)
    }

    quickActions(
        listOfNotNull(
            QuickAction(Icons.Filled.People, if (arabic) "المرضى" else "Patients", onClick = onOpenPatients),
            // The lab board is the dentist's tool as much as reception's: a fitted crown is closed chairside.
            onOpenLab?.let { QuickAction(Icons.Filled.Science, if (arabic) "المعمل" else "Lab", onClick = it) },
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
    chatsWaiting: Int,
    onOpen: (Appointment) -> Unit,
    onOpenMoney: (() -> Unit)?,
    onOpenPatients: () -> Unit,
    onOpenWhatsappQueue: () -> Unit,
    onOpenChats: (() -> Unit)?,
    onOpenLab: (() -> Unit)?,
    onOpenAssistant: () -> Unit,
    onOpenLeads: (() -> Unit)?,
) {
    quickActions(
        listOfNotNull(
            // Chats first: a patient waiting for a person is the most time-bound thing on the desk.
            onOpenChats?.let { QuickAction(Icons.AutoMirrored.Filled.Chat, if (arabic) "المحادثات" else "Chats", badge = chatsWaiting, onClick = it) },
            onOpenLab?.let { QuickAction(Icons.Filled.Science, if (arabic) "المعمل" else "Lab", onClick = it) },
            onOpenLeads?.let { QuickAction(Icons.Filled.PersonSearch, if (arabic) "عملاء" else "Leads", onClick = it) },
            onOpenMoney?.let { QuickAction(Icons.Filled.Payments, if (arabic) "الحسابات" else "Money", onClick = it) },
            QuickAction(Icons.Filled.People, if (arabic) "المرضى" else "Patients", onClick = onOpenPatients),
            QuickAction(
                Icons.Filled.Send, if (arabic) "قائمة الإرسال" else "Send list",
                badge = whatsappWaiting, onClick = onOpenWhatsappQueue,
            ),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
        ),
    )


    val waiting = active.filter { normalizeStatus(it.status) == "Checked In" }
    if (waiting.isNotEmpty()) {
        item { SectionLabel(if (arabic) "في غرفة الانتظار" else "In the waiting room") }
        appointmentRows(waiting, arabic, onOpen)
    }

    item { SectionLabel(if (arabic) "القادم" else "Coming up") }
    val upcoming = active.filterNot { normalizeStatus(it.status) == "Checked In" }.take(6)
    if (upcoming.isEmpty()) {
        row { EmptyState(if (arabic) "لا شيء متبقٍ اليوم." else "Nothing left today.") }
    } else {
        appointmentRows(upcoming, arabic, onOpen)
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
    chatsWaiting: Int,
    onOpen: (Appointment) -> Unit,
    onOpenReports: (() -> Unit)?,
    onOpenMoney: (() -> Unit)?,
    onOpenInventory: () -> Unit,
    onOpenChats: (() -> Unit)?,
    onOpenLab: (() -> Unit)?,
    onOpenAttendance: (() -> Unit)?,
    onOpenAssistant: () -> Unit,
    onOpenLeads: (() -> Unit)?,
) {
    quickActions(
        listOfNotNull(
            onOpenChats?.let { QuickAction(Icons.AutoMirrored.Filled.Chat, if (arabic) "المحادثات" else "Chats", badge = chatsWaiting, onClick = it) },
            // The owner's morning question, one tap from the slab: who is in?
            onOpenAttendance?.let { QuickAction(Icons.Filled.Groups, if (arabic) "الحضور" else "Attendance", onClick = it) },
            onOpenLab?.let { QuickAction(Icons.Filled.Science, if (arabic) "المعمل" else "Lab", onClick = it) },
            onOpenLeads?.let { QuickAction(Icons.Filled.PersonSearch, if (arabic) "عملاء" else "Leads", onClick = it) },
            onOpenReports?.let { QuickAction(Icons.Filled.BarChart, if (arabic) "التقارير" else "Reports", onClick = it) },
            onOpenMoney?.let { QuickAction(Icons.Filled.Payments, if (arabic) "الحسابات" else "Money", onClick = it) },
            QuickAction(Icons.Filled.Inventory2, if (arabic) "المخزون" else "Stock", onClick = onOpenInventory),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
        ),
    )

    item { SectionLabel(if (arabic) "ما زال قادماً" else "Still to come") }
    if (active.isEmpty()) {
        row { EmptyState(if (arabic) "انتهى اليوم." else "The day is done.") }
    } else {
        appointmentRows(active.take(5), arabic, onOpen)
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
 * The shortcuts: a ruled grid, deliberately colourless.
 *
 * They spent a version as six different hues, which made the busiest row on the
 * screen the one carrying the least information — a shortcut being violet says
 * nothing a person needs to know. The dashboard's whole colour budget belongs to
 * the appointment statuses further down, where a colour marks something somebody
 * has to act on.
 *
 * They then spent a version as a rail of pills that scrolled sideways, which
 * hid half of them: a tool nobody scrolls to is a tool nobody uses. Two columns
 * ruled by hairlines shows every one of them at once, and gives each a caption —
 * "4 threads waiting" is the thing that makes a person tap, not the word Chats.
 */
private fun LazyListScope.quickActions(actions: List<QuickAction>) {
    if (actions.isEmpty()) return
    item {
        Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            RowGroup {
                actions.chunked(2).forEachIndexed { index, pair ->
                    if (index > 0) RowHairline()
                    Row(Modifier.height(IntrinsicSize.Min)) {
                        ActionCell(pair[0], Modifier.weight(1f))
                        // A hairline between the columns, full height, so the grid
                        // reads as one ruled surface rather than as loose tiles.
                        Box(
                            Modifier
                                .width(1.dp)
                                .fillMaxHeight()
                                .background(Alpha.Line)
                        )
                        if (pair.size > 1) {
                            ActionCell(pair[1], Modifier.weight(1f))
                        } else {
                            Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

/** One shortcut: what the tool is, and why you would open it right now. */
@Composable
private fun ActionCell(action: QuickAction, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clickable(onClick = action.onClick)
            .padding(horizontal = 16.dp, vertical = 15.dp),
    ) {
        Icon(
            action.icon,
            contentDescription = null,
            tint = Alpha.Slate500,
            modifier = Modifier.size(17.dp).padding(top = 1.dp),
        )
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = action.label,
                fontFamily = AlphaType.Display,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate900,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (action.badge > 0) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = if (action.badge == 1) "1 waiting" else "${action.badge} waiting",
                    fontFamily = AlphaType.Body,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    // The brand colour as type, which is never the fill colour.
                    color = Alpha.AccentInk,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * The one card on the screen: whoever is in the chair right now.
 *
 * Everything else on the dashboard is a row on a ruled white surface, which is
 * what lets this read as lifted. Its surface used to take the status colour
 * across the whole card, on the reasoning that "someone is in the chair" should
 * be readable from across the room — but when eleven statuses each tint a whole
 * card, the screen is confetti and none of them reads as anything. The stage
 * keeps its colour in the stripe, the pill and the progress bar; the card itself
 * stays white and earns its emphasis from being the only one.
 */
@Composable
private fun HeroAppointment(
    appointment: Appointment,
    arabic: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    val style = statusStyle(appointment.status)
    AlphaCard(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = Alpha.CardShape,
    ) {
        Column {
            Row(
                Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(Alpha.Slab),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = appointment.patientName.trim().firstOrNull()?.uppercase() ?: "\u2022",
                        fontFamily = AlphaType.Display,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.SlabInk,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Eyebrow(label, color = Alpha.Slate500)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        appointment.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                        fontFamily = AlphaType.Display,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.2).sp,
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
                            fontFamily = AlphaType.Body,
                            fontSize = 12.sp,
                            color = Alpha.Slate600,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                StatusPill(appointment.status, arabic)
            }
            // The stage's colour as a rule along the bottom edge, so the card
            // still answers "which stage" from arm's length without wearing it.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(3.dp)
                    .background(style.accent)
            )
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
