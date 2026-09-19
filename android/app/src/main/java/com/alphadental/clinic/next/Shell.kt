package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import com.alphadental.clinic.next.design.Type
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Slab
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.People
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.runtime.Composable
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.runtime.collectAsState
import com.alphadental.clinic.next.design.BarItem
import com.alphadental.clinic.next.design.FloatingBar
import com.alphadental.clinic.next.design.T

/** Where the bar can take you. */
/** The site's mobile bar, in its order: dashboard, chats, AI, calendar, money, patients, menu. */
enum class Tab { Today, Chats, Assistant, Day, Money, Patients, More }

/**
 * The app's frame: one bar, one screen at a time.
 *
 * The bar lives here rather than inside each screen, so every screen is just its
 * content and cannot accidentally draw a second one or forget to leave room for
 * it. What it must do is leave `T.barClearance` at the bottom of its scroll —
 * the bar floats over the content, which is what lets a list run underneath it.
 */
@Composable
fun Shell(preview: Boolean = false) {
    var tab by rememberSaveable { mutableStateOf(Tab.Today) }

    // Whichever screen this account chose to open on. Applied once, and only
    // before anybody has touched the bar: a preference that yanked somebody back
    // to Today mid-tap would be a bug wearing a setting's clothes.
    var applied by rememberSaveable { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(preview) {
        if (preview || applied) return@LaunchedEffect
        applied = true
        val uid = com.alphadental.clinic.next.data.ClinicSource.uid() ?: return@LaunchedEffect
        val wanted = runCatching {
            com.alphadental.clinic.data.ClinicSettings.loadHomeTab(uid)
        }.getOrNull().orEmpty()
        Tab.entries.firstOrNull { it.name == wanted }?.let { tab = it }
    }
    var openRecord by rememberSaveable { mutableStateOf<String?>(null) }
    /** Quick Pay opens the file straight onto the payment sheet. */
    var payOnOpen by rememberSaveable { mutableStateOf(false) }
    /** Set when a file is opened in order to bill something, from an appointment. */
    var recordOnOpen by rememberSaveable { mutableStateOf(false) }
    var addingPatient by rememberSaveable { mutableStateOf(false) }
    var quickPay by rememberSaveable { mutableStateOf(false) }
    /** The patient chosen for a quick payment. The sheet opens over the dashboard, not their file. */
    var quickPayFor by rememberSaveable { mutableStateOf<String?>(null) }
    var openMoney by rememberSaveable { mutableStateOf(false) }
    var openReports by rememberSaveable { mutableStateOf(false) }
    var openLab by rememberSaveable { mutableStateOf(false) }
    var openSms by rememberSaveable { mutableStateOf(false) }
    var openSettings by rememberSaveable { mutableStateOf(false) }
    var openOrtho by rememberSaveable { mutableStateOf(false) }
    var openLeads by rememberSaveable { mutableStateOf(false) }
    var openStock by rememberSaveable { mutableStateOf(false) }
    var openAttendance by rememberSaveable { mutableStateOf(false) }
    var openContent by rememberSaveable { mutableStateOf(false) }
    var openAssistant by rememberSaveable { mutableStateOf(false) }
    /**
     * The scans screen, reached from inside the chat rather than from the bar.
     *
     * The bar's orb now opens the conversation, which is what a chat bubble promises. The three
     * paid scans are still one tap away — they are a different job, not a lesser one, and burying
     * them behind the thing people actually tap is the right way round.
     */
    var openScans by rememberSaveable { mutableStateOf(false) }
    var openHelp by rememberSaveable { mutableStateOf(false) }
    /** Settings, but only the personal pages: everyone may open it. */
    var openMyApp by rememberSaveable { mutableStateOf(false) }
    // A screen can ask for the bar to go away. A conversation does: the bar
    // would cover its foot, and offer to walk away from a thread mid-read.
    var immersive by remember { mutableStateOf(false) }

    // A patient's file is pushed over the tabs rather than being one of them: it
    // belongs to whatever opened it, and the bar has no business offering to
    // navigate away in the middle of reading someone's allergies.
    openRecord?.let { id ->
        RecordPane(id, preview, payOnOpen = payOnOpen, recordOnOpen = recordOnOpen) {
            openRecord = null
            payOnOpen = false
            recordOnOpen = false
        }
        return
    }

    if (openMoney) {
        MoneyPane(preview) { openMoney = false }
        return
    }

    if (openReports) {
        ReportsPane(preview) { openReports = false }
        return
    }

    if (openLab) {
        LabPane(preview) { openLab = false }
        return
    }

    if (openSms) {
        SmsPane(preview) { openSms = false }
        return
    }

    if (openSettings) {
        SettingsPane(preview) { openSettings = false }
        return
    }

    if (openOrtho) {
        OrthoPane(preview) { openOrtho = false }
        return
    }

    if (openLeads) {
        LeadsPane(preview) { openLeads = false }
        return
    }

    if (openStock) {
        StockPane(preview) { openStock = false }
        return
    }

    if (openAttendance) {
        AttendancePane(preview) { openAttendance = false }
        return
    }

    if (openContent) {
        ContentPane(preview) { openContent = false }
        return
    }

    if (openHelp) {
        HelpPane { openHelp = false }
        return
    }

    if (openMyApp) {
        SettingsPane(preview, personal = true) { openMyApp = false }
        return
    }

    if (openAssistant) {
        AssistantPane(
            preview,
            onOpenPatient = { openAssistant = false; openRecord = it },
            onBack = { openAssistant = false },
        )
        return
    }

    if (openScans) {
        AssistantPane(
            preview,
            onOpenPatient = { openScans = false; openRecord = it },
            onBack = { openScans = false },
        )
        return
    }

    // Booking sits at the shell rather than inside a tab, because it is reached
    // from three places — the dashboard tile, a free slot in the day, and the
    // day's own button — and all three want the same half-filled sheet back if
    // the person looks something up mid-booking.
    val booking: BookingModel? = if (preview) null else viewModel()
    val bookingState by (booking?.state?.collectAsState()
        ?: androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(Booking()) })

    // Tapping an appointment opens the same sheet from the dashboard and from
    // the diary, for the same reason booking lives here: a patient who has
    // arrived gets marked arrived from whichever screen happened to be open.
    val dayModel: DayModel? = if (preview) null else viewModel()
    val patientsModel: PatientsModel? = if (preview) null else viewModel()
    val patientsState by (patientsModel?.state?.collectAsState()
        ?: androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(previewPatients()) })
    val visits: VisitModel? = if (preview) null else viewModel()
    // Preview has no view model, so the sheet is driven straight from the row
    // that was tapped. Without this the diary looks like nothing happens when
    // you press an appointment, which is the exact bug this screen fixes.
    var shown by remember { mutableStateOf<com.alphadental.clinic.next.data.Visit?>(null) }
    val liveVisit by (visits?.state?.collectAsState()
        ?: androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(VisitSheetState()) })
    val visitState = if (preview) {
        VisitSheetState(who = previewDashboard().who, visit = shown)
    } else {
        liveVisit
    }
    val context = androidx.compose.ui.platform.LocalContext.current

    // The chats badge: the same model the Chats tab reads, started here so the
    // count is right before anybody opens that tab.
    // How this person set the app up: which tabs the bar shows, which home the dashboard draws.
    val interfaceModel: InterfaceModel? = if (preview) null else viewModel()
    val liveUi by (interfaceModel?.state?.collectAsState()
        ?: androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(InterfaceState()) })
    // Preview drives the same bar filter and the same homes from a local, editable state, so
    // the whole feature can be walked through with no account on the phone.
    val uiState = if (preview) PreviewInterface.state else liveUi
    androidx.compose.runtime.LaunchedEffect(interfaceModel) { interfaceModel?.start() }

    val chatsModel: ChatsModel? = if (preview) null else viewModel()
    val chatsState by (chatsModel?.state?.collectAsState()
        ?: androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(Chats()) })
    androidx.compose.runtime.LaunchedEffect(chatsModel) { chatsModel?.start() }
    val unread = if (preview) 3 else chatsState.unread

    Box(Modifier.fillMaxSize().background(T.ground)) {

        when (tab) {
            Tab.Today -> TodayTab(
                preview,
                ui = uiState,
                onOpenAttendance = { openAttendance = true },
                onBook = { booking?.open() },
                onOpenVisit = { if (preview) shown = it else visits?.open(it) },
                onLeads = { openLeads = true },
                onReports = { openReports = true },
                onBell = { tab = Tab.Day },
                onAccount = { tab = Tab.More },
                onNewPatient = { addingPatient = true },
                onQuickPay = { quickPay = true },
                onPickDay = { date -> dayModel?.openDay(date); tab = Tab.Day },
            )
            Tab.Day -> DayTab(
                preview,
                onBook = { date, time -> booking?.open(date, time) },
                onOpenVisit = { if (preview) shown = it else visits?.open(it) },
            )
            Tab.Patients -> PatientsTab(preview) { openRecord = it }
            Tab.Money -> MoneyPane(preview) { tab = Tab.Today }
            Tab.Assistant -> AiChatPane(
                preview,
                onOpenPatient = { openRecord = it },
                onGo = { target ->
                    // The assistant answers in the website's routes; NavIntent has already turned
                    // one into a screen this app actually has. Anything it could not translate
                    // arrived as null and never reaches here.
                    when (target) {
                        is com.alphadental.clinic.ai.NavIntent.Target.PatientById -> openRecord = target.id
                        com.alphadental.clinic.ai.NavIntent.Target.Day -> tab = Tab.Day
                        com.alphadental.clinic.ai.NavIntent.Target.Money -> tab = Tab.Money
                        com.alphadental.clinic.ai.NavIntent.Target.Patients -> tab = Tab.Patients
                        com.alphadental.clinic.ai.NavIntent.Target.Leads -> openLeads = true
                        com.alphadental.clinic.ai.NavIntent.Target.Reports -> openReports = true
                        com.alphadental.clinic.ai.NavIntent.Target.Inventory -> openStock = true
                        com.alphadental.clinic.ai.NavIntent.Target.Ortho -> openOrtho = true
                        com.alphadental.clinic.ai.NavIntent.Target.WhatsappQueue -> tab = Tab.Chats
                        else -> Unit
                    }
                },
                onScans = { openScans = true },
                onBack = { tab = Tab.Today },
            )
            // Not built yet. Saying so is better than a blank screen that reads
            // as a bug, and better than hiding the tab so the bar keeps moving.
            Tab.Chats -> ChatsTab(preview) { immersive = it }
            Tab.More -> MoreTab(
                preview,
                shows = { uiState.showsTool(it.name) },
                onOpenMyApp = { openMyApp = true },
                onOpenMoney = { openMoney = true },
                onOpenReports = { openReports = true },
                onOpenLab = { openLab = true },
                onOpenSms = { openSms = true },
                onOpenSettings = { openSettings = true },
                onOpenOrtho = { openOrtho = true },
                onOpenLeads = { openLeads = true },
                onOpenStock = { openStock = true },
                onOpenAttendance = { openAttendance = true },
                onOpenContent = { openContent = true },
                onOpenAssistant = { openScans = true },
                onOpenHelp = { openHelp = true },
            )
        }

        // New Patient from the dashboard: the same sheet the Patients tab uses,
        // and the same model, so a name typed here is found there.
        if (addingPatient && patientsModel != null) {
            androidx.compose.runtime.LaunchedEffect(Unit) { patientsModel.start() }
            androidx.compose.runtime.LaunchedEffect(patientsState.added) {
                patientsState.added?.let { id ->
                    addingPatient = false
                    patientsModel.clearAdded()
                    // The file exists now, so the half-typed one is finished with. Closing the
                    // sheet deliberately does NOT do this — that is what makes the draft worth
                    // keeping.
                    SheetDrafts.clear(DRAFT_NEW_PATIENT)
                    openRecord = id
                }
            }
            AddPatientSheet(
                busy = patientsState.adding,
                error = patientsState.addError,
                sources = patientsState.sources,
                onAdd = patientsModel::addPatient,
                onDismiss = { addingPatient = false; patientsModel.clearAdded() },
            )
        }

        // The site's Receive Payment modal, over the dashboard. Its own copy of the
        // file's model, keyed apart, so opening a file afterwards is not confused
        // about which patient it was last reading.
        quickPayFor?.let { patientId ->
            val qp: RecordModel = viewModel(key = "quickpay")
            val qpState by qp.state.collectAsState()
            androidx.compose.runtime.LaunchedEffect(patientId) { qp.open(patientId) }
            androidx.compose.runtime.LaunchedEffect(qpState.paid) {
                if (qpState.paid != null) { qp.clearPayment(); quickPayFor = null }
            }
            qpState.record?.let { record ->
                ReceivePaymentSheet(
                    patientName = record.person.name,
                    charged = record.balance.charged,
                    paid = record.balance.paid,
                    unpaid = qpState.unpaid,
                    busy = qpState.taking,
                    error = qpState.payError,
                    onTake = qp::takePayment,
                    onDismiss = { qp.clearPayment(); quickPayFor = null },
                )
            }
        }

        // Quick Pay: find the person, then the site's Receive Payment modal opens
        // right here on the dashboard.
        if (quickPay && patientsModel != null) {
            androidx.compose.runtime.LaunchedEffect(Unit) { patientsModel.start() }
            Sheet(
                title = "Quick pay",
                caption = "Who is paying?",
                action = "Close",
                ready = true,
                onAction = { quickPay = false; patientsModel.search("") },
                onDismiss = { quickPay = false; patientsModel.search("") },
            ) {
                PatientPicker(
                    query = patientsState.query,
                    results = if (patientsState.query.trim().length >= 2) patientsState.people.take(8) else patientsState.debtors.take(8),
                    searching = patientsState.searching,
                    chosen = null,
                    allowNew = false,
                    onQuery = patientsModel::search,
                    onChoose = { person ->
                        person?.let {
                            quickPay = false
                            patientsModel.search("")
                            quickPayFor = it.id
                        }
                    },
                )
                Txt(
                    "Nothing typed shows who owes money.",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                    maxLines = 2,
                )
            }
        }

        if (visitState.isOpen && visits != null) {
            AppointmentSheet(
                state = visitState,
                a = AppointmentActions(
                    setDoctor = visits::setDoctor,
                    setStatus = visits::setStatus,
                    shiftDay = visits::shiftDay,
                    setTime = visits::setTime,
                    setMinutes = visits::setMinutes,
                    setReason = visits::setReason,
                    setNotes = visits::setNotes,
                    save = visits::save,
                    addProcedure = visits::openRecording,
                    pay = visits::openPayment,
                    delete = visits::delete,
                    openFile = {
                        val id = visitState.visit?.patientId
                        visits.close()
                        if (!id.isNullOrBlank()) openRecord = id
                    },
                    close = visits::close,
                ),
            )
            if (visitState.paying) {
                visitState.visit?.let { visit ->
                    ReceivePaymentSheet(
                        patientName = visit.patientName,
                        charged = visitState.charged,
                        paid = visitState.paid,
                        unpaid = visitState.unpaid,
                        busy = visitState.takingPayment,
                        error = visitState.payError,
                        onTake = visits::takePayment,
                        onDismiss = visits::closePayment,
                    )
                }
            }
            if (visitState.recording) {
                visitState.visit?.let { visit ->
                    TreatmentSheet(
                        patientName = visit.patientName,
                        services = visitState.services,
                        doctors = visitState.doctors,
                        busy = visitState.saving,
                        error = visitState.recordError,
                        onRecord = visits::recordTreatment,
                        onDismiss = visits::closeRecording,
                    )
                }
            }
        } else if (visitState.isOpen) {
            // The preview has no model behind it; the simpler sheet still draws.
            VisitSheet(
                state = visitState,
                onMove = { stage -> shown = shown?.copy(status = stage) },
                onOpenFile = { shown = null },
                onReschedule = { shown = null },
                onRecordTreatment = { shown = null },
                onTakePayment = { shown = null },
                onCall = { context.dial(it) },
                onMessage = { context.whatsapp(it) },
                onDismiss = { shown = null },
            )
        }

        if (bookingState.open && booking != null) {
            BookingSheet(
                state = bookingState,
                actions = BookingActions(
                    search = booking::search,
                    choose = booking::choose,
                    setDoctor = booking::setDoctor,
                    setService = booking::setService,
                    setTreatment = booking::setTreatment,
                    shiftDay = booking::shiftDay,
                    setTime = booking::setTime,
                    setMinutes = booking::setMinutes,
                    setNotes = booking::setNotes,
                    book = booking::book,
                    close = booking::close,
                ),
            )
        }

        // The assistant's launcher, as the site floats it: a frosted white disc
        // above the bar's end. Not on Chats, whose composer owns that corner.
        if (!immersive && tab != Tab.Assistant && tab != Tab.Chats) {
            Surface(
                shape = CircleShape,
                color = T.surface.copy(alpha = .92f),
                border = BorderStroke(1.dp, Color.White.copy(alpha = .7f)),
                shadowElevation = 10.dp,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .navigationBarsPadding()
                    .padding(end = 20.dp, bottom = T.barHeight + T.barInset * 2 + 6.dp)
                    .size(56.dp)
                    .clickable { tab = Tab.Assistant },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(
                                androidx.compose.ui.graphics.Brush.radialGradient(
                                    listOf(Color(0xFF99F6E4), Color(0xFF14B8A6), Color(0xFF0F766E)),
                                )
                            )
                    )
                }
            }
        }

        if (!immersive) FloatingBar(
            modifier = Modifier.align(Alignment.BottomCenter),
            // Only the tabs this person kept. Today and Menu cannot be switched off, so the bar
            // always has a way home and a way to everything else.
            items = listOf(
                Tab.Today to BarItem(Icons.Filled.Dashboard, "Dashboard", tab == Tab.Today) { tab = Tab.Today },
                Tab.Chats to BarItem(Icons.AutoMirrored.Filled.Chat, "Chats", tab == Tab.Chats, badge = unread) { tab = Tab.Chats },
                Tab.Assistant to BarItem(Icons.Filled.AutoAwesome, "Assistant", tab == Tab.Assistant) { tab = Tab.Assistant },
                Tab.Day to BarItem(Icons.Filled.CalendarMonth, "Calendar", tab == Tab.Day) { tab = Tab.Day },
                Tab.Money to BarItem(Icons.Filled.AccountBalanceWallet, "Money", tab == Tab.Money) { tab = Tab.Money },
                Tab.Patients to BarItem(Icons.Filled.People, "Patients", tab == Tab.Patients) { tab = Tab.Patients },
                Tab.More to BarItem(Icons.Filled.Menu, "Menu", tab == Tab.More) { tab = Tab.More },
            ).filter { uiState.showsTab(it.first) }.map { it.second },
        )
    }
}

