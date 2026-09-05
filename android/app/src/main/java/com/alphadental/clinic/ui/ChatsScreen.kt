package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.alphadental.clinic.data.Chats
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * The clinic's WhatsApp, on the phone.
 *
 * On the official channel the clinic's number lives on Meta's servers, so there is no WhatsApp
 * app to open: the thread the server keeps is the only copy, and this screen is where the
 * phone reads and answers it. A list of numbers first, the conversation on tap — the bot's
 * turns and the receptionist's in the same stream, with Meta's own ticks under what the clinic
 * sent so "sent" means what it means on a phone.
 *
 * The hand-off is the reason this exists on the phone at all. The bot raises a flag and tells
 * the patient someone will be in touch; the push that follows now lands here, on the thread,
 * rather than on a day list with the patient still to be found.
 */
@Composable
fun ChatsScreen(
    chats: List<Chats.ChatRow>,
    loaded: Boolean,
    openChatId: String,
    lines: List<Chats.ChatLine>,
    linesLoading: Boolean,
    sending: Boolean,
    error: String?,
    notice: String?,
    claimMs: Long,
    myUid: String,
    arabic: Boolean,
    onOpenChat: (String) -> Unit,
    onCloseChat: () -> Unit,
    onSend: (String) -> Unit,
    onSendFollowup: () -> Unit,
    onToggleBot: () -> Unit,
    onToggleAssign: () -> Unit,
    onSetArchived: (Boolean) -> Unit,
    onDismissNotice: () -> Unit,
    /** A conversation opened from a patient's file that has no document yet. */
    draft: Chats.ChatRow? = null,
    quickReplies: List<Chats.QuickReply> = emptyList(),
    /** (bytes, mime, filename, caption). */
    onSendFile: (ByteArray, String, String, String) -> Unit = { _, _, _, _ -> },
    onAddQuickReply: (String, String) -> Unit = { _, _ -> },
    /** Null for roles that may not open a patient's file. */
    onOpenPatient: ((String) -> Unit)?,
    onClose: () -> Unit,
) {
    // The real row wins the moment it exists: the first send creates it, and the draft retires.
    val open = chats.firstOrNull { it.id == openChatId } ?: draft?.takeIf { it.id == openChatId }
    if (openChatId.isNotBlank() && open != null) {
        ChatThread(
            chat = open,
            lines = lines,
            loading = linesLoading,
            sending = sending,
            error = error,
            notice = notice,
            claimMs = claimMs,
            myUid = myUid,
            arabic = arabic,
            onSend = onSend,
            onSendFollowup = onSendFollowup,
            onToggleBot = onToggleBot,
            onToggleAssign = onToggleAssign,
            onSetArchived = onSetArchived,
            onDismissNotice = onDismissNotice,
            isDraft = draft?.id == open.id && chats.none { it.id == open.id },
            quickReplies = quickReplies,
            onSendFile = onSendFile,
            onAddQuickReply = onAddQuickReply,
            onOpenPatient = onOpenPatient,
            onBack = onCloseChat,
        )
    } else {
        ChatList(
            chats = chats,
            loaded = loaded,
            myUid = myUid,
            arabic = arabic,
            onOpenChat = onOpenChat,
            onClose = onClose,
        )
    }
}

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

private enum class ChatFilter { ALL, NEEDS, UNREAD, MINE, ARCHIVED }

