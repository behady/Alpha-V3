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
 * Who is signed in.
 *
 * The whole of the More tab is drawn from this one value: which tools appear is
 * decided by the granted keys on it, so a screen nobody may open is never
 * offered rather than offered and refused.
 */
class MoreModel : ViewModel() {

    private val _state = MutableStateFlow<Who?>(null)
    val state: StateFlow<Who?> = _state.asStateFlow()

    fun start() {
        if (_state.value != null) return
        viewModelScope.launch {
            _state.value = ClinicSource.signedIn().getOrNull()
        }
    }
}