@Composable
private fun TodayTab(
    preview: Boolean,
    ui: InterfaceState,
    onOpenAttendance: () -> Unit,
    onBook: () -> Unit,
    onOpenVisit: (com.alphadental.clinic.next.data.Visit) -> Unit,
    onLeads: () -> Unit,
    onReports: () -> Unit,
    onBell: () -> Unit,
    onAccount: () -> Unit,
    onNewPatient: () -> Unit,
    onQuickPay: () -> Unit,
    onPickDay: (String) -> Unit,
) {
    if (preview) {
        DashboardScreen(
            ui = ui, extras = previewExtras(),
            state = previewDashboard(), onCheckOut = {}, onOpenVisit = onOpenVisit,
            onClock = onOpenAttendance, onBook = onBook,
            onLeads = onLeads, onReports = onReports, onBell = onBell, onAccount = onAccount,
            shift = previewAttendance().mine, onPunch = {},
            onNewPatient = onNewPatient, onQuickPay = onQuickPay, onPickDay = onPickDay,
        )
    } else {
        val model: DashboardModel = viewModel()
        val state by model.state.collectAsState()
        // The same attendance model the attendance screen uses, so clocking in
        // here and clocking out there are one shift, not two opinions about it.
        val attendance: AttendanceModel = viewModel()
        val shift by attendance.state.collectAsState()
        val context = LocalContext.current
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start(); attendance.start() }
        // The chosen home's extra figures, re-read when the choice or the staff link changes.
        androidx.compose.runtime.LaunchedEffect(ui.home, ui.staffId, ui.prefs.loaded, state.who) { model.loadHome(ui) }
        DashboardScreen(
            ui = ui, extras = state.extras,
            state = state, onCheckOut = model::checkOut, onOpenVisit = onOpenVisit,
            onClock = onOpenAttendance, onBook = onBook,
            onLeads = onLeads, onReports = onReports, onBell = onBell, onAccount = onAccount,
            shift = if (shift.who == null) null else shift.mine,
            onPunch = { attendance.punch(context) },
            onNewPatient = if (state.who?.can("patients.add") == true) onNewPatient else null,
            onQuickPay = if (state.who?.can("finance.add") == true) onQuickPay else null,
            // In place. The calendar tab is still one tap away on the bar for anyone who wants it.
            onPickDay = model::show,
        )
    }
}