@Composable
private fun ChatList(
    chats: List<Chats.ChatRow>,
    loaded: Boolean,
    myUid: String,
    arabic: Boolean,
    onOpenChat: (String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }

    var filter by rememberSaveable { mutableStateOf(ChatFilter.ALL) }
    var search by rememberSaveable { mutableStateOf("") }

    val needle = search.trim().lowercase().replace(Regex("\\s+"), "")
    val live = chats.filterNot { it.archived }
    val needsCount = live.count { it.needsHuman }
    val unreadCount = live.count { it.unreadCount > 0 }
    val mineCount = if (myUid.isBlank()) 0 else live.count { it.assignedTo == myUid }

    val shown = chats
        .filter { if (filter == ChatFilter.ARCHIVED) it.archived else !it.archived }
        .filter {
            when (filter) {
                ChatFilter.NEEDS -> it.needsHuman
                ChatFilter.UNREAD -> it.unreadCount > 0
                ChatFilter.MINE -> myUid.isNotBlank() && it.assignedTo == myUid
                else -> true
            }
        }
        .filter { row ->
            needle.isBlank() || "${row.patientName}${row.phone}${row.id}".lowercase().replace(Regex("\\s+"), "").contains(needle)
        }

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
                        if (arabic) "المحادثات" else "Chats",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        when {
                            needsCount > 0 -> if (arabic) "$needsCount في انتظار رد من شخص" else "$needsCount waiting for a person"
                            else -> if (arabic) "واتساب العيادة — البوت والفريق" else "The clinic's WhatsApp — bot and team"
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = if (needsCount > 0) Alpha.DangerText else Alpha.Slate500,
                    )
                }
            }

            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                singleLine = true,
                placeholder = { Text(if (arabic) "ابحث بالاسم أو الرقم" else "Search by name or number", color = Alpha.Slate400) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Alpha.Slate400) },
                colors = chatFieldColors(),
                shape = Alpha.CardShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
            ) {
                FilterChip(if (arabic) "الكل" else "All", filter == ChatFilter.ALL) { filter = ChatFilter.ALL }
                FilterChip(
                    (if (arabic) "محتاج رد" else "Needs reply") + if (needsCount > 0) " $needsCount" else "",
                    filter == ChatFilter.NEEDS,
                    alert = needsCount > 0,
                ) { filter = ChatFilter.NEEDS }
                FilterChip(
                    (if (arabic) "غير مقروء" else "Unread") + if (unreadCount > 0) " $unreadCount" else "",
                    filter == ChatFilter.UNREAD,
                ) { filter = ChatFilter.UNREAD }
                FilterChip(
                    (if (arabic) "معايا" else "Mine") + if (mineCount > 0) " $mineCount" else "",
                    filter == ChatFilter.MINE,
                ) { filter = ChatFilter.MINE }
                FilterChip(if (arabic) "الأرشيف" else "Archived", filter == ChatFilter.ARCHIVED) { filter = ChatFilter.ARCHIVED }
            }

            when {
                !loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Alpha.Ink)
                }
                shown.isEmpty() -> Box(Modifier.padding(16.dp)) {
                    EmptyState(
                        when (filter) {
                            ChatFilter.NEEDS -> if (arabic) "لا أحد ينتظر رداً. البوت ماسك الشغل." else "Nobody is waiting. The bot has it."
                            ChatFilter.UNREAD -> if (arabic) "كل الرسائل مقروءة." else "Everything has been read."
                            ChatFilter.MINE -> if (arabic) "لا توجد محادثات معك." else "No chats assigned to you."
                            ChatFilter.ARCHIVED -> if (arabic) "الأرشيف فارغ." else "Nothing archived."
                            else -> if (arabic) "لا توجد محادثات بعد." else "No conversations yet."
                        }
                    )
                }
                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(shown, key = { it.id }) { row ->
                        ChatRowCard(row, myUid, arabic) { onOpenChat(row.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, selected: Boolean, alert: Boolean = false, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = when {
            selected -> Alpha.Ink
            alert -> Alpha.DangerSoft
            else -> Alpha.Card
        },
        border = if (selected) null else BorderStroke(1.dp, Alpha.Slate200),
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = when {
                selected -> Color.White
                alert -> Alpha.DangerText
                else -> Alpha.Slate700
            },
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun ChatRowCard(row: Chats.ChatRow, myUid: String, arabic: Boolean, onClick: () -> Unit) {
    val unread = row.unreadCount > 0
    AlphaCard(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Avatar(row, size = 44)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        row.title,
                        fontSize = 15.sp,
                        fontWeight = if (unread || row.needsHuman) FontWeight.ExtraBold else FontWeight.Bold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        shortWhen(row.lastAt, arabic),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (unread) Alpha.Green else Alpha.Slate400,
                    )
                }
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val prefix = when {
                        row.lastDirection != "out" -> ""
                        row.lastAuthor == "bot" -> if (arabic) "البوت: " else "Bot: "
                        row.lastAuthor == "staff" -> if (arabic) "الفريق: " else "Team: "
                        else -> ""
                    }
                    Text(
                        prefix + row.lastText.ifBlank { "…" },
                        fontSize = 13.sp,
                        fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (unread) Alpha.Slate800 else Alpha.Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (unread) {
                        Spacer(Modifier.width(8.dp))
                        CountBadge(row.unreadCount, Alpha.Green)
                    }
                }
                val tags = buildList {
                    if (row.needsHuman) add(Triple(handoffLabel(row.handoffReason, arabic), Alpha.DangerSoft, Alpha.DangerText))
                    if (row.assignedTo.isNotBlank()) {
                        val who = if (row.assignedTo == myUid) (if (arabic) "معاك" else "You") else row.assignedName.ifBlank { if (arabic) "زميل" else "Colleague" }
                        add(Triple(who, Alpha.Slate100, Alpha.Slate700))
                    } else if (row.botPaused) {
                        add(Triple(if (arabic) "البوت متوقف" else "Bot paused", Alpha.WarnBg, Alpha.WarnText))
                    }
                    if (row.optedOut) add(Triple(if (arabic) "طلب إيقاف الرسائل" else "Opted out", Alpha.Slate100, Alpha.Slate500))
                }
                if (tags.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        tags.forEach { (label, bg, fg) -> Tag(label, bg, fg) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Avatar(row: Chats.ChatRow, size: Int) {
    val initial = row.patientName.trim().firstOrNull()?.uppercaseChar()?.toString()
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (row.needsHuman) Alpha.DangerSoft else Alpha.GreenSoft),
        contentAlignment = Alignment.Center,
    ) {
        if (initial != null) {
            Text(
                initial,
                fontSize = (size * 0.4).sp,
                fontWeight = FontWeight.ExtraBold,
                color = if (row.needsHuman) Alpha.DangerText else Alpha.Green,
            )
        } else {
            Icon(
                Icons.Filled.Person,
                contentDescription = null,
                tint = if (row.needsHuman) Alpha.DangerText else Alpha.Green,
                modifier = Modifier.size((size * 0.5).dp),
            )
        }
    }
}

@Composable
private fun CountBadge(count: Int, color: Color) {
    Box(
        modifier = Modifier
            .size(20.dp)
            .clip(CircleShape)
            .background(color),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White)
    }
}

@Composable
private fun Tag(label: String, bg: Color, fg: Color) {
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(
            label,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

// ---------------------------------------------------------------------------------------------
// One thread
// ---------------------------------------------------------------------------------------------

@Composable
private fun ChatThread(
    chat: Chats.ChatRow,
    lines: List<Chats.ChatLine>,
    loading: Boolean,
    sending: Boolean,
    error: String?,
    notice: String?,
    claimMs: Long,
    myUid: String,
    arabic: Boolean,
    onSend: (String) -> Unit,
    onSendFollowup: () -> Unit,
    onToggleBot: () -> Unit,
    onToggleAssign: () -> Unit,
    onSetArchived: (Boolean) -> Unit,
    onDismissNotice: () -> Unit,
    isDraft: Boolean,
    quickReplies: List<Chats.QuickReply>,
    onSendFile: (ByteArray, String, String, String) -> Unit,
    onAddQuickReply: (String, String) -> Unit,
    onOpenPatient: ((String) -> Unit)?,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    BackHandler { onBack() }

    var draft by rememberSaveable(chat.id) { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    var repliesOpen by remember { mutableStateOf(false) }
    /** A file picked and not yet sent: bytes, mime, name. Held here, handed to the send. */
    var pending by remember(chat.id) { mutableStateOf<PendingFile?>(null) }
    val listState = rememberLazyListState()

    // A new line lands: follow it, the way a chat does. The person opened the thread for its end.
    LaunchedEffect(lines.size) {
        if (lines.isNotEmpty()) listState.scrollToItem(lines.lastIndex)
    }
    // The box empties the moment send is tapped, the way a chat does; a failed send puts the
    // words back so they are not lost to a dead connection.
    var lastSent by remember { mutableStateOf("") }
    LaunchedEffect(error) {
        if (error != null && draft.isBlank()) draft = lastSent
    }

    val now = System.currentTimeMillis()
    val botQuiet = chat.botQuiet(claimMs, now)
    val isMine = myUid.isNotBlank() && chat.assignedTo == myUid

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
        ) {
            // Header: who, and who has them.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 6.dp),
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Avatar(chat, size = 38)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        chat.title,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val status = when {
                        isDraft -> if (arabic) "محادثة جديدة" else "New conversation"
                        chat.optedOut -> if (arabic) "طلب إيقاف الرسائل" else "Asked not to be messaged"
                        chat.needsHuman -> if (arabic) "في انتظار رد من شخص" else "Waiting for a person"
                        isMine -> if (arabic) "أنت تتولى المحادثة" else "You are handling this"
                        chat.assignedTo.isNotBlank() -> (chat.assignedName.ifBlank { if (arabic) "زميل" else "A colleague" }) + (if (arabic) " يتولى المحادثة" else " is handling this")
                        botQuiet -> if (arabic) "البوت متوقف" else "Bot paused"
                        else -> if (arabic) "البوت يرد" else "Bot is answering"
                    }
                    Text(
                        status,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = when {
                            chat.needsHuman -> Alpha.DangerText
                            botQuiet || chat.optedOut -> Alpha.WarnText
                            else -> Alpha.Green
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (chat.phone.isNotBlank()) {
                    IconButton(onClick = { context.dial(chat.phone) }) {
                        Icon(Icons.Filled.Phone, contentDescription = "Call", tint = Alpha.Slate700)
                    }
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Filled.MoreVert, contentDescription = "More", tint = Alpha.Slate700)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    when {
                                        isMine -> if (arabic) "اترك المحادثة" else "Release it"
                                        chat.assignedTo.isNotBlank() -> if (arabic) "خدها مني زميلي" else "Take over from colleague"
                                        else -> if (arabic) "خليها معايا" else "Assign to me"
                                    }
                                )
                            },
                            leadingIcon = { Icon(Icons.Filled.Person, contentDescription = null) },
                            onClick = { menuOpen = false; onToggleAssign() },
                        )
                        if (chat.patientId.isNotBlank() && onOpenPatient != null) {
                            DropdownMenuItem(
                                text = { Text(if (arabic) "افتح ملف المريض" else "Open patient file") },
                                leadingIcon = { Icon(Icons.Filled.Folder, contentDescription = null) },
                                onClick = { menuOpen = false; onOpenPatient(chat.patientId) },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text(if (chat.archived) (if (arabic) "إخراج من الأرشيف" else "Unarchive") else (if (arabic) "أرشفة" else "Archive")) },
                            leadingIcon = { Icon(if (chat.archived) Icons.Filled.Unarchive else Icons.Filled.Archive, contentDescription = null) },
                            onClick = { menuOpen = false; onSetArchived(!chat.archived) },
                        )
                    }
                }
            }

            // The switch that matters: one button for every reason the bot is quiet.
            if (!isDraft) Surface(
                color = if (chat.needsHuman) Alpha.DangerSoft else if (botQuiet) Alpha.WarnBg else Alpha.Card,
                shape = Alpha.CardShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 14.dp, end = 8.dp, top = 6.dp, bottom = 6.dp)) {
                    Icon(
                        Icons.Filled.SmartToy,
                        contentDescription = null,
                        tint = if (chat.needsHuman) Alpha.DangerText else if (botQuiet) Alpha.WarnText else Alpha.Green,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        when {
                            chat.needsHuman -> handoffLabel(chat.handoffReason, arabic)
                            botQuiet -> if (arabic) "البوت واقف لحد ما ترجّعه" else "The bot is standing back until you hand it back"
                            else -> if (arabic) "البوت بيرد على المريض" else "The bot is answering this patient"
                        },
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (chat.needsHuman) Alpha.DangerText else if (botQuiet) Alpha.WarnText else Alpha.Slate700,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = onToggleBot) {
                        Text(
                            if (botQuiet) (if (arabic) "رجّع البوت" else "Hand back") else (if (arabic) "استلم أنت" else "Take over"),
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 12.5.sp,
                            color = if (botQuiet) Alpha.Green else Alpha.Slate900,
                        )
                    }
                }
            }

            // The thread.
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    loading && lines.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Alpha.Ink)
                    }
                    lines.isEmpty() -> Box(Modifier.padding(16.dp)) {
                        EmptyState(if (arabic) "لا توجد رسائل محفوظة بعد." else "No messages recorded yet.")
                    }
                    else -> LazyColumn(
                        state = listState,
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        var lastDay = ""
                        lines.forEach { line ->
                            val day = dayKey(line.at)
                            if (day != lastDay) {
                                lastDay = day
                                item(key = "day-$day") { DayDivider(dayLabel(line.at, arabic)) }
                            }
                            item(key = line.id) { Bubble(line, arabic) }
                        }
                    }
                }
            }

            notice?.let {
                Surface(
                    onClick = onDismissNotice,
                    color = Alpha.WarnBg,
                    shape = Alpha.CardShape,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Alpha.WarnText, modifier = Modifier.padding(12.dp))
                }
            }
            error?.let {
                Text(
                    it,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.DangerText,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            pending?.let { file ->
                PendingFileRow(file, arabic) { pending = null }
            }

            Composer(
                chat = chat,
                draft = draft,
                onDraft = { draft = it },
                sending = sending,
                arabic = arabic,
                now = now,
                isDraft = isDraft,
                hasFile = pending != null,
                onSend = {
                    val file = pending
                    lastSent = draft
                    if (file != null) {
                        onSendFile(file.bytes, file.mime, file.name, draft)
                        pending = null
                    } else {
                        onSend(draft)
                    }
                    draft = ""
                },
                onSendFollowup = onSendFollowup,
                onPick = { pending = it },
                onQuickReplies = { repliesOpen = true },
            )
        }
    }

    if (repliesOpen) {
        QuickRepliesSheet(
            replies = quickReplies,
            patientName = chat.patientName,
            arabic = arabic,
            onInsert = { text ->
                // Appended under what is already typed, the way the desk's box does it.
                draft = if (draft.isBlank()) text else draft.trimEnd() + "\n" + text
                repliesOpen = false
            },
            onAdd = onAddQuickReply,
            onDismiss = { repliesOpen = false },
        )
    }
}

