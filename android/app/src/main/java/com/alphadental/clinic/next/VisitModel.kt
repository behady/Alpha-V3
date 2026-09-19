package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class VisitSheetState(
    val who: Who? = null,
    val visit: Visit? = null,
    /**
     * The full appointment document.
     *
     * The diary row is a summary — it carries no phone number and no check-in
     * stamp — and [Repository.setStatus] needs both to decide what to stamp. So
     * the row opens the sheet instantly and the document arrives a moment later,
     * rather than the row waiting on a read before anything appears.
     */
    val record: Appointment? = null,
    val loading: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
    val done: String? = null,

    // ---- the editable fields, as the website's panel has them
    val doctors: List<com.alphadental.clinic.data.Doctor> = emptyList(),
    val services: List<com.alphadental.clinic.data.Service> = emptyList(),
    val reasons: List<String> = emptyList(),
    val hours: com.alphadental.clinic.next.data.Hours = com.alphadental.clinic.next.data.Hours(),
    val doctorId: String = "",
    val status: Stage? = null,
    /** "yyyy-MM-dd". */
    val date: String = "",
    /** "HH:mm". */
    val time: String = "",
    val minutes: Int = 30,
    val reason: String = "",
    val notes: String = "",

    // ---- the patient's ledger, under the form
    val charged: Double = 0.0,
    val paid: Double = 0.0,
    val lines: List<com.alphadental.clinic.next.data.Money> = emptyList(),
    val unpaid: List<com.alphadental.clinic.data.UnpaidProcedure> = emptyList(),
    val paying: Boolean = false,
    val takingPayment: Boolean = false,
    val payError: String? = null,
    val recording: Boolean = false,
    val recordError: String? = null,
    val deleting: Boolean = false,
) {
    val owed: Double get() = (charged - paid).coerceAtLeast(0.0)

    /** Removing a visit is its own tick-box on the website. */
    val canDelete: Boolean get() = who?.can("appointments.delete") == true

    /** Something on the form differs from the record, so Save has work to do. */
    val dirty: Boolean
        get() {
            val r = record ?: return false
            return doctorId != r.doctorId || (status != null && status != visit?.status) ||
                date != r.date || time != toField(r.time) || minutes != r.duration ||
                reason != r.treatment || notes != r.notes
        }

    /** Every slot the clinic's own opening hours allow. Empty when nobody set them. */
    val slots: List<String>
        get() {
            if (!hours.configured) return emptyList()
            val step = hours.slot.coerceAtLeast(5)
            return generateSequence(hours.startMinute) { it + step }
                .takeWhile { it + step <= hours.closes }
                .map { "%02d:%02d".format(it / 60, it % 60) }
                .toList()
        }

    val isOpen: Boolean get() = visit != null

    /** The same key the website's own appointment screen checks. */
    val canEdit: Boolean get() = who?.can("appointments.edit") == true

    /** Billing work done in the chair. The same key the patient's file checks. */
    val canRecordTreatment: Boolean get() = who?.can("clinical.edit") == true

    /** Taking money at the desk as the patient leaves. */
    val canTakePayment: Boolean get() = who?.can("finance.add") == true

    val phone: String get() = record?.phone.orEmpty()

    /**
     * Where this visit can go next.
     *
     * The order is the order a visit actually moves through, so the most likely
     * tap is first and the two exceptions sit at the end. The current stage is
     * dropped — an appointment already checked in does not need a "Checked in"
     * button, and offering one only invites a second write that changes nothing.
     */
    val moves: List<Stage>
        get() {
            val now = visit?.status ?: return emptyList()
            return listOf(
                Stage.CheckedIn,
                Stage.InChair,
                Stage.CheckingOut,
                Stage.Completed,
                Stage.Confirmed,
                Stage.Delayed,
                Stage.NoShow,
                Stage.Cancelled,
            ).filterNot { it == now }
        }
}

/**
 * One appointment, and what can be done to it.
 *
 * This is the write the old phone app never had and the desk uses most: a
 * patient walks in and somebody has to mark them arrived. It is a status change
 * and nothing more — the sheet deliberately cannot delete an appointment, since
 * a cancelled visit is still part of the day's record and the website keeps it
 * for exactly that reason.
 *
 * Nothing here re-reads the diary afterwards. The day is a listener, so the row
 * behind the sheet restyles itself the moment Firestore acknowledges the write.
 */
class VisitModel : ViewModel() {

    private val _state = MutableStateFlow(VisitSheetState())
    val state: StateFlow<VisitSheetState> = _state.asStateFlow()

    fun open(visit: Visit) {
        _state.value = VisitSheetState(who = _state.value.who, visit = visit, loading = true)
        viewModelScope.launch {
            val who = _state.value.who ?: ClinicSource.signedIn().getOrElse { e ->
                _state.value = _state.value.copy(loading = false, error = e.message)
                return@launch
            }
            val record = runCatching { Repository.loadAppointment(who.clinicId, visit.id) }.getOrNull()
            _state.value = _state.value.copy(
                who = who, record = record, loading = false,
                doctorId = record?.doctorId.orEmpty(),
                status = visit.status,
                date = record?.date?.ifBlank { visit.date } ?: visit.date,
                time = toField(record?.time?.ifBlank { visit.time } ?: visit.time),
                minutes = (record?.duration ?: visit.duration).coerceAtLeast(5),
                reason = record?.treatment.orEmpty(),
                notes = record?.notes.orEmpty(),
            )
            // The lists and the ledger arrive after the form, so the form is usable at once.
            loadLists(who)
            loadLedger(who, visit.patientId)
        }
    }

