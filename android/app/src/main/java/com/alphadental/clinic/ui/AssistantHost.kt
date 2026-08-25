package com.alphadental.clinic.ui

import android.Manifest
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.BuildConfig
import com.alphadental.clinic.ai.AiClient
import com.alphadental.clinic.ai.ChatMessage
import com.alphadental.clinic.ai.VoiceSession
import com.alphadental.clinic.ai.VoiceSession.VoiceState
import java.io.File

/**
 * The assistant as a full page.
 *
 * It used to be a draggable bubble floating over every screen; now it opens
 * like any other page, from the Assistant shortcut on the dashboard or the More
 * tab. The voice loop lives here: tap the mic, talk, and answers come back
 * aloud; leave the page and the conversation is exactly where you left it,
 * because the transcript is kept on the phone.
 *
 * Replies that carry a generated report render an "Open PDF" card — tapping it
 * hands the file to whatever PDF viewer the phone has.
 */
@Composable
fun AssistantScreen(
    messages: List<ChatMessage>,
    thinking: Boolean,
    pending: AiClient.PendingAction?,
    speak: String?,
    arabic: Boolean,
    /** What the conversation is acting on, e.g. "Dina Samir · 9:00 AM"; null when nothing is. */
    actingOn: String?,
    onClearActingOn: () -> Unit,
    /** "Owner", "Admin", "Dentist", "Receptionist"… — picks which example questions to offer. */
    role: String,
    /** Opens the appointment a reply identified, in the normal appointment sheet. */
    onOpenAppointment: (String) -> Unit,
    onAsk: (String) -> Unit,
    onSpoken: () -> Unit,
    onSettle: (Boolean) -> Unit,
    /** Abandons the turn in flight without leaving the conversation. */
    onCancel: () -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    var voiceState by remember { mutableStateOf(VoiceState.IDLE) }
    var partial by remember { mutableStateOf("") }
    var voiceNote by remember { mutableStateOf<String?>(null) }
    var offerGoogleVoice by remember { mutableStateOf(false) }

    val session = remember {
        VoiceSession(
            context = context.applicationContext,
            onState = { voiceState = it },
            onPartial = { partial = it },
            onHeard = { onAsk(it) },
            onUnavailable = { voiceNote = it },
            onNeedGoogleVoice = { offerGoogleVoice = true },
        )
    }
    DisposableEffect(Unit) { onDispose { session.destroy() } }

    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) session.start(arabic) }

    LaunchedEffect(speak) {
        val text = speak ?: return@LaunchedEffect
        onSpoken()
        session.speak(text)
    }
    LaunchedEffect(thinking) { if (thinking) session.thinking() }

    BackHandler { onClose() }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
        ) {

            // Header: back, identity, live status.
            Row(
                Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(
                            when (voiceState) {
                                VoiceState.LISTENING -> Alpha.Green
                                VoiceState.SPEAKING -> Color(0xFF0EA5E9)
                                VoiceState.THINKING -> Color(0xFFF59E0B)
                                VoiceState.IDLE -> Alpha.Ink
                            }
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Mic, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        if (arabic) "مساعد العيادة" else "Clinic assistant",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                    )
                    Text(
                        text = when {
                            thinking -> if (arabic) "يفكر…" else "Thinking…"
                            voiceState == VoiceState.LISTENING ->
                                if (partial.isNotBlank()) "“$partial”"
                                else if (arabic) "يسمعك…" else "Listening…"
                            voiceState == VoiceState.SPEAKING -> if (arabic) "يتحدث…" else "Speaking…"
                            else -> if (arabic) "يجيب وينفذ بصلاحياتك" else "Answers and acts within your permissions"
                        },
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (voiceState == VoiceState.LISTENING) Alpha.Green else Alpha.Slate400,
                        maxLines = 1,
                    )
                }
            }

            // The appointment the chat is acting on. On the website this is a
            // visible panel; on the phone this chip is that visibility — and its X
            // is the way out of acting mode.
            if (actingOn != null) {
                Surface(
                    shape = Alpha.PillShape,
                    color = Alpha.GreenSoft,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 3.dp, bottom = 3.dp),
                    ) {
                        Text(
                            (if (arabic) "يعمل على: " else "Acting on: ") + actingOn.ifBlank { if (arabic) "موعد" else "an appointment" },
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Green,
                            maxLines = 1,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        IconButton(onClick = onClearActingOn, modifier = Modifier.size(28.dp)) {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = if (arabic) "إلغاء" else "Stop acting on it",
                                tint = Alpha.Green,
                                modifier = Modifier.size(14.dp),
                            )
                        }
                    }
                }
            }

            voiceNote?.let { note ->
                Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.WarnBg,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                ) {
                    Text(
                        note,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.WarnText,
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }

            // The one voice problem a user can fix themselves, turned into the one tap
            // that fixes it: phones without Google's voice engine cannot read replies aloud.
            if (offerGoogleVoice) {
                Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.WarnBg,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            if (arabic)
                                "هذا الهاتف لا يحتوي على صوت جوجل، لذلك لا يمكن قراءة الردود صوتياً. تثبيته مجاني."
                            else
                                "This phone is missing Google's voice, so replies cannot be read aloud. Installing it is free.",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.WarnText,
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = {
                                offerGoogleVoice = false
                                openPlayStore(context, "com.google.android.tts")
                            },
                            shape = Alpha.CardShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Alpha.Ink,
                                contentColor = Color.White,
                            ),
                        ) {
                            Text(
                                if (arabic) "تثبيت صوت جوجل" else "Install Google voice",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
            }

            val listState = rememberLazyListState()
            LaunchedEffect(messages.size, pending) {
                if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (messages.isEmpty()) {
                    item { EmptyChat(arabic, role, onAsk) }
                }
                items(messages) { message -> ChatBubbleRow(message, arabic, onOpenAppointment) }

                // The approval card — answerable by voice too: a plain spoken yes or no settles it.
                pending?.let { action ->
                    item { PendingCard(action, arabic, enabled = !thinking, onSettle = onSettle) }
                }

                if (thinking) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(
                                color = Alpha.Slate400,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.size(8.dp))
                            Text(
                                if (arabic) "لحظة…" else "One moment…",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate400,
                            )
                            Spacer(Modifier.size(4.dp))
                            // The way out of a turn that is taking too long. Without it
                            // the only escape from a slow answer was to close the app.
                            TextButton(onClick = onCancel) {
                                Text(
                                    if (arabic) "إيقاف" else "Stop",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate600,
                                )
                            }
                        }
                    }
                }
            }

            // Input bar.
            var typed by remember { mutableStateOf("") }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { typed = it },
                    placeholder = {
                        Text(if (arabic) "اسأل أو اطلب…" else "Ask or request…", fontSize = 13.sp, color = Alpha.Slate400)
                    },
                    shape = Alpha.PillShape,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Alpha.Green,
                        unfocusedBorderColor = if (Alpha.dark) Alpha.Slate100 else Color.Transparent,
                        focusedContainerColor = Alpha.Card,
                        unfocusedContainerColor = Alpha.Card,
                        cursorColor = Alpha.Ink,
                    ),
                    modifier = Modifier.weight(1f),
                    maxLines = 3,
                )
                if (typed.isNotBlank()) {
                    IconButton(
                        onClick = {
                            onAsk(typed.trim())
                            typed = ""
                        },
                        // A question asked while a turn is in flight is dropped on the
                        // floor, and the box emptying made it look like it had been
                        // sent — the surest way to make a busy assistant feel dead.
                        // The approval card already greys itself out the same way.
                        enabled = !thinking,
                    ) {
                        Icon(
                            Icons.Filled.Send,
                            contentDescription = "Send",
                            tint = if (thinking) Alpha.Slate400 else Alpha.Green,
                        )
                    }
                }
                Spacer(Modifier.size(4.dp))

                // The mic is also the interrupt: tapping while it listens or speaks stops the loop.
                val active = voiceState == VoiceState.LISTENING || voiceState == VoiceState.SPEAKING
                Box(
                    Modifier
                        .size(48.dp)
                        .background(if (active) Color(0xFFE11D48) else Alpha.Ink, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    IconButton(onClick = {
                        if (active) session.stop() else micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    }) {
                        Icon(
                            if (active) Icons.Filled.Stop else Icons.Filled.Mic,
                            contentDescription = if (arabic) "ميكروفون" else "Microphone",
                            tint = Color.White,
                        )
                    }
                }
            }
        }
    }
}

