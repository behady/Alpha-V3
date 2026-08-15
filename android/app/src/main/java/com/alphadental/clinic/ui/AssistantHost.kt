package com.alphadental.clinic.ui

import android.Manifest
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.AiClient
import com.alphadental.clinic.ai.ChatMessage
import com.alphadental.clinic.ai.VoiceSession
import com.alphadental.clinic.ai.VoiceSession.VoiceState
import kotlin.math.roundToInt

/**
 * The assistant as a real chat bubble.
 *
 * Collapsed, it is a draggable bubble floating over every screen. Tapped, it expands IN PLACE
 * into a floating chat window over whatever was being done — the page behind stays where it was,
 * and a tap outside (or the chevron, or back) collapses the chat to a bubble again. It never
 * navigates anywhere: that distinction is the entire difference between a chat bubble and a
 * button that opens a page.
 *
 * The voice loop lives HERE, in the host, not in the window. That is deliberate and it is the
 * best part of the design: collapse the chat mid-conversation and the assistant keeps listening,
 * keeps answering aloud, keeps waiting for the next thing — while you look at the Day screen it
 * just told you about. The bubble's colour is the loop's state: green while it listens, dark
 * otherwise.
 */
@Composable
fun BoxScope.AssistantHost(
    expanded: Boolean,
    messages: List<ChatMessage>,
    thinking: Boolean,
    pending: AiClient.PendingAction?,
    speak: String?,
    arabic: Boolean,
    onAsk: (String) -> Unit,
    onSpoken: () -> Unit,
    onSettle: (Boolean) -> Unit,
    onExpand: () -> Unit,
    onCollapse: () -> Unit,
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

    // The reply loop's forward edge: answers are spoken whether the chat is open or collapsed —
    // a hands-free assistant that goes mute when its window closes is not hands-free.
    LaunchedEffect(speak) {
        val text = speak ?: return@LaunchedEffect
        onSpoken()
        session.speak(text)
    }
    LaunchedEffect(thinking) { if (thinking) session.thinking() }

    if (expanded) {
        BackHandler { onCollapse() }

        // Dim what is behind, and let a tap on it collapse the chat. The page underneath stays
        // exactly where it was.
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0x66101820))
                .clickable(onClick = onCollapse)
        )

        Surface(
            shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = 22.dp, bottomEnd = 22.dp),
            color = Alpha.Ground,
            shadowElevation = 16.dp,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 10.dp)
                .padding(bottom = 8.dp)
                .fillMaxWidth()
                .fillMaxHeight(0.74f)
                .imePadding(),
        ) {
            ChatWindow(
                messages = messages,
                thinking = thinking,
                pending = pending,
                arabic = arabic,
                voiceState = voiceState,
                partial = partial,
                voiceNote = voiceNote,
                offerGoogleVoice = offerGoogleVoice,
                onDismissGoogleVoice = { offerGoogleVoice = false },
                onAsk = onAsk,
                onSettle = onSettle,
                onCollapse = onCollapse,
                onMic = {
                    if (voiceState == VoiceState.LISTENING || voiceState == VoiceState.SPEAKING) {
                        session.stop()
                    } else {
                        micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
            )
        }
    } else {
        Bubble(
            voiceState = voiceState,
            onTap = onExpand,
        )
    }
}

/**
 * The collapsed state: a draggable bubble whose colour is the voice loop's state.
 *
 * Where it is dragged is remembered on the phone — a bubble that snaps home every morning
 * teaches people it cannot be moved at all.
 */
