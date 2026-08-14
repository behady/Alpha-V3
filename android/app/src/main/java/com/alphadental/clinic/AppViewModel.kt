package com.alphadental.clinic

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.ClinicSchedule
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.Patient
import com.alphadental.clinic.data.PatientFile
import com.alphadental.clinic.data.Slot
import com.alphadental.clinic.data.buildSlots
import com.alphadental.clinic.data.DayResult
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.data.Session
import com.google.firebase.firestore.DocumentSnapshot
import com.alphadental.clinic.ui.BookingDraft
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Which of the app's three screens is showing. */
enum class Tab { HOME, DAY, PATIENTS, MORE }

data class AppState(
    val loading: Boolean = true,
    val session: Session? = null,
    val signInError: String? = null,
    val signingIn: Boolean = false,
    val tab: Tab = Tab.HOME,
    /** The day being shown, as "yyyy-MM-dd". */
    val date: String = AppViewModel.today(),
    val appointments: List<Appointment> = emptyList(),
    val loadingDay: Boolean = true,
    /** True when the data on screen came from this phone's cache, not the server. */
    val offline: Boolean = false,
    /** Changes made here that have not reached the server yet. */
    val pending: Int = 0,
    val arabic: Boolean = false,
    val message: String? = null,
    // --- booking ---
    val schedule: ClinicSchedule = ClinicSchedule(),
    val doctors: List<Doctor> = emptyList(),
    val visitReasons: List<String> = emptyList(),
    val services: List<Service> = emptyList(),
    val searchResults: List<Patient> = emptyList(),
    val searching: Boolean = false,
    val saving: Boolean = false,
    /** Open when booking; carries the appointment being moved when rescheduling. */
    val booking: BookingTarget? = null,
    // --- patient file ---
    /** Search results for the Patients tab, kept apart from the booking sheet's own search. */
    val patientResults: List<Patient> = emptyList(),
    val patientSearching: Boolean = false,
    /** True while a further page is being fetched, so the button can say so. */
    val patientLoadingMore: Boolean = false,
    val patientHasMore: Boolean = false,
    /** What the list currently reflects, so paging cannot mix a search into a browse. */
    val patientQuery: String = "",
    val openPatientId: String? = null,
    val patientFile: PatientFile? = null,
    val patientLoading: Boolean = false,
    val patientError: String? = null,
)

/** Null target means a new booking; a set one means that appointment is being moved. */
data class BookingTarget(val moving: Appointment? = null)

class AppViewModel : ViewModel() {

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    private var dayJob: Job? = null

    /**
     * Where the patient list stopped, so the next page continues from there.
     *
     * Held outside the state because it is a Firestore document, not something any screen renders —
     * putting it in the state would make every list update compare a database object for equality.
     */
    private var cursor: DocumentSnapshot? = null

    init {
        // A signed-in user should never see the login screen again just because the
        // app was closed — Firebase keeps the session, so restore it silently.
        if (Repository.isSignedIn()) {
            viewModelScope.launch { restoreSession() }
        } else {
            _state.value = _state.value.copy(loading = false)
        }
    }

    private suspend fun restoreSession() {
        Repository.loadSession()
            .onSuccess { session ->
                _state.value = _state.value.copy(loading = false, session = session)
                watchDay(session.clinicId, _state.value.date)
            }
            .onFailure { error ->
                // The account exists in Firebase but not in this clinic system — a
                // stale login. Sign out rather than leaving a half-session that
                // fails on every read.
                Repository.signOut()
                _state.value = _state.value.copy(loading = false, session = null, signInError = error.message)
            }
    }

