package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.UnpaidProcedure
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.design.Avatar
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** What the appointment editor can do. */
data class AppointmentActions(
    val setDoctor: (Doctor?) -> Unit,
    val setStatus: (Stage) -> Unit,
    val shiftDay: (Int) -> Unit,
    val setTime: (String) -> Unit,
    val setMinutes: (Int) -> Unit,
    val setReason: (String) -> Unit,
    val setNotes: (String) -> Unit,
    val save: () -> Unit,
    val addProcedure: () -> Unit,
    val pay: () -> Unit,
    val delete: (Boolean) -> Unit,
    val openFile: () -> Unit,
    val close: () -> Unit,
)

// The website's palette for this one sheet, so the two look like the same thing.
private val Green = Color(0xFF16A34A)
private val GreenTint = Color(0xFFECFDF5)
private val Red = Color(0xFFE11D48)
private val RedTint = Color(0xFFFFF1F2)
private val Slate = Color(0xFF0F172A)

/**
 * The website's "Appointment Details" panel, on the phone.
 *
 * Same order, same colours, same words, on purpose: a receptionist who learned the desk should
 * not have to learn the phone. Doctor and status side by side, then date, time and duration,
 * reason, the green Add Procedure, notes, the black Quick Pay beside the red Delete, and the
 * patient's ledger underneath with its own Pay.
 *
 * Save sits in the top bar like every other sheet. The website saves each field as it changes;
 * here the fields are collected and written once, because a phone on a poor signal writing six
 * times is six chances to be half-done.
 */
