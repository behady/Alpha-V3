package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.OrthoCase
import com.alphadental.clinic.data.OrthoVisit
import com.alphadental.clinic.data.Patient
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/** The three stages a case moves through, as the website stores them. */
enum class OrthoStage(val stored: String, val label: String) {
    Active("Active", "In treatment"),
    Retention("Retention", "Retention"),
    Completed("Completed", "Finished"),
    ;

    companion object {
        /** Absent reads as Active: a case written before the field existed is a live one. */
        fun from(raw: String?): OrthoStage =
            entries.firstOrNull { it.stored.equals(raw?.trim(), ignoreCase = true) } ?: Active
    }
}

enum class OrthoFilter(val label: String) {
    Due("Due a visit"),
    Active("In treatment"),
    Retention("Retention"),
    Completed("Finished"),
    All("All"),
}

/**
 * How long a case has gone without an adjustment.
 *
 * Ordinary review intervals, not a clinical rule — a wire is usually changed
 * every four to six weeks, so six is the first point at which a gap is worth
 * looking at and ten is a case that has quietly stopped being treated. The
 * screen says as much rather than presenting these as medicine.
 */
private const val DUE_WEEKS = 6
private const val LATE_WEEKS = 10

/** One case, with the arithmetic the board sorts and colours by. */
data class OrthoRow(val case: OrthoCase) {
    val stage: OrthoStage get() = OrthoStage.from(case.status)

    val visits: List<OrthoVisit>
        get() = case.visits.sortedByDescending { it.date.ifBlank { "0000-00-00" } }

    val lastVisit: OrthoVisit? get() = visits.firstOrNull { it.date.isNotBlank() }

    /** The last adjustment, or the day the case was opened if there has been none. */
    private val lastTouchedKey: String
        get() = lastVisit?.date?.takeIf { it.isNotBlank() } ?: case.startDate

    val daysSinceTouched: Long?
        get() = daysBetween(lastTouchedKey, ClinicSource.dateKey())

    val weeksSinceTouched: Long? get() = daysSinceTouched?.let { it / 7 }

    /** How long the case has been running, from the day it opened. */
    val monthsRunning: Long?
        get() = daysBetween(case.startDate, ClinicSource.dateKey())?.let { it / 30 }

    /**
     * Only a case still in treatment can be due.
     *
     * A finished case has nothing to come back for, and one in retention is seen
     * every few months by design — flagging either would fill the board with rows
     * nobody can act on, which is how a board stops being read.
     */
    val due: Boolean
        get() = stage == OrthoStage.Active && (weeksSinceTouched ?: 0) >= DUE_WEEKS

    val late: Boolean
        get() = stage == OrthoStage.Active && (weeksSinceTouched ?: 0) >= LATE_WEEKS

    /** "5 weeks ago", "never" — what the row leads its caption with. */
    val sinceLabel: String
        get() {
            val days = daysSinceTouched ?: return "no date"
            return when {
                lastVisit == null && days >= 0 -> "no adjustment yet"
                days <= 0L -> "seen today"
                days == 1L -> "seen yesterday"
                days < 14 -> "seen $days days ago"
                else -> "seen ${days / 7} weeks ago"
            }
        }
}

data class Ortho(
    val loading: Boolean = true,
    val who: Who? = null,
    val cases: List<OrthoRow> = emptyList(),
    val filter: OrthoFilter = OrthoFilter.Due,
    /** The case being read, by patient id. */
    val open: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    /** Patient search, for opening a case on somebody new. */
    val search: String = "",
    val found: List<Person> = emptyList(),
    val searching: Boolean = false,
) {
    val canEdit: Boolean get() = who?.can("clinical.edit") == true

    val openCase: OrthoRow? get() = cases.firstOrNull { it.case.patientId == open }

    val active: List<OrthoRow> get() = cases.filter { it.stage == OrthoStage.Active }
    val retention: List<OrthoRow> get() = cases.filter { it.stage == OrthoStage.Retention }
    val completed: List<OrthoRow> get() = cases.filter { it.stage == OrthoStage.Completed }
    val due: List<OrthoRow> get() = cases.filter { it.due }

    val shown: List<OrthoRow>
        get() = when (filter) {
            OrthoFilter.Due -> due
            OrthoFilter.Active -> active
            OrthoFilter.Retention -> retention
            OrthoFilter.Completed -> completed
            OrthoFilter.All -> cases
        }.sortedWith(
            // Longest untouched first, which is the whole point of the board: a
            // list in alphabetical order tells you who is on it, not who has been
            // forgotten.
            compareByDescending<OrthoRow> { it.daysSinceTouched ?: -1 }
                .thenBy { it.case.patientName.lowercase() }
        )
}

