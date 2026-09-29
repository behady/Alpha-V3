package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.AiClinical
import com.alphadental.clinic.data.PatientMedia
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The three things the assistant does inside one file. */
enum class AiSection(val label: String) { Diagnosis("Diagnosis"), Plan("Plan"), Xray("X-rays") }

/**
 * The AI tab of a patient's file.
 *
 * Three jobs that each cost credits, so each one is a tap, never a side-effect of opening the tab:
 * a diagnosis discussion, a proposed treatment plan, and a reading of the x-rays. The server owns
 * every decision — what the patient's records say, what the clinic's plan allows, how many credits
 * are left — and this only carries requests up and results back. That is also why every result
 * arrives as text or as a stored document: nothing here is invented on the phone.
 */
data class AiClinicalState(
    val who: Who? = null,
    val patientId: String = "",
    val patientName: String = "",
    val section: AiSection = AiSection.Diagnosis,
    /** The gallery, for attaching photos to a question and for picking x-rays to read. */
    val media: List<PatientMedia> = emptyList(),

    // ---- diagnosis
    val chats: List<AiClinical.DiagChat> = emptyList(),
    val chatId: String? = null,
    val messages: List<AiClinical.DiagLine> = emptyList(),
    val draft: String = "",
    val thinking: Boolean = false,
    val superMode: Boolean = false,
    /** Gallery pictures going with the next question, by url. */
    val attached: List<PatientMedia> = emptyList(),
    val pickingPhotos: Boolean = false,
    val diagError: String? = null,
    /** A picture is on its way to the file (from this tab or the Photos tab). */
    val uploading: Boolean = false,
    /** Whether this account may add pictures to the file at all. */
    val canUpload: Boolean = false,

    // ---- plan
    val instructions: String = "",
    val planning: Boolean = false,
    val proposal: AiClinical.PlanProposal? = null,
    val answers: String = "",
    val savingOption: Int? = null,
    val planSaved: String? = null,
    val planError: String? = null,

    // ---- x-rays
    val reports: List<AiClinical.XrayRow> = emptyList(),
    val picked: List<String> = emptyList(),
    val note: String = "",
    val deep: Boolean = false,
    val compare: Boolean = false,
    val reading: Boolean = false,
    val viewing: AiClinical.XrayRow? = null,
    val reviewing: Boolean = false,
    val xrayError: String? = null,
) {
    val canUse: Boolean get() = who?.can("clinical.edit") == true

    val diagnosisCredits: Int
        get() = (if (attached.isEmpty()) AiClinical.DIAGNOSIS_CREDITS else AiClinical.DIAGNOSIS_WITH_PHOTOS_CREDITS) *
            (if (superMode) AiClinical.SUPER_MULTIPLIER else 1)

    val planCredits: Int
        get() = AiClinical.PLAN_CREDITS * (if (superMode) AiClinical.SUPER_MULTIPLIER else 1)

    val xrayCredits: Int
        get() = AiClinical.XRAY_CREDITS * (if (deep) AiClinical.SUPER_MULTIPLIER else 1)

    /** Radiographs first: that is what this section reads. Photographs stay pickable below them. */
    val xrayCandidates: List<PatientMedia>
        get() = media.sortedBy { if (it.category in RADIOGRAPH_CATEGORIES) 0 else 1 }

    private companion object {
        val RADIOGRAPH_CATEGORIES = setOf("X-Ray", "Panoramic", "CT Scan")
    }
}

class AiClinicalModel : ViewModel() {

    private val _state = MutableStateFlow(AiClinicalState())
    val state: StateFlow<AiClinicalState> = _state.asStateFlow()

    fun open(who: Who, patientId: String, patientName: String) {
        if (_state.value.patientId == patientId && _state.value.who != null) return
        _state.value = AiClinicalState(who = who, patientId = patientId, patientName = patientName)
        refresh()
    }

    fun show(section: AiSection) {
        _state.value = _state.value.copy(section = section)
    }

