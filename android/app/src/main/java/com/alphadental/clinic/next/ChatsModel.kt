package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.ai.ChatReplyClient
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
    /** A reply is in flight. */
    val sending: Boolean = false,
    /** What the last send actually did, in the person's own words. */
    val sent: String? = null,
    val sendError: String? = null,
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

    /** Replying is a clinic-facing act; the same key that opens the inbox allows it. */
    val canReply: Boolean get() = who?.can("access.marketing") == true || who?.isAdmin == true

    /**
     * When the patient last wrote.
     *
     * The whole composer hangs off this. Meta only delivers free text for
     * twenty-four hours after a patient's own message; past that a typed reply
     * is accepted, charged for nothing, and never arrives. The one thing that
     * does deliver is the pre-approved template, whose only job is to make them
     * write back and re-open the window.
     */
    val lastInboundAt: Long
        get() = lines.filter { it.fromPatient }.maxOfOrNull { it.at }
            ?: open?.takeIf { it.lastDirection == "in" }?.lastAt
            ?: 0L

    val hoursSincePatient: Long
        get() = if (lastInboundAt <= 0) Long.MAX_VALUE
        else (System.currentTimeMillis() - lastInboundAt) / 3_600_000L

    /** Free text will still be delivered. */
    val windowOpen: Boolean get() = hoursSincePatient < 24

    /** Hours left before free text stops arriving. Null once it has closed. */
    val windowHoursLeft: Long? get() = if (windowOpen) (24 - hoursSincePatient) else null
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

    /**
     * Answer a patient.
     *
     * The POST is the website's own reply route, which also writes the line into
     * the thread, tells the bot to stand down for an hour, and files the answer
     * as a lesson for it. None of that is reimplemented here — and the reply
     * cannot be written straight to Firestore anyway: the clinic's number lives
     * on Meta's servers and only the server holds the credentials.
     */
    fun send(text: String) {
        val who = _state.value.who ?: return
        val thread = _state.value.open ?: return
        val body = text.trim()
        if (body.isBlank() || _state.value.sending) return
        if (!_state.value.canReply) return

        // Nothing may be sent to somebody who asked not to be messaged. Not a
        // preference — it is the thing that keeps the number off a ban list.
        if (thread.optedOut) {
            _state.value = _state.value.copy(
                sendError = "This person asked not to be messaged. Nothing can be sent to them.",
            )
            return
        }

        _state.value = _state.value.copy(sending = true, sendError = null, sent = null)
        viewModelScope.launch {
            runCatching {
                ChatReplyClient.sendText(
                    clinicId = who.clinicId,
                    phone = thread.phone,
                    patientId = thread.patientId,
                    patientName = thread.patientName,
                    text = body,
                )
            }
                .onSuccess { result -> _state.value = _state.value.copy(sending = false, sent = describe(result.mode)) }
                .onFailure { e -> _state.value = _state.value.copy(sending = false, sendError = readable(e)) }
        }
    }

    /**
     * Send the re-engagement template.
     *
     * The only thing that arrives once the day is up. It costs money — templates
     * are what Meta bills for, replies inside the window are free — so it is a
     * separate, deliberate button rather than a silent fallback when a typed
     * message would not have delivered.
     */
    fun sendFollowup() {
        val who = _state.value.who ?: return
        val thread = _state.value.open ?: return
        if (_state.value.sending || !_state.value.canReply) return
        if (thread.optedOut) {
            _state.value = _state.value.copy(
                sendError = "This person asked not to be messaged. Nothing can be sent to them.",
            )
            return
        }

        _state.value = _state.value.copy(sending = true, sendError = null, sent = null)
        viewModelScope.launch {
            runCatching {
                ChatReplyClient.sendFollowupTemplate(
                    clinicId = who.clinicId,
                    phone = thread.phone,
                    patientId = thread.patientId,
                    patientName = thread.patientName,
                )
            }
                .onSuccess { result -> _state.value = _state.value.copy(sending = false, sent = describe(result.mode)) }
                .onFailure { e -> _state.value = _state.value.copy(sending = false, sendError = readable(e)) }
        }
    }

    /**
     * What the server did with it, said plainly.
     *
     * "queued" is not "sent". It means the message landed in the manual list for
     * somebody to forward by hand, and a receptionist who reads that as delivered
     * will tell a patient something untrue. This cost a clinic four replies
     * nobody ever received.
     */
    private fun describe(mode: String): String = when (mode) {
        "auto" -> "Sent."
        "queued", "manual" ->
            "Not sent yet — it is waiting in the manual send list on the website."
        "blocked" -> "Blocked before sending."
        else -> "Sent."
    }

    fun clearSendResult() {
        _state.value = _state.value.copy(sent = null, sendError = null)
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.isBlank() -> "The message could not be sent."
            raw.contains("offline", true) || raw.contains("Unable to resolve host", true) ->
                "No connection. Nothing was sent."
            // The route's own sentences are written for the person reading them.
            else -> raw
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