/** A file picked and not yet sent. */
private data class PendingFile(val bytes: ByteArray, val mime: String, val name: String) {
    val kind: String get() = Chats.kindFor(mime)
}

@Composable
private fun PendingFileRow(file: PendingFile, arabic: Boolean, onRemove: () -> Unit) {
    Surface(
        color = Alpha.Card,
        shape = Alpha.CardShape,
        border = BorderStroke(1.dp, Alpha.Slate200),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp)) {
            Icon(
                if (file.kind == "image") Icons.Filled.Image else Icons.Filled.InsertDriveFile,
                contentDescription = null,
                tint = Alpha.Green,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(file.name, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${file.bytes.size / 1024} KB · " + (if (arabic) "اكتب تعليقاً أو أرسل كما هو" else "add a caption, or send as is"),
                    fontSize = 11.5.sp,
                    color = Alpha.Slate500,
                )
            }
            IconButton(onClick = onRemove) {
                Icon(Icons.Filled.Close, contentDescription = "Remove", tint = Alpha.Slate500, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/**
 * The box, or the reason there is no box.
 *
 * Meta drops free text sent more than a day after the patient last wrote; the unofficial gateway
 * does not. Blocked only where it would silently fail — a disabled box the receptionist can see
 * beats a "sent" that never lands.
 */
@Composable
private fun Composer(
    chat: Chats.ChatRow,
    draft: String,
    onDraft: (String) -> Unit,
    sending: Boolean,
    arabic: Boolean,
    now: Long,
    isDraft: Boolean,
    hasFile: Boolean,
    onSend: () -> Unit,
    onSendFollowup: () -> Unit,
    onPick: (PendingFile) -> Unit,
    onQuickReplies: () -> Unit,
) {
    val context = LocalContext.current
    var chooserOpen by remember { mutableStateOf(false) }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            // Downscaled on the phone, as patient photos are: a 12-megapixel shot is over Meta's
            // 5MB image ceiling and nobody needs it at that size in a chat.
            readScaledJpeg(context, uri)?.let { onPick(PendingFile(it, "image/jpeg", "photo_${System.currentTimeMillis()}.jpg")) }
        }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) context.readPicked(uri)?.let(onPick)
    }

    val reason = when {
        chat.isLid -> if (arabic) "المرسل مخفي رقمه؛ لا يمكن الرد من هنا." else "This sender hides their number; there is no way to reply from here."
        chat.optedOut -> if (arabic) "المريض طلب إيقاف الرسائل. لا يمكن المراسلة." else "This patient asked not to be messaged."
        isDraft ->
            if (arabic) "المريض لم يراسل العيادة من قبل. واتساب لا يسمح إلا بقالب المتابعة المعتمد لبدء المحادثة؛ بعد أن يرد يمكنك الكتابة بحرية."
            else "This patient has not written to the clinic yet. WhatsApp only allows the approved template to open a conversation; once they reply you can type freely."
        chat.channel == "meta" && chat.windowClosed(now) ->
            if (arabic) "مر أكثر من ٢٤ ساعة على آخر رسالة من المريض. واتساب لا يوصّل غير قالب المتابعة المعتمد."
            else "More than 24 hours since they last wrote. WhatsApp only delivers the approved follow-up template now."
        else -> null
    }

    if (reason != null) {
        Surface(
            color = Alpha.Card,
            shape = Alpha.CardShape,
            border = BorderStroke(1.dp, Alpha.Slate200),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Column(Modifier.padding(14.dp)) {
                Text(reason, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Alpha.Slate700)
                if (!chat.isLid && !chat.optedOut) {
                    Spacer(Modifier.height(10.dp))
                    Button(
                        onClick = onSendFollowup,
                        enabled = !sending,
                        colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                        shape = Alpha.PillShape,
                    ) {
                        if (sending) {
                            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                        } else {
                            Text(if (arabic) "أرسل قالب المتابعة" else "Send follow-up template", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
        return
    }

    if (chooserOpen) {
        AttachChooser(
            arabic = arabic,
            onPhoto = {
                chooserOpen = false
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            onFile = {
                chooserOpen = false
                pickFile.launch("*/*")
            },
            onDismiss = { chooserOpen = false },
        )
    }

    Row(
        verticalAlignment = Alignment.Bottom,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, end = 8.dp, top = 4.dp, bottom = 8.dp),
    ) {
        IconButton(onClick = onQuickReplies, enabled = !sending, modifier = Modifier.padding(bottom = 2.dp)) {
            Icon(Icons.Filled.Bolt, contentDescription = if (arabic) "ردود جاهزة" else "Quick replies", tint = Alpha.Slate600)
        }
        IconButton(onClick = { chooserOpen = true }, enabled = !sending && !hasFile, modifier = Modifier.padding(bottom = 2.dp)) {
            Icon(Icons.Filled.AttachFile, contentDescription = if (arabic) "إرفاق" else "Attach", tint = if (hasFile) Alpha.Slate300 else Alpha.Slate600)
        }
        OutlinedTextField(
            value = draft,
            onValueChange = onDraft,
            placeholder = { Text(if (hasFile) (if (arabic) "تعليق (اختياري)" else "Caption (optional)") else if (arabic) "اكتب رسالة" else "Type a message", color = Alpha.Slate400) },
            colors = chatFieldColors(),
            shape = RoundedCornerShape(22.dp),
            maxLines = 5,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(6.dp))
        val canSend = (draft.isNotBlank() || hasFile) && !sending
        Surface(
            onClick = onSend,
            enabled = canSend,
            shape = CircleShape,
            color = if (canSend) Alpha.Ink else Alpha.Slate200,
            modifier = Modifier.size(48.dp).padding(bottom = 2.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                if (sending) {
                    CircularProgressIndicator(color = Alpha.Slate500, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = if (canSend) Color.White else Alpha.Slate400, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun DayDivider(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = Alpha.PillShape, color = Alpha.Slate100) {
            Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate600, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
        }
    }
}

/** One message. The clinic's on the end, the patient's on the start, whichever way the script runs. */
@Composable
private fun Bubble(line: Chats.ChatLine, arabic: Boolean) {
    val context = LocalContext.current
    val mine = line.direction == "out"
    val who = when (line.author) {
        "bot" -> if (arabic) "🤖 البوت" else "🤖 Bot"
        "staff" -> line.name.ifBlank { if (arabic) "الفريق" else "Team" }
        "system" -> kindLabel(line.kind, arabic)
        else -> ""
    }
    val failed = line.status == "failed"
    val placeholderOnly = line.media.isNotBlank() && Regex("^\\[\\w+]$").matches(line.text.trim())

    Row(
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = if (mine) 14.dp else 4.dp,
                topEnd = if (mine) 4.dp else 14.dp,
                bottomStart = 14.dp,
                bottomEnd = 14.dp,
            ),
            color = when {
                failed -> Alpha.DangerSoft
                mine -> Alpha.GreenSoft
                else -> Alpha.Card
            },
            shadowElevation = if (Alpha.dark) 0.dp else 1.dp,
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                if (who.isNotBlank()) {
                    Text(
                        who,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = if (line.author == "staff") Alpha.Green else Alpha.WarnText,
                    )
                    Spacer(Modifier.height(2.dp))
                }

                if (line.media.isNotBlank()) {
                    MediaBlock(line, arabic) { url -> context.openUrl(url) }
                }

                if (!placeholderOnly && line.text.isNotBlank()) {
                    Text(line.text, fontSize = 14.5.sp, color = Alpha.Slate900, lineHeight = 20.sp)
                }
                if (line.transcript.isNotBlank()) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        line.transcript,
                        fontSize = 13.sp,
                        fontStyle = FontStyle.Italic,
                        color = Alpha.Slate700,
                        lineHeight = 18.sp,
                    )
                }

                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.align(Alignment.End)) {
                    Text(clock(line.at), fontSize = 10.5.sp, color = Alpha.Slate400)
                    if (mine && line.status.isNotBlank()) {
                        Spacer(Modifier.width(4.dp))
                        Text(
                            when (line.status) {
                                "read" -> "✓✓"
                                "delivered" -> "✓✓"
                                "failed" -> "!"
                                else -> "✓"
                            },
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = when (line.status) {
                                "read" -> Alpha.Ink
                                "failed" -> Alpha.DangerText
                                else -> Alpha.Slate400
                            },
                        )
                    }
                }
                if (failed) {
                    Text(
                        (if (arabic) "لم تصل" else "Not delivered") + line.errorMessage.takeIf { it.isNotBlank() }?.let { " — $it" }.orEmpty(),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.DangerText,
                    )
                }
            }
        }
    }
}

@Composable
private fun MediaBlock(line: Chats.ChatLine, arabic: Boolean, onOpen: (String) -> Unit) {
    val hasUrl = line.mediaUrl.isNotBlank()
    when (line.media) {
        "image", "sticker" -> {
            if (hasUrl) {
                AsyncImage(
                    model = line.mediaUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 120.dp, max = 240.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onOpen(line.mediaUrl) },
                )
            } else {
                MediaRow(Icons.Filled.Description, if (arabic) "صورة — جارٍ التحميل" else "Photo — still arriving", null)
            }
            Spacer(Modifier.height(4.dp))
        }
        "audio" -> MediaRow(
            Icons.Filled.Mic,
            if (arabic) "رسالة صوتية" else "Voice note",
            if (hasUrl) ({ onOpen(line.mediaUrl) }) else null,
        )
        "video" -> MediaRow(
            Icons.Filled.Videocam,
            if (arabic) "فيديو" else "Video",
            if (hasUrl) ({ onOpen(line.mediaUrl) }) else null,
        )
        else -> MediaRow(
            Icons.Filled.Description,
            mediaLabel(line.media, arabic),
            if (hasUrl) ({ onOpen(line.mediaUrl) }) else null,
        )
    }
}

@Composable
private fun MediaRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onOpen: (() -> Unit)?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Alpha.Slate100)
            .then(if (onOpen != null) Modifier.clickable(onClick = onOpen) else Modifier)
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Alpha.Slate700, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Alpha.Slate800)
        if (onOpen != null) {
            Spacer(Modifier.width(6.dp))
            Text("↗", fontSize = 12.sp, color = Alpha.Slate500)
        }
    }
}

