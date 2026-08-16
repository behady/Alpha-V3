package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.ClinicalNote
import com.alphadental.clinic.data.parseTeeth
import com.alphadental.clinic.data.PatientFile
import com.alphadental.clinic.data.Prescription
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * One patient's file.
 *
 * Ordered by what someone standing at the desk actually needs: who they are and how to reach them,
 * what they owe, when they are next in, then history. The clinical detail stays on the website —
 * this is the lookup, not the record.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientSheet(
    file: PatientFile?,
    loading: Boolean,
    error: String?,
    arabic: Boolean,
    /** Null when this user may not take payments, so no button is shown at all. */
    onTakePayment: (() -> Unit)?,
    notes: List<ClinicalNote>,
    /** Null when this user may not record treatment. */
    onAddNote: (() -> Unit)?,
    prescriptions: List<Prescription>,
    /** Null when this user may not prescribe. */
    onWriteRx: (() -> Unit)?,
    /** Null when this user may not change a recorded procedure. */
    onSetNoteStatus: ((noteId: String, status: String) -> Unit)?,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedTooth by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            when {
                loading -> Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                }

                error != null -> Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.DangerSoft,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        error,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.DangerText,
                        modifier = Modifier.padding(16.dp),
                    )
                }

                file != null -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .background(Alpha.GreenSoft),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                file.patient.name.trim().firstOrNull()?.uppercase() ?: "•",
                                fontSize = 19.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Green,
                            )
                        }
                        Spacer(Modifier.size(12.dp))
                        Column {
                            Text(
                                file.patient.name.ifBlank { if (arabic) "بدون اسم" else "No name" },
                                fontSize = 21.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Alpha.Slate900,
                            )
                            if (file.fileId.isNotBlank()) {
                                Text(
                                    file.fileId,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Alpha.Slate400,
                                )
                            }
                        }
                    }

                    if (file.patient.phone.isNotBlank()) {
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(
                                onClick = { context.dialNumber(file.patient.phone) },
                                shape = Alpha.CardShape,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Filled.Phone, null, tint = Alpha.Green, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text(
                                    if (arabic) "اتصال" else "Call",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate700,
                                )
                            }
                            OutlinedButton(
                                onClick = { context.openWhatsApp(file.patient.phone) },
                                shape = Alpha.CardShape,
                                modifier = Modifier.weight(1f),
                            ) {
                                Icon(Icons.Filled.Chat, null, tint = Alpha.Green, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text(
                                    "WhatsApp",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate700,
                                )
                            }
                        }
                    } else {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            if (arabic) "لا يوجد رقم هاتف في الملف." else "No phone number on file.",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Danger,
                        )
                    }

                    Spacer(Modifier.height(18.dp))
                    BalanceCard(file, arabic)

                    if (onTakePayment != null) {
                        Spacer(Modifier.height(10.dp))
                        Button(
                            onClick = onTakePayment,
                            shape = Alpha.CardShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Alpha.Ink,
                                contentColor = Color.White,
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp),
                        ) {
                            Icon(Icons.Filled.AccountBalanceWallet, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.size(8.dp))
                            Text(
                                if (arabic) "تسجيل دفعة" else "Take a payment",
                                fontSize = 15.sp,
                                fontWeight = FontWeight.ExtraBold,
                            )
                        }
                    }

                    Spacer(Modifier.height(20.dp))
                    TeethChart(
                        notes = notes,
                        arabic = arabic,
                        selectedTooth = selectedTooth,
                        onSelectTooth = { selectedTooth = it },
                    )

                    // Treatment first: on a patient file the clinical record is what a dentist
                    // opens it for, and appointments are context around it.
                    Spacer(Modifier.height(20.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SectionHeading(if (arabic) "العلاج" else "TREATMENT", Modifier.weight(1f))
                        if (onAddNote != null) {
                            TextButton(onClick = onAddNote) {
                                Text(
                                    if (arabic) "+ إضافة" else "+ Add",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Alpha.Green,
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))

                    // Matched against the teeth a note actually names, not its raw stored value: a note on
                    // "16,17" belongs under both, and comparing the whole string found neither.
                    val shownNotes = selectedTooth?.let { t -> notes.filter { t in parseTeeth(it.tooth) } } ?: notes

                    if (shownNotes.isEmpty()) {
                        Text(
                            if (selectedTooth != null) {
                                if (arabic) "لا توجد إجراءات على هذا السن." else "Nothing recorded on this tooth."
                            } else if (arabic) "لا توجد إجراءات مسجلة." else "No procedures recorded.",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
                    } else {
                        Column(Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState())) {
                            shownNotes.forEach { NoteRow(it, arabic, onSetNoteStatus) }
                        }
                    }

                    Spacer(Modifier.height(20.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SectionHeading(if (arabic) "الروشتات" else "PRESCRIPTIONS", Modifier.weight(1f))
                        if (onWriteRx != null) {
                            TextButton(onClick = onWriteRx) {
                                Text(
                                    if (arabic) "+ كتابة" else "+ Write",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Alpha.Green,
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))

                    if (prescriptions.isEmpty()) {
                        Text(
                            if (arabic) "لا توجد روشتات." else "No prescriptions.",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
                    } else {
                        prescriptions.take(5).forEach { rx ->
                            Surface(
                                shape = Alpha.CardShape,
                                color = Alpha.Slate50,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 3.dp),
                            ) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(
                                        // The medicines themselves are the identifying detail —
                                        // a list of dates would make every prescription look alike.
                                        rx.drugs.joinToString(" · ") { it.name }.ifBlank { "—" },
                                        fontSize = 13.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate800,
                                    )
                                    Text(
                                        listOfNotNull(
                                            rx.date.takeIf { it.isNotBlank() },
                                            rx.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
                                        ).joinToString("  ·  "),
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Alpha.Slate400,
                                    )
                                }
                            }
                        }
                    }

                    if (file.upcoming.isNotEmpty()) {
                        Spacer(Modifier.height(18.dp))
                        SectionHeading(if (arabic) "المواعيد القادمة" else "COMING UP")
                        Spacer(Modifier.height(8.dp))
                        file.upcoming.take(5).forEach { VisitRow(it, arabic) }
                    }

                    Spacer(Modifier.height(18.dp))
                    SectionHeading(if (arabic) "الزيارات السابقة" else "PAST VISITS")
                    Spacer(Modifier.height(8.dp))
                    if (file.past.isEmpty()) {
                        Text(
                            if (arabic) "لا توجد زيارات سابقة." else "No past visits.",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
                    } else {
                        Column(Modifier.heightIn(max = 260.dp).verticalScroll(rememberScrollState())) {
                            file.past.take(20).forEach { VisitRow(it, arabic) }
                        }
                    }
                }
            }
        }
    }
}

