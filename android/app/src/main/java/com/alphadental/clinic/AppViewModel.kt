package com.alphadental.clinic

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.ClinicSchedule
import com.alphadental.clinic.data.ClinicalNote
import com.alphadental.clinic.data.DayResult
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.DrugShortcut
import com.alphadental.clinic.data.GeofenceVerdict
import com.alphadental.clinic.data.InventoryItem
import com.alphadental.clinic.data.LocationFinder
import com.alphadental.clinic.data.Patient
import com.alphadental.clinic.data.PatientFile
import com.alphadental.clinic.data.Prescription
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.RxItem
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.data.ToothDiagnosis
import com.alphadental.clinic.data.Session
import com.alphadental.clinic.data.Slot
import com.alphadental.clinic.data.UnpaidProcedure
import com.alphadental.clinic.data.buildSlots
import com.alphadental.clinic.data.judgeGeofence
import com.alphadental.clinic.data.unpaidProcedures
import com.google.firebase.firestore.DocumentSnapshot
import com.alphadental.clinic.ui.BookingDraft
import com.alphadental.clinic.data.OrthoCase
import com.alphadental.clinic.data.OrthoVisit
import com.alphadental.clinic.data.ReportSummary
import com.alphadental.clinic.data.SourceLine
import com.alphadental.clinic.data.summariseSources
import com.alphadental.clinic.data.pricingUnits
import com.alphadental.clinic.data.summariseReport
import com.alphadental.clinic.ui.ReportRange
import com.alphadental.clinic.ai.AiClient
import com.alphadental.clinic.ai.AnswerCache
import com.alphadental.clinic.ai.ChatReplyClient
import com.alphadental.clinic.data.Chats
import com.alphadental.clinic.ai.ChatMessage
import com.alphadental.clinic.ai.ChatStore
import com.alphadental.clinic.ai.interpretYesNo
import com.alphadental.clinic.ui.NoteDraft
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Which of the app's three screens is showing. */
enum class Tab { HOME, DAY, PATIENTS, MONEY, MORE }

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
    val patientMedia: List<com.alphadental.clinic.data.PatientMedia> = emptyList(),
    val patientOrtho: List<OrthoCase> = emptyList(),
    val uploadingPhoto: Boolean = false,
    val savingDiagnosis: Boolean = false,
    /** True while a prescription PDF is being built or sent. */
    val rxBusy: Boolean = false,
    // --- leads (CRM) ---
    val leadsOpen: Boolean = false,
    val leads: List<com.alphadental.clinic.data.Lead> = emptyList(),
    val loadingLeads: Boolean = false,
    val leadAddOpen: Boolean = false,
    val savingLead: Boolean = false,
    val patientLoading: Boolean = false,
    val patientError: String? = null,
    // --- taking a payment ---
    val paymentOpen: Boolean = false,
    val outstanding: List<UnpaidProcedure> = emptyList(),
    val loadingOutstanding: Boolean = false,
    val savingPayment: Boolean = false,
    // --- clinical notes ---
    val notes: List<ClinicalNote> = emptyList(),
    val addNoteOpen: Boolean = false,
    val savingNote: Boolean = false,
    // --- attendance ---
    val openShift: Repository.OpenShift? = null,
    val clocking: Boolean = false,
    /** Set when clocking was refused, so the reason can be shown rather than a bare failure. */
    val clockError: String? = null,
    // --- prescriptions ---
    val prescriptions: List<Prescription> = emptyList(),
    val drugShortcuts: List<DrugShortcut> = emptyList(),
    val rxOpen: Boolean = false,
    val savingRx: Boolean = false,
    /** Collected today, for the owner's glance. Null until it has been read. */
    val takingsToday: Double? = null,
    // --- money screen ---
    val dayLedger: List<Repository.DayLedgerRow> = emptyList(),
    val loadingLedger: Boolean = false,
    // --- finance (the Money tab, mirroring the website's Finance page) ---
    /** "day" or "month". */
    val financeView: String = "day",
    /** The day being looked at; in month view, any day inside that month. */
    val financeAnchor: String = AppViewModel.today(),
    val financeRows: List<Repository.FinanceRow> = emptyList(),
    val loadingFinance: Boolean = false,
    val financeAddOpen: Boolean = false,
    val savingFinance: Boolean = false,
    /** The money row being looked at in detail, and the treatment history behind it. */
    val ledgerDetail: com.alphadental.clinic.data.PatientLedgerEntry? = null,
    val ledgerDetailPatientId: String = "",
    val ledgerDetailPatientName: String = "",
    val ledgerDetailHistory: Repository.ProcedureHistory? = null,
    val loadingLedgerDetail: Boolean = false,
    // --- inventory ---
    val inventory: List<InventoryItem> = emptyList(),
    val inventoryOpen: Boolean = false,
    val loadingInventory: Boolean = false,
    // --- WhatsApp messages waiting for a person to send ---
    /**
     * Kept in state even while the screen is shut, because the count is shown as a badge on More.
     * A list nobody is told about is a list nobody works through.
     */
    val whatsappQueue: List<Repository.PendingWhatsapp> = emptyList(),
    val whatsappQueueOpen: Boolean = false,
    // --- WhatsApp chats: the threads the server keeps on the official channel ---
    /**
     * Watched from sign-in, like the queue above, and for the same reason: the badge on the
     * Chats tile is how a receptionist learns a patient is waiting for a person.
     */
    val chats: List<Chats.ChatRow> = emptyList(),
    val chatsLoaded: Boolean = false,
    val chatsOpen: Boolean = false,
    /** The thread on screen, or blank for the list. */
    val openChatId: String = "",
    val chatLines: List<Chats.ChatLine> = emptyList(),
    val chatLinesLoading: Boolean = false,
    val chatSending: Boolean = false,
    /** A send that failed, shown above the composer until the next attempt. */
    val chatError: String? = null,
    /** A one-line notice — "went to the manual send list" — shown once and cleared. */
    val chatNotice: String? = null,
    /** How long a staff reply keeps the bot out of a thread; the clinic's setting. */
    val chatClaimMs: Long = Chats.DEFAULT_HUMAN_CLAIM_MS,
    // --- reads that failed ---
    /**
     * One per screen that reads once. Blank while the last read went through; a plain sentence
     * (see loadFailure) when it did not, shown as a banner with Retry over whatever is on screen.
     * Without these a failed read looked exactly like an empty list.
     */
    val leadsError: String? = null,
    val inventoryError: String? = null,
    val reportError: String? = null,
    val financeError: String? = null,
    val orthoError: String? = null,
    val patientsError: String? = null,
    /** The home slab's pull: takings, shift and briefing together. The day itself is live. */
    val homeRefreshing: Boolean = false,
    /** A pull on an open patient file: re-read without blanking the file underneath. */
    val patientRefreshing: Boolean = false,
    // --- reports ---
    val reportsOpen: Boolean = false,
    val reportRange: ReportRange = ReportRange.MONTH,
    val reportSummary: ReportSummary? = null,
    val reportRangeLabel: String = "",
    val loadingReport: Boolean = false,
    val reportSources: List<SourceLine> = emptyList(),
    val reportNewPatients: Int = 0,
    // --- ortho ---
    val orthoOpen: Boolean = false,
    val orthoCases: List<OrthoCase> = emptyList(),
    val orthoCase: OrthoCase? = null,
    val loadingOrtho: Boolean = false,
    val savingOrtho: Boolean = false,
    // --- clinic hours ---
    val hoursOpen: Boolean = false,
    val savingHours: Boolean = false,
    // --- the assistant ---
    val aiOpen: Boolean = false,
    val aiMessages: List<ChatMessage> = emptyList(),
    val aiThinking: Boolean = false,
    /** An action the assistant staged on the server, waiting for this person's yes. */
    val aiPending: AiClient.PendingAction? = null,
    /** A reply waiting to be read aloud. One-shot: the screen speaks it and calls aiSpoken(). */
    val aiSpeak: String? = null,
    /**
     * An appointment a tapped notification asked for, waiting to be shown.
     *
     * One-shot: the screen opens its sheet on it and calls pushAppointmentShown().
     */
    val pushAppointment: Appointment? = null,
    /** The appointment the assistant is acting on — its id and a human label for the chip. */
    val aiAppointmentId: String? = null,
    val aiAppointmentLabel: String = "",
    /** The lead being turned into a patient, so its button alone shows a spinner. */
    val convertingLeadId: String = "",
    /** The "what Alpha has learned" screen, and the rules it is showing. */
    val aiMemoryOpen: Boolean = false,
    val aiFacts: List<String> = emptyList(),
    val loadingAiFacts: Boolean = false,
    val aiFactsError: String? = null,
    /**
     * Today at a glance, fetched in the background once per sign-in. Null until it
     * arrives, and it stays null if it never does — the dashboard is not degraded
     * by its absence, so a failure here must not put an error card on it.
     */
    val briefing: com.alphadental.clinic.ai.BriefingClient.Briefing? = null,
    val briefingOpen: Boolean = false,
    val loadingBriefing: Boolean = false,
    val briefingError: String? = null,
) {
    /** Threads a person needs to answer: an open hand-off, or a patient message nobody has read. */
    val chatsWaiting: Int
        get() = chats.count { !it.archived && (it.needsHuman || it.unreadCount > 0) }
}

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
        // The remembered language, before anything is drawn. AppearanceStore is
        // initialised in Application.onCreate, so this is always the stored value
        // rather than the data class default.
        _state.value = _state.value.copy(
            arabic = com.alphadental.clinic.ui.AppearanceStore.state.value.arabic,
        )

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
                refreshShift()
                refreshTakings()
                watchClinicFeeds(session)
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
                    refreshShift()
                    refreshTakings()
                    watchClinicFeeds(session)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(signingIn = false, signInError = error.message ?: "Could not sign in.")
                }
        }
    }

    fun signInWithGoogle(idToken: String) {
        _state.value = _state.value.copy(signingIn = true, signInError = null)
        viewModelScope.launch {
            Repository.signInWithGoogle(idToken)
                .onSuccess { session ->
                    _state.value = _state.value.copy(signingIn = false, session = session, signInError = null)
                    watchDay(session.clinicId, _state.value.date)
                    refreshShift()
                    refreshTakings()
                    watchClinicFeeds(session)
                }
                .onFailure { error ->
                    // The Google account authenticated but has no staff profile here.
                    // Sign the half-session out rather than leaving credentials that
                    // fail on every read.
                    Repository.signOut()
                    _state.value = _state.value.copy(
                        signingIn = false,
                        signInError = error.message ?: "Could not sign in with Google.",
                    )
                }
        }
    }

    fun signOut() {
        dayJob?.cancel()
        // Per clinic and user; the next account must not inherit them.
        chatStore = null
        answerCache = null
        // The acting context is per account too: the next person to sign in must
        // not inherit an appointment the assistant was about to change.
        _state.value = _state.value.copy(aiAppointmentId = null, aiAppointmentLabel = "")
        // Cancelled explicitly: this listener was left running after sign-out, still watching the
        // old clinic's message queue with credentials the rules now reject — a stream of permission
        // errors, and a stale queue briefly shown if a different account signed in next.
        whatsappJob?.cancel()
        chatsJob?.cancel()
        chatLinesJob?.cancel()
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
        if (tab == Tab.MONEY) loadFinance()
    }

    /**
     * Switch the interface between English and Arabic, and remember it.
     *
     * The flag used to live only in this view model, which Android rebuilds with
     * every process — so the choice survived exactly as long as the app stayed in
     * memory, and an Arabic-speaking clinic re-picked Arabic every morning. It is
     * stored beside the theme now, and read back before the first screen is drawn.
     */
    fun toggleLanguage() {
        val next = !_state.value.arabic
        com.alphadental.clinic.ui.AppearanceStore.setArabic(next)
        _state.value = _state.value.copy(arabic = next)
    }

    fun shiftDay(days: Int) {
        val calendar = Calendar.getInstance().apply { time = parseDate(_state.value.date) }
        calendar.add(Calendar.DAY_OF_YEAR, days)
        showDate(formatDate(calendar.time))
    }

    fun showToday() = showDate(today())

    /**
     * Open one appointment by id, because a notification asked for it.
     *
     * The day behind the sheet is moved to the appointment's own date first — a
     * booking for tomorrow opened over today's list would put the patient's name
     * on a day that does not contain them. If it cannot be read (deleted since,
     * or a different clinic) the day view is still a sane place to land, and
     * saying so beats a tap that does nothing at all.
     */
    fun openAppointmentById(appointmentId: String) {
        val session = _state.value.session ?: return
        selectTab(Tab.DAY)
        viewModelScope.launch {
            val appointment = runCatching { Repository.loadAppointment(session.clinicId, appointmentId) }
                .getOrNull()
            if (appointment == null) {
                _state.value = _state.value.copy(
                    message = "That appointment could not be found — it may have been deleted.",
                )
                return@launch
            }
            if (appointment.date.isNotBlank() && appointment.date != _state.value.date) {
                showDate(appointment.date)
            }
            _state.value = _state.value.copy(pushAppointment = appointment)
        }
    }

    /** The sheet has it now; do not re-open it on the next recomposition. */
    fun pushAppointmentShown() {
        if (_state.value.pushAppointment != null) {
            _state.value = _state.value.copy(pushAppointment = null)
        }
    }

    private fun showDate(date: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(date = date, loadingDay = true, appointments = emptyList())
        watchDay(session.clinicId, date)
        if (_state.value.tab == Tab.MONEY) loadDayLedger()
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

    // ---------------------------------------------------------------- attendance

    /**
     * Today's takings, for the owner dashboard.
     *
     * Only fetched for the roles that see it — a receptionist's phone should not be pulling the
     * clinic's daily revenue it will never display.
     */
    /**
     * The money that moved on the day currently being viewed.
     *
     * Shares the same date as the schedule deliberately: stepping back a day to see who was booked
     * and what was taken is one question, and two independent date pickers would make it two.
     */
    fun loadDayLedger() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(loadingLedger = true)
        val date = _state.value.date
        viewModelScope.launch {
            val rows = runCatching { Repository.loadDayLedger(session.clinicId, date) }.getOrDefault(emptyList())
            // Ignore a slow response for a day the user has already moved past.
            if (_state.value.date == date) {
                _state.value = _state.value.copy(dayLedger = rows, loadingLedger = false)
            }
        }
    }

    // ---------------------------------------------------------------- finance

    /** The first and last day the current finance view covers, inclusive. */
    private fun financeBounds(): Pair<String, String> {
        val s = _state.value
        if (s.financeView == "day") return s.financeAnchor to s.financeAnchor
        val month = s.financeAnchor.take(7)
        val cal = java.util.Calendar.getInstance()
        cal.time = parseDate("$month-01")
        val lastDay = cal.getActualMaximum(java.util.Calendar.DAY_OF_MONTH)
        return "$month-01" to "$month-${String.format(java.util.Locale.US, "%02d", lastDay)}"
    }

    fun setFinanceView(view: String) {
        _state.value = _state.value.copy(financeView = view)
        loadFinance()
    }

    /** One step back or forward — a day in day view, a month in month view. */
    fun shiftFinance(delta: Int) {
        val s = _state.value
        val cal = java.util.Calendar.getInstance()
        cal.time = parseDate(s.financeAnchor)
        if (s.financeView == "month") {
            cal.add(java.util.Calendar.MONTH, delta)
            // Land on day 1 so stepping through short months never skips one.
            cal.set(java.util.Calendar.DAY_OF_MONTH, 1)
        } else {
            cal.add(java.util.Calendar.DAY_OF_YEAR, delta)
        }
        _state.value = s.copy(financeAnchor = formatter().format(cal.time))
        loadFinance()
    }

    fun financeToday() {
        _state.value = _state.value.copy(financeAnchor = today())
        loadFinance()
    }

    fun loadFinance() {
        val session = _state.value.session ?: return
        val (from, to) = financeBounds()
        _state.value = _state.value.copy(loadingFinance = true, financeError = null)
        viewModelScope.launch {
            val result = runCatching { Repository.loadFinance(session.clinicId, from, to) }
            // Ignore a slow response for a period the user has already moved past.
            if (financeBounds() != (from to to)) return@launch
            result
                .onSuccess { rows -> _state.value = _state.value.copy(financeRows = rows, loadingFinance = false) }
                // Emptied on purpose: the rows on screen belong to whatever period loaded last,
                // and leaving them under this period's heading would be a wrong number.
                .onFailure { error ->
                    _state.value = _state.value.copy(financeRows = emptyList(), loadingFinance = false, financeError = loadFailure(error))
                }
        }
    }

    /**
     * Open the detail of one money row.
     *
     * `known` is the patient's already-loaded statement when the tap came from
     * their own file — the history is then assembled in memory rather than read
     * again. From the clinic's Money tab there is no such list, so the
     * treatment's history is fetched.
     */
    fun openLedgerDetail(
        entry: com.alphadental.clinic.data.PatientLedgerEntry,
        patientId: String = "",
        patientName: String = "",
        known: List<com.alphadental.clinic.data.PatientLedgerEntry>? = null,
    ) {
        val session = _state.value.session ?: return
        // A treatment row is its own procedure; a payment names the one it paid.
        val procedureId = if (entry.isCharge) entry.id else entry.procedureId

        if (procedureId.isBlank()) {
            _state.value = _state.value.copy(
                ledgerDetail = entry,
                ledgerDetailPatientId = patientId,
                ledgerDetailPatientName = patientName,
                ledgerDetailHistory = null,
                loadingLedgerDetail = false,
            )
            return
        }

        if (known != null) {
            val history = Repository.ProcedureHistory(
                charge = known.firstOrNull { it.id == procedureId && it.isCharge },
                payments = known.filter { it.isPayment && it.procedureId == procedureId }
                    .sortedWith(
                        compareByDescending<com.alphadental.clinic.data.PatientLedgerEntry> { it.date }
                            .thenByDescending { it.createdAtMillis }
                    ),
            )
            _state.value = _state.value.copy(
                ledgerDetail = entry,
                ledgerDetailPatientId = patientId,
                ledgerDetailPatientName = patientName,
                ledgerDetailHistory = history,
                loadingLedgerDetail = false,
            )
            return
        }

        _state.value = _state.value.copy(
            ledgerDetail = entry,
            ledgerDetailPatientId = patientId,
            ledgerDetailPatientName = patientName,
            ledgerDetailHistory = null,
            loadingLedgerDetail = true,
        )
        viewModelScope.launch {
            val history = runCatching { Repository.loadProcedureHistory(session.clinicId, procedureId) }.getOrNull()
            // Ignore a slow read for a row the user has already closed or moved past.
            if (_state.value.ledgerDetail?.id == entry.id) {
                _state.value = _state.value.copy(ledgerDetailHistory = history, loadingLedgerDetail = false)
            }
        }
    }

    fun closeLedgerDetail() {
        _state.value = _state.value.copy(
            ledgerDetail = null,
            ledgerDetailHistory = null,
            loadingLedgerDetail = false,
        )
    }

    fun openFinanceAdd() {
        _state.value = _state.value.copy(financeAddOpen = true)
    }

    fun closeFinanceAdd() {
        _state.value = _state.value.copy(financeAddOpen = false)
    }

    fun saveFinanceEntry(income: Boolean, amount: Double, description: String, category: String, dateKey: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(savingFinance = true)
        viewModelScope.launch {
            Repository.addFinanceEntry(
                clinicId = session.clinicId,
                income = income,
                amount = amount,
                description = description,
                category = category,
                dateKey = dateKey,
                byName = session.name,
            ).onSuccess {
                _state.value = _state.value.copy(savingFinance = false, financeAddOpen = false)
                loadFinance()
                refreshTakings()
            }.onFailure { error ->
                _state.value = _state.value.copy(
                    savingFinance = false,
                    message = error.message ?: "The entry could not be saved.",
                )
            }
        }
    }

    fun deleteFinanceEntry(row: Repository.FinanceRow) {
        val session = _state.value.session ?: return
        // The screen only offers delete on manual rows, but a second guard here
        // costs nothing and a cascading delete gone wrong costs an evening.
        if (!row.isManual) return
        viewModelScope.launch {
            Repository.deleteFinanceEntry(session.clinicId, row.id)
                .onSuccess {
                    _state.value = _state.value.copy(
                        financeRows = _state.value.financeRows.filterNot { it.id == row.id }
                    )
                    refreshTakings()
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "Could not delete the entry.")
                }
        }
    }

    // ---------------------------------------------------------------- leads (CRM)

    fun openLeads() {
        _state.value = _state.value.copy(leadsOpen = true)
        refreshLeads()
    }

    /** Re-read the leads; a failure keeps the list that was there and says so above it. */
    fun refreshLeads() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(loadingLeads = true, leadsError = null)
        viewModelScope.launch {
            runCatching { Repository.loadLeads(session.clinicId) }
                .onSuccess { rows ->
                    if (_state.value.leadsOpen) _state.value = _state.value.copy(leads = rows, loadingLeads = false)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(loadingLeads = false, leadsError = loadFailure(error))
                }
        }
    }

    fun closeLeads() {
        _state.value = _state.value.copy(leadsOpen = false, leadAddOpen = false)
    }

    /**
     * Turn a lead into a patient file, which is what winning one means.
     *
     * Not optimistic, unlike the stage pills: this creates a record and mints a
     * file number, and showing "won" before the write lands would be claiming a
     * patient exists who might not. The reply says which of the two happened — a
     * new file, or a link to one already there — because "we already knew this
     * person" is the answer that changes what reception says next.
     */
    fun convertLead(lead: com.alphadental.clinic.data.Lead) {
        val session = _state.value.session ?: return
        if (_state.value.convertingLeadId.isNotBlank()) return

        _state.value = _state.value.copy(convertingLeadId = lead.id)
        viewModelScope.launch {
            Repository.convertLeadToPatient(session.clinicId, lead)
                .onSuccess { (patientId, existed) ->
                    _state.value = _state.value.copy(
                        convertingLeadId = "",
                        leads = _state.value.leads.map {
                            if (it.id == lead.id) it.copy(stage = "won", patientId = patientId, hasFirstContact = true)
                            else it
                        },
                        message = if (existed) {
                            "That number was already on file — the lead is linked to it."
                        } else {
                            "Patient file created for " + lead.name.ifBlank { "the lead" } + "."
                        },
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        convertingLeadId = "",
                        message = error.message ?: "The lead could not be converted.",
                    )
                }
        }
    }

    fun setLeadStage(lead: com.alphadental.clinic.data.Lead, stage: String, lostReason: String? = null) {
        val session = _state.value.session ?: return
        // Optimistic: the pill changes under the thumb, and a failure rolls back with a message.
        val before = _state.value.leads
        _state.value = _state.value.copy(
            leads = before.map {
                if (it.id == lead.id) it.copy(stage = stage, lostReason = lostReason.orEmpty(), hasFirstContact = true)
                else it
            }
        )
        viewModelScope.launch {
            Repository.setLeadStage(session.clinicId, lead, stage, lostReason)
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        leads = before,
                        message = error.message ?: "The lead could not be updated.",
                    )
                }
        }
    }

    fun openLeadAdd() {
        _state.value = _state.value.copy(leadAddOpen = true)
    }

    fun closeLeadAdd() {
        _state.value = _state.value.copy(leadAddOpen = false)
    }

    fun saveLead(name: String, phone: String, source: String, interest: String, notes: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(savingLead = true)
        viewModelScope.launch {
            Repository.addLead(session.clinicId, name, phone, source, interest, notes, session.name)
                .onSuccess {
                    _state.value = _state.value.copy(savingLead = false, leadAddOpen = false)
                    openLeads()
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        savingLead = false,
                        message = error.message ?: "The lead could not be saved.",
                    )
                }
        }
    }

    /**
     * Chart one tooth's condition.
     *
     * The patient file is updated in memory as well as written, because the
     * write is queued rather than confirmed — re-reading could come back from
     * the cache without it and the diagnosis would appear to vanish the moment
     * it was saved.
     */
    fun saveToothDiagnosis(tooth: String, statuses: List<String>, notes: String) {
        val session = _state.value.session ?: return
        val patientId = _state.value.openPatientId ?: return
        val file = _state.value.patientFile ?: return

        _state.value = _state.value.copy(savingDiagnosis = true)
        viewModelScope.launch {
            Repository.setToothDiagnosis(
                clinicId = session.clinicId,
                patientId = patientId,
                tooth = tooth,
                statuses = statuses,
                notes = notes,
                byName = session.name,
            ).onFailure { error ->
                _state.value = _state.value.copy(message = error.message ?: "The diagnosis could not be saved.")
            }

            val cleared = statuses.isEmpty() && notes.isBlank()
            val updated = file.diagnosis.filterNot { it.tooth == tooth } +
                if (cleared) emptyList() else listOf(ToothDiagnosis(tooth, statuses, notes.trim()))

            if (_state.value.openPatientId == patientId) {
                _state.value = _state.value.copy(
                    savingDiagnosis = false,
                    patientFile = file.copy(
                        diagnosis = updated.sortedBy { it.tooth.toIntOrNull() ?: Int.MAX_VALUE },
                    ),
                )
            } else {
                _state.value = _state.value.copy(savingDiagnosis = false)
            }
        }
    }

    /** A photo from the camera or gallery, already downscaled to JPEG bytes by the screen. */
    fun uploadPatientPhoto(bytes: ByteArray, category: String) {
        val session = _state.value.session ?: return
        val file = _state.value.patientFile ?: return
        val patientId = _state.value.openPatientId ?: return
        _state.value = _state.value.copy(uploadingPhoto = true)
        viewModelScope.launch {
            Repository.uploadPatientMedia(
                clinicId = session.clinicId,
                patientId = patientId,
                patientName = file.patient.name,
                bytes = bytes,
                category = category,
                byName = session.name,
            ).onSuccess {
                val media = runCatching { Repository.loadPatientMedia(session.clinicId, patientId) }
                    .getOrDefault(emptyList())
                if (_state.value.openPatientId == patientId) {
                    _state.value = _state.value.copy(uploadingPhoto = false, patientMedia = media)
                }
            }.onFailure { error ->
                _state.value = _state.value.copy(
                    uploadingPhoto = false,
                    message = error.message ?: "The photo could not be uploaded.",
                )
            }
        }
    }

    // ------------------------------------------------------- prescription paper

    /**
     * Build the printable script for one prescription.
     *
     * The PDF is drawn from the same clinic letterhead the website prints, then
     * handed to whatever the caller asked for — the print dialog, WhatsApp, or
     * the share sheet. Everything runs off the main thread; drawing a page and
     * reading the clinic document are both too slow to do under a tap.
     */
    fun prescriptionPdf(
        context: android.content.Context,
        prescription: com.alphadental.clinic.data.Prescription,
        onReady: (java.io.File) -> Unit,
    ) {
        val session = _state.value.session ?: return
        val file = _state.value.patientFile ?: return
        _state.value = _state.value.copy(rxBusy = true)
        viewModelScope.launch {
            val built = runCatching {
                val clinic = Repository.loadClinicInfo(session.clinicId)
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.alphadental.clinic.data.PrescriptionPdf.write(
                        context = context.applicationContext,
                        clinic = clinic,
                        patientName = file.patient.name,
                        patientPhone = file.patient.phone,
                        prescription = prescription,
                        arabic = _state.value.arabic,
                    )
                }
            }.getOrNull()

            _state.value = _state.value.copy(
                rxBusy = false,
                message = if (built == null) "The prescription could not be prepared." else _state.value.message,
            )
            built?.let(onReady)
        }
    }

    /**
     * Send the script to the patient over the clinic's WhatsApp gateway — the
     * same endpoint, and the same logging, as the website's send button.
     */
    fun sendPrescriptionWhatsapp(
        context: android.content.Context,
        prescription: com.alphadental.clinic.data.Prescription,
    ) {
        val session = _state.value.session ?: return
        val file = _state.value.patientFile ?: return
        val patientId = _state.value.openPatientId ?: return
        _state.value = _state.value.copy(rxBusy = true)
        viewModelScope.launch {
            val result = runCatching {
                val clinic = Repository.loadClinicInfo(session.clinicId)
                val pdf = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.alphadental.clinic.data.PrescriptionPdf.write(
                        context = context.applicationContext,
                        clinic = clinic,
                        patientName = file.patient.name,
                        patientPhone = file.patient.phone,
                        prescription = prescription,
                        arabic = _state.value.arabic,
                    ).readBytes()
                }
                Repository.sendPrescriptionWhatsapp(patientId, pdf).getOrThrow()
            }
            _state.value = _state.value.copy(
                rxBusy = false,
                message = if (result.isSuccess) {
                    "Prescription sent to ${file.patient.name} on WhatsApp."
                } else {
                    result.exceptionOrNull()?.message ?: "The prescription could not be sent."
                },
            )
        }
    }

    fun openInventory() {
        _state.value = _state.value.copy(inventoryOpen = true)
        refreshInventory()
    }

    fun refreshInventory() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(loadingInventory = true, inventoryError = null)
        viewModelScope.launch {
            runCatching { Repository.loadInventory(session.clinicId) }
                .onSuccess { items -> _state.value = _state.value.copy(inventory = items, loadingInventory = false) }
                .onFailure { error ->
                    _state.value = _state.value.copy(loadingInventory = false, inventoryError = loadFailure(error))
                }
        }
    }

    fun closeInventory() {
        _state.value = _state.value.copy(inventoryOpen = false)
    }

    // --- WhatsApp messages waiting for a person to send -----------------------------------

    private var whatsappJob: Job? = null

    /**
     * Watch the to-send list for as long as the session lasts.
     *
     * Started at sign-in rather than when the screen opens, because the point of the badge is to
     * tell somebody there is work waiting. A list you only discover by going looking for it does
     * not get worked through, and these are messages patients are expecting.
     */
    private fun watchWhatsappQueue(clinicId: String) {
        whatsappJob?.cancel()
        whatsappJob = viewModelScope.launch {
            Repository.observePendingWhatsapp(clinicId).collect { queue ->
                _state.value = _state.value.copy(whatsappQueue = queue)
            }
        }
    }

    fun openWhatsappQueue() {
        _state.value = _state.value.copy(whatsappQueueOpen = true)
    }

    fun closeWhatsappQueue() {
        _state.value = _state.value.copy(whatsappQueueOpen = false)
    }

    // --- WhatsApp chats -------------------------------------------------------------------

    private var chatsJob: Job? = null
    private var chatLinesJob: Job? = null

    /** The clinic-wide feeds that carry badges: the manual send list and the chat threads. */
    private fun watchClinicFeeds(session: Session) {
        watchWhatsappQueue(session.clinicId)
        watchChats(session)
    }

    /** May this account see the clinic's WhatsApp at all? The same key the website's Chats page uses. */
    fun canSeeChats(session: Session): Boolean = session.can("access.patients")

    /**
     * Watch every thread for as long as the session lasts, for the roles that may read them.
     *
     * The list is what the Chats tile's badge is drawn from — the count of patients waiting for a
     * person — and a badge that only updates when the screen is open is not a badge.
     */
    private fun watchChats(session: Session) {
        chatsJob?.cancel()
        if (!canSeeChats(session)) {
            _state.value = _state.value.copy(chats = emptyList(), chatsLoaded = true)
            return
        }
        chatsJob = viewModelScope.launch {
            _state.value = _state.value.copy(chatClaimMs = Chats.loadHumanClaimMs(session.clinicId))
            Chats.observeChats(session.clinicId).collect { rows ->
                _state.value = _state.value.copy(chats = rows, chatsLoaded = true)
            }
        }
    }

    fun openChats() {
        _state.value = _state.value.copy(chatsOpen = true)
    }

    fun closeChats() {
        closeChat()
        _state.value = _state.value.copy(chatsOpen = false)
    }

    /**
     * Open one thread. Opening it reads it: the unread count is cleared on the conversation so
     * the badge on every other phone and desk goes with it.
     */
    fun openChat(chatId: String) {
        val session = _state.value.session ?: return
        chatLinesJob?.cancel()
        _state.value = _state.value.copy(
            chatsOpen = true,
            openChatId = chatId,
            chatLines = emptyList(),
            chatLinesLoading = true,
            chatError = null,
            chatNotice = null,
        )
        chatLinesJob = viewModelScope.launch {
            Chats.observeLines(session.clinicId, chatId).collect { lines ->
                if (_state.value.openChatId == chatId) {
                    _state.value = _state.value.copy(chatLines = lines, chatLinesLoading = false)
                    // Read on every delivery, not just on open: a message that lands while the
                    // thread is on screen has been seen too.
                    if ((_state.value.chats.firstOrNull { it.id == chatId }?.unreadCount ?: 0) > 0) {
                        Chats.markRead(session.clinicId, chatId)
                    }
                }
            }
        }
    }

    fun closeChat() {
        chatLinesJob?.cancel()
        chatLinesJob = null
        _state.value = _state.value.copy(openChatId = "", chatLines = emptyList(), chatLinesLoading = false, chatError = null)
    }

    fun dismissChatNotice() {
        _state.value = _state.value.copy(chatNotice = null)
    }

    /**
     * Send what was typed. Not optimistic: the line appears when the server has recorded it,
     * which is a second later and honest — a bubble drawn before the send could still fail.
     * Answering claims the thread when nobody has it yet, so the row says who is handling it.
     */
    fun sendChatReply(text: String) {
        val session = _state.value.session ?: return
        val chat = _state.value.chats.firstOrNull { it.id == _state.value.openChatId } ?: return
        val body = text.trim()
        if (body.isBlank() || _state.value.chatSending) return
        _state.value = _state.value.copy(chatSending = true, chatError = null)
        viewModelScope.launch {
            runCatching {
                ChatReplyClient.sendText(session.clinicId, chat.phone, chat.patientId, chat.patientName, body)
            }.onSuccess { sent ->
                if (chat.assignedTo.isBlank()) {
                    Chats.assign(session.clinicId, chat.id, session.uid, session.name)
                }
                _state.value = _state.value.copy(
                    chatSending = false,
                    chatNotice = if (sent.mode == "queued") {
                        if (_state.value.arabic) "العيادة دي مش متوصلة بواتساب الرسمي — الرسالة اتحطت في قائمة الإرسال اليدوي."
                        else "This clinic has no WhatsApp gateway — the message went to the manual send list."
                    } else null,
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(
                    chatSending = false,
                    chatError = error.message ?: if (_state.value.arabic) "لم يتم الإرسال." else "Could not send.",
                )
            }
        }
    }

    /** The re-engagement template, for a thread whose 24-hour window has closed. */
    fun sendChatFollowup() {
        val session = _state.value.session ?: return
        val chat = _state.value.chats.firstOrNull { it.id == _state.value.openChatId } ?: return
        if (_state.value.chatSending) return
        _state.value = _state.value.copy(chatSending = true, chatError = null)
        viewModelScope.launch {
            runCatching {
                ChatReplyClient.sendFollowupTemplate(session.clinicId, chat.phone, chat.patientId, chat.patientName)
            }.onSuccess {
                _state.value = _state.value.copy(chatSending = false)
            }.onFailure { error ->
                _state.value = _state.value.copy(
                    chatSending = false,
                    chatError = error.message ?: if (_state.value.arabic) "لم يتم الإرسال." else "Could not send.",
                )
            }
        }
    }

    /** Take the thread from the bot, or hand it back. */
    fun toggleChatBot() {
        val session = _state.value.session ?: return
        val chat = _state.value.chats.firstOrNull { it.id == _state.value.openChatId } ?: return
        val quietNow = chat.botQuiet(_state.value.chatClaimMs)
        viewModelScope.launch {
            Chats.setBotQuiet(session.clinicId, chat.id, quiet = !quietNow, uid = session.uid)
                .onFailure { error ->
                    _state.value = _state.value.copy(chatError = error.message ?: "Could not update.")
                }
        }
    }

    /** Claim the thread for yourself, release it, or take it over from a colleague. */
    fun toggleChatAssign() {
        val session = _state.value.session ?: return
        val chat = _state.value.chats.firstOrNull { it.id == _state.value.openChatId } ?: return
        val mine = chat.assignedTo == session.uid
        viewModelScope.launch {
            val result = if (mine) Chats.assign(session.clinicId, chat.id, null, null)
            else Chats.assign(session.clinicId, chat.id, session.uid, session.name)
            result.onFailure { error ->
                _state.value = _state.value.copy(chatError = error.message ?: "Could not update.")
            }
        }
    }

    fun setChatArchived(archived: Boolean) {
        val session = _state.value.session ?: return
        val chat = _state.value.chats.firstOrNull { it.id == _state.value.openChatId } ?: return
        viewModelScope.launch {
            Chats.setArchived(session.clinicId, chat.id, archived).onFailure { error ->
                _state.value = _state.value.copy(chatError = error.message ?: "Could not update.")
            }
        }
    }

    // --- reports ---------------------------------------------------------------------------

    fun openReports() {
        _state.value = _state.value.copy(reportsOpen = true)
        loadReport(_state.value.reportRange)
    }

    fun closeReports() {
        _state.value = _state.value.copy(reportsOpen = false)
    }

    // --- ortho -----------------------------------------------------------------------------

    /**
     * Open the ortho tool.
     *
     * `onCase` jumps straight to one case — the patient file uses it, so tapping
     * a case there lands on that case rather than on the list. It is applied
     * synchronously and the reload below never clears it, or the jump would be
     * undone the moment the cases came back.
     */
    fun openOrtho(onCase: OrthoCase? = null) {
        _state.value = _state.value.copy(orthoOpen = true, orthoCase = onCase)
        refreshOrtho()
    }

    fun refreshOrtho() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(loadingOrtho = true, orthoError = null)
        viewModelScope.launch {
            runCatching { Repository.loadOrthoCases(session.clinicId) }
                .onSuccess { cases -> _state.value = _state.value.copy(orthoCases = cases, loadingOrtho = false) }
                .onFailure { error ->
                    _state.value = _state.value.copy(loadingOrtho = false, orthoError = loadFailure(error))
                }
        }
    }

    // --- the assistant ---------------------------------------------------------------------

    private var chatStore: ChatStore? = null
    private var answerCache: AnswerCache? = null

    /** Kept for drawing report PDFs after the assistant has been opened once. */
    private var aiContext: android.content.Context? = null

    /**
     * The turn in flight, and which turn it is.
     *
     * `aiThinking` greys out the composer and makes askAi drop anything typed, so
     * a single path that sets it and forgets to clear it leaves the assistant
     * permanently deaf — the "it gets stuck" everybody reports and nobody can
     * reproduce. Every turn now goes through [beginAiTurn] and clears in a
     * `finally`, whatever happens in between.
     *
     * The id exists because the appointment continuation starts a NEW turn while
     * the one that spawned it is still unwinding; without it the old turn's
     * `finally` would switch off the new turn's spinner on its way out.
     */
    private var aiJob: Job? = null
    private var aiTurnId = 0L

    private fun beginAiTurn(): Long {
        aiTurnId += 1
        _state.value = _state.value.copy(aiThinking = true)
        return aiTurnId
    }

    /** Only the newest turn owns the flag; a late finisher must not clear it. */
    private fun endAiTurn(id: Long) {
        if (id == aiTurnId) _state.value = _state.value.copy(aiThinking = false)
    }

    /**
     * Tell the server where to wake this phone, if it is a sender.
     *
     * Runs on launch and on sign-in so instant sending works immediately rather than after the
     * next fifteen-minute heartbeat — the window in which "instant" silently was not.
     */
    fun publishWakeAddress(context: android.content.Context) {
        viewModelScope.launch {
            com.alphadental.clinic.sms.SmsWakeAddress.publish(context.applicationContext)
        }
    }

    fun openAssistant(context: android.content.Context) {
        val session = _state.value.session ?: return
        // Stores are per clinic and user, created on first open and reused for the session.
        aiContext = context.applicationContext
        if (chatStore == null) {
            chatStore = ChatStore(context.applicationContext, session.clinicId, session.uid)
            answerCache = AnswerCache(context.applicationContext, session.clinicId)
        }
        _state.value = _state.value.copy(
            aiOpen = true,
            aiMessages = _state.value.aiMessages.ifEmpty { chatStore?.load().orEmpty() },
        )
    }

    /**
     * Backing out is also the way out of a turn that has gone wrong: a question
     * nobody is waiting for any more must not keep the spinner up, and must never
     * leave the assistant refusing the next one because it still thinks it is busy.
     */
    fun closeAssistant() {
        aiJob?.cancel()
        aiJob = null
        _state.value = _state.value.copy(aiOpen = false, aiThinking = false)
    }

    // --- today at a glance ---------------------------------------------------------------------

    /**
     * Fetches the day's briefing quietly in the background.
     *
     * Only for the roles that chase money, because the half of it the dashboard
     * does not already show is the aged-balance list. Failures are swallowed on
     * purpose: nobody asked for this, it is an addition to a screen that works
     * perfectly well without it, and an error card on the dashboard would be a
     * worse outcome than the card simply not appearing. Tapping through to the
     * full screen surfaces the failure honestly, because there it was asked for.
     */
    fun refreshBriefing() {
        val session = _state.value.session ?: return
        if (!session.can("access.finance")) return
        if (_state.value.loadingBriefing) return

        _state.value = _state.value.copy(loadingBriefing = true, briefingError = null)
        viewModelScope.launch {
            runCatching { com.alphadental.clinic.ai.BriefingClient.load(session.clinicId) }
                .onSuccess { briefing ->
                    _state.value = _state.value.copy(briefing = briefing, loadingBriefing = false)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        loadingBriefing = false,
                        briefingError = error.message ?: "The briefing could not be built.",
                    )
                }
        }
    }

    fun openBriefing() {
        _state.value = _state.value.copy(briefingOpen = true)
        // Re-read on open: it was fetched at sign-in and the day has moved since.
        refreshBriefing()
    }

    fun closeBriefing() {
        _state.value = _state.value.copy(briefingOpen = false)
    }

    // --- what the assistant has learned ------------------------------------------------------

    /**
     * Opens the list of rules the assistant has taught itself.
     *
     * Read fresh every time rather than cached: the assistant can add to it in the
     * middle of a conversation, and a screen whose whole purpose is "here is what
     * it believes" must not show a stale copy of that.
     */
    fun openAiMemory() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(aiMemoryOpen = true, loadingAiFacts = true, aiFactsError = null)
        viewModelScope.launch {
            runCatching { Repository.loadAiFacts(session.clinicId, session.uid) }
                .onSuccess { facts ->
                    _state.value = _state.value.copy(aiFacts = facts, loadingAiFacts = false)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        loadingAiFacts = false,
                        aiFactsError = error.message ?: "Could not read what the assistant has learned.",
                    )
                }
        }
    }

    fun closeAiMemory() {
        _state.value = _state.value.copy(aiMemoryOpen = false, aiFactsError = null)
    }

    /** Removes one learned rule. The list the transaction returns is the new truth. */
    fun forgetAiFact(fact: String) {
        val session = _state.value.session ?: return
        // Struck from the screen at once: the tap is the decision, and waiting on a
        // round trip to show it makes people tap again.
        _state.value = _state.value.copy(
            aiFacts = _state.value.aiFacts.toMutableList().apply { remove(fact) },
            aiFactsError = null,
        )
        viewModelScope.launch {
            runCatching { Repository.forgetAiFact(session.clinicId, session.uid, fact) }
                .onSuccess { remaining ->
                    _state.value = _state.value.copy(aiFacts = remaining)
                }
                .onFailure { error ->
                    // Put it back rather than leave the screen disagreeing with the
                    // assistant about what it knows.
                    _state.value = _state.value.copy(
                        aiFacts = (_state.value.aiFacts + fact),
                        aiFactsError = error.message ?: "That could not be removed.",
                    )
                }
        }
    }

    /** The Stop beside the spinner: abandon this turn, keep the conversation. */
    fun cancelAi() {
        aiJob?.cancel()
        aiJob = null
        _state.value = _state.value.copy(aiThinking = false)
    }

    /**
     * "Open the leads", handled without the server.
     *
     * Navigation closes the chat — the point of the request is to look at the
     * screen, not to read a sentence about it. "Open Sara's file" runs the
     * register search: one clear match opens; several matches list the options
     * in the chat; none says so plainly.
     */
    private fun tryLocalNavigation(prompt: String): Boolean {
        val target = com.alphadental.clinic.ai.NavIntent.parse(prompt) ?: return false
        return goTo(target)
    }

    /**
     * Opens a screen the assistant asked for, whichever of the two asked.
     *
     * Shared by the local parser and by the server's own `navigate_to` tool, so a
     * screen the phone refuses to open for a receptionist is refused identically
     * however the request arrived — the role rules cannot drift apart if there is
     * only one copy of them.
     */
    private fun goTo(target: com.alphadental.clinic.ai.NavIntent.Target): Boolean {
        val session = _state.value.session ?: return false
        val arabic = _state.value.arabic

        fun done(reply: String, close: Boolean = true) {
            appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
            _state.value = _state.value.copy(aiSpeak = reply)
            // Hidden rather than closed: this turn is finishing normally, and
            // closeAssistant() would cancel the very coroutine saying so.
            if (close) _state.value = _state.value.copy(aiOpen = false)
        }

        fun refused() {
            done(
                if (arabic) "هذه الشاشة ليست متاحة لحسابك." else "That screen is not available on your account.",
                close = false,
            )
        }

        when (target) {
            is com.alphadental.clinic.ai.NavIntent.Target.Day -> {
                selectTab(Tab.DAY); done(if (arabic) "تم فتح جدول اليوم." else "Opening the day view.")
            }
            is com.alphadental.clinic.ai.NavIntent.Target.Patients -> {
                selectTab(Tab.PATIENTS); done(if (arabic) "تم فتح قائمة المرضى." else "Opening the patients list.")
            }
            is com.alphadental.clinic.ai.NavIntent.Target.Money -> {
                if (session.can("access.finance")) {
                    selectTab(Tab.MONEY); done(if (arabic) "تم فتح الحسابات." else "Opening finance.")
                } else refused()
            }
            is com.alphadental.clinic.ai.NavIntent.Target.Leads -> {
                if (session.can("access.marketing")) {
                    openLeads(); done(if (arabic) "تم فتح العملاء المحتملين." else "Opening the leads inbox.")
                } else refused()
            }
            is com.alphadental.clinic.ai.NavIntent.Target.Reports -> {
                if (session.can("access.reports")) {
                    openReports(); done(if (arabic) "تم فتح التقارير." else "Opening reports.")
                } else refused()
            }
            is com.alphadental.clinic.ai.NavIntent.Target.Inventory -> {
                openInventory(); done(if (arabic) "تم فتح المخزون." else "Opening stock.")
            }
            is com.alphadental.clinic.ai.NavIntent.Target.Ortho -> {
                openOrtho(); done(if (arabic) "تم فتح حالات التقويم." else "Opening ortho cases.")
            }
            is com.alphadental.clinic.ai.NavIntent.Target.WhatsappQueue -> {
                openWhatsappQueue(); done(if (arabic) "تم فتح رسائل واتساب." else "Opening the WhatsApp queue.")
            }
            // The server already resolved the patient, so there is nothing to look up.
            is com.alphadental.clinic.ai.NavIntent.Target.PatientById -> {
                done(if (arabic) "تم فتح ملف المريض." else "Opening the patient's file.")
                openPatient(target.id)
            }
            is com.alphadental.clinic.ai.NavIntent.Target.PatientFile -> {
                val turn = beginAiTurn()
                aiJob = viewModelScope.launch {
                    try {
                        val matches = runCatching {
                            Repository.searchPatients(session.clinicId, target.name).patients
                        }.getOrDefault(emptyList())
                        when {
                            matches.isEmpty() -> done(
                                if (arabic) "لا يوجد مريض باسم \"${target.name}\"."
                                else "No patient called \"${target.name}\" in the register.",
                                close = false,
                            )
                            matches.size == 1 -> {
                                done(
                                    if (arabic) "تم فتح ملف ${matches.first().name}."
                                    else "Opening ${matches.first().name}'s file.",
                                )
                                openPatient(matches.first().id)
                            }
                            else -> done(
                                (if (arabic) "يوجد أكثر من مريض بهذا الاسم — أيهم تقصد؟\n"
                                else "More than one patient matches — which one?\n") +
                                    matches.take(4).joinToString("\n") { patient ->
                                        "• ${patient.name}${if (patient.phone.isNotBlank()) " (${patient.phone})" else ""}"
                                    },
                                close = false,
                            )
                        }
                    } finally {
                        endAiTurn(turn)
                    }
                }
            }
        }
        return true
    }

    /**
     * "Make me a finance PDF for last month" and "pdf of this week's
     * appointments", handled without the server.
     *
     * Returns true when the prompt was a report request and has been dealt with —
     * including the polite refusal for roles that may not see clinic money. The
     * schedule carries no such gate: everyone on the staff already sees the day.
     */
    private fun tryLocalReport(prompt: String): Boolean {
        val session = _state.value.session ?: return false
        val context = aiContext ?: return false
        val request = com.alphadental.clinic.ai.ReportIntent.parse(prompt) ?: return false
        val period = request.period
        val arabic = _state.value.arabic
        val label = if (arabic) period.labelAr else period.labelEn

        if (request.kind == com.alphadental.clinic.ai.ReportIntent.Kind.SCHEDULE) {
            return buildScheduleReport(session.clinicId, context, period, label, arabic)
        }
        if (request.kind == com.alphadental.clinic.ai.ReportIntent.Kind.PAYROLL) {
            return buildPayrollReport(session.clinicId, context, period, label, arabic)
        }

        if (!session.can("access.finance")) {
            val reply = if (arabic) {
                "تقارير أموال العيادة متاحة للمدير والاستقبال فقط، فلا أستطيع إنشاءها من حسابك."
            } else {
                "Clinic finance reports are for the owner and reception only, so I can't build one from your account."
            }
            appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
            _state.value = _state.value.copy(aiSpeak = reply)
            return true
        }

        val turn = beginAiTurn()
        aiJob = viewModelScope.launch {
            try {
            runCatching {
                // Off the UI thread: the Firestore read, every drawText, the
                // ellipsize measuring loop and the file write all used to happen
                // on it, so a busy ledger froze the whole app mid-report.
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val rows = Repository.loadFinance(session.clinicId, period.from, period.to)
                    val file = com.alphadental.clinic.data.ReportPdf.writeFinanceReport(
                        context = context,
                        rows = rows,
                        fromKey = period.from,
                        toKey = period.to,
                        clinicName = "Alpha Dental",
                        arabic = arabic,
                    )
                    rows to file
                }
            }.onSuccess { (rows, file) ->
                val income = rows.filterNot { it.isExpense }.sumOf { it.cash }.toInt()
                val expenses = rows.filter { it.isExpense }.sumOf { it.cash }.toInt()
                val reply = if (arabic) {
                    "جاهز — التقرير المالي عن $label: المدخول $income ج.م والمصروفات $expenses ج.م. اضغط لفتح الملف."
                } else {
                    "Done — the finance report for $label: $income EGP in, $expenses EGP out. Tap to open the PDF."
                }
                appendAiMessage(
                    ChatMessage(
                        fromUser = false,
                        text = reply,
                        at = System.currentTimeMillis(),
                        pdfPath = file.absolutePath,
                    )
                )
                _state.value = _state.value.copy(aiSpeak = reply)
            }.onFailure { error ->
                // Backing out of the assistant cancels the turn; that is not a
                // failure worth reporting to someone who has already left.
                if (error is kotlinx.coroutines.CancellationException) return@onFailure
                val reply = if (arabic) {
                    "لم أستطع إنشاء التقرير: ${error.message ?: "خطأ غير معروف"}"
                } else {
                    "I couldn't build the report: ${error.message ?: "unknown error"}"
                }
                appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
                _state.value = _state.value.copy(aiSpeak = reply)
            }
            } finally {
                endAiTurn(turn)
            }
        }
        return true
    }

    /**
     * The payroll sheet — hours, overtime and estimated pay for every member of staff.
     *
     * The figures come from the server, which runs the same calculation the
     * Attendance screen and the weekly brief run. The phone does none of the
     * arithmetic and deliberately cannot: two surfaces disagreeing about what
     * somebody earned is an argument with an employee, not a rendering bug.
     *
     * No role gate here either — but for the opposite reason to the schedule.
     * The route refuses anyone without the attendance-admin or settings
     * permission and never computes a figure for them, so salaries do not travel
     * to a phone that then has to be trusted to hide them. Repeating the check
     * here would only be a second place for the two to fall out of step.
     */
    private fun buildPayrollReport(
        clinicId: String,
        context: android.content.Context,
        period: com.alphadental.clinic.ai.ReportIntent.Period,
        label: String,
        arabic: Boolean,
    ): Boolean {
        val turn = beginAiTurn()
        aiJob = viewModelScope.launch {
            try {
                runCatching {
                    val payroll = com.alphadental.clinic.ai.PayrollClient
                        .load(clinicId, period.from, period.to)
                    val file = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        com.alphadental.clinic.data.PayrollPdf.write(
                            context = context,
                            payroll = payroll,
                            clinicName = "Alpha Dental",
                            arabic = arabic,
                        )
                    }
                    payroll to file
                }.onSuccess { (payroll, file) ->
                    val people = payroll.staff.size
                    val reply = when {
                        people == 0 && arabic -> "لا توجد سجلات حضور في $label."
                        people == 0 -> "There are no attendance records for $label."
                        arabic ->
                            "جاهز — رواتب $label: ${payroll.labourCost.toInt()} ج.م لـ $people موظف. " +
                                "اضغط لفتح الملف."
                        else ->
                            "Done — payroll for $label: ${payroll.labourCost.toInt()} EGP across " +
                                "$people staff member${if (people == 1) "" else "s"}. Tap to open the PDF."
                    }
                    appendAiMessage(
                        ChatMessage(
                            fromUser = false,
                            text = reply,
                            at = System.currentTimeMillis(),
                            pdfPath = file.absolutePath.takeIf { people > 0 },
                        )
                    )
                    _state.value = _state.value.copy(aiSpeak = reply)
                }.onFailure { error ->
                    if (error is kotlinx.coroutines.CancellationException) return@onFailure
                    val reply = if (arabic) {
                        "لم أستطع إنشاء كشف الرواتب: ${error.message ?: "خطأ غير معروف"}"
                    } else {
                        "I couldn't build the payroll: ${error.message ?: "unknown error"}"
                    }
                    appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
                    _state.value = _state.value.copy(aiSpeak = reply)
                }
            } finally {
                endAiTurn(turn)
            }
        }
        return true
    }

    /**
     * The printed day sheet: every appointment in the period, grouped by day.
     *
     * No role gate. Every member of staff already sees the day on the Day tab, so
     * refusing to print what they can read on screen would be theatre — and the
     * dentist who wants tomorrow on paper is the likeliest person to ask.
     */
    private fun buildScheduleReport(
        clinicId: String,
        context: android.content.Context,
        period: com.alphadental.clinic.ai.ReportIntent.Period,
        label: String,
        arabic: Boolean,
    ): Boolean {
        val turn = beginAiTurn()
        aiJob = viewModelScope.launch {
            try {
                runCatching {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        val rows = Repository.loadAppointmentsBetween(clinicId, period.from, period.to)
                        val file = com.alphadental.clinic.data.ReportPdf.writeScheduleReport(
                            context = context,
                            appointments = rows,
                            fromKey = period.from,
                            toKey = period.to,
                            clinicName = "Alpha Dental",
                            arabic = arabic,
                        )
                        rows to file
                    }
                }.onSuccess { (rows, file) ->
                    val reply = when {
                        rows.isEmpty() && arabic -> "لا توجد مواعيد في $label."
                        rows.isEmpty() -> "There are no appointments booked for $label."
                        arabic -> "جاهز — جدول $label: ${rows.size} موعد. اضغط لفتح الملف."
                        else -> "Done — the schedule for $label: ${rows.size} appointment" +
                            "${if (rows.size == 1) "" else "s"}. Tap to open the PDF."
                    }
                    appendAiMessage(
                        ChatMessage(
                            fromUser = false,
                            text = reply,
                            at = System.currentTimeMillis(),
                            // An empty period still gets a straight answer, but no
                            // file — a PDF of nothing is not worth opening.
                            pdfPath = file.absolutePath.takeIf { rows.isNotEmpty() },
                        )
                    )
                    _state.value = _state.value.copy(aiSpeak = reply)
                }.onFailure { error ->
                    if (error is kotlinx.coroutines.CancellationException) return@onFailure
                    val reply = if (arabic) {
                        "لم أستطع إنشاء الجدول: ${error.message ?: "خطأ غير معروف"}"
                    } else {
                        "I couldn't build the schedule: ${error.message ?: "unknown error"}"
                    }
                    appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
                    _state.value = _state.value.copy(aiSpeak = reply)
                }
            } finally {
                endAiTurn(turn)
            }
        }
        return true
    }

    fun aiSpoken() {
        _state.value = _state.value.copy(aiSpeak = null)
    }

    /**
     * One thing the user said or typed, answered.
     *
     * Three paths, in cost order: a staged action waiting for a yes or no is settled without any
     * model call at all; an exact repeat of a recent question is answered from the cache for
     * nothing; everything else goes to the server and costs the clinic one credit.
     */
    fun askAi(text: String) {
        val session = _state.value.session ?: return
        val prompt = text.trim()
        if (prompt.isEmpty() || _state.value.aiThinking) return

        // Appended before anything else can claim the prompt: a yes or no settling a
        // staged action used to be swallowed silently, so someone whose "اعمل PDF" was
        // read as approval saw neither their own words nor an answer — the screen simply
        // did nothing, which is exactly what "it gets stuck" looks like from the outside.
        appendAiMessage(ChatMessage(fromUser = true, text = prompt, at = System.currentTimeMillis()))

        // A staged action turns the next short yes or no into its answer — that is what makes
        // approving by voice possible. Anything that is not clearly either is treated as a new
        // question and the stage is abandoned, because acting on an ambiguous mumble is how an
        // assistant deletes something nobody asked it to.
        val pending = _state.value.aiPending
        if (pending != null) {
            when (interpretYesNo(prompt)) {
                true -> { settlePending(approve = true); return }
                false -> { settlePending(approve = false); return }
                null -> _state.value = _state.value.copy(aiPending = null)
            }
        }

        // Navigation first: it is the strict parser — it wants an opening verb AND a
        // screen name — so it gets first refusal over the report parser, which guesses.
        // Instant, free, and it works with no signal.
        if (tryLocalNavigation(prompt)) return

        // Finance reports are answered by the phone itself: the data is already
        // in Firestore and the PDF is drawn locally, so no AI credit is spent.
        if (tryLocalReport(prompt)) return

        // The cache is only for context-free questions. With an appointment on
        // screen the same words mean something else entirely, and an acting
        // request replayed from disk would speak a confidence nothing backs.
        if (_state.value.aiAppointmentId == null) {
            answerCache?.lookup(prompt)?.let { cached ->
                appendAiMessage(ChatMessage(fromUser = false, text = cached, at = System.currentTimeMillis()))
                _state.value = _state.value.copy(aiSpeak = cached)
                return
            }
        }

        askAiTurn(prompt, continued = false)
    }

    /**
     * One round trip to the assistant.
     *
     * When the server answers with `selectAppointmentId` it has only IDENTIFIED
     * the appointment — on the website that opens a panel, which is itself the
     * next step; on a phone "Opened Dina's 9:00 AM" followed by silence is a
     * dead end (and was: every retry re-opened the same appointment forever).
     * So the phone re-sends the same request once with the appointment attached,
     * and one spoken "cancel her appointment" lands directly on the
     * confirmation card. `continued` caps that at one hop.
     */
    private fun askAiTurn(prompt: String, continued: Boolean) {
        val session = _state.value.session ?: return
        val turnId = beginAiTurn()
        aiJob = viewModelScope.launch {
            try {
            // A turn with no ceiling is indistinguishable from a hang. The socket's
            // own timeout is per-read, so a server trickling bytes can outlive it;
            // this one is on the clock, not on the wire.
            var attempt = runCatching {
                kotlinx.coroutines.withTimeout(TURN_TIMEOUT_MS) {
                    AiClient.ask(
                        clinicId = session.clinicId,
                        userName = session.name,
                        prompt = prompt,
                        // History from before this prompt was appended.
                        history = _state.value.aiMessages.dropLast(1),
                        voiceMode = true,
                        appointmentId = _state.value.aiAppointmentId,
                    )
                }
            }
            // One silent retry, and only for transport failures: an AiError means
            // the server answered (and charged), so replaying it buys nothing.
            if (attempt.exceptionOrNull() is java.io.IOException) {
                attempt = runCatching {
                    kotlinx.coroutines.withTimeout(TURN_TIMEOUT_MS) {
                        AiClient.ask(
                            clinicId = session.clinicId,
                            userName = session.name,
                            prompt = prompt,
                            history = _state.value.aiMessages.dropLast(1),
                            voiceMode = true,
                            appointmentId = _state.value.aiAppointmentId,
                        )
                    }
                }
            }
            attempt
                .onSuccess { turn ->
                    // The server speaks in website routes. Honour the ones this app
                    // has a screen for, and be straight about the ones it does not —
                    // "Navigating to /marketing…" followed by nothing is the failure
                    // this whole branch exists to stop.
                    turn.navigateTo?.let { path ->
                        val target = com.alphadental.clinic.ai.NavIntent.fromWebPath(path)
                        if (target != null) {
                            appendAiMessage(
                                ChatMessage(fromUser = false, text = turn.reply, at = System.currentTimeMillis())
                            )
                            goTo(target)
                        } else {
                            val reply = if (_state.value.arabic) {
                                "هذه الشاشة موجودة على الموقع فقط، وليست في التطبيق."
                            } else {
                                "That screen is only on the website — it isn't in the phone app."
                            }
                            appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
                            _state.value = _state.value.copy(aiSpeak = reply)
                        }
                        return@onSuccess
                    }

                    // The phone has no download folder and no renderer for an
                    // arbitrary composed document. Announcing one that never
                    // arrives is worse than saying where it can be had.
                    turn.triggerPdfTitle?.let { title ->
                        val reply = if (_state.value.arabic) {
                            "لا أستطيع إنشاء \"$title\" على الهاتف. " +
                                "من هنا أستطيع التقرير المالي وجدول المواعيد، " +
                                "والروشتة من ملف المريض. أي مستند آخر متاح على الموقع."
                        } else {
                            "I can't build \"$title\" on the phone. From here I can do the finance " +
                                "report and the appointment schedule, and a prescription prints from " +
                                "the patient's file. Any other document is on the website."
                        }
                        appendAiMessage(ChatMessage(fromUser = false, text = reply, at = System.currentTimeMillis()))
                        _state.value = _state.value.copy(aiSpeak = reply)
                        return@onSuccess
                    }

                    val selected = turn.selectAppointmentId
                    if (selected != null) {
                        setAiAppointment(session.clinicId, selected)
                        if (!continued && turn.pending == null) {
                            // Note what was found, then finish the actual request.
                            appendAiMessage(
                                ChatMessage(
                                    fromUser = false, text = turn.reply,
                                    at = System.currentTimeMillis(), appointmentId = selected,
                                )
                            )
                            askAiTurn(prompt, continued = true)
                            return@onSuccess
                        }
                    }

                    appendAiMessage(
                        ChatMessage(
                            fromUser = false, text = turn.reply,
                            at = System.currentTimeMillis(), appointmentId = selected,
                        )
                    )
                    _state.value = _state.value.copy(
                        aiPending = turn.pending,
                        aiSpeak = turn.reply,
                    )
                    // Only plain, context-free answers are cached. A turn that staged an
                    // action must never be replayed from disk — the spoken confirmation
                    // would have nothing behind it.
                    if (turn.pending == null && selected == null && _state.value.aiAppointmentId == null) {
                        answerCache?.store(prompt, turn.reply)
                    }
                }
                .onFailure { error ->
                    val arabic = _state.value.arabic
                    val message = when {
                        // Ran out of patience rather than failed — say so, and say it
                        // in a way that tells the person the retry is worth trying.
                        error is kotlinx.coroutines.TimeoutCancellationException ->
                            if (arabic) "المساعد استغرق وقتاً أطول من اللازم. حاول مرة أخرى."
                            else "The assistant took too long to answer. Try again."
                        // Someone backed out or pressed Stop; they are not waiting.
                        error is kotlinx.coroutines.CancellationException -> return@onFailure
                        else -> error.message ?: "The assistant could not be reached."
                    }
                    appendAiMessage(ChatMessage(fromUser = false, text = message, at = System.currentTimeMillis()))
                    _state.value = _state.value.copy(aiSpeak = message)
                }
            } finally {
                endAiTurn(turnId)
            }
        }
    }

    /**
     * How long a single server turn may take before the assistant gives up.
     *
     * Generous — the model can genuinely think for a while — but finite, because
     * a spinner with no end is the same thing as a broken app to the person
     * holding the phone.
     */
    private val TURN_TIMEOUT_MS = 90_000L

    /** Remember which appointment the chat is acting on, with a label the chip can show. */
    private fun setAiAppointment(clinicId: String, appointmentId: String) {
        _state.value = _state.value.copy(aiAppointmentId = appointmentId, aiAppointmentLabel = "")
        viewModelScope.launch {
            val label = runCatching { Repository.loadAppointment(clinicId, appointmentId) }
                .getOrNull()
                ?.let { appt ->
                    listOf(appt.patientName, appt.time, appt.date)
                        .filter(String::isNotBlank)
                        .joinToString(" \u00b7 ")
                }
                .orEmpty()
            if (_state.value.aiAppointmentId == appointmentId) {
                _state.value = _state.value.copy(aiAppointmentLabel = label)
            }
        }
    }

    /** The chip's X: back to the general assistant, nothing on screen. */
    fun clearAiAppointment() {
        _state.value = _state.value.copy(aiAppointmentId = null, aiAppointmentLabel = "", aiPending = null)
    }

    fun settlePending(approve: Boolean) {
        val session = _state.value.session ?: return
        val pending = _state.value.aiPending ?: return

        val turn = beginAiTurn()
        _state.value = _state.value.copy(aiPending = null)
        aiJob = viewModelScope.launch {
            try {
                val outcome = runCatching {
                    kotlinx.coroutines.withTimeout(TURN_TIMEOUT_MS) {
                        AiClient.confirm(session.clinicId, session.name, pending.id, approve)
                    }
                }.getOrElse { error ->
                    if (error is kotlinx.coroutines.CancellationException &&
                        error !is kotlinx.coroutines.TimeoutCancellationException
                    ) {
                        return@launch
                    }
                    error.message ?: "The action could not be completed."
                }

                appendAiMessage(ChatMessage(fromUser = false, text = outcome, at = System.currentTimeMillis()))
                _state.value = _state.value.copy(aiSpeak = outcome)
            } finally {
                endAiTurn(turn)
            }
        }
    }

    private fun appendAiMessage(message: ChatMessage) {
        val messages = _state.value.aiMessages + message
        _state.value = _state.value.copy(aiMessages = messages)
        chatStore?.save(messages)
    }

    // --- clinic hours ----------------------------------------------------------------------

    fun openHours() {
        _state.value = _state.value.copy(hoursOpen = true)
    }

    fun closeHours() {
        _state.value = _state.value.copy(hoursOpen = false)
    }

    fun saveHours(start: String, end: String, slotDuration: Int, offDays: List<String>) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(savingHours = true)

        viewModelScope.launch {
            Repository.saveSchedule(session.clinicId, start, end, slotDuration, offDays)
                .onSuccess {
                    // Re-read so the booking screen picks up the new hours immediately rather than
                    // on the next app start — the slot list is built from this.
                    val schedule = runCatching { Repository.loadSchedule(session.clinicId) }
                        .getOrDefault(_state.value.schedule)
                    _state.value = _state.value.copy(
                        schedule = schedule,
                        savingHours = false,
                        hoursOpen = false,
                        message = "Clinic hours saved.",
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        savingHours = false,
                        message = error.message ?: "The hours could not be saved.",
                    )
                }
        }
    }

    fun closeOrtho() {
        _state.value = _state.value.copy(orthoOpen = false, orthoCase = null)
    }

    fun openOrthoCase(case: OrthoCase?) {
        _state.value = _state.value.copy(orthoCase = case)
    }

    /**
     * Log an adjustment.
     *
     * The visit number comes from the list this phone holds. Two chairs logging at the same moment
     * would produce two visits sharing a number — untidy, but both survive, which is the trade the
     * arrayUnion append is making deliberately.
     */
    fun logOrthoVisit(case: OrthoCase, workDone: String, nextStep: String) {
        val session = _state.value.session ?: return
        if (workDone.isBlank()) return

        val visit = OrthoVisit(
            visitNo = (case.visits.maxOfOrNull { it.visitNo } ?: 0) + 1,
            date = today(),
            workDone = workDone,
            nextStep = nextStep,
        )

        _state.value = _state.value.copy(savingOrtho = true)
        viewModelScope.launch {
            Repository.addOrthoVisit(session.clinicId, case.patientId, visit)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "The visit could not be saved.")
                }
            applyOrthoChange(case.patientId) { it.copy(visits = it.visits + visit) }
            _state.value = _state.value.copy(savingOrtho = false)
        }
    }

    /** Open a case for the patient whose file is on screen. */
    fun startOrthoCase() {
        val session = _state.value.session ?: return
        val file = _state.value.patientFile ?: return
        _state.value = _state.value.copy(savingOrtho = true)
        viewModelScope.launch {
            Repository.startOrthoCase(session.clinicId, file.patient)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "The case could not be opened.")
                }
            // Refresh both the patient's own tab and the ortho tool's list.
            val cases = runCatching { Repository.loadOrthoCases(session.clinicId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(
                savingOrtho = false,
                orthoCases = cases,
                patientOrtho = cases.filter { it.patientId == file.patient.id },
            )
        }
    }

    /** Save the case header — diagnosis and cephalometric readings. */
    fun saveOrthoDetails(case: OrthoCase, diagnosis: String, cephData: Map<String, String>) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(savingOrtho = true)
        viewModelScope.launch {
            Repository.updateOrthoCase(session.clinicId, case.patientId, diagnosis, cephData)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "The case could not be saved.")
                }
            applyOrthoChange(case.patientId) {
                it.copy(diagnosis = diagnosis.trim(), cephData = cephData.filterValues { v -> v.isNotBlank() })
            }
            _state.value = _state.value.copy(savingOrtho = false)
        }
    }

    /** Correct a logged visit, or remove one entered by mistake. */
    fun reviseOrthoVisit(case: OrthoCase, visitNo: Int, replacement: OrthoVisit?) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(savingOrtho = true)
        viewModelScope.launch {
            Repository.reviseOrthoVisit(session.clinicId, case.patientId, visitNo, replacement)
                .onSuccess {
                    applyOrthoChange(case.patientId) { current ->
                        current.copy(
                            visits = current.visits.mapNotNull {
                                if (it.visitNo != visitNo) it else replacement
                            }
                        )
                    }
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "The visit could not be changed.")
                }
            _state.value = _state.value.copy(savingOrtho = false)
        }
    }

    fun setOrthoStatus(case: OrthoCase, status: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(savingOrtho = true)
        viewModelScope.launch {
            Repository.setOrthoStatus(session.clinicId, case.patientId, status)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "The status could not be changed.")
                }
            applyOrthoChange(case.patientId) { it.copy(status = status) }
            _state.value = _state.value.copy(savingOrtho = false)
        }
    }

    /**
     * Apply a change to both the list and the open case.
     *
     * Updated locally rather than by re-reading: the write is queued, not confirmed, so a fresh
     * read could come back from the cache without it and the visit would appear to vanish the
     * instant it was saved.
     */
    private fun applyOrthoChange(patientId: String, change: (OrthoCase) -> OrthoCase) {
        val current = _state.value
        _state.value = current.copy(
            orthoCases = current.orthoCases.map { if (it.patientId == patientId) change(it) else it },
            orthoCase = current.orthoCase?.let { if (it.patientId == patientId) change(it) else it },
        )
    }

    fun setReportRange(range: ReportRange) {
        _state.value = _state.value.copy(reportRange = range)
        loadReport(range)
    }

    fun refreshReport() = loadReport(_state.value.reportRange)

    private fun loadReport(range: ReportRange) {
        val session = _state.value.session ?: return
        val (from, to) = rangeBounds(range)

        _state.value = _state.value.copy(
            loadingReport = true,
            reportError = null,
            reportRangeLabel = "$from → $to",
        )

        viewModelScope.launch {
            val result = runCatching {
                val rows = Repository.loadLedgerRange(session.clinicId, from, to)
                val referrals = Repository.loadNewPatientReferrals(session.clinicId, from, to)
                rows to referrals
            }

            // Ignore a slow answer for a range the user has already moved off, the same way the
            // day ledger does — otherwise tapping through the chips races itself.
            if (_state.value.reportRange != range) return@launch

            result.onSuccess { (rows, referrals) ->
                _state.value = _state.value.copy(
                    loadingReport = false,
                    reportSummary = if (rows.isEmpty() && referrals.isEmpty()) null else summariseReport(rows, from, to),
                    reportSources = summariseSources(referrals),
                    reportNewPatients = referrals.size,
                )
            }.onFailure { error ->
                // A report for the wrong range is worse than no report: cleared, and said.
                _state.value = _state.value.copy(
                    loadingReport = false,
                    reportSummary = null,
                    reportSources = emptyList(),
                    reportNewPatients = 0,
                    reportError = loadFailure(error),
                )
            }
        }
    }

    /**
     * First and last day of a range, as the "yyyy-MM-dd" keys the ledger stores.
     *
     * Built on Calendar rather than by arithmetic on the date string, so month lengths and the turn
     * of a year look after themselves — "this month" on the 31st of January must not run into
     * February.
     */
    private fun rangeBounds(range: ReportRange): Pair<String, String> {
        val cal = Calendar.getInstance()
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

        return when (range) {
            ReportRange.WEEK -> {
                val to = fmt.format(cal.time)
                cal.add(Calendar.DAY_OF_YEAR, -6)
                fmt.format(cal.time) to to
            }
            ReportRange.MONTH -> {
                val to = fmt.format(cal.time)
                cal.set(Calendar.DAY_OF_MONTH, 1)
                fmt.format(cal.time) to to
            }
            ReportRange.LAST_MONTH -> {
                cal.set(Calendar.DAY_OF_MONTH, 1)
                cal.add(Calendar.MONTH, -1)
                val from = fmt.format(cal.time)
                cal.set(Calendar.DAY_OF_MONTH, cal.getActualMaximum(Calendar.DAY_OF_MONTH))
                from to fmt.format(cal.time)
            }
        }
    }

    /**
     * Record that a message has been dealt with.
     *
     * Called when the person returns from WhatsApp. The app cannot see whether they actually
     * pressed send in there, so this means "handled", not "delivered" — but leaving it in the list
     * would guarantee the patient hears from the clinic twice, which is the worse mistake.
     */
    fun markWhatsappSent(message: Repository.PendingWhatsapp, deviceId: String) {
        val session = _state.value.session ?: return
        // Dropped from the list straight away: the person has just come back from WhatsApp and
        // expects it gone. The listener confirms it a moment later.
        _state.value = _state.value.copy(whatsappQueue = _state.value.whatsappQueue.filterNot { it.id == message.id })
        viewModelScope.launch {
            Repository.markWhatsappSent(session.clinicId, message.id, deviceId)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "Could not update the message.")
                }
        }
    }

    /**
     * Nudge a stock count.
     *
     * The row updates locally first so tapping minus four times feels like four taps rather than
     * four round trips — but the list is reloaded afterwards, so what settles on screen is what
     * the database actually holds rather than what this phone assumed.
     */
    fun adjustStock(item: InventoryItem, delta: Double) {
        val session = _state.value.session ?: return

        _state.value = _state.value.copy(
            inventory = _state.value.inventory.map {
                if (it.id == item.id) it.copy(stock = (it.stock + delta).coerceAtLeast(0.0)) else it
            }
        )

        viewModelScope.launch {
            Repository.adjustStock(session.clinicId, item, delta)
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "Stock could not be updated.")
                }
            val items = runCatching { Repository.loadInventory(session.clinicId) }.getOrDefault(emptyList())
            if (_state.value.inventoryOpen) _state.value = _state.value.copy(inventory = items)
        }
    }

    private fun refreshTakings() {
        val session = _state.value.session ?: return
        if (!session.can("access.finance")) return

        viewModelScope.launch {
            val total = runCatching { Repository.takingsOn(session.clinicId, today()) }.getOrNull()
            _state.value = _state.value.copy(takingsToday = total)
        }
    }

    fun refreshShift() {
        val session = _state.value.session ?: return
        viewModelScope.launch {
            val shift = runCatching { Repository.openShift(session.clinicId, session.uid) }.getOrNull()
            _state.value = _state.value.copy(openShift = shift)
        }
    }

    /**
     * The home screen's pull-to-refresh.
     *
     * The schedule underneath is a live listener and needs nothing; what goes stale is the slab —
     * the day's takings, the shift, and the briefing line. A failed re-read keeps the old figure
     * rather than blanking it: a number that was right a minute ago beats a dash.
     */
    fun refreshHome() {
        val session = _state.value.session ?: return
        if (_state.value.homeRefreshing) return
        _state.value = _state.value.copy(homeRefreshing = true)
        refreshBriefing()
        viewModelScope.launch {
            val takings = async {
                if (!session.can("access.finance")) null
                else runCatching { Repository.takingsOn(session.clinicId, today()) }.getOrElse { _state.value.takingsToday }
            }
            val shift = async {
                runCatching { Repository.openShift(session.clinicId, session.uid) }.getOrElse { _state.value.openShift }
            }
            val t = takings.await()
            val s = shift.await()
            _state.value = _state.value.copy(
                homeRefreshing = false,
                openShift = s,
                takingsToday = if (session.can("access.finance")) t else _state.value.takingsToday,
            )
        }
    }

    /**
     * One sentence about why a read failed, for a banner with a Retry button beside it.
     *
     * Firestore's own messages are written for developers — "PERMISSION_DENIED: Missing or
     * insufficient permissions", "Failed to get document because the client is offline" — and a
     * receptionist on a bad connection needs to be told what to do, not what went wrong inside.
     */
    private fun loadFailure(error: Throwable): String {
        val arabic = _state.value.arabic
        val code = (error as? com.google.firebase.firestore.FirebaseFirestoreException)?.code
        val offline = code == com.google.firebase.firestore.FirebaseFirestoreException.Code.UNAVAILABLE ||
            error is java.net.UnknownHostException ||
            error is java.net.SocketTimeoutException ||
            error.message?.contains("offline", ignoreCase = true) == true
        return when {
            offline -> if (arabic) "لا يوجد اتصال. اسحب للأسفل للمحاولة مرة أخرى." else "No connection. Pull down to try again."
            code == com.google.firebase.firestore.FirebaseFirestoreException.Code.PERMISSION_DENIED ->
                if (arabic) "حسابك لا يملك صلاحية رؤية هذا." else "Your account is not allowed to see this."
            else -> if (arabic) "تعذّر التحميل. اسحب للأسفل للمحاولة مرة أخرى." else "Could not load. Pull down to try again."
        }
    }

    fun dismissClockError() {
        _state.value = _state.value.copy(clockError = null)
    }

    /**
     * Clock in or out.
     *
     * The geofence is only enforced when the clinic actually configured one. A clinic that never
     * set its location gets attendance without a location check rather than a permanent refusal —
     * an unconfigured fence is an absent fence, never a satisfied one.
     */
    fun punchClock(context: android.content.Context) {
        val session = _state.value.session ?: return
        if (_state.value.clocking) return

        _state.value = _state.value.copy(clocking = true, clockError = null)

        viewModelScope.launch {
            val fence = runCatching { Repository.loadGeofence(session.clinicId) }.getOrNull()

            var verdict: GeofenceVerdict? = null
            var accuracy: Double? = null

            if (fence != null) {
                when (val fix = LocationFinder.bestPosition(context)) {
                    is LocationFinder.Result.Found -> {
                        accuracy = fix.reading.accuracy
                        verdict = judgeGeofence(fix.reading, fence)
                        if (!verdict.inside) {
                            _state.value = _state.value.copy(
                                clocking = false,
                                clockError = "You appear to be about ${verdict.effectiveDistance}m from the clinic. Clocking in only works on site.",
                            )
                            return@launch
                        }
                    }
                    LocationFinder.Result.PermissionDenied -> {
                        _state.value = _state.value.copy(
                            clocking = false,
                            clockError = "This clinic checks you are on site, so location permission is needed to clock in.",
                        )
                        return@launch
                    }
                    LocationFinder.Result.Unavailable -> {
                        _state.value = _state.value.copy(
                            clocking = false,
                            clockError = "Location is switched off on this phone. Turn it on to clock in.",
                        )
                        return@launch
                    }
                    LocationFinder.Result.TimedOut -> {
                        _state.value = _state.value.copy(
                            clocking = false,
                            clockError = "Could not get a location fix. Try again near a window.",
                        )
                        return@launch
                    }
                    is LocationFinder.Result.TooInaccurate -> {
                        _state.value = _state.value.copy(
                            clocking = false,
                            clockError = "The location reading is too vague to tell whether you are at the clinic.",
                        )
                        return@launch
                    }
                }
            }

            val existing = _state.value.openShift
            val result = if (existing != null) {
                Repository.clockOut(session.clinicId, existing, verdict, accuracy)
            } else {
                val staffId = runCatching {
                    Repository.findMyStaffId(session.clinicId, session.uid, session.email)
                }.getOrDefault("")
                Repository.clockIn(session.clinicId, session.uid, session.name, staffId, verdict, accuracy)
            }

            result
                .onSuccess {
                    _state.value = _state.value.copy(
                        clocking = false,
                        message = if (existing != null) "Clocked out." else "Clocked in.",
                    )
                    refreshShift()
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        clocking = false,
                        clockError = error.message ?: "That could not be saved.",
                    )
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
    /** The register's pull-to-refresh: the same search again, whatever is in the box. */
    fun refreshPatients() = searchPatientsTab(_state.value.patientQuery)

    fun searchPatientsTab(term: String) {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(patientSearching = true, patientQuery = term, patientsError = null)
        cursor = null

        viewModelScope.launch {
            val result = runCatching { Repository.searchPatients(session.clinicId, term) }

            // A slow response for a term the user has already typed past would otherwise replace
            // the newer results with older ones.
            if (_state.value.patientQuery != term) return@launch

            val page = result.getOrElse { error ->
                // The names already on screen stay: a failed refresh is not an empty register.
                _state.value = _state.value.copy(patientSearching = false, patientsError = loadFailure(error))
                return@launch
            }
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
            val result = runCatching { Repository.searchPatients(session.clinicId, term, after) }

            if (_state.value.patientQuery != term) return@launch

            val page = result.getOrElse { error ->
                _state.value = _state.value.copy(patientLoadingMore = false, patientsError = loadFailure(error))
                return@launch
            }
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
            patientMedia = emptyList(),
            patientOrtho = emptyList(),
        )
        // Photos and ortho load alongside the file rather than after it — each
        // fills its own tab whenever it lands, and a failure only empties a tab.
        viewModelScope.launch {
            val media = runCatching { Repository.loadPatientMedia(session.clinicId, patientId) }
                .getOrDefault(emptyList())
            if (_state.value.openPatientId == patientId) {
                _state.value = _state.value.copy(patientMedia = media)
            }
        }
        viewModelScope.launch {
            val cases = runCatching { Repository.loadOrthoCases(session.clinicId) }
                .getOrDefault(emptyList())
                .filter { it.patientId == patientId }
            if (_state.value.openPatientId == patientId) {
                _state.value = _state.value.copy(patientOrtho = cases)
            }
        }
        viewModelScope.launch {
            Repository.loadPatientFile(session.clinicId, patientId)
                .onSuccess { file ->
                    // Ignore a result that arrived after the user moved on, so a slow read cannot
                    // pop a stale patient over whoever they are looking at now.
                    if (_state.value.openPatientId == patientId) {
                        _state.value = _state.value.copy(patientFile = file, patientLoading = false)
                        loadNotesFor(session.clinicId, patientId)
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

    /** The error screen's Retry: the same open again. */
    fun retryPatient() {
        _state.value.openPatientId?.let { openPatient(it) }
    }

    /**
     * A pull on an open file: re-read it in place.
     *
     * Not openPatient again — that blanks the file to a spinner, and the person pulled because
     * they wanted to see the latest balance, not to lose their place in the tabs. The file,
     * photos and ortho are re-read together; a failure leaves what was there and says so once.
     */
    fun refreshPatient() {
        val session = _state.value.session ?: return
        val patientId = _state.value.openPatientId ?: return
        if (_state.value.patientFile == null) {
            openPatient(patientId)
            return
        }
        if (_state.value.patientRefreshing) return
        _state.value = _state.value.copy(patientRefreshing = true)
        viewModelScope.launch {
            val media = async { runCatching { Repository.loadPatientMedia(session.clinicId, patientId) }.getOrNull() }
            val cases = async {
                runCatching { Repository.loadOrthoCases(session.clinicId) }.getOrNull()?.filter { it.patientId == patientId }
            }
            val file = Repository.loadPatientFile(session.clinicId, patientId)
            val freshMedia = media.await()
            val freshCases = cases.await()
            if (_state.value.openPatientId != patientId) return@launch
            file.onSuccess { fresh ->
                _state.value = _state.value.copy(
                    patientRefreshing = false,
                    patientFile = fresh,
                    patientMedia = freshMedia ?: _state.value.patientMedia,
                    patientOrtho = freshCases ?: _state.value.patientOrtho,
                )
                loadNotesFor(session.clinicId, patientId)
            }.onFailure { error ->
                _state.value = _state.value.copy(patientRefreshing = false, message = loadFailure(error))
            }
        }
    }

    /**
     * Open the payment sheet for the patient currently on screen.
     *
     * The ledger is re-read rather than reused from the patient file, because what is still owed
     * on each treatment is the thing being paid against — and a colleague may have taken a payment
     * at the desk since this file was opened.
     */
    /**
     * Take a payment for the patient on an appointment, from the appointment itself.
     *
     * The sheet used to offer the clinical half of a visit — status, reschedule,
     * call — and nothing about the money, so collecting a fee meant closing it,
     * finding the patient in the register and opening their file. Reception does
     * that at the desk with the patient standing there.
     *
     * It opens the file underneath rather than paying against the appointment,
     * because the payment is recorded against the ledger of a person, not of a
     * booking, and the file is what the receipt and the balance are computed
     * from. Closing the payment sheet therefore leaves them on the file, which is
     * where someone who has just taken money usually wants to be.
     */
    fun openPaymentForPatient(patientId: String) {
        if (patientId.isBlank()) return
        openPatient(patientId)
        openPayment()
    }

    fun openPayment() {
        val session = _state.value.session ?: return
        val patientId = _state.value.openPatientId ?: return

        _state.value = _state.value.copy(paymentOpen = true, loadingOutstanding = true, outstanding = emptyList())
        viewModelScope.launch {
            val rows = runCatching { Repository.loadLedger(session.clinicId, patientId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(
                outstanding = unpaidProcedures(rows),
                loadingOutstanding = false,
            )
        }
    }

    private fun loadNotesFor(clinicId: String, patientId: String) {
        viewModelScope.launch {
            val loaded = runCatching { Repository.loadClinicalNotes(clinicId, patientId) }.getOrDefault(emptyList())
            val rx = runCatching { Repository.loadPrescriptions(clinicId, patientId) }.getOrDefault(emptyList())
            if (_state.value.openPatientId == patientId) {
                _state.value = _state.value.copy(notes = loaded, prescriptions = rx)
            }
        }
    }

    /** Correct a recorded procedure's status. Reloads so the screen shows what was stored. */
    fun updateNoteStatus(noteId: String, status: String) {
        val session = _state.value.session ?: return
        val patientId = _state.value.openPatientId ?: return
        viewModelScope.launch {
            Repository.setNoteStatus(session.clinicId, noteId, status)
                .onSuccess { loadNotesFor(session.clinicId, patientId) }
                .onFailure { error ->
                    _state.value = _state.value.copy(message = error.message ?: "That change could not be saved.")
                }
        }
    }

    fun openPrescription() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(rxOpen = true)
        viewModelScope.launch {
            val doctors = runCatching { Repository.loadDoctors(session.clinicId) }.getOrDefault(emptyList())
            val shortcuts = runCatching { Repository.loadDrugShortcuts(session.clinicId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(doctors = doctors, drugShortcuts = shortcuts)
        }
    }

    fun closePrescription() {
        _state.value = _state.value.copy(rxOpen = false, savingRx = false)
    }

    fun savePrescription(doctor: String, diagnosis: String, drugs: List<RxItem>) {
        val session = _state.value.session ?: return
        val patient = _state.value.patientFile?.patient ?: return

        _state.value = _state.value.copy(savingRx = true)
        viewModelScope.launch {
            Repository.addPrescription(session.clinicId, patient, doctor, diagnosis, drugs)
                .onSuccess {
                    _state.value = _state.value.copy(rxOpen = false, savingRx = false, message = "Prescription saved.")
                    loadNotesFor(session.clinicId, patient.id)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        savingRx = false,
                        message = error.message ?: "That prescription could not be saved.",
                    )
                }
        }
    }

    /**
     * Load the price list and doctors before the note sheet opens.
     *
     * Fetched on open rather than held from sign-in, so a price added on the website this morning
     * is offered without restarting the app.
     */
    fun openAddNote() {
        val session = _state.value.session ?: return
        _state.value = _state.value.copy(addNoteOpen = true)
        viewModelScope.launch {
            val services = runCatching { Repository.loadServices(session.clinicId) }.getOrDefault(emptyList())
            val doctors = runCatching { Repository.loadDoctors(session.clinicId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(services = services, doctors = doctors)
        }
    }

    fun closeAddNote() {
        _state.value = _state.value.copy(addNoteOpen = false, savingNote = false)
    }

    /**
     * Save a procedure, then reload both the notes and the file.
     *
     * The file is reloaded because a chargeable procedure moves the patient's balance, and showing
     * a stale balance right after billing someone is the sort of thing that gets a patient charged
     * twice.
     */
    fun saveNote(draft: NoteDraft) {
        val session = _state.value.session ?: return
        val patient = _state.value.patientFile?.patient ?: return

        _state.value = _state.value.copy(savingNote = true)
        viewModelScope.launch {
            Repository.addClinicalNote(
                clinicId = session.clinicId,
                patient = patient,
                procedure = draft.procedure,
                teeth = draft.teeth,
                noteText = draft.note,
                unitCost = draft.unitCost,
                status = draft.status,
                doctor = draft.doctor,
                service = draft.service,
                byName = session.name,
            )
                .onSuccess {
                    _state.value = _state.value.copy(
                        savingNote = false,
                        addNoteOpen = false,
                        // The charged figure, not the per-tooth price that was typed.
                        message = if (draft.unitCost > 0) {
                            val charged = draft.unitCost *
                                com.alphadental.clinic.data.pricingUnitsFor(draft.service?.pricingMode, draft.teeth)
                            "Procedure saved and charged ${charged.toInt()} EGP."
                        } else {
                            "Procedure saved."
                        },
                    )
                    openPatient(patient.id)
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        savingNote = false,
                        message = error.message ?: "That procedure could not be saved.",
                    )
                }
        }
    }

    fun closePayment() {
        _state.value = _state.value.copy(paymentOpen = false, outstanding = emptyList(), savingPayment = false)
    }

    /**
     * Record a payment, then reload the patient file so the balance on screen is the stored one.
     *
     * Reloading rather than adjusting the number locally: the balance is derived from the whole
     * ledger, and a local subtraction would be a second, quieter implementation of that sum that
     * could disagree with the real one.
     */
    fun recordPayment(procedure: UnpaidProcedure?, amount: Double) {
        val session = _state.value.session ?: return
        // Reachable now that the payment sheet can be opened from an appointment,
        // on top of a file that is still loading. Silently returning would have
        // looked exactly like a payment that was taken and lost.
        val patient = _state.value.patientFile?.patient ?: run {
            _state.value = _state.value.copy(
                savingPayment = false,
                message = "Still opening the patient's file — try again in a moment.",
            )
            return
        }

        _state.value = _state.value.copy(savingPayment = true)
        viewModelScope.launch {
            Repository.recordPayment(
                clinicId = session.clinicId,
                patient = patient,
                procedure = procedure,
                amount = amount,
                byName = session.name,
                byUid = session.uid,
            )
                .onSuccess {
                    _state.value = _state.value.copy(
                        savingPayment = false,
                        paymentOpen = false,
                        outstanding = emptyList(),
                        message = "Payment of ${amount.toInt()} EGP recorded.",
                    )
                    openPatient(patient.id)
                    refreshTakings()
                    if (_state.value.tab == Tab.MONEY) loadDayLedger()
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        savingPayment = false,
                        message = error.message ?: "That payment could not be saved.",
                    )
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
                Repository.updateAppointment(
                    clinicId = session.clinicId,
                    appointment = moving,
                    dateKey = date,
                    time = draft.time,
                    doctor = draft.doctor,
                    // Falls back to what the appointment already had rather than to the clinic
                    // default: an edit must never quietly shorten a visit somebody lengthened.
                    durationMinutes = draft.durationMinutes.takeIf { it > 0 } ?: moving.duration,
                    treatment = draft.treatment,
                    notes = draft.notes,
                    service = draft.service,
                    cost = draft.cost,
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
                        durationMinutes = draft.durationMinutes.takeIf { it > 0 }
                            ?: draft.service?.durationMinutes?.takeIf { it > 0 }
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
