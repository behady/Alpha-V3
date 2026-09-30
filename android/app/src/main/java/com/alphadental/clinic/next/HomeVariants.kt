package com.alphadental.clinic.next

import kotlinx.coroutines.flow.first
import androidx.compose.foundation.layout.size
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
    // ---- what needs the owner, the website's list in the website's order
    val needs: List<Need> = emptyList(),
    /** Yesterday in three lines, from the website's owner summary. Empty until it answers. */
    val summary: List<String> = emptyList(),
    val summaryDate: String = "",
    val summaryAi: Boolean = false,
    /** The three biggest balances, and the whole figure behind them. */
    val debtors: List<Triple<String, String, Double>> = emptyList(),
)

/** One line at the top of the owner's home: what is wrong, and where to go about it. */
data class Need(val key: String, val text: String, val cta: String, val high: Boolean)

/**
 * The website's `needsYou`, rule for rule: cash a fifth or more behind the same weekday last week
 * (prorated by how much of the clinic's day has gone), lab cases late or due today, staff absent
 * or late, tomorrow unconfirmed, a no-show spike (three or more, and half again the usual), and
 * overtime waiting. Only what is actually wrong — an empty list is the good news.
 */
object NeedsYou {
    const val BEHIND_RATIO = 0.8

    fun cashPace(collected: Double, previous: Double?, elapsed: Double): Triple<Double, Double?, Double> {
        val prev = previous ?: 0.0
        if (prev <= 0.0) return Triple(0.0, null, 0.0)
        val expected = prev * elapsed.coerceIn(0.0, 1.0)
        if (expected <= 0.0) return Triple(0.0, null, 0.0)
        return Triple(expected, collected / expected, (expected - collected).coerceAtLeast(0.0))
    }