/**
 * Orthodontic cases.
 *
 * A queue, ordered by how long since anybody touched the case. An ortho patient
 * who stops coming does not cancel — they simply do not book again, and a wire
 * left on for a year is an active harm rather than a lapsed subscription. The
 * only screen that can catch that is one that counts the silence.
 *
 * The reads and writes are `Repository`'s, unchanged. The awkward parts are
 * already solved there and are worth leaving solved: adjustments are appended
 * with arrayUnion so two chairs logging at once cannot erase each other, edits
 * to an existing visit run in a transaction for the same reason, and opening a
 * case also sets the `isOrthoPatient` flag the website's patient list badges.
 */
class OrthoModel : ViewModel() {

    private val _state = MutableStateFlow(Ortho())
    val state: StateFlow<Ortho> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.ortho")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see orthodontic cases.",
                        )
                        return@onSuccess
                    }
                    load()
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    private fun load() {
        val who = _state.value.who ?: return
        viewModelScope.launch {
            runCatching { Repository.loadOrthoCases(who.clinicId) }
                .onSuccess { cases ->
                    _state.value = _state.value.copy(
                        loading = false,
                        busy = false,
                        cases = cases.map(::OrthoRow),
                        error = null,
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, busy = false, error = readable(e))
                }
        }
    }

    fun refresh() = load()

    fun show(filter: OrthoFilter) {
        _state.value = _state.value.copy(filter = filter)
    }

    fun open(patientId: String) {
        _state.value = _state.value.copy(open = patientId, error = null)
    }

    fun close() {
        _state.value = _state.value.copy(open = null, error = null)
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    // ------------------------------------------------------------------ writes

    /**
     * Log an adjustment.
     *
     * The visit number comes from the list this phone holds. Two chairs logging
     * in the same minute can therefore produce two visits sharing a number —
     * untidy, visible, and far better than the alternative the array would give
     * us, where one of them silently disappears.
     */
    fun logVisit(workDone: String, nextStep: String, date: String = ClinicSource.dateKey()) {
        val who = _state.value.who ?: return
        val row = _state.value.openCase ?: return
        if (!_state.value.canEdit || workDone.isBlank()) return
        val next = (row.case.visits.maxOfOrNull { it.visitNo } ?: 0) + 1
        write {
            Repository.addOrthoVisit(
                who.clinicId,
                row.case.patientId,
                OrthoVisit(visitNo = next, date = date, workDone = workDone, nextStep = nextStep),
            )
        }
    }

    fun reviseVisit(visitNo: Int, replacement: OrthoVisit?) {
        val who = _state.value.who ?: return
        val row = _state.value.openCase ?: return
        if (!_state.value.canEdit) return
        write { Repository.reviseOrthoVisit(who.clinicId, row.case.patientId, visitNo, replacement) }
    }

    fun setStage(stage: OrthoStage) {
        val who = _state.value.who ?: return
        val row = _state.value.openCase ?: return
        if (!_state.value.canEdit) return
        write { Repository.setOrthoStatus(who.clinicId, row.case.patientId, stage.stored) }
    }

    fun saveDetails(diagnosis: String, ceph: Map<String, String>) {
        val who = _state.value.who ?: return
        val row = _state.value.openCase ?: return
        if (!_state.value.canEdit) return
        write { Repository.updateOrthoCase(who.clinicId, row.case.patientId, diagnosis, ceph) }
    }

    /** Open a case on somebody who does not have one. */
    fun startCase(person: Person) {
        val who = _state.value.who ?: return
        if (!_state.value.canEdit) return
        _state.value = _state.value.copy(search = "", found = emptyList())
        write(thenOpen = person.id) {
            Repository.startOrthoCase(
                who.clinicId,
                Patient(id = person.id, name = person.name, phone = person.phone, balance = person.balance),
            )
        }
    }

    private fun write(thenOpen: String? = null, action: suspend () -> Result<Unit>) {
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            action()
                .onSuccess {
                    if (thenOpen != null) _state.value = _state.value.copy(open = thenOpen)
                    // Re-read rather than patching the list here. The visit array
                    // is written by arrayUnion and by transactions, so what is on
                    // the server after a write is not always what this phone
                    // would have guessed.
                    load()
                }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    // ------------------------------------------------------------------ search

    fun searchPatients(term: String) {
        _state.value = _state.value.copy(search = term)
        val who = _state.value.who ?: return
        if (term.trim().length < 2) {
            _state.value = _state.value.copy(found = emptyList(), searching = false)
            return
        }
        _state.value = _state.value.copy(searching = true)
        viewModelScope.launch {
            val hits = runCatching { ClinicSource.searchPeople(who.clinicId, term) }.getOrDefault(emptyList())
            // Somebody who already has a case is not a search result worth
            // offering — tapping them would reopen the case they already have.
            val taken = _state.value.cases.map { it.case.patientId }.toSet()
            _state.value = _state.value.copy(
                found = hits.filterNot { it.id in taken }.take(8),
                searching = false,
            )
        }
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) ->
                "This account is not allowed to change orthodontic cases."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. Nothing was changed."
            else -> "That could not be saved."
        }
    }
}

