package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Attendance
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.data.Who
import com.alphadental.clinic.next.design.BigAction
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * The figures the two other homes need that the desk's dashboard does not.
 *
 * Read once when the home is drawn, not watched: a dentist's share today and an owner's week are
 * glanced at, not stared at, and a listener on the whole ledger for a glance is a bill.
 */
data class HomeExtras(
    val loaded: Boolean = false,
    // ---- the dentist's own
    val myCollectedToday: Double = 0.0,
    val myShareToday: Double = 0.0,
    /** What my patients still owe on the work I did, from the last four months of charges. */
    val myOwed: Double = 0.0,
    // ---- the owner's week
    val cashThisWeek: Double = 0.0,
    val cashLastWeek: Double = 0.0,
    val collectedByDentist: List<Pair<String, Double>> = emptyList(),
    val commissionsThisWeek: Double = 0.0,
    val owedToClinic: Double = 0.0,
    val overtimePendingMinutes: Int = 0,
    val hoursWorkedMinutes: Int = 0,
    val staffOnShift: Int = 0,
)

object HomeExtrasLoader {

    private fun key(daysBack: Int): String {
        val cal = java.util.Calendar.getInstance()
        cal.add(java.util.Calendar.DAY_OF_YEAR, -daysBack)
        return java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(cal.time)
    }

    /** My chair, in money: what my patients paid today, my share of it, what they still owe me. */
    suspend fun dentist(who: Who, staffId: String, staffName: String): HomeExtras {
        val today = ClinicSource.dateKey()
        val mine = { m: com.alphadental.clinic.next.data.Money ->
            (staffId.isNotBlank() && m.doctorId == staffId) || (staffName.isNotBlank() && m.doctor == staffName)
        }
        val todayRows = runCatching { ClinicSource.ledgerBetween(who.clinicId, today, today) }.getOrDefault(emptyList()).filter(mine)
        val history = runCatching { ClinicSource.ledgerBetween(who.clinicId, key(120), today) }.getOrDefault(emptyList()).filter(mine)
        val charged = history.filter { it.isCharge }.sumOf { it.amount }
        val paid = history.filter { it.isPayment }.sumOf { it.amount }
        return HomeExtras(
            loaded = true,
            myCollectedToday = todayRows.filter { it.isPayment }.sumOf { it.amount },
            myShareToday = todayRows.filter { it.isPayment }.sumOf { it.commission },
            myOwed = (charged - paid).coerceAtLeast(0.0),
        )
    }

    /** The clinic's week, the way the website's owner home lays it out. */
    suspend fun owner(who: Who): HomeExtras {
        val today = ClinicSource.dateKey()
        val thisWeek = runCatching { ClinicSource.ledgerBetween(who.clinicId, key(6), today) }.getOrDefault(emptyList())
        val lastWeek = runCatching { ClinicSource.ledgerBetween(who.clinicId, key(13), key(7)) }.getOrDefault(emptyList())
        val payments = thisWeek.filter { it.isPayment }
        val staff = runCatching { Attendance.loadStaff(who.clinicId) }.getOrDefault(emptyList())
        val nameOf = { id: String, fallback: String -> staff.firstOrNull { it.id == id }?.name ?: fallback.ifBlank { "Unassigned" } }
        val perDentist = payments.filter { it.doctorId.isNotBlank() || it.doctor.isNotBlank() }
            .groupBy { nameOf(it.doctorId, it.doctor) }
            .map { (name, rows) -> name to rows.sumOf { it.amount } }
            .sortedByDescending { it.second }
        val now = System.currentTimeMillis()
        val weekStart = Attendance.startOfToday(now) - 6L * 24 * 60 * 60 * 1000
        val punches = runCatching { Attendance.punchesBetween(who.clinicId, weekStart, now + 1) }.getOrDefault(emptyList())
        val pending = punches.filter { it.overtimeStatus != "approved" && it.overtimeStatus != "rejected" }
            .sumOf { p -> Attendance.owner(p, staff)?.let { Attendance.overtimeMinutes(p, it) } ?: 0 }
        return HomeExtras(
            loaded = true,
            cashThisWeek = payments.sumOf { it.amount },
            cashLastWeek = lastWeek.filter { it.isPayment }.sumOf { it.amount },
            collectedByDentist = perDentist,
            commissionsThisWeek = payments.sumOf { it.commission },
            owedToClinic = runCatching { ClinicSource.owed(who.clinicId) }.getOrDefault(0.0),
            overtimePendingMinutes = pending,
            hoursWorkedMinutes = punches.sumOf { it.durationMinutes },
            staffOnShift = punches.count { it.status == "active" },
        )
    }
}