@Composable
fun AppointmentSheet(state: VisitSheetState, a: AppointmentActions) {
    val visit = state.visit ?: return
    var doctorOpen by remember(visit.id) { mutableStateOf(false) }
    var statusOpen by remember(visit.id) { mutableStateOf(false) }
    var timeOpen by remember(visit.id) { mutableStateOf(false) }
    var minutesOpen by remember(visit.id) { mutableStateOf(false) }
    var reasonOpen by remember(visit.id) { mutableStateOf(false) }
    var armed by remember(visit.id) { mutableStateOf(false) }

    Sheet(
        title = "Appointment Details",
        caption = "",
        busy = state.saving || state.deleting,
        error = state.error,
        action = if (state.canEdit) "Save" else "Close",
        ready = !state.canEdit || state.dirty,
        onAction = { if (state.canEdit) a.save() else a.close() },
        onDismiss = a.close,
    ) {
        // ---- the patient
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(visit.patientName, size = 52)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Txt(visit.patientName.ifBlank { "Patient" }, Type.heading, T.ink, maxLines = 1)
                Spacer(Modifier.height(2.dp))
                Txt("${state.time.ifBlank { visit.time }} · ${state.date}", Type.caption, T.inkMuted)
            }
            Txt(
                "Open file", Type.label.copy(fontSize = 12.sp), T.accentInk,
                Modifier.clip16().clickable(onClick = a.openFile).padding(horizontal = 10.dp, vertical = 8.dp),
            )
        }

        Txt("Edit details", Type.eyebrow, T.inkFaint, Modifier.padding(horizontal = T.gutter), uppercase = true)
        Spacer(Modifier.height(6.dp))

        // ---- doctor + status, side by side as the desk has them
        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Dropdown(
                "Doctor",
                state.doctors.firstOrNull { it.id == state.doctorId }?.name ?: visit.doctor.ifBlank { "Choose" },
                Modifier.weight(1f), enabled = state.canEdit,
            ) { doctorOpen = !doctorOpen; statusOpen = false }
            Dropdown(
                "Status",
                stageLabel(state.status ?: visit.status),
                Modifier.weight(1f), enabled = state.canEdit,
            ) { statusOpen = !statusOpen; doctorOpen = false }
        }
        if (doctorOpen) {
            Choices(state.doctors.map { it.id to it.name }, state.doctorId) { id ->
                a.setDoctor(state.doctors.firstOrNull { it.id == id }); doctorOpen = false
            }
        }
        if (statusOpen) {
            val stages = listOf(
                Stage.Unconfirmed, Stage.Confirmed, Stage.CheckedIn, Stage.InChair,
                Stage.CheckingOut, Stage.Completed, Stage.Delayed, Stage.NoShow, Stage.Cancelled,
            )
            Choices(stages.map { it.name to stageLabel(it) }, (state.status ?: visit.status).name) { name ->
                a.setStatus(Stage.valueOf(name)); statusOpen = false
            }
        }

        // ---- date
        Spacer(Modifier.height(10.dp))
        Column(Modifier.padding(horizontal = T.gutter)) {
            Txt("Date", Type.eyebrow, T.inkFaint, uppercase = true)
            Spacer(Modifier.height(6.dp))
            Row(
                Modifier.fillMaxWidth().fieldFrame().padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SheetChoice("◀", false) { if (state.canEdit) a.shiftDay(-1) }
                Txt(prettyDate(state.date), Type.rowName, T.ink, Modifier.weight(1f).padding(horizontal = 10.dp), maxLines = 1)
                SheetChoice("▶", false) { if (state.canEdit) a.shiftDay(1) }
            }
        }

        // ---- time + duration
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Dropdown("Time", state.time.ifBlank { "—" }, Modifier.weight(1f), enabled = state.canEdit) { timeOpen = !timeOpen; minutesOpen = false }
            Dropdown("Duration", spellMinutes(state.minutes), Modifier.weight(1f), enabled = state.canEdit) { minutesOpen = !minutesOpen; timeOpen = false }
        }
        if (timeOpen) {
            if (state.slots.isEmpty()) {
                SheetField("Time", state.time, a.setTime, hint = "14:30")
            } else {
                SheetChoices("Pick a time") {
                    state.slots.forEach { slot -> SheetChoice(slot, state.time == slot) { a.setTime(slot); timeOpen = false } }
                }
            }
        }
        if (minutesOpen) {
            SheetChoices("How long") {
                listOf(15, 30, 45, 60, 90, 120).forEach { m -> SheetChoice(spellMinutes(m), state.minutes == m) { a.setMinutes(m); minutesOpen = false } }
            }
        }

        // ---- reason
        Spacer(Modifier.height(10.dp))
        Column(Modifier.padding(horizontal = T.gutter)) {
            Dropdown("Reason for visit", state.reason.ifBlank { "—" }, Modifier.fillMaxWidth(), enabled = state.canEdit) { reasonOpen = !reasonOpen }
        }
        if (reasonOpen) {
            if (state.reasons.isNotEmpty()) {
                Choices(state.reasons.map { it to it }, state.reason) { a.setReason(it); reasonOpen = false }
            }
            SheetField("Or type one", state.reason, a.setReason, hint = "Pain")
        }

        // ---- add procedure
        Spacer(Modifier.height(14.dp))
        if (state.canRecordTreatment) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = GreenTint,
                border = BorderStroke(1.dp, Green.copy(alpha = .35f)),
                modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter).clickable(onClick = a.addProcedure),
            ) {
                Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Add, null, tint = Green, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Txt("Add Procedure", Type.label.copy(fontSize = 15.sp), Green)
                }
            }
        }

        // ---- notes
        SheetField("Notes", state.notes, a.setNotes, hint = "", lines = 3, enabled = state.canEdit)

        // ---- quick pay + delete
        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (state.canTakePayment) {
                BigButton("Quick Pay", Icons.Filled.AccountBalanceWallet, fill = Slate, ink = Color.White, Modifier.weight(1f), onClick = a.pay)
            }
            if (state.canDelete) {
                BigButton(
                    if (armed) "Sure? Delete" else "Delete", Icons.Filled.Delete,
                    fill = if (armed) Red else T.surface, ink = if (armed) Color.White else Red,
                    Modifier.weight(1f), border = Red.copy(alpha = .5f),
                ) { if (armed) a.delete(true) else armed = true }
            }
        }
        if (armed) {
            Txt(
                "Deleting the visit keeps its treatments on the patient's file. If money has been " +
                    "paid against them they stay regardless.",
                Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 4.dp), maxLines = 3,
            )
        }

        // ---- the ledger
        Rule()
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt("Patient ledger", Type.eyebrow, T.inkFaint, Modifier.weight(1f), uppercase = true)
            if (state.canTakePayment) {
                Surface(shape = T.pill, color = Slate, modifier = Modifier.clickable(onClick = a.pay)) {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.AccountBalanceWallet, null, tint = Color.White, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(6.dp))
                        Txt("Pay", Type.label.copy(fontSize = 13.sp), Color.White)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile("Total cost", state.charged, T.ink, Modifier.weight(1f))
            Tile("Paid", state.paid, Green, Modifier.weight(1f))
            Tile("Remaining", state.owed, Color.White, Modifier.weight(1f), dark = true)
        }
        Spacer(Modifier.height(8.dp))
        state.lines.take(6).forEach { m ->
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Txt(m.description.ifBlank { if (m.isCharge) "Treatment" else "Payment" }, Type.body, T.ink, maxLines = 2)
                    Txt(m.date, Type.caption, T.inkMuted)
                }
                Txt(
                    (if (m.isCharge) "" else "+") + m.amount.toLong().toString() + " EGP",
                    Type.label.copy(fontSize = 13.sp), if (m.isCharge) T.ink else Green,
                )
            }
        }
        if (state.lines.isEmpty() && !state.loading) {
            Txt("Nothing on the ledger yet.", Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp))
        }
        Spacer(Modifier.height(10.dp))
    }
}