    private fun loadLists(who: Who) = viewModelScope.launch {
        val doctors = runCatching { Repository.loadDoctors(who.clinicId) }.getOrDefault(emptyList())
        val services = runCatching { Repository.loadServices(who.clinicId) }.getOrDefault(emptyList())
        val reasons = runCatching { Repository.loadVisitReasons(who.clinicId) }.getOrDefault(emptyList())
        val hours = runCatching { ClinicSource.hours(who.clinicId) }.getOrDefault(com.alphadental.clinic.next.data.Hours())
        val s = _state.value
        _state.value = s.copy(
            doctors = doctors, services = services, reasons = reasons, hours = hours,
            // A visit whose dentist was stored by name only still gets its dropdown filled.
            doctorId = s.doctorId.ifBlank { doctors.firstOrNull { it.name == s.record?.doctor }?.id.orEmpty() },
        )
    }

    /**
     * The patient's account, for the strip under the form.
     *
     * Read the way the file reads it, so the three figures here are the three figures there.
     */
    private fun loadLedger(who: Who, patientId: String) = viewModelScope.launch {
        if (patientId.isBlank()) return@launch
        val record = ClinicSource.record(who.clinicId, patientId).getOrNull()
        val rows = runCatching { Repository.loadLedger(who.clinicId, patientId) }.getOrDefault(emptyList())
        _state.value = _state.value.copy(
            charged = record?.balance?.charged ?: 0.0,
            paid = record?.balance?.paid ?: 0.0,
            lines = record?.ledger.orEmpty(),
            unpaid = com.alphadental.clinic.data.unpaidProcedures(rows).filter { it.remaining > 0.009 },
        )
    }

    // ------------------------------------------------------------------ the form

    fun setDoctor(doctor: com.alphadental.clinic.data.Doctor?) { _state.value = _state.value.copy(doctorId = doctor?.id.orEmpty()) }
    fun setStatus(stage: Stage) { _state.value = _state.value.copy(status = stage) }
    fun setTime(time: String) { _state.value = _state.value.copy(time = time) }
    fun setMinutes(minutes: Int) { _state.value = _state.value.copy(minutes = minutes) }
    fun setReason(reason: String) { _state.value = _state.value.copy(reason = reason) }
    fun setNotes(notes: String) { _state.value = _state.value.copy(notes = notes) }

    fun shiftDay(by: Int) {
        val s = _state.value
        val cal = java.util.Calendar.getInstance()
        runCatching { cal.time = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(s.date)!! }
        cal.add(java.util.Calendar.DAY_OF_YEAR, by)
        _state.value = s.copy(date = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(cal.time))
    }

    /**
     * Write the form back.
     *
     * Two writes when the status changed too: the details through `updateAppointment`, and the
     * status through `setStatus`, because the status write also stamps the check-in time and the
     * history line the desk's display reads, and only that function knows to.
     */
    fun save() {
        val s = _state.value
        val who = s.who ?: return
        val record = s.record ?: return
        if (!s.canEdit || s.saving) return
        _state.value = s.copy(saving = true, error = null)
        viewModelScope.launch {
            val result = Repository.updateAppointment(
                clinicId = who.clinicId,
                appointment = record,
                dateKey = s.date,
                time = s.time,
                doctor = s.doctors.firstOrNull { it.id == s.doctorId },
                durationMinutes = s.minutes,
                treatment = s.reason,
                notes = s.notes,
                service = null,
                cost = record.cost,
                byName = who.name,
            )
            val stage = s.status
            val statusResult = if (result.isSuccess && stage != null && stage != s.visit?.status) {
                Repository.setStatus(who.clinicId, record, stage.stored, who.name)
            } else result
            statusResult
                .onSuccess { _state.value = VisitSheetState(who = who) }
                .onFailure { e -> _state.value = _state.value.copy(saving = false, error = e.message ?: "That could not be saved.") }
        }
    }

    fun delete(keepTreatments: Boolean) {
        val s = _state.value
        val who = s.who ?: return
        val visit = s.visit ?: return
        if (!s.canDelete || s.deleting) return
        _state.value = s.copy(deleting = true, error = null)
        viewModelScope.launch {
            runCatching { com.alphadental.clinic.data.ClinicApi.deleteAppointment(who.clinicId, visit.id, keepTreatments) }
                .onSuccess { _state.value = VisitSheetState(who = who) }
                .onFailure { e -> _state.value = _state.value.copy(deleting = false, error = e.message ?: "That visit could not be deleted.") }
        }
    }

    // ------------------------------------------------------------------ money and work, from the visit