// ====================================================================== the dentist's home

/**
 * My chair.
 *
 * Nothing about the clinic's money or anybody else's patients: who is in my chair, who is next,
 * who I have seen, and — if the clinic allows it — what my patients paid today and my share of it.
 * The website's dentist home, in the phone's shape.
 */
fun LazyListScope.dentistHome(
    state: Dashboard,
    ui: InterfaceState,
    extras: HomeExtras,
    onOpenVisit: (Visit) -> Unit,
    onBook: () -> Unit,
) {
    val mineToday = state.visits.filter { v ->
        (ui.staffName.isNotBlank() && v.doctor.equals(ui.staffName, ignoreCase = true)) ||
            (ui.staffId.isNotBlank() && v.doctorId == ui.staffId)
    }
    val inChair = mineToday.firstOrNull { it.status == Stage.InChair }
    val next = mineToday.filterNot { it.status.isFinished || it.status == Stage.InChair }
        .sortedBy { it.minuteOfDay }.firstOrNull()
    val done = mineToday.count { it.status.isSeen }

    item { Eyebrow("The chair") }
    item {
        Card {
            if (inChair != null) {
                Column(Modifier.fillMaxWidth().clickable { onOpenVisit(inChair) }.padding(18.dp)) {
                    Txt("In the chair now", Type.chip, T.inkFaint, uppercase = true)
                    Spacer(Modifier.height(6.dp))
                    Txt(inChair.patientName, Type.heading, T.ink, maxLines = 1)
                    Txt(listOf(inChair.time, inChair.treatment).filter { it.isNotBlank() }.joinToString(" · "), Type.caption, T.inkMuted)
                }
            } else if (next != null) {
                Column(Modifier.fillMaxWidth().clickable { onOpenVisit(next) }.padding(18.dp)) {
                    Txt("Next in the chair", Type.chip, T.inkFaint, uppercase = true)
                    Spacer(Modifier.height(6.dp))
                    Txt(next.patientName, Type.heading, T.ink, maxLines = 1)
                    Txt(listOf(next.time, next.treatment).filter { it.isNotBlank() }.joinToString(" · "), Type.caption, T.inkMuted)
                }
            } else {
                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                    Txt(if (mineToday.isEmpty()) "No patients booked for you today" else "Done for today", Type.heading, T.ink, maxLines = 2)
                    Spacer(Modifier.height(6.dp))
                    Txt(
                        if (ui.staffName.isBlank()) "This account is not on the staff list as a dentist, so no visits can be matched to it."
                        else if (mineToday.isEmpty()) "Nothing in the diary under ${ui.staffName}." else "$done seen.",
                        Type.caption, T.inkMuted, maxLines = 3,
                    )
                }
            }
        }
    }

    item { Eyebrow("My patients today · ${mineToday.size}") }
    if (mineToday.isEmpty()) {
        item { Txt("Nobody yet. Book one, or check the diary.", Type.body, T.inkFaint, Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) }
    }
    items(mineToday.size) { i ->
        Box(Modifier.padding(vertical = 5.dp)) { VisitCard(mineToday[i]) { onOpenVisit(mineToday[i]) } }
    }
    item {
        Column(Modifier.padding(top = 10.dp)) {
            BigAction(Icons.Filled.CalendarMonth, "Book next", primary = false, onClick = onBook)
        }
    }

    item { Eyebrow("My patients paid today") }
    item {
        Card {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Figure("Paid today", extras.myCollectedToday, Modifier.weight(1f))
                if (ui.shareAllowed) Figure("My share", extras.myShareToday, Modifier.weight(1f), ink = Color(0xFF16A34A))
                Figure("Still owed", extras.myOwed, Modifier.weight(1f), ink = if (extras.myOwed > 0) Color(0xFFDC2626) else T.ink)
            }
            if (!ui.shareAllowed) {
                Rule()
                Txt("The clinic has not switched on showing dentists their share.", Type.caption, T.inkFaint, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), maxLines = 2)
            }
        }
    }
}

// ====================================================================== the owner's overview