@Composable
private fun PatientsTab(preview: Boolean, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    if (preview) {
        val state = remember { previewPatients() }
        PatientsScreen(state = state, onSearch = {}, onLoadMore = {}, onOpen = { onOpen(it.id) }, onAdd = {})
    } else {
        val model: PatientsModel = viewModel()
        val state by model.state.collectAsState()
        var adding by remember { mutableStateOf(false) }
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }

        // Straight into the new file. Whoever just typed a name is about to take
        // a phone number or book them in, and both live there.
        androidx.compose.runtime.LaunchedEffect(state.added) {
            state.added?.let { id ->
                adding = false
                model.clearAdded()
                SheetDrafts.clear(DRAFT_NEW_PATIENT)
                onOpen(id)
            }
        }

        PatientsScreen(
            state = state,
            onSearch = model::search,
            onLoadMore = model::loadMore,
            onOpen = { onOpen(it.id) },
            // Adding a patient is a write; only offer it to someone the server
            // would accept it from.
            onAdd = if (state.canAdd) ({ adding = true }) else null,
            onCall = { context.dial(it) },
        )

        if (adding) {
            AddPatientSheet(
                busy = state.adding,
                error = state.addError,
                sources = state.sources,
                onAdd = model::addPatient,
                onDismiss = { adding = false; model.clearAdded() },
            )
        }
    }
}

/**
 * The WhatsApp inbox, and one thread over the top of it.
 *
 * A thread covers the tabs for the same reason a patient's file does: it belongs
 * to the inbox that opened it, and the bar should not offer to walk away from a
 * conversation somebody is in the middle of reading.
 */
@Composable
private fun ChatsTab(preview: Boolean, onImmersive: (Boolean) -> Unit) {
    if (preview) {
        var state by remember { mutableStateOf(previewChats()) }
        androidx.compose.runtime.LaunchedEffect(state.open?.id) { onImmersive(state.open != null) }
        if (state.open != null) {
            BackHandler { state = state.copy(open = null, lines = emptyList()) }
            ThreadScreen(state, onBack = { state = state.copy(open = null, lines = emptyList()) })
        } else {
            ChatsScreen(
                state = state,
                onFilter = { state = state.copy(filter = it) },
                onOpen = { state = previewThread().copy(filter = state.filter) },
            )
        }
        return
    }

    val context = LocalContext.current
    val model: ChatsModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    androidx.compose.runtime.LaunchedEffect(state.open?.id) { onImmersive(state.open != null) }
    // Leaving the tab entirely must hand the bar back, or it stays hidden.
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { onImmersive(false) } }

    if (state.open != null) {
        BackHandler { model.close() }
        ThreadScreen(
            state = state,
            onBack = model::close,
            onCall = { context.dial(it) },
            onSend = model::send,
            onFollowup = model::sendFollowup,
            onClearResult = model::clearSendResult,
            onAttach = { model.attach(context, it) },
            onClearAttachment = model::clearAttachment,
            onSendAttachment = { model.sendAttachment(context, it) },
        )
    } else {
        ChatsScreen(state = state, onFilter = model::show, onOpen = model::open)
    }
}

/**
 * Everything that is not a tab, plus signing out.
 *
 * Signing out is the one destructive thing on this screen, so it asks first.
 * Losing a session costs a receptionist a password they may not carry.
 */
@Composable
private fun MoreTab(
    preview: Boolean,
    shows: (Destination) -> Boolean,
    onOpenMyApp: () -> Unit,
    onOpenMoney: () -> Unit,
    onOpenReports: () -> Unit,
    onOpenLab: () -> Unit,
    onOpenSms: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenOrtho: () -> Unit,
    onOpenLeads: () -> Unit,
    onOpenStock: () -> Unit,
    onOpenAttendance: () -> Unit,
    onOpenContent: () -> Unit,
    onOpenAssistant: () -> Unit,
    onOpenHelp: () -> Unit,
) {
    var confirmSignOut by remember { mutableStateOf(false) }
    val context = LocalContext.current

    var retry: (() -> Unit)? = null
    var switch: ((String) -> Unit)? = null
    val state = if (preview) {
        MoreState(loading = false, who = previewDashboard().who)
    } else {
        val model: MoreModel = viewModel()
        val live by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        retry = model::retry
        switch = { id -> model.switchTo(context, id) }
        live
    }

    MoreScreen(
        state = state,
        shows = shows,
        onSwitchClinic = { id -> switch?.invoke(id) },
        onRetry = { retry?.invoke() },
        onOpen = { d ->
            when (d) {
                Destination.Money -> onOpenMoney()
                Destination.Reports -> onOpenReports()
                Destination.Lab -> onOpenLab()
                Destination.Reminders -> onOpenSms()
                Destination.Settings -> onOpenSettings()
                Destination.Ortho -> onOpenOrtho()
                Destination.Leads -> onOpenLeads()
                Destination.Stock -> onOpenStock()
                Destination.Attendance -> onOpenAttendance()
                Destination.Content -> onOpenContent()
                Destination.Assistant -> onOpenAssistant()
                Destination.Help -> onOpenHelp()
                Destination.MyApp -> onOpenMyApp()
                else -> Unit
            }
        },
        onSignOut = { confirmSignOut = true },
    )

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            containerColor = T.surface,
            title = { Txt("Sign out?", Type.heading, T.ink) },
            text = {
                Txt(
                    "You will need this account's password to get back in.",
                    Type.body,
                    T.inkMuted,
                    maxLines = 3,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmSignOut = false
                    if (!preview) com.google.firebase.auth.FirebaseAuth.getInstance().signOut()
                }) { Txt("Sign out", Type.label, T.danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) {
                    Txt("Stay signed in", Type.label, T.inkMuted)
                }
            },
        )
    }
}

@Composable
private fun DayTab(
    preview: Boolean,
    onBook: (String, String) -> Unit,
    onOpenVisit: (com.alphadental.clinic.next.data.Visit) -> Unit,
) {
    if (preview) {
        var state by remember { mutableStateOf(previewDay()) }
        DayScreen(
            state = state, onShiftDay = {}, onToday = {},
            onOpenVisit = onOpenVisit,
            onSpan = { span ->
                val counts = previewCounts(span)
                state = state.copy(span = span, counts = counts, spanVisits = previewSpanVisits(counts))
            },
            onSelectDay = { state = state.copy(dateKey = it) },
            onOpenDay = { state = state.copy(dateKey = it, span = Span.Day) },
            onBookGap = { gap -> onBook(state.dateKey, clockOf(gap.minute)) },
            onBookNow = { onBook(state.dateKey, "") },
        )
    } else {
        val model: DayModel = viewModel()
        val state by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        DayScreen(
            state = state, onShiftDay = { model.shiftSpan(it) }, onToday = model::today,
            onOpenVisit = onOpenVisit,
            onSpan = model::show,
            onOpenDay = model::openDay,
            onSelectDay = model::selectDay,
            onBookNow = if (state.who?.can("appointments.add") == true) ({ onBook(state.dateKey, "") }) else null,
            // A free slot books into itself: the whole point of tapping one is
            // that the day and time are already decided.
            onBookGap = { gap -> onBook(state.dateKey, clockOf(gap.minute)) },
        )
    }
}

/**
 * A tab that has not been built yet.
 *
 * Named rather than blank: an empty screen reads as a bug, and hiding the tab
 * would make the bar's items move as the rebuild progresses — which is worse
 * than an honest placeholder for anyone using this while it is being built.
 */
@Composable
private fun Unbuilt(name: String) {
    Column(Modifier.fillMaxSize()) {
        Slab(title = name, eyebrow = "Not built yet")
        Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
            Txt("$name is still on the old app for now.", Type.body, T.inkFaint, maxLines = 2)
        }
    }
}


/**
 * A patient's file, over the top of everything.
 *
 * The phone and WhatsApp buttons hand off to whatever the person already uses to
 * ring patients. Dialling is an intent rather than a call placed by this app:
 * the phone's own dialler shows the number before it rings it, which is the
 * safer default when a wrong tap costs a patient a confusing call.
 */