/**
 * What the assistant can do, as tappable examples rather than a paragraph.
 *
 * Picked per role: an owner opens this asking about money, reception about the
 * floor, a dentist about their own chair — the same three chips for everyone
 * taught each of them the wrong things to ask.
 */
@Composable
private fun EmptyChat(arabic: Boolean, role: String, onAsk: (String) -> Unit) {
    val suggestions = when (role) {
        "Admin", "Owner" -> if (arabic) listOf(
            "كم حصّلنا هذا الأسبوع؟",
            "تقرير مالي PDF عن هذا الشهر",
            "مين محجوز اليوم؟",
        ) else listOf(
            "How much did we collect this week?",
            "Finance PDF for this month",
            "Who is booked today?",
        )
        "Dentist" -> if (arabic) listOf(
            "مين التالي عندي؟",
            "افتح جدول اليوم",
            "إيه آخر علاج اتعمل لمريضي الجاي؟",
        ) else listOf(
            "Who is next for me?",
            "Open the day view",
            "What was my next patient's last treatment?",
        )
        else -> if (arabic) listOf(
            "مين في الانتظار دلوقتي؟",
            "ألغِ موعد مريض",
            "افتح العملاء المحتملين",
        ) else listOf(
            "Who is waiting right now?",
            "Cancel a patient's appointment",
            "Open the leads inbox",
        )
    }
    Column(Modifier.padding(top = 12.dp)) {
        Text(
            if (arabic)
                "اسأل عن المواعيد أو حساب مريض، اطلب حجزاً، أو اطلب تقريراً مالياً PDF جاهزاً للمشاركة."
            else
                "Ask about appointments or a patient's balance, tell it to book someone in, or ask for a finance PDF ready to share.",
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = Alpha.Slate500,
        )
        Spacer(Modifier.height(14.dp))
        suggestions.forEach { suggestion ->
            Surface(
                onClick = { onAsk(suggestion) },
                shape = Alpha.PillShape,
                color = Alpha.Card,
                modifier = Modifier.padding(bottom = 8.dp),
            ) {
                Text(
                    suggestion,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Green,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                )
            }
        }
    }
}