/** The website's owner home, under the desk's daily overview: the week, per dentist, and the floor. */
fun LazyListScope.ownerOverview(extras: HomeExtras) {
    item { Eyebrow("This week vs last") }
    item {
        Card {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Figure("Cash this week", extras.cashThisWeek, Modifier.weight(1f), ink = Color(0xFF16A34A))
                Figure("Last week", extras.cashLastWeek, Modifier.weight(1f))
                Figure("Owed to clinic", extras.owedToClinic, Modifier.weight(1f), ink = if (extras.owedToClinic > 0) Color(0xFFDC2626) else T.ink)
            }
            val delta = if (extras.cashLastWeek > 0) ((extras.cashThisWeek - extras.cashLastWeek) / extras.cashLastWeek * 100).toInt() else null
            if (delta != null) {
                Rule()
                Txt(
                    if (delta >= 0) "Up $delta% against last week" else "Down ${-delta}% against last week",
                    Type.caption, if (delta >= 0) Color(0xFF16A34A) else Color(0xFFDC2626),
                    Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }

    item { Eyebrow("Collected per dentist") }
    item {
        Card {
            if (extras.collectedByDentist.isEmpty()) {
                Txt("Nothing collected this week yet.", Type.body, T.inkFaint, Modifier.padding(16.dp))
            }
            extras.collectedByDentist.forEachIndexed { i, (name, amount) ->
                if (i > 0) Rule()
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Txt(name, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
                    Txt("${fmt(amount)} EGP", Type.label.copy(fontSize = 13.sp), T.ink)
                }
            }
            Rule()
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt("Commissions owed on this week's cash", Type.caption, T.inkMuted, Modifier.weight(1f), maxLines = 2)
                Txt("${fmt(extras.commissionsThisWeek)} EGP", Type.label.copy(fontSize = 13.sp), Color(0xFFD97706))
            }
        }
    }

    item { Eyebrow("The floor") }
    item {
        Card {
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Small("On shift now", extras.staffOnShift.toString(), Modifier.weight(1f))
                Small("Hours this week", "${extras.hoursWorkedMinutes / 60}h", Modifier.weight(1f))
                Small("Overtime pending", "${extras.overtimePendingMinutes / 60}h ${extras.overtimePendingMinutes % 60}m", Modifier.weight(1f), ink = if (extras.overtimePendingMinutes > 0) Color(0xFFD97706) else T.ink)
            }
        }
    }
}

// ====================================================================== pieces

@Composable
private fun Eyebrow(text: String) {
    Txt(text, Type.eyebrow.copy(letterSpacing = 1.6.sp), T.ink, Modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 8.dp), uppercase = true)
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Surface(
        shape = RoundedCornerShape(18.dp), color = T.surface, border = BorderStroke(1.dp, T.line), shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
    ) { Column { content() } }
}

@Composable
private fun Figure(label: String, value: Double, modifier: Modifier, ink: Color = T.ink) {
    Column(modifier) {
        Txt(label, Type.chip.copy(fontSize = 9.sp), T.inkFaint, uppercase = true, maxLines = 1)
        Spacer(Modifier.height(4.dp))
        Txt(fmt(value), Type.figure.copy(fontSize = 22.sp), ink, maxLines = 1)
        Txt("EGP", Type.chip.copy(fontSize = 9.sp), T.inkFaint)
    }
}

@Composable
private fun Small(label: String, value: String, modifier: Modifier, ink: Color = T.ink) {
    Column(modifier) {
        Txt(label, Type.chip.copy(fontSize = 9.sp), T.inkFaint, uppercase = true, maxLines = 1)
        Spacer(Modifier.height(4.dp))
        Txt(value, Type.label.copy(fontSize = 16.sp), ink, maxLines = 1)
    }
}

private fun fmt(v: Double): String = java.text.NumberFormat.getIntegerInstance(java.util.Locale.US).format(v.toLong())

/** Figures for the walkthrough, in the same shape the loaders return. */
fun previewExtras(): HomeExtras = HomeExtras(
    loaded = true,
    myCollectedToday = 6200.0,
    myShareToday = 2480.0,
    myOwed = 1750.0,
    cashThisWeek = 84300.0,
    cashLastWeek = 71900.0,
    collectedByDentist = listOf("Dr. Youssef" to 46800.0, "Dr. Nour" to 37500.0),
    commissionsThisWeek = 31200.0,
    owedToClinic = 12850.0,
    overtimePendingMinutes = 95,
    hoursWorkedMinutes = 3 * 8 * 60 + 5 * 60 + 40,
    staffOnShift = 4,
)