/**
 * What the patient owes.
 *
 * A credit is shown as a credit rather than a negative debt — someone who prepaid should not be
 * chased, and "owes -200" is exactly the kind of thing that gets misread at a busy desk.
 */
@Composable
private fun BalanceCard(file: PatientFile, arabic: Boolean) {
    val balance = file.balance
    val settled = !balance.inCredit && balance.owed <= 0.0

    Surface(
        shape = Alpha.CardShape,
        color = when {
            balance.owed > 0 -> Alpha.WarnBg
            balance.inCredit -> Alpha.GreenSoft
            else -> Alpha.Slate50
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    when {
                        balance.owed > 0 && arabic -> "المستحق"
                        balance.owed > 0 -> "Outstanding"
                        balance.inCredit && arabic -> "رصيد دائن"
                        balance.inCredit -> "In credit"
                        arabic -> "الحساب مسدد"
                        else -> "Settled"
                    },
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Alpha.Slate500,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    when {
                        balance.owed > 0 -> "${balance.owed.toInt()} EGP"
                        balance.inCredit -> "${balance.creditAmount.toInt()} EGP"
                        else -> if (arabic) "لا شيء" else "Nothing owed"
                    },
                    fontSize = 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = when {
                        balance.owed > 0 -> Alpha.WarnText
                        balance.inCredit -> Alpha.Green
                        else -> Alpha.Slate600
                    },
                )
            }
            if (!settled) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${if (arabic) "إجمالي" else "Charged"} ${balance.charged.toInt()}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                    )
                    Text(
                        "${if (arabic) "مدفوع" else "Paid"} ${balance.paid.toInt()}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                    )
                }
            }
        }
    }
}

