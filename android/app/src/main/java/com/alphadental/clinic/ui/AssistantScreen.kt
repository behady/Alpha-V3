package com.alphadental.clinic.ui

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import com.alphadental.clinic.ai.AiClient
import com.alphadental.clinic.ai.ChatMessage
import com.alphadental.clinic.ai.VoiceSession
import com.alphadental.clinic.ai.VoiceSession.VoiceState

/**
 * The assistant, full screen.
 *
 * Built voice-first: the mic is the biggest control, the loop is hands-free, and every reply is
 * spoken as well as shown. The keyboard path stays because a reception desk is a loud place —
 * typing is the fallback, not the point.
 *
 * The transcript never clears itself. It is loaded from disk when the screen opens and every turn
 * is written back, so the conversation picks up where it stopped — across app restarts, and
 * across the assistant being closed to go do the thing it just helped with.
 */
@Composable
fun AssistantScreen(
    messages: List<ChatMessage>,
    thinking: Boolean,
    pending: AiClient.PendingAction?,
    speak: String?,
    arabic: Boolean,
    onAsk: (String) -> Unit,
    onSpoken: () -> Unit,
    onSettle: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    var voiceState by remember { mutableStateOf(VoiceState.IDLE) }
    var partial by remember { mutableStateOf("") }
    var voiceNote by remember { mutableStateOf<String?>(null) }
    var typed by remember { mutableStateOf("") }

    val session = remember {
        VoiceSession(
            context = context.applicationContext,
            onState = { voiceState = it },
            onPartial = { partial = it },
            onHeard = { onAsk(it) },
            onUnavailable = { voiceNote = it },
        )
    }
    DisposableEffect(Unit) { onDispose { session.destroy() } }

    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) session.start(arabic) }

    // The reply loop: a new answer arrives, gets spoken, and — in hands-free mode — the mic
    // reopens by itself when the voice finishes. This effect is that loop's forward edge.
    LaunchedEffect(speak) {
        val text = speak ?: return@LaunchedEffect
        onSpoken()
        session.speak(text)
    }
    LaunchedEffect(thinking) { if (thinking) session.thinking() }

    BackHandler { onClose() }

    val listState = rememberLazyListState()
    LaunchedEffect(messages.size, pending) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {

            Row(
                Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (arabic) "مساعد العيادة" else "Clinic assistant",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate900,
                    )
                    Text(
                        text = when {
                            thinking -> if (arabic) "يفكر…" else "Thinking…"
                            voiceState == VoiceState.LISTENING ->
                                if (partial.isNotBlank()) "“$partial”"
                                else if (arabic) "يسمعك…" else "Listening…"
                            voiceState == VoiceState.SPEAKING -> if (arabic) "يتحدث…" else "Speaking…"
                            else -> if (arabic) "اضغط الميكروفون وتكلم" else "Tap the mic and talk"
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (voiceState == VoiceState.LISTENING) Alpha.Green else Alpha.Slate400,
                        maxLines = 1,
                    )
                }
            }

            voiceNote?.let { note ->
                Surface(
                    shape = Alpha.CardShape,
                    color = Color(0xFFFEF3C7),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                ) {
                    Text(
                        note,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF92400E),
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (messages.isEmpty()) {
                    item {
                        Text(
                            if (arabic)
                                "اسأل عن مواعيد اليوم، حساب مريض، أو اطلب حجز موعد — المساعد يجيب ويتصرف حسب صلاحياتك."
                            else
                                "Ask about today's appointments, a patient's balance, or tell it to book someone in — it answers and acts within your permissions.",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                            modifier = Modifier.padding(top = 24.dp),
                        )
                    }
                }
                items(messages) { message -> ChatBubble(message) }

                // The approval card. Shown inline, and answerable by voice — a plain yes or no
                // spoken into the open mic settles it without a tap.
                pending?.let { action ->
                    item {
                        PendingCard(action, arabic, enabled = !thinking, onSettle = onSettle)
                    }
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
                        }
                    }
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { typed = it },
                    placeholder = {
                        Text(if (arabic) "أو اكتب هنا…" else "Or type here…", fontSize = 13.sp)
                    },
                    shape = Alpha.CardShape,
                    modifier = Modifier.weight(1f),
                    maxLines = 3,
                )
                if (typed.isNotBlank()) {
                    IconButton(onClick = {
                        onAsk(typed.trim())
                        typed = ""
                    }) {
                        Icon(Icons.Filled.Send, contentDescription = "Send", tint = Alpha.Green)
                    }
                }
                Spacer(Modifier.size(4.dp))

                // The mic is also the interrupt: tapping while it listens or speaks stops the
                // loop, which is the only sane meaning of pressing a live microphone.
                val active = voiceState == VoiceState.LISTENING || voiceState == VoiceState.SPEAKING
                Box(
                    Modifier
                        .size(56.dp)
                        .background(
                            if (active) Color(0xFFE11D48) else Alpha.Ink,
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    IconButton(onClick = {
                        if (active) {
                            session.stop()
                        } else {
                            micPermission.launch(Manifest.permission.RECORD_AUDIO)
                        }
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

@Composable
private fun ChatBubble(message: ChatMessage) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start,
    ) {
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
    }
}

@Composable
private fun PendingCard(
    action: AiClient.PendingAction,
    arabic: Boolean,
    enabled: Boolean,
    onSettle: (Boolean) -> Unit,
) {
    Surface(shape = Alpha.CardShape, color = Color(0xFFFFF7ED), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(
                action.title,
                fontSize = 14.sp,
                fontWeight = FontWeight.Black,
                color = Color(0xFF9A3412),
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
                        fontWeight = FontWeight.Black,
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
                        fontWeight = FontWeight.Black,
                        color = Color(0xFFE11D48),
                    )
                }
            }
        }
    }
}
