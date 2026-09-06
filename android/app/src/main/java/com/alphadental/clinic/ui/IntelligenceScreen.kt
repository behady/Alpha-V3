package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.IntelligenceClient

/**
 * The two scans that look for money the clinic has already earned.
 *
 * One walks the appointment history for people who stopped coming; the other walks the ledger and
 * the clinical notes for work that was done and never invoiced, balances nobody chased, and rows
 * entered twice. Both run on the server and both only report — nothing is written and no patient
 * is messaged, so running one is always safe.
 *
 * Neither runs on opening the screen. They are heavy, they cost the clinic AI credit, and a scan
 * nobody asked for is a bill nobody asked for: the button says what it will do and waits.
 */
@Composable
fun IntelligenceScreen(
    dormancy: IntelligenceClient.DormancyReport?,
    revenue: IntelligenceClient.RecoveryReport?,
    scanning: String,
    error: String?,
    arabic: Boolean,
    onScanDormant: () -> Unit,
    onScanRevenue: () -> Unit,
    onOpenPatient: ((String) -> Unit)?,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf("dormant") }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp),
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (arabic) "اكتشاف" else "Find money",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "مرضى انقطعوا، وشغل لم يُحاسب عليه" else "Patients who stopped coming, and work nobody billed",
                        fontSize = 12.sp,
                        color = Alpha.Slate500,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                TabPill(if (arabic) "انقطعوا" else "Stopped coming", tab == "dormant", Modifier.weight(1f)) { tab = "dormant" }
                TabPill(if (arabic) "فلوس ضائعة" else "Money left behind", tab == "revenue", Modifier.weight(1f)) { tab = "revenue" }
            }

            error?.let {
                Text(
                    it,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.DangerText,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            Box(Modifier.weight(1f)) {
                if (tab == "dormant") {
                    DormantTab(
                        report = dormancy,
                        scanning = scanning == "dormant",
                        arabic = arabic,
                        onScan = onScanDormant,
                        onOpenPatient = onOpenPatient,
                        context = context,
                    )
                } else {
                    RevenueTab(
                        report = revenue,
                        scanning = scanning == "revenue",
                        arabic = arabic,
                        onScan = onScanRevenue,
                        onOpenPatient = onOpenPatient,
                    )
                }
            }
        }
    }
}

