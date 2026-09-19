package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.ListAlt
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicalNote
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.data.TreatmentPlans
import com.alphadental.clinic.next.data.LOWER_LEFT
import com.alphadental.clinic.next.data.LOWER_RIGHT
import com.alphadental.clinic.next.data.Money
import com.alphadental.clinic.next.data.Record
import com.alphadental.clinic.next.data.UPPER_LEFT
import com.alphadental.clinic.next.data.UPPER_RIGHT
import com.alphadental.clinic.next.design.Avatar
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/*
 * The website's patient page, on the phone.
 *
 * Same cards, same order, same colours: the dark identity card, the two-figure stats card, the
 * three quick actions, the pill tabs, and under them the clinical timeline and the finance table
 * exactly as the desk draws them. A receptionist who learned the desk should not learn this twice.
 * Where the web's palette is not one of the app's tokens it is named here once.
 */
private val Teal = Color(0xFF0D9488)
private val Blue = Color(0xFF2563EB)
private val BlueTint = Color(0xFFDBEAFE)
private val Green = Color(0xFF16A34A)
private val GreenTint = Color(0xFFDCFCE7)
private val GreenSoft = Color(0xFF4ADE80)
private val Purple = Color(0xFF7C3AED)
private val PurpleTint = Color(0xFFEDE9FE)
private val Red = Color(0xFFDC2626)
private val RedTint = Color(0xFFFEE2E2)
private val RedWash = Color(0xFFFEF2F2)
private val Amber = Color(0xFFD97706)
private val AmberTint = Color(0xFFFEF3C7)
private val Slate = Color(0xFF0F172A)
private val GreyTint = Color(0xFFF1F5F9)
private val GreyInk = Color(0xFF64748B)

// ====================================================================== header cards

/** The dark identity card: avatar, name, age · gender, the balance pill, phone and address. */
@Composable
fun PatientCard(record: Record, onEdit: (() -> Unit)?, onCall: (String) -> Unit, onMessage: (String) -> Unit) {
    Surface(
        shape = RoundedCornerShape(22.dp), color = Slate,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)).background(Color.White.copy(alpha = .08f)), contentAlignment = Alignment.Center) {
                    Avatar(record.person.name, size = 56)
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Txt(record.person.name.ifBlank { "No name" }, Type.heading.copy(fontSize = 20.sp), Color.White, maxLines = 1)
                    Spacer(Modifier.height(2.dp))
                    Txt(
                        listOfNotNull(record.age?.let { "$it Years" }, record.gender.takeIf { it.isNotBlank() }).joinToString("  •  "),
                        Type.caption, Color(0xFFCBD5E1),
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val b = record.balance
                        Surface(shape = T.pill, color = Color.White.copy(alpha = .12f)) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.AccountBalanceWallet, null, tint = Color.White, modifier = Modifier.size(13.dp))
                                Spacer(Modifier.width(6.dp))
                                Txt(
                                    if (b.credit > 0) "${fmt(b.credit)} EGP credit" else "${fmt(b.owed)} EGP",
                                    Type.label.copy(fontSize = 12.sp), Color.White,
                                )
                            }
                        }
                        onEdit?.let {
                            Spacer(Modifier.width(8.dp))
                            Box(Modifier.size(30.dp).clip(CircleShape).background(Color.White.copy(alpha = .12f)).clickable(onClick = it), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.Edit, "Edit details", tint = Color.White, modifier = Modifier.size(13.dp))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = .1f)))
            Spacer(Modifier.height(6.dp))
            record.person.phone.takeIf { it.isNotBlank() }?.let { phone ->
                DarkRow(Icons.AutoMirrored.Filled.Chat, phone) { onMessage(phone) }
            }
            record.address.takeIf { it.isNotBlank() }?.let { DarkRow(Icons.Filled.LocationOn, it, null) }
        }
    }
}

@Composable
private fun DarkRow(icon: ImageVector, text: String, onClick: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(Color.White.copy(alpha = .1f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(15.dp))
        }
        Spacer(Modifier.width(12.dp))
        Txt(text, Type.rowName, Color.White, maxLines = 2)
    }
}

/** VISITS | COMPLETED, the two large serif figures. */
@Composable
fun StatsCard(visits: Int, completed: Int) {
    WhiteCard {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            BigStat("Visits", visits, Modifier.weight(1f))
            Box(Modifier.width(1.dp).fillMaxHeight().background(T.line))
            BigStat("Completed", completed, Modifier.weight(1f))
        }
    }
}

@Composable
private fun BigStat(label: String, value: Int, modifier: Modifier) {
    Column(modifier.padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Txt(label, Type.chip.copy(fontSize = 10.sp), GreyInk, uppercase = true)
        Spacer(Modifier.height(6.dp))
        Txt(value.toString(), Type.figure.copy(fontSize = 34.sp), T.ink)
    }
}