/** Photo or file: two rows, because the pickers behind them are different system screens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AttachChooser(arabic: Boolean, onPhoto: () -> Unit, onFile: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Alpha.Card) {
        Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 28.dp)) {
            ChooserRow(Icons.Filled.Image, if (arabic) "صورة من المعرض" else "Photo from gallery", if (arabic) "حتى ٥ ميجا" else "Up to 5MB", onPhoto)
            ChooserRow(Icons.Filled.InsertDriveFile, if (arabic) "ملف" else "File", if (arabic) "PDF أو مستند، حتى ٢٠ ميجا" else "PDF or document, up to 20MB", onFile)
        }
    }
}

@Composable
private fun ChooserRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, hint: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(Alpha.CardShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(Alpha.GreenSoft), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Alpha.Green, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
            Text(hint, fontSize = 12.sp, color = Alpha.Slate500)
        }
    }
}

/**
 * Ready answers, one tap from the box.
 *
 * Two sources shown as one list, as the website does: the clinic's ready answers from Settings
 * (the sentences the bot already quotes verbatim) and the list the desk keeps itself. The
 * second can be added to from here — anything said more than twice a day, in the desk's words.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickRepliesSheet(
    replies: List<Chats.QuickReply>,
    patientName: String,
    arabic: Boolean,
    onInsert: (String) -> Unit,
    onAdd: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var q by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    var newTitle by remember { mutableStateOf("") }
    var newText by remember { mutableStateOf("") }
    val needle = q.trim().lowercase()
    val shown = if (needle.isBlank()) replies else replies.filter { "${it.title} ${it.text}".lowercase().contains(needle) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, bottom = 28.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (arabic) "ردود جاهزة" else "Quick replies",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { adding = !adding }) {
                    Text(if (adding) (if (arabic) "إلغاء" else "Cancel") else (if (arabic) "＋ جديد" else "＋ New"), fontWeight = FontWeight.ExtraBold, color = Alpha.Green)
                }
            }

            if (adding) {
                OutlinedTextField(
                    value = newTitle, onValueChange = { newTitle = it }, singleLine = true,
                    placeholder = { Text(if (arabic) "عنوان قصير" else "Short title", color = Alpha.Slate400) },
                    colors = chatFieldColors(), shape = Alpha.CardShape, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = newText, onValueChange = { newText = it }, maxLines = 5,
                    placeholder = { Text(if (arabic) "النص. اكتب {name} ليُستبدل باسم المريض" else "The text. {name} becomes the patient's first name", color = Alpha.Slate400) },
                    colors = chatFieldColors(), shape = Alpha.CardShape, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        onAdd(newTitle, newText)
                        newTitle = ""; newText = ""; adding = false
                    },
                    enabled = newTitle.isNotBlank() && newText.isNotBlank(),
                    shape = Alpha.PillShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                ) { Text(if (arabic) "حفظ" else "Save", fontWeight = FontWeight.Bold) }
                Spacer(Modifier.height(12.dp))
            }

            if (replies.size > 6) {
                OutlinedTextField(
                    value = q, onValueChange = { q = it }, singleLine = true,
                    placeholder = { Text(if (arabic) "ابحث" else "Search", color = Alpha.Slate400) },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Alpha.Slate400) },
                    colors = chatFieldColors(), shape = Alpha.CardShape, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
            }

            if (shown.isEmpty()) {
                EmptyState(
                    if (arabic) "لا توجد ردود جاهزة بعد. أضف واحداً هنا، أو املأ الإجابات الجاهزة في الإعدادات ← واتساب على الموقع."
                    else "No quick replies yet. Add one here, or fill in the ready answers under Settings → WhatsApp on the website."
                )
            } else {
                shown.forEach { reply ->
                    Surface(
                        onClick = { onInsert(Chats.fillQuickReply(reply.text, patientName)) },
                        shape = Alpha.CardShape,
                        color = Alpha.Ground,
                        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(reply.title, fontSize = 13.5.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate900, modifier = Modifier.weight(1f))
                                if (!reply.custom) Tag(if (arabic) "من الإعدادات" else "Settings", Alpha.Slate100, Alpha.Slate500)
                            }
                            Text(reply.text, fontSize = 12.5.sp, color = Alpha.Slate600, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

/** Bytes, type and display name for a document the person picked. Null if it cannot be read. */
private fun Context.readPicked(uri: Uri): PendingFile? = runCatching {
    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    val mime = contentResolver.getType(uri) ?: "application/octet-stream"
    var name = ""
    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) name = c.getString(0).orEmpty()
    }
    PendingFile(bytes, mime, name.ifBlank { "file_${System.currentTimeMillis()}" })
}.getOrNull()

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** Mirrors handoffLabel in the website's HandoffInbox, so the two screens name a reason the same way. */
private fun handoffLabel(reason: String, arabic: Boolean): String {
    val map = mapOf(
        "clinical" to ("Medical — needs a dentist" to "حالة طبية — محتاجة دكتور"),
        "ai_handoff_medical" to ("Medical question" to "سؤال طبي"),
        "media_image" to ("Sent a photo" to "بعت صورة"),
        "media_video" to ("Sent a video" to "بعت فيديو"),
        "media_audio" to ("Sent a voice note" to "بعت رسالة صوتية"),
        "media_document" to ("Sent a file" to "بعت ملف"),
        "media_location" to ("Sent a location" to "بعت لوكيشن"),
        "complaint" to ("Complaint" to "شكوى"),
        "ai_handoff_complaint" to ("Complaint" to "شكوى"),
        "ai_handoff_staff" to ("Asked about a named dentist" to "سأل عن دكتور بالاسم"),
        "ai_handoff_other" to ("Question the bot couldn't answer" to "سؤال البوت معرفش يجاوبه"),
        "asked_for_human" to ("Asked for a person" to "طلب يكلم حد"),
        "gave_up" to ("Bot didn't understand" to "البوت مفهمش"),
        "booking_request" to ("Wants to book (no schedule set)" to "عايز يحجز (المواعيد مش متظبطة)"),
        "booking_abandoned" to ("Gave up mid-booking" to "سابها في نص الحجز"),
        "too_many_open" to ("Already has 3 open bookings" to "عنده ٣ حجوزات مفتوحة"),
        "no_open_days" to ("No open days to offer" to "مفيش أيام متاحة"),
        "appointment_cancel" to ("Wants to cancel" to "عايز يلغي الميعاد"),
        "appointment_reschedule" to ("Wants to move the appointment" to "عايز يغير الميعاد"),
        "appointment_late" to ("Running late" to "هيتأخر"),
        "rate_limited" to ("Messaged too many times" to "بعت رسايل كتير"),
        "too_many_turns" to ("Very long conversation" to "محادثة طويلة جداً"),
        "unknown_number" to ("Unknown number" to "رقم غير مسجل"),
        "lid_unidentified" to ("Couldn't identify the sender" to "مش عارفين مين اللي بعت"),
        "opted_out_urgent" to ("Urgent — from a patient who opted out" to "عاجل — من مريض موقف الرسايل"),
        "limit" to ("Bot's reply limit reached" to "البوت وصل لحد الردود"),
    )
    if (reason.endsWith("_unknown")) return if (arabic) "سؤال ملوش إجابة في الإعدادات" else "Question with no answer in Settings"
    val row = map[reason] ?: return if (reason.isBlank()) (if (arabic) "محتاج رد من شخص" else "Needs a person") else reason.replace('_', ' ')
    return if (arabic) row.second else row.first
}

