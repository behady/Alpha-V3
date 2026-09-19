package com.alphadental.clinic.next

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.foundation.clickable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.next.data.LOWER_LEFT
import com.alphadental.clinic.next.data.LOWER_RIGHT
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.UPPER_LEFT
import com.alphadental.clinic.next.data.UPPER_RIGHT
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** What the lab-order sheet can do. */
data class LabOrderActions(
    val search: (String) -> Unit,
    val choose: (Person?) -> Unit,
    val chooseLab: (LabCases.Lab?) -> Unit,
    val chooseBranch: (LabCases.Branch?) -> Unit,
    val chooseDoctor: (Doctor?) -> Unit,
    val setWorkType: (String) -> Unit,
    val toggleTooth: (Int) -> Unit,
    val setUnits: (Int) -> Unit,
    val setBodyShade: (String) -> Unit,
    val setCervicalShade: (String) -> Unit,
    val setGumShade: (String) -> Unit,
    val setMaterial: (String) -> Unit,
    val setImplantSystem: (String) -> Unit,
    val setImplantPlatform: (String) -> Unit,
    val setAbutment: (String) -> Unit,
    val setRetention: (String) -> Unit,
    val setGuideType: (String) -> Unit,
    val setSleeve: (String) -> Unit,
    val setNotes: (String) -> Unit,
    val setDescription: (String) -> Unit,
    val setPrice: (Double) -> Unit,
    val setSentVia: (String) -> Unit,
    val setTryIn: (Boolean) -> Unit,
    val send: () -> Unit,
    val close: () -> Unit,
)

/**
 * Raising a case for the lab.
 *
 * Long, because a lab order is long — a crown with no shade on it is a phone
 * call from the technician the next morning. What it is not is uniform: the
 * questions change with the kind of work, so a surgical guide is never asked for
 * a shade and a denture is asked for a gum one.
 */
