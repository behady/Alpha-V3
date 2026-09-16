package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.data.TreatmentPlans
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One line of a draft plan, while it is being built.
 *
 * [visit] is which appointment the step belongs to, numbered from one. The stored
 * shape groups steps inside visits; a flat list with a number on each line is the
 * same information and is far easier to edit with a thumb than a nested one.
 */
data class PlanLine(
    val id: String,
    val service: Service?,
    val name: String,
    val teeth: String = "",
    val quantity: Int = 1,
    val unitPrice: Double = 0.0,
    val visit: Int = 1,
) {
    val total: Double get() = unitPrice * quantity.coerceAtLeast(1)
}

data class Plans(
    val open: Boolean = false,
    val who: Who? = null,
    val patient: Person? = null,
    val loading: Boolean = false,

    val existing: List<TreatmentPlans.Plan> = emptyList(),
    val services: List<Service> = emptyList(),
    val doctors: List<String> = emptyList(),

    /** Null while looking at the list; a draft while one is being written. */
    val draft: List<PlanLine>? = null,
    val title: String = "",
    val description: String = "",
    val doctor: String = "",
    val query: String = "",

    val saving: Boolean = false,
    val error: String? = null,
    val saved: String? = null,
) {
    val canWrite: Boolean get() = who?.can("clinical.edit") == true
    val isDrafting: Boolean get() = draft != null

    val total: Double get() = draft.orEmpty().sumOf { it.total }

    /** The visits the draft currently splits into, in order. */
    val visits: List<Int> get() = draft.orEmpty().map { it.visit }.distinct().sorted()

    val ready: Boolean
        get() = draft.orEmpty().any { it.name.isNotBlank() } && !saving

    val matches: List<Service>
        get() {
            val q = query.trim().lowercase()
            val all = services.filter { it.name.isNotBlank() }
            return if (q.isEmpty()) all.take(12) else all.filter { it.name.lowercase().contains(q) }.take(12)
        }
}

/**
 * Drawing up a plan, and moving one along.
 *
 * The website calls this the Treatment Plan tab and it is where a dentist puts a
 * course of work to the person in the chair. That conversation happens chairside
 * — which is where the phone is and the desk is not — so this writes plans
 * rather than only listing them.
 *
 * A plan is not a bill. Nothing here posts to the ledger: money is recorded when
 * the treatment is actually done, and a plan the patient declines must leave no
 * trace on their account.
 */
class PlanModel : ViewModel() {

    private val _state = MutableStateFlow(Plans())
    val state: StateFlow<Plans> = _state.asStateFlow()

    fun open(patient: Person) {
        _state.value = Plans(open = true, who = _state.value.who, patient = patient, loading = true)
        viewModelScope.launch {
            val who = _state.value.who ?: ClinicSource.signedIn().getOrElse { e ->
                _state.value = _state.value.copy(loading = false, error = e.message)
                return@launch
            }
            val plans = runCatching { TreatmentPlans.load(who.clinicId, patient.id) }
                .getOrDefault(emptyList())
            val services = runCatching { Repository.loadServices(who.clinicId) }.getOrDefault(emptyList())
            val doctors = runCatching { Repository.loadDoctors(who.clinicId) }
                .getOrDefault(emptyList()).map { it.name }
            _state.value = _state.value.copy(
                who = who,
                loading = false,
                existing = plans,
                services = services,
                doctors = doctors,
                doctor = doctors.firstOrNull { it.equals(who.name, ignoreCase = true) }
                    ?: doctors.firstOrNull().orEmpty(),
            )
        }
    }

    fun close() {
        _state.value = Plans(who = _state.value.who)
    }

    // ------------------------------------------------------------------ draft

    fun startDraft() {
        _state.value = _state.value.copy(
            draft = emptyList(),
            title = "",
            description = "",
            query = "",
            error = null,
        )
    }

    /** Back to the list without saving. */
    fun cancelDraft() {
        _state.value = _state.value.copy(draft = null, error = null)
    }

    fun search(term: String) {
        _state.value = _state.value.copy(query = term)
    }

    fun addStep(service: Service?, typed: String = "") {
        val lines = _state.value.draft ?: return
        val name = service?.name ?: typed.trim()
        if (name.isEmpty()) return
        _state.value = _state.value.copy(
            draft = lines + PlanLine(
                id = TreatmentPlans.newId("step"),
                service = service,
                name = name,
                unitPrice = service?.price ?: 0.0,
                // New steps join the last visit rather than starting a new one.
                // A plan is usually several things in one appointment, and
                // splitting is the deliberate act.
                visit = lines.lastOrNull()?.visit ?: 1,
            ),
            query = "",
        )
    }