/** Write Rx · Diagnosis · Ortho, in the website's three colours. */
@Composable
fun QuickActions(onRx: (() -> Unit)?, onDiagnosis: () -> Unit, onOrtho: (() -> Unit)?) {
    WhiteCard {
        Column(Modifier.padding(14.dp)) {
            Txt("Quick actions", Type.chip.copy(fontSize = 10.sp), GreyInk, Modifier.fillMaxWidth(), uppercase = true, align = androidx.compose.ui.text.style.TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionChip("Write Rx", Icons.Filled.Medication, Blue, Modifier.weight(1f), onRx)
                ActionChip("Diagnosis", Icons.Filled.MonitorHeart, Green, Modifier.weight(1f), onDiagnosis)
                ActionChip("Ortho", Icons.Filled.Timeline, Purple, Modifier.weight(1f), onOrtho)
            }
        }
    }
}

@Composable
private fun ActionChip(label: String, icon: ImageVector, ink: Color, modifier: Modifier, onClick: (() -> Unit)?) {
    Surface(
        shape = RoundedCornerShape(12.dp), color = T.surface,
        border = BorderStroke(1.dp, T.line),
        modifier = modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    ) {
        Row(Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = if (onClick != null) ink else T.inkFaint, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Txt(label, Type.label.copy(fontSize = 13.sp), if (onClick != null) ink else T.inkFaint, maxLines = 1)
        }
    }
}

/** The pill tabs. Selected is a white pill with a shadow, the rest are text. */
@Composable
fun WebTabs(current: RecordTab, onTab: (RecordTab) -> Unit) {
    Surface(
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp), color = GreyTint,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
    ) {
        Row(
            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            RecordTab.entries.forEach { tab ->
                val on = tab == current
                Surface(
                    shape = T.pill,
                    color = if (on) T.surface else Color.Transparent,
                    shadowElevation = if (on) 2.dp else 0.dp,
                    modifier = Modifier.clickable { onTab(tab) },
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(tabIcon(tab), null, tint = if (on) T.ink else GreyInk, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(6.dp))
                        Txt(tab.label, Type.label.copy(fontSize = 14.sp), if (on) T.ink else GreyInk, maxLines = 1)
                    }
                }
            }
        }
    }
}

private fun tabIcon(tab: RecordTab): ImageVector = when (tab) {
    RecordTab.Notes -> Icons.Filled.MonitorHeart
    RecordTab.Plan -> Icons.Filled.ListAlt
    RecordTab.Ledger -> Icons.Filled.AccountBalanceWallet
    RecordTab.Visits -> Icons.Filled.History
    RecordTab.Overview -> Icons.Filled.Dashboard
    RecordTab.Photos -> Icons.Filled.CameraAlt
    RecordTab.Rx -> Icons.Filled.Medication
    RecordTab.Ai -> Icons.Filled.AutoAwesome
}

// ====================================================================== clinical

/**
 * "Clinical History & Procedures": the website's timeline.
 *
 * Date and time down the left, a dot on a line, the procedure card beside it with its status
 * chip, tooth chip, dentist and price, and the purple pencil and red bin at the end.
 */
fun LazyListScope.clinical(
    state: RecordState,
    onAdd: (() -> Unit)?,
    onSort: () -> Unit,
    onEdit: ((ClinicalNote) -> Unit)?,
    onDelete: ((ClinicalNote) -> Unit)?,
) {
    item {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Surface(shape = RoundedCornerShape(18.dp), color = T.surface, border = BorderStroke(1.dp, T.line), modifier = Modifier.fillMaxWidth()) {
                Column {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(46.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFF0FDFA)).border(1.dp, Color(0xFFCCFBF1), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.Schedule, null, tint = Teal, modifier = Modifier.size(20.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Txt("Clinical History & Procedures", Type.rowName.copy(fontSize = 16.sp), T.ink, maxLines = 2)
                            Txt("Chronological timeline of all procedures", Type.caption, GreyInk, maxLines = 2)
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Surface(shape = RoundedCornerShape(12.dp), color = T.surface, border = BorderStroke(1.dp, T.line), modifier = Modifier.clickable(onClick = onSort)) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Sort, null, tint = GreyInk, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(6.dp))
                                Txt(if (state.newestFirst) "Newest first" else "Oldest first", Type.label.copy(fontSize = 12.sp), GreyInk)
                            }
                        }
                        Spacer(Modifier.weight(1f))
                        if (onAdd != null) {
                            Surface(shape = RoundedCornerShape(12.dp), color = Teal, modifier = Modifier.clickable(onClick = onAdd)) {
                                Row(Modifier.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Filled.Add, null, tint = Color.White, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Txt("Add New Procedure", Type.label.copy(fontSize = 13.sp), Color.White, maxLines = 1)
                                }
                            }
                        }
                    }
                    Rule()
                    val notes = if (state.newestFirst) state.notes else state.notes.asReversed()
                    if (notes.isEmpty()) {
                        Txt("No procedures recorded yet.", Type.body, T.inkFaint, Modifier.padding(20.dp))
                    }
                    notes.forEachIndexed { i, note -> TimelineRow(note, i == notes.lastIndex, state, onEdit, onDelete) }
                }
            }
        }
    }
}