@Composable
private fun BoxScope.Bubble(
    voiceState: VoiceState,
    onTap: () -> Unit,
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current

    val prefs = remember { context.getSharedPreferences("alpha_ui", Context.MODE_PRIVATE) }
    var offset by remember {
        mutableStateOf(Offset(prefs.getFloat("bubble_dx", 0f), prefs.getFloat("bubble_dy", 0f)))
    }

    // Anchored bottom-end, so dragging runs negative (left and up), clamped to the screen.
    val maxLeft = with(density) { (configuration.screenWidthDp.dp - 76.dp).toPx() }
    val maxUp = with(density) { (configuration.screenHeightDp.dp - 220.dp).toPx() }

    Surface(
        shape = CircleShape,
        color = when (voiceState) {
            VoiceState.LISTENING -> Alpha.Green
            VoiceState.SPEAKING -> Color(0xFF0EA5E9)
            VoiceState.THINKING -> Color(0xFFF59E0B)
            VoiceState.IDLE -> Alpha.Ink
        },
        shadowElevation = 8.dp,
        modifier = Modifier
            .align(Alignment.BottomEnd)
            // Above the Day tab's booking button, which owns the default corner.
            .padding(end = 16.dp, bottom = 92.dp)
            .offset { IntOffset(offset.x.roundToInt(), offset.y.roundToInt()) }
            .size(54.dp)
            .pointerInput(maxLeft, maxUp) {
                detectDragGestures(
                    onDrag = { change, amount ->
                        change.consume()
                        offset = Offset(
                            (offset.x + amount.x).coerceIn(-maxLeft, 0f),
                            (offset.y + amount.y).coerceIn(-maxUp, 0f),
                        )
                    },
                    onDragEnd = {
                        prefs.edit()
                            .putFloat("bubble_dx", offset.x)
                            .putFloat("bubble_dy", offset.y)
                            .apply()
                    },
                )
            }
            .clip(CircleShape)
            .clickable(onClick = onTap),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Filled.Mic,
                contentDescription = "Assistant",
                tint = Color.White,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}

@Composable
private fun ChatWindow(
    messages: List<ChatMessage>,
    thinking: Boolean,
    pending: AiClient.PendingAction?,
    arabic: Boolean,
    voiceState: VoiceState,
    partial: String,
    voiceNote: String?,
    offerGoogleVoice: Boolean,
    onDismissGoogleVoice: () -> Unit,
    onAsk: (String) -> Unit,
    onSettle: (Boolean) -> Unit,
    onCollapse: () -> Unit,
    onMic: () -> Unit,
) {
    val context = LocalContext.current
    var typed by remember { mutableStateOf("") }

    val listState = rememberLazyListState()
    LaunchedEffect(messages.size, pending) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Column(Modifier.fillMaxSize()) {

        Row(
            Modifier.padding(start = 16.dp, end = 4.dp, top = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    if (arabic) "مساعد العيادة" else "Clinic assistant",
                    fontSize = 15.sp,
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
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (voiceState == VoiceState.LISTENING) Alpha.Green else Alpha.Slate400,
                    maxLines = 1,
                )
            }
            IconButton(onClick = onCollapse) {
                Icon(Icons.Filled.Close, contentDescription = "Minimise", tint = Alpha.Slate500)
            }
        }

        voiceNote?.let { note ->
            Surface(
                shape = Alpha.CardShape,
                color = Color(0xFFFEF3C7),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
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

        // The one voice problem a user can fix themselves, turned into the one tap that fixes
        // it: phones without Google's voice engine cannot read replies aloud.
        if (offerGoogleVoice) {
            Surface(
                shape = Alpha.CardShape,
                color = Color(0xFFFEF3C7),
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
                        color = Color(0xFF92400E),
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            onDismissGoogleVoice()
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
                            fontWeight = FontWeight.Black,
                        )
                    }
                }
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (messages.isEmpty()) {
                item {
                    Text(
                        if (arabic)
                            "اسأل عن مواعيد اليوم، حساب مريض، أو اطلب حجز موعد — المساعد يجيب وينفذ بصلاحياتك."
                        else
                            "Ask about today's appointments, a patient's balance, or tell it to book someone in — it answers and acts within your permissions.",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
            }
            items(messages) { message -> ChatBubbleRow(message) }

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
                    }
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
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

            // The mic is also the interrupt: tapping while it listens or speaks stops the loop.
            val active = voiceState == VoiceState.LISTENING || voiceState == VoiceState.SPEAKING
            Box(
                Modifier
                    .size(50.dp)
                    .background(if (active) Color(0xFFE11D48) else Alpha.Ink, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                IconButton(onClick = onMic) {
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

/**
 * Play Store first, browser second — a phone without the Play Store (rare, but clinic tablets
 * exist) still lands somewhere it can act.
 */
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
private fun ChatBubbleRow(message: ChatMessage) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.fromUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            shape = Alpha.CardShape,
            color = if (message.fromUser) Alpha.Ink else Alpha.Card,
            modifier = Modifier.widthIn(max = 290.dp),
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
