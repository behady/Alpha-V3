package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Notifications
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AlertInbox(
    val loading: Boolean = true,
    val who: Who? = null,
    val alerts: List<Notifications.Alert> = emptyList(),
    val error: String? = null,
) {
    private val uid: String get() = who?.uid.orEmpty()

    /** Everything addressed to me that I have not hidden. */
    val visible: List<Notifications.Alert> get() = alerts.filter { it.visibleTo(uid) }
    val unread: Int get() = visible.count { it.unreadFor(uid) }
    fun isUnread(a: Notifications.Alert) = a.unreadFor(uid)
}

/**
 * The bell's list. A listener, because the whole point of an alert is that it arrives.
 *
 * Opening the list marks what is on it as read, as the website does — the badge is "you have not
 * looked", not "you have not acted". Dismissing hides a row for me only.
 */
class InboxModel : ViewModel() {

    private val _state = MutableStateFlow(AlertInbox())
    val state: StateFlow<AlertInbox> = _state.asStateFlow()
    private var watch: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    watch?.cancel()
                    watch = viewModelScope.launch {
                        Notifications.observeMine(who.clinicId, who.uid).collect { result ->
                            result
                                .onSuccess { rows -> _state.value = _state.value.copy(loading = false, alerts = rows, error = null) }
                                .onFailure { e ->
                                    _state.value = _state.value.copy(
                                        loading = false,
                                        error = when {
                                            e.message?.contains("index", true) == true ->
                                                "The alerts list is not switched on for this clinic yet — the website's bell needs the same setup. Ask whoever runs the system."
                                            e.message?.contains("PERMISSION_DENIED", true) == true ->
                                                "This account is not allowed to read the clinic's alerts."
                                            else -> "The alerts could not be read."
                                        },
                                    )
                                }
                        }
                    }
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    /** Called when the list is on screen: what is visible is now seen. */
    fun markAllRead() {
        val who = _state.value.who ?: return
        val ids = _state.value.visible.filter { it.unreadFor(who.uid) }.map { it.id }
        if (ids.isEmpty()) return
        viewModelScope.launch { Notifications.markRead(who.clinicId, who.uid, ids) }
    }

    fun dismiss(id: String) {
        val who = _state.value.who ?: return
        viewModelScope.launch {
            Notifications.dismiss(who.clinicId, who.uid, listOf(id))
                .onFailure { _state.value = _state.value.copy(error = "That could not be hidden.") }
        }
    }

    fun dismissAll() {
        val who = _state.value.who ?: return
        val ids = _state.value.visible.map { it.id }
        if (ids.isEmpty()) return
        viewModelScope.launch {
            Notifications.dismiss(who.clinicId, who.uid, ids)
                .onFailure { _state.value = _state.value.copy(error = "The list could not be cleared.") }
        }
    }
}

/** The bell, filled with example rows. See [previewDashboard]. */
fun previewInbox(): AlertInbox {
    val now = System.currentTimeMillis()
    fun row(id: String, title: String, body: String, group: String, url: String, minutesAgo: Int, read: Boolean = false) =
        Notifications.Alert(id, title, body, "", group, url, if (read) listOf("me") else emptyList(), emptyList(), now - minutesAgo * 60_000L)
    return AlertInbox(
        loading = false,
        who = previewDashboard().who,
        alerts = listOf(
            row("1", "A paid lead is waiting", "Mariam from the Instagram whitening ad has not been called for 20 minutes.", "leads", "/leads", 20),
            row("2", "MAD-0142 is 3 days late", "Cairo Dental Lab has not returned Mariam Hassan's zirconia crown.", "clinic", "/lab", 95),
            row("3", "Tomorrow: 4 visits unconfirmed", "Reminders went out; four people have not answered.", "frontdesk", "/appointments", 240, read = true),
            row("4", "Yesterday, in three lines", "Cash 12,400 EGP, 9 patients seen, 1 no-show. Ahead of last Tuesday.", "reports", "/", 600, read = true),
        ),
    )
}