    fun build(
        pace: Triple<Double, Double?, Double>,
        labLate: Int, labDueToday: Int,
        absentToday: Int, lateToday: Int,
        unconfirmedTomorrow: Int,
        noShowsThisWeek: Int, noShowsUsual: Double,
        overtimePending: Int,
        fmt: (Double) -> String,
    ): List<Need> {
        val items = mutableListOf<Need>()
        val ratio = pace.second
        if (ratio != null && ratio < BEHIND_RATIO) {
            items += Need("cash_behind", "Cash is ${((1 - ratio) * 100).toInt()}% behind the same weekday last week (${fmt(pace.third)} EGP short)", "Money", true)
        }
        if (labLate > 0 || labDueToday > 0) {
            items += Need("lab_late", if (labLate > 0) "$labLate lab case(s) late" + (if (labDueToday > 0) " · $labDueToday due today" else "") else "$labDueToday lab case(s) due today", "Lab", labLate > 0)
        }
        if (absentToday > 0) items += Need("staff_absent", "$absentToday staff absent today", "Attendance", true)
        if (lateToday > 0) items += Need("staff_late", "$lateToday staff late today", "Attendance", false)
        if (unconfirmedTomorrow > 0) items += Need("unconfirmed", "$unconfirmedTomorrow visit(s) tomorrow still unconfirmed", "Diary", false)
        if (noShowsThisWeek >= 3 && noShowsThisWeek >= noShowsUsual * 1.5) {
            items += Need("noshow_spike", "$noShowsThisWeek no-shows this week (usually ${Math.round(noShowsUsual)})", "Diary", false)
        }
        if (overtimePending > 0) items += Need("overtime", "$overtimePending staff with overtime waiting for your approval", "Attendance", false)
        return items.sortedBy { if (it.high) 0 else 1 }
    }
}

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

    /** Sunday-based week start for a yyyy-MM-dd key, the website's `weekDaysFrom` rule. */
    private fun weekStartOf(key: String): String = runCatching {
        val d = java.time.LocalDate.parse(key)
        d.minusDays(d.dayOfWeek.value % 7L).toString()
    }.getOrDefault(key)

    /** The clinic's week, the way the website's owner home lays it out. */
    suspend fun owner(who: Who): HomeExtras {
        val base = ownerWeek(who)
        val today = ClinicSource.dateKey()
        val clinicId = who.clinicId

        // Cash today against the same weekday last week, by how much of the day has gone.
        val hours = runCatching { ClinicSource.hours(clinicId) }.getOrDefault(com.alphadental.clinic.next.data.Hours())
        val nowMin = java.util.Calendar.getInstance().let { it.get(java.util.Calendar.HOUR_OF_DAY) * 60 + it.get(java.util.Calendar.MINUTE) }
        val span = (hours.closes - hours.startMinute).coerceAtLeast(60)
        val elapsed = ((nowMin - hours.startMinute).toDouble() / span).coerceIn(0.0, 1.0)
        val collected = runCatching { ClinicSource.takings(clinicId, today) }.getOrDefault(0.0)
        val lastWeekSameDay = runCatching { ClinicSource.takings(clinicId, key(7)) }.getOrDefault(0.0)
        val pace = NeedsYou.cashPace(collected, lastWeekSameDay, elapsed)

        // The lab board, once: late and due today.
        val cases = if (who.can("access.lab")) runCatching {
            kotlinx.coroutines.withTimeout(8_000) { com.alphadental.clinic.data.LabCases.observeCases(clinicId).first().getOrDefault(emptyList()) }
        }.getOrDefault(emptyList()) else emptyList()
        val labLate = cases.count { com.alphadental.clinic.data.LabCases.dueStateFor(it, today) == com.alphadental.clinic.data.LabCases.Due.OVERDUE }
        val labDueToday = cases.count { com.alphadental.clinic.data.LabCases.dueStateFor(it, today) == com.alphadental.clinic.data.LabCases.Due.DUE_TODAY }

        // Today's roster: who has not turned up past their start, and who came late.
        val staff = runCatching { Attendance.loadStaff(clinicId) }.getOrDefault(emptyList())
        val now = System.currentTimeMillis()
        val todayPunches = runCatching { Attendance.punchesBetween(clinicId, Attendance.startOfToday(now), now + 1) }.getOrDefault(emptyList())
        val roster = Attendance.roster(staff, todayPunches, now)
        val absentToday = roster.count { it.state == Attendance.State.NOT_ARRIVED && it.lateMinutes > 0 }
        val lateToday = roster.count { (it.state == Attendance.State.ON_SHIFT || it.state == Attendance.State.DONE) && it.lateMinutes > 0 }
        val overtimePeople = todayPunches.filter { it.overtimeStatus != "approved" && it.overtimeStatus != "rejected" }
            .filter { p -> Attendance.owner(p, staff)?.let { Attendance.overtimeMinutes(p, it) > 0 } == true }
            .map { it.staffId }.distinct().size

        // Tomorrow's diary, and four weeks of no-shows by week.
        val tomorrow = key(-1)
        val unconfirmedTomorrow = runCatching { ClinicSource.visitsBetween(clinicId, tomorrow, tomorrow) }.getOrDefault(emptyList())
            .count { it.status == com.alphadental.clinic.next.data.Stage.Unconfirmed }
        val month = runCatching { ClinicSource.visitsBetween(clinicId, key(27), today) }.getOrDefault(emptyList())
        val thisWeekStart = weekStartOf(today)
        val byWeek = month.groupBy { weekStartOf(it.date) }
        val noShowsThisWeek = byWeek[thisWeekStart].orEmpty().count { it.status == com.alphadental.clinic.next.data.Stage.NoShow }
        val before = byWeek.filterKeys { it != thisWeekStart }.values
        val usual = if (before.isEmpty()) 0.0 else before.map { w -> w.count { it.status == com.alphadental.clinic.next.data.Stage.NoShow } }.average()

        val fmt = { n: Double -> java.text.NumberFormat.getIntegerInstance(java.util.Locale.US).format(n.toLong()) }
        val needs = NeedsYou.build(pace, labLate, labDueToday, absentToday, lateToday, unconfirmedTomorrow, noShowsThisWeek, usual, overtimePeople, fmt)

        val debtors = runCatching { ClinicSource.debtors(clinicId, 3) }.getOrDefault(emptyList()).map { Triple(it.id, it.name, it.balance) }
        val summary = runCatching { com.alphadental.clinic.next.data.OwnerSummaryClient.yesterday(clinicId, com.alphadental.clinic.next.data.AppLocale.language.value) }.getOrNull()

        return base.copy(
            needs = needs,
            summary = summary?.lines.orEmpty(),
            summaryDate = summary?.dateKey.orEmpty(),
            summaryAi = summary?.ai == true,
            debtors = debtors,
        )
    }

    private suspend fun ownerWeek(who: Who): HomeExtras {
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
fun LazyListScope.ownerOverview(extras: HomeExtras, onGo: (String) -> Unit = {}, onOpenPatient: (String) -> Unit = {}) {
    // ---- What is wrong, first. An empty list says so rather than showing six zeros.
    item { Eyebrow("Needs you") }
    item {
        Card {
            if (!extras.loaded) {
                Txt("Looking…", Type.body, T.inkFaint, Modifier.padding(16.dp))
            } else if (extras.needs.isEmpty()) {
                Txt("Nothing needs you right now.", Type.body, T.inkFaint, Modifier.padding(16.dp))
            }
            extras.needs.forEachIndexed { i, n ->
                if (i > 0) Rule()
                Row(
                    Modifier.fillMaxWidth().clickable { onGo(n.cta) }.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(8.dp).background(if (n.high) T.danger else T.warn, androidx.compose.foundation.shape.CircleShape))
                    Spacer(Modifier.width(10.dp))
                    Txt(n.text, Type.body, T.ink, Modifier.weight(1f), maxLines = 3)
                    Spacer(Modifier.width(8.dp))
                    Txt(n.cta, Type.chip, T.inkFaint, uppercase = true)
                }
            }
        }
    }

    // ---- Yesterday in three lines: the same text the website shows and the evening digest sends.
    if (extras.summary.isNotEmpty()) {
        item { Eyebrow("Yesterday · ${extras.summaryDate}${if (extras.summaryAi) " · AI" else ""}") }
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    extras.summary.forEach { line -> Txt(line, Type.body, T.ink, maxLines = 4) }
                }
            }
        }
    }

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

    // ---- Who owes the clinic the most. The whole figure is on the card above; these are the calls.
    if (extras.debtors.isNotEmpty()) {
        item { Eyebrow("Still owed to the clinic") }
        item {
            Card {
                extras.debtors.forEachIndexed { i, (id, name, owed) ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().clickable { onOpenPatient(id) }.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Txt(name.ifBlank { "Unnamed" }, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
                        Txt("${fmt(owed)} EGP", Type.label.copy(fontSize = 13.sp), Color(0xFFDC2626))
                    }
                }
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
