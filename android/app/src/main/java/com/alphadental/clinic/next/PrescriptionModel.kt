package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Patient
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.RxItem
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.DrugPick
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Who
import com.alphadental.clinic.next.data.mergeDrugPicks
import com.alphadental.clinic.next.data.searchDrugPicks
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class Script(
    val open: Boolean = false,
    val who: Who? = null,
    val patient: Person? = null,
    val loading: Boolean = false,

    /** The clinic's list merged over the built-in Egyptian formulary. */
    val library: List<DrugPick> = emptyList(),
    val query: String = "",

    val drugs: List<RxItem> = emptyList(),
    val diagnosis: String = "",
    val doctor: String = "",
    val doctors: List<String> = emptyList(),

    val saving: Boolean = false,
    val error: String? = null,
    val saved: String? = null,
) {
    val canWrite: Boolean get() = who?.can("clinical.edit") == true
    val ready: Boolean get() = drugs.isNotEmpty() && !saving

    /** What the picker shows for what has been typed into it. */
    val matches: List<DrugPick> get() = searchDrugPicks(library, query).take(40)
}

/**
 * Writing a prescription.
 *
 * The medicines come from the clinic's own list merged over the built-in
 * Egyptian formulary — the same merge the website does, from the same file — so
 * a drug the clinic renamed is the one the dentist sees here too.
 *
 * Every line carries both an English and an Arabic dose. That is not a
 * translation nicety: the Arabic line is the one the patient reads off the
 * paper, and a script written on a phone that dropped it would print half a
 * sheet.
 */
class PrescriptionModel : ViewModel() {

    private val _state = MutableStateFlow(Script())
    val state: StateFlow<Script> = _state.asStateFlow()

    /**
     * Open on a patient, optionally with an earlier prescription copied in.
     *
     * "Write again" is how a repeat is done: the old one is left exactly as it
     * was issued, and a new one starts with its medicines, ready to be changed.
     */
    fun open(patient: Person, seed: com.alphadental.clinic.data.Prescription? = null) {
        _state.value = Script(
            open = true,
            who = _state.value.who,
            patient = patient,
            loading = true,
            drugs = seed?.drugs.orEmpty(),
            diagnosis = seed?.diagnosis.orEmpty(),
        )
        viewModelScope.launch {
            val who = _state.value.who ?: ClinicSource.signedIn().getOrElse { e ->
                _state.value = _state.value.copy(loading = false, error = e.message)
                return@launch
            }
            val shortcuts = runCatching { Repository.loadDrugShortcuts(who.clinicId) }
                .getOrDefault(emptyList())
            val doctors = runCatching { Repository.loadDoctors(who.clinicId) }
                .getOrDefault(emptyList())
                .map { it.name }
            _state.value = _state.value.copy(
                who = who,
                loading = false,
                library = mergeDrugPicks(shortcuts),
                doctors = doctors,
                // Whoever is signed in, if they are one of the dentists. A blank
                // prescriber on a printed script is the one field a pharmacy
                // will actually turn somebody away over.
                doctor = _state.value.doctor.ifBlank {
                    doctors.firstOrNull { it.equals(who.name, ignoreCase = true) }
                        ?: doctors.firstOrNull().orEmpty()
                },
            )
        }
    }

    fun close() {
        _state.value = Script(who = _state.value.who)
    }

    fun search(term: String) {
        _state.value = _state.value.copy(query = term)
    }

    /** Add a medicine from the list, with its doses already filled in. */
    fun add(pick: DrugPick) {
        val already = _state.value.drugs.any { it.name.equals(pick.name, ignoreCase = true) }
        if (already) return
        _state.value = _state.value.copy(
            drugs = _state.value.drugs + RxItem(
                name = pick.name,
                dose = pick.dose,
                doseAr = pick.doseAr,
            ),
            query = "",
        )
    }

    /** A medicine that is not on any list. Typed once, used once. */
    fun addTyped(name: String) {
        val clean = name.trim()
        if (clean.isEmpty()) return
        _state.value = _state.value.copy(
            drugs = _state.value.drugs + RxItem(name = clean),
            query = "",
        )
    }

    fun setDose(index: Int, dose: String) = editLine(index) { it.copy(dose = dose) }

    fun setDoseAr(index: Int, dose: String) = editLine(index) { it.copy(doseAr = dose) }

    fun setNote(index: Int, note: String) = editLine(index) { it.copy(note = note) }

    private fun editLine(index: Int, change: (RxItem) -> RxItem) {
        val lines = _state.value.drugs.toMutableList()
        if (index !in lines.indices) return
        lines[index] = change(lines[index])
        _state.value = _state.value.copy(drugs = lines)
    }

    fun remove(index: Int) {
        val lines = _state.value.drugs.toMutableList()
        if (index !in lines.indices) return
        lines.removeAt(index)
        _state.value = _state.value.copy(drugs = lines)
    }

    fun setDiagnosis(text: String) {
        _state.value = _state.value.copy(diagnosis = text)
    }

    fun setDoctor(name: String) {
        _state.value = _state.value.copy(doctor = name)
    }

    fun save() {
        val s = _state.value
        val who = s.who ?: return
        val patient = s.patient ?: return
        if (!s.canWrite || !s.ready) return

        _state.value = s.copy(saving = true, error = null, saved = null)
        viewModelScope.launch {
            Repository.addPrescription(
                clinicId = who.clinicId,
                patient = Patient(id = patient.id, name = patient.name, phone = patient.phone),
                doctor = s.doctor.ifBlank { who.name },
                diagnosis = s.diagnosis,
                drugs = s.drugs,
            )
                .onSuccess {
                    _state.value = _state.value.copy(
                        saving = false,
                        open = false,
                        saved = "Prescription saved to the file.",
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        saving = false,
                        error = e.message ?: "That prescription could not be saved.",
                    )
                }
        }
    }

    fun clearSaved() {
        _state.value = _state.value.copy(saved = null, error = null)
    }
}
