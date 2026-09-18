package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Who is signed in, and whether we actually know.
 *
 * The third state is the point of this being a class rather than a nullable
 * `Who`. Every tool on the More tab is drawn from the granted keys on that
 * value, so a `Who` that is null because the read has not finished — or failed —
 * used to be indistinguishable from an account that may open nothing. The menu
 * quietly lost Money, Reports, Lab, Auto SMS and Settings for a second on a slow
 * connection, and permanently on a failed one, with nothing on screen to say
 * why. Not knowing is not the same as not allowed.
 */
data class MoreState(
    val loading: Boolean = true,
    val who: Who? = null,
    val error: String? = null,
    /**
     * Every clinic this account works at.
     *
     * Always read, even when there is only one, because the ANSWER is what was missing: somebody
     * looking at the wrong clinic's diary could not see which clinic they were in, let alone
     * change it. One entry is still worth showing — it says plainly that this account belongs to
     * one clinic, which turns "the app is stuck" into "I have not been added yet".
     */
    val clinics: List<ClinicSource.Membership> = emptyList(),
    val switching: Boolean = false,
) {
    val clinicName: String
        get() = clinics.firstOrNull { it.id == who?.clinicId }?.name.orEmpty()

    val canSwitch: Boolean get() = clinics.size > 1
}

class MoreModel : ViewModel() {

    private val _state = MutableStateFlow(MoreState())
    val state: StateFlow<MoreState> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        load()
    }

    fun retry() {
        if (_state.value.loading) return
        load()
    }

    private fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = MoreState(loading = false, who = who)
                    _state.value = _state.value.copy(clinics = ClinicSource.myClinics())
                }
                .onFailure { e ->
                    _state.value = MoreState(loading = false, error = readable(e))
                }
        }
    }

    /**
     * Move this phone to another clinic.
     *
     * The choice is stored and then the app is started again from scratch, rather than the state
     * being swapped underneath the screens. Every view model in the app holds its own copy of who
     * is signed in and the lists it read for that clinic — a switch that left any of them behind
     * would show one clinic's patients under another clinic's takings, and that is a far worse
     * failure than a one-second restart.
     */
    fun switchTo(context: android.content.Context, clinicId: String) {
        val who = _state.value.who ?: return
        if (clinicId == who.clinicId || _state.value.switching) return
        _state.value = _state.value.copy(switching = true)
        com.alphadental.clinic.next.data.ClinicChoice.remember(who.uid, clinicId)

        val intent = android.content.Intent(context, com.alphadental.clinic.next.NextActivity::class.java)
            .addFlags(
                android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK or
                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK,
            )
        context.startActivity(intent)
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection, so this phone cannot tell what this account may open yet."
            raw.contains("no profile", true) ->
                "This account has no profile in the clinic system."
            else -> "This account could not be read."
        }
    }
}