@Composable
private fun TimelineRow(note: ClinicalNote, last: Boolean, state: RecordState, onEdit: ((ClinicalNote) -> Unit)?, onDelete: ((ClinicalNote) -> Unit)?) {
    var armed by remember(note.id) { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp).height(IntrinsicSize.Min)) {
        Column(Modifier.width(88.dp).padding(top = 12.dp), horizontalAlignment = Alignment.End) {
            Txt(longDate(note.date), Type.label.copy(fontSize = 13.sp), T.ink, maxLines = 2)
        }
        Spacer(Modifier.width(6.dp))
        Column(Modifier.width(14.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(14.dp))
            Box(Modifier.size(10.dp).clip(CircleShape).background(if (note.status == "Planned") Amber else Teal))
            if (!last) Box(Modifier.width(2.dp).fillMaxHeight().background(T.line))
        }
        Spacer(Modifier.width(8.dp))
        Surface(shape = RoundedCornerShape(14.dp), color = T.surface, border = BorderStroke(1.dp, T.line), shadowElevation = 1.dp, modifier = Modifier.weight(1f).padding(bottom = 12.dp)) {
            Column(Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Txt(note.procedure.ifBlank { "Treatment" }, Type.rowName.copy(fontSize = 15.sp), T.ink, Modifier.weight(1f), maxLines = 2)
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val planned = note.status == "Planned"
                    Chip(if (planned) "Planned" else note.status.ifBlank { "Completed" }, if (planned) AmberTint else GreenTint, if (planned) Amber else Green)
                    if (note.tooth.isNotBlank()) Chip("Tooth: ${note.tooth}", GreyTint, GreyInk)
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (note.doctor.isNotBlank()) Txt(if (note.doctor.startsWith("Dr")) note.doctor else "Dr. ${note.doctor}", Type.caption, GreyInk, maxLines = 1)
                    if (note.cost > 0) Chip("EGP ${fmt(note.cost)}", GreyTint, T.ink)
                }
                if (note.note.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Txt(note.note, Type.caption, T.inkMuted, maxLines = 4)
                }
                if (state.canRecord && (onEdit != null || onDelete != null)) {
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        onEdit?.let { IconSquare(Icons.Filled.Edit, PurpleTint, Purple) { it(note) } }
                        onDelete?.let {
                            if (state.canDeleteNote) IconSquare(Icons.Filled.Delete, if (armed) Red else RedTint, if (armed) Color.White else Red) {
                                if (armed) it(note) else armed = true
                            }
                        }
                        if (armed) Txt("Tap again to delete", Type.caption, Red, Modifier.align(Alignment.CenterVertically))
                    }
                }
            }
        }
    }
}

// ====================================================================== finance

