package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Line
import com.alphadental.clinic.next.data.Thread
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch

/** Which slice of the inbox is showing. */
enum class Inbox(val label: String) {
    Waiting("Waiting"),
    All("All"),
    Archived("Archived"),
}

data class Chats(
    val loading: Boolean = true,
    val who: Who? = null,
    val threads: List<Thread> = emptyList(),
    val filter: Inbox = Inbox.Waiting,
    /** The thread being read, and its messages. */
    val open: Thread? = null,
    val lines: List<Line> = emptyList(),
    val linesLoading: Boolean = false,
    val error: String? = null,
) {
    private val live: List<Thread> get() = threads.filterNot { it.archived }

    /** Threads the bot handed over and nobody has picked up. */
    val waiting: List<Thread> get() = live.filter { it.needsHuman }

    val unread: Int get() = live.sumOf { it.unread }

    val shown: List<Thread>
        get() = when (filter) {
            Inbox.Waiting -> waiting
            Inbox.All -> live
            Inbox.Archived -> threads.filter { it.archived }
        }
}

/**
 * The WhatsApp inbox.
 *
 * **Read only.** Sending goes through the clinic's live channel, where a wrong
 * message costs real money and a wrong recipient risks the number being banned,
 * so nothing in here writes. Replying is a separate decision, not an oversight.
 *
 * Both the list and an open thread are listeners: this is a queue two people
 * work at once, and a message answered at the desk must stop showing as unread
 * on the phone without anyone refreshing.
 */
class ChatsModel : ViewModel() {

    private val _state = MutableStateFlow(Chats())
    val state: StateFlow<Chats> = _state.asStateFlow()

    private var inboxWatch: Job? = null
    private var threadWatch: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    watchInbox(who)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
        }
    }

    private fun watchInbox(who: Who) {
        inboxWatch?.cancel()
        inboxWatch = viewModelScope.launch {
            ClinicSource.watchThreads(who.clinicId)
                .catch { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
                .collect { threads ->
                    _state.value = _state.value.copy(
                        loading = false,
                        threads = threads,
                        error = null,
                        // Keep the open thread's header in step with the list, or
                        // a hand-off cleared elsewhere still shows as waiting here.
                        open = _state.value.open?.let { o -> threads.firstOrNull { it.id == o.id } ?: o },
                    )
                }
        }
    }

    fun show(filter: Inbox) {
        _state.value = _state.value.copy(filter = filter)
    }

    fun open(thread: Thread) {
        _state.value = _state.value.copy(open = thread, lines = emptyList(), linesLoading = true)
        val who = _state.value.who ?: return
        threadWatch?.cancel()
        threadWatch = viewModelScope.launch {
            ClinicSource.watchLines(who.clinicId, thread.id)
                .catch { e -> _state.value = _state.value.copy(linesLoading = false, error = e.message) }
                .collect { lines ->
                    _state.value = _state.value.copy(lines = lines, linesLoading = false)
                }
        }
    }

    fun close() {
        threadWatch?.cancel()
        threadWatch = null
        _state.value = _state.value.copy(open = null, lines = emptyList())
    }
}

/** The inbox, filled with the design's example data. See [previewDashboard]. */
fun previewChats(): Chats {
    val now = System.currentTimeMillis()
    fun ago(minutes: Int) = now - minutes * 60_000L
    return Chats(
        loading = false,
        who = previewDashboard().who,
        filter = Inbox.All,
        threads = listOf(
            Thread(
                "t1", "+201004428871", "p1", "Mariam Hassan",
                "Is the clinic open on Friday? I need to move my appointment",
                ago(4), "in", 2, needsHuman = true, handoffReason = "Asked to reschedule",
                severity = "normal", botPaused = false, optedOut = false,
                assignedName = "", archived = false,
            ),
            Thread(
                "t2", "+201227710043", "p4", "Khaled Mostafa",
                "My tooth is hurting a lot since last night",
                ago(21), "in", 1, needsHuman = true, handoffReason = "Pain reported",
                severity = "urgent", botPaused = false, optedOut = false,
                assignedName = "", archived = false,
            ),
            Thread(
                "t3", "+201289001122", "p7", "Omar Abdelrahman",
                "Thank you, see you Saturday",
                ago(95), "in", 0, needsHuman = false, handoffReason = "",
                severity = "normal", botPaused = false, optedOut = false,
                assignedName = "Ahmed", archived = false,
            ),
            Thread(
                "t4", "+201112003344", "", "+20 111 200 3344",
                "Your appointment is confirmed for Monday at 11:00 AM.",
                ago(260), "out", 0, needsHuman = false, handoffReason = "",
                severity = "normal", botPaused = false, optedOut = false,
                assignedName = "", archived = false,
            ),
        ),
    )
}

/** One example thread, for looking at the bubbles. */
fun previewThread(): Chats {
    val base = previewChats()
    val now = System.currentTimeMillis()
    fun ago(minutes: Int) = now - minutes * 60_000L
    return base.copy(
        open = base.threads.first(),
        lines = listOf(
            Line("1", "in", "patient", "Hello, is the clinic open on Friday?", ago(12), "", "", "", ""),
            Line("2", "out", "bot", "Hello! We are open Saturday to Thursday, 10 AM to 9 PM. Friday is our day off.", ago(11), "", "", "delivered", ""),
            Line("3", "in", "patient", "I need to move my appointment then", ago(6), "", "", "", ""),
            Line("4", "out", "bot", "Of course — I will ask a colleague to help you with that.", ago(5), "", "", "read", ""),
            Line("5", "in", "patient", "Thank you", ago(4), "", "", "", ""),
        ),
    )
}
