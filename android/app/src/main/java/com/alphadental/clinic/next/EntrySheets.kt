package com.alphadental.clinic.next

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.UnpaidProcedure
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** Open a file for somebody new. Name and number; everything else can wait. */
@Composable
fun AddPatientSheet(
    busy: Boolean,
    error: String?,
    onAdd: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }

    Sheet(
        title = "New patient",
        caption = "They get the next file number",
        busy = busy,
        error = error,
        action = "Add",
        ready = name.trim().length >= 2,
        onAction = { onAdd(name, phone) },
        onDismiss = onDismiss,
    ) {
        SheetField("Name", name, { name = it }, hint = "Mariam Hassan")
        SheetField("Phone", phone, { phone = it }, hint = "+20 100 123 4567", numeric = true)
        Txt(
            // Said because the sheet asks for so little: the rest is not missing,
            // it is simply not needed to open a file.
            "Everything else — date of birth, address, medical history — is on the " +
                "patient's own file once it exists.",
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}

/**
 * Book somebody in.
 *
 * Who, when, what — in that order, because that is the order the desk learns
 * them in. The length and the price come from the treatment; the time comes from
 * the clinic's own opening hours rather than a nine-to-five guess.
 */
@Composable
fun BookingSheet(state: Booking, actions: BookingActions) {
    Sheet(
        title = "New booking",
        caption = state.dateLabel,
        busy = state.saving,
        error = state.error,
        action = "Book",
        ready = state.ready && state.canBook,
        onAction = actions.book,
        onDismiss = actions.close,
    ) {
        PatientPicker(
            query = state.query,
            results = state.results,
            searching = state.searching,
            chosen = state.patient,
            allowNew = true,
            onQuery = actions.search,
            onChoose = actions.choose,
        )

        Rule()

        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SheetChoice("◀", false) { actions.shiftDay(-1) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Txt(state.dateLabel, Type.rowName, T.ink, maxLines = 1)
                if (!state.hours.isOpenOn(state.dateKey)) {
                    Spacer(Modifier.height(2.dp))
                    // Not a refusal: clinics do see people on a closing day. But
                    // booking one by accident is worth a word.
                    Txt("The clinic is normally closed", Type.caption, T.warn)
                }
            }
            Spacer(Modifier.width(10.dp))
            SheetChoice("▶", false) { actions.shiftDay(1) }
        }

        if (state.slots.isEmpty()) {
            SheetField("Time", state.time, actions.setTime, hint = "14:30")
            Txt(
                "Nobody has set the clinic's opening hours, so there are no slots to offer. " +
                    "A guess would list times the clinic is shut.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        } else {
            SheetChoices("Time") {
                state.slots.forEach { slot ->
                    val busy = state.taken.any { it.minuteOfDay == minutesOfSlot(slot) }
                    SheetChoice(
                        if (busy) "$slot ·" else slot,
                        state.time == slot,
                    ) { actions.setTime(slot) }
                }
            }
        }

        state.clash?.let { visit ->
            Surface(color = T.accentTint, modifier = Modifier.fillMaxWidth()) {
                Txt(
                    "${visit.patientName} is already booked at ${visit.time}. Two people in one " +
                        "chair is allowed here — the diary will simply show both.",
                    Type.caption, T.accentInk,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 3,
                )
            }
        }

        Rule()

        if (state.services.isNotEmpty()) {
            SheetChoices("What for") {
                state.services.take(20).forEach { service ->
                    SheetChoice(service.name, state.service?.id == service.id) {
                        actions.setService(if (state.service?.id == service.id) null else service)
                    }
                }
            }
        }

        if (state.doctors.isNotEmpty()) {
            SheetChoices("With") {
                state.doctors.forEach { doctor ->
                    SheetChoice(doctor.name, state.doctor?.id == doctor.id) {
                        actions.setDoctor(if (state.doctor?.id == doctor.id) null else doctor)
                    }
                }
            }
        }

        SheetChoices("How long") {
            listOf(15, 30, 45, 60, 90).forEach { m ->
                SheetChoice("$m min", state.minutes == m) { actions.setMinutes(m) }
            }
        }

        SheetField("Notes", state.notes, actions.setNotes, hint = "Nervous, wants the late slot", lines = 2)

        state.service?.takeIf { it.price > 0 }?.let {
            Txt(
                // The number on the appointment, and what it is not.
                "${it.name} lists at ${it.price.toLong()}. That figure goes on the appointment; " +
                    "nothing is charged until the treatment is recorded on the patient's file.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }
    }
}

private fun minutesOfSlot(time: String): Int {
    val parts = time.split(":")
    val h = parts.getOrNull(0)?.toIntOrNull() ?: 0
    val m = parts.getOrNull(1)?.toIntOrNull() ?: 0
    return h * 60 + m
}

/**
 * Take money.
 *
 * Against a named treatment wherever there is one, because that is what carries
 * the dentist's commission and the lab's fee. A payment with nothing named sits
 * against the account, which is how a deposit is taken before any work exists.
 */
@Composable
fun PaymentSheet(
    patientName: String,
    owed: Double,
    unpaid: List<UnpaidProcedure>,
    busy: Boolean,
    error: String?,
    onTake: (UnpaidProcedure?, Double) -> Unit,
    onDismiss: () -> Unit,
) {
    var against by remember { mutableStateOf(unpaid.firstOrNull()) }
    var amount by remember {
        mutableStateOf(unpaid.firstOrNull()?.remaining?.toLong()?.toString().orEmpty())
    }

    val value = amount.toDoubleOrNull() ?: 0.0

    Sheet(
        title = "Take a payment",
        caption = if (owed > 0) "$patientName owes ${owed.toLong()}" else patientName,
        busy = busy,
        error = error,
        action = "Take ${if (value > 0) value.toLong().toString() else ""}".trim(),
        ready = value > 0,
        onAction = { onTake(against, value) },
        onDismiss = onDismiss,
    ) {
        if (unpaid.isNotEmpty()) {
            SheetChoices("What for") {
                unpaid.forEach { procedure ->
                    SheetChoice(
                        "${procedure.description} · ${procedure.remaining.toLong()}",
                        against?.id == procedure.id,
                    ) {
                        against = procedure
                        amount = procedure.remaining.toLong().toString()
                    }
                }
                SheetChoice("On account", against == null) {
                    against = null
                    amount = ""
                }
            }
        }

        SheetField(
            "Amount", amount,
            { amount = it.filter { c -> c.isDigit() || c == '.' } },
            numeric = true, hint = "0",
        )

        against?.let {
            Txt(
                "${it.description}: ${it.cost.toLong()} charged, ${it.paidSoFar.toLong()} paid, " +
                    "${it.remaining.toLong()} left. More than that will be refused.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        } ?: Txt(
            if (unpaid.isEmpty()) {
                "Nothing is outstanding, so this is recorded against the account as a deposit."
            } else {
                "Recorded against the account rather than one treatment. A deposit, not a " +
                    "settlement of anything in particular."
            },
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
            maxLines = 3,
        )

        Txt(
            "Cash. Recorded in the clinic's own ledger the moment it is taken.",
            Type.caption, T.inkFaint,
            Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
            maxLines = 2,
        )
    }
}

/** What the booking sheet can ask for. */
data class BookingActions(
    val search: (String) -> Unit,
    val choose: (com.alphadental.clinic.next.data.Person?) -> Unit,
    val setDoctor: (com.alphadental.clinic.data.Doctor?) -> Unit,
    val setService: (com.alphadental.clinic.data.Service?) -> Unit,
    val shiftDay: (Int) -> Unit,
    val setTime: (String) -> Unit,
    val setMinutes: (Int) -> Unit,
    val setNotes: (String) -> Unit,
    val book: () -> Unit,
    val close: () -> Unit,
)
