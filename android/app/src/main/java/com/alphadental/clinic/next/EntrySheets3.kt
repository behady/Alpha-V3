package com.alphadental.clinic.next

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * One appointment, and what can be done to it.
 *
 * The write the desk reaches for most: somebody walks in and has to be marked
 * arrived. Everything else on the sheet — the file, a call, a reschedule — is a
 * door to somewhere else, so those are rows rather than buttons and the one
 * button at the bottom does the one thing this sheet is for.
 *
 * There is no delete. A cancelled visit stays in the day's record, which is how
 * the website keeps it and the only way "why was this afternoon so quiet" has an
 * answer next month.
 */
@Composable
fun VisitSheet(
    state: VisitSheetState,
    onMove: (Stage) -> Unit,
    onOpenFile: () -> Unit,
    onReschedule: () -> Unit,
    onCall: (String) -> Unit,
    onMessage: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val visit = state.visit ?: return
    var chosen by remember(visit.id) { mutableStateOf<Stage?>(null) }

    Sheet(
        title = visit.patientName.ifBlank { "Appointment" },
        caption = listOf(visit.time, visit.doctor, visit.treatment)
            .filter { it.isNotBlank() }
            .joinToString(" · "),
        busy = state.saving,
        error = state.error,
        action = chosen?.let { "Move to ${stageLabel(it).lowercase()}" } ?: "Done",
        ready = chosen != null,
        onAction = { chosen?.let(onMove) },
        onDismiss = onDismiss,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Txt("NOW", Type.eyebrow, T.inkFaint, uppercase = true)
            Spacer(Modifier.width(10.dp))
            StageChip(visit.status)
            Spacer(Modifier.width(10.dp))
            state.done?.let { Txt(it, Type.caption, T.inkMuted, maxLines = 1) }
        }

        if (state.canEdit) {
            SheetChoices("Move it to") {
                state.moves.forEach { stage ->
                    SheetChoice(stageLabel(stage), chosen == stage) {
                        chosen = if (chosen == stage) null else stage
                    }
                }
            }

            chosen?.let { stage ->
                Txt(
                    when (stage) {
                        // Said plainly, because two of these are visible on a
                        // screen the person tapping is not looking at.
                        Stage.CheckedIn -> "Stamps the time they arrived and puts them on the " +
                            "waiting-room display at the desk."
                        Stage.InChair -> "Marks the chair as busy. The dashboard counts this as " +
                            "the patient being seen."
                        Stage.CheckingOut -> "They are finished and on their way to the desk — " +
                            "the cue to take payment."
                        Stage.Completed -> "Closes the visit. It stops counting as work still to " +
                            "do today."
                        Stage.Confirmed -> "They have confirmed they are coming. Reminders stop " +
                            "chasing a confirmation."
                        Stage.Delayed -> "Running late, but still coming. The slot stays theirs."
                        Stage.NoShow -> "They did not come. This is what the no-show figure in " +
                            "Reports counts."
                        Stage.Cancelled -> "Cancelled. The row greys out but stays in the day, so " +
                            "the gap is still explained."
                        else -> "Records the change against your name."
                    },
                    Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                    maxLines = 4,
                )
            }
        } else {
            Txt(
                "This account can see the diary but not change it. Ask whoever manages access " +
                    "for the appointments tick-box.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 3,
            )
        }

        Spacer(Modifier.height(6.dp))
        Rule()

        SheetAction("Open the patient's file", "Notes, chart, ledger", onOpenFile)
        if (state.canEdit) {
            Rule()
            SheetAction("Change the day or time", "Opens the booking sheet on this visit", onReschedule)
        }
        state.phone.takeIf { it.isNotBlank() }?.let { phone ->
            Rule()
            SheetAction("Call", phone) { onCall(phone) }
            Rule()
            SheetAction("WhatsApp", phone) { onMessage(phone) }
        }
    }
}

/** A row inside a sheet that leads somewhere else. */
@Composable
fun SheetAction(label: String, caption: String, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = T.gutter, vertical = 14.dp),
    ) {
        Txt(label, Type.rowName, T.ink)
        if (caption.isNotBlank()) {
            Spacer(Modifier.height(2.dp))
            Txt(caption, Type.caption, T.inkMuted, maxLines = 1)
        }
    }
}

/**
 * Everything else a patient's file can do.
 *
 * One door rather than a row of icons: the bar keeps the three things done
 * constantly — ring them, message them, record what was done — and this holds
 * the rest, which are each worth a sentence of explanation anyway.
 */
@Composable
fun PatientActionsSheet(
    patientName: String,
    onPrescribe: (() -> Unit)?,
    onPlan: (() -> Unit)?,
    onBook: (() -> Unit)?,
    onOrtho: (() -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    Sheet(
        title = "More",
        caption = patientName,
        action = "Close",
        ready = true,
        onAction = onDismiss,
        onDismiss = onDismiss,
    ) {
        onPrescribe?.let {
            SheetAction("Write a prescription", "From the clinic's drug list", it)
            Rule()
        }
        onPlan?.let {
            SheetAction("Propose a treatment plan", "Several visits, priced, for them to accept", it)
            Rule()
        }
        onBook?.let {
            SheetAction("Book an appointment", "Opens the booking sheet on this patient", it)
            Rule()
        }
        onOrtho?.let {
            SheetAction("Start orthodontic treatment", "Puts them on the ortho board", it)
            Rule()
        }
        if (onPrescribe == null && onPlan == null && onBook == null && onOrtho == null) {
            Txt(
                "This account has nothing else it can do on a patient's file.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
                maxLines = 2,
            )
        }
    }
}