    fun signIn(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _state.value = _state.value.copy(signInError = "Enter your email and password.")
            return
        }
        _state.value = _state.value.copy(signingIn = true, signInError = null)
        viewModelScope.launch {
            Repository.signIn(email, password)
                .onSuccess { session ->
                    _state.value = _state.value.copy(signingIn = false, session = session, signInError = null)
                    watchDay(session.clinicId, _state.value.date)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(signingIn = false, signInError = error.message ?: "Could not sign in.")
                }
        }
    }

    fun signOut() {
        dayJob?.cancel()
        Repository.signOut()
        _state.value = AppState(loading = false)
    }

    fun selectTab(tab: Tab) {
        _state.value = _state.value.copy(tab = tab)
        // Land on a browsable directory rather than an empty screen. Only on the first visit —
        // coming back to the tab keeps whatever was on screen.
        if (tab == Tab.PATIENTS && _state.value.patientResults.isEmpty() && _state.value.patientQuery.isEmpty()) {
            searchPatientsTab("")
        }
    }

    fun toggleLanguage() {
        _state.value = _state.value.copy(arabic = !_state.value.arabic)
    }

    fun shiftDay(days: Int) {
        val calendar = Calendar.getInstance().apply { time = parseDate(_state.value.date) }
        calendar.add(Calendar.DAY_OF_YEAR, days)
        showDate(formatDate(calendar.time))
    }

    fun showToday() = showDate(today())

    private fun showDate(date: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(date = date, loadingDay = true, appointments = emptyList())
        watchDay(session.clinicId, date)
    }

    /** Listen to one day. Replaces any previous listener so only one is ever live. */
    private fun watchDay(clinicId: String, date: String) {
        dayJob?.cancel()
        dayJob = viewModelScope.launch {
            Repository.observeDay(clinicId, date).collect { result: DayResult ->
                _state.value = _state.value.copy(
                    appointments = result.appointments,
                    loadingDay = false,
                    offline = result.fromCache,
                    pending = result.pendingCount,
                    message = result.error,
                )
            }
        }
    }

    /**
     * Change an appointment's status.
     *
     * No optimistic local edit is applied: the Firestore listener reports the
     * change back immediately from the cache, so the screen updates at once and
     * still shows the row as pending until the server confirms it. Writing our own
     * optimistic copy on top would only create a second source of truth to
     * disagree with.
     */
    fun setStatus(appointment: Appointment, next: String) {
        val session = _state.value.session ?: return
        viewModelScope.launch {
            Repository.setStatus(session.clinicId, appointment, next, session.name)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "That change could not be saved.")
                }
        }
    }

    fun dismissMessage() {
        _state.value = _state.value.copy(message = null)
    }

    // -------------------------------------------------------------- patient file

    /**
     * Search from the Patients tab.
     *
     * Deliberately a separate result list from the booking sheet's. Sharing one would mean opening
     * the booking sheet wiped whatever the Patients tab was showing, and coming back to a cleared
     * search you did not clear is the kind of small wrongness that makes an app feel unreliable.
     */
    fun searchPatientsTab(term: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(patientSearching = true, patientQuery = term)
        cursor = null

        viewModelScope.launch {
            val page = runCatching { Repository.searchPatients(session.clinicId, term) }
                .getOrDefault(Repository.PatientPage(emptyList()))

            // A slow response for a term the user has already typed past would otherwise replace
            // the newer results with older ones.
            if (_state.value.patientQuery != term) return@launch

            cursor = page.cursor
            _state.value = _state.value.copy(
                patientResults = page.patients,
                patientSearching = false,
                patientHasMore = page.hasMore,
            )
        }
    }

    /**
     * Fetch the next page and append it.
     *
     * Guarded on both flags so a double tap, or a tap while the first page is still arriving,
     * cannot request the same page twice and show every patient in it twice.
     */
    fun loadMorePatients() {
        val session = _state.value.session ?: return
        val state = _state.value
        if (state.patientLoadingMore || state.patientSearching || !state.patientHasMore) return

        _state.value = state.copy(patientLoadingMore = true)
        val term = state.patientQuery
        val after = cursor

        viewModelScope.launch {
            val page = runCatching { Repository.searchPatients(session.clinicId, term, after) }
                .getOrDefault(Repository.PatientPage(emptyList()))

            if (_state.value.patientQuery != term) return@launch

            cursor = page.cursor
            _state.value = _state.value.copy(
                patientResults = _state.value.patientResults + page.patients,
                patientLoadingMore = false,
                patientHasMore = page.hasMore,
            )
        }
    }

    fun openPatient(patientId: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(
            openPatientId = patientId,
            patientFile = null,
            patientLoading = true,
            patientError = null,
        )
        viewModelScope.launch {
            Repository.loadPatientFile(session.clinicId, patientId)
                .onSuccess { file ->
                    // Ignore a result that arrived after the user moved on, so a slow read cannot
                    // pop a stale patient over whoever they are looking at now.
                    if (_state.value.openPatientId == patientId) {
                        _state.value = _state.value.copy(patientFile = file, patientLoading = false)
                    }
                }
                .onFailure { error ->
                    if (_state.value.openPatientId == patientId) {
                        _state.value = _state.value.copy(
                            patientLoading = false,
                            patientError = error.message ?: "That patient could not be opened.",
                        )
                    }
                }
        }
    }

    fun closePatient() {
        _state.value = _state.value.copy(
            openPatientId = null,
            patientFile = null,
            patientLoading = false,
            patientError = null,
        )
    }

    // ------------------------------------------------------------------- booking

    /**
     * Open the booking sheet.
     *
     * The clinic's hours and doctor list are fetched when the sheet opens rather than at sign-in,
     * so a change made on the website that morning is picked up without restarting the app. Both
     * come from the Firestore cache when offline, so booking still works with no signal.
     */
    fun openBooking(moving: Appointment? = null) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(booking = BookingTarget(moving), searchResults = emptyList())

        viewModelScope.launch {
            val schedule = runCatching { Repository.loadSchedule(session.clinicId) }.getOrDefault(ClinicSchedule())
            val doctors = runCatching { Repository.loadDoctors(session.clinicId) }.getOrDefault(emptyList())
            val reasons = runCatching { Repository.loadVisitReasons(session.clinicId) }.getOrDefault(emptyList())
            val services = runCatching { Repository.loadServices(session.clinicId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(
                schedule = schedule,
                doctors = doctors,
                visitReasons = reasons,
                services = services,
            )
        }
    }

    fun closeBooking() {
        _state.value = _state.value.copy(booking = null, searchResults = emptyList(), searching = false)
    }

    fun searchPatients(term: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(searching = true)
        viewModelScope.launch {
            val results = runCatching { Repository.searchPatientList(session.clinicId, term) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(searchResults = results, searching = false)
        }
    }

    /** The slots for the day on screen, with existing appointments blocked out. */
    fun slots(): List<Slot> {
        val state = _state.value
        return buildSlots(
            schedule = state.schedule,
            existing = state.appointments,
            ignoreAppointmentId = state.booking?.moving?.id,
        )
    }

    /**
     * Save a booking, or move an existing appointment.
     *
     * A brand-new patient is created first and only then booked. If the patient write succeeds and
     * the appointment write fails, the clinic is left with a patient record and no appointment —
     * visible and fixable — rather than an appointment pointing at a patient that does not exist,
     * which reads as a corrupted record everywhere it appears.
     */
    fun saveBooking(draft: BookingDraft) {
        val session = _state.value.session ?: return
        val target = _state.value.booking ?: return
        val date = _state.value.date

        _state.value = _state.value.copy(saving = true)

        viewModelScope.launch {
            val moving = target.moving
            val result: Result<Unit> = if (moving != null) {
                Repository.rescheduleAppointment(
                    clinicId = session.clinicId,
                    appointment = moving,
                    dateKey = date,
                    time = draft.time,
                    doctor = draft.doctor,
                    byName = session.name,
                )
            } else {
                resolvePatient(session.clinicId, draft).mapCatching { patient ->
                    Repository.createAppointment(
                        clinicId = session.clinicId,
                        patient = patient,
                        doctor = draft.doctor,
                        dateKey = date,
                        time = draft.time,
                        // A service with its own length wins over the clinic's default slot:
                        // booking a crown into a 30-minute gap is how a day overruns.
                        durationMinutes = draft.service?.durationMinutes?.takeIf { it > 0 }
                            ?: _state.value.schedule.slotDuration,
                        treatment = draft.treatment,
                        notes = draft.notes,
                        service = draft.service,
                        byName = session.name,
                    ).getOrThrow()
                    Unit
                }
            }

            result
                .onSuccess {
                    _state.value = _state.value.copy(
                        saving = false,
                        booking = null,
                        searchResults = emptyList(),
                        message = if (moving != null) "Appointment moved." else "Appointment booked.",
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        saving = false,
                        message = error.message ?: "That booking could not be saved.",
                    )
                }
        }
    }

    private suspend fun resolvePatient(clinicId: String, draft: BookingDraft): Result<Patient> {
        draft.patient?.let { return Result.success(it) }
        if (draft.newPatientName.isBlank()) {
            return Result.failure(Exception("Choose a patient, or enter a name for a new one."))
        }
        return Repository.createPatient(clinicId, draft.newPatientName, draft.newPatientPhone)
    }

    companion object {
        private fun formatter() = SimpleDateFormat("yyyy-MM-dd", Locale.US)

        /** Today in the phone's own timezone, matching how the website keys dates. */
        fun today(): String = formatter().format(Date())

        fun formatDate(date: Date): String = formatter().format(date)

        fun parseDate(value: String): Date = runCatching { formatter().parse(value) }.getOrNull() ?: Date()
    }
}