/**
 * One recorded procedure.
 *
 * A cost with no ledger link is called out, because that is precisely what the website's Collect
 * Dues screen reports as treated-but-never-invoiced — money the clinic has earned and not asked
 * for. Better seen here, on the patient, than discovered in a report weeks later.
 */
@Composable
private fun NoteRow(
    note: ClinicalNote,
    arabic: Boolean,
    onSetStatus: ((noteId: String, status: String) -> Unit)? = null,
) {
    // Correcting a status is the one edit worth having on a phone: a procedure marked Planned that
    // was actually finished is the difference between a treatment plan that reflects the mouth and
    // one nobody trusts. Deeper edits stay on the website, where there is room to do them safely.
    var expanded by remember { mutableStateOf(false) }

    Surface(
        shape = Alpha.CardShape,
        color = Alpha.Slate50,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .then(if (onSetStatus != null) Modifier.clickable { expanded = !expanded } else Modifier),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    note.procedure.ifBlank { "—" },
                    fontSize = 14.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Alpha.Slate900,
                    modifier = Modifier.weight(1f),
                )
                NoteStatusPill(note.status, arabic)
            }

            val detail = listOfNotNull(
                note.tooth.takeIf { it.isNotBlank() && it != "Gen" }?.let { (if (arabic) "سن " else "Tooth ") + it },
                note.date.takeIf { it.isNotBlank() },
                note.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
            ).joinToString("  ·  ")
            if (detail.isNotBlank()) {
                Text(detail, fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
            }

            if (note.note.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(note.note, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate600)
            }

            if (note.cost > 0) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${note.cost.toInt()} EGP",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate700,
                    )
                    if (note.ledgerId.isBlank()) {
                        Spacer(Modifier.size(8.dp))
                        Surface(shape = Alpha.PillShape, color = Alpha.DangerSoft) {
                            Text(
                                if (arabic) "لم يُفوتر" else "not invoiced",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Alpha.DangerText,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            if (expanded && onSetStatus != null) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    NOTE_STATUSES.forEach { status ->
                        val current = note.status == status
                        Surface(
                            shape = Alpha.PillShape,
                            color = if (current) Alpha.Ink else Alpha.Slate100,
                            modifier = Modifier.clickable(enabled = !current) {
                                onSetStatus(note.id, status)
                                expanded = false
                            },
                        ) {
                            Text(
                                noteStatusLabel(status, arabic),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = if (current) Color.White else Alpha.Slate600,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NoteStatusPill(status: String, arabic: Boolean) {
    val (bg, fg) = when (status) {
        "Completed" -> Alpha.GreenSoft to Alpha.Green
        "Ongoing" -> Alpha.WarnBg to Alpha.WarnText
        else -> Alpha.Slate100 to Alpha.Slate600
    }
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(
            noteStatusLabel(status, arabic),
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            color = fg,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun VisitRow(visit: Appointment, arabic: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                prettyVisitDate(visit.date, arabic),
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate800,
            )
            val detail = listOfNotNull(
                visit.time.takeIf { it.isNotBlank() },
                visit.treatment.takeIf { it.isNotBlank() },
                visit.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
            ).joinToString(" · ")
            if (detail.isNotBlank()) {
                Text(detail, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
            }
        }
        StatusPill(visit.status, arabic)
    }
}

private fun prettyVisitDate(dateKey: String, arabic: Boolean): String {
    if (dateKey.isBlank()) return "—"
    val parsed = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey) }.getOrNull()
        ?: return dateKey
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    return SimpleDateFormat("d MMM yyyy", locale).format(parsed)
}

private fun Context.dialNumber(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.trim()}"))) }
}

private fun Context.openWhatsApp(phone: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))) }
}
