package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.ai.BriefingClient
import com.alphadental.clinic.ai.IntelligenceClient
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class ScanTab(val label: String) {
    Brief("This morning"),
    Dormant("Stopped coming"),
    Money("Money left behind"),
}

data class Assistant(
    val loading: Boolean = true,
    val who: Who? = null,
    val tab: ScanTab = ScanTab.Brief,

    val brief: BriefingClient.Briefing? = null,
    val dormant: IntelligenceClient.DormancyReport? = null,
    val revenue: IntelligenceClient.RecoveryReport? = null,

    val running: Boolean = false,
    val error: String? = null,
) {
    /**
     * Who may look.
     *
     * The dormancy scan is a patient list and the revenue scan is the clinic's
     * money, so this follows the two keys the website puts them behind rather
     * than one blanket "AI" permission.
     */
    val canSeePatients: Boolean get() = who?.can("access.patients") == true
    val canSeeMoney: Boolean get() = who?.can("access.finance") == true

    fun allowed(tab: ScanTab): Boolean = when (tab) {
        ScanTab.Brief -> true
        ScanTab.Dormant -> canSeePatients
        ScanTab.Money -> canSeeMoney
    }
}

/**
 * The three things the assistant can tell a clinic that reading a screen cannot.
 *
 * Each one is a server call and each one costs the clinic credits, so none of
 * them run on their own. The morning brief is the exception worth making: it is
 * what somebody opens the app for at eight o'clock, so it loads once when the
 * screen opens and not again until asked.
 *
 * Every figure keeps the server's own caveats with it. "No recent activity" is
 * not the same as "overdue" — this system records no payment due dates — and a
 * number that arrives with a caveat must not be repeated without it.
 */
class AssistantModel : ViewModel() {

    private val _state = MutableStateFlow(Assistant())
    val state: StateFlow<Assistant> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    runBrief()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
        }
    }

    fun show(tab: ScanTab) {
        _state.value = _state.value.copy(tab = tab, error = null)
    }

    fun run(tab: ScanTab) {
        if (_state.value.running) return
        when (tab) {
            ScanTab.Brief -> runBrief()
            ScanTab.Dormant -> runDormant()
            ScanTab.Money -> runRevenue()
        }
    }

    private fun runBrief() = scan {
        val who = _state.value.who ?: return@scan
        val brief = BriefingClient.load(who.clinicId)
        _state.value = _state.value.copy(brief = brief)
    }

    private fun runDormant() = scan {
        val who = _state.value.who ?: return@scan
        if (!_state.value.canSeePatients) return@scan
        val report = IntelligenceClient.scanDormant(who.clinicId)
        _state.value = _state.value.copy(dormant = report)
    }

    private fun runRevenue() = scan {
        val who = _state.value.who ?: return@scan
        if (!_state.value.canSeeMoney) return@scan
        val report = IntelligenceClient.scanRevenue(who.clinicId)
        _state.value = _state.value.copy(revenue = report)
    }

    private fun scan(work: suspend () -> Unit) {
        _state.value = _state.value.copy(running = true, error = null)
        viewModelScope.launch {
            runCatching { work() }
                .onSuccess { _state.value = _state.value.copy(running = false) }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        running = false,
                        error = e.message ?: "That scan did not come back.",
                    )
                }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}