/** Mirrors kindLabel in the website's ChatsPanel. */
private fun kindLabel(kind: String, arabic: Boolean): String {
    val map = mapOf(
        "appointment_new" to ("Booking confirmation" to "تأكيد حجز"),
        "appointment_edit" to ("Appointment changed" to "تعديل ميعاد"),
        "appointment_cancel" to ("Appointment cancelled" to "إلغاء ميعاد"),
        "new" to ("Booking confirmation" to "تأكيد حجز"),
        "edit" to ("Appointment changed" to "تعديل ميعاد"),
        "cancel" to ("Appointment cancelled" to "إلغاء ميعاد"),
        "reminder24h" to ("Reminder" to "تذكير"),
        "reminder" to ("Reminder" to "تذكير"),
        "invoice" to ("Receipt" to "إيصال"),
        "payment" to ("Receipt" to "إيصال"),
        "google_review" to ("Review request" to "طلب تقييم"),
        "reactivation" to ("We miss you" to "وحشتنا"),
        "lead_welcome" to ("Lead welcome" to "ترحيب بعميل"),
        "prescription_pdf" to ("Prescription" to "روشتة"),
        "treatment_plan_pdf" to ("Treatment plan" to "خطة علاج"),
        "followup_template" to ("Follow-up template" to "قالب متابعة"),
    )
    val row = map[kind] ?: return if (kind.isBlank()) (if (arabic) "النظام" else "System") else kind.replace('_', ' ')
    return if (arabic) row.second else row.first
}

