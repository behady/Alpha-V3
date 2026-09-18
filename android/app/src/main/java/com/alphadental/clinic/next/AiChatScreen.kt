package com.alphadental.clinic.next

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.AiClient
import com.alphadental.clinic.ai.ChatMessage
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * Talking to the assistant.
 *
 * A conversation, not a console: what somebody typed sits on the right in the clinic's dark slab,
 * what came back sits on the left in plain paper. Nothing here is clever — the whole screen is a
 * list, a box and a button — and that is the point. The intelligence is on the server, and every
 * pixel spent decorating the client is a pixel that makes an answer harder to read.
 *
 * The four openers at the top are there for the emptiest moment: a blank chat with a cursor in it
 * is a question about what the thing can do, and four real sentences answer it faster than a
 * paragraph explaining.
 */
@Composable
fun AiChatScreen(
    state: AiChat,
    onType: (String) -> Unit,
    onSend: () -> Unit,
    onAsk: (String) -> Unit,
    onAnswer: (Boolean) -> Unit,
    onClear: () -> Unit,
    onScans: () -> Unit,
    onBack: () -> Unit,
) {
    val listState = rememberLazyListState()

    // Follow the conversation down as it grows. Both keys matter: a new message, and the
    // "thinking" row appearing under it.
    LaunchedEffect(state.messages.size, state.thinking) {
        val last = state.messages.size + if (state.thinking) 1 else 0
        if (last > 0) listState.animateScrollToItem(last)
    }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Assistant",
            eyebrow = "Ask about this clinic",
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                SlabIcon(Icons.Filled.AutoAwesome, "Scans and reports", onClick = onScans)
                if (state.messages.isNotEmpty()) {
                    Spacer(Modifier.width(8.dp))
                    SlabIcon(Icons.Filled.DeleteSweep, "Clear this conversation", onClick = onClear)
                }
            },
        )

        state.error?.let { message ->
            Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                Txt(message, Type.caption, T.danger, Modifier.padding(T.gutter), maxLines = 4)
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.messages.isEmpty() && !state.loading) {
                item { Openers(onAsk) }
            }

            items(state.messages.size) { i -> Bubble(state.messages[i]) }

            if (state.thinking) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = T.gutter),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(
                            color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(15.dp),
                        )
                        Spacer(Modifier.width(10.dp))
                        Txt("Thinking…", Type.caption, T.inkMuted)
                    }
                }
            }

            state.pending?.let { action -> item { Approval(action, state.confirming, onAnswer) } }
        }

        Composer(state, onType, onSend)
    }
}

/**
 * What to ask, when the box is empty.
 *
 * Four questions the assistant genuinely answers well, phrased the way somebody would say them
 * out loud rather than as commands.
 */
@Composable
private fun Openers(onAsk: (String) -> Unit) {
    val suggestions = listOf(
        "What does today look like?",
        "Who owes us the most money?",
        "How much did we take this week?",
        "Who has not been in for six months?",
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 24.dp)) {
        Txt("Ask me anything about the clinic", Type.heading, T.ink, maxLines = 2)
        Spacer(Modifier.height(4.dp))
        Txt(
            "I can see the diary, the register and the books. Each answer costs one AI credit.",
            Type.caption, T.inkMuted, maxLines = 3,
        )
        Spacer(Modifier.height(16.dp))
        suggestions.forEach { question ->
            Surface(
                shape = T.card,
                color = T.surface,
                border = BorderStroke(1.dp, T.line),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .clickable { onAsk(question) },
            ) {
                Txt(question, Type.body, T.ink, Modifier.padding(16.dp), maxLines = 2)
            }
        }
    }
}

@Composable
private fun Bubble(message: ChatMessage) {
    val mine = message.fromUser
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            // Squared off on the side it comes from, which is what makes a column of bubbles read
            // as two people rather than a list of boxes.
            shape = RoundedCornerShape(
                topStart = 18.dp, topEnd = 18.dp,
                bottomStart = if (mine) 18.dp else 4.dp,
                bottomEnd = if (mine) 4.dp else 18.dp,
            ),
            color = if (mine) T.slab else T.surface,
            border = if (mine) null else BorderStroke(1.dp, T.line),
            modifier = Modifier.fillMaxWidth(0.86f),
        ) {
            Txt(
                message.text,
                Type.body,
                if (mine) T.onSlab else T.ink,
                Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                maxLines = 60,
            )
        }
    }
}

/**
 * Something the assistant wants to do, waiting on a yes.
 *
 * Every line of what it proposes is shown, because approving a summary is not approving anything.
 * Only the action's id goes back to the server, which then carries out what it recorded at the
 * moment it asked — never a fresh reading of the request.
 */
@Composable
private fun Approval(
    action: AiClient.PendingAction,
    busy: Boolean,
    onAnswer: (Boolean) -> Unit,
) {
    Surface(
        shape = T.card,
        color = T.accentTint,
        border = BorderStroke(1.dp, T.accent),
        modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter),
    ) {
        Column(Modifier.padding(18.dp)) {
            Txt("Needs your approval", Type.eyebrow, T.accentInk, uppercase = true)
            Spacer(Modifier.height(8.dp))
            Txt(action.title, Type.rowName, T.ink, maxLines = 3)
            action.lines.forEach { line ->
                Spacer(Modifier.height(4.dp))
                Txt(line, Type.caption, T.inkMuted, maxLines = 3)
            }
            action.note?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(8.dp))
                Txt(it, Type.caption, T.inkFaint, maxLines = 4)
            }
            Spacer(Modifier.height(16.dp))
            if (busy) {
                CircularProgressIndicator(
                    color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(18.dp),
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SettingsPill("Do it", solid = true) { onAnswer(true) }
                    SettingsPill("No") { onAnswer(false) }
                }
            }
        }
    }
}

@Composable
private fun Composer(state: AiChat, onType: (String) -> Unit, onSend: () -> Unit) {
    Surface(color = T.surface, shadowElevation = 12.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = T.gutter, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = state.draft,
                onValueChange = onType,
                placeholder = { Txt("Ask about the clinic…", Type.body, T.inkFaint) },
                shape = T.pill,
                maxLines = 4,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = T.surfaceSoft,
                    unfocusedContainerColor = T.surfaceSoft,
                    focusedTextColor = T.ink,
                    unfocusedTextColor = T.ink,
                    focusedIndicatorColor = T.lineStrong,
                    unfocusedIndicatorColor = T.line,
                    cursorColor = T.ink,
                ),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(10.dp))
            Box(
                Modifier
                    .size(46.dp)
                    .background(if (state.ready) T.slab else T.line, CircleShape)
                    .clickable(enabled = state.ready, onClick = onSend),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send, "Send",
                    tint = if (state.ready) T.onSlab else T.inkFaint,
                    modifier = Modifier.size(19.dp),
                )
            }
        }
    }
}

/** A pill in the assistant's own weight, kept here so the chat owns its own buttons. */
@Composable
private fun SettingsPill(label: String, solid: Boolean = false, onClick: () -> Unit) {
    Surface(
        shape = T.pill,
        color = if (solid) T.slab else T.surface,
        border = if (solid) null else BorderStroke(1.dp, T.line),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Txt(
            label,
            Type.label.copy(fontSize = 12.sp, fontWeight = FontWeight.Bold),
            if (solid) T.onSlab else T.inkMuted,
            Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
        )
    }
}
