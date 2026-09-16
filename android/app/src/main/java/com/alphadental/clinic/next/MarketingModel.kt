package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.ai.MarketingClient
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class StudioTab(val label: String) {
    Write("Write"),
    Library("Saved"),
}

data class Studio(
    val loading: Boolean = true,
    val who: Who? = null,
    val tab: StudioTab = StudioTab.Write,

    val kind: String = "post",
    /** The language of the POST, not of the app. */
    val language: String = "ar",
    val goal: String = "awareness",
    val service: String = "",
    val occasion: String = "",
    val tone: String = "friendly",
    val offer: String = "",
    val notes: String = "",

    val services: List<String> = emptyList(),
    val variants: List<MarketingClient.Variant> = emptyList(),
    val library: List<MarketingClient.SavedItem> = emptyList(),

    val generating: Boolean = false,
    val savingTitle: String = "",
    val saved: String? = null,
    val error: String? = null,
) {
    /** The same key the website's marketing page is behind. */
    val canUse: Boolean get() = who?.can("access.marketing") == true
}

/**
 * The content studio, on the phone.
 *
 * The idea for a post turns up in the surgery, looking at a result somebody is
 * proud of — not at a desk an hour later when it has gone. So the four questions
 * the website asks are asked here, the same server route writes the piece, and
 * what comes back is text to copy.
 *
 * Nothing is published from here, and that is deliberate rather than unfinished:
 * a clinic's Instagram account stays in the clinic's hands. The phone's own
 * share sheet is how the words get to it.
 *
 * Generating costs the clinic AI credits, so it only ever happens on a tap.
 */
class MarketingModel : ViewModel() {

    private val _state = MutableStateFlow(Studio())
    val state: StateFlow<Studio> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    val services = runCatching { Repository.loadServices(who.clinicId) }
                        .getOrDefault(emptyList())
                        .map { it.name }
                        .filter { it.isNotBlank() }
                    _state.value = _state.value.copy(services = services.take(24))
                    refreshLibrary()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
        }
    }

    fun show(tab: StudioTab) {
        _state.value = _state.value.copy(tab = tab, error = null)
        if (tab == StudioTab.Library) refreshLibrary()
    }

    fun setKind(id: String) { _state.value = _state.value.copy(kind = id) }
    fun setLanguage(id: String) { _state.value = _state.value.copy(language = id) }
    fun setGoal(id: String) { _state.value = _state.value.copy(goal = id) }
    fun setService(name: String) { _state.value = _state.value.copy(service = name) }
    fun setOccasion(id: String) { _state.value = _state.value.copy(occasion = id) }
    fun setTone(id: String) { _state.value = _state.value.copy(tone = id) }
    fun setOffer(text: String) { _state.value = _state.value.copy(offer = text) }
    fun setNotes(text: String) { _state.value = _state.value.copy(notes = text) }

    fun generate() {
        val s = _state.value
        val who = s.who ?: return
        if (!s.canUse || s.generating) return
        _state.value = s.copy(generating = true, error = null, variants = emptyList(), saved = null)
        viewModelScope.launch {
            runCatching {
                MarketingClient.generate(
                    clinicId = who.clinicId,
                    kind = s.kind,
                    language = s.language,
                    goal = s.goal,
                    serviceName = s.service,
                    occasion = s.occasion,
                    tone = s.tone,
                    offer = s.offer,
                    notes = s.notes,
                )
            }
                .onSuccess { variants ->
                    _state.value = _state.value.copy(generating = false, variants = variants)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        generating = false,
                        error = e.message ?: "That could not be written.",
                    )
                }
        }
    }

    fun save(variant: MarketingClient.Variant) {
        val s = _state.value
        val who = s.who ?: return
        if (s.savingTitle.isNotBlank()) return
        _state.value = s.copy(savingTitle = variant.title, error = null)
        viewModelScope.launch {
            MarketingClient.save(
                clinicId = who.clinicId,
                variant = variant,
                kind = s.kind,
                language = s.language,
                goal = s.goal,
                serviceName = s.service,
                occasion = s.occasion,
                tone = s.tone,
                uid = who.uid,
                byName = who.name,
            )
                .onSuccess {
                    _state.value = _state.value.copy(savingTitle = "", saved = "Saved to the library.")
                    refreshLibrary()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        savingTitle = "",
                        error = e.message ?: "That could not be saved.",
                    )
                }
        }
    }

    private fun refreshLibrary() = viewModelScope.launch {
        val who = _state.value.who ?: return@launch
        val items = runCatching { MarketingClient.library(who.clinicId) }.getOrNull() ?: return@launch
        _state.value = _state.value.copy(library = items)
    }

    fun dismiss() {
        _state.value = _state.value.copy(error = null, saved = null)
    }
}