/** The website's Finance tab: three tiles, the transaction history bar, then the table as cards. */
fun LazyListScope.finance(
    state: RecordState,
    onAddPayment: (() -> Unit)?,
    onEditRow: ((Money) -> Unit)?,
    onDeleteRow: ((Money) -> Unit)?,
) {
    val record = state.record ?: return
    val b = record.balance
    item {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MoneyTile("Total treatment", b.charged, T.ink, T.surface, Modifier.weight(1f))
            MoneyTile("Total paid", b.paid, Green, T.surface, Modifier.weight(1f))
            MoneyTile("Balance due", b.owed, Red, RedWash, Modifier.weight(1f), border = RedTint)
        }
    }
    item {
        WhiteCard {
            Column(Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.AccountBalanceWallet, null, tint = Blue, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(8.dp))
                    Txt("Transaction history", Type.chip.copy(fontSize = 11.sp), GreyInk, uppercase = true)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(shape = RoundedCornerShape(12.dp), color = GreenTint, modifier = Modifier.weight(1f)) {
                        Txt("Receipt on the website", Type.label.copy(fontSize = 12.sp), Color(0xFF15803D), Modifier.padding(vertical = 13.dp).fillMaxWidth(), maxLines = 1, align = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                    if (onAddPayment != null) {
                        Surface(shape = RoundedCornerShape(12.dp), color = GreenSoft, modifier = Modifier.weight(1f).clickable(onClick = onAddPayment)) {
                            Row(Modifier.padding(vertical = 13.dp).fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Add, null, tint = Color.White, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(4.dp))
                                Txt("Add payment", Type.label.copy(fontSize = 12.sp), Color.White, uppercase = true, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }

    // Charges newest first, each with the payments recorded against it nested underneath, and
    // payments on account on their own — the shape the desk's table has.
    val rows = record.ledger.filterNot { it.isExpense }
    val charges = rows.filter { it.isCharge }.sortedByDescending { it.date }
    val onAccount = rows.filter { it.isPayment && (it.procedureId.isBlank() || charges.none { c -> c.id == it.procedureId }) }.sortedByDescending { it.date }
    val settled = charges.map { c -> c to rows.filter { it.isPayment && it.procedureId == c.id }.sortedBy { it.date } }

    if (rows.isEmpty()) {
        item { Txt("Nothing on the ledger yet.", Type.body, T.inkFaint, Modifier.padding(20.dp)) }
        return
    }

    item {
        WhiteCard {
            Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
                    Txt("Date", Type.chip.copy(fontSize = 10.sp), GreyInk, Modifier.width(74.dp), uppercase = true)
                    Txt("Description", Type.chip.copy(fontSize = 10.sp), GreyInk, Modifier.weight(1f), uppercase = true)
                    Txt("Cost / Paid", Type.chip.copy(fontSize = 10.sp), GreyInk, uppercase = true)
                }
                Rule()
                (onAccount.map { it to emptyList<Money>() } + settled)
                    .sortedByDescending { it.first.date }
                    .forEachIndexed { i, (row, payments) ->
                        if (i > 0) Rule()
                        LedgerCard(row, payments, state, onEditRow, onDeleteRow)
                    }
            }
        }
    }
}

@Composable
private fun LedgerCard(row: Money, payments: List<Money>, state: RecordState, onEdit: ((Money) -> Unit)?, onDelete: ((Money) -> Unit)?) {
    var open by remember(row.id) { mutableStateOf(payments.isNotEmpty()) }
    val paid = payments.sumOf { it.amount }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().then(if (payments.isNotEmpty()) Modifier.clickable { open = !open } else Modifier).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.width(74.dp)) {
                Txt(row.date, Type.caption.copy(fontSize = 11.sp), T.ink, maxLines = 2)
                if (payments.isNotEmpty()) Txt(if (open) "▾ ${payments.size}" else "▸ ${payments.size}", Type.caption, GreyInk)
            }
            Column(Modifier.weight(1f).padding(end = 8.dp)) {
                Txt(row.description.ifBlank { if (row.isCharge) "Treatment" else "Payment" }, Type.rowName, T.ink, maxLines = 3)
                Spacer(Modifier.height(4.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (row.isCharge) {
                        Chip(row.doctor.ifBlank { "System" }, if (row.doctor.isBlank()) GreyTint else PurpleTint, if (row.doctor.isBlank()) GreyInk else Purple)
                        Chip("Procedure", BlueTint, Blue)
                    } else {
                        Chip("Collected by: ${row.by.ifBlank { "—" }}", GreenTint, Green)
                        Chip("Payment", GreenTint, Green)
                    }
                }
                if (row.isCharge && row.amount > 0) {
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().height(5.dp).clip(T.pill).background(GreyTint)) {
                        Box(Modifier.fillMaxWidth((paid / row.amount).coerceIn(0.0, 1.0).toFloat()).height(5.dp).background(GreenSoft))
                    }
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                if (row.isCharge) {
                    Txt(fmt(row.amount), Type.label.copy(fontSize = 14.sp), T.ink)
                    Txt(if (paid > 0) fmt(paid) else "–", Type.label.copy(fontSize = 13.sp), Green)
                } else {
                    Txt("–", Type.label.copy(fontSize = 13.sp), T.inkFaint)
                    Txt(fmt(row.amount), Type.label.copy(fontSize = 14.sp), Green)
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    onEdit?.let { IconSquare(Icons.Filled.Edit, GreyTint, GreyInk, 28) { it(row) } }
                    if (state.canDeleteLedger) onDelete?.let { IconSquare(Icons.Filled.Delete, RedTint, Red, 28) { it(row) } }
                }
            }
        }
        if (open) payments.forEach { p ->
            Row(Modifier.fillMaxWidth().background(GreyTint.copy(alpha = .5f)).padding(start = 28.dp, end = 14.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
                Txt(p.date, Type.caption.copy(fontSize = 11.sp), GreyInk, Modifier.width(60.dp), maxLines = 2)
                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                    Txt(p.description.ifBlank { "Payment" }, Type.body, T.ink, maxLines = 2)
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("Collected by: ${p.by.ifBlank { "—" }}", GreenTint, Green)
                        Chip("Payment", GreenTint, Green)
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    Txt(fmt(p.amount), Type.label.copy(fontSize = 13.sp), Green)
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        onEdit?.let { IconSquare(Icons.Filled.Edit, GreyTint, GreyInk, 26) { it(p) } }
                        if (state.canDeleteLedger) onDelete?.let { IconSquare(Icons.Filled.Delete, RedTint, Red, 26) { it(p) } }
                    }
                }
            }
        }
    }
}

// ====================================================================== treatment plans

