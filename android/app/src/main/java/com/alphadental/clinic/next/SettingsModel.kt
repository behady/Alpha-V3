package com.alphadental.clinic.next

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.EventRepeat
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.HowToReg
import androidx.compose.material.icons.filled.LocalHospital
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.ClinicSettings
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One page of settings.
 *
 * A phone gets an index and sub-screens rather than the website's long scroll:
 * the website can afford a page that shows everything because it has the width
 * to show it side by side. On a phone that is a thousand-pixel hunt for one
 * switch.
 */
enum class Section(
    val label: String,
    val caption: String,
    val icon: ImageVector,
    val group: SettingsGroup,
) {
    Clinic("Clinic details", "Name, phone, address, prescription header", Icons.Filled.Business, SettingsGroup.Clinic),
    Branches("Branches", "Where the clinic works from", Icons.Filled.Storefront, SettingsGroup.Clinic),
    Labs("Dental labs", "Who the clinic sends work to", Icons.Filled.Science, SettingsGroup.Clinic),
    Area("Clock-in area", "Where staff may clock in from", Icons.Filled.MyLocation, SettingsGroup.Clinic),

    Prices("Price list", "What each treatment costs", Icons.Filled.Payments, SettingsGroup.Work),
    Recall("Recall and dormancy", "When a patient is due back", Icons.Filled.EventRepeat, SettingsGroup.Work),
    Reasons("Visit reasons", "What reception picks when booking", Icons.AutoMirrored.Filled.ListAlt, SettingsGroup.Work),
    Sources("How patients hear of you", "The list behind every marketing figure", Icons.Filled.PersonSearch, SettingsGroup.Work),

    Team("The team", "Who works here, and what they may open", Icons.Filled.Groups, SettingsGroup.People),
    Requests("People asking to join", "Accounts waiting to be let in", Icons.Filled.HowToReg, SettingsGroup.People),

    Booking("Online booking", "The clinic's public booking page", Icons.Filled.CalendarMonth, SettingsGroup.Patients),
    Bot("WhatsApp bot", "What answers patients out of hours", Icons.AutoMirrored.Filled.Chat, SettingsGroup.Patients),

    Alerts("Alerts", "What rings the bell on this phone", Icons.Filled.Notifications, SettingsGroup.App),
    DentistHome("Dentist's home screen", "What a dentist sees of the money", Icons.Filled.LocalHospital, SettingsGroup.App),

    Logs("Activity log", "The last hundred things people did", Icons.Filled.History, SettingsGroup.Records),
    Ai("AI usage", "What the assistant has cost", Icons.Filled.AutoAwesome, SettingsGroup.Records),
}

enum class SettingsGroup(val label: String) {
    Clinic("The clinic"),
    Work("Treatment and money"),
    People("People"),
    Patients("What patients see"),
    App("This app"),
    Records("Records"),
}

data class SettingsState(
    val loading: Boolean = true,
    val who: Who? = null,
    /** Null means the index. */
    val section: Section? = null,
    /** A section is being read or written. */
    val busy: Boolean = false,
    val error: String? = null,

    val profile: ClinicSettings.ClinicProfile? = null,
    val area: ClinicSettings.AttendanceRules? = null,
    val alerts: Map<String, Boolean> = emptyMap(),
    val booking: ClinicSettings.OnlineBooking? = null,
    val recall: ClinicSettings.Recall? = null,
    val bot: ClinicSettings.BotSettings? = null,
    val dentistShare: Boolean? = null,
    val reasons: List<String> = emptyList(),
    val sources: List<String> = emptyList(),
    val branches: List<LabCases.Branch> = emptyList(),
    val labs: List<LabCases.Lab> = emptyList(),
    val services: List<ClinicSettings.ServiceRow> = emptyList(),
    val staff: List<ClinicSettings.StaffRow> = emptyList(),
    val requests: List<ClinicSettings.JoinRequest> = emptyList(),
    val logs: List<ClinicSettings.LogRow> = emptyList(),
    val ai: List<ClinicSettings.AiMonth> = emptyList(),
) {
    /**
     * Whether anything here may be changed.
     *
     * Admin, because `settings/{docId}`, `staff` and `services` are all written
     * under `isClinicAdmin` in the rules. Somebody with "Open settings" but not
     * the admin role can read every page and change none of it, which is exactly
     * what the server would do anyway — so the switches are drawn disabled rather
     * than drawn hopeful.
     */
    val canEdit: Boolean get() = who?.isAdmin == true

    val activeStaff: Int get() = staff.count { it.active }
}