/**
 * The website's "Receive Payment" modal.
 *
 * The dark strip with what is owed, paid and remaining; then two ways to pay — on account, or
 * against one of the bills still open — and the amount once one is chosen. The same shape the desk
 * uses, so nobody learns it twice.
 */
@Composable
fun ReceivePaymentSheet(
    patientName: String,
    charged: Double,
    paid: Double,
    unpaid: List<UnpaidProcedure>,
    busy: Boolean,
    error: String?,
    onTake: (UnpaidProcedure?, Double) -> Unit,
    onDismiss: () -> Unit,
) {
    /** Null = nothing chosen yet; "" = on account; otherwise the bill's id. */
    var chosen by remember { mutableStateOf<String?>(null) }
    var amount by remember { mutableStateOf("") }
    val against = unpaid.firstOrNull { it.id == chosen }
    val value = amount.toDoubleOrNull() ?: 0.0
    val remaining = (charged - paid).coerceAtLeast(0.0)

    Sheet(
        title = "Receive Payment",
        caption = "Alpha clinic billing",
        busy = busy,
        error = error,
        action = "Confirm Payment",
        ready = chosen != null && value > 0,
        onAction = { onTake(against, value) },
        onDismiss = onDismiss,
    ) {
        // ---- the strip
        Surface(
            shape = RoundedCornerShape(18.dp), color = Slate,
            modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
        ) {
            Column {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(patientName, size = 36)
                    Spacer(Modifier.width(12.dp))
                    Txt(patientName, Type.rowName.copy(fontSize = 16.sp), Color.White, maxLines = 1)
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = .1f)))
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp)) {
                    StripFact("Total owed", charged, Color.White, Modifier.weight(1f))
                    StripFact("Total paid", paid, Color(0xFF34D399), Modifier.weight(1f))
                    StripFact("Remaining", remaining, Color(0xFFFBBF24), Modifier.weight(1f))
                }
            }
        }

        Txt("Payment type", Type.eyebrow, T.inkFaint, Modifier.padding(horizontal = T.gutter), uppercase = true)
        Spacer(Modifier.height(8.dp))

        PayOption(
            "General Payment", "Add advance credit", Icons.Filled.Savings,
            selected = chosen == "",
        ) { chosen = ""; amount = "" }

        if (unpaid.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).height(1.dp).background(T.line))
                Txt("  or pay bill  ", Type.chip.copy(fontSize = 9.sp), T.inkFaint, uppercase = true)
                Box(Modifier.weight(1f).height(1.dp).background(T.line))
            }
            unpaid.forEach { bill ->
                BillOption(bill, selected = chosen == bill.id) {
                    chosen = bill.id
                    amount = bill.remaining.toLong().toString()
                }
            }
        }

        Spacer(Modifier.height(6.dp))
        if (chosen == null) {
            Box(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter)
                    .border(1.dp, T.line, RoundedCornerShape(16.dp)).padding(vertical = 28.dp),
                contentAlignment = Alignment.Center,
            ) {
                Txt("Select a payment type from the list.", Type.body, T.inkFaint)
            }
        } else {
            SheetField("Amount", amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, numeric = true, hint = "0")
            Txt(
                if (against != null) "${against.remaining.toLong()} still owed on this. More than that is refused."
                else "Recorded on the account as advance credit — not against any one treatment.",
                Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 6.dp), maxLines = 3,
            )
        }
    }
}