@Composable
fun LabOrderSheet(state: LabOrder, actions: LabOrderActions) {
    val shape = state.shape

    Sheet(
        title = "New lab case",
        caption = state.lab?.let { lab ->
            listOfNotNull(
                lab.name,
                state.draft.dueDate.takeIf { it.isNotBlank() }?.let { "due $it" },
            ).joinToString(" · ")
        } ?: "Which lab, and what for",
        busy = state.saving,
        error = state.error,
        action = "Send to the lab",
        ready = state.ready && state.canRaise,
        onAction = actions.send,
        onDismiss = actions.close,
    ) {
        if (!state.canRaise) {
            Txt(
                "This account can see the board but not raise cases.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 2,
            )
            return@Sheet
        }

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

        if (state.labs.isEmpty() && !state.loading) {
            Txt(
                "No laboratory is set up yet. Settings → Labs on the website is where they are " +
                    "added, with the turnaround that makes a case late.",
                Type.caption, T.warn,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 3,
            )
        } else {
            SheetChoices("Which lab") {
                state.labs.forEach { lab ->
                    SheetChoice(lab.name, state.lab?.id == lab.id) { actions.chooseLab(lab) }
                }
            }
        }

        SheetChoices("What kind of work") {
            LabCases.WORK_TYPE_LIST.forEach { type ->
                SheetChoice(type.en, state.draft.workType == type.id) { actions.setWorkType(type.id) }
            }
        }

        LabTeeth(state.draft.teeth.toSet(), actions.toggleTooth)

        if (shape.units) {
            SheetChoices("Units") {
                // A bridge is more units than teeth prepared, so this is offered
                // rather than derived — the teeth picker fills it as a start.
                (1..8).forEach { n ->
                    SheetChoice("$n", state.draft.units == n) { actions.setUnits(n) }
                }
            }
        }

        if (shape.bodyShade) {
            SheetChoices("Shade") {
                LabCases.TOOTH_SHADES.forEach { shade ->
                    SheetChoice(shade, state.draft.bodyShade == shade) {
                        actions.setBodyShade(if (state.draft.bodyShade == shade) "" else shade)
                    }
                }
            }
        }

        if (shape.cervicalShade) {
            SheetChoices("Cervical shade") {
                LabCases.TOOTH_SHADES.forEach { shade ->
                    SheetChoice(shade, state.draft.cervicalShade == shade) {
                        actions.setCervicalShade(if (state.draft.cervicalShade == shade) "" else shade)
                    }
                }
            }
            if (state.draft.bodyShade.isNotBlank() && state.draft.cervicalShade.isBlank()) {
                Txt(
                    // Said plainly: this one is genuinely optional.
                    "Leave blank for a single shade throughout.",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                )
            }
        }

        if (shape.gumShade) {
            SheetChoices("Gum shade") {
                LabCases.GUM_SHADES.forEach { shade ->
                    SheetChoice(shade, state.draft.gumShade == shade) {
                        actions.setGumShade(if (state.draft.gumShade == shade) "" else shade)
                    }
                }
            }
        }

        if (shape.implant) {
            SheetField("Implant system", state.draft.implantSystem, actions.setImplantSystem, hint = "Straumann BLT")
            SheetField("Platform", state.draft.implantPlatform, actions.setImplantPlatform, hint = "RC 4.1")
            SheetChoices("Abutment") {
                LabCases.ABUTMENT_OPTIONS.forEach { option ->
                    SheetChoice(option.en, state.draft.abutmentType == option.id) {
                        actions.setAbutment(if (state.draft.abutmentType == option.id) "" else option.id)
                    }
                }
            }
            SheetChoices("Held on by") {
                LabCases.RETENTION_OPTIONS.forEach { option ->
                    SheetChoice(option.en, state.draft.retention == option.id) {
                        actions.setRetention(if (state.draft.retention == option.id) "" else option.id)
                    }
                }
            }
        }

        if (shape.guide) {
            SheetChoices("Guide") {
                LabCases.GUIDE_TYPE_OPTIONS.forEach { option ->
                    SheetChoice(option.en, state.draft.guideType == option.id) {
                        actions.setGuideType(if (state.draft.guideType == option.id) "" else option.id)
                    }
                }
            }
            SheetField("Sleeve system", state.draft.sleeveSystem, actions.setSleeve, hint = "")
        }

        SheetField("Material", state.draft.material, actions.setMaterial, hint = "Multilayer, 1200 MPa")
        SheetField("What to make", state.draft.workDescription, actions.setDescription, hint = "Bridge 14–16")

        SheetChoices("How it goes") {
            SheetChoice(
                state.lab?.driverName?.takeIf { it.isNotBlank() }?.let { "Driver · $it" } ?: "Driver",
                state.draft.sentVia != "digital",
            ) { actions.setSentVia("driver") }
            SheetChoice("Digital files", state.draft.sentVia == "digital") { actions.setSentVia("digital") }
        }

        SheetChoices("Try-in") {
            SheetChoice("Not needed", !state.draft.needsTryIn) { actions.setTryIn(false) }
            SheetChoice("Needs a try-in", state.draft.needsTryIn) { actions.setTryIn(true) }
        }

        if (state.doctors.isNotEmpty()) {
            SheetChoices("For") {
                state.doctors.forEach { doctor ->
                    SheetChoice(doctor.name, state.doctor?.id == doctor.id) { actions.chooseDoctor(doctor) }
                }
            }
        }

        if (state.branches.size > 1) {
            SheetChoices("Branch") {
                state.branches.forEach { branch ->
                    SheetChoice(branch.name, state.draft.branchId == branch.id) {
                        actions.chooseBranch(branch)
                    }
                }
            }
        }

        SheetField(
            "Agreed price",
            if (state.draft.agreedPrice > 0) state.draft.agreedPrice.toLong().toString() else "",
            { actions.setPrice(it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
            numeric = true,
            hint = "0",
        )

        state.listedPrice?.takeIf { it > 0 && it != state.draft.agreedPrice }?.let { listed ->
            Txt(
                "${state.lab?.name} normally charges ${listed.toLong()} for this.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                maxLines = 2,
            )
        }

        SheetField("Notes for the lab", state.draft.notes, actions.setNotes, lines = 2, hint = "")

        Txt(
            if (state.draft.dueDate.isNotBlank()) {
                "Due back ${state.draft.dueDate}, from this lab's turnaround. The board turns the " +
                    "case amber as that day approaches and red once it passes."
            } else {
                "This lab has no turnaround set, so the case has no due date and can never show as " +
                    "late. That is set on the website, under Labs."
            },
            Type.caption, if (state.draft.dueDate.isNotBlank()) T.inkMuted else T.warn,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 4,
        )
    }
}

/**
 * Which teeth the case is for.
 *
 * The same picker the treatment sheet uses, in the same order, because the same
 * person uses both within a minute of each other.
 */
@Composable
private fun LabTeeth(chosen: Set<Int>, onToggle: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Txt(
            if (chosen.isEmpty()) "TEETH" else "TEETH · ${chosen.sorted().joinToString(", ")}",
            Type.eyebrow, T.inkFaint,
            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp, bottom = 4.dp),
            uppercase = true,
        )
        ToothPickerChart(chosen = chosen, onToggle = onToggle)
        Spacer(Modifier.height(4.dp))
    }
}

