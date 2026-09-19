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
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.ClinicSettings
import com.alphadental.clinic.data.Repository
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
    Hours("Opening hours", "When the clinic is open, and for how long a slot", Icons.Filled.Schedule, SettingsGroup.Clinic),

    Prices("Price list", "What each treatment costs", Icons.Filled.Payments, SettingsGroup.Work),
    Recall("Recall and dormancy", "When a patient is due back", Icons.Filled.EventRepeat, SettingsGroup.Work),
    Reasons("Visit reasons", "What reception picks when booking", Icons.AutoMirrored.Filled.ListAlt, SettingsGroup.Work),
    Sources("How patients hear of you", "The list behind every marketing figure", Icons.Filled.PersonSearch, SettingsGroup.Work),

    Team("The team", "Who works here, and what they may open", Icons.Filled.Groups, SettingsGroup.People),
    Requests("People asking to join", "Accounts waiting to be let in", Icons.Filled.HowToReg, SettingsGroup.People),

    Booking("Online booking", "The clinic's public booking page", Icons.Filled.CalendarMonth, SettingsGroup.Patients),
    Bot("WhatsApp bot", "What answers patients out of hours", Icons.AutoMirrored.Filled.Chat, SettingsGroup.Patients),

    Alerts("Alerts", "What rings the bell on this phone", Icons.Filled.Notifications, SettingsGroup.App),
    Interface("The app, your way", "Your home screen, the tabs in the bar, the menu", Icons.Filled.Smartphone, SettingsGroup.App),
    Profile("My profile", "Your name, nickname, phone and a line about you", Icons.Filled.Person, SettingsGroup.App),
    DentistHome("Dentist's home screen", "What a dentist sees of the money", Icons.Filled.LocalHospital, SettingsGroup.App),

    Drugs("Prescription drugs", "The clinic's edits to the built-in list", Icons.Filled.Medication, SettingsGroup.Work),
    Deleted("Recently deleted", "Thirty days to change your mind", Icons.Filled.RestoreFromTrash, SettingsGroup.Records),
    Logs("Activity log", "The last hundred things people did", Icons.Filled.History, SettingsGroup.Records),
    Ai("AI usage", "What the assistant has cost", Icons.Filled.AutoAwesome, SettingsGroup.Records),
    Memory("What the assistant learned", "Rules it applies to every answer", Icons.Filled.Psychology, SettingsGroup.Records),
}

/**
 * A section that is about the person, not the clinic.
 *
 * These two are reachable by everyone from the menu's "My app", with or without the
 * settings permission: which home screen a receptionist's phone opens on and what her own
 * profile says are hers to decide, and the rules already let her write both.
 */
