package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.ui.text.font.FontWeight
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
) {
    val active = appointments.filterNot { normalizeStatus(it.status) in FINISHED }
    val nowMinutes = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                // Solid ink rather than a soft tint: on the tinted ground the pale
                // circle all but vanished, and the header lost its anchor.
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(Alpha.Ink),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        session.name.trim().firstOrNull()?.uppercase() ?: "•",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = greeting(session.name, arabic),
                        fontSize = 21.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = "${roleCaption(session.role, arabic)} · ${todayLabel(arabic)}",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
                Spacer(Modifier.width(8.dp))
                ClockChip(onShift, shiftSince, clocking, arabic, onPunch)
            }
        }

        if (clockError != null) {
            item {
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
            item { OfflineBanner(pending, arabic) }
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
                appointments, active, arabic, takingsToday, whatsappWaiting,
                onOpenAppointment, onOpenReports, onOpenMoney, onOpenInventory, onOpenAssistant, onOpenLeads,
            )
        }

        item {
            Spacer(Modifier.height(2.dp))
            Surface(
                onClick = onSeeDay,
                shape = Alpha.PillShape,
                color = Alpha.GreenSoft,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    if (arabic) "عرض اليوم كاملاً ←" else "See the whole day →",
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Green,
                    fontSize = 14.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.padding(vertical = 13.dp),
                )
            }
        }
    }
}

/** Statuses that mean the visit is over, one way or another. */
private val FINISHED = setOf("Completed", "Cancelled", "No Show")

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
        item { HeroAppointment(inChair, arabic, if (arabic) "في الكرسي الآن" else "IN THE CHAIR NOW") { onOpen(inChair) } }
    }

    if (next != null && next.id != inChair?.id) {
        item { SectionHeading(if (arabic) "التالي" else "UP NEXT") }
        item { AppointmentCard(next, arabic) { onOpen(next) } }
    }

    item {
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
        arabic,
        listOf(
            QuickAction(Icons.Filled.People, if (arabic) "المرضى" else "Patients", onClick = onOpenPatients),
            QuickAction(Icons.Filled.Timeline, if (arabic) "التقويم" else "Ortho", onClick = onOpenOrtho),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
            QuickAction(Icons.Filled.Inventory2, if (arabic) "المخزون" else "Stock", onClick = onOpenInventory),
        ),
    )

    if (list.isEmpty()) {
        item { EmptyState(if (arabic) "لا توجد مواعيد اليوم." else "Nothing booked today.") }
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
        arabic,
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

    item {
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
        item { SectionHeading(if (arabic) "في غرفة الانتظار" else "IN THE WAITING ROOM") }
        items(waiting, key = { "w-${it.id}" }) { AppointmentCard(it, arabic) { onOpen(it) } }
    }

    item { SectionHeading(if (arabic) "القادم" else "COMING UP") }
    val upcoming = active.filterNot { normalizeStatus(it.status) == "Checked In" }.take(6)
    if (upcoming.isEmpty()) {
        item { EmptyState(if (arabic) "لا شيء متبقٍ اليوم." else "Nothing left today.") }
    } else {
        items(upcoming, key = { "u-${it.id}" }) { AppointmentCard(it, arabic) { onOpen(it) } }
    }
}

// ---------------------------------------------------------------------------
// Owner: the money, the shape of the day, and the management tools.
// ---------------------------------------------------------------------------