/**
 * Everything about how the clinic runs.
 *
 * The reading and writing is `ClinicSettings`, unchanged — the same object the
 * old app used, which mirrors the website's documents field for field and
 * carries the awkward details in its own comments: that `defaultDurationMinutes`
 * is stored as a string, that saving branches must preserve their rooms, that
 * `botFacts` is merged rather than replaced so the desk can hold facts the phone
 * never shows. Re-deriving any of that here would be a second opinion about a
 * document two apps write.
 *
 * What is new is the shape: an index and sub-screens, and one section loaded at
 * a time. Settings is fourteen documents and four collections; reading all of it
 * to show a list of headings would make opening the screen cost more than most
 * of what it holds.
 */
class SettingsModel : ViewModel() {

    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    if (!who.can("access.settings")) {
                        _state.value = _state.value.copy(
                            error = "This account is not allowed to open the clinic's settings.",
                        )
                        return@onSuccess
                    }
                    // Just enough for the index to say something true about the
                    // clinic. The rest waits until a section is opened.
                    load { it.copy(profile = ClinicSettings.loadProfile(who.clinicId)) }
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    fun open(section: Section) {
        _state.value = _state.value.copy(section = section, error = null)
        val id = _state.value.who?.clinicId ?: return
        when (section) {
            Section.Clinic -> load { it.copy(profile = ClinicSettings.loadProfile(id)) }
            Section.Branches -> load { it.copy(branches = LabCases.loadBranches(id)) }
            Section.Labs -> load { it.copy(labs = LabCases.loadLabs(id)) }
            Section.Area -> load { it.copy(area = ClinicSettings.loadAttendanceRules(id)) }
            Section.Prices -> load { it.copy(services = ClinicSettings.loadServices(id)) }
            Section.Recall -> load { it.copy(recall = ClinicSettings.loadRecall(id)) }
            Section.Reasons -> load { it.copy(reasons = ClinicSettings.loadList(id, ClinicSettings.VISIT_REASONS)) }
            Section.Sources -> load { it.copy(sources = ClinicSettings.loadList(id, ClinicSettings.PATIENT_SOURCES)) }
            Section.Team -> load { it.copy(staff = ClinicSettings.loadStaff(id)) }
            Section.Requests -> load { it.copy(requests = ClinicSettings.loadJoinRequests(id)) }
            Section.Booking -> load { it.copy(booking = ClinicSettings.loadOnlineBooking(id)) }
            Section.Bot -> load { it.copy(bot = ClinicSettings.loadBot(id)) }
            Section.Alerts -> load { it.copy(alerts = ClinicSettings.loadAlerts(id)) }
            Section.DentistHome -> load { it.copy(dentistShare = ClinicSettings.loadDentistShowShare(id)) }
            Section.Logs -> load { it.copy(logs = ClinicSettings.loadLogs(id)) }
            Section.Ai -> load { it.copy(ai = ClinicSettings.loadAiUsage(id)) }
        }
    }

