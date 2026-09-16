package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Which slice of the board is showing.
 *
 * "Open" is the default rather than "All", because a board that opens on every
 * case the clinic has ever sent is a filing cabinet. What anyone opens this
 * screen for is the work still in flight.
 */
enum class LabFilter(val label: String) {
    Open("Open"),
    Overdue("Overdue"),
    Waiting("Back & waiting"),
    All("All"),
}

data class Lab(
    val loading: Boolean = true,
    val who: Who? = null,
    val cases: List<LabCases.LabCase> = emptyList(),
    val filter: LabFilter = LabFilter.Open,
    val error: String? = null,
    /** The case being looked at, by id. Not `open` — that already means the open cases. */
    val openId: String? = null,
    val moving: Boolean = false,
) {
    /** Moving a case along is a clinical write, as the rules have it. */
    val canMove: Boolean get() = who?.can("clinical.edit") == true

    val openCase: LabCases.LabCase? get() = cases.firstOrNull { it.id == openId }
    val today: String get() = ClinicSource.dateKey()

    val summary: LabCases.Summary get() = LabCases.summarise(cases, today)

    /** Everything not yet fitted or cancelled — the work still in flight. */
    val open: List<LabCases.LabCase> get() = cases.filterNot { it.meta.closed }

    val overdue: List<LabCases.LabCase>
        get() = cases.filter { LabCases.dueStateFor(it, today) == LabCases.Due.OVERDUE }

    /**
     * Back from the lab and sitting on the desk.
     *
     * The count nobody else keeps, and the one that actually costs a clinic
     * money: a crown that arrived a fortnight ago and never got fitted is paid
     * for, finished, and earning nothing.
     */
    val waiting: List<LabCases.LabCase> get() = cases.filter { it.status == "back" }

    val shown: List<LabCases.LabCase>
        get() = when (filter) {
            LabFilter.Open -> open
            LabFilter.Overdue -> overdue
            LabFilter.Waiting -> waiting
            LabFilter.All -> cases
        }.sortedWith(
            // Late first, then whatever is due soonest. A board sorted by when a
            // case was created tells you about the past; this one is a queue.
            compareBy(
                { if (LabCases.dueStateFor(it, today) == LabCases.Due.OVERDUE) 0 else 1 },
                // A case with no due date sorts after the dated ones, and among
                // those, the one that has sat on the desk longest comes first.
                { it.dueDate.ifBlank { "9999-" + it.receivedAt.ifBlank { "9999-99-99" } } },
                { it.code },
            )
        )
}

/**
 * The lab board.
 *
 * A listener, because a case marked back at the desk must stop showing as out at
 * the lab on somebody's phone without a refresh.
 *
 * The whole model — stages, which stage may follow which, what counts as
 * overdue — is the one in `LabCases`, shared with the old app and mirroring
 * `labCaseWrite.ts`. Nothing here re-derives it: a second opinion about when a
 * crown is late is exactly the sort of thing that ends with two screens
 * disagreeing in front of a patient.
 */
class LabModel : ViewModel() {

    private val _state = MutableStateFlow(Lab())
    val state: StateFlow<Lab> = _state.asStateFlow()