val Section.isPersonal: Boolean get() = this == Section.Interface || this == Section.Profile

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
    val schedule: ClinicSettings.Schedule? = null,
    val drugRows: List<com.alphadental.clinic.data.DrugShortcut> = emptyList(),
    val bin: List<com.alphadental.clinic.data.RecycleBin.Entry> = emptyList(),
    val facts: List<String> = emptyList(),
    /** Which tab this account opens on; blank until it has been read. */
    val homeTab: String? = null,
    /** Opened from "My app" on the menu: only the personal sections, no permission needed. */
    val personal: Boolean = false,
    /** How this person set the app up. Owned by [InterfaceModel]; copied in for the pages. */
    val ui: InterfaceState = InterfaceState(),
    /** My own staff row, for the profile page. Null until read; blank id means no row. */
    val me: ClinicSettings.MyProfile? = null,
    val myStaffId: String = "",
    /** The clinic's `alertPreferences` map, whole. Null until read. */
    val alertPrefs: Map<String, Any?>? = null,
    /** My own mutes for this clinic, by event id. */
    val myMutes: List<String> = emptyList(),
    val mutesLoaded: Boolean = false,
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

    fun start(personal: Boolean = false) {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false, personal = personal)
                    if (personal) return@onSuccess
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
            Section.Hours -> load { it.copy(schedule = ClinicSettings.loadSchedule(id)) }
            Section.Drugs -> load { it.copy(drugRows = ClinicSettings.loadDrugRows(id)) }
            Section.Deleted -> load { it.copy(bin = com.alphadental.clinic.data.RecycleBin.list(id)) }
            Section.Interface -> load {
                it.copy(homeTab = ClinicSettings.loadHomeTab(_state.value.who?.uid.orEmpty()))
            }
            Section.Profile -> load {
                val who = it.who ?: return@load it
                val staffId = Repository.findMyStaffId(id, who.uid, who.email)
                it.copy(
                    myStaffId = staffId,
                    me = if (staffId.isBlank()) ClinicSettings.MyProfile() else ClinicSettings.loadMyProfile(id, staffId),
                )
            }
            Section.Memory -> load {
                // Per account, not per clinic: the assistant learns from the
                // person it is talking to, and the server reads the same
                // ai_preferences/{uid} document.
                it.copy(facts = Repository.loadAiFacts(id, _state.value.who?.uid.orEmpty()))
            }
            Section.Prices -> load { it.copy(services = ClinicSettings.loadServices(id)) }
            Section.Recall -> load { it.copy(recall = ClinicSettings.loadRecall(id)) }
            Section.Reasons -> load { it.copy(reasons = ClinicSettings.loadList(id, ClinicSettings.VISIT_REASONS)) }
            Section.Sources -> load { it.copy(sources = ClinicSettings.loadList(id, ClinicSettings.PATIENT_SOURCES)) }
            Section.Team -> load { it.copy(staff = ClinicSettings.loadStaff(id)) }
            Section.Requests -> load { it.copy(requests = ClinicSettings.loadJoinRequests(id)) }
            Section.Booking -> load { it.copy(booking = ClinicSettings.loadOnlineBooking(id)) }
            Section.Bot -> load { it.copy(bot = ClinicSettings.loadBot(id)) }
            Section.Alerts -> load {
                val uid = it.who?.uid.orEmpty()
                it.copy(
                    alertPrefs = ClinicSettings.loadAlertPrefs(id),
                    myMutes = ClinicSettings.loadMyMutes(uid, id),
                    mutesLoaded = true,
                )
            }
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

    fun saveSchedule(sched: ClinicSettings.Schedule) =
        write({ ClinicSettings.saveSchedule(it, sched) }) { s ->
            s.copy(schedule = sched.copy(configured = true))
        }

    fun saveDrug(docId: String, catalogId: String, name: String, dose: String, doseAr: String) =
        act({ ClinicSettings.saveDrugRow(it, docId, catalogId, name, dose, doseAr) }) { id ->
            copy(drugRows = ClinicSettings.loadDrugRows(id))
        }

    fun hideDrug(docId: String, catalogId: String, name: String) =
        act({ ClinicSettings.hideBuiltInDrug(it, docId, catalogId, name) }) { id ->
            copy(drugRows = ClinicSettings.loadDrugRows(id))
        }

    /** A drug the clinic typed in. It is a real document, so it goes to the bin. */
    fun binDrug(docId: String) =
        act({ com.alphadental.clinic.data.RecycleBin.delete(it, "drugs", docId) }) { id ->
            copy(drugRows = ClinicSettings.loadDrugRows(id))
        }

    fun restoreDeleted(entryId: String) =
        act({ com.alphadental.clinic.data.RecycleBin.restore(it, entryId) }) { id ->
            copy(bin = com.alphadental.clinic.data.RecycleBin.list(id))
        }

    fun purgeDeleted(entryId: String) =
        act({ com.alphadental.clinic.data.RecycleBin.purge(it, entryId) }) { id ->
            copy(bin = com.alphadental.clinic.data.RecycleBin.list(id))
        }

    /**
     * A write, then a re-read of whatever it changed.
     *
     * Separate from [write] for two reasons. These have nothing to show
     * optimistically — a restored record is not a switch that can be flipped
     * ahead of the server — and the recycle-bin routes explain their refusals
     * properly ("that patient no longer exists", "something with this name is
     * already there"), so their message is shown as written instead of being
     * flattened into "that could not be saved".
     */
    private fun act(
        action: suspend (String) -> Result<Unit>,
        reload: suspend SettingsState.(String) -> SettingsState,
    ) {
        val id = _state.value.who?.clinicId ?: return
        if (!_state.value.canEdit) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            action(id)
                .onSuccess {
                    val next = runCatching { _state.value.reload(id) }.getOrDefault(_state.value)
                    _state.value = next.copy(busy = false, error = null)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        busy = false,
                        error = e.message?.takeIf { it.isNotBlank() } ?: readable(e),
                    )
                }
        }
    }

    /**
     * Forget one rule.
     *
     * The whole list is rewritten by the repository inside a transaction, because
     * the field is a plain array with no ids — and re-read there, so a fact
     * learned while somebody sat on this screen is not dropped by a stale copy.
     * What comes back is what is now stored, which is what gets shown.
     */
    fun forget(fact: String) {
        val who = _state.value.who ?: return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { Repository.forgetAiFact(who.clinicId, who.uid, fact) }
                .onSuccess { _state.value = _state.value.copy(busy = false, facts = it, error = null) }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    /**
     * A personal preference, so it is not behind [canEdit].
     *
     * Everything else on these pages changes the clinic and is admin-only. Which
     * screen an assistant's own phone opens on is nobody else's decision, and
     * gating it would mean the person it belongs to could not set it.
     */
    fun saveHomeTab(tab: String) {
        val who = _state.value.who ?: return
        _state.value = _state.value.copy(homeTab = tab, busy = true, error = null)
        viewModelScope.launch {
            ClinicSettings.saveHomeTab(who.uid, tab)
                .onSuccess { _state.value = _state.value.copy(busy = false) }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    /** Mine to change, like [saveHomeTab]: the rules allow one's own row and nothing more. */
    fun saveMyProfile(p: ClinicSettings.MyProfile) {
        val who = _state.value.who ?: return
        val staffId = _state.value.myStaffId
        if (staffId.isBlank()) {
            _state.value = _state.value.copy(error = "This account is not on the clinic's staff list yet.")
            return
        }
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            ClinicSettings.saveMyProfile(who.clinicId, staffId, p)
                .onSuccess { _state.value = _state.value.copy(busy = false, me = p) }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    fun saveArea(r: ClinicSettings.AttendanceRules) =
        write({ ClinicSettings.saveAttendanceRules(it, r) }) { s -> s.copy(area = r) }

    fun saveAlertPrefs(prefs: Map<String, Any?>) =
        write({ ClinicSettings.saveAlertPrefs(it, prefs) }) { s -> s.copy(alertPrefs = prefs) }

    /** Mine, like [saveHomeTab]: written to my own record, no admin needed. */
    fun setMute(eventId: String, muted: Boolean) {
        val who = _state.value.who ?: return
        val next = if (muted) (_state.value.myMutes + eventId).distinct() else _state.value.myMutes - eventId
        _state.value = _state.value.copy(myMutes = next)
        viewModelScope.launch {
            ClinicSettings.saveMyMutes(who.uid, who.clinicId, next)
                .onFailure { e -> _state.value = _state.value.copy(error = readable(e)) }
        }
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
    homeTab = Tab.Today.name,
    me = ClinicSettings.MyProfile(name = "Dr. Youssef", nickname = "Youssef", phone = "01001234567"),
    myStaffId = "s1",
    schedule = ClinicSettings.Schedule(
        start = "09:00", end = "21:00", slotMinutes = 20,
        offDays = setOf("friday"), configured = true,
    ),
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
    alertPrefs = emptyMap(),
    mutesLoaded = true,
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
