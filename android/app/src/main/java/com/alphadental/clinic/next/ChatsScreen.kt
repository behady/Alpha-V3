package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Line
import com.alphadental.clinic.next.data.Thread
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * The WhatsApp inbox.
 *
 * A queue, not a mailbox. It opens on the threads the bot handed over and nobody
 * has picked up, because that is the only part of it that is anybody's job —
 * everything else the bot is already handling.
 *
 * **Read only.** Replying goes through the clinic's live channel, where a wrong
 * message costs real money and a wrong recipient risks the number being banned.
 * That is a decision to take deliberately, not a feature to slip in.
 */
@Composable
fun ChatsScreen(
    state: Chats,
    onFilter: (Inbox) -> Unit,
    onOpen: (Thread) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "WhatsApp",
            eyebrow = if (state.waiting.isEmpty()) "The bot is handling everything" else "Waiting for a person",
            stats = listOf(
                Stat("Waiting", state.waiting.size.toString()),
                Stat("Unread", state.unread.toString()),
                Stat("Threads", state.threads.count { !it.archived }.toString()),
            ),
        )

        Filters(state.filter, state.waiting.size, onFilter)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            state.shown.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) {
                Txt(emptyLine(state), Type.body, T.inkFaint, maxLines = 3)
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                item {
                    RowGroup {
                        state.shown.forEachIndexed { i, thread ->
                            if (i > 0) Rule()
                            ThreadRow(thread) { onOpen(thread) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Filters(current: Inbox, waiting: Int, onFilter: (Inbox) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.padding(horizontal = T.gutter, vertical = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Inbox.entries.forEach { tab ->
                    val selected = tab == current
                    val label = if (tab == Inbox.Waiting && waiting > 0) "Waiting · $waiting" else tab.label
                    Surface(
                        shape = T.pill,
                        color = if (selected) T.slab else T.surface,
                        border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onFilter(tab) },
                    ) {
                        Txt(
                            label,
                            Type.label.copy(fontSize = 12.sp),
                            if (selected) T.onSlab else T.inkMuted,
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }
            Rule()
        }
    }
}

/**
 * One conversation in the queue.
 *
 * The leading stripe means "somebody has to answer this" — red when the bot
 * flagged it urgent, amber when it simply gave up. A thread the bot is still
 * handling has no stripe at all, because there is nothing to do about it.
 */
@Composable
private fun ThreadRow(thread: Thread, onClick: () -> Unit) {
    val stripe = when {
        thread.urgent -> T.danger
        thread.needsHuman -> T.warn
        else -> Color.Transparent
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(stripe)
            .padding(start = 3.dp)
            .background(T.surface)
            .padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(T.surfaceSoft),
            contentAlignment = Alignment.Center,
        ) {
            Txt(thread.initials, Type.label.copy(fontSize = 13.sp), T.inkMuted)
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(thread.title, Type.rowName, T.ink, Modifier.weight(1f, fill = false))
                if (thread.optedOut) {
                    Spacer(Modifier.width(7.dp))
                    Chip("Opted out", T.dangerTint, T.danger)
                }
            }
            Spacer(Modifier.height(2.dp))
            // The last message, prefixed when it was ours, so a thread waiting on
            // the patient is not mistaken for one waiting on us.
            val prefix = if (thread.lastDirection == "out") "You: " else ""
            Txt(prefix + thread.lastText, Type.caption, T.inkMuted, maxLines = 2)
            if (thread.needsHuman && thread.handoffReason.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Txt(
                    thread.handoffReason,
                    Type.chip,
                    if (thread.urgent) T.danger else T.accentInk,
                    uppercase = true,
                )
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            Txt(ago(thread.lastAt), Type.chip, T.inkFaint, uppercase = true)
            if (thread.unread > 0) {
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier.size(20.dp).clip(CircleShape).background(T.badge),
                    contentAlignment = Alignment.Center,
                ) {
                    Txt(
                        if (thread.unread > 9) "9+" else thread.unread.toString(),
                        Type.chip.copy(letterSpacing = 0.sp),
                        Color.White,
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One thread
// ---------------------------------------------------------------------------

/**
 * A conversation.
 *
 * Dark bar over a light thread — the shape every messaging app has already
 * taught people, so nobody has to learn this screen.
 */
@Composable
fun ThreadScreen(
    state: Chats,
    onBack: () -> Unit,
    onCall: (String) -> Unit = {},
) {
    val thread = state.open ?: return
    val listState = rememberLazyListState()

    // Land at the recent end, and follow it as messages arrive — the top of a
    // conversation is history, the bottom is the thing being answered.
    LaunchedEffect(state.lines.size) {
        if (state.lines.isNotEmpty()) listState.scrollToItem(state.lines.lastIndex)
    }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        ThreadBar(thread, onBack, onCall)

        Box(Modifier.weight(1f)) {
            when {
                state.linesLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                }

                state.lines.isEmpty() -> Box(
                    Modifier.fillMaxSize().padding(T.gutter),
                    contentAlignment = Alignment.Center,
                ) {
                    Txt("Nothing has been said in this thread yet.", Type.body, T.inkFaint, maxLines = 2)
                }

                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = T.gutter, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.lines)
                }
            }
        }

        ReadOnlyNote(thread)
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.items(lines: List<Line>) {
    lines.forEach { line ->
        item(key = line.id) { Bubble(line) }
    }
}

@Composable
private fun ThreadBar(thread: Thread, onBack: () -> Unit, onCall: (String) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(T.slab)
            .statusBarsPadding()
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
            Spacer(Modifier.width(12.dp))
            Box(
                Modifier.size(38.dp).clip(CircleShape).background(T.slabFill),
                contentAlignment = Alignment.Center,
            ) {
                Txt(thread.initials, Type.label.copy(fontSize = 13.sp), T.onSlab)
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Txt(thread.title, Type.heading.copy(fontSize = 16.sp), T.onSlab)
                Spacer(Modifier.height(2.dp))
                // The three states that matter, at brightnesses that read on
                // near-black rather than the light-ground versions.
                val (label, colour) = when {
                    thread.optedOut -> "Asked not to be messaged" to Color(0xFFFB7185)
                    thread.needsHuman -> "Waiting for a person" to Color(0xFFFB7185)
                    thread.assignedName.isNotBlank() -> "${thread.assignedName} is handling this" to Color(0xFFFBBF24)
                    thread.botPaused -> "Bot paused" to Color(0xFFFBBF24)
                    else -> "Bot is answering" to Color(0xFF34D399)
                }
                Txt(label, Type.caption, colour)
            }
            if (thread.phone.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                SlabIcon(Icons.Filled.Phone, "Call") { onCall(thread.phone) }
            }
        }
    }
}

/** One message. */
@Composable
private fun Bubble(line: Line) {
    val mine = !line.fromPatient
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 14.dp, topEnd = 14.dp,
                        bottomStart = if (mine) 14.dp else 4.dp,
                        bottomEnd = if (mine) 4.dp else 14.dp,
                    )
                )
                .background(if (mine) T.slab else T.surface)
                .border(
                    1.dp,
                    if (mine) Color.Transparent else T.line,
                    RoundedCornerShape(14.dp),
                )
                .padding(horizontal = 13.dp, vertical = 10.dp),
        ) {
            // Who said it, when it was not the patient and not a person either.
            if (mine && line.fromBot) {
                Txt("Bot", Type.chip, T.onSlabFaint, uppercase = true)
                Spacer(Modifier.height(3.dp))
            } else if (mine && line.name.isNotBlank()) {
                Txt(line.name, Type.chip, T.onSlabFaint, uppercase = true)
                Spacer(Modifier.height(3.dp))
            }

            if (line.media.isNotBlank()) {
                Txt(
                    mediaLabel(line.media),
                    Type.caption,
                    if (mine) T.onSlabSoft else T.inkMuted,
                )
                if (line.text.isNotBlank() || line.transcript.isNotBlank()) Spacer(Modifier.height(4.dp))
            }

            val body = line.text.ifBlank { line.transcript }
            if (body.isNotBlank()) {
                Txt(body, Type.body, if (mine) T.onSlab else T.ink, maxLines = 40)
            }

            // A voice note's words arrive a few seconds after the note itself.
            if (line.transcript.isNotBlank() && line.text.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Txt("“${line.transcript}”", Type.caption, if (mine) T.onSlabSoft else T.inkMuted, maxLines = 10)
            }

            Spacer(Modifier.height(5.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(clock(line.at), Type.chip, if (mine) T.onSlabFaint else T.inkFaint)
                if (line.failed) {
                    Spacer(Modifier.width(6.dp))
                    Txt("Not delivered", Type.chip, Color(0xFFFB7185), uppercase = true)
                }
            }
        }
    }
}

/**
 * Why there is no reply box.
 *
 * Stated rather than hidden: a chat screen with no composer looks broken, and
 * the reason it has none is a decision worth showing.
 */
@Composable
private fun ReadOnlyNote(thread: Thread) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Rule()
            Txt(
                if (thread.optedOut) {
                    "This patient asked not to be messaged. Nothing can be sent to them."
                } else {
                    "Replying from the phone is not switched on yet. Answer from the website."
                },
                Type.caption,
                T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                maxLines = 2,
            )
        }
    }
}

