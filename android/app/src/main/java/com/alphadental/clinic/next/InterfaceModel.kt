package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Attendance
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.AppPrefs
import com.alphadental.clinic.next.data.AppPrefsStore
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The app the way this person set it up.
 *
 * One model shared by the shell (which tabs to draw), the dashboard (which home to draw) and the
 * Interface settings page (where it is changed). Held at the session so a change made in Settings
 * is on the bar the moment the person returns, without a restart.
 *
 * Who may pick which home is decided here and nowhere else:
 *
 *   desk     everyone. The dashboard as built — the day's takings, who is waiting, the diary.
 *   dentist  anyone the clinic lists as a dentist, and admins. It is about MY chair, so it is
 *            empty for somebody with no patients.
 *   owner    Owners and Admins only. It shows money across every dentist and who is owed what,
 *            which the website shows only to them.
 */
data class InterfaceState(
    val who: Who? = null,
    val prefs: AppPrefs = AppPrefs(),
    /** My staff record, if the clinic has one for me: the id and whether I am a dentist. */
    val staffId: String = "",
    val staffName: String = "",
    val isDentist: Boolean = false,
    /** Whether the clinic lets dentists see their share of what their patients paid. */
    val shareAllowed: Boolean = true,
    val saving: Boolean = false,
    val error: String? = null,
) {
    val canChooseOwner: Boolean get() = who?.isAdmin == true
    val canChooseDentist: Boolean get() = isDentist || who?.isAdmin == true

    /** The home actually drawn: a choice this person is no longer allowed falls back to the desk. */
    val home: String
        get() = when (prefs.home) {
            "owner" -> if (canChooseOwner) "owner" else "desk"
            "dentist" -> if (canChooseDentist) "dentist" else "desk"
            else -> "desk"
        }

    fun showsTab(tab: Tab): Boolean = tab.name in AppPrefsStore.FIXED_TABS || tab.name !in prefs.hiddenTabs
    fun showsTool(name: String): Boolean = name in AppPrefsStore.FIXED_TOOLS || name !in prefs.hiddenTools
}

class InterfaceModel : ViewModel() {

    private val _state = MutableStateFlow(InterfaceState())
    val state: StateFlow<InterfaceState> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            val who = ClinicSource.signedIn().getOrNull() ?: return@launch
            _state.value = _state.value.copy(who = who)
            val prefs = runCatching { AppPrefsStore.load(who.uid) }.getOrDefault(AppPrefs(loaded = true))
            // Who I am on the staff list decides which homes are mine to pick.
            val staffId = runCatching { Repository.findMyStaffId(who.clinicId, who.uid, who.email) }.getOrDefault("")
            val me = runCatching { Attendance.loadStaff(who.clinicId) }.getOrDefault(emptyList())
                .firstOrNull { it.id == staffId || (it.uid.isNotBlank() && it.uid == who.uid) }
            val share = runCatching { com.alphadental.clinic.data.ClinicSettings.loadDentistShowShare(who.clinicId) }.getOrDefault(true)
            _state.value = _state.value.copy(
                prefs = prefs,
                staffId = staffId,
                staffName = me?.name.orEmpty(),
                isDentist = me?.isDentist == true,
                shareAllowed = share,
            )
        }
    }

    fun setHome(home: String) = change { it.copy(home = home) }

    fun toggleTab(tab: Tab) = change { p ->
        if (tab.name in AppPrefsStore.FIXED_TABS) p
        else p.copy(hiddenTabs = if (tab.name in p.hiddenTabs) p.hiddenTabs - tab.name else p.hiddenTabs + tab.name)
    }

    fun toggleTool(name: String) = change { p ->
        if (name in AppPrefsStore.FIXED_TOOLS) p
        else p.copy(hiddenTools = if (name in p.hiddenTools) p.hiddenTools - name else p.hiddenTools + name)
    }

    /**
     * Applied on screen first, written second.
     *
     * A preference is the one kind of write where optimism is right: the person can see the
     * result immediately, and if the write fails the screen says so and puts it back.
     */
    private fun change(edit: (AppPrefs) -> AppPrefs) {
        val who = _state.value.who ?: return
        val before = _state.value.prefs
        val after = edit(before)
        if (after == before) return
        _state.value = _state.value.copy(prefs = after, saving = true, error = null)
        viewModelScope.launch {
            AppPrefsStore.save(who.uid, after)
                .onSuccess { _state.value = _state.value.copy(saving = false) }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        prefs = before, saving = false,
                        error = e.message ?: "That could not be saved.",
                    )
                }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}

/**
 * The preview's stand-in for [InterfaceModel]: one editable state, shared by the shell and the
 * settings page, so the walkthrough can change a home or hide a tab and watch it happen.
 */
object PreviewInterface {
    private val holder = androidx.compose.runtime.mutableStateOf(
        InterfaceState(
            who = previewDashboard().who,
            prefs = AppPrefs(loaded = true),
            staffId = "s1",
            staffName = "Dr. Youssef",
            isDentist = true,
        ),
    )
    var state: InterfaceState
        get() = holder.value
        set(v) { holder.value = v }
}
