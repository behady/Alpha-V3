package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LabOrder(
    val open: Boolean = false,
    val who: Who? = null,
    val loading: Boolean = true,

    val query: String = "",
    val results: List<Person> = emptyList(),
    val searching: Boolean = false,
    val patient: Person? = null,

    val labs: List<LabCases.Lab> = emptyList(),
    val branches: List<LabCases.Branch> = emptyList(),
    val doctors: List<Doctor> = emptyList(),

    val draft: LabCases.Draft = LabCases.Draft(),
    val lab: LabCases.Lab? = null,
    val doctor: Doctor? = null,

    val saving: Boolean = false,
    val error: String? = null,
    val created: String? = null,
) {
    val canRaise: Boolean get() = who?.can("clinical.edit") == true

    /** Which fields this kind of work actually has. */
    val shape: LabCases.WorkType get() = LabCases.workTypeFor(draft.workType)

    /**
     * Enough to send.
     *
     * A patient and a lab. Everything else has a sane default or is genuinely
     * optional — a case can leave the building before its shade is decided, and
     * refusing to record one until every box is filled is how cases end up
     * tracked on a sticky note instead.
     */
    val ready: Boolean
        get() = (patient != null || query.trim().length >= 2) && lab != null && !saving

    /** What this lab charges for this kind of work, when it has been agreed. */
    val listedPrice: Double? get() = lab?.prices?.get(draft.workType)
}

/**
 * Raising a lab order.
 *
 * The half of lab work that happens chairside: the impression is in the
 * dentist's hand and the driver is on the way. Until now this was website-only,
 * which meant the case was written down on paper first and typed up later — and
 * a case typed up later is a case with the wrong date on it.
 *
 * The form asks per kind of work, as the website does: a surgical guide is not
 * asked for a tooth shade, and a denture is asked for a gum one. A form that
 * asks the wrong questions is a form people stop reading.
 */
class LabOrderModel : ViewModel() {

    private val _state = MutableStateFlow(LabOrder())
    val state: StateFlow<LabOrder> = _state.asStateFlow()

    private var searchJob: Job? = null