private fun openPlayStore(context: Context, packageName: String) {
    val market = android.content.Intent(
        android.content.Intent.ACTION_VIEW,
        android.net.Uri.parse("market://details?id=$packageName"),
    ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(market)
    } catch (e: android.content.ActivityNotFoundException) {
        runCatching {
            context.startActivity(
                android.content.Intent(
                    android.content.Intent.ACTION_VIEW,
                    android.net.Uri.parse("https://play.google.com/store/apps/details?id=$packageName"),
                ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }
}

@Composable
private fun ChatBubbleRow(
    message: ChatMessage,
    arabic: Boolean,
    onOpenAppointment: (String) -> Unit,
) {
    val context = LocalContext.current
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (message.fromUser) Alignment.End else Alignment.Start) {
            Surface(
                shape = Alpha.CardShape,
                color = if (message.fromUser) Alpha.Ink else Alpha.Card,
                modifier = Modifier.widthIn(max = 300.dp),
            ) {
                Text(
                    message.text,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (message.fromUser) Color.White else Alpha.Slate800,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }

            // The appointment the reply identified: a real way in, not a sentence.
            message.appointmentId?.let { appointmentId ->
                Spacer(Modifier.height(6.dp))
                Surface(
                    onClick = { onOpenAppointment(appointmentId) },
                    shape = Alpha.CardShape,
                    color = Alpha.GreenSoft,
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    ) {
                        Icon(
                            Icons.Filled.CalendarMonth,
                            contentDescription = null,
                            tint = Alpha.Green,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(9.dp))
                        Text(
                            if (arabic) "فتح الموعد" else "Open the appointment",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Green,
                        )
                    }
                }
            }

            // The report the reply carries, if its file is still on this phone.
            // Remembered per path: this is a disk hit, and it used to run for every
            // message in the transcript on every single recomposition — including
            // while someone was typing into the box below.
            val pdf = remember(message.pdfPath) {
                message.pdfPath?.let(::File)?.takeIf { it.exists() }
            }
            if (pdf != null) {
                Spacer(Modifier.height(6.dp))
                Surface(shape = Alpha.CardShape, color = Alpha.GreenSoft) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(Alpha.CardShape)
                                .clickable { openPdf(context, pdf) },
                        ) {
                            Icon(
                                Icons.Filled.PictureAsPdf,
                                contentDescription = null,
                                tint = Alpha.Green,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(Modifier.width(9.dp))
                            Text(
                                if (arabic) "فتح التقرير PDF" else "Open the PDF report",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Green,
                            )
                        }
                        // The rest of the report's life: paper, or someone's WhatsApp.
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            PdfAction(if (arabic) "طباعة" else "Print", Icons.Filled.Print) {
                                DocumentActions.print(context, pdf, "Finance report")
                            }
                            PdfAction(if (arabic) "مشاركة" else "Share", Icons.Filled.Share) {
                                DocumentActions.share(context, pdf, "Finance report")
                            }
                            PdfAction("WhatsApp", Icons.Filled.Chat) {
                                DocumentActions.shareToWhatsapp(context, pdf, "Finance report")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfAction(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    Surface(onClick = onClick, shape = Alpha.PillShape, color = Alpha.Card) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
        ) {
            Icon(icon, contentDescription = null, tint = Alpha.Slate600, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(5.dp))
            Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate600)
        }
    }
}

/** Hands the file to whatever viewer the user picks; the grant covers only this file. */
private fun openPdf(context: Context, file: File) {
    runCatching {
        val uri = androidx.core.content.FileProvider.getUriForFile(
            context,
            BuildConfig.APPLICATION_ID + ".files",
            file,
        )
        val view = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            addFlags(
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK
            )
        }
        context.startActivity(
            android.content.Intent.createChooser(view, file.name)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}

@Composable
private fun PendingCard(
    action: AiClient.PendingAction,
    arabic: Boolean,
    enabled: Boolean,
    onSettle: (Boolean) -> Unit,
) {
    Surface(shape = Alpha.CardShape, color = Alpha.WarnBg, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(
                action.title,
                fontSize = 14.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.WarnText,
            )
            action.lines.forEach { line ->
                Text(
                    line,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate700,
                    modifier = Modifier.padding(top = 3.dp),
                )
            }
            action.note?.let {
                Text(
                    it,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate500,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }

            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { onSettle(true) },
                    enabled = enabled,
                    shape = Alpha.CardShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Alpha.Green,
                        contentColor = Color.White,
                    ),
                    modifier = Modifier.weight(1f),
                ) {
                    Text(
                        if (arabic) "تأكيد" else "Approve",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
                OutlinedButton(
                    onClick = { onSettle(false) },
                    enabled = enabled,
                    shape = Alpha.CardShape,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(
                        if (arabic) "إلغاء" else "Reject",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Danger,
                    )
                }
            }
        }
    }
}