    fun close() {
        _state.value = _state.value.copy(section = null, error = null)
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    // ------------------------------------------------------------------ saves

    fun saveProfile(p: ClinicSettings.ClinicProfile) =
        write({ ClinicSettings.saveProfile(it, p) }) { s -> s.copy(profile = p) }

    fun saveArea(r: ClinicSettings.AttendanceRules) =
        write({ ClinicSettings.saveAttendanceRules(it, r) }) { s -> s.copy(area = r) }

    fun setAlert(key: String, on: Boolean) {
        val next = _state.value.alerts + (key to on)
        write({ ClinicSettings.saveAlerts(it, next) }) { s -> s.copy(alerts = next) }
    }

    fun saveBooking(b: ClinicSettings.OnlineBooking) =
        write({ ClinicSettings.saveOnlineBooking(it, b) }) { s -> s.copy(booking = b) }

    fun saveRecall(r: ClinicSettings.Recall) =
        write({ ClinicSettings.saveRecall(it, r) }) { s -> s.copy(recall = r) }

    fun saveBot(b: ClinicSettings.BotSettings) =
        write({ ClinicSettings.saveBot(it, b) }) { s -> s.copy(bot = b) }

    fun setDentistShare(show: Boolean) =
        write({ ClinicSettings.saveDentistShowShare(it, show) }) { s -> s.copy(dentistShare = show) }

    fun saveReasons(values: List<String>) =
        write({ ClinicSettings.saveList(it, ClinicSettings.VISIT_REASONS, values) }) { s -> s.copy(reasons = values) }

    fun saveSources(values: List<String>) =
        write({ ClinicSettings.saveList(it, ClinicSettings.PATIENT_SOURCES, values) }) { s -> s.copy(sources = values) }

    fun saveBranches(values: List<LabCases.Branch>) =
        write({ ClinicSettings.saveBranchesKeepingRooms(it, values) }) { s -> s.copy(branches = values) }

    fun saveLabs(values: List<LabCases.Lab>) =
        write({ ClinicSettings.saveLabs(it, values) }) { s -> s.copy(labs = values) }

    /** A price. Re-read after writing, because a new one is given its id by Firestore. */
    fun saveService(row: ClinicSettings.ServiceRow) {
        val id = _state.value.who?.clinicId ?: return
        if (!_state.value.canEdit) return
        _state.value = _state.value.copy(busy = true)
        viewModelScope.launch {
            ClinicSettings.saveService(id, row)
                .onSuccess {
                    val fresh = runCatching { ClinicSettings.loadServices(id) }.getOrNull()
                    _state.value = _state.value.copy(
                        busy = false,
                        services = fresh ?: _state.value.services,
                        error = null,
                    )
                }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    fun saveStaff(row: ClinicSettings.StaffRow) {
        val id = _state.value.who?.clinicId ?: return
        if (!_state.value.canEdit) return
        _state.value = _state.value.copy(busy = true)
        viewModelScope.launch {
            ClinicSettings.saveStaff(id, row)
                .onSuccess {
                    val fresh = runCatching { ClinicSettings.loadStaff(id) }.getOrNull()
                    _state.value = _state.value.copy(
                        busy = false,
                        staff = fresh ?: _state.value.staff,
                        error = null,
                    )
                }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    /**
     * Turn somebody away.
     *
     * Only refusal. Approving has to grant a role on another person's account,
     * which no Firestore rule permits any client to do — an approval written from
     * here would mark the request accepted and grant nothing, which is worse than
     * not offering it. Letting somebody in stays on the website.
     */
    fun rejectRequest(id: String) {
        if (!_state.value.canEdit) return
        _state.value = _state.value.copy(busy = true)
        viewModelScope.launch {
            ClinicSettings.rejectJoinRequest(id)
                .onSuccess {
                    _state.value = _state.value.copy(
                        busy = false,
                        requests = _state.value.requests.filterNot { it.id == id },
                    )
                }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    // ------------------------------------------------------------------ plumbing

    /** Read one section, and put what came back where it belongs. */
    private fun load(read: suspend (SettingsState) -> SettingsState) {
        _state.value = _state.value.copy(busy = true)
        viewModelScope.launch {
            runCatching { read(_state.value) }
                .onSuccess { _state.value = it.copy(busy = false, error = null) }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    private fun write(
        save: suspend (String) -> Result<Unit>,
        apply: (SettingsState) -> SettingsState,
    ) {
        val id = _state.value.who?.clinicId ?: return
        if (!_state.value.canEdit) return
        // Shown at once and put back if the server refuses. A switch that waits
        // for a round trip reads as a switch that did not work, and gets pressed
        // again — which for a toggle means setting it back.
        val before = _state.value
        _state.value = apply(before).copy(busy = true)
        viewModelScope.launch {
            save(id)
                .onSuccess { _state.value = _state.value.copy(busy = false, error = null) }
                .onFailure { e -> _state.value = before.copy(busy = false, error = readable(e)) }
        }
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) ->
                "This account is not allowed to change that."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. Nothing was changed."
            else -> "That could not be saved."
        }
    }
}

/** Preview data. See [previewDashboard]. */
fun previewSettings(): SettingsState = SettingsState(
    loading = false,
    who = previewDashboard().who,
    profile = ClinicSettings.ClinicProfile(
        name = "Alpha Dental Centre",
        doctorName = "Dr. Youssef Kamal",
        phone = "+20 100 123 4567",
        email = "hello@alphadental.app",
        address = "12 El Nasr Street, Nasr City, Cairo",
        currency = "EGP",
        rxHeader = "Alpha Dental Centre\n12 El Nasr Street, Nasr City\n+20 100 123 4567",
    ),
    staff = listOf(
        ClinicSettings.StaffRow("s1", "u1", "Ahmed Tarek", "ahmed@alphadental.app", "Owner", "+201001234567", true, emptyList(), 0.0, 0.0),
        ClinicSettings.StaffRow("s2", "u2", "Dr. Youssef Kamal", "youssef@alphadental.app", "Dentist", "+201009876543", true, listOf("access.clinical", "clinical.edit"), 40.0, 0.0),
        ClinicSettings.StaffRow("s3", "u3", "Nour Hassan", "nour@alphadental.app", "Dentist", "", true, listOf("access.clinical"), 35.0, 0.0),
        ClinicSettings.StaffRow("s4", "", "Mona Adel", "mona@alphadental.app", "Receptionist", "", true, listOf("access.patients", "patients.add", "access.appointments"), 0.0, 6_500.0),
        ClinicSettings.StaffRow("s5", "", "Sara Fouad", "sara@alphadental.app", "Assistant", "", false, emptyList(), 0.0, 4_000.0),
    ),
    services = listOf(
        ClinicSettings.ServiceRow("v1", "Consultation", 300.0, 15, 0.0, "General", "flat", ""),
        ClinicSettings.ServiceRow("v2", "Composite filling", 750.0, 45, 0.0, "Restorative", "per_tooth", ""),
        ClinicSettings.ServiceRow("v3", "Root canal", 3_200.0, 90, 0.0, "Endodontics", "per_tooth", ""),
        ClinicSettings.ServiceRow("v4", "Zirconia crown", 4_500.0, 60, 1_100.0, "Prosthetics", "per_tooth", ""),
        ClinicSettings.ServiceRow("v5", "Scale & polish", 350.0, 30, 0.0, "Hygiene", "flat", ""),
    ),
    branches = listOf(
        LabCases.Branch("loc_1", "Nasr City", "NSR"),
        LabCases.Branch("loc_2", "Maadi", "MAD"),
    ),
    labs = listOf(
        LabCases.Lab("lab_1", "Cairo Dental Lab", phone = "+201112223334", turnaroundDays = 5, driverName = "Sayed"),
        LabCases.Lab("lab_2", "Smile Works", phone = "+201115556667", turnaroundDays = 7),
    ),
    reasons = listOf("كشف", "Follow-up", "Emergency", "Cleaning"),
    sources = listOf("Walk-in", "Social Media", "Friend / Family", "Google", "Online Booking"),
    booking = ClinicSettings.OnlineBooking(enabled = true, enableDoctorSelection = true, defaultDurationMinutes = "30"),
    recall = ClinicSettings.Recall(intervalMonths = 6, reactivationMonths = 12),
    alerts = mapOf("patientArrival" to true, "labReady" to false),
    dentistShare = true,
    bot = ClinicSettings.BotSettings(
        enabled = true,
        answerStrangers = false,
        autoConfirmBookings = false,
        mode = "ai_first",
        aiEnabled = true,
        clinicalMode = "dentist",
        humanClaimMinutes = 15,
        personaName = "سارة",
        facts = mapOf("consultation" to "الكشف ٣٠٠ جنيه", "parking" to "جراج مجاني أمام العيادة"),
    ),
    requests = listOf(
        ClinicSettings.JoinRequest("j1", "Hana Mostafa", "hana@gmail.com", "Assistant", System.currentTimeMillis() - 3_600_000),
    ),
    logs = listOf(
        ClinicSettings.LogRow("l1", "Payment recorded", "2,400 EGP · Mariam Hassan", "Mona Adel", System.currentTimeMillis() - 900_000),
        ClinicSettings.LogRow("l2", "Appointment moved", "Khaled Mostafa · 10:30 → 11:15", "Mona Adel", System.currentTimeMillis() - 5_400_000),
        ClinicSettings.LogRow("l3", "Patient added", "Yara Sameh", "Ahmed Tarek", System.currentTimeMillis() - 86_400_000),
    ),
    ai = listOf(
        ClinicSettings.AiMonth("2026-09", 41.5, mapOf("bot" to 28.0, "assistant" to 9.5, "reports" to 4.0)),
        ClinicSettings.AiMonth("2026-08", 63.2, mapOf("bot" to 44.0, "assistant" to 19.2)),
    ),
)
