package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Turn this phone into the clinic's reminder sender.
 *
 * The costs are stated on the switch, not behind it. Every message is billed to this SIM, and one
 * Arabic character drops a text from 160 characters to 70 — a clinic can be three messages deep
 * per patient per day without ever being told. Someone deciding whether to flip this should be
 * able to read what it will cost them without leaving the screen.
 */
@Composable
fun SmsSenderCard(
    enabled: Boolean,
    arabic: Boolean,
    lastResult: String,
    lastRunAt: Long,
    sentTotal: Int,
    onToggle: (Boolean) -> Unit,
) {
    AlphaCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.Sms,
                    contentDescription = null,
                    tint = if (enabled) Alpha.Green else Alpha.Slate400,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        if (arabic) "هذا الهاتف يرسل التذكيرات" else "Send reminders from this phone",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate800,
                    )
                    Text(
                        if (arabic) "رسائل نصية من شريحة هذا الهاتف" else "Text messages from this phone's SIM",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                    )
                }
                Switch(
                    checked = enabled,
                    onCheckedChange = onToggle,
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color.White,
                        checkedTrackColor = Alpha.Green,
                    ),
                )
            }

            if (enabled) {
                Spacer(Modifier.height(12.dp))
                Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            if (arabic) "آخر فحص" else "Last check",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Black,
                            color = Alpha.Slate400,
                        )
                        Text(
                            // The worker's own words, not a summary of them. "No mobile signal
                            // when the message was sent" is something a clinic can act on; "error"
                            // is not.
                            lastResult.ifBlank {
                                if (arabic) "لم يبدأ بعد — يفحص كل ١٥ دقيقة"
                                else "Not run yet — it checks every 15 minutes"
                            },
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate700,
                        )
                        if (lastRunAt > 0) {
                            Text(
                                SimpleDateFormat("d MMM, HH:mm", if (arabic) Locale("ar", "EG") else Locale.US)
                                    .format(Date(lastRunAt)),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                color = Alpha.Slate400,
                            )
                        }
                        if (sentTotal > 0) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                if (arabic) "أُرسلت $sentTotal رسالة من هذا الهاتف"
                                else "$sentTotal message${if (sentTotal == 1) "" else "s"} sent from this phone",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Green,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))
                Surface(shape = Alpha.CardShape, color = Color(0xFFFEF3C7), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            if (arabic) "اترك هذا الهاتف مفتوحاً ومتصلاً بالشبكة، وأوقف توفير البطارية للتطبيق."
                            else "Leave this phone on, in signal, and exclude the app from battery saver.",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF92400E),
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            if (arabic) "كل رسالة تُحتسب على رصيد الشريحة. الحرف العربي يقلل الرسالة إلى ٧٠ حرفاً."
                            else "Every message is billed to the SIM. One Arabic character cuts a text to 70 characters.",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color(0xFF92400E).copy(alpha = .85f),
                        )
                    }
                }
            }
        }
    }
}