@Composable
private fun RecordPane(
    patientId: String,
    preview: Boolean,
    payOnOpen: Boolean = false,
    recordOnOpen: Boolean = false,
    onBack: () -> Unit,
) {
    BackHandler { onBack() }
    val context = LocalContext.current

    if (preview) {
        var state by remember {
            mutableStateOf(
                previewRecord().copy(media = previewMedia(), notes = previewNotes(), scripts = previewScripts())
            )
        }
        var previewSheet by remember { mutableStateOf("") }
        RecordScreen(
            state = state,
            onBack = onBack,
            onTab = { state = state.copy(tab = it) },
            onSelectTooth = { state = state.copy(tooth = it) },
            onFilterMedia = { c ->
                state = state.copy(mediaFilter = if (state.mediaFilter == c) "" else c)
            },
            onUploadCategory = { state = state.copy(uploadCategory = it) },
            onView = { state = state.copy(viewing = it) },
            onCamera = {},
            onGallery = {},
            onSetNoteStatus = { id, status ->
                state = state.copy(
                    notes = state.notes.map { if (it.id == id) it.copy(status = status) else it },
                )
            },
            onChart = { n -> state = state.copy(charting = state.record?.teeth?.get(n) ?: com.alphadental.clinic.next.data.Tooth(n, emptyList(), "")) },
            onPrescribe = { previewSheet = "rx" },
            onCopyScript = { previewSheet = "rx" },
            onEditDetails = { state = state.copy(editing = true) },
            onTakePayment = { previewSheet = "pay" },
            onRecordTreatment = { previewSheet = "treat" },
            onMore = { previewSheet = "more" },
        )
        if (state.charting != null) {
            ToothSheet(
                state = state,
                onToggle = { id ->
                    val t = state.charting!!
                    state = state.copy(
                        charting = t.copy(
                            statuses = if (id in t.statuses) t.statuses - id else t.statuses + id,
                        ),
                    )
                },
                onNote = { text -> state = state.copy(charting = state.charting?.copy(notes = text)) },
                onSave = { state = state.copy(charting = null) },
                onDismiss = { state = state.copy(charting = null) },
            )
        }

        if (state.editing) {
            DetailsSheet(
                state = state,
                onSave = { _, _, _, _, _, _, _ -> state = state.copy(editing = false) },
                onDismiss = { state = state.copy(editing = false) },
            )
        }

        val person = state.record?.person
        when (previewSheet) {
            "more" -> PatientActionsSheet(
                patientName = person?.name.orEmpty(),
                onPrescribe = { previewSheet = "rx" },
                onPlan = { previewSheet = "plan" },
                onBook = { previewSheet = "" },
                onOrtho = { previewSheet = "" },
                onDismiss = { previewSheet = "" },
            )
            "rx" -> person?.let {
                var script by remember {
                    mutableStateOf(
                        Script(
                            open = true,
                            who = previewDashboard().who,
                            patient = it,
                            library = com.alphadental.clinic.next.data.mergeDrugPicks(emptyList()),
                            doctors = previewDoctors().map { d -> d.name },
                            doctor = previewDoctors().firstOrNull()?.name.orEmpty(),
                        )
                    )
                }
                PrescriptionSheet(
                    state = script,
                    actions = ScriptActions(
                        search = { q -> script = script.copy(query = q) },
                        add = { pick ->
                            script = script.copy(
                                drugs = script.drugs + com.alphadental.clinic.data.RxItem(
                                    pick.name, pick.dose, pick.doseAr,
                                ),
                                query = "",
                            )
                        },
                        addTyped = { name ->
                            script = script.copy(
                                drugs = script.drugs + com.alphadental.clinic.data.RxItem(name = name),
                                query = "",
                            )
                        },
                        setDose = { _, _ -> },
                        setDoseAr = { _, _ -> },
                        setNote = { _, _ -> },
                        remove = { i ->
                            script = script.copy(drugs = script.drugs.filterIndexed { at, _ -> at != i })
                        },
                        setDiagnosis = { t -> script = script.copy(diagnosis = t) },
                        setDoctor = { d -> script = script.copy(doctor = d) },
                        save = { previewSheet = "" },
                        close = { previewSheet = "" },
                    ),
                )
            }
            "plan" -> person?.let {
                var plan by remember {
                    mutableStateOf(
                        Plans(
                            open = true,
                            who = previewDashboard().who,
                            patient = it,
                            services = previewServices(),
                            doctors = previewDoctors().map { d -> d.name },
                            draft = emptyList(),
                        )
                    )
                }
                PlanSheet(
                    state = plan,
                    actions = PlanActions(
                        startDraft = { plan = plan.copy(draft = emptyList()) },
                        cancelDraft = { previewSheet = "" },
                        search = { q -> plan = plan.copy(query = q) },
                        addStep = { service, typed ->
                            val name = service?.name ?: typed
                            plan = plan.copy(
                                draft = plan.draft.orEmpty() + PlanLine(
                                    id = "p${plan.draft.orEmpty().size}",
                                    service = service,
                                    name = name,
                                    unitPrice = service?.price ?: 0.0,
                                ),
                                query = "",
                            )
                        },
                        setTeeth = { _, _ -> },
                        setQuantity = { _, _ -> },
                        setPrice = { _, _ -> },
                        setVisit = { _, _ -> },
                        removeStep = { id ->
                            plan = plan.copy(draft = plan.draft.orEmpty().filterNot { l -> l.id == id })
                        },
                        setTitle = { t -> plan = plan.copy(title = t) },
                        setDescription = { t -> plan = plan.copy(description = t) },
                        setDoctor = { d -> plan = plan.copy(doctor = d) },
                        setStatus = { _, _ -> },
                        save = { previewSheet = "" },
                        close = { previewSheet = "" },
                    ),
                )
            }
            "treat" -> TreatmentSheet(
                patientName = state.record?.person?.name.orEmpty(),
                services = previewServices(),
                doctors = previewDoctors(),
                busy = false, error = null,
                onRecord = { _ -> previewSheet = "" },
                onDismiss = { previewSheet = "" },
            )
            "pay" -> PaymentSheet(
                patientName = state.record?.person?.name.orEmpty(),
                owed = state.record?.balance?.owed ?: 0.0,
                unpaid = previewUnpaid(),
                busy = false, error = null,
                onTake = { _, _ -> previewSheet = "" },
                onDismiss = { previewSheet = "" },
            )
        }
        return
    }

    val model: RecordModel = viewModel()
    val state by model.state.collectAsState()
    // These are the shell's own view models, reached again from inside the file.
    // viewModel() resolves against the session rather than the composable, so
    // the booking sheet opened from here is the same one the diary uses.
    val prescriptions: PrescriptionModel = viewModel()
    val script by prescriptions.state.collectAsState()
    val plans: PlanModel = viewModel()
    val planState by plans.state.collectAsState()
    val booking: BookingModel = viewModel()
    val bookingState by booking.state.collectAsState()
    // The AI tab. Opened once the file has told us who is signed in and who the patient is,
    // because every one of its calls names both.
    val ai: AiClinicalModel = viewModel()
    val aiState by ai.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(state.who?.uid, state.record?.person?.id) {
        val who = state.who
        val person = state.record?.person
        if (who != null && person != null) ai.open(who, person.id, person.name)
    }
    var taking by remember { mutableStateOf(payOnOpen) }
    var recording by remember { mutableStateOf(recordOnOpen) }
    var more by remember { mutableStateOf(false) }

    // Camera and gallery end at the same place: JPEG bytes, downscaled on the
    // phone. A 12-megapixel photograph of one tooth is a storage bill, not a
    // better picture.
    var cameraUri by remember { mutableStateOf<android.net.Uri?>(null) }
    val pickImage = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) {
            com.alphadental.clinic.ui.readScaledJpeg(context, uri)?.let(model::addPhoto)
        }
    }
    val takePicture = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicture(),
    ) { saved ->
        val uri = cameraUri
        if (saved && uri != null) {
            com.alphadental.clinic.ui.readScaledJpeg(context, uri)?.let(model::addPhoto)
        }
    }
    val aiActions = remember(ai, pickImage, takePicture) {
        AiClinicalActions(
            show = ai::show,
            type = ai::type,
            ask = { ai.ask(false) },
            summarize = { ai.ask(true) },
            setSuper = ai::setSuper,
            pickPhotos = ai::pickPhotos,
            toggleAttached = ai::toggleAttached,
            upload = { camera, category ->
                model.setUploadCategory(category)
                if (camera) {
                    runCatching {
                        val dir = java.io.File(context.cacheDir, "camera").apply { mkdirs() }
                        val file = java.io.File(dir, "capture_${System.currentTimeMillis()}.jpg")
                        val uri = androidx.core.content.FileProvider.getUriForFile(
                            context, com.alphadental.clinic.BuildConfig.APPLICATION_ID + ".files", file,
                        )
                        cameraUri = uri
                        takePicture.launch(uri)
                    }
                } else {
                    pickImage.launch(
                        androidx.activity.result.PickVisualMediaRequest(
                            androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly,
                        )
                    )
                }
            },
            openChat = ai::openChat,
            instruct = ai::instruct,
            answer = ai::answer,
            propose = ai::propose,
            saveOption = ai::saveOption,
            togglePicked = ai::togglePicked,
            noteXray = ai::noteXray,
            setDeep = ai::setDeep,
            setCompare = ai::setCompare,
            read = ai::read,
            view = ai::view,
            review = { verdicts, chart, sign -> ai.review(verdicts, chart, sign) },
            clearErrors = ai::clearErrors,
        )
    }
    androidx.compose.runtime.LaunchedEffect(patientId) { model.open(patientId) }
    // A photograph added from the file's Photos tab or from the AI tab itself lands in the AI
    // tab's gallery at once, attached to the question or picked for the read, without a reload.
    androidx.compose.runtime.LaunchedEffect(state.media, state.uploading, state.canAddPhoto) { ai.mediaChanged(state.media, state.uploading, state.canAddPhoto) }

    androidx.compose.runtime.LaunchedEffect(state.recorded) {
        if (state.recorded != null) {
            recording = false
            // On the file, so the draft has served its purpose. Keyed by patient, the same way
            // the sheet keyed it.
            state.record?.person?.name?.let { SheetDrafts.clear("$DRAFT_TREATMENT:$it") }
        }
    }

    // Close the sheet once the money is in, and leave the confirmation on the
    // file rather than in a sheet nobody is looking at any more.
    androidx.compose.runtime.LaunchedEffect(state.paid) {
        if (state.paid != null) taking = false
    }

    RecordScreen(
        state = state,
        onBack = onBack,
        onTab = model::show,
        onSelectTooth = model::selectTooth,
        onCall = { context.dial(it) },
        onMessage = { context.whatsapp(it) },
        // A write, so only for someone the server would accept it from.
        onTakePayment = if (state.canTakePayment) ({ taking = true }) else null,
        onRecordTreatment = if (state.canRecord) ({ recording = true }) else null,
        onMore = { more = true },
        onFilterMedia = model::filterMedia,
        onUploadCategory = model::setUploadCategory,
        onView = model::view,
        onCamera = if (state.canAddPhoto) ({
            runCatching {
                val dir = java.io.File(context.cacheDir, "camera").apply { mkdirs() }
                val file = java.io.File(dir, "capture_${System.currentTimeMillis()}.jpg")
                val uri = androidx.core.content.FileProvider.getUriForFile(
                    context,
                    com.alphadental.clinic.BuildConfig.APPLICATION_ID + ".files",
                    file,
                )
                cameraUri = uri
                takePicture.launch(uri)
            }
            Unit
        }) else null,
        onSetNoteStatus = model::setNoteStatus,
        onChart = { model.chart(it) },
        onPrescribe = if (state.canRecord) ({
            state.record?.let { prescriptions.open(it.person) }
        }) else null,
        onEditDetails = if (state.canEditDetails) ({ model.edit(true) }) else null,
        onPrintScript = { model.printScript(context, it) },
        onShareScript = { model.shareScript(context, it) },
        onSendScript = { model.sendScript(context, it) },
        onCopyScript = if (state.canRecord) ({ rx ->
            state.record?.let { prescriptions.open(it.person, rx) }
        }) else null,
        onGallery = if (state.canAddPhoto) ({
            pickImage.launch(
                androidx.activity.result.PickVisualMediaRequest(
                    androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly,
                )
            )
        }) else null,
        // Null for an account without the finance tick-box, which makes every row on the
        // statement inert rather than offering a sheet the server would refuse.
        // Everyone may open a line; the sheet decides whether it also offers to change it.
        onEditRow = { model.editRow(it) },
        onEditNote = if (state.canRecord) ({ model.editNote(it) }) else null,
        ai = aiState,
        aiActions = aiActions,
        onPlan = if (state.canRecord) ({ state.record?.let { plans.open(it.person) } }) else null,
        onOrtho = if (state.canRecord) ({ model.startOrtho() }) else null,
        onSort = model::toggleSort,
        onDeleteNote = if (state.canDeleteNote) ({ model.deleteNoteNow(it) }) else null,
        onDeleteRow = if (state.canDeleteLedger) ({ model.deleteRowNow(it) }) else null,
        onPlanStatus = if (state.canRecord) ({ plan, status -> model.setPlanStatus(plan, status) }) else null,
    )

    if (aiState.viewing != null) XrayReportSheet(aiState, aiActions)

    if (state.charting != null) {
        ToothSheet(
            state = state,
            onToggle = model::toggleStatus,
            onNote = model::setToothNote,
            onSave = model::saveTooth,
            onDismiss = { model.chart(null) },
        )
    }

    if (state.editing) {
        DetailsSheet(
            state = state,
            onSave = model::saveDetails,
            onDismiss = { model.edit(false) },
        )
    }

    // Full size, over everything. A thumbnail of an x-ray is a grey square.
    state.viewing?.let { url ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { model.view(null) }) {
            Surface(shape = T.cardShape, color = T.surface) {
                Column(Modifier.padding(10.dp)) {
                    coil.compose.AsyncImage(
                        model = url,
                        contentDescription = null,
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        SettingsPill("Close") { model.view(null) }
                    }
                }
            }
        }
    }

    if (more) {
        state.record?.let { record ->
            PatientActionsSheet(
                patientName = record.person.name,
                whatsappOn = !record.whatsappOptOut,
                smsOn = !record.smsBlocked,
                savingMessaging = state.savingMessaging,
                messagingError = state.messagingError,
                onMessaging = if (state.canEditDetails) ({ w, t -> model.setMessaging(w, t) }) else null,
                onPrescribe = if (state.canRecord) ({
                    more = false
                    prescriptions.open(record.person)
                }) else null,
                onPlan = if (state.canRecord) ({
                    more = false
                    plans.open(record.person)
                }) else null,
                onBook = if (bookingState.canBook || state.who?.can("appointments.add") == true) ({
                    more = false
                    booking.openFor(record.person)
                }) else null,
                onOrtho = if (state.canRecord) ({
                    more = false
                    model.startOrtho()
                }) else null,
                onDismiss = { more = false },
            )
        }
    }

    // A prescription is written by a model that knows nothing about this screen, so the screen has
    // to be told. Cleared straight after, or reopening the file would refresh it again forever.
    androidx.compose.runtime.LaunchedEffect(planState.saved) {
        if (planState.saved != null) model.refreshPlans()
    }

    androidx.compose.runtime.LaunchedEffect(script.saved) {
        if (script.saved != null) {
            model.refreshScripts()
            prescriptions.clearSaved()
            model.show(RecordTab.Rx)
        }
    }

    if (script.open) {
        PrescriptionSheet(
            state = script,
            actions = ScriptActions(
                search = prescriptions::search,
                add = prescriptions::add,
                addTyped = prescriptions::addTyped,
                setDose = prescriptions::setDose,
                setDoseAr = prescriptions::setDoseAr,
                setNote = prescriptions::setNote,
                remove = prescriptions::remove,
                setDiagnosis = prescriptions::setDiagnosis,
                setDoctor = prescriptions::setDoctor,
                save = prescriptions::save,
                close = prescriptions::close,
            ),
        )
    }

    if (planState.open) {
        PlanSheet(
            state = planState,
            actions = PlanActions(
                startDraft = plans::startDraft,
                cancelDraft = plans::cancelDraft,
                search = plans::search,
                addStep = plans::addStep,
                setTeeth = plans::setTeeth,
                setQuantity = plans::setQuantity,
                setPrice = plans::setPrice,
                setVisit = plans::setVisit,
                removeStep = plans::removeStep,
                setTitle = plans::setTitle,
                setDescription = plans::setDescription,
                setDoctor = plans::setDoctor,
                setStatus = plans::setStatus,
                save = plans::save,
                close = plans::close,
            ),
        )
    }

    if (bookingState.open) {
        BookingSheet(
            state = bookingState,
            actions = BookingActions(
                search = booking::search,
                choose = booking::choose,
                setDoctor = booking::setDoctor,
                setService = booking::setService,
                setTreatment = booking::setTreatment,
                shiftDay = booking::shiftDay,
                setTime = booking::setTime,
                setMinutes = booking::setMinutes,
                setNotes = booking::setNotes,
                book = booking::book,
                close = booking::close,
            ),
        )
    }

    state.editingNote?.let { note ->
        TreatmentEditSheet(
            note = note,
            services = state.services,
            doctors = state.doctors,
            charted = state.record?.teeth.orEmpty(),
            busy = state.savingNote,
            error = state.noteError,
            canDelete = state.canDeleteNote,
            onSave = model::saveNote,
            onDelete = model::deleteNote,
            onDismiss = model::closeNote,
        )
    }

    state.editingRow?.let { row ->
        LedgerRowSheet(
            row = row,
            busy = state.savingRow,
            error = state.rowError,
            canEdit = state.canEditLedger,
            canDelete = state.canDeleteLedger,
            payments = state.record?.ledger.orEmpty().filter { it.isPayment && it.procedureId == row.id },
            onSave = model::saveRow,
            onDelete = model::deleteRow,
            onDismiss = model::closeRow,
        )
    }

    if (recording) {
        state.record?.let { record ->
            TreatmentSheet(
                patientName = record.person.name,
                services = state.services,
                doctors = state.doctors,
                busy = state.recording,
                error = state.recordError,
                onRecord = model::recordTreatment,
                onDismiss = { recording = false; model.clearRecorded() },
            )
        }
    }

    if (taking) {
        state.record?.let { record ->
            PaymentSheet(
                patientName = record.person.name,
                owed = record.balance.owed,
                unpaid = state.unpaid,
                busy = state.taking,
                error = state.payError,
                onTake = model::takePayment,
                onDismiss = { taking = false; model.clearPayment() },
            )
        }
    }
}

