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
    /** Treatments with money still outstanding, for the payment sheet. */
    val unpaid: List<com.alphadental.clinic.data.UnpaidProcedure> = emptyList(),
    val taking: Boolean = false,
    val payError: String? = null,
    val paid: String? = null,
    /** The price list and the dentists, for recording a treatment. */
    val services: List<com.alphadental.clinic.data.Service> = emptyList(),
    val doctors: List<com.alphadental.clinic.data.Doctor> = emptyList(),
    val recording: Boolean = false,
    val recordError: String? = null,
    val recorded: String? = null,
) {
    val canTakePayment: Boolean get() = who?.can("payments.add") == true

    /** Recording treatment is the clinical write, gated on the clinical key. */
    val canRecord: Boolean get() = who?.can("clinical.edit") == true
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
                .onSuccess {
                    _state.value = _state.value.copy(loading = false, who = who, record = it)
                    if (who.can("payments.add")) loadUnpaid(who, id)
                    if (who.can("clinical.edit")) loadLists(who)
                }
                .onFailure { _state.value = _state.value.copy(loading = false, who = who, error = it.message) }
        }
    }

    /**
     * What this patient still owes, treatment by treatment.
     *
     * Read through the old ledger model on purpose: `unpaidProcedures` matches
     * payments to charges by procedureId and is the same arithmetic the website
     * and the payment split use. Re-deriving it here from the rebuild's own
     * ledger type would be a second opinion about what somebody owes.
     */
    private fun loadUnpaid(who: Who, patientId: String) = viewModelScope.launch {
        val rows = runCatching {
            com.alphadental.clinic.data.Repository.loadLedger(who.clinicId, patientId)
        }.getOrDefault(emptyList())
        _state.value = _state.value.copy(
            unpaid = com.alphadental.clinic.data.unpaidProcedures(rows).filter { it.remaining > 0.009 },
        )
    }

    /**
     * Take money.
     *
     * Against a named treatment where there is one, because that is what drives
     * the dentist's commission and the lab fee coming off it — the split lives in
     * `recordPayment`, not here. A payment with no treatment named sits against
     * the account as a whole, which is a real thing a desk does and not a
     * fallback: it is how a deposit is taken before any work is charged.
     */
    fun takePayment(procedure: com.alphadental.clinic.data.UnpaidProcedure?, amount: Double) {
        val who = _state.value.who ?: return
        val record = _state.value.record ?: return
        if (!_state.value.canTakePayment || _state.value.taking) return
        _state.value = _state.value.copy(taking = true, payError = null, paid = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.recordPayment(
                clinicId = who.clinicId,
                patient = com.alphadental.clinic.data.Patient(
                    id = record.person.id,
                    name = record.person.name,
                    phone = record.person.phone,
                ),
                procedure = procedure,
                amount = amount,
                byName = who.name,
                byUid = who.uid,
            )
                .onSuccess {
                    _state.value = _state.value.copy(
                        taking = false,
                        paid = "${amount.toLong()} taken.",
                    )
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        taking = false,
                        // require() failures here are sentences worth showing as
                        // written — "that is more than the 800 still owed".
                        payError = e.message ?: "That payment could not be recorded.",
                    )
                }
        }
    }

    fun clearPayment() {
        _state.value = _state.value.copy(paid = null, payError = null)
    }

    /** Re-read the file after a write, so the balance and the ledger agree with it. */
    private fun reload() {
        val who = _state.value.who ?: return
        val id = _state.value.record?.person?.id ?: return
        viewModelScope.launch {
            ClinicSource.record(who.clinicId, id)
                .onSuccess { _state.value = _state.value.copy(record = it) }
            loadUnpaid(who, id)
        }
    }

    private fun loadLists(who: Who) = viewModelScope.launch {
        val services = runCatching {
            com.alphadental.clinic.data.Repository.loadServices(who.clinicId)
        }.getOrDefault(emptyList())
        val doctors = runCatching {
            com.alphadental.clinic.data.Repository.loadDoctors(who.clinicId)
        }.getOrDefault(emptyList())
        _state.value = _state.value.copy(services = services, doctors = doctors)
    }

    /**
     * Record what was done, and bill it.
     *
     * Two documents linked both ways — the clinical note and a ledger row — and
     * `addClinicalNote` writes both. That link is the point: a note carrying a
     * cost with no ledger row is exactly what the website reports as "treated,
     * never invoiced", so writing the note alone would file the work as lost
     * revenue.
     *
     * The price given is the price for ONE tooth. Multiplying by the number of
     * teeth is the repository's job, because it knows the service's billing rule
     * — flat once, per arch per jaw, everything else per tooth. The phone used to
     * write the single-tooth price whatever was selected, which undercharged for
     * exactly the treatments worth the most.
     */
    fun recordTreatment(
        procedure: String,
        teeth: List<String>,
        note: String,
        unitCost: Double,
        doctor: com.alphadental.clinic.data.Doctor?,
        service: com.alphadental.clinic.data.Service?,
        done: Boolean,
    ) {
        val who = _state.value.who ?: return
        val record = _state.value.record ?: return
        if (!_state.value.canRecord || _state.value.recording) return
        _state.value = _state.value.copy(recording = true, recordError = null, recorded = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.addClinicalNote(
                clinicId = who.clinicId,
                patient = com.alphadental.clinic.data.Patient(
                    id = record.person.id,
                    name = record.person.name,
                    phone = record.person.phone,
                ),
                procedure = procedure,
                teeth = teeth,
                noteText = note,
                unitCost = unitCost,
                status = if (done) "Completed" else "Planned",
                doctor = doctor,
                service = service,
                byName = who.name,
            )
                .onSuccess {
                    _state.value = _state.value.copy(
                        recording = false,
                        recorded = if (unitCost > 0) "Recorded and charged." else "Recorded.",
                    )
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        recording = false,
                        recordError = e.message ?: "That treatment could not be recorded.",
                    )
                }
        }
    }

    fun clearRecorded() {
        _state.value = _state.value.copy(recorded = null, recordError = null)
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
