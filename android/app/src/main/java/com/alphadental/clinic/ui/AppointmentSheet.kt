package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.Phone
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment

/**
 * What you can do to one appointment.
 *
 * A bottom sheet rather than a screen: the answer is almost always one tap
 * ("they're here"), and pushing a whole page for that would cost a back press
 * every time.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AppointmentSheet(
    appointment: Appointment,
    arabic: Boolean,
    canEdit: Boolean,
    onSetStatus: (String) -> Unit,
    onReschedule: () -> Unit,
    onOpenPatient: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Alpha.Card,
    ) {
        // Scrollable: with contact buttons, the edit row and the full status list, this sheet is
        // taller than a small phone's half-screen, and the statuses at the bottom were the part
        // being cut off — the whole reason the sheet is opened.
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {

            // The name is the way into the full file — the question "what do they owe?" comes up
            // constantly at the desk, and it is one tap from here rather than a separate search.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .then(
                        if (appointment.patientId.isNotBlank()) {
                            Modifier.clickable(onClick = onOpenPatient)
                        } else {
                            Modifier
                        }
                    ),
            ) {
                InitialBadge(appointment.patientName, statusStyle(appointment.status))
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = appointment.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                            fontSize = 20.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Alpha.Slate900,
                        )
                        if (appointment.patientId.isNotBlank()) {
                            Spacer(Modifier.size(4.dp))
                            Icon(
                                Icons.Filled.ChevronRight,
                                contentDescription = if (arabic) "ملف المريض" else "Patient file",
                                tint = Alpha.Slate400,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = listOfNotNull(
                            appointment.time.ifBlank { "—" },
                            appointment.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
                        ).joinToString("  ·  "),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
                Spacer(Modifier.size(8.dp))
                StatusPill(appointment.status, arabic)
            }

            if (appointment.treatment.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        appointment.treatment,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate600,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            // Reaching the patient. Both hand off to another app rather than acting
            // themselves — the phone's own dialler and WhatsApp, so nothing is sent
            // without the staff member seeing it first.
            if (appointment.phone.isNotBlank()) {
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ContactButton(
                        label = if (arabic) "اتصال" else "Call",
                        icon = { Icon(Icons.Filled.Phone, null, tint = Alpha.Green, modifier = Modifier.size(16.dp)) },
                        modifier = Modifier.weight(1f),
                    ) { context.dial(appointment.phone) }

                    ContactButton(
                        label = "WhatsApp",
                        icon = { Icon(Icons.Filled.Chat, null, tint = Alpha.Green, modifier = Modifier.size(16.dp)) },
                        modifier = Modifier.weight(1f),
                    ) { context.whatsApp(appointment.phone) }
                }
            }

            Spacer(Modifier.height(20.dp))

            if (canEdit) {
                OutlinedButton(
                    onClick = onReschedule,
                    shape = Alpha.CardShape,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Filled.EditCalendar, null, tint = Alpha.Slate700, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(
                        if (arabic) "تعديل الموعد" else "Edit appointment",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate700,
                    )
                }

                Spacer(Modifier.height(18.dp))

                SectionHeading(if (arabic) "تغيير الحالة" else "MOVE TO")
                Spacer(Modifier.height(10.dp))
                // All eight statuses visible at once, wrapping onto new lines. The old
                // sideways scroller hid everything past "Completed", and the hidden ones
                // (No show, Cancelled) are exactly the ones people hunted for.
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    STATUS_FLOW.forEach { status ->
                        val current = normalizeStatus(appointment.status) == status
                        val style = statusStyle(status)
                        Surface(
                            onClick = { if (!current) onSetStatus(status) },
                            enabled = !current,
                            shape = Alpha.PillShape,
                            color = if (current) style.pillBg else Alpha.Slate50,
                            border = if (current) null else BorderStroke(1.dp, Alpha.Slate200),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            ) {
                                Box(
                                    Modifier
                                        .size(7.dp)
                                        .clip(Alpha.PillShape)
                                        .background(style.accent)
                                )
                                Spacer(Modifier.size(6.dp))
                                Text(
                                    statusLabel(status, arabic),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (current) style.pillText else Alpha.Slate600,
                                )
                            }
                        }
                    }
                }
            } else {
                // Said out loud rather than showing buttons that fail on save: the
                // security rules would reject the write anyway, and offline that
                // rejection would not surface until hours later.
                Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (arabic) "ليس لديك صلاحية تعديل المواعيد."
                        else "Your account cannot change appointments.",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }
    }
}

/**
 * The order a visit actually moves through, so the most likely next tap is first.
 * Cancelled and No Show sit at the end — they are the exceptions, not the path.
 */
private val STATUS_FLOW = listOf(
    "Checked In",
    "In Chair",
    "Checking Out",
    "Completed",
    "Confirmed",
    "Delayed",
    "No Show",
    "Cancelled",
)

@Composable
private fun ContactButton(
    label: String,
    icon: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    OutlinedButton(onClick = onClick, shape = Alpha.CardShape, modifier = modifier) {
        icon()
        Spacer(Modifier.size(6.dp))
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate700)
    }
}

/** Opens the dialler with the number filled in. Placing the call stays the user's decision. */
private fun Context.dial(phone: String) {
    runCatching {
        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.trim()}")))
    }
}

/**
 * Opens WhatsApp on that number.
 *
 * wa.me needs plain international digits with no plus or separators — the same
 * rule the website's openWhatsAppWithText follows.
 */
private fun Context.whatsApp(phone: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    runCatching {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")))
    }
}