fun LazyListScope.plans(state: RecordState, onNew: (() -> Unit)?, onStatus: ((TreatmentPlans.Plan, String) -> Unit)?) {
    item {
        WhiteCard {
            Column(Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Txt("Treatment plans", Type.rowName.copy(fontSize = 16.sp), T.ink)
                        Txt("What has been proposed, and what the patient said", Type.caption, GreyInk, maxLines = 2)
                    }
                    if (onNew != null) {
                        Surface(shape = RoundedCornerShape(12.dp), color = Teal, modifier = Modifier.clickable(onClick = onNew)) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Add, null, tint = Color.White, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(4.dp))
                                Txt("New plan", Type.label.copy(fontSize = 12.sp), Color.White)
                            }
                        }
                    }
                }
            }
        }
    }
    if (state.plans.isEmpty()) {
        item { Txt("No plans on this file. The AI tab can propose one.", Type.body, T.inkFaint, Modifier.padding(20.dp), maxLines = 2) }
        return
    }
    state.plans.forEach { plan ->
        item(key = "plan-${plan.id}") {
            WhiteCard {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Txt(plan.title.ifBlank { "Plan" }, Type.rowName.copy(fontSize = 15.sp), T.ink, maxLines = 2)
                            Txt(
                                listOfNotNull(
                                    "${plan.visits.size} visit${if (plan.visits.size == 1) "" else "s"}",
                                    plan.doctorName.takeIf { it.isNotBlank() },
                                    if (plan.source == "ai") "AI proposed" else null,
                                ).joinToString(" · "), Type.caption, GreyInk, maxLines = 2,
                            )
                        }
                        Txt("${fmt(plan.total)} ${plan.currency}", Type.label.copy(fontSize = 14.sp), T.ink)
                    }
                    if (plan.description.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Txt(plan.description, Type.caption, T.inkMuted, maxLines = 4)
                    }
                    Spacer(Modifier.height(8.dp))
                    val (tint, ink) = when (plan.status) {
                        "accepted" -> GreenTint to Green
                        "declined" -> RedTint to Red
                        "presented" -> BlueTint to Blue
                        else -> AmberTint to Amber
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Chip(TreatmentPlans.statusLabel(plan.status, false), tint, ink)
                        Spacer(Modifier.weight(1f))
                        if (onStatus != null) {
                            when (plan.status) {
                                "draft" -> SettingsPill("Presented") { onStatus(plan, "presented") }
                                "presented" -> { SettingsPill("Accepted", solid = true) { onStatus(plan, "accepted") }; SettingsPill("Declined") { onStatus(plan, "declined") } }
                                else -> SettingsPill("Back to draft") { onStatus(plan, "draft") }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ====================================================================== the New Procedure sheet

/** Everything the New Procedure sheet collected. */
data class ProcedureDraft(
    val procedure: String,
    /** Extra procedures, one per line, priced with the first. */
    val extra: List<String>,
    val teeth: List<String>,
    val note: String,
    val unitCost: Double?,
    val doctor: Doctor?,
    val service: Service?,
    /** Planned, Ongoing or Completed. */
    val status: String,
    val date: String,
    /** per_tooth, flat or per_arch — the billing rule, when the dentist overrides the list's. */
    val pricingMode: String,
)

/**
 * The website's "New Procedure" modal.
 *
 * Teeth first, on the chart, with the two arch buttons; then date and status side by side, the
 * dentist, the procedure search, the additional lines, the cost with the charging line and the
 * billing rule, the note, and the big blue Log Procedure.
 */
@Composable
fun NewProcedureSheet(
    patientName: String,
    services: List<Service>,
    doctors: List<Doctor>,
    charted: Map<Int, com.alphadental.clinic.next.data.Tooth> = emptyMap(),
    busy: Boolean,
    error: String?,
    onRecord: (ProcedureDraft) -> Unit,
    onDismiss: () -> Unit,
) {
    val form = "$DRAFT_TREATMENT:$patientName"
    var procedure by draft(form, "procedure")
    var extra by draft(form, "extra")
    var price by draft(form, "price")
    var note by draft(form, "note")
    var toothText by draft(form, "teeth")
    var doctorId by draft(form, "doctor", doctors.firstOrNull()?.id.orEmpty())
    var status by draft(form, "status", "Completed")
    var date by draft(form, "date", com.alphadental.clinic.next.data.ClinicSource.dateKey())
    var billing by draft(form, "billing", "")
    var picking by remember { mutableStateOf(false) }
    var statusOpen by remember { mutableStateOf(false) }
    var doctorOpen by remember { mutableStateOf(false) }
    var billingOpen by remember { mutableStateOf(false) }
    var dateOpen by remember { mutableStateOf(false) }

    val teeth = remember(toothText) { toothText.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet() }
    val setTeeth = { next: Set<Int> -> toothText = next.sorted().joinToString(",") }
    val service = remember(procedure, services) { services.firstOrNull { it.name.equals(procedure.trim(), ignoreCase = true) } }
    val doctor = remember(doctorId, doctors) { doctors.firstOrNull { it.id == doctorId } }
    val mode = billing.ifBlank { service?.pricingMode.orEmpty().ifBlank { "per_tooth" } }
    val unit = price.toDoubleOrNull() ?: 0.0
    val units = when (mode) {
        "flat" -> 1
        "per_arch" -> listOf(teeth.any { it in UPPER_RIGHT || it in UPPER_LEFT }, teeth.any { it in LOWER_RIGHT || it in LOWER_LEFT }).count { it }.coerceAtLeast(1)
        else -> teeth.size.coerceAtLeast(1)
    }
    val total = unit * units

    Sheet(
        title = "New Procedure",
        caption = patientName,
        busy = busy,
        error = error,
        action = "Log Procedure",
        ready = procedure.isNotBlank() && doctor != null,
        onAction = {
            onRecord(ProcedureDraft(
                procedure = procedure.trim(),
                extra = extra.lines().map { it.trim() }.filter { it.isNotBlank() },
                teeth = teeth.map(Int::toString), note = note, unitCost = unit.takeIf { it > 0 },
                doctor = doctor, service = service, status = status, date = date, pricingMode = billing,
            ))
        },
        onDismiss = onDismiss,
    ) {
        // ---- teeth
        Column(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
            Surface(shape = RoundedCornerShape(16.dp), color = GreyTint, border = BorderStroke(1.dp, T.line), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp)) {
                    Txt("Select teeth from chart", Type.caption.copy(fontSize = 12.sp), GreyInk)
                    Spacer(Modifier.height(6.dp))
                    Surface(shape = RoundedCornerShape(12.dp), color = T.surface, border = BorderStroke(1.dp, T.line), modifier = Modifier.fillMaxWidth()) {
                        Column {
                            ToothPickerChart(chosen = teeth, teeth = charted) { n -> setTeeth(if (n in teeth) teeth - n else teeth + n) }
                            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                                ArchButton("Select Upper Arch") { setTeeth(if ((UPPER_RIGHT + UPPER_LEFT).all { it in teeth }) teeth - (UPPER_RIGHT + UPPER_LEFT).toSet() else teeth + UPPER_RIGHT + UPPER_LEFT) }
                                ArchButton("Select Lower Arch") { setTeeth(if ((LOWER_RIGHT + LOWER_LEFT).all { it in teeth }) teeth - (LOWER_RIGHT + LOWER_LEFT).toSet() else teeth + LOWER_RIGHT + LOWER_LEFT) }
                            }
                        }
                    }
                }
            }
        }

        // ---- date + status
        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Field("Date", prettyKey(date), Modifier.weight(1f)) { dateOpen = true }
            Field("Status", status, Modifier.weight(1f)) { statusOpen = !statusOpen }
        }
        if (dateOpen) DatePickerSheet(date, onPick = { date = it; dateOpen = false }, onDismiss = { dateOpen = false })
        if (statusOpen) SheetChoices("") { listOf("Planned", "Ongoing", "Completed").forEach { s -> SheetChoice(s, status == s) { status = s; statusOpen = false } } }

        // ---- doctor
        Column(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) { Field("Select Doctor", doctor?.name ?: "Choose", Modifier.fillMaxWidth()) { doctorOpen = !doctorOpen } }
        if (doctorOpen) SheetChoices("") { doctors.forEach { d -> SheetChoice(d.name, doctor?.id == d.id) { doctorId = d.id; doctorOpen = false } } }
        if (doctor == null) Txt("The charge is worked out against the dentist's rate, so one is needed.", Type.caption, T.warn, Modifier.padding(horizontal = T.gutter), maxLines = 2)

        // ---- procedure
        SheetField(
            label = "Procedure Name", value = procedure,
            onChange = { procedure = it; picking = true },
            hint = "Search procedures…",
            onFocus = { if (it) picking = true },
        )
        if (picking && services.isNotEmpty()) {
            val needle = procedure.trim().lowercase()
            val matches = when {
                needle.isEmpty() -> services
                services.any { it.name.equals(needle, ignoreCase = true) } -> emptyList()
                else -> services.filter { it.name.lowercase().contains(needle) }
            }
            /*
             * Grouped under the website's category headings, in the website's order, each
             * service with the icon the price list gave it. A service saved before categories
             * existed is filed by the same keyword guess the website makes, so the two lists
             * agree on where "Scaling & Polishing" lives.
             */
            val grouped = matches.groupBy { sv ->
                com.alphadental.clinic.ui.DentalIcons.categoryOf(
                    sv.category.ifBlank { com.alphadental.clinic.ui.DentalIcons.suggestCategory(sv.name) },
                )
            }
            com.alphadental.clinic.ui.DentalIcons.CATEGORIES.forEach { cat ->
                val inCat = grouped[cat] ?: return@forEach
                Rule()
                Row(Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 10.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(com.alphadental.clinic.ui.DentalIcons.get(cat.icon), null, tint = T.inkFaint, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(6.dp))
                    Txt(cat.en, Type.chip.copy(fontSize = 10.sp), T.inkFaint, uppercase = true)
                }
                inCat.forEach { sv ->
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            procedure = sv.name
                            if (sv.price > 0) price = fmt(sv.price).replace(",", "")
                            picking = false
                        }.padding(horizontal = T.gutter, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            com.alphadental.clinic.ui.DentalIcons.get(com.alphadental.clinic.ui.DentalIcons.idForService(sv.icon, sv.name, sv.category)),
                            null, tint = Blue, modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Txt(sv.name, Type.body.copy(fontSize = 15.sp), T.ink, Modifier.weight(1f), maxLines = 2)
                        Chip(if (sv.price > 0) "${fmt(sv.price)} EGP" else "No price", GreyTint, T.ink)
                    }
                }
            }
            if (matches.isNotEmpty()) Rule()
        }
        SheetField("Additional procedures (one per line)", extra, { extra = it }, hint = "", lines = 2)

        // ---- cost
        SheetField("Cost (EGP)", price, { price = it.filter { c -> c.isDigit() || c == '.' } }, numeric = true, hint = "0")
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter).background(GreyTint, RoundedCornerShape(12.dp)).border(1.dp, T.line, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt("Charging ${fmt(unit)} × $units ${if (mode == "per_arch") "arch" else "tooth"}${if (units == 1) "" else if (mode == "per_arch") "es" else "s"} = ${fmt(total)} EGP", Type.label.copy(fontSize = 12.sp), T.ink, Modifier.weight(1f), maxLines = 2)
            Txt("Billing", Type.caption, GreyInk)
            Spacer(Modifier.width(6.dp))
            Surface(shape = T.pill, color = T.surface, border = BorderStroke(1.dp, T.line), modifier = Modifier.clickable { billingOpen = !billingOpen }) {
                Txt(when (mode) { "flat" -> "Flat"; "per_arch" -> "Per arch"; else -> "Per tooth" }, Type.label.copy(fontSize = 12.sp), T.ink, Modifier.padding(horizontal = 10.dp, vertical = 7.dp))
            }
        }
        if (billingOpen) SheetChoices("") {
            listOf("per_tooth" to "Per tooth", "flat" to "Flat", "per_arch" to "Per arch").forEach { (id, label) ->
                SheetChoice(label, mode == id) { billing = id; billingOpen = false }
            }
        }

        SheetField("Note", note, { note = it }, hint = "", lines = 2)
        Spacer(Modifier.height(6.dp))
    }
}