    private fun refresh() {
        val s = _state.value
        val who = s.who ?: return
        viewModelScope.launch {
            val media = runCatching { Repository.loadPatientMedia(who.clinicId, s.patientId) }.getOrDefault(emptyList())
            val chats = runCatching { AiClinical.loadDiagnosisChats(who.clinicId, s.patientId) }.getOrDefault(emptyList())
            val reports = runCatching { AiClinical.loadXrayReports(who.clinicId, s.patientId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(media = media, chats = chats, reports = reports)
        }
    }

    // ------------------------------------------------------------------ diagnosis

    fun type(text: String) {
        _state.value = _state.value.copy(draft = text)
    }

    fun setSuper(on: Boolean) {
        _state.value = _state.value.copy(superMode = on)
    }

    fun pickPhotos(open: Boolean) {
        _state.value = _state.value.copy(pickingPhotos = open)
    }

    /**
     * The file's gallery changed under us.
     *
     * The patient's file owns the upload; this tab only watches. A picture that was not in the
     * list before is the one just added, so it is attached to the question (diagnosis) or picked
     * for the read (x-rays) — which is what the person who just took it meant.
     */
    fun mediaChanged(media: List<PatientMedia>, uploading: Boolean, canUpload: Boolean) {
        val s = _state.value
        // The file reads its gallery lazily; an empty list before it has is not "no pictures".
        if (media.isEmpty() && s.media.isNotEmpty()) {
            _state.value = s.copy(uploading = uploading, canUpload = canUpload)
            return
        }
        val known = s.media.map { it.id }.toSet()
        val fresh = media.filter { it.id !in known }
        var next = s.copy(media = media, uploading = uploading, canUpload = canUpload)
        if (known.isNotEmpty() && fresh.isNotEmpty()) {
            val newest = fresh.first()
            next = when (s.section) {
                AiSection.Diagnosis ->
                    if (s.attached.size < AiClinical.DIAGNOSIS_MAX_IMAGES) next.copy(attached = s.attached + newest, pickingPhotos = true) else next
                AiSection.Xray ->
                    if (s.picked.size < AiClinical.XRAY_MAX_IMAGES) next.copy(picked = s.picked + newest.id) else next
                else -> next
            }
        }
        _state.value = next
    }

    fun toggleAttached(item: PatientMedia) {
        val current = _state.value.attached
        val next = if (current.any { it.id == item.id }) current.filterNot { it.id == item.id }
        else if (current.size >= AiClinical.DIAGNOSIS_MAX_IMAGES) current
        else current + item
        _state.value = _state.value.copy(attached = next)
    }

    /** Continue an earlier discussion, or start over. */
    fun openChat(chat: AiClinical.DiagChat?) {
        _state.value = _state.value.copy(
            chatId = chat?.id,
            messages = chat?.messages.orEmpty(),
            superMode = chat?.mode == "super",
            diagError = null,
        )
    }

    fun ask(summarize: Boolean = false) {
        val s = _state.value
        val who = s.who ?: return
        val text = if (summarize) "Write the diagnostic summary." else s.draft.trim()
        if (!s.canUse || s.thinking || (!summarize && text.isEmpty())) return

        val mine = AiClinical.DiagLine("user", text, s.attached.map { it.url })
        val history = s.messages
        _state.value = s.copy(
            messages = history + mine,
            draft = "",
            thinking = true,
            diagError = null,
            attached = emptyList(),
            pickingPhotos = false,
        )

        viewModelScope.launch {
            runCatching {
                AiClinical.diagnose(
                    clinicId = who.clinicId,
                    patientId = s.patientId,
                    message = if (summarize) "" else text,
                    history = history,
                    imageUrls = mine.images,
                    superMode = s.superMode,
                    summarize = summarize,
                )
            }
                .onSuccess { reply ->
                    val all = _state.value.messages + AiClinical.DiagLine("assistant", reply)
                    _state.value = _state.value.copy(messages = all, thinking = false)
                    // Kept, the way the website keeps it, so the desk can read what the chair
                    // discussed. A save that fails leaves the conversation on screen regardless.
                    val id = runCatching {
                        AiClinical.saveDiagnosisChat(
                            clinicId = who.clinicId,
                            chatId = _state.value.chatId,
                            patientId = s.patientId,
                            patientName = s.patientName,
                            messages = all,
                            mode = if (s.superMode) "super" else "power",
                            byUid = who.uid,
                            byName = who.name,
                        )
                    }.getOrNull()
                    if (id != null) _state.value = _state.value.copy(chatId = id)
                    _state.value = _state.value.copy(
                        chats = runCatching { AiClinical.loadDiagnosisChats(who.clinicId, s.patientId) }
                            .getOrDefault(_state.value.chats),
                    )
                }
                .onFailure { e ->
                    // The question stays in the box, and the photos stay attached: retyping after
                    // a dropped connection is the kind of small insult that stops people using it.
                    _state.value = _state.value.copy(
                        thinking = false,
                        messages = history,
                        draft = if (summarize) "" else text,
                        attached = s.attached,
                        diagError = e.message ?: "The assistant could not be reached.",
                    )
                }
        }
    }

    // ------------------------------------------------------------------ plan

    fun instruct(text: String) {
        _state.value = _state.value.copy(instructions = text)
    }

    fun answer(text: String) {
        _state.value = _state.value.copy(answers = text)
    }

    /** First round, or — when there is already a proposal and answers — the refinement round. */
    fun propose(refine: Boolean = false) {
        val s = _state.value
        val who = s.who ?: return
        if (!s.canUse || s.planning) return
        _state.value = s.copy(planning = true, planError = null, planSaved = null)

        viewModelScope.launch {
            runCatching {
                AiClinical.proposePlan(
                    clinicId = who.clinicId,
                    patientId = s.patientId,
                    instructions = s.instructions,
                    superMode = s.superMode,
                    previous = if (refine) s.proposal?.let(AiClinical::describe) else null,
                    answers = if (refine) s.answers else null,
                )
            }
                .onSuccess { _state.value = _state.value.copy(planning = false, proposal = it, answers = "") }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        planning = false,
                        planError = e.message ?: "No plan could be proposed.",
                    )
                }
        }
    }