/** Hand the number to the phone's dialler, which shows it before ringing. */
private fun android.content.Context.dial(phone: String) {
    runCatching {
        startActivity(
            android.content.Intent(
                android.content.Intent.ACTION_DIAL,
                android.net.Uri.parse("tel:" + phone.filter { it.isDigit() || it == '+' }),
            )
        )
    }
}

private fun android.content.Context.whatsapp(phone: String) {
    val digits = phone.filter(Char::isDigit)
    runCatching {
        startActivity(
            android.content.Intent(
                android.content.Intent.ACTION_VIEW,
                android.net.Uri.parse("https://wa.me/$digits"),
            )
        )
    }
}


/**
 * The clinic's money, over the top of everything.
 *
 * Reached from More rather than being a tab of its own: it is a screen an owner
 * opens on purpose, not one a receptionist passes through all day.
 */
@Composable
private fun MoneyPane(preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    if (preview) {
        val state = remember { previewMoney() }
        var entering by remember { mutableStateOf(false) }
        MoneyScreen(
            state, onBack = onBack, onShiftMonth = {}, onThisMonth = {},
            onAdd = { entering = true },
        )
        if (entering) {
            FinanceEntrySheet(
                busy = false, error = null,
                onAdd = { _, _, _, _ -> entering = false },
                onDismiss = { entering = false },
            )
        }
        return
    }
    val model: MoneyModel = viewModel()
    val state by model.state.collectAsState()
    var adding by remember { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    androidx.compose.runtime.LaunchedEffect(state.entered) {
        if (state.entered != null) adding = false
    }
    MoneyScreen(
        state = state,
        onBack = onBack,
        onShiftMonth = model::shiftMonth,
        onThisMonth = model::thisMonth,
        onAdd = if (state.canAdd) ({ adding = true }) else null,
        onPeriod = model::show,
        onOpenRow = model::editRow,
    )

    state.editingRow?.let { row ->
        LedgerRowSheet(
            row = row,
            busy = state.savingRow,
            error = state.rowError,
            canEdit = state.canEditLedger,
            // A treatment charge is removed from the patient's file, where the note behind it
            // goes with it; from here it would leave a treatment that reads as done for free.
            canDelete = state.canDeleteLedger && !row.isCharge,
            payments = state.lines.filter { it.isPayment && it.procedureId == row.id },
            onSave = model::saveRow,
            onDelete = model::deleteRow,
            onDismiss = model::closeRow,
        )
    }

    if (adding) {
        FinanceEntrySheet(
            busy = state.saving,
            error = state.entryError,
            onAdd = model::addEntry,
            onDismiss = { adding = false; model.clearEntry() },
        )
    }
}


/**
 * Attendance, over the top of everything.
 *
 * Reached from More and from the dashboard's Clock in tile, because the two
 * things it does belong to two different people: the shift is whoever is holding
 * the phone, the roster is whoever runs the clinic.
 */
@Composable
private fun AttendancePane(preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    val context = LocalContext.current

    if (preview) {
        var state by remember { mutableStateOf(previewAttendance()) }
        AttendanceScreen(
            state = state,
            onBack = onBack,
            onPunch = { },
            onPeriod = { state = state.copy(period = it) },
        )
        return
    }

    val model: AttendanceModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    AttendanceScreen(
        state = state,
        onBack = onBack,
        onPunch = { model.punch(context) },
        onPeriod = model::show,
        team = TeamActions(
            editStaff = model::editStaff,
            closeStaff = model::closeStaff,
            saveStaff = model::saveStaff,
            decideOvertime = model::decideOvertime,
        ),
    )
}


/** The shelf, over the top of everything. */
@Composable
private fun StockPane(preview: Boolean, onBack: () -> Unit) {
    if (preview) {
        var state by remember { mutableStateOf(previewStock()) }
        BackHandler { if (state.open != null) state = state.copy(open = null) else onBack() }
        StockScreen(
            state = state,
            onBack = onBack,
            actions = StockActions(
                filter = { state = state.copy(filter = it) },
                search = { state = state.copy(search = it) },
                open = { state = state.copy(open = it) },
                close = { state = state.copy(open = null) },
                adjust = { },
                save = { },
            ),
        )
        return
    }

    val model: StockModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    BackHandler { if (state.open != null) model.close() else onBack() }
    StockScreen(
        state = state,
        onBack = onBack,
        actions = StockActions(
            filter = model::show,
            search = model::search,
            open = model::open,
            close = model::close,
            adjust = model::adjust,
            save = model::save,
        ),
    )
}


/**
 * Leads, over the top of everything.
 *
 * Calling and messaging hand off to the phone's own dialler and WhatsApp, as
 * they do on a patient's file: the dialler shows the number before it rings it,
 * which is the safer default when a wrong tap rings a stranger.
 */
@Composable
private fun LeadsPane(preview: Boolean, onBack: () -> Unit) {
    val context = LocalContext.current

    if (preview) {
        var state by remember { mutableStateOf(previewLeads()) }
        BackHandler { if (state.open != null) state = state.copy(open = null) else onBack() }
        LeadsScreen(
            state = state,
            onBack = onBack,
            actions = LeadActions(
                filter = { state = state.copy(filter = it) },
                open = { state = state.copy(open = it) },
                close = { state = state.copy(open = null) },
                setStage = { _, _ -> },
                convert = { },
                followUp = { },
                setNotes = { },
                add = { _, _, _, _ -> },
                call = { }, message = { },
            ),
        )
        return
    }

    val model: LeadsModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    BackHandler { if (state.open != null) model.close() else onBack() }
    LeadsScreen(
        state = state,
        onBack = onBack,
        actions = LeadActions(
            filter = model::show,
            open = model::open,
            close = model::close,
            setStage = { stage, reason -> model.setStage(stage, reason) },
            convert = model::convert,
            followUp = model::setFollowUp,
            setNotes = model::setNotes,
            add = { name, phone, source, interest -> model.add(name, phone, source, interest, "") },
            call = { context.dial(it) },
            message = { context.whatsapp(it) },
        ),
    )
}


/**
 * Ortho, over the top of everything.
 *
 * Its own back stack: a case goes back to the board, and the board goes back to
 * More. Losing a half-typed adjustment because back meant "leave ortho" would be
 * the app's fault, not the person's.
 */
@Composable
private fun OrthoPane(preview: Boolean, onBack: () -> Unit) {
    if (preview) {
        var state by remember { mutableStateOf(previewOrtho()) }
        BackHandler { if (state.open != null) state = state.copy(open = null) else onBack() }
        OrthoScreen(
            state = state,
            onBack = onBack,
            actions = OrthoActions(
                filter = { state = state.copy(filter = it) },
                open = { state = state.copy(open = it) },
                close = { state = state.copy(open = null) },
                logVisit = { _, _ -> },
                reviseVisit = { _, _ -> },
                setStage = { },
                saveDetails = { _, _ -> },
                search = { state = state.copy(search = it) },
                startCase = { },
            ),
        )
        return
    }

    val model: OrthoModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    BackHandler { if (state.open != null) model.close() else onBack() }
    OrthoScreen(
        state = state,
        onBack = onBack,
        actions = OrthoActions(
            filter = model::show,
            open = model::open,
            close = model::close,
            logVisit = { work, next -> model.logVisit(work, next) },
            reviseVisit = model::reviseVisit,
            setStage = model::setStage,
            saveDetails = model::saveDetails,
            search = model::searchPatients,
            startCase = model::startCase,
        ),
    )
}


/**
 * Settings, over the top of everything.
 *
 * It keeps its own back stack: a sub-screen goes back to the index, and the
 * index goes back to More. Pressing back out of a half-edited form to the
 * clinic's whole settings list is what people expect; being thrown out to the
 * dashboard is not.
 */
@Composable
private fun SettingsPane(preview: Boolean, personal: Boolean = false, onBack: () -> Unit) {
    if (preview) {
        var stored by remember { mutableStateOf(previewSettings().copy(personal = personal)) }
        val state = stored.copy(ui = PreviewInterface.state)
        fun edit(prefs: (com.alphadental.clinic.next.data.AppPrefs) -> com.alphadental.clinic.next.data.AppPrefs) {
            PreviewInterface.state = PreviewInterface.state.copy(prefs = prefs(PreviewInterface.state.prefs))
        }
        BackHandler { if (state.section != null) stored = stored.copy(section = null) else onBack() }
        SettingsScreen(
            state = state,
            onBack = onBack,
            actions = SettingsActions(
                open = { stored = stored.copy(section = it) },
                close = { stored = stored.copy(section = null) },
                saveProfile = { stored = stored.copy(profile = it) },
                saveArea = { stored = stored.copy(area = it) },
                saveSchedule = { stored = stored.copy(schedule = it) },
                saveDrug = { _, _, _, _, _ -> },
                hideDrug = { _, _, _ -> },
                binDrug = {},
                restoreDeleted = {},
                purgeDeleted = {},
                forget = {},
                saveHomeTab = { stored = stored.copy(homeTab = it) },
                setHome = { h -> edit { it.copy(home = h) } },
                toggleTab = { t -> edit { p -> p.copy(hiddenTabs = if (t.name in p.hiddenTabs) p.hiddenTabs - t.name else p.hiddenTabs + t.name) } },
                toggleTool = { n -> edit { p -> p.copy(hiddenTools = if (n in p.hiddenTools) p.hiddenTools - n else p.hiddenTools + n) } },
                saveMyProfile = { stored = stored.copy(me = it) },
                saveAlertPrefs = { stored = stored.copy(alertPrefs = it) },
                setMute = { id, muted -> stored = stored.copy(myMutes = if (muted) stored.myMutes + id else stored.myMutes - id) },
                saveBooking = { stored = stored.copy(booking = it) },
                saveRecall = { stored = stored.copy(recall = it) },
                saveBot = { stored = stored.copy(bot = it) },
                setDentistShare = { stored = stored.copy(dentistShare = it) },
                saveReasons = { stored = stored.copy(reasons = it) },
                saveSources = { stored = stored.copy(sources = it) },
                saveBranches = { stored = stored.copy(branches = it) },
                saveLabs = { stored = stored.copy(labs = it) },
                saveService = { row ->
                    val list = stored.services.toMutableList()
                    val at = list.indexOfFirst { it.id == row.id && row.id.isNotBlank() }
                    if (at >= 0) list[at] = row else list.add(row.copy(id = "new"))
                    stored = stored.copy(services = list)
                },
                saveStaff = { row ->
                    val list = stored.staff.toMutableList()
                    val at = list.indexOfFirst { it.id == row.id && row.id.isNotBlank() }
                    if (at >= 0) list[at] = row else list.add(row.copy(id = "new"))
                    stored = stored.copy(staff = list)
                },
                rejectRequest = { id -> stored = stored.copy(requests = stored.requests.filterNot { it.id == id }) },
            ),
        )
        return
    }

    val model: SettingsModel = viewModel()
    val state by model.state.collectAsState()
    // The same instance the shell reads, so a tab switched off here leaves the bar at once.
    val interfaceModel: InterfaceModel = viewModel()
    val uiState by interfaceModel.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start(personal); interfaceModel.start() }
    BackHandler { if (state.section != null) model.close() else onBack() }
    SettingsScreen(
        state = state.copy(ui = uiState, personal = personal),
        onBack = onBack,
        actions = SettingsActions(
            open = model::open,
            close = model::close,
            saveProfile = model::saveProfile,
            saveArea = model::saveArea,
            saveSchedule = model::saveSchedule,
            saveDrug = model::saveDrug,
            hideDrug = model::hideDrug,
            binDrug = model::binDrug,
            restoreDeleted = model::restoreDeleted,
            purgeDeleted = model::purgeDeleted,
            forget = model::forget,
            saveHomeTab = model::saveHomeTab,
            setHome = interfaceModel::setHome,
            toggleTab = interfaceModel::toggleTab,
            toggleTool = interfaceModel::toggleTool,
            saveMyProfile = model::saveMyProfile,
            saveAlertPrefs = model::saveAlertPrefs,
            setMute = model::setMute,
            saveBooking = model::saveBooking,
            saveRecall = model::saveRecall,
            saveBot = model::saveBot,
            setDentistShare = model::setDentistShare,
            saveReasons = model::saveReasons,
            saveSources = model::saveSources,
            saveBranches = model::saveBranches,
            saveLabs = model::saveLabs,
            saveService = model::saveService,
            saveStaff = model::saveStaff,
            rejectRequest = model::rejectRequest,
        ),
    )
}


