package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.Session
import java.util.Calendar

/**
 * The home screen, which is three different screens wearing one name.
 *
 * A dentist between patients, a receptionist at the desk and an owner checking in
 * from elsewhere want genuinely different things first. Rather than one dashboard
 * that half-serves all three, the role on the account decides what opens — the
 * same role the security rules use, so it cannot be talked into showing more than
 * the person is allowed.
 */
@Composable
fun HomeScreen(
    session: Session,
    appointments: List<Appointment>,
    offline: Boolean,
    pending: Int,
    arabic: Boolean,
    onOpenAppointment: (Appointment) -> Unit,
    onSeeDay: () -> Unit,
) {
    val active = appointments.filterNot { normalizeStatus(it.status) in FINISHED }
    val nowMinutes = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column {
                Text(
                    text = greeting(session.name, arabic),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Black,
                    color = Alpha.Slate900,
                )
                Text(
                    text = roleCaption(session.role, arabic),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate500,
                )
            }
        }

        if (offline) {
            item { OfflineBanner(pending, arabic) }
        }

        when {
            session.isDentist -> dentistHome(session, appointments, active, nowMinutes, arabic, onOpenAppointment)
            session.isReception -> receptionHome(appointments, active, arabic, onOpenAppointment)
            else -> ownerHome(appointments, active, arabic, onOpenAppointment)
        }

        item {
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = onSeeDay) {
                Text(
                    if (arabic) "عرض اليوم كاملاً ←" else "See the whole day →",
                    fontWeight = FontWeight.Black,
                    color = Alpha.Slate600,
                    fontSize = 14.sp,
                )
            }
        }
    }
}

/** Statuses that mean the visit is over, one way or another. */
private val FINISHED = setOf("Completed", "Cancelled", "No Show")

/**
 * Dentist: only their own list, and only what is happening now or next.
 *
 * Filtered by doctor name because that is what an appointment stores — there is no
 * staff id on the record. If the name on the account does not match the name on
 * the appointments, the list would be empty and look broken, so it falls back to
 * the whole day rather than showing nothing.
 */
private fun LazyListScope.dentistHome(
    session: Session,
    all: List<Appointment>,
    active: List<Appointment>,
    nowMinutes: Int,
    arabic: Boolean,
    onOpen: (Appointment) -> Unit,
) {
    val mine = active.filter { it.doctor.isNotBlank() && session.name.contains(it.doctor, ignoreCase = true) }
    val list = mine.ifEmpty { active }

    val inChair = list.firstOrNull { normalizeStatus(it.status) == "In Chair" }
    val next = list.firstOrNull { normalizeStatus(it.status) == "Checked In" }
        ?: list.firstOrNull { it.minutes() >= nowMinutes }

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

    if (inChair != null) {
        item { SectionHeading(if (arabic) "في الكرسي الآن" else "IN THE CHAIR NOW") }
        item { AppointmentCard(inChair, arabic) { onOpen(inChair) } }
    }

    if (next != null && next.id != inChair?.id) {
        item { SectionHeading(if (arabic) "التالي" else "UP NEXT") }
        item { AppointmentCard(next, arabic) { onOpen(next) } }
    }

    if (list.isEmpty()) {
        item { EmptyState(if (arabic) "لا توجد مواعيد اليوم." else "Nothing booked today.") }
    }
}

/** Receptionist: the whole floor, with whoever is waiting pulled to the top. */
private fun LazyListScope.receptionHome(
    all: List<Appointment>,
    active: List<Appointment>,
    arabic: Boolean,
    onOpen: (Appointment) -> Unit,
) {
    val waiting = active.filter { normalizeStatus(it.status) == "Checked In" }

    item {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            StatTile(all.size.toString(), if (arabic) "اليوم" else "Booked today", modifier = Modifier.weight(1f))
            StatTile(
                waiting.size.toString(),
                if (arabic) "في الانتظار" else "Waiting",
                tint = if (waiting.isEmpty()) Alpha.Slate900 else Alpha.Green,
                modifier = Modifier.weight(1f),
            )
            StatTile(
                all.count { normalizeStatus(it.status) == "No Show" }.toString(),
                if (arabic) "لم يحضروا" else "No shows",
                tint = Alpha.Pink,
                modifier = Modifier.weight(1f),
            )
        }
    }

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

/** Owner: the shape of the day, not the work of it. */
private fun LazyListScope.ownerHome(
    all: List<Appointment>,
    active: List<Appointment>,
    arabic: Boolean,
    onOpen: (Appointment) -> Unit,
) {
    val seen = all.count { normalizeStatus(it.status) in setOf("Completed", "Checking Out") }
    val noShow = all.count { normalizeStatus(it.status) == "No Show" }

    item {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            StatTile(all.size.toString(), if (arabic) "محجوز" else "Booked", modifier = Modifier.weight(1f))
            StatTile(seen.toString(), if (arabic) "تم" else "Seen", tint = Alpha.Green, modifier = Modifier.weight(1f))
            StatTile(
                noShow.toString(),
                if (arabic) "لم يحضروا" else "No shows",
                tint = if (noShow == 0) Alpha.Slate900 else Alpha.Pink,
                modifier = Modifier.weight(1f),
            )
        }
    }

    item { SectionHeading(if (arabic) "ما زال قادماً" else "STILL TO COME") }
    if (active.isEmpty()) {
        item { EmptyState(if (arabic) "انتهى اليوم." else "The day is done.") }
    } else {
        items(active.take(5), key = { "o-${it.id}" }) { AppointmentCard(it, arabic) { onOpen(it) } }
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
        parts.size > 1 && parts[0].trimEnd('.').lowercase() in TITLES -> "${parts[0]} ${parts[1]}"
        else -> parts[0]
    }
    return if (arabic) "أهلاً $short" else "Hello $short"
}

private val TITLES = setOf("dr", "د", "دكتور", "doctor", "prof", "أستاذ", "استاذ")

private fun roleCaption(role: String, arabic: Boolean): String = when (role) {
    "Admin" -> if (arabic) "مدير العيادة" else "Clinic owner"
    "Dentist" -> if (arabic) "طبيب" else "Dentist"
    "Receptionist" -> if (arabic) "استقبال" else "Reception"
    else -> if (arabic) "فريق العيادة" else "Clinic staff"
}
