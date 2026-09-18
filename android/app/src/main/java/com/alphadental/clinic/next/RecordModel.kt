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
    Notes("Treatments"),
    Visits("Visits"),
    Photos("Photos"),
    Rx("Scripts"),
    Ledger("Ledger"),
}

/** The website's own gallery filters, stored by their English id. */
val MEDIA_CATEGORIES = listOf("X-Ray", "Clinical Photo", "Panoramic", "CT Scan", "Periodontal")

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
    /** Photos and x-rays on this file, newest first. */
    val media: List<com.alphadental.clinic.data.PatientMedia> = emptyList(),
    val mediaFilter: String = "",
    val uploading: Boolean = false,
    val uploadCategory: String = "Clinical Photo",
    val mediaError: String? = null,
    /** The one being looked at full-size. */
    val viewing: String? = null,

    /**
     * Every treatment recorded on this file, newest first.
     *
     * This list is why recording a treatment used to feel as though nothing had
     * happened: the note was written and the ledger row with it, but the file had
     * nowhere to show either as a treatment. It is the clinical record.
     */
    val notes: List<com.alphadental.clinic.data.ClinicalNote> = emptyList(),
    val busyNote: String? = null,
    /** Prescriptions already written for this patient. */
    val scripts: List<com.alphadental.clinic.data.Prescription> = emptyList(),
    /** Set while the details form is open. */
    val editing: Boolean = false,
    val savingDetails: Boolean = false,
    val detailsError: String? = null,
    /** The tooth being charted, with its unsaved edits. */
    val charting: com.alphadental.clinic.next.data.Tooth? = null,
    val savingTooth: Boolean = false,
    val startingOrtho: Boolean = false,
    val orthoStarted: String? = null,
    /** The prescription being printed, shared or sent, by id. */
    val busyScript: String? = null,
    val scriptResult: String? = null,

    /**
     * The ledger row being corrected.
     *
     * The statement was read-only, and a read-only ledger is a ledger with a wrong number in it
     * forever: a payment entered as 500 instead of 5,000, a charge dated to the wrong day, a
     * treatment recorded twice. All three happen at a busy desk, and all three used to mean
     * opening a laptop.
     */
    val editingRow: com.alphadental.clinic.next.data.Money? = null,
    val savingRow: Boolean = false,
    val rowError: String? = null,
    val rowDone: String? = null,
) {
    /**
     * The photos the filter is showing.
     *
     * An empty filter means everything, rather than a sixth category called
     * "All" that would have to be excluded from every count.
     */
    val shownMedia: List<com.alphadental.clinic.data.PatientMedia>
        get() = if (mediaFilter.isBlank()) media else media.filter { it.category == mediaFilter }
    val canTakePayment: Boolean get() = who?.can("finance.add") == true

    /** Adding a photo writes to the file, so it wants the clinical key. */
    val canAddPhoto: Boolean get() = who?.can("clinical.edit") == true

    /** Changing who somebody is, rather than what was done to them. */
    val canEditDetails: Boolean get() = who?.can("patients.edit") == true

    /** Treatments still only planned — the work this patient is waiting for. */
    val planned: List<com.alphadental.clinic.data.ClinicalNote>
        get() = notes.filter { it.status == "Planned" }

    /** Recording treatment is the clinical write, gated on the clinical key. */
    val canRecord: Boolean get() = who?.can("clinical.edit") == true

    /** Correcting a row already on the books. The same key the website's ledger checks. */
    val canEditLedger: Boolean get() = who?.can("finance.edit") == true

    /** Removing one. Separate from editing on purpose — they are separate tick-boxes. */
    val canDeleteLedger: Boolean get() = who?.can("finance.delete") == true
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
                    if (who.can("finance.add")) loadUnpaid(who, id)
                    if (who.can("clinical.edit")) loadLists(who)
                    loadMedia(who, id)
                    loadNotes(who, id)
                    loadScripts(who, id)
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
            // The treatment list and the ledger are two views of the same act, so
            // they are re-read together. One refreshed without the other is how a
            // file shows a charge with no treatment behind it.
            loadNotes(who, id)
            loadScripts(who, id)
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
                unitCost = unitCost.takeIf { it > 0 },
                status = if (done) "Completed" else "Planned",
                doctor = doctor,
                service = service,
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

    // ------------------------------------------------------------------ correcting the ledger

    fun editRow(row: com.alphadental.clinic.next.data.Money) {
        if (!_state.value.canEditLedger) return
        _state.value = _state.value.copy(editingRow = row, rowError = null, rowDone = null)
    }

    fun closeRow() {
        _state.value = _state.value.copy(editingRow = null, rowError = null, rowDone = null)
    }

    /**
     * Save a correction.
     *
     * The patch is sent whole and the server keeps only the fields that row type allows — a
     * payment takes its date, its wording, its amount and its method; a treatment charge takes its
     * date and its wording, because the price of a treatment belongs to the treatment and is
     * changed by editing that instead. Anything else is dropped there rather than refused, which
     * is why this may send what it has.
     */
    fun saveRow(date: String, description: String, amount: Double, method: String) {
        val who = _state.value.who ?: return
        val row = _state.value.editingRow ?: return
        if (!_state.value.canEditLedger || _state.value.savingRow) return
        _state.value = _state.value.copy(savingRow = true, rowError = null)

        val patch = buildMap<String, Any?> {
            put("date", date.trim())
            put("description", description.trim())
            if (row.isPayment) {
                put("paid", amount)
                put("method", method.trim())
            }
        }

        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.updateLedgerRow(who.clinicId, row.id, patch)
                .onSuccess {
                    _state.value = _state.value.copy(
                        savingRow = false, editingRow = null, rowDone = "Saved.",
                    )
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        savingRow = false,
                        // The server's own sentence, which is usually the useful one: "2 payments
                        // have been recorded against this" beats a generic refusal.
                        rowError = e.message ?: "That change could not be saved.",
                    )
                }
        }
    }

    /**
     * Remove a row.
     *
     * A treatment charge is deleted through the clinical route rather than the ledger one, because
     * the charge and the note behind it are one act — deleting the money and leaving the treatment
     * on the record produces a file that says work was done for free.
     */
    fun deleteRow() {
        val who = _state.value.who ?: return
        val patientId = _state.value.record?.person?.id ?: return
        val row = _state.value.editingRow ?: return
        if (!_state.value.canDeleteLedger || _state.value.savingRow) return
        _state.value = _state.value.copy(savingRow = true, rowError = null)

        viewModelScope.launch {
            val note = _state.value.notes.firstOrNull { it.ledgerId == row.id }
            val result = if (row.isCharge && note != null) {
                com.alphadental.clinic.data.Repository.deleteClinicalNote(who.clinicId, note.id)
            } else {
                com.alphadental.clinic.data.Repository.deleteLedgerRow(who.clinicId, row.id)
            }
            result
                .onSuccess {
                    _state.value = _state.value.copy(
                        savingRow = false, editingRow = null, rowDone = "Removed.",
                    )
                    loadNotes(who, patientId)
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        savingRow = false,
                        rowError = e.message ?: "That row could not be removed.",
                    )
                }
        }
    }

    private fun loadMedia(who: Who, patientId: String) = viewModelScope.launch {
        val rows = runCatching {
            com.alphadental.clinic.data.Repository.loadPatientMedia(who.clinicId, patientId)
        }.getOrDefault(emptyList())
        _state.value = _state.value.copy(media = rows)
    }

    private fun loadNotes(who: Who, patientId: String) = viewModelScope.launch {
        val rows = runCatching {
            com.alphadental.clinic.data.Repository.loadClinicalNotes(who.clinicId, patientId)
        }.getOrDefault(emptyList())
        _state.value = _state.value.copy(notes = rows)
    }

    private fun loadScripts(who: Who, patientId: String) = viewModelScope.launch {
        val rows = runCatching {
            com.alphadental.clinic.data.Repository.loadPrescriptions(who.clinicId, patientId)
        }.getOrDefault(emptyList())
        _state.value = _state.value.copy(scripts = rows)
    }

    /**
     * Planned becomes done, or the other way round.
     *
     * This moves NO money, and that is the system's behaviour rather than an
     * omission here: `addClinicalNote` writes the ledger row the moment a
     * treatment is recorded with a price on it, whatever its status. A planned
     * treatment with a price is therefore already charged, and the status is a
     * clinical word — has it been carried out — not a financial one. The list
     * says so on the row, because everybody assumes the opposite.
     */
    fun setNoteStatus(noteId: String, status: String) {
        val who = _state.value.who ?: return
        val patientId = _state.value.record?.person?.id ?: return
        if (!_state.value.canRecord || _state.value.busyNote != null) return
        // The route reprices whatever it is sent, so the whole note goes back rather than the one
        // word that changed. A note this screen has not loaded cannot be changed at all.
        val note = _state.value.notes.firstOrNull { it.id == noteId } ?: return
        _state.value = _state.value.copy(busyNote = noteId, error = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.setNoteStatus(who.clinicId, patientId, note, status)
                .onSuccess {
                    _state.value = _state.value.copy(busyNote = null)
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(busyNote = null, error = readable(e))
                }
        }
    }

    // ------------------------------------------------------------------ the chart

    /** Open a tooth for charting, or close it. */
    fun chart(tooth: Int?) {
        val record = _state.value.record
        _state.value = _state.value.copy(
            charting = tooth?.let {
                record?.teeth?.get(it)
                    ?: com.alphadental.clinic.next.data.Tooth(it, emptyList(), "")
            },
        )
    }

    fun toggleStatus(id: String) {
        val tooth = _state.value.charting ?: return
        _state.value = _state.value.copy(
            charting = tooth.copy(
                statuses = if (id in tooth.statuses) tooth.statuses - id else tooth.statuses + id,
            ),
        )
    }

    fun setToothNote(text: String) {
        val tooth = _state.value.charting ?: return
        _state.value = _state.value.copy(charting = tooth.copy(notes = text))
    }

    /**
     * Write one tooth.
     *
     * The repository writes a dotted field path rather than the whole map, so two
     * dentists charting different teeth on the same patient cannot overwrite each
     * other — and clearing a tooth deletes its key instead of leaving a hollow
     * entry the website would still count as charted.
     */
    fun saveTooth() {
        val who = _state.value.who ?: return
        val record = _state.value.record ?: return
        val tooth = _state.value.charting ?: return
        if (!_state.value.canRecord || _state.value.savingTooth) return
        _state.value = _state.value.copy(savingTooth = true, error = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.setToothDiagnosis(
                clinicId = who.clinicId,
                patientId = record.person.id,
                tooth = tooth.number.toString(),
                statuses = tooth.statuses,
                notes = tooth.notes,
                byName = who.name,
            )
                .onSuccess {
                    _state.value = _state.value.copy(savingTooth = false, charting = null)
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(savingTooth = false, error = readable(e))
                }
        }
    }

    // ------------------------------------------------------------------ who they are

    /**
     * Put this patient into orthodontic treatment.
     *
     * The case is keyed by the patient's own id, so pressing it twice is not two
     * cases — it is the same one, merged. It also sets the flag the website's
     * patient list badges ortho patients by, which is why this goes through the
     * repository rather than writing the case document here.
     */
    fun startOrtho() {
        val who = _state.value.who ?: return
        val record = _state.value.record ?: return
        if (!_state.value.canRecord || _state.value.startingOrtho) return
        _state.value = _state.value.copy(startingOrtho = true, error = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.startOrthoCase(
                who.clinicId,
                com.alphadental.clinic.data.Patient(
                    id = record.person.id,
                    name = record.person.name,
                    phone = record.person.phone,
                ),
            )
                .onSuccess {
                    _state.value = _state.value.copy(
                        startingOrtho = false,
                        orthoStarted = "On the ortho board. Adjustments are recorded there.",
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(startingOrtho = false, error = readable(e))
                }
        }
    }

    // ------------------------------------------------------------------ scripts, out the door

    /**
     * The PDF, drawn on the phone.
     *
     * The letterhead comes from settings/clinic_info — the same document the
     * website's printed prescription takes its header from — so a script sent
     * from a phone carries the clinic's name and number exactly as one printed
     * at the desk does. The file lands in the cache, which the share and print
     * intents can read through the FileProvider and which Android sweeps itself.
     */
    private suspend fun pdfFor(
        context: android.content.Context,
        script: com.alphadental.clinic.data.Prescription,
    ): java.io.File? {
        val who = _state.value.who ?: return null
        val record = _state.value.record ?: return null
        val clinic = runCatching { com.alphadental.clinic.data.Repository.loadClinicInfo(who.clinicId) }
            .getOrDefault(com.alphadental.clinic.data.ClinicInfo())
        return runCatching {
            com.alphadental.clinic.data.PrescriptionPdf.write(
                context = context,
                clinic = clinic,
                patientName = record.person.name,
                patientPhone = record.person.phone,
                prescription = script,
                arabic = false,
            )
        }.getOrNull()
    }

    private fun withPdf(
        context: android.content.Context,
        script: com.alphadental.clinic.data.Prescription,
        then: (java.io.File) -> Unit,
    ) {
        if (_state.value.busyScript != null) return
        _state.value = _state.value.copy(busyScript = script.id, scriptResult = null, error = null)
        viewModelScope.launch {
            val file = pdfFor(context, script)
            _state.value = _state.value.copy(
                busyScript = null,
                error = if (file == null) "The prescription could not be drawn." else null,
            )
            if (file != null) then(file)
        }
    }

    fun printScript(context: android.content.Context, script: com.alphadental.clinic.data.Prescription) =
        withPdf(context, script) { com.alphadental.clinic.ui.DocumentActions.print(context, it, "Prescription") }

    fun shareScript(context: android.content.Context, script: com.alphadental.clinic.data.Prescription) =
        withPdf(context, script) { com.alphadental.clinic.ui.DocumentActions.share(context, it, "Prescription") }

    /**
     * Straight to the patient's WhatsApp, through the clinic's own number.
     *
     * The server route does the sending, because it holds the channel's token
     * and the phone must not. A document like this is a paid message the moment
     * the patient has not written in the last day, so the confirmation says
     * "sent", never "delivered" — the phone does not know, and should not claim.
     */
    fun sendScript(context: android.content.Context, script: com.alphadental.clinic.data.Prescription) {
        val record = _state.value.record ?: return
        if (_state.value.busyScript != null) return
        _state.value = _state.value.copy(busyScript = script.id, scriptResult = null, error = null)
        viewModelScope.launch {
            val file = pdfFor(context, script)
            if (file == null) {
                _state.value = _state.value.copy(busyScript = null, error = "The prescription could not be drawn.")
                return@launch
            }
            com.alphadental.clinic.data.Repository.sendPrescriptionWhatsapp(record.person.id, file.readBytes())
                .onSuccess {
                    _state.value = _state.value.copy(busyScript = null, scriptResult = "Sent on WhatsApp.")
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        busyScript = null,
                        error = e.message ?: "WhatsApp did not accept it.",
                    )
                }
        }
    }

    fun clearScriptResult() {
        _state.value = _state.value.copy(scriptResult = null)
    }

    fun clearOrtho() {
        _state.value = _state.value.copy(orthoStarted = null)
    }

    fun edit(open: Boolean) {
        _state.value = _state.value.copy(editing = open, detailsError = null)
    }

    fun saveDetails(
        name: String,
        phone: String,
        dateOfBirth: String,
        gender: String,
        allergies: String,
        medicalHistory: String,
        address: String,
    ) {
        val who = _state.value.who ?: return
        val record = _state.value.record ?: return
        if (!_state.value.canEditDetails || _state.value.savingDetails) return
        _state.value = _state.value.copy(savingDetails = true, detailsError = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.updatePatient(
                clinicId = who.clinicId,
                patientId = record.person.id,
                name = name,
                phone = phone,
                dateOfBirth = dateOfBirth,
                gender = gender,
                allergies = allergies,
                medicalHistory = medicalHistory,
                address = address,
                byName = who.name,
            )
                .onSuccess {
                    _state.value = _state.value.copy(savingDetails = false, editing = false)
                    reload()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        savingDetails = false,
                        detailsError = e.message ?: readable(e),
                    )
                }
        }
    }

    private fun readable(e: Throwable): String = when {
        e.message?.contains("PERMISSION_DENIED", true) == true ->
            "This account is not allowed to change that."
        e.message?.contains("offline", true) == true -> "No connection. Nothing was changed."
        else -> "That could not be saved."
    }

    fun filterMedia(category: String) {
        _state.value = _state.value.copy(
            mediaFilter = if (_state.value.mediaFilter == category) "" else category,
        )
    }

    fun setUploadCategory(category: String) {
        _state.value = _state.value.copy(uploadCategory = category)
    }

    fun view(url: String?) {
        _state.value = _state.value.copy(viewing = url)
    }

    /**
     * A photo taken chairside.
     *
     * Written the way the website writes one — the image into Storage under the
     * patient, then a `patient_media` row pointing at it — so a picture taken on
     * a phone appears in the website's gallery like any other upload rather than
     * in a second place only the phone knows about.
     *
     * The bytes arrive already downscaled. A 12-megapixel shot of one tooth is
     * the clinic's storage bill, not a better photograph.
     */
    fun addPhoto(bytes: ByteArray) {
        val who = _state.value.who ?: return
        val record = _state.value.record ?: return
        if (!_state.value.canAddPhoto || _state.value.uploading) return
        _state.value = _state.value.copy(uploading = true, mediaError = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.uploadPatientMedia(
                clinicId = who.clinicId,
                patientId = record.person.id,
                patientName = record.person.name,
                bytes = bytes,
                category = _state.value.uploadCategory,
                byName = who.name,
            )
                .onSuccess {
                    _state.value = _state.value.copy(uploading = false)
                    loadMedia(who, record.person.id)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        uploading = false,
                        mediaError = when {
                            e.message?.contains("PERMISSION_DENIED", true) == true ||
                                e.message?.contains("not authorized", true) == true ->
                                "This account is not allowed to add photos."
                            else -> "That photo could not be saved."
                        },
                    )
                }
        }
    }

    fun dismissMediaError() {
        _state.value = _state.value.copy(mediaError = null)
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