/**
 * Auto SMS, over the top of everything.
 *
 * The phone's own sender state lives in SharedPreferences that the background
 * worker writes, so it is re-read every time the screen comes back rather than
 * held: a run that happened while the screen was closed is exactly the run
 * somebody opens it to check on.
 */
@Composable
private fun SmsPane(preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    if (preview) {
        var state by remember { mutableStateOf(previewSms()) }
        SmsScreen(
            state = state,
            onBack = onBack,
            onEnabled = { state = state.copy(setup = state.setup.copy(enabled = it)) },
            onChannel = { state = state.copy(setup = state.setup.copy(channel = it)) },
            onHour = { state = state.copy(setup = state.setup.copy(sendHour = it.coerceIn(6, 22))) },
            onEvent = { e, on ->
                state = state.copy(setup = state.setup.copy(events = state.setup.events + (e.stored to on)))
            },
            onFooter = { state = state.copy(setup = state.setup.copy(optOutFooter = it)) },
            onBecomeSender = {}, onStopSending = {}, onCheckNow = {},
            onPair = {}, onUnpair = {}, onRetire = {},
        )
        return
    }
    val model: SmsModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        model.refreshPhone()
        onPauseOrDispose { }
    }
    SmsScreen(
        state = state,
        onBack = onBack,
        onEnabled = model::setEnabled,
        onChannel = model::setChannel,
        onHour = model::setSendHour,
        onEvent = model::setEvent,
        onFooter = model::setFooter,
        onBecomeSender = model::becomeSender,
        onStopSending = model::stopSending,
        onCheckNow = model::checkNow,
        onPair = model::pair,
        onUnpair = model::unpair,
        onRetire = model::retire,
    )
}