/** Whole days between two "yyyy-MM-dd" keys, or null when either is unusable. */
private fun daysBetween(from: String, to: String): Long? {
    if (from.isBlank() || to.isBlank()) return null
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val a = runCatching { fmt.parse(from) }.getOrNull() ?: return null
    val b = runCatching { fmt.parse(to) }.getOrNull() ?: return null
    return TimeUnit.MILLISECONDS.toDays(b.time - a.time)
}

/** Ortho, filled with the design's example data. See [previewDashboard]. */
fun previewOrtho(): Ortho {
    fun day(offset: Int) = ClinicSource.dateKey(
        java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, offset) }.time
    )
    fun case(
        id: String, name: String, status: String, started: Int,
        visits: List<Pair<Int, String>>, diagnosis: String = "",
    ) = OrthoRow(
        OrthoCase(
            patientId = id,
            patientName = name,
            patientPhone = "+201001234567",
            startDate = day(started),
            status = status,
            diagnosis = diagnosis,
            visits = visits.mapIndexed { i, (offset, work) ->
                OrthoVisit(visitNo = i + 1, date = day(offset), workDone = work, nextStep = "Review in 5 weeks")
            },
            cephData = if (diagnosis.isBlank()) emptyMap() else mapOf("sna" to "82", "snb" to "79", "anb" to "3"),
        )
    )
    return Ortho(
        loading = false,
        who = previewDashboard().who,
        filter = OrthoFilter.Due,
        cases = listOf(
            case(
                "p1", "Mariam Hassan", "Active", -400,
                listOf(-300 to "Bonded upper", -240 to "Archwire 016", -83 to "Archwire 018 NiTi"),
                diagnosis = "Class II div 1, 6mm overjet",
            ),
            case("p2", "Khaled Mostafa", "Active", -210, listOf(-180 to "Bonded lower", -52 to "Power chain 3-3")),
            case("p3", "Yara Sameh", "Active", -120, listOf(-90 to "Bonded upper and lower", -12 to "Archwire change")),
            case("p4", "Omar Abdelrahman", "Retention", -900, listOf(-800 to "Debond", -120 to "Retainer check")),
            case("p5", "Salma Ibrahim", "Completed", -1200, listOf(-400 to "Debond and retainers fitted")),
            case("p6", "Hania Adel", "Active", -30, emptyList()),
        ),
    )
}
