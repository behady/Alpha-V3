package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.PatientFile
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
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
                    color = Color(0xFFFFF1F2),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        error,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF9F1239),
                        modifier = Modifier.padding(16.dp),
                    )
                }

                file != null -> {
                    Text(
                        file.patient.name.ifBlank { if (arabic) "بدون اسم" else "No name" },
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate900,
                    )
                    if (file.fileId.isNotBlank()) {
                        Text(
                            file.fileId,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
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
                            color = Color(0xFFE11D48),
                        )
                    }

                    Spacer(Modifier.height(18.dp))
                    BalanceCard(file, arabic)

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
            balance.owed > 0 -> Color(0xFFFEF3C7)
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
                    fontWeight = FontWeight.Black,
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
                    fontWeight = FontWeight.Black,
                    color = when {
                        balance.owed > 0 -> Color(0xFF92400E)
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