// ---------------------------------------------------------------------------------------- pieces

@Composable
private fun Dropdown(label: String, value: String, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) {
    Column(modifier) {
        Txt(label, Type.eyebrow, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(6.dp))
        Row(
            Modifier.fillMaxWidth().fieldFrame().clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt(value, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 1)
            Icon(Icons.Filled.ExpandMore, null, tint = if (enabled) T.inkMuted else T.inkFaint, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun Choices(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    SheetChoices("") {
        options.forEach { (id, label) -> SheetChoice(label, id == selected) { onPick(id) } }
    }
}

@Composable
private fun BigButton(
    label: String, icon: ImageVector, fill: Color, ink: Color, modifier: Modifier,
    border: Color? = null, onClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(14.dp), color = fill,
        border = border?.let { BorderStroke(1.dp, it) },
        modifier = modifier.clickable(onClick = onClick),
    ) {
        Row(Modifier.fillMaxWidth().padding(vertical = 15.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = ink, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
            Txt(label, Type.label.copy(fontSize = 14.sp), ink)
        }
    }
}

@Composable
private fun Tile(label: String, value: Double, ink: Color, modifier: Modifier, dark: Boolean = false) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (dark) Slate else T.surface,
        border = if (dark) null else BorderStroke(1.dp, T.line),
        modifier = modifier,
    ) {
        Column(Modifier.padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Txt(label, Type.chip.copy(fontSize = 9.sp), if (dark) Color(0xFF94A3B8) else T.inkFaint, uppercase = true)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Txt(value.toLong().toString(), Type.label.copy(fontSize = 17.sp), ink)
                Txt(" EGP", Type.chip.copy(fontSize = 9.sp), if (dark) Color(0xFF94A3B8) else T.inkFaint)
            }
        }
    }
}

@Composable
private fun StripFact(label: String, value: Double, ink: Color, modifier: Modifier) {
    Column(modifier) {
        Txt(label, Type.chip.copy(fontSize = 9.sp), Color(0xFF94A3B8), uppercase = true)
        Spacer(Modifier.height(4.dp))
        Txt("${value.toLong()} EGP", Type.label.copy(fontSize = 14.sp), ink, maxLines = 1)
    }
}

@Composable
private fun PayOption(title: String, hint: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (selected) T.accentTint else T.surface,
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) T.accent else T.line),
        modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp).clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).background(T.surfaceSoft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = T.inkMuted, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Txt(title, Type.rowName, T.ink)
                Txt(hint, Type.chip.copy(fontSize = 10.sp), T.inkFaint, uppercase = true)
            }
        }
    }
}

@Composable
private fun BillOption(bill: UnpaidProcedure, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (selected) T.accentTint else T.surface,
        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) T.accent else T.line),
        modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp).clickable(onClick = onClick),
    ) {
        Column(Modifier.padding(14.dp)) {
            Txt(bill.description, Type.rowName, T.ink, maxLines = 2)
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt("${bill.cost.toLong()} charged · ${bill.paidSoFar.toLong()} paid", Type.caption, T.inkMuted, Modifier.weight(1f))
                Surface(shape = RoundedCornerShape(8.dp), color = Color(0xFFFFF7ED)) {
                    Txt("Owes: ${bill.remaining.toLong()} EGP", Type.chip.copy(fontSize = 10.sp), Color(0xFFEA580C), Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun Modifier.fieldFrame(): Modifier =
    this.background(T.surfaceSoft, RoundedCornerShape(14.dp)).border(1.dp, T.line, RoundedCornerShape(14.dp))

@Composable
private fun Modifier.clip16(): Modifier = this.background(Color.Transparent, RoundedCornerShape(16.dp))

private fun spellMinutes(m: Int): String = when {
    m <= 0 -> "—"
    m % 60 == 0 -> "${m / 60} hr"
    m < 60 -> "$m min"
    else -> "${m / 60} hr ${m % 60} min"
}

private fun prettyDate(key: String): String = runCatching {
    val d = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(key)!!
    java.text.SimpleDateFormat("EEEE d MMMM yyyy", java.util.Locale.US).format(d)
}.getOrDefault(key)
