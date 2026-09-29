package com.alphadental.clinic.next

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.ai.AiClient
import com.alphadental.clinic.ai.ChatMessage
import com.alphadental.clinic.ai.ChatStore
import com.alphadental.clinic.ai.NavIntent
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The assistant you talk to.
 *
 * The orb on the bar used to open the SCANS screen — three buttons that each run a report and bill
 * a credit for it. Useful, and not what anybody taps a chat bubble expecting. Asking the assistant
 * a question, which is the thing the website's bubble does and the thing this app advertises with
 * a chat icon, had no screen at all.
 *
 * Nothing here decides anything. The model, the clinic's data tools, the permission checks, the
 * credit cap and the staged-action confirmations all live in /api/gemini, and that is the same
 * brain the website talks to. Rebuilding any of it on the phone would mean two assistants that
 * disagree, and an APK somebody could decompile to find a way around the credit cap.
 */
data class AiChat(
    val who: Who? = null,
    val loading: Boolean = true,
    val messages: List<ChatMessage> = emptyList(),
    val draft: String = "",
    /** True while the server is composing a reply. */
    val thinking: Boolean = false,
    val error: String? = null,
    /** An action the assistant has staged and is asking permission to carry out. */
    val pending: AiClient.PendingAction? = null,
    val confirming: Boolean = false,
    /**
     * A screen the assistant asked to open.
     *
     * Held here rather than acted on here: the shell owns navigation, and a ViewModel that could
     * move the app would be a second, quieter router.
     */
    val go: NavIntent.Target? = null,
) {
    val ready: Boolean get() = draft.isNotBlank() && !thinking
}

class AiChatModel : ViewModel() {

    private val _state = MutableStateFlow(AiChat())
    val state: StateFlow<AiChat> = _state.asStateFlow()

    private var store: ChatStore? = null

    /**
     * The appointment the conversation is acting on.
     *
     * Sent back on every turn once the server has named one, because that is what switches it into
     * reception mode — the mode whose tools can actually stage a status change, a reschedule or a
     * payment. Dropped, every acting request dead-ends at "Opened Mariam's appointment…" forever.
     */
    private var appointmentId: String? = null

    fun start(context: Context) {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    // Per clinic AND per user: signing out of one clinic must never show its
                    // conversation to whoever signs in next on the same phone.
                    val kept = ChatStore(context.applicationContext, who.clinicId, who.uid)
                    store = kept
                    _state.value = _state.value.copy(who = who, loading = false, messages = kept.load())
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
        }
    }

    fun type(text: String) {
        _state.value = _state.value.copy(draft = text)
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    /** Consumed by the shell once it has actually moved. */
    fun clearGo() {
        _state.value = _state.value.copy(go = null)
    }

    /** Wipe the transcript on this phone. The server keeps no copy of it either. */
    fun clearChat() {
        appointmentId = null
        store?.save(emptyList())
        _state.value = _state.value.copy(messages = emptyList(), pending = null, error = null)
    }

    fun send(text: String = _state.value.draft) {
        val who = _state.value.who ?: return
        val prompt = text.trim()
        if (prompt.isEmpty() || _state.value.thinking) return

        val history = _state.value.messages
        val mine = ChatMessage(fromUser = true, text = prompt, at = System.currentTimeMillis())
        _state.value = _state.value.copy(
            messages = history + mine,
            draft = "",
            thinking = true,
            error = null,
            pending = null,
        )

        viewModelScope.launch {
            runCatching {
                AiClient.ask(
                    clinicId = who.clinicId,
                    userName = who.name,
                    prompt = prompt,
                    // The history BEFORE this message, because the prompt is sent separately.
                    history = history,
                    voiceMode = false,
                    appointmentId = appointmentId,
                )
            }
                .onSuccess { turn ->
                    turn.selectAppointmentId?.let { appointmentId = it }
                    val reply = ChatMessage(
                        fromUser = false,
                        text = turn.reply,
                        at = System.currentTimeMillis(),
                        appointmentId = turn.selectAppointmentId,
                    )
                    val all = _state.value.messages + reply
                    store?.save(all)
                    _state.value = _state.value.copy(
                        messages = all,
                        thinking = false,
                        pending = turn.pending,
                        // A path this app has no screen for comes back null, and the reply says so
                        // in words — better than opening something else and calling it done.
                        go = NavIntent.fromWebPath(turn.navigateTo),
                    )
                }
                .onFailure { e ->
                    // The failed question stays on screen. Retyping it after a dropped connection
                    // is the kind of small insult that stops people using a thing.
                    _state.value = _state.value.copy(
                        thinking = false,
                        error = e.message ?: "The assistant could not be reached.",
                        draft = prompt,
                        messages = history,
                    )
                }
        }
    }

    /**
     * Say yes or no to something the assistant staged.
     *
     * Only the action's id goes back. The server carries out what it recorded when it staged the
     * action, never a re-reading of it — so what is approved is exactly what was shown.
     */
    fun answer(approve: Boolean) {
        val who = _state.value.who ?: return
        val pending = _state.value.pending ?: return
        if (_state.value.confirming) return
        _state.value = _state.value.copy(confirming = true)

        viewModelScope.launch {
            runCatching { AiClient.confirm(who.clinicId, who.name, pending.id, approve) }
                .onSuccess { message ->
                    val all = _state.value.messages +
                        ChatMessage(fromUser = false, text = message, at = System.currentTimeMillis())
                    store?.save(all)
                    _state.value = _state.value.copy(messages = all, pending = null, confirming = false)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        confirming = false,
                        error = e.message ?: "That could not be completed.",
                    )
                }
        }
    }
}

/** The chat as the design's example, for the preview. */
fun previewChat(): AiChat = AiChat(
    who = previewDashboard().who,
    loading = false,
    messages = listOf(
        ChatMessage(true, "How many people are booked tomorrow?", System.currentTimeMillis() - 90_000),
        ChatMessage(
            false,
            "Nine, between 10:00 and 18:30. Two of them have not confirmed yet — " +
                "Mariam Hassan at 11:00 and Youssef Adel at 16:00.",
            System.currentTimeMillis() - 85_000,
        ),
        ChatMessage(true, "Who owes the most?", System.currentTimeMillis() - 30_000),
        ChatMessage(
            false,
            "Nadia Farouk, 4,200 EGP across three treatments. The oldest has been open since June.",
            System.currentTimeMillis() - 25_000,
        ),
    ),
)