@Composable
private fun ArchButton(label: String, onClick: () -> Unit) {
    Surface(shape = T.pill, color = BlueTint, modifier = Modifier.clickable(onClick = onClick)) {
        Txt(label, Type.label.copy(fontSize = 11.sp), Blue, Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
    }
}

@Composable
private fun Field(label: String, value: String, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier) {
        Txt(label, Type.caption.copy(fontSize = 12.sp), GreyInk)
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth().background(GreyTint, RoundedCornerShape(12.dp)).border(1.dp, T.line, RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Txt(value, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
            Txt("⌄", Type.body, GreyInk)
        }
    }
}

/** The website's date box opens a calendar. So does this one. */
@androidx.compose.runtime.Composable
@kotlin.OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
private fun DatePickerSheet(current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
    val initial = runCatching { fmt.parse(current)!!.time }.getOrNull()
    val state = androidx.compose.material3.rememberDatePickerState(initialSelectedDateMillis = initial)
    androidx.compose.material3.DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = {
                // The picker answers in UTC midnight; formatting it in UTC keeps the same day.
                state.selectedDateMillis?.let { onPick(fmt.format(java.util.Date(it))) } ?: onDismiss()
            }) { Txt("Use this date", Type.label, T.ink) }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Txt("Cancel", Type.label, T.inkMuted) } },
    ) { androidx.compose.material3.DatePicker(state = state) }
}

