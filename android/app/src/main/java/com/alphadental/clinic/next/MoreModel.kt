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
)

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
                .onSuccess { _state.value = MoreState(loading = false, who = it) }
                .onFailure { e ->
                    _state.value = MoreState(loading = false, error = readable(e))
                }
        }
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