// ---------------------------------------------------------------------------

private fun emptyLine(state: Chats): String = when (state.filter) {
    Inbox.Waiting -> "Nobody is waiting. The bot is handling every conversation."
    Inbox.All -> "No conversations yet."
    Inbox.Archived -> "Nothing archived."
}

private fun mediaLabel(kind: String): String = when (kind) {
    "image" -> "Photo"
    "audio" -> "Voice note"
    "video" -> "Video"
    "document" -> "Document"
    "sticker" -> "Sticker"
    else -> "Attachment"
}

/** "4m", "2h", "Tue" — how long ago, at the length a queue needs. */
private fun ago(at: Long): String {
    if (at <= 0L) return ""
    val gap = System.currentTimeMillis() - at
    val minutes = TimeUnit.MILLISECONDS.toMinutes(gap)
    val hours = TimeUnit.MILLISECONDS.toHours(gap)
    val days = TimeUnit.MILLISECONDS.toDays(gap)
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        hours < 24 -> "${hours}h"
        days < 7 -> SimpleDateFormat("EEE", Locale.US).format(Date(at))
        else -> SimpleDateFormat("d MMM", Locale.US).format(Date(at))
    }
}

private fun clock(at: Long): String =
    if (at <= 0L) "" else SimpleDateFormat("h:mm a", Locale.US).format(Date(at))