@Composable
private fun TabPill(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Ink else Alpha.Card,
        border = if (selected) null else BorderStroke(1.dp, Alpha.Slate200),
        modifier = modifier,
    ) {
        Text(
            label,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color.White else Alpha.Slate700,
            maxLines = 1,
            modifier = Modifier.padding(vertical = 10.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun ScanPrompt(title: String, hint: String, button: String, scanning: Boolean, onScan: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate900, fontFamily = AlphaType.Display)
        Spacer(Modifier.height(8.dp))
        Text(
            hint,
            fontSize = 13.sp,
            color = Alpha.Slate500,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            lineHeight = 19.sp,
        )
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = onScan,
            enabled = !scanning,
            shape = Alpha.PillShape,
            colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
            modifier = Modifier.height(48.dp),
        ) {
            if (scanning) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            else Text(button, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
        }
    }
}

@Composable
private fun DormantTab(
    report: IntelligenceClient.DormancyReport?,
    scanning: Boolean,
    arabic: Boolean,
    onScan: () -> Unit,
    onOpenPatient: ((String) -> Unit)?,
    context: Context,
) {
    if (report == null) {
        ScanPrompt(
            title = if (arabic) "من توقف عن الحضور؟" else "Who has stopped coming?",
            hint = if (arabic) "يقرأ تاريخ الزيارات ويستبعد من لديه حجز قادم بالفعل."
            else "Reads the visit history and leaves out anyone already booked in.",
            button = if (arabic) "ابدأ الفحص" else "Run the scan",
            scanning = scanning,
            onScan = onScan,
        )
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                StatTile(report.patients.size.toString(), if (arabic) "يستحقون مكالمة" else "Worth a call", modifier = Modifier.weight(1f))
                StatTile(
                    report.thresholdDays.toString(),
                    if (arabic) "يوم بلا زيارة" else "Days without a visit",
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (report.patients.isEmpty()) {
            item { EmptyState(if (arabic) "لا أحد انقطع. الجميع على المواعيد." else "Nobody has drifted off. Everyone is current.") }
        }
        items(report.patients, key = { it.patientId }) { patient ->
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(38.dp).clip(CircleShape).background(Alpha.WarnBg),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                patient.patientName.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                fontSize = 15.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Alpha.WarnText,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(patient.patientName, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                when {
                                    patient.lastVisitDate.isBlank() -> if (arabic) "لم يحضر أبداً" else "never attended"
                                    else -> if (arabic) "آخر زيارة من ${patient.daysSinceLastVisit} يوم" else "last visit ${patient.daysSinceLastVisit}d ago"
                                },
                                fontSize = 11.5.sp,
                                color = Alpha.Slate500,
                            )
                        }
                    }
                    if (patient.phone.isNotBlank() || onOpenPatient != null) {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (patient.phone.isNotBlank()) {
                                OutlinedButton(onClick = { context.dial(patient.phone) }, shape = Alpha.PillShape) {
                                    Icon(Icons.Filled.Phone, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (arabic) "اتصال" else "Call", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                                }
                                OutlinedButton(onClick = { context.whatsapp(patient.phone) }, shape = Alpha.PillShape) {
                                    Icon(Icons.Filled.Chat, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Green)
                                    Spacer(Modifier.width(5.dp))
                                    Text("WhatsApp", color = Alpha.Green, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                                }
                            }
                            onOpenPatient?.let { open ->
                                OutlinedButton(onClick = { open(patient.patientId) }, shape = Alpha.PillShape) {
                                    Icon(Icons.Filled.Folder, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (arabic) "الملف" else "File", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
        if (report.notes.isNotEmpty()) {
            item {
                Text(report.notes.joinToString("\n"), fontSize = 11.5.sp, color = Alpha.Slate400, modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}

@Composable
private fun RevenueTab(
    report: IntelligenceClient.RecoveryReport?,
    scanning: Boolean,
    arabic: Boolean,
    onScan: () -> Unit,
    onOpenPatient: ((String) -> Unit)?,
) {
    if (report == null) {
        ScanPrompt(
            title = if (arabic) "فلوس اتعملت ومحصلتش؟" else "Money earned and not collected?",
            hint = if (arabic) "يبحث عن شغل اتعمل ومتحسبش، أرصدة محدش لحقها، وتسجيلات مكررة."
            else "Looks for work that was done and never invoiced, balances nobody chased, and rows entered twice.",
            button = if (arabic) "ابدأ الفحص" else "Run the scan",
            scanning = scanning,
            onScan = onScan,
        )
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item {
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (arabic) "قابل للتحصيل" else "Recoverable",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate400,
                    )
                    Text(
                        "${report.recoverable.toInt()} ${if (arabic) "ج.م" else "EGP"}",
                        fontSize = 30.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = AlphaType.Display,
                        color = Alpha.Slate900,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        buildString {
                            append(if (arabic) "شغل متحسبش ${report.unbilledWork.toInt()}" else "unbilled ${report.unbilledWork.toInt()}")
                            append(" · ")
                            append(if (arabic) "أرصدة ${report.outstandingBalance.toInt()}" else "balances ${report.outstandingBalance.toInt()}")
                            if (report.duplicates > 0) {
                                append(" · ")
                                append(if (arabic) "مكرر ${report.duplicates.toInt()}" else "duplicates ${report.duplicates.toInt()}")
                            }
                        },
                        fontSize = 12.sp,
                        color = Alpha.Slate500,
                    )
                }
            }
        }
        if (report.findings.isEmpty()) {
            item { EmptyState(if (arabic) "لا يوجد شيء ضائع. الحسابات نظيفة." else "Nothing left behind. The books are clean.") }
        }
        items(report.findings.take(100), key = { "${it.kind}-${it.patientId}-${it.detail.hashCode()}" }) { finding ->
            AlphaCard(
                modifier = Modifier.fillMaxWidth().let { m ->
                    if (onOpenPatient != null && finding.patientId.isNotBlank()) {
                        m.clickable { onOpenPatient(finding.patientId) }
                    } else m
                }
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(14.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(finding.patientName, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            IntelligenceClient.findingLabel(finding.kind, arabic),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
                        Text(finding.detail, fontSize = 11.5.sp, color = Alpha.Slate500, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        finding.amount.toInt().toString(),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = AlphaType.Display,
                        color = Alpha.Slate900,
                    )
                }
            }
        }
        if (report.truncated) {
            item {
                Text(
                    if (arabic) "الفحص وصل لحده الأقصى، فالأرقام دي حد أدنى مش الصورة الكاملة."
                    else "The scan hit its limit, so these totals are a floor rather than the full picture.",
                    fontSize = 11.5.sp,
                    color = Alpha.WarnText,
                )
            }
        }
        if (report.notes.isNotEmpty()) {
            item {
                Text(report.notes.joinToString("\n"), fontSize = 11.5.sp, color = Alpha.Slate400, modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}

private fun Context.dial(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }
}

private fun Context.whatsapp(phone: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))) }
}