// ====================================================================== the chart's history

private fun ClinicalNote.onTooth(n: Int): Boolean =
    teeth.any { it.trim() == n.toString() } || tooth.split(Regex("[,\\s]+")).any { it.trim() == n.toString() }

/**
 * Everything ever recorded on a tooth — or on every tooth, when none is picked.
 *
 * Two kinds of record, both here because a dentist reading a tooth wants both at once: what has
 * been diagnosed on it (the chart's own statuses and note) and what has been done to it (every
 * procedure whose teeth include it, with the date, the dentist and the price). Split across two
 * tabs they were two taps apart and read as two different patients.
 */
fun LazyListScope.toothHistory(state: RecordState, record: Record) {
    val picked = state.tooth
    val numbers: List<Int> = if (picked != null) listOf(picked) else
        (record.teeth.keys + state.notes.flatMap { n -> n.teeth.mapNotNull { it.trim().toIntOrNull() } }).distinct().sorted()

    item {
        Txt(
            if (picked != null) "Tooth $picked history" else "All teeth history",
            Type.chip.copy(fontSize = 10.sp), GreyInk, Modifier.padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp), uppercase = true,
        )
    }
    if (numbers.isEmpty()) {
        item { Txt("Nothing has been recorded on any tooth yet.", Type.body, T.inkFaint, Modifier.padding(20.dp), maxLines = 2) }
        return
    }
    numbers.forEach { n ->
        val tooth = record.teeth[n]
        val done = state.notes.filter { it.onTooth(n) }.sortedByDescending { it.date }
        if (picked == null && tooth?.hasAnything != true && done.isEmpty()) return@forEach
        item(key = "th-$n") {
            WhiteCard {
                Column(Modifier.padding(14.dp)) {
                    if (picked == null) {
                        Txt("Tooth $n", Type.rowName.copy(fontSize = 15.sp), T.ink)
                        Spacer(Modifier.height(6.dp))
                    }
                    if (tooth != null && tooth.statuses.isNotEmpty()) {
                        Txt("Diagnosis", Type.chip.copy(fontSize = 9.sp), GreyInk, uppercase = true)
                        tooth.statuses.forEach { id ->
                            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(9.dp).clip(RoundedCornerShape(3.dp)).background(com.alphadental.clinic.next.data.colourOf(id)))
                                Spacer(Modifier.width(8.dp))
                                Txt(com.alphadental.clinic.next.data.labelOf(id), Type.body, T.ink, Modifier.weight(1f), maxLines = 2)
                                Txt(com.alphadental.clinic.next.data.categoryNameOf(id), Type.caption, GreyInk, maxLines = 1)
                            }
                        }
                    }
                    if (tooth != null && tooth.notes.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Txt(tooth.notes, Type.caption, T.inkMuted, maxLines = 8)
                    }
                    if (done.isNotEmpty()) {
                        if (tooth?.hasAnything == true) { Spacer(Modifier.height(8.dp)); Rule(); Spacer(Modifier.height(8.dp)) }
                        Txt("Procedures", Type.chip.copy(fontSize = 9.sp), GreyInk, uppercase = true)
                        done.forEach { note ->
                            Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.Top) {
                                Txt(longDate(note.date), Type.caption.copy(fontSize = 11.sp), GreyInk, Modifier.width(78.dp), maxLines = 2)
                                Column(Modifier.weight(1f)) {
                                    Txt(note.procedure.ifBlank { "Treatment" }, Type.body, T.ink, maxLines = 2)
                                    Txt(
                                        listOfNotNull(
                                            note.status.ifBlank { null },
                                            note.doctor.takeIf { it.isNotBlank() },
                                        ).joinToString(" · "), Type.caption, GreyInk, maxLines = 1,
                                    )
                                }
                                if (note.cost > 0) Chip("EGP ${fmt(note.cost)}", GreyTint, T.ink)
                            }
                        }
                    }
                    if ((tooth == null || !tooth.hasAnything) && done.isEmpty()) {
                        Txt("Nothing recorded on this tooth yet.", Type.body, T.inkFaint, maxLines = 2)
                    }
                }
            }
        }
    }
}

