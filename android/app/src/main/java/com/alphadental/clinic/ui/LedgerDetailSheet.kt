package com.alphadental.clinic.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.PatientLedgerEntry
import com.alphadental.clinic.data.Repository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * What sits behind one line of money.
 *
 * The question this answers is the one asked at the desk: for this treatment,
 * how much has actually been paid, in how many instalments, when, and by whom —
 * and for a single payment, what it was against and what is still owed on it.
 *
 * Used from both finance screens. The patient's statement already holds every
 * row, so it passes them in and no read happens; the clinic's Money tab knows
 * only the row it was tapped on, so it fetches the treatment's history.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LedgerDetailSheet(
    /** The row that was tapped. */
    entry: PatientLedgerEntry,
    /** The patient's name, when the screen knows it. */
    patientName: String,
    /** The treatment and its payments; null while still loading. */
    history: Repository.ProcedureHistory?,
    loading: Boolean,
    arabic: Boolean,
    /** Null when there is nowhere to go — e.g. already on the patient's own page. */
    onOpenPatient: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            // Headline: the amount, signed the way the lists sign it.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(if (entry.isPayment) Alpha.GreenSoft else Alpha.Slate100),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Payments,
                        contentDescription = null,
                        tint = if (entry.isPayment) Alpha.Green else Alpha.Slate500,
                        modifier = Modifier.size(21.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        (if (entry.isPayment) "+" else "") + "${entry.amount.toInt()} EGP",
                        fontSize = 23.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = if (entry.isPayment) Alpha.Green else Alpha.Slate900,
                    )
                    Text(
                        when {
                            entry.isPayment && arabic -> "دفعة"
                            entry.isPayment -> "Payment received"
                            arabic -> "علاج مُفوتر"
                            else -> "Treatment charged"
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate500,
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            Text(
                entry.description.ifBlank { if (arabic) "بدون وصف" else "No description" },
                fontSize = 14.5.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate800,
            )

            Spacer(Modifier.height(12.dp))

            // The facts of this one row.
            DetailRow(if (arabic) "التاريخ" else "Date", prettyWhen(entry, arabic))
            if (patientName.isNotBlank()) {
                DetailRow(if (arabic) "المريض" else "Patient", patientName)
            }
            if (entry.addedBy.isNotBlank()) {
                DetailRow(if (arabic) "بواسطة" else "Taken by", entry.addedBy)
            }
            if (entry.method.isNotBlank()) {
                DetailRow(if (arabic) "طريقة الدفع" else "Method", entry.method)
            }
            if (entry.doctorName.isNotBlank()) {
                DetailRow(if (arabic) "الطبيب" else "Doctor", "Dr. ${entry.doctorName}")
            }
            if (entry.discount > 0) {
                DetailRow(if (arabic) "خصم" else "Discount", "${entry.discount.toInt()} EGP")
            }
            if (entry.labFee > 0) {
                DetailRow(if (arabic) "رسوم المعمل" else "Lab fee", "${entry.labFee.toInt()} EGP")
            }
            if (entry.commission > 0) {
                DetailRow(if (arabic) "عمولة الطبيب" else "Doctor commission", "${entry.commission.toInt()} EGP")
            }

            // The treatment this belongs to, and everything paid against it.
            when {
                loading -> {
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(15.dp))
                        Spacer(Modifier.width(9.dp))
                        Text(
                            if (arabic) "جارٍ تحميل باقي التفاصيل…" else "Loading the rest…",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                        )
                    }
                }

                history != null && (history.charge != null || history.payments.isNotEmpty()) -> {
                    Spacer(Modifier.height(18.dp))
                    SectionHeading(if (arabic) "حساب هذا العلاج" else "THIS TREATMENT")
                    Spacer(Modifier.height(8.dp))

                    AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                        Column(Modifier.padding(14.dp)) {
                            history.charge?.let { charge ->
                                if (charge.description.isNotBlank() && charge.id != entry.id) {
                                    Text(
                                        charge.description,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate800,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Spacer(Modifier.height(8.dp))
                                }
                            }
                            MoneyLine(if (arabic) "إجمالي العلاج" else "Charged", history.charged, Alpha.Slate800)
                            MoneyLine(if (arabic) "المدفوع" else "Paid so far", history.paid, Alpha.Green)
                            MoneyLine(
                                if (arabic) "المتبقي" else "Still owed",
                                history.remaining,
                                if (history.remaining > 0) Alpha.WarnText else Alpha.Slate500,
                            )
                        }
                    }

                    Spacer(Modifier.height(14.dp))
                    SectionHeading(
                        when {
                            history.payments.isEmpty() && arabic -> "لا توجد دفعات بعد"
                            history.payments.isEmpty() -> "NO PAYMENTS YET"
                            arabic -> "${history.payments.size} دفعة"
                            history.payments.size == 1 -> "1 PAYMENT"
                            else -> "${history.payments.size} PAYMENTS"
                        }
                    )
                    Spacer(Modifier.height(6.dp))

                    history.payments.forEach { payment ->
                        Surface(
                            shape = Alpha.CardShape,
                            color = if (payment.id == entry.id) Alpha.GreenSoft else Alpha.Slate50,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 6.dp),
                        ) {
                            Row(
                                Modifier.padding(horizontal = 13.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        prettyWhen(payment, arabic),
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate800,
                                    )
                                    Text(
                                        listOfNotNull(
                                            payment.addedBy.takeIf { it.isNotBlank() }
                                                ?: (if (arabic) "غير مسجل" else "not recorded"),
                                            payment.method.takeIf { it.isNotBlank() },
                                        ).joinToString("  ·  "),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Alpha.Slate500,
                                    )
                                }
                                Text(
                                    "+${payment.amount.toInt()}",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Alpha.Green,
                                )
                            }
                        }
                    }
                }

                // A manual entry or an old payment with nothing linked: say so plainly
                // rather than leaving an empty space that reads as a loading failure.
                entry.procedureId.isBlank() && entry.isPayment -> {
                    Spacer(Modifier.height(14.dp))
                    Text(
                        if (arabic) "دفعة عامة على الحساب — غير مرتبطة بعلاج بعينه."
                        else "A general payment on the account — not tied to one treatment.",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                    )
                }
            }

            if (onOpenPatient != null) {
                Spacer(Modifier.height(14.dp))
                TextButton(onClick = onOpenPatient) {
                    Icon(Icons.Filled.Person, null, tint = Alpha.Green, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(7.dp))
                    Text(
                        if (arabic) "فتح ملف المريض" else "Open the patient file",
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Green,
                    )
                }
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
        Spacer(Modifier.weight(1f))
        Text(
            value,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = Alpha.Slate800,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun MoneyLine(label: String, amount: Double, color: androidx.compose.ui.graphics.Color) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
        Spacer(Modifier.weight(1f))
        Text("${amount.toInt()} EGP", fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, color = color)
    }
}

/**
 * "12 Aug 2026 · 14:30" — the day from the row's own date field, the clock time
 * from when it was written, which is the pair a receptionist is reconciling
 * against a till or a bank notification.
 */
private fun prettyWhen(entry: PatientLedgerEntry, arabic: Boolean): String {
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    val day = if (entry.date.isNotBlank()) {
        SimpleDateFormat("d MMM yyyy", locale).format(AppViewModel.parseDate(entry.date))
    } else null
    val clock = entry.createdAtMillis.takeIf { it > 0 }?.let {
        SimpleDateFormat("HH:mm", locale).format(Date(it))
    }
    return listOfNotNull(day, clock).joinToString("  ·  ").ifBlank { "—" }
}