    private var watch: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.lab")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see the lab board.",
                        )
                        return@onSuccess
                    }
                    observe(who)
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    private fun observe(who: Who) {
        watch?.cancel()
        watch = viewModelScope.launch {
            LabCases.observeCases(who.clinicId).collect { result ->
                result
                    .onSuccess { cases ->
                        _state.value = _state.value.copy(loading = false, cases = cases, error = null)
                    }
                    .onFailure { e ->
                        _state.value = _state.value.copy(
                            loading = false,
                            error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                                "This account is not allowed to see the lab board."
                            } else {
                                "The lab board could not be read."
                            },
                        )
                    }
            }
        }
    }

    fun openCase(id: String?) {
        _state.value = _state.value.copy(openId = id, error = null)
    }

    /**
     * Move a case to its next stage.
     *
     * This is the half of lab tracking that happens away from a desk: a driver
     * arrives with a bag, a crown is fitted chairside. Raising the order —
     * shades, teeth, the agreed price — stays on the website, where there is a
     * keyboard and the form is long.
     *
     * The write is LabCases.advance, which stamps the date each stage owns and
     * only on first arrival: re-entering "back" after a remake must not rewrite
     * the day the original first came in.
     */
    fun move(to: String) {
        val who = _state.value.who ?: return
        val case = _state.value.openCase ?: return
        if (!_state.value.canMove || _state.value.moving) return
        _state.value = _state.value.copy(moving = true, error = null)
        viewModelScope.launch {
            LabCases.advance(who.clinicId, case, to, who.name, ClinicSource.dateKey())
                .onSuccess {
                    _state.value = _state.value.copy(moving = false)
                    // The board is a listener, so the row updates itself. Ringing
                    // the clinic's bell is best effort: the case has arrived
                    // either way, and a failed reminder must not undo the move.
                    if (to == "back") runCatching { LabCases.notifyBack(who.clinicId, case, false) }
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        moving = false,
                        error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to move lab cases."
                        } else {
                            "That could not be saved."
                        },
                    )
                }
        }
    }

    fun show(filter: LabFilter) {
        _state.value = _state.value.copy(filter = filter)
    }
}

/** The board, filled with the design's example data. See [previewDashboard]. */
fun previewLab(): Lab {
    fun day(offset: Int) = ClinicSource.dateKey(
        java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, offset) }.time
    )
    fun case(
        code: String, patient: String, work: String, lab: String,
        status: String, due: Int?, units: Int, doctor: String,
        remakeOf: String = "", received: Int? = null,
    ) = LabCases.LabCase(
        id = code, code = code, codeNumber = 0, branchName = "",
        patientId = "", patientName = patient, patientPhone = "",
        doctorName = doctor, labId = "", labName = lab,
        workType = work, workDescription = work, units = units, teeth = emptyList(),
        bodyShade = "A2", cervicalShade = "", gumShade = "", material = "Zirconia",
        implantSystem = "", notes = "", agreedPrice = 0.0, sentVia = "driver",
        status = status, needsTryIn = false,
        sentAt = day(-10), dueDate = due?.let { day(it) }.orEmpty(),
        receivedAt = received?.let { day(it) }.orEmpty(), fittedAt = "", events = emptyList(),
        remakeOfCode = remakeOf, remakeRound = if (remakeOf.isBlank()) 0 else 1,
    )
    return Lab(
        loading = false,
        who = previewDashboard().who,
        filter = LabFilter.Open,
        cases = listOf(
            case("MAD-0142", "Mariam Hassan", "Zirconia crown", "Cairo Dental Lab", "at_lab", -3, 1, "Dr. Youssef"),
            case("MAD-0139", "Khaled Mostafa", "PFM bridge", "Cairo Dental Lab", "at_lab", 0, 3, "Dr. Nour"),
            case("MAD-0144", "Yara Sameh", "Night guard", "Smile Works", "at_lab", 2, 1, "Dr. Youssef"),
            case("MAD-0131", "Omar Abdelrahman", "Zirconia crown", "Cairo Dental Lab", "back", null, 1, "Dr. Nour", received = -4),
            case("MAD-0128", "Salma Ibrahim", "E-max veneer", "Smile Works", "back", null, 6, "Dr. Youssef", received = -16),
            case("MAD-0147", "Hania Adel", "Zirconia crown", "Cairo Dental Lab", "returned_to_lab", 4, 1, "Dr. Nour", remakeOf = "MAD-0121"),
            case("MAD-0120", "Ahmed Zaki", "Denture", "Cairo Dental Lab", "fitted", null, 1, "Dr. Nour"),
        ),
    )
}