private fun mediaLabel(media: String, arabic: Boolean): String = when (media) {
    "document" -> if (arabic) "ملف" else "File"
    "location" -> if (arabic) "موقع" else "Location"
    "contact", "contacts" -> if (arabic) "جهة اتصال" else "Contact"
    else -> media.ifBlank { if (arabic) "مرفق" else "Attachment" }
}

@Composable
private fun chatFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    cursorColor = Alpha.Ink,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = Alpha.Card,
    focusedTextColor = Alpha.Slate900,
    unfocusedTextColor = Alpha.Slate900,
)

private fun clock(millis: Long): String =
    if (millis <= 0L) "" else SimpleDateFormat("h:mm a", Locale.ENGLISH).format(Date(millis))

private fun dayKey(millis: Long): String = SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH).format(Date(millis))

private fun dayLabel(millis: Long, arabic: Boolean): String {
    val today = dayKey(System.currentTimeMillis())
    val yesterday = dayKey(System.currentTimeMillis() - 24L * 60 * 60 * 1000)
    return when (dayKey(millis)) {
        today -> if (arabic) "اليوم" else "Today"
        yesterday -> if (arabic) "أمس" else "Yesterday"
        else -> SimpleDateFormat("EEE d MMM", if (arabic) Locale.forLanguageTag("ar") else Locale.ENGLISH).format(Date(millis))
    }
}

/** The list's time column: a clock today, a weekday this week, a date beyond that. */
private fun shortWhen(millis: Long, arabic: Boolean): String {
    if (millis <= 0L) return ""
    val now = System.currentTimeMillis()
    val locale = if (arabic) Locale.forLanguageTag("ar") else Locale.ENGLISH
    return when {
        dayKey(millis) == dayKey(now) -> clock(millis)
        now - millis < 6L * 24 * 60 * 60 * 1000 -> SimpleDateFormat("EEE", locale).format(Date(millis))
        Calendar.getInstance().apply { timeInMillis = millis }.get(Calendar.YEAR) == Calendar.getInstance().get(Calendar.YEAR) ->
            SimpleDateFormat("d MMM", locale).format(Date(millis))
        else -> SimpleDateFormat("d/M/yy", Locale.ENGLISH).format(Date(millis))
    }
}

private fun Context.dial(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }
}

private fun Context.openUrl(url: String) {
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