// ====================================================================== shared bits

@Composable
fun WhiteCard(content: @Composable () -> Unit) {
    Surface(
        shape = RoundedCornerShape(18.dp), color = T.surface, border = BorderStroke(1.dp, T.line), shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
    ) { content() }
}

@Composable
private fun Chip(label: String, fill: Color, ink: Color) {
    Surface(shape = RoundedCornerShape(8.dp), color = fill) {
        Txt(label, Type.chip.copy(fontSize = 10.sp), ink, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), maxLines = 1)
    }
}

@Composable
private fun IconSquare(icon: ImageVector, fill: Color, ink: Color, size: Int = 36, onClick: () -> Unit) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(10.dp)).background(fill).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = ink, modifier = Modifier.size((size * 0.45f).dp))
    }
}

@Composable
private fun MoneyTile(label: String, value: Double, ink: Color, fill: Color, modifier: Modifier, border: Color = T.line) {
    Surface(shape = RoundedCornerShape(16.dp), color = fill, border = BorderStroke(1.dp, border), modifier = modifier) {
        Column(Modifier.padding(vertical = 16.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Txt(label, Type.chip.copy(fontSize = 9.sp), if (fill == RedWash) Red else GreyInk, uppercase = true, maxLines = 1)
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Txt(fmt(value), Type.label.copy(fontSize = 19.sp), ink, maxLines = 1)
                Txt(" EGP", Type.chip.copy(fontSize = 9.sp), if (fill == RedWash) Red else GreyInk)
            }
        }
    }
}

private fun fmt(v: Double): String = java.text.NumberFormat.getIntegerInstance(java.util.Locale.US).format(v.toLong())

private fun longDate(key: String): String = runCatching {
    java.text.SimpleDateFormat("MMM d, yyyy", java.util.Locale.US).format(java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(key)!!)
}.getOrDefault(key)

private fun prettyKey(key: String): String = runCatching {
    java.text.SimpleDateFormat("dd/MM/yyyy", java.util.Locale.US).format(java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(key)!!)
}.getOrDefault(key)

private fun shiftKey(key: String, by: Int): String {
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
    val cal = java.util.Calendar.getInstance()
    runCatching { cal.time = fmt.parse(key)!! }
    cal.add(java.util.Calendar.DAY_OF_YEAR, by)
    return fmt.format(cal.time)
}
