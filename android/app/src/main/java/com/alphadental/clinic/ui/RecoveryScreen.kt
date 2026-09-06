package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import com.alphadental.clinic.data.Recovery

/**
 * Collecting what the clinic is owed.
 *
 * A work queue rather than a report: biggest debt first, the patient's number on a button, and
 * one tap to record what came of the call. The status is kept apart from the money on purpose —
 * a patient who promised to pay on Saturday still owes it, and the person making calls on
 * Thursday needs to know not to ring them again.
 */
@Composable
fun RecoveryScreen(
    debtors: List<Recovery.Debtor>,
    loading: Boolean,
    error: String?,
    clinicName: String,
    busyPatientId: String,
    arabic: Boolean,
    onSetStatus: (Recovery.Debtor, String) -> Unit,
    onOpenPatient: ((String) -> Unit)?,
    onRefresh: () -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }
    val context = LocalContext.current

    var filter by rememberSaveable { mutableStateOf("open") }
    var search by rememberSaveable { mutableStateOf("") }

    val needle = search.trim().lowercase()
    val shown = debtors
        .filter { d ->
            when (filter) {
                // The point of the screen: everyone still to be dealt with.
                "open" -> d.followUp.status == "open" || d.followUp.status == "ignored"
                "promised" -> d.followUp.status == "promised"
                "settled" -> d.followUp.status == "settled"
                else -> true
            }
        }
        .filter { needle.isBlank() || "${it.patientName}${it.phone}".lowercase().contains(needle) }

    val outstanding = debtors.filter { it.followUp.status != "settled" }.sumOf { it.balance }

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
                        if (arabic) "تحصيل المستحقات" else "Collect dues",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "${debtors.size} مريض · ${outstanding.toInt()} ج.م"
                        else "${debtors.size} patient${if (debtors.size == 1) "" else "s"} · ${outstanding.toInt()} EGP outstanding",
                        fontSize = 12.sp,
                        color = Alpha.Slate500,
                    )
                }
            }

            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                singleLine = true,
                placeholder = { Text(if (arabic) "ابحث بالاسم أو الرقم" else "Search by name or number", color = Alpha.Slate400) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Alpha.Slate400) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Alpha.Green,
                    unfocusedBorderColor = Alpha.Slate200,
                    cursorColor = Alpha.Ink,
                    focusedContainerColor = Alpha.Card,
                    unfocusedContainerColor = Alpha.Card,
                    focusedTextColor = Alpha.Slate900,
                    unfocusedTextColor = Alpha.Slate900,
                ),
                shape = Alpha.CardShape,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
            ) {
                Pill(if (arabic) "للمتابعة" else "To chase", filter == "open") { filter = "open" }
                Pill(if (arabic) "وعدوا" else "Promised", filter == "promised") { filter = "promised" }
                Pill(if (arabic) "سُددت" else "Settled", filter == "settled") { filter = "settled" }
                Pill(if (arabic) "الكل" else "All", filter == "all") { filter = "all" }
            }

            error?.let {
                LoadErrorBanner(it, arabic, onRefresh, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            }

            RefreshBox(refreshing = loading && debtors.isNotEmpty(), onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
                when {
                    loading && debtors.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Alpha.Ink)
                    }
                    shown.isEmpty() -> Box(Modifier.fillMaxSize().padding(16.dp)) {
                        EmptyState(
                            when {
                                error != null -> ""
                                debtors.isEmpty() -> if (arabic) "لا أحد مدين للعيادة. نظيف." else "Nobody owes the clinic anything. Clean."
                                filter == "open" -> if (arabic) "لا أحد ينتظر مكالمة." else "Nobody is waiting on a call."
                                else -> if (arabic) "لا شيء هنا." else "Nothing here."
                            }
                        )
                    }
                    else -> LazyColumn(
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(shown, key = { it.patientId }) { debtor ->
                            DebtorCard(
                                debtor = debtor,
                                busy = busyPatientId == debtor.patientId,
                                clinicName = clinicName,
                                arabic = arabic,
                                onSetStatus = { onSetStatus(debtor, it) },
                                onCall = { context.dialNumber(debtor.phone) },
                                onWhatsApp = {
                                    context.whatsappWith(debtor.phone, Recovery.chaseMessage(debtor, clinicName, arabic))
                                },
                                onOpenPatient = onOpenPatient?.let { open -> { open(debtor.patientId) } },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Pill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Ink else Alpha.Card,
        border = if (selected) null else BorderStroke(1.dp, Alpha.Slate200),
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color.White else Alpha.Slate700,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun DebtorCard(
    debtor: Recovery.Debtor,
    busy: Boolean,
    clinicName: String,
    arabic: Boolean,
    onSetStatus: (String) -> Unit,
    onCall: () -> Unit,
    onWhatsApp: () -> Unit,
    onOpenPatient: (() -> Unit)?,
) {
    AlphaCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(Alpha.DangerSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        debtor.patientName.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.DangerText,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        debtor.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        buildString {
                            debtor.ageDays?.let {
                                append(if (arabic) "آخر حركة من $it يوم" else "last activity ${it}d ago")
                            }
                            if (debtor.phone.isBlank()) {
                                if (isNotEmpty()) append(" · ")
                                append(if (arabic) "لا يوجد رقم" else "no phone on file")
                            }
                        },
                        fontSize = 11.5.sp,
                        color = if (debtor.phone.isBlank()) Alpha.WarnText else Alpha.Slate500,
                    )
                }
                Text(
                    "${debtor.balance.toInt()}",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                )
            }

            if (debtor.followUp.lastContactedAt.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(
                    buildString {
                        append(Recovery.statusLabel(debtor.followUp.status, arabic))
                        if (debtor.followUp.updatedByName.isNotBlank()) {
                            append(" · ").append(debtor.followUp.updatedByName)
                        }
                    },
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.Slate500,
                )
            }

            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (debtor.phone.isNotBlank()) {
                    OutlinedButton(onClick = onCall, shape = Alpha.PillShape) {
                        Icon(Icons.Filled.Phone, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                        Spacer(Modifier.width(5.dp))
                        Text(if (arabic) "اتصال" else "Call", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                    }
                    OutlinedButton(onClick = onWhatsApp, shape = Alpha.PillShape) {
                        Icon(Icons.Filled.Chat, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Green)
                        Spacer(Modifier.width(5.dp))
                        Text(if (arabic) "تذكير" else "Remind", color = Alpha.Green, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                    }
                }
                onOpenPatient?.let {
                    OutlinedButton(onClick = it, shape = Alpha.PillShape) {
                        Icon(Icons.Filled.Folder, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                        Spacer(Modifier.width(5.dp))
                        Text(if (arabic) "الملف" else "File", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                Recovery.STATUSES.forEach { status ->
                    val on = debtor.followUp.status == status
                    Surface(
                        onClick = { if (!on && !busy) onSetStatus(status) },
                        shape = Alpha.PillShape,
                        color = if (on) Alpha.Ink else Alpha.Ground,
                        border = if (on) null else BorderStroke(1.dp, Alpha.Slate200),
                    ) {
                        Text(
                            Recovery.statusLabel(status, arabic),
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (on) Color.White else Alpha.Slate600,
                            modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

private fun Context.dialNumber(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }
}

/** WhatsApp with the reminder already typed, so nobody writes it out twenty times. */
private fun Context.whatsappWith(phone: String, text: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    runCatching {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits?text=${Uri.encode(text)}")))
    }
}
