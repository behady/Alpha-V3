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
) {
    val isOpen: Boolean get() = visit != null

    /** The same key the website's own appointment screen checks. */
    val canEdit: Boolean get() = who?.can("appointments.edit") == true

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
            _state.value = _state.value.copy(who = who, record = record, loading = false)
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
