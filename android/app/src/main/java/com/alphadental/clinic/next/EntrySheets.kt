package com.alphadental.clinic.next

import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
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

/**
 * Open a file for somebody new.
 *
 * The same questions the website's own form asks, in the order a desk asks them. It used to ask
 * two — a name and a number — and explain the rest away as something to fill in later. That was
 * wrong about the one field it matters most for: where somebody heard about the clinic is only
 * ever known while they are standing there, and it is the single number the marketing report is
 * built on. Nobody goes back a week later to add it.
 *
 * Everything below the fold is optional and looks it. A receptionist with a queue can still type
 * a name, a number and Save, which is what the two-field version was protecting.
 */
@Composable
fun AddPatientSheet(
    busy: Boolean,
    error: String?,
    /** Where this clinic says its patients come from. Falls back to the website's own list. */
    sources: List<String> = emptyList(),
    onAdd: (NewPatient) -> Unit,
    onDismiss: () -> Unit,
) {
    // Kept if the sheet is closed by accident. Eight fields of typing is a real loss, and on a
    // gesture phone the swipe that dismisses the keyboard is the same swipe that closed this.
    var name by draft(DRAFT_NEW_PATIENT, "name")
    var phone by draft(DRAFT_NEW_PATIENT, "phone")
    var source by draft(DRAFT_NEW_PATIENT, "source")
    var address by draft(DRAFT_NEW_PATIENT, "address")
    var gender by draft(DRAFT_NEW_PATIENT, "gender")
    var dob by draft(DRAFT_NEW_PATIENT, "dob")
    var email by draft(DRAFT_NEW_PATIENT, "email")
    var allergies by draft(DRAFT_NEW_PATIENT, "allergies")
    var history by draft(DRAFT_NEW_PATIENT, "history")
    /** The optional half stays folded until somebody wants it — unless it holds something. */
    var more by remember {
        mutableStateOf(listOf(dob, email, allergies, history).any { it.isNotBlank() })
    }

    Sheet(
        title = "New patient",
        caption = "They get the next file number",
        busy = busy,
        error = error,
        action = "Add",
        ready = name.trim().length >= 2,
        onAction = {
            onAdd(
                NewPatient(
                    name = name, phone = phone, address = address, dateOfBirth = dob,
                    gender = gender, referral = source, allergies = allergies,
                    medicalHistory = history, email = email,
                )
            )
        },
        onDismiss = onDismiss,
    ) {
        SheetField("Name", name, { name = it }, hint = "Mariam Hassan")
        SheetField("Phone", phone, { phone = it }, hint = "+20 100 123 4567", numeric = true)

        if (sources.isNotEmpty()) {
            SheetChoices("How did they hear about us") {
                sources.forEach { option ->
                    SheetChoice(option, source == option) {
                        source = if (source == option) "" else option
                    }
                }
            }
        }

        SheetField("Address", address, { address = it }, hint = "Maadi, Cairo")

        SheetChoices("Gender") {
            listOf("Female", "Male").forEach { option ->
                SheetChoice(option, gender == option) {
                    gender = if (gender == option) "" else option
                }
            }
        }

        Rule()
        Txt(
            if (more) "Fewer details" else "More details",
            Type.label.copy(fontSize = 13.sp), T.accentInk,
            Modifier
                .clickable { more = !more }
                .padding(horizontal = T.gutter, vertical = 14.dp),
        )

        if (more) {
            SheetField("Date of birth", dob, { dob = it }, hint = "1991-04-17")
            SheetField("Email", email, { email = it }, hint = "mariam@example.com")
            SheetField("Allergies", allergies, { allergies = it }, hint = "Penicillin", lines = 2)
            SheetField(
                "Medical history", history, { history = it },
                hint = "Diabetic, on blood thinners", lines = 3,
            )
            Txt(
                // Worth saying out loud: an empty box is not a clean bill of health, and the
                // record has to be able to tell the difference.
                "Leaving the medical history empty records that nobody has asked yet — not that " +
                    "there is nothing to report.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        }
    }
}

/** Where an unfinished new patient waits. Cleared when one is actually created. */
const val DRAFT_NEW_PATIENT = "new-patient"

/** Everything the new-patient sheet collected, carried in one piece. */
data class NewPatient(
    val name: String,
    val phone: String,
    val address: String = "",
    val dateOfBirth: String = "",
    val gender: String = "",
    val referral: String = "",
    val allergies: String = "",
    val medicalHistory: String = "",
    val email: String = "",
)

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
        title = if (state.isEditing) "Change this booking" else "New booking",
        caption = state.dateLabel,
        busy = state.saving,
        error = state.error,
        action = if (state.isEditing) "Save" else "Book",
        ready = state.ready && state.canBook,
        onAction = actions.book,
        onDismiss = actions.close,
    ) {
        if (state.isEditing) {
            // Who the appointment is for is not up for negotiation here. Moving
            // a visit to a different patient is not a reschedule, it is two
            // separate acts, and doing it by retyping a name in this box is how
            // one patient's history ends up on another's file.
            Txt(
                state.patient?.name.orEmpty().ifBlank { "This patient" },
                Type.rowName, T.ink,
                Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp),
            )
            Txt(
                "To book somebody else, close this and start a new booking.",
                Type.caption, T.inkMuted,
                Modifier.padding(start = T.gutter, end = T.gutter, top = 2.dp, bottom = 12.dp),
                maxLines = 2,
            )
        } else {
            PatientPicker(
                query = state.query,
                results = state.results,
                searching = state.searching,
                chosen = state.patient,
                allowNew = true,
                onQuery = actions.search,
                onChoose = actions.choose,
            )
        }

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

        // One searchable box rather than a row of twenty chips. A clinic with sixty prices could
        // reach the first twenty of them, in whatever order the list happened to load, and had no
        // way at all to book a visit whose reason is not a priced treatment.
        var picking by remember { mutableStateOf(false) }
        SheetField(
            label = "What for",
            value = state.treatment,
            onChange = { actions.setTreatment(it); picking = true },
            hint = "Check-up, or a treatment from the price list",
            onFocus = { focused -> if (focused) picking = true },
            trailing = if (state.services.isEmpty()) null else ({
                Icon(
                    if (picking) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    if (picking) "Hide the price list" else "Show the price list",
                    tint = T.inkMuted,
                    modifier = Modifier.clickable { picking = !picking }.padding(10.dp),
                )
            }),
        )

        if (picking && state.services.isNotEmpty()) {
            val needle = state.treatment.trim().lowercase()
            val matches = when {
                needle.isEmpty() -> state.services
                state.services.any { it.name.equals(needle, ignoreCase = true) } -> emptyList()
                else -> state.services.filter { it.name.lowercase().contains(needle) }
            }
            matches.take(40).forEach { service ->
                Rule()
                SheetAction(
                    service.name,
                    listOfNotNull(
                        if (service.price > 0) "${service.price.toLong()} EGP" else null,
                        service.durationMinutes.takeIf { it > 0 }?.let { "$it min" },
                    ).joinToString(" · "),
                ) {
                    actions.setService(service)
                    picking = false
                }
            }
            if (matches.isNotEmpty()) Rule()
        }

        if (state.doctors.isNotEmpty()) {
            SheetChoices("With") {
                // The clinic rather than one dentist — the website's General option. Tapping a
                // dentist off already meant this; now it says so, and can be chosen outright.
                SheetChoice("General", state.doctor == null) { actions.setDoctor(null) }
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
    val setTreatment: (String) -> Unit,
    val shiftDay: (Int) -> Unit,
    val setTime: (String) -> Unit,
    val setMinutes: (Int) -> Unit,
    val setNotes: (String) -> Unit,
    val book: () -> Unit,
    val close: () -> Unit,
)
