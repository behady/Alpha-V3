package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Who
import com.google.firebase.firestore.DocumentSnapshot
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A heading in the directory, and the people filed under it. */
data class Group(val label: String, val people: List<Person>)

data class Patients(
    val loading: Boolean = true,
    val who: Who? = null,
    val query: String = "",
    val searching: Boolean = false,
    val people: List<Person> = emptyList(),
    val debtors: List<Person> = emptyList(),
    val more: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    /** A new patient is being written. */
    val adding: Boolean = false,
    val addError: String? = null,
    /** The file that was just opened, so the screen can go straight to it. */
    val added: String? = null,
) {
    val canAdd: Boolean get() = who?.can("patients.add") == true
    val isSearching: Boolean get() = query.isNotBlank()

    /**
     * The directory, grouped.
     *
     * Whoever owes money comes first, because that is the one thing about a
     * patient that someone at a desk has to act on — and it is the reason to open
     * this screen without a name in mind. Everyone else files under their letter.
     *
     * While searching there are no groups at all: results ranked by relevance and
     * then chopped into letters would bury the best match under a heading.
     */
    val groups: List<Group>
        get() {
            if (isSearching) return listOf(Group("", people))
            return buildList {
                // Pinned above the register, and deliberately ALSO left in their
                // letter below: this is a shortcut to the people someone has to
                // chase, not a separate directory. Somebody looking under M for
                // Mariam should still find her there.
                if (debtors.isNotEmpty()) add(Group("Owes money · ${debtors.size}", debtors))
                people
                    .groupBy { it.initial }
                    .toSortedMap()
                    .forEach { (letter, group) -> add(Group(letter, group)) }
            }
        }
}

/**
 * The patient register.
 *
 * Browsing and searching are one screen rather than two: with the box empty this
 * is the whole register in name order, because a clinic often wants to look
 * through patients rather than already know the name.
 */
class PatientsModel : ViewModel() {

    private val _state = MutableStateFlow(Patients())
    val state: StateFlow<Patients> = _state.asStateFlow()

    private var cursor: DocumentSnapshot? = null
    private var searchJob: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    firstPage(who)
                    // Money is a permission, not a role — and a directory that
                    // silently omits the "owes" section for someone who may not
                    // see money is more honest than one showing an empty heading.
                    if (who.can("access.finance")) {
                        _state.value = _state.value.copy(debtors = ClinicSource.debtors(who.clinicId))
                    }
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
        }
    }

    private suspend fun firstPage(who: Who) {
        runCatching { ClinicSource.browsePeople(who.clinicId) }
            .onSuccess { page ->
                cursor = page.cursor
                _state.value = _state.value.copy(loading = false, people = page.people, more = page.more)
            }
            .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
    }

    /**
     * Search, debounced.
     *
     * Every keystroke re-queries, including back to empty — so clearing the box
     * returns to the directory rather than leaving the last search stranded. One
     * character is enough: that is what the website accepts, and someone typing
     * "m" expects the Ms.
     */
    /**
     * Open a file for somebody new.
     *
     * The file number comes from a counter transaction shared with the website
     * and the booking flow, so two people registering at once cannot both be
     * handed PT-1042. That transaction is the one part of this that needs a
     * connection, and it says so when there is none rather than inventing a
     * number that would collide later.
     */
    fun addPatient(name: String, phone: String) {
        val who = _state.value.who ?: return
        if (!_state.value.canAdd || name.isBlank() || _state.value.adding) return
        _state.value = _state.value.copy(adding = true, addError = null, added = null)
        viewModelScope.launch {
            com.alphadental.clinic.data.Repository.createPatient(who.clinicId, name, phone)
                .onSuccess { patient ->
                    _state.value = _state.value.copy(adding = false, added = patient.id)
                    // Put them in the list straight away rather than waiting for
                    // a reload: the next thing anybody does is open the file.
                    firstPage(who)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        adding = false,
                        addError = e.message ?: "That patient could not be added.",
                    )
                }
        }
    }

    fun clearAdded() {
        _state.value = _state.value.copy(added = null, addError = null)
    }

    fun search(term: String) {
        _state.value = _state.value.copy(query = term)
        searchJob?.cancel()
        val who = _state.value.who ?: return
        searchJob = viewModelScope.launch {
            delay(300)
            if (term.isBlank()) {
                _state.value = _state.value.copy(searching = true)
                firstPage(who)
                _state.value = _state.value.copy(searching = false)
                return@launch
            }
            _state.value = _state.value.copy(searching = true)
            runCatching { ClinicSource.searchPeople(who.clinicId, term) }
                .onSuccess { found ->
                    _state.value = _state.value.copy(
                        people = found,
                        searching = false,
                        // Filtered in memory, so there is nothing to continue from:
                        // everything that matched inside the scan is already here.
                        more = false,
                        error = null,
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(searching = false, error = e.message)
                }
        }
    }

    fun loadMore() {
        val who = _state.value.who ?: return
        val from = cursor ?: return
        if (_state.value.loadingMore || _state.value.isSearching) return
        _state.value = _state.value.copy(loadingMore = true)
        viewModelScope.launch {
            runCatching { ClinicSource.browsePeople(who.clinicId, from) }
                .onSuccess { page ->
                    cursor = page.cursor
                    _state.value = _state.value.copy(
                        people = _state.value.people + page.people,
                        more = page.more,
                        loadingMore = false,
                    )
                }
                .onFailure { _state.value = _state.value.copy(loadingMore = false) }
        }
    }
}

/** The register, filled with the design's example data. See [previewDashboard]. */
fun previewPatients(): Patients = Patients(
    loading = false,
    who = previewDashboard().who,
    debtors = listOf(
        Person("d1", "Mariam Hassan", "+20 100 442 8871", 2_400.0),
        Person("d2", "Khaled Mostafa", "+20 122 771 0043", 1_800.0),
    ),
    people = listOf(
        Person("1", "Ahmed Zaki", "+20 102 244 8891", 0.0),
        Person("2", "Asmaa Selim", "+20 127 710 4423", 0.0),
        Person("3", "Hania Adel", "+20 105 532 9904", 0.0),
        Person("4", "Hossam Fouad", "+20 114 422 7731", 0.0),
        Person("5", "Khaled Mostafa", "+20 122 771 0043", 1_800.0),
        Person("6", "Mariam Hassan", "+20 100 442 8871", 2_400.0),
        Person("7", "Omar Abdelrahman", "+20 128 900 1122", 0.0),
        Person("8", "Salma Ibrahim", "+20 111 200 3344", 0.0),
        Person("9", "Yara Sameh", "+20 109 887 6655", 0.0),
    ),
    more = true,
)