/**
 * Correct one line of a patient's account.
 *
 * What may be changed depends on what the line IS, and the difference is not arbitrary. A payment
 * is a fact about money that came in, so its amount, its date, its method and its wording are all
 * fair game. A treatment charge is the price of a piece of work, and the price belongs to the work
 * — changing it here would leave the ledger saying one thing and the clinical note another, so the
 * charge only offers its date and its description and says where the price lives.
 *
 * The server enforces exactly this. The sheet says it out loud so that a locked field reads as a
 * decision rather than a bug.
 */
@Composable
fun LedgerRowSheet(
    row: com.alphadental.clinic.next.data.Money,
    busy: Boolean,
    error: String?,
    /** Whether this account may change the line. Without it the sheet is the detail alone. */
    canEdit: Boolean,
    canDelete: Boolean,
    /** On a charge: every payment recorded against it, so the sheet can say who took what. */
    payments: List<com.alphadental.clinic.next.data.Money> = emptyList(),
    onSave: (String, String, Double, String) -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    var date by remember(row.id) { mutableStateOf(row.date) }
    var description by remember(row.id) { mutableStateOf(row.description) }
    var amount by remember(row.id) { mutableStateOf(row.amount.toLong().toString()) }
    var method by remember(row.id) { mutableStateOf(row.method.ifBlank { "Cash" }) }
    /** Deleting money asks twice. The first tap arms it, the second does it. */
    var armed by remember(row.id) { mutableStateOf(false) }

    val value = amount.toDoubleOrNull() ?: 0.0

    Sheet(
        title = if (row.isCharge) "This charge" else "This payment",
        caption = row.description.ifBlank { row.date },
        busy = busy,
        error = error,
        action = if (canEdit) "Save" else "Close",
        ready = !canEdit || (date.isNotBlank() && (!row.isPayment || value > 0)),
        onAction = { if (canEdit) onSave(date, description, value, method) else onDismiss() },
        onDismiss = onDismiss,
    ) {
        /*
         * The detail, before anything editable.
         *
         * "Who took that payment" and "how was this charge split" were the two questions the
         * statement could not answer, and they are answered here for everybody — the money is
         * the clinic's business, and reading how it was handled is not the same as changing it.
         */
        Column(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
            DetailLine("Amount", "${row.amount.toLong()} EGP")
            DetailLine("Date", noteDate(row.date))
            if (row.isPayment) {
                DetailLine("Taken by", row.by.ifBlank { "Not recorded" })
                DetailLine("Paid by", row.method.ifBlank { "Not recorded" })
                if (row.doctor.isNotBlank()) DetailLine("Dentist", row.doctor)
                if (row.commission > 0 || row.labFee > 0) {
                    DetailLine("Dentist's share", "${row.commission.toLong()}")
                    if (row.labFee > 0) DetailLine("Lab fee carried", "${row.labFee.toLong()}")
                    DetailLine("Clinic keeps", "${(row.amount - row.commission - row.labFee).coerceAtLeast(0.0).toLong()}")
                }
            } else {
                DetailLine("Charged by", row.by.ifBlank { row.doctor.ifBlank { "Not recorded" } })
                if (row.doctor.isNotBlank()) DetailLine("Dentist", row.doctor)
                if (row.discount > 0) DetailLine("Discount given", "${row.discount.toLong()}")
                if (row.labFee > 0) DetailLine("Lab fee", "${row.labFee.toLong()}")
                val paid = payments.sumOf { it.amount }
                DetailLine("Paid so far", "${paid.toLong()} of ${row.amount.toLong()}")
                if (payments.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Txt("Payments against this", Type.eyebrow, T.inkFaint, uppercase = true)
                    payments.sortedBy { it.date }.forEach { p ->
                        Spacer(Modifier.height(4.dp))
                        Txt(
                            listOf(noteDate(p.date), "${p.amount.toLong()}", p.method, p.by.takeIf { it.isNotBlank() }?.let { "by $it" }.orEmpty())
                                .filter { it.isNotBlank() }.joinToString(" · "),
                            Type.caption, T.inkMuted, maxLines = 2,
                        )
                    }
                }
            }
        }

        if (!canEdit) {
            Rule()
            Txt(
                "Correcting a line needs the finance tick-box under Settings → The team.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 2,
            )
            return@Sheet
        }
        Rule()

        SheetField("Date", date, { date = it }, hint = "2026-09-18")
        SheetField("Description", description, { description = it }, hint = "What this line is for", lines = 2)

        if (row.isPayment) {
            SheetField(
                "Amount", amount,
                { amount = it.filter { c -> c.isDigit() || c == '.' } },
                numeric = true,
            )
            SheetChoices("Paid by") {
                listOf("Cash", "Card", "Transfer", "Insurance").forEach { option ->
                    SheetChoice(option, method.equals(option, ignoreCase = true)) { method = option }
                }
            }
            Txt(
                "Changing the amount re-splits the dentist's commission and the lab fee on the " +
                    "treatment this settles. The server does that, not this phone.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 3,
            )
        } else {
            Txt(
                "Charged ${row.amount.toLong()}. The price of a treatment is changed on the " +
                    "treatment itself, under Treatments — it has to move with the work, not " +
                    "away from it.",
                Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                maxLines = 4,
            )
        }

        if (canDelete) {
            Rule()
            Txt(
                if (armed) "Tap again to remove it for good" else "Remove this line",
                Type.label.copy(fontSize = 13.sp),
                T.danger,
                Modifier
                    .clickable(enabled = !busy) { if (armed) onDelete() else armed = true }
                    .padding(horizontal = T.gutter, vertical = 16.dp),
            )
            Txt(
                if (row.isCharge) {
                    "A charge with money already paid against it cannot be removed — the payment " +
                        "has to go first. Removing it takes the treatment off the record with it."
                } else {
                    "The payment goes off the account and the treatment it settled is owed again."
                },
                Type.caption, T.inkFaint,
                Modifier.padding(start = T.gutter, end = T.gutter, bottom = 14.dp),
                maxLines = 4,
            )
        }
    }
}

@Composable
private fun DetailLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(label, Type.caption, T.inkMuted, Modifier.weight(1f))
        Txt(value, Type.label.copy(fontSize = 13.sp), T.ink, maxLines = 2)
    }
}

