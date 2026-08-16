package com.alphadental.clinic.ui

import android.content.ActivityNotFoundException
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Repository

/**
 * The clinic's WhatsApp to-send list.
 *
 * WhatsApp gives no way for another app to send a message on the clinic's behalf — the only thing
 * possible is opening WhatsApp with the chat and the text ready, and a person taps send. Automating
 * that tap needs an accessibility service, violates WhatsApp's terms, and gets the clinic's number
 * banned along with every conversation in it. So the tap stays human.
 *
 * What the system does instead is everything either side of the tap: work out who needs messaging,
 * write the body from the clinic's template, skip anyone who opted out, and remember what has
 * already gone. Twelve reminders becomes a minute of tapping rather than twelve patient lookups.
 *
 * The list is live. Two people can work through it on different phones and rows disappear as they
 * are sent, because the alternative is a patient hearing the same thing twice from two staff.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhatsappQueueSheet(
    queue: List<Repository.PendingWhatsapp>,
    arabic: Boolean,
    onSend: (Repository.PendingWhatsapp) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Text(
                if (arabic) "رسائل واتساب للإرسال" else "WhatsApp messages to send",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Text(
                if (arabic)
                    "جهّز النظام هذه الرسائل. اضغط «إرسال» ليفتح واتساب والرسالة مكتوبة، ثم اضغط زر الإرسال داخل واتساب."
                else
                    "The system wrote these. Tap Send to open WhatsApp with the message ready, then press send inside WhatsApp.",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate500,
                modifier = Modifier.padding(top = 6.dp),
            )

            Spacer(Modifier.height(16.dp))

            if (queue.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(vertical = 36.dp), contentAlignment = Alignment.Center) {
                    Text(
                        if (arabic) "لا توجد رسائل في الانتظار." else "Nothing waiting to be sent.",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate400,
                    )
                }
            } else {
                LazyColumn(
                    Modifier.heightIn(max = 460.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(queue, key = { it.id }) { message ->
                        Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp)) {
                                Text(
                                    message.patientName.ifBlank { message.to },
                                    fontSize = 14.5.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Alpha.Slate900,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    message.text,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = Alpha.Slate500,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 4.dp),
                                )

                                Row(
                                    Modifier.fillMaxWidth().padding(top = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        message.to,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate400,
                                        modifier = Modifier.weight(1f),
                                    )
                                    // "Mark as sent without opening WhatsApp" — for a patient the
                                    // clinic has already phoned, or one they decide not to message.
                                    // Without it the only way to clear a row is to send something.
                                    TextButton(onClick = { onSend(message) }) {
                                        Text(
                                            if (arabic) "تخطٍّ" else "Skip",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Alpha.Slate400,
                                        )
                                    }
                                    TextButton(
                                        onClick = {
                                            val opened = openWhatsApp(context, message.to, message.text)
                                            // Only cleared when WhatsApp actually opened. If it is
                                            // not installed, the row has to stay — marking it sent
                                            // would quietly lose a message the patient never got.
                                            if (opened) onSend(message)
                                        }
                                    ) {
                                        Icon(
                                            Icons.Filled.Send,
                                            contentDescription = null,
                                            tint = Color(0xFF25D366),
                                            modifier = Modifier.size(16.dp),
                                        )
                                        Spacer(Modifier.size(6.dp))
                                        Text(
                                            if (arabic) "إرسال" else "Send",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            color = Color(0xFF128C7E),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Open WhatsApp with the chat and message ready.
 *
 * `wa.me` is WhatsApp's own documented link format and works whether the clinic has WhatsApp or
 * WhatsApp Business installed, which is why it is used rather than targeting a package name.
 * The number must be plain international digits with no plus sign or separators.
 *
 * Returns false when nothing could handle the link — WhatsApp not installed, or no browser to fall
 * back to. The caller uses that to leave the message in the list.
 */
private fun openWhatsApp(context: Context, phone: String, text: String): Boolean {
    val digits = phone.filter { it.isDigit() }
    if (digits.isBlank()) return false

    val uri = Uri.parse("https://wa.me/$digits?text=${Uri.encode(text)}")

    // Sent to WhatsApp by name — regular first, then Business — never to "whatever handles the
    // link". The generic intent falls through to a browser when WhatsApp is not installed, and a
    // phone browser on wa.me is a dead end ("use the app") — yet the message would already have
    // been marked as sent, silently lost. If neither app is installed the row stays in the list,
    // which is the honest outcome.
    for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
        val intent = Intent(Intent.ACTION_VIEW, uri)
            .setPackage(pkg)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            return true
        } catch (e: ActivityNotFoundException) {
            // Try the next package.
        }
    }
    return false
}
