package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.Balance
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Money
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Record
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Tooth
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Which part of the file is showing. */
enum class RecordTab(val label: String) {
    Overview("Overview"),
    Chart("Chart"),
    Visits("Visits"),
    Ledger("Ledger"),
}

/**
 * One thing about a patient that a clinician must know before touching them.
 *
 * Severity is not decoration: an allergy can kill and a blank screening cannot,
 * so they are not allowed to look the same.
 */
data class Alert(val title: String, val detail: String, val severe: Boolean)

data class RecordState(
    val loading: Boolean = true,
    val who: Who? = null,
    val record: Record? = null,
    val tab: RecordTab = RecordTab.Overview,
    /** Which tooth the chart is showing the detail of. */
    val tooth: Int? = null,
    val error: String? = null,
) {
    /**
     * What has to be read before treating this patient.
     *
     * A blank medical history is itself an alert. The website used to default the
     * field to "None (Healthy)" — an assertion of absence no clinician ever made
     * — so a blank one now genuinely means nobody has asked, and saying nothing
     * would let that pass for a clean bill of health.
     */
    val alerts: List<Alert>
        get() {
            val r = record ?: return emptyList()
            return buildList {
                r.allergies.trim().takeIf { it.isNotEmpty() && !it.equals("none", true) }?.let {
                    add(Alert("Allergies", it, severe = true))
                }
                val history = r.medicalHistory.trim()
                when {
                    history.isEmpty() ->
                        add(Alert("Medical history not recorded", "Nobody has screened this patient yet.", severe = false))
                    !history.equals("None (Healthy)", true) ->
                        add(Alert("Medical history", history, severe = false))
                }
            }
        }

    /** Work that has been charged but not settled — what is still open on this file. */
    val charges: List<Money>
        get() = record?.ledger?.filter { it.isCharge }.orEmpty()

    val payments: List<Money>
        get() = record?.ledger?.filterNot { it.isCharge }.orEmpty()
}

/**
 * One patient's file.
 *
 * A one-shot read rather than a listener: a patient record is something somebody
 * sits down with, and a row rewriting itself mid-read is worse than a figure a
 * minute old. Pulling down re-reads it.
 */
class RecordModel : ViewModel() {

    private val _state = MutableStateFlow(RecordState())
    val state: StateFlow<RecordState> = _state.asStateFlow()

    private var patientId: String? = null

    fun open(id: String) {
        if (patientId == id && _state.value.record != null) return
        patientId = id
        _state.value = RecordState(loading = true)
        viewModelScope.launch {
            val who = _state.value.who ?: ClinicSource.signedIn().getOrNull()
            if (who == null) {
                _state.value = _state.value.copy(loading = false, error = "Not signed in.")
                return@launch
            }
            ClinicSource.record(who.clinicId, id)
                .onSuccess { _state.value = _state.value.copy(loading = false, who = who, record = it) }
                .onFailure { _state.value = _state.value.copy(loading = false, who = who, error = it.message) }
        }
    }

    fun show(tab: RecordTab) {
        _state.value = _state.value.copy(tab = tab)
    }

    fun selectTooth(number: Int?) {
        _state.value = _state.value.copy(tooth = number)
    }
}

/** A patient's file, filled with the design's example data. See [previewDashboard]. */
fun previewRecord(): RecordState = RecordState(
    loading = false,
    who = previewDashboard().who,
    record = Record(
        person = Person("p1", "Mariam Hassan", "+20 100 442 8871", 2_400.0),
        fileId = "PT-1482",
        dateOfBirth = "1992-04-11",
        gender = "Female",
        allergies = "Penicillin",
        medicalHistory = "Pregnant, second trimester — no radiographs",
        balance = Balance(charged = 12_700.0, paid = 10_300.0),
        upcoming = listOf(
            Visit("u1", "p1", "Mariam Hassan", "2026-09-21", "10:05 AM", "Dr. Youssef", "Root canal · session 3", Stage.Confirmed, 60),
        ),
        past = listOf(
            Visit("h1", "p1", "Mariam Hassan", "2026-08-21", "10:00 AM", "Dr. Youssef", "Root canal · session 2", Stage.Completed, 60),
            Visit("h2", "p1", "Mariam Hassan", "2026-07-30", "11:30 AM", "Dr. Youssef", "Root canal · session 1", Stage.Completed, 60),
            Visit("h3", "p1", "Mariam Hassan", "2026-06-02", "09:00 AM", "Dr. Nour", "Scale & polish", Stage.Completed, 30),
        ),
        ledger = listOf(
            Money("m1", "2026-08-21", "payment", "Part payment", 1_500.0, "Cash", "Dr. Youssef"),
            Money("m2", "2026-08-21", "procedure", "Root canal · UR6", 3_200.0, "", "Dr. Youssef"),
            Money("m3", "2026-07-30", "procedure", "Crown · UR6", 4_500.0, "", "Dr. Youssef"),
            Money("m4", "2026-06-02", "payment", "Paid in full", 350.0, "Card", "Dr. Nour"),
            Money("m5", "2026-06-02", "procedure", "Scale & polish", 350.0, "", "Dr. Nour"),
        ),
        // A plausible mouth: a treated upper-right six now carrying secondary
        // caries, a couple of fillings, one extraction and a sensitive canine.
        teeth = mapOf(
            16 to Tooth(16, listOf("caries_secondary", "pulp_prev_treated"), "Crown planned once the root canal settles."),
            14 to Tooth(14, listOf("rest_composite"), ""),
            13 to Tooth(13, listOf("sens_dentin"), ""),
            26 to Tooth(26, listOf("rest_composite"), ""),
            36 to Tooth(36, listOf("surg_extracted"), "Extracted 2024, bridge discussed."),
            37 to Tooth(37, listOf("caries_moderate"), ""),
            45 to Tooth(45, listOf("perio_gingivitis"), ""),
            11 to Tooth(11, listOf("trauma_enamel_fracture"), "Chipped edge, patient not bothered."),
        ),
    ),
)