    fun setTeeth(id: String, teeth: String) = edit(id) { it.copy(teeth = teeth) }

    fun setQuantity(id: String, quantity: Int) =
        edit(id) { it.copy(quantity = quantity.coerceIn(1, 32)) }

    fun setPrice(id: String, price: Double) = edit(id) { it.copy(unitPrice = price.coerceAtLeast(0.0)) }

    fun setVisit(id: String, visit: Int) = edit(id) { it.copy(visit = visit.coerceIn(1, 20)) }

    private fun edit(id: String, change: (PlanLine) -> PlanLine) {
        val lines = _state.value.draft ?: return
        _state.value = _state.value.copy(draft = lines.map { if (it.id == id) change(it) else it })
    }

    fun removeStep(id: String) {
        val lines = _state.value.draft ?: return
        _state.value = _state.value.copy(draft = lines.filterNot { it.id == id })
    }

    fun setTitle(text: String) {
        _state.value = _state.value.copy(title = text)
    }

    fun setDescription(text: String) {
        _state.value = _state.value.copy(description = text)
    }

    fun setDoctor(name: String) {
        _state.value = _state.value.copy(doctor = name)
    }

    fun save() {
        val s = _state.value
        val who = s.who ?: return
        val patient = s.patient ?: return
        val lines = s.draft ?: return
        if (!s.canWrite || !s.ready) return

        // Flat lines back into the stored shape: one Visit per number used, in
        // order, holding the steps that named it.
        val visits = lines
            .groupBy { it.visit }
            .toSortedMap()
            .map { (number, group) ->
                TreatmentPlans.Visit(
                    id = TreatmentPlans.newId("visit"),
                    label = "Visit $number",
                    steps = group.map { line ->
                        TreatmentPlans.Step(
                            id = line.id,
                            serviceId = line.service?.id.orEmpty(),
                            serviceName = line.name,
                            teeth = line.teeth.trim(),
                            quantity = line.quantity,
                            unitPrice = line.unitPrice,
                            estimatedMinutes = line.service?.durationMinutes ?: 0,
                        )
                    },
                )
            }

        _state.value = s.copy(saving = true, error = null, saved = null)
        viewModelScope.launch {
            TreatmentPlans.save(
                clinicId = who.clinicId,
                planId = "",
                patientId = patient.id,
                patientName = patient.name,
                title = s.title.ifBlank { "Treatment plan" },
                description = s.description,
                visits = visits,
                currency = "EGP",
                doctorName = s.doctor.ifBlank { who.name },
                uid = who.uid,
            )
                .onSuccess {
                    _state.value = _state.value.copy(saving = false, draft = null, saved = "Plan saved as a draft.")
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        saving = false,
                        error = e.message ?: "That plan could not be saved.",
                    )
                }
        }
    }

    /**
     * Drafted, put to the patient, accepted, turned down.
     *
     * The status is the whole value of a plan on a phone: the dentist shows the
     * screen, the patient says yes, and it is marked accepted there and then
     * rather than remembered until somebody reaches a desk.
     */
    fun setStatus(planId: String, status: String) {
        val who = _state.value.who ?: return
        if (!_state.value.canWrite || _state.value.saving) return
        _state.value = _state.value.copy(saving = true, error = null)
        viewModelScope.launch {
            TreatmentPlans.setStatus(who.clinicId, planId, status)
                .onSuccess {
                    _state.value = _state.value.copy(
                        saving = false,
                        saved = "Marked ${TreatmentPlans.statusLabel(status, arabic = false).lowercase()}.",
                    )
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        saving = false,
                        error = e.message ?: "That could not be saved.",
                    )
                }
        }
    }

    private fun reload() = viewModelScope.launch {
        val who = _state.value.who ?: return@launch
        val patient = _state.value.patient ?: return@launch
        val plans = runCatching { TreatmentPlans.load(who.clinicId, patient.id) }.getOrNull() ?: return@launch
        _state.value = _state.value.copy(existing = plans)
    }

    fun clearSaved() {
        _state.value = _state.value.copy(saved = null, error = null)
    }
}