    fun openPayment() { if (_state.value.canTakePayment) _state.value = _state.value.copy(paying = true, payError = null) }
    fun closePayment() { _state.value = _state.value.copy(paying = false, payError = null) }

    fun takePayment(procedure: com.alphadental.clinic.data.UnpaidProcedure?, amount: Double) {
        val s = _state.value
        val who = s.who ?: return
        val visit = s.visit ?: return
        if (!s.canTakePayment || s.takingPayment) return
        _state.value = s.copy(takingPayment = true, payError = null)
        viewModelScope.launch {
            Repository.recordPayment(
                clinicId = who.clinicId,
                patient = com.alphadental.clinic.data.Patient(id = visit.patientId, name = visit.patientName, phone = s.phone),
                procedure = procedure,
                amount = amount,
            )
                .onSuccess {
                    _state.value = _state.value.copy(takingPayment = false, paying = false, done = "${amount.toLong()} taken.")
                    loadLedger(who, visit.patientId)
                }
                .onFailure { e -> _state.value = _state.value.copy(takingPayment = false, payError = e.message ?: "That payment could not be recorded.") }
        }
    }

    fun openRecording() { if (_state.value.canRecordTreatment) _state.value = _state.value.copy(recording = true, recordError = null) }
    fun closeRecording() { _state.value = _state.value.copy(recording = false, recordError = null) }

    /** Add a procedure to THIS visit: the note carries the appointment id, as the website's does. */
    fun recordTreatment(d: ProcedureDraft) {
        val s = _state.value
        val who = s.who ?: return
        val visit = s.visit ?: return
        if (!s.canRecordTreatment || s.saving) return
        _state.value = s.copy(saving = true, recordError = null)
        viewModelScope.launch {
            Repository.addClinicalNote(
                clinicId = who.clinicId,
                patient = com.alphadental.clinic.data.Patient(id = visit.patientId, name = visit.patientName, phone = s.phone),
                procedure = d.procedure, teeth = d.teeth, noteText = d.note,
                unitCost = d.unitCost,
                status = d.status,
                doctor = d.doctor, service = d.service,
                appointmentId = visit.id,
                extra = d.extra,
                date = d.date.takeIf { it.isNotBlank() },
                pricingMode = d.pricingMode.takeIf { it.isNotBlank() },
            )
                .onSuccess {
                    _state.value = _state.value.copy(saving = false, recording = false, done = "Recorded.")
                    loadLedger(who, visit.patientId)
                }
                .onFailure { e -> _state.value = _state.value.copy(saving = false, recordError = e.message ?: "That could not be recorded.") }
        }
    }

    fun close() {
        _state.value = VisitSheetState(who = _state.value.who)
    }

    /**
     * Move the visit to a stage.
     *
     * [Repository.setStatus] is reused rather than reinvented because checking
     * somebody in is not one write: it stamps an arrival time exactly once and
     * adds a row to the waiting-room collection the website's display is built
     * from. A phone that only set the status field would check a patient in
     * everywhere except the screen the clinic actually watches.
     */
    fun move(to: Stage) {
        val s = _state.value
        val who = s.who ?: return
        val visit = s.visit ?: return
        if (!s.canEdit || s.saving) return

        // The document read may not have landed yet. Its fields only decide
        // whether a stamp is written a second time, so a minimal stand-in is
        // honest here — worst case a re-check-in is treated as a first one, and
        // setStatus guards that with the status it is given.
        val record = s.record ?: Appointment(
            id = visit.id,
            patientId = visit.patientId,
            patientName = visit.patientName,
            date = visit.date,
            time = visit.time,
            doctor = visit.doctor,
            status = visit.status.stored,
        )

        _state.value = s.copy(saving = true, error = null, done = null)
        viewModelScope.launch {
            Repository.setStatus(who.clinicId, record, to.stored, who.name)
                .onSuccess {
                    _state.value = _state.value.copy(
                        saving = false,
                        done = "Moved to ${stageLabel(to).lowercase()}.",
                        visit = _state.value.visit?.copy(status = to),
                        record = _state.value.record?.copy(
                            status = to.stored,
                            hasCheckedIn = _state.value.record?.hasCheckedIn == true || to == Stage.CheckedIn,
                        ),
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        saving = false,
                        error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to change appointments."
                        } else {
                            "That could not be saved."
                        },
                    )
                }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}

/** "09:30 AM" as the form's own "09:30". */
private fun toField(stored: String): String {
    val t = stored.trim()
    if (t.isEmpty()) return ""
    val ampm = Regex("^(\\d{1,2}):(\\d{2})\\s*([AaPp][Mm])$").find(t)
    if (ampm != null) {
        var h = ampm.groupValues[1].toInt() % 12
        if (ampm.groupValues[3].lowercase() == "pm") h += 12
        return "%02d:%s".format(h, ampm.groupValues[2])
    }
    val plain = Regex("^(\\d{1,2}):(\\d{2})").find(t) ?: return t
    return "%02d:%s".format(plain.groupValues[1].toInt(), plain.groupValues[2])
}

