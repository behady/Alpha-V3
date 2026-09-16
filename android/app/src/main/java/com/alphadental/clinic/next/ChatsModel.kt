package com.alphadental.clinic.next

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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

/**
 * A file picked on the phone, waiting for its caption.
 *
 * Held as a Uri rather than bytes: a twenty-megabyte photograph sitting in the
 * view model across a rotation is how a phone runs out of memory holding
 * something it has not decided to send yet.
 */
data class Attachment(
    val uri: android.net.Uri,
    val name: String,
    val mime: String,
    val bytes: Long,
) {
    /** What the reply route calls it: image, video, audio or document. */
    val kind: String get() = com.alphadental.clinic.data.Chats.kindFor(mime)

    val readableSize: String
        get() = when {
            bytes >= 1024 * 1024 -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
            bytes > 0 -> "${bytes / 1024} KB"
            else -> ""
        }
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
    /** A file chosen but not yet sent, so a caption can be typed against it. */
    val attachment: Attachment? = null,
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
/** Cloud Storage refuses anything larger, and says so unhelpfully. */
private const val MAX_UPLOAD_BYTES = 20 * 1024 * 1024

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
     * Take a file the person chose, without reading it yet.
     *
     * Its name, type and size come from the content resolver so the composer can
     * show what is attached and refuse an oversized one before anybody waits on
     * an upload. Storage caps a file at twenty megabytes; hitting that limit
     * comes back as a bare "Upload failed", which tells nobody anything.
     */
    fun attach(context: Context, uri: android.net.Uri) {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri).orEmpty().ifBlank { "application/octet-stream" }
        var name = "file"
        var size = 0L
        runCatching {
            resolver.query(uri, null, null, null, null)?.use { c ->
                val nameAt = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                val sizeAt = c.getColumnIndex(android.provider.OpenableColumns.SIZE)
                if (c.moveToFirst()) {
                    if (nameAt >= 0) name = c.getString(nameAt).orEmpty().ifBlank { "file" }
                    if (sizeAt >= 0 && !c.isNull(sizeAt)) size = c.getLong(sizeAt)
                }
            }
        }

        if (size > MAX_UPLOAD_BYTES) {
            _state.value = _state.value.copy(
                sendError = "That file is ${size / 1024 / 1024} MB. The limit is 20 MB.",
                attachment = null,
            )
            return
        }

        _state.value = _state.value.copy(
            attachment = Attachment(uri, name, mime, size),
            sendError = null,
            sent = null,
        )
    }

    fun clearAttachment() {
        _state.value = _state.value.copy(attachment = null)
    }

    /**
     * Send the attached file, with whatever was typed as its caption.
     *
     * Two steps, and the first is the reason this cannot be one: the file goes
     * into the clinic's own Storage folder, and the server hands Meta the
     * resulting download link rather than the bytes. The route accepts links
     * into that bucket and nowhere else — otherwise the clinic's number would
     * relay anything on the internet.
     *
     * On the unofficial gateway only documents can be forwarded, so a photo
     * comes back refused rather than delivered as a broken link. That refusal is
     * the server's own sentence and is shown as written.
     */
    fun sendAttachment(context: Context, caption: String) {
        val who = _state.value.who ?: return
        val thread = _state.value.open ?: return
        val file = _state.value.attachment ?: return
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
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(file.uri)?.use { it.readBytes() }
                } ?: error("That file could not be read.")
                if (bytes.size > MAX_UPLOAD_BYTES) error("That file is too large. The limit is 20 MB.")

                val url = com.alphadental.clinic.data.Chats.uploadOutbound(
                    clinicId = who.clinicId,
                    bytes = bytes,
                    mime = file.mime,
                    name = file.name,
                )
                ChatReplyClient.sendMedia(
                    clinicId = who.clinicId,
                    phone = thread.phone,
                    patientId = thread.patientId,
                    patientName = thread.patientName,
                    caption = caption.trim(),
                    url = url,
                    mime = file.mime,
                    kind = file.kind,
                    filename = file.name,
                )
            }
                .onSuccess { result ->
                    _state.value = _state.value.copy(
                        sending = false,
                        attachment = null,
                        sent = describe(result.mode),
                    )
                }
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