/**
 * The lab board, over the top of everything.
 *
 * Reached from More rather than the bar: it is a queue somebody works down once
 * or twice a day, not a screen passed through between patients.
 */
@Composable
private fun LabPane(preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    if (preview) {
        var state by remember { mutableStateOf(previewLab()) }
        var order by remember {
            mutableStateOf(
                LabOrder(
                    loading = false,
                    who = previewDashboard().who,
                    labs = listOf(
                        com.alphadental.clinic.data.LabCases.Lab(
                            id = "l1", name = "Cairo Dental Lab", driverName = "Sayed",
                            turnaroundDays = 5,
                            prices = mapOf("zirconia" to 1800.0, "emax" to 2400.0),
                        ),
                    ),
                    doctors = previewDoctors(),
                )
            )
        }
        LabScreen(
            state, onBack = onBack,
            onFilter = { state = state.copy(filter = it) },
            onOpenCase = { state = state.copy(openId = it) },
            onNewCase = { order = order.copy(open = true) },
        )

        if (order.open) {
            LabOrderSheet(
                state = order,
                actions = LabOrderActions(
                    search = { q -> order = order.copy(query = q) },
                    choose = { p -> order = order.copy(patient = p, query = p?.name.orEmpty()) },
                    chooseLab = { lab ->
                        order = order.copy(
                            lab = lab,
                            draft = order.draft.copy(
                                labId = lab?.id.orEmpty(),
                                labName = lab?.name.orEmpty(),
                                dueDate = lab?.turnaroundDays
                                    ?.takeIf { it > 0 }
                                    ?.let { com.alphadental.clinic.data.LabCases.dueInDays(it) }
                                    .orEmpty(),
                                agreedPrice = lab?.prices?.get(order.draft.workType) ?: 0.0,
                            ),
                        )
                    },
                    chooseBranch = {},
                    chooseDoctor = { d -> order = order.copy(doctor = d) },
                    setWorkType = { id -> order = order.copy(draft = order.draft.copy(workType = id)) },
                    toggleTooth = { n ->
                        val teeth = order.draft.teeth
                        order = order.copy(
                            draft = order.draft.copy(
                                teeth = (if (n in teeth) teeth - n else teeth + n).sorted(),
                            ),
                        )
                    },
                    setUnits = { u -> order = order.copy(draft = order.draft.copy(units = u)) },
                    setBodyShade = { v -> order = order.copy(draft = order.draft.copy(bodyShade = v)) },
                    setCervicalShade = { v -> order = order.copy(draft = order.draft.copy(cervicalShade = v)) },
                    setGumShade = { v -> order = order.copy(draft = order.draft.copy(gumShade = v)) },
                    setMaterial = { v -> order = order.copy(draft = order.draft.copy(material = v)) },
                    setImplantSystem = { v -> order = order.copy(draft = order.draft.copy(implantSystem = v)) },
                    setImplantPlatform = { v -> order = order.copy(draft = order.draft.copy(implantPlatform = v)) },
                    setAbutment = { v -> order = order.copy(draft = order.draft.copy(abutmentType = v)) },
                    setRetention = { v -> order = order.copy(draft = order.draft.copy(retention = v)) },
                    setGuideType = { v -> order = order.copy(draft = order.draft.copy(guideType = v)) },
                    setSleeve = { v -> order = order.copy(draft = order.draft.copy(sleeveSystem = v)) },
                    setNotes = { v -> order = order.copy(draft = order.draft.copy(notes = v)) },
                    setDescription = { v -> order = order.copy(draft = order.draft.copy(workDescription = v)) },
                    setPrice = { v -> order = order.copy(draft = order.draft.copy(agreedPrice = v)) },
                    setSentVia = { v -> order = order.copy(draft = order.draft.copy(sentVia = v)) },
                    setTryIn = { v -> order = order.copy(draft = order.draft.copy(needsTryIn = v)) },
                    send = { order = order.copy(open = false) },
                    close = { order = order.copy(open = false) },
                ),
            )
        }
        state.openCase?.let { case ->
            LabMoveSheet(
                case = case, busy = false, error = null,
                onMove = { state = state.copy(openId = null) },
                onDismiss = { state = state.copy(openId = null) },
            )
        }
        return
    }
    val model: LabModel = viewModel()
    val state by model.state.collectAsState()
    val orders: LabOrderModel = viewModel()
    val order by orders.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    LabScreen(
        state = state,
        onBack = onBack,
        onFilter = model::show,
        onOpenCase = { if (state.canMove) model.openCase(it) },
        onNewCase = if (state.canMove) ({ orders.open() }) else null,
    )

    state.openCase?.let { case ->
        LabMoveSheet(
            case = case,
            busy = state.moving,
            error = state.error,
            onMove = { model.move(it); model.openCase(null) },
            onDismiss = { model.openCase(null) },
        )
    }

    if (order.open) {
        LabOrderSheet(
            state = order,
            actions = LabOrderActions(
                search = orders::search,
                choose = orders::choose,
                chooseLab = orders::chooseLab,
                chooseBranch = orders::chooseBranch,
                chooseDoctor = orders::chooseDoctor,
                setWorkType = orders::setWorkType,
                toggleTooth = orders::toggleTooth,
                setUnits = orders::setUnits,
                setBodyShade = orders::setBodyShade,
                setCervicalShade = orders::setCervicalShade,
                setGumShade = orders::setGumShade,
                setMaterial = orders::setMaterial,
                setImplantSystem = orders::setImplantSystem,
                setImplantPlatform = orders::setImplantPlatform,
                setAbutment = orders::setAbutment,
                setRetention = orders::setRetention,
                setGuideType = orders::setGuideType,
                setSleeve = orders::setSleeve,
                setNotes = orders::setNotes,
                setDescription = orders::setDescription,
                setPrice = orders::setPrice,
                setSentVia = orders::setSentVia,
                setTryIn = orders::setTryIn,
                send = orders::send,
                close = orders::close,
            ),
        )
    }
}


/** How the clinic has been doing. Reached from More, like Money. */
@Composable
private fun ReportsPane(preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    if (preview) {
        var state by remember { mutableStateOf(previewReports()) }
        ReportsScreen(state, onBack = onBack, onWindow = { state = state.copy(window = it) })
        return
    }
    val model: ReportsModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    ReportsScreen(state, onBack = onBack, onWindow = model::show)
}

/** Minutes past midnight as "14:30", for a slot that books into itself. */
private fun clockOf(minute: Int): String = "%02d:%02d".format((minute / 60) % 24, minute % 60)

// --- example data for the entry sheets, preview only -------------------------

private fun previewServices() = listOf(
    com.alphadental.clinic.data.Service("s1", "Composite filling", 750.0, 45, 0.0, "Restorative", "", "per_tooth"),
    com.alphadental.clinic.data.Service("s2", "Root canal", 3_200.0, 90, 0.0, "Endodontics", "", "per_tooth"),
    com.alphadental.clinic.data.Service("s3", "Scale & polish", 350.0, 30, 0.0, "Hygiene", "", "flat"),
    com.alphadental.clinic.data.Service("s4", "Zirconia crown", 4_500.0, 60, 1_100.0, "Prosthetics", "", "per_tooth"),
)