    fun saveOption(index: Int) {
        val s = _state.value
        val who = s.who ?: return
        val proposal = s.proposal ?: return
        val option = proposal.options.getOrNull(index) ?: return
        if (!s.canUse || s.savingOption != null) return
        _state.value = s.copy(savingOption = index, planError = null, planSaved = null)

        viewModelScope.launch {
            runCatching {
                AiClinical.savePlanOption(
                    clinicId = who.clinicId,
                    patientId = s.patientId,
                    patientName = s.patientName,
                    option = option,
                    currency = proposal.currency,
                    byUid = who.uid,
                    byName = who.name,
                )
            }
                .onSuccess {
                    _state.value = _state.value.copy(
                        savingOption = null,
                        planSaved = "\"${option.title}\" is on the file as a draft plan. " +
                            "Open Plans to price anything marked unmatched.",
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        savingOption = null,
                        planError = e.message ?: "That plan could not be saved.",
                    )
                }
        }
    }

    // ------------------------------------------------------------------ x-rays

    fun togglePicked(id: String) {
        val current = _state.value.picked
        val next = when {
            id in current -> current - id
            current.size >= AiClinical.XRAY_MAX_IMAGES -> current
            else -> current + id
        }
        _state.value = _state.value.copy(picked = next)
    }

    fun noteXray(text: String) {
        _state.value = _state.value.copy(note = text)
    }

    fun setDeep(on: Boolean) {
        _state.value = _state.value.copy(deep = on)
    }

    fun setCompare(on: Boolean) {
        _state.value = _state.value.copy(compare = on)
    }

    fun read() {
        val s = _state.value
        val who = s.who ?: return
        if (!s.canUse || s.reading || s.picked.isEmpty()) return
        if (s.compare && s.picked.size != 2) {
            _state.value = s.copy(xrayError = "Comparing over time needs exactly two pictures, older first.")
            return
        }
        _state.value = s.copy(reading = true, xrayError = null)

        viewModelScope.launch {
            runCatching {
                AiClinical.readXrays(
                    clinicId = who.clinicId,
                    patientId = s.patientId,
                    mediaIds = s.picked,
                    note = s.note,
                    deep = s.deep,
                    compare = s.compare,
                )
            }
                .onSuccess { reportId ->
                    val reports = runCatching { AiClinical.loadXrayReports(who.clinicId, s.patientId) }
                        .getOrDefault(_state.value.reports)
                    _state.value = _state.value.copy(
                        reading = false,
                        picked = emptyList(),
                        note = "",
                        reports = reports,
                        // Straight into the reading, because that is what was paid for.
                        viewing = reports.firstOrNull { it.id == reportId },
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        reading = false,
                        xrayError = e.message ?: "The pictures could not be read.",
                    )
                }
        }
    }

    fun view(row: AiClinical.XrayRow?) {
        _state.value = _state.value.copy(viewing = row, xrayError = null)
    }

    /**
     * Say what the dentist thinks of a finding, chart it, or sign the report.
     *
     * Each is one small merge on the server; the phone re-reads the report afterwards rather than
     * guessing what the merge produced.
     */
    fun review(
        verdicts: Map<String, String> = emptyMap(),
        chart: Map<String, String> = emptyMap(),
        sign: Boolean = false,
    ) {
        val s = _state.value
        val who = s.who ?: return
        val row = s.viewing ?: return
        if (!s.canUse || s.reviewing) return
        _state.value = s.copy(reviewing = true, xrayError = null)

        viewModelScope.launch {
            runCatching { AiClinical.reviewXray(who.clinicId, row.id, verdicts, chart, sign) }
                .onSuccess {
                    val reports = runCatching { AiClinical.loadXrayReports(who.clinicId, s.patientId) }
                        .getOrDefault(_state.value.reports)
                    _state.value = _state.value.copy(
                        reviewing = false,
                        reports = reports,
                        viewing = reports.firstOrNull { it.id == row.id },
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        reviewing = false,
                        xrayError = e.message ?: "That could not be saved.",
                    )
                }
        }
    }

    fun clearErrors() {
        _state.value = _state.value.copy(diagError = null, planError = null, xrayError = null, planSaved = null)
    }
}