private fun LazyListScope.ownerHome(
    all: List<Appointment>,
    active: List<Appointment>,
    arabic: Boolean,
    takingsToday: Double?,
    whatsappWaiting: Int,
    onOpen: (Appointment) -> Unit,
    onOpenReports: (() -> Unit)?,
    onOpenMoney: (() -> Unit)?,
    onOpenInventory: () -> Unit,
    onOpenAssistant: () -> Unit,
    onOpenLeads: (() -> Unit)?,
) {
    val seen = all.count { normalizeStatus(it.status) in setOf("Completed", "Checking Out") }
    val noShow = all.count { normalizeStatus(it.status) == "No Show" }

    // The owner's day on one card: the money in, then how far through the
    // bookings the clinic is. The figure is deliberately what came through the
    // door, not what was charged — billed-but-unpaid would flatter it badly.
    // One white card instead of the old tinted-money-card-plus-progress-card
    // pair: the tinted card sat on the tinted ground and the pair ate half the
    // screen between them.
    item {
        AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = takingsToday?.let { "${it.toInt()} EGP" } ?: "—",
                            fontSize = 27.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Alpha.Green,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = if (arabic) "تحصيل اليوم" else "Collected today",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.Slate600,
                        )
                    }
                    Text(
                        text = when {
                            arabic -> "$seen من ${all.size}"
                            else -> "$seen of ${all.size} seen"
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate500,
                    )
                }
                Spacer(Modifier.height(10.dp))
                ProgressTrack(fraction = if (all.isEmpty()) 0f else seen.toFloat() / all.size)
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
        }
    }

    quickActions(
        arabic,
        listOfNotNull(
            onOpenLeads?.let { QuickAction(Icons.Filled.PersonSearch, if (arabic) "عملاء" else "Leads", onClick = it) },
            onOpenReports?.let { QuickAction(Icons.Filled.BarChart, if (arabic) "التقارير" else "Reports", onClick = it) },
            onOpenMoney?.let { QuickAction(Icons.Filled.Payments, if (arabic) "الحسابات" else "Money", onClick = it) },
            QuickAction(Icons.Filled.Inventory2, if (arabic) "المخزون" else "Stock", onClick = onOpenInventory),
            QuickAction(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
        ),
    )

    item { SectionHeading(if (arabic) "ما زال قادماً" else "STILL TO COME") }
    if (active.isEmpty()) {
        item { EmptyState(if (arabic) "انتهى اليوم." else "The day is done.") }
    } else {
        items(active.take(5), key = { "o-${it.id}" }) { AppointmentCard(it, arabic) { onOpen(it) } }
    }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

private data class QuickAction(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val label: String,
    val badge: Int = 0,
    val onClick: () -> Unit,
)

private fun LazyListScope.quickActions(arabic: Boolean, actions: List<QuickAction>) {
    item {
        Column {
            SectionHeading(if (arabic) "اختصارات" else "SHORTCUTS")
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                actions.forEach { action ->
                    ToolTile(
                        icon = action.icon,
                        label = action.label,
                        badge = action.badge,
                        modifier = Modifier.weight(1f),
                        onClick = action.onClick,
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
 * Clock in/out as a pill in the header: the dot says the state, the text says
 * how long, and one tap punches. The full card still lives on the More tab.
 *
 * Off shift the chip is the day's first action, so it dresses as a filled
 * button — the old grey pill read as disabled. On shift it relaxes into a soft
 * tint that reads as state, not another thing to press.
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

    Surface(
        onClick = onPunch,
        enabled = !clocking,
        shape = Alpha.PillShape,
        color = if (onShift) Alpha.GreenSoft else Alpha.Ink,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (clocking) {
                CircularProgressIndicator(
                    color = if (onShift) Alpha.Slate400 else Color.White,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(12.dp),
                )
            } else {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(if (onShift) Alpha.Green else Color.White.copy(alpha = .9f))
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
                color = if (onShift) Alpha.Green else Color.White,
            )
        }
    }
}

/** A thin rounded progress bar, no library, no animation surprises. */
@Composable
private fun ProgressTrack(fraction: Float) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(Alpha.PillShape)
            .background(Alpha.Slate100)
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .height(8.dp)
                .clip(Alpha.PillShape)
                .background(Alpha.Green)
        )
    }
}

/**
 * "Dr. Ahmed" rather than "Ahmed Mohamed Hassan".
 *
 * Mirrors getWelcomeName() on the website: keep a title if there is one, otherwise
 * just the first name.
 */
private fun greeting(name: String, arabic: Boolean): String {
    val parts = name.trim().split(" ").filter { it.isNotBlank() }
    val short = when {
        parts.isEmpty() -> ""
        parts.size > 1 && parts[0].trimEnd('.').lowercase() in DOCTOR_TITLES -> "${parts[0]} ${parts[1]}"
        else -> parts[0]
    }
    return if (arabic) "أهلاً $short" else "Hello $short"
}

/** "Sat, 16 Aug" in the greeting line, in the app's language. */
private fun todayLabel(arabic: Boolean): String {
    val locale = if (arabic) java.util.Locale("ar", "EG") else java.util.Locale.US
    return java.text.SimpleDateFormat("EEE, d MMM", locale).format(java.util.Date())
}

private fun roleCaption(role: String, arabic: Boolean): String = when (role) {
    "Admin" -> if (arabic) "مدير العيادة" else "Clinic owner"
    "Dentist" -> if (arabic) "طبيب" else "Dentist"
    "Receptionist" -> if (arabic) "استقبال" else "Reception"
    else -> if (arabic) "فريق العيادة" else "Clinic staff"
}