    fun open(patient: Person? = null) {
        _state.value = LabOrder(
            open = true,
            who = _state.value.who,
            loading = true,
            patient = patient,
            query = patient?.name.orEmpty(),
        )
        viewModelScope.launch {
            val who = _state.value.who ?: ClinicSource.signedIn().getOrElse { e ->
                _state.value = _state.value.copy(loading = false, error = e.message)
                return@launch
            }
            val labs = runCatching { LabCases.loadLabs(who.clinicId) }.getOrDefault(emptyList())
            val branches = runCatching { LabCases.loadBranches(who.clinicId) }.getOrDefault(emptyList())
            val doctors = runCatching { Repository.loadDoctors(who.clinicId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(
                who = who,
                loading = false,
                labs = labs,
                branches = branches,
                doctors = doctors,
            )
            // One lab and one branch is the ordinary clinic. Making somebody pick
            // from a list of one is a tap that teaches nothing.
            labs.singleOrNull()?.let { chooseLab(it) }
            chooseBranch(branches.firstOrNull())
            doctors.firstOrNull { it.name.equals(who.name, ignoreCase = true) }?.let { chooseDoctor(it) }
        }
    }

    fun close() {
        _state.value = LabOrder(who = _state.value.who, loading = false)
    }

    // ------------------------------------------------------------------ who

    fun search(term: String) {
        _state.value = _state.value.copy(query = term, patient = null)
        val who = _state.value.who ?: return
        searchJob?.cancel()
        if (term.trim().length < 2) {
            _state.value = _state.value.copy(results = emptyList(), searching = false)
            return
        }
        searchJob = viewModelScope.launch {
            delay(280)
            _state.value = _state.value.copy(searching = true)
            val hits = runCatching { ClinicSource.searchPeople(who.clinicId, term) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(results = hits.take(6), searching = false)
        }
    }

    fun choose(person: Person?) {
        _state.value = _state.value.copy(
            patient = person,
            query = person?.name.orEmpty(),
            results = emptyList(),
        )
    }

    // ------------------------------------------------------------------ fields

    /**
     * Picking the lab fills the due date from its turnaround.
     *
     * That date is what makes the board's amber and red mean anything. A case
     * with no due date is a case that can never be late, which is the one thing
     * a tracking board exists to notice.
     */
    fun chooseLab(lab: LabCases.Lab?) {
        val s = _state.value
        _state.value = s.copy(
            lab = lab,
            draft = s.draft.copy(
                labId = lab?.id.orEmpty(),
                labName = lab?.name.orEmpty(),
                dueDate = if (lab != null && lab.turnaroundDays > 0) {
                    LabCases.dueInDays(lab.turnaroundDays)
                } else {
                    s.draft.dueDate
                },
                // Only when nobody has typed one. An agreed price for this case
                // beats the standing rate for this kind of work.
                agreedPrice = if (s.draft.agreedPrice > 0) s.draft.agreedPrice
                else lab?.prices?.get(s.draft.workType) ?: 0.0,
                sentVia = if (lab?.driverName.isNullOrBlank()) s.draft.sentVia else "driver",
            ),
        )
    }

    fun chooseBranch(branch: LabCases.Branch?) {
        val index = _state.value.branches.indexOf(branch).coerceAtLeast(0)
        _state.value = _state.value.copy(
            draft = _state.value.draft.copy(
                branchId = branch?.id.orEmpty(),
                branchName = branch?.name.orEmpty(),
                branchCode = LabCases.branchCodeFor(branch, index),
            ),
        )
    }

    fun chooseDoctor(doctor: Doctor?) {
        _state.value = _state.value.copy(
            doctor = doctor,
            draft = _state.value.draft.copy(
                doctorId = doctor?.id.orEmpty(),
                doctorName = doctor?.name.orEmpty(),
            ),
        )
    }

    /**
     * Changing the kind of work resets the answers that no longer apply.
     *
     * Switching from a crown to a surgical guide and leaving A2 behind writes a
     * shade onto a case that has no teeth — and a lab reading that order has to
     * ring the clinic to ask which half is wrong.
     */
    fun setWorkType(id: String) {
        val s = _state.value
        val shape = LabCases.workTypeFor(id)
        _state.value = s.copy(
            draft = s.draft.copy(
                workType = id,
                bodyShade = if (shape.bodyShade) s.draft.bodyShade else "",
                cervicalShade = if (shape.cervicalShade) s.draft.cervicalShade else "",
                gumShade = if (shape.gumShade) s.draft.gumShade else "",
                implantSystem = if (shape.implant) s.draft.implantSystem else "",
                implantPlatform = if (shape.implant) s.draft.implantPlatform else "",
                abutmentType = if (shape.implant) s.draft.abutmentType else "",
                retention = if (shape.implant) s.draft.retention else "",
                guideType = if (shape.guide) s.draft.guideType else "",
                sleeveSystem = if (shape.guide) s.draft.sleeveSystem else "",
                needsTryIn = shape.tryInByDefault,
                sentVia = if (shape.digitalByDefault) "digital" else s.draft.sentVia,
                agreedPrice = s.lab?.prices?.get(id) ?: s.draft.agreedPrice,
            ),
        )
    }

    fun toggleTooth(number: Int) {
        val s = _state.value
        val teeth = if (number in s.draft.teeth) s.draft.teeth - number else s.draft.teeth + number
        _state.value = s.copy(
            draft = s.draft.copy(
                teeth = teeth.sorted(),
                // Units follow the teeth unless somebody has said otherwise. A
                // three-unit bridge spans two abutments, so this is a starting
                // point rather than an answer.
                units = if (s.shape.units) teeth.size else s.draft.units,
            ),
        )
    }

    fun setUnits(units: Int) = edit { it.copy(units = units.coerceIn(0, 32)) }

    fun setBodyShade(shade: String) = edit { it.copy(bodyShade = shade) }

    fun setCervicalShade(shade: String) = edit { it.copy(cervicalShade = shade) }

    fun setGumShade(shade: String) = edit { it.copy(gumShade = shade) }

    fun setMaterial(text: String) = edit { it.copy(material = text) }

    fun setImplantSystem(text: String) = edit { it.copy(implantSystem = text) }

    fun setImplantPlatform(text: String) = edit { it.copy(implantPlatform = text) }

    fun setAbutment(id: String) = edit { it.copy(abutmentType = id) }

    fun setRetention(id: String) = edit { it.copy(retention = id) }

    fun setGuideType(id: String) = edit { it.copy(guideType = id) }

    fun setSleeve(text: String) = edit { it.copy(sleeveSystem = text) }

    fun setNotes(text: String) = edit { it.copy(notes = text) }

    fun setDescription(text: String) = edit { it.copy(workDescription = text) }

    fun setPrice(value: Double) = edit { it.copy(agreedPrice = value.coerceAtLeast(0.0)) }

    fun setSentVia(via: String) = edit { it.copy(sentVia = via) }

    fun setTryIn(needed: Boolean) = edit { it.copy(needsTryIn = needed) }

    fun setDue(dateKey: String) = edit { it.copy(dueDate = dateKey) }

    private fun edit(change: (LabCases.Draft) -> LabCases.Draft) {
        _state.value = _state.value.copy(draft = change(_state.value.draft))
    }

    // ------------------------------------------------------------------ save

    fun send() {
        val s = _state.value
        val who = s.who ?: return
        if (!s.canRaise || !s.ready) return

        _state.value = s.copy(saving = true, error = null)
        viewModelScope.launch {
            val patient = s.patient ?: run {
                // The same rule the booking sheet follows: a name nobody
                // recognises opens a file rather than refusing. A case cannot be
                // raised against nobody, and the lab needs a name on the bag.
                val made = Repository.createPatient(who.clinicId, s.query.trim(), "")
                    .getOrElse { e ->
                        _state.value = _state.value.copy(
                            saving = false,
                            error = e.message ?: "That patient could not be created.",
                        )
                        return@launch
                    }
                Person(id = made.id, name = made.name, phone = made.phone, balance = 0.0)
            }

            LabCases.createCase(
                clinicId = who.clinicId,
                draft = s.draft.copy(
                    patientId = patient.id,
                    patientName = patient.name,
                    patientPhone = patient.phone,
                    sentAt = ClinicSource.dateKey(),
                ),
                by = who.name,
            )
                .onSuccess { made ->
                    _state.value = _state.value.copy(
                        saving = false,
                        open = false,
                        created = "Case ${made.code} is on the board.",
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        saving = false,
                        error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to raise lab cases."
                        } else {
                            e.message ?: "That case could not be saved."
                        },
                    )
                }
        }
    }

    fun clearCreated() {
        _state.value = _state.value.copy(created = null, error = null)
    }
}