private fun previewDoctors() = listOf(
    com.alphadental.clinic.data.Doctor("d1", "Dr. Youssef Kamal", 40.0),
    com.alphadental.clinic.data.Doctor("d2", "Dr. Nour Hassan", 35.0),
)

private fun previewUnpaid() = listOf(
    com.alphadental.clinic.data.UnpaidProcedure("u1", "Root canal (T: 36)", 3_200.0, 1_000.0, 0.0, "d1", "Dr. Youssef Kamal", 40.0),
    com.alphadental.clinic.data.UnpaidProcedure("u2", "Crown (T: 46)", 4_500.0, 0.0, 1_100.0, "d1", "Dr. Youssef Kamal", 40.0),
)

/**
 * The content studio, over the top of everything.
 *
 * Preview draws the form with nothing written, because generating a piece costs
 * the clinic credits and a screenshot is not worth one.
 */
@Composable
private fun ContentPane(preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    if (preview) {
        var state by remember {
            mutableStateOf(
                Studio(
                    loading = false,
                    who = previewDashboard().who,
                    services = listOf("Composite filling", "Root canal", "Scale & polish"),
                )
            )
        }
        MarketingScreen(
            state = state,
            onBack = onBack,
            actions = StudioActions(
                show = { state = state.copy(tab = it) },
                setKind = { state = state.copy(kind = it) },
                setLanguage = { state = state.copy(language = it) },
                setGoal = { state = state.copy(goal = it) },
                setService = { state = state.copy(service = it) },
                setOccasion = { state = state.copy(occasion = it) },
                setTone = { state = state.copy(tone = it) },
                setOffer = { state = state.copy(offer = it) },
                setNotes = { state = state.copy(notes = it) },
                generate = {},
                save = {},
            ),
        )
        return
    }
    val model: MarketingModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    MarketingScreen(
        state = state,
        onBack = onBack,
        actions = StudioActions(
            show = model::show,
            setKind = model::setKind,
            setLanguage = model::setLanguage,
            setGoal = model::setGoal,
            setService = model::setService,
            setOccasion = model::setOccasion,
            setTone = model::setTone,
            setOffer = model::setOffer,
            setNotes = model::setNotes,
            generate = model::generate,
            save = model::save,
        ),
    )
}

/**
 * The assistant you talk to.
 *
 * What the orb opens. It used to open the scans screen, which is a page of paid buttons — a
 * perfectly good screen and not remotely what a chat bubble promises.
 */
@Composable
private fun AiChatPane(
    preview: Boolean,
    onOpenPatient: (String) -> Unit,
    onGo: (com.alphadental.clinic.ai.NavIntent.Target) -> Unit,
    onScans: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    if (preview) {
        var state by remember { mutableStateOf(previewChat()) }
        AiChatScreen(
            state = state,
            onType = { state = state.copy(draft = it) },
            onSend = {},
            onAsk = { state = state.copy(draft = it) },
            onAnswer = {},
            onClear = { state = state.copy(messages = emptyList()) },
            onScans = onScans,
            onBack = onBack,
        )
        return
    }

    val model: AiChatModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start(context) }
    // Acted on here, then cleared, so returning to the chat later does not move the app again.
    androidx.compose.runtime.LaunchedEffect(state.go) {
        state.go?.let { target ->
            if (target is com.alphadental.clinic.ai.NavIntent.Target.PatientById) {
                onOpenPatient(target.id)
            } else {
                onGo(target)
            }
            model.clearGo()
        }
    }
    AiChatScreen(
        state = state,
        onType = model::type,
        onSend = { model.send() },
        onAsk = { model.send(it) },
        onAnswer = model::answer,
        onClear = model::clearChat,
        onScans = onScans,
        onBack = onBack,
    )
}

/** The three scans, over the top of everything. */
@Composable
private fun AssistantPane(preview: Boolean, onOpenPatient: (String) -> Unit, onBack: () -> Unit) {
    BackHandler { onBack() }
    val context = LocalContext.current
    if (preview) {
        var state by remember {
            mutableStateOf(Assistant(loading = false, who = previewDashboard().who))
        }
        AssistantScreen(
            state = state,
            onBack = onBack,
            onTab = { state = state.copy(tab = it) },
            onRun = {},
            onOpenPatient = onOpenPatient,
            onCall = {},
        )
        return
    }
    val model: AssistantModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    AssistantScreen(
        state = state,
        onBack = onBack,
        onTab = model::show,
        onRun = model::run,
        onOpenPatient = onOpenPatient,
        onCall = { context.dial(it) },
    )
}

/**
 * The help centre, over the top of everything.
 *
 * No preview branch: the articles are files in the app rather than clinic data,
 * so the preview build reads exactly the same ones.
 */
@Composable
private fun HelpPane(onBack: () -> Unit) {
    BackHandler { onBack() }
    val model: HelpModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    HelpScreen(state = state, onBack = onBack, onSearch = model::search, onOpen = model::open)
}

/**
 * A fortnight of invented bookings, so the week and month grids have something
 * to draw. The live screen counts real appointments; this only has to prove the
 * squares line up under the right weekday.
 */
/** The demo's visits spread over the days of the span, so the week grid has blocks on it. */
private fun previewSpanVisits(counts: List<DayCount>): List<com.alphadental.clinic.next.data.Visit> {
    val days = counts.filter { it.inSpan }
    if (days.isEmpty()) return emptyList()
    val sample = previewDay().visits
    return days.flatMapIndexed { d, day ->
        val n = minOf(day.booked, sample.size)
        sample.shuffled(java.util.Random(d.toLong())).take(n).mapIndexed { i, v ->
            v.copy(id = "${day.dateKey}-$i", date = day.dateKey)
        }
    }
}

private fun previewCounts(span: Span): List<DayCount> {
    if (span == Span.Day) return emptyList()
    val busy = listOf(6, 0, 9, 11, 4, 7, 0, 3, 12, 8, 0, 5, 10, 2)
    // The real calendar, so the demo's week is the week it actually is: an
    // example that says the 16th falls in a week numbered 1 to 7 teaches the
    // wrong thing about the screen.
    val today = java.util.Calendar.getInstance()
    val start = (today.clone() as java.util.Calendar)
    val pad: Int
    val days: Int
    if (span == Span.Week) {
        start.add(java.util.Calendar.DAY_OF_YEAR, -((start.get(java.util.Calendar.DAY_OF_WEEK) - java.util.Calendar.SATURDAY + 7) % 7))
        pad = 0
        days = 7
    } else {
        start.set(java.util.Calendar.DAY_OF_MONTH, 1)
        pad = (start.get(java.util.Calendar.DAY_OF_WEEK) - java.util.Calendar.SATURDAY + 7) % 7
        days = start.getActualMaximum(java.util.Calendar.DAY_OF_MONTH)
    }
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
    return List(pad) { DayCount("", 0, 0, 0, inSpan = false) } +
        (0 until days).map { i ->
            val cal = (start.clone() as java.util.Calendar).apply { add(java.util.Calendar.DAY_OF_YEAR, i) }
            val day = cal.get(java.util.Calendar.DAY_OF_MONTH)
            val booked = busy[i % busy.size]
            DayCount(
                dateKey = fmt.format(cal.time),
                dayOfMonth = day,
                booked = booked,
                done = if (day % 3 == 0) booked else 0,
            )
        }
}

/**
 * A few photographs for the preview build, so the grid has something in it.
 * They are the help centre's own screenshots — already on the website, already
 * the right shape, and nothing invented that could be mistaken for a patient.
 */
private fun previewMedia(): List<com.alphadental.clinic.data.PatientMedia> {
    val base = com.alphadental.clinic.BuildConfig.WEB_URL.trimEnd('/') + "/help/en/"
    return listOf(
        "new-patient-form.png" to "Clinical Photo",
        "add-treatment.png" to "X-Ray",
        "add-lead.png" to "Panoramic",
        "add-team-member-form.png" to "Clinical Photo",
    ).mapIndexed { i, (file, category) ->
        com.alphadental.clinic.data.PatientMedia(
            id = "m$i",
            url = base + file,
            category = category,
            filename = file,
            uploadedBy = "Dr. Youssef",
            createdAtMillis = System.currentTimeMillis() - i * 86_400_000L,
        )
    }
}

/** A few treatments and a script, so the preview's file is not an empty shell. */
private fun previewNotes(): List<com.alphadental.clinic.data.ClinicalNote> = listOf(
    com.alphadental.clinic.data.ClinicalNote(
        id = "n1", procedure = "Root canal · session 2", tooth = "16",
        note = "Working length confirmed.", cost = 3200.0, status = "Completed",
        doctor = "Dr. Youssef Kamal", date = "2026-09-08",
    ),
    com.alphadental.clinic.data.ClinicalNote(
        id = "n2", procedure = "Zirconia crown", tooth = "16",
        note = "After the root canal settles.", cost = 4500.0, status = "Planned",
        doctor = "Dr. Youssef Kamal", date = "2026-09-08",
    ),
    com.alphadental.clinic.data.ClinicalNote(
        id = "n3", procedure = "Scale & polish", tooth = "",
        note = "", cost = 350.0, status = "Completed",
        doctor = "Dr. Nour Hassan", date = "2026-08-21",
    ),
)

private fun previewScripts(): List<com.alphadental.clinic.data.Prescription> = listOf(
    com.alphadental.clinic.data.Prescription(
        id = "rx1", date = "2026-09-08", doctor = "Dr. Youssef Kamal",
        diagnosis = "Acute pulpitis, upper right 6",
        drugs = listOf(
            com.alphadental.clinic.data.RxItem(
                name = "Augmentin 1gm",
                dose = "1 tablet every 12 hours after food for 5 to 7 days",
                doseAr = "قرص كل 12 ساعة بعد الأكل لمدة 5 إلى 7 أيام",
            ),
            com.alphadental.clinic.data.RxItem(
                name = "Brufen 400mg",
                dose = "1 tablet every 8 hours when needed",
                doseAr = "قرص كل 8 ساعات عند اللزوم",
            ),
        ),
    ),
)
