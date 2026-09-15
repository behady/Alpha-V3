package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import com.alphadental.clinic.next.design.Type
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Slab
import androidx.compose.foundation.layout.padding
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
enum class Tab { Today, Day, Patients, Chats, More }

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
    var openRecord by rememberSaveable { mutableStateOf<String?>(null) }
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
    // A screen can ask for the bar to go away. A conversation does: the bar
    // would cover its foot, and offer to walk away from a thread mid-read.
    var immersive by remember { mutableStateOf(false) }

    // A patient's file is pushed over the tabs rather than being one of them: it
    // belongs to whatever opened it, and the bar has no business offering to
    // navigate away in the middle of reading someone's allergies.
    openRecord?.let { id ->
        RecordPane(id, preview) { openRecord = null }
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

    if (openAssistant) {
        AssistantPane(
            preview,
            onOpenPatient = { openAssistant = false; openRecord = it },
            onBack = { openAssistant = false },
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

    Box(Modifier.fillMaxSize().background(T.ground)) {

        when (tab) {
            Tab.Today -> TodayTab(
                preview,
                onOpenAttendance = { openAttendance = true },
                onBook = { booking?.open() },
                onOpenVisit = { if (preview) shown = it else visits?.open(it) },
            )
            Tab.Day -> DayTab(
                preview,
                onBook = { date, time -> booking?.open(date, time) },
                onOpenVisit = { if (preview) shown = it else visits?.open(it) },
            )
            Tab.Patients -> PatientsTab(preview) { openRecord = it }
            // Not built yet. Saying so is better than a blank screen that reads
            // as a bug, and better than hiding the tab so the bar keeps moving.
            Tab.Chats -> ChatsTab(preview) { immersive = it }
            Tab.More -> MoreTab(
                preview,
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
                onOpenAssistant = { openAssistant = true },
            )
        }

        if (visitState.isOpen) {
            VisitSheet(
                state = visitState,
                onMove = { stage -> visits?.move(stage) ?: run { shown = shown?.copy(status = stage) } },
                onOpenFile = {
                    val id = visitState.visit?.patientId
                    visits?.close()
                    shown = null
                    if (!id.isNullOrBlank()) openRecord = id
                },
                onReschedule = {
                    visitState.visit?.let { visit ->
                        visits?.close()
                        shown = null
                        booking?.edit(visit)
                    }
                },
                onCall = { context.dial(it) },
                onMessage = { context.whatsapp(it) },
                onDismiss = { visits?.close(); shown = null },
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
                    shiftDay = booking::shiftDay,
                    setTime = booking::setTime,
                    setMinutes = booking::setMinutes,
                    setNotes = booking::setNotes,
                    book = booking::book,
                    close = booking::close,
                ),
            )
        }

        if (!immersive) FloatingBar(
            modifier = Modifier.align(Alignment.BottomCenter),
            items = listOf(
                BarItem(Icons.Filled.Home, "Today", tab == Tab.Today) { tab = Tab.Today },
                BarItem(Icons.Filled.CalendarMonth, "Day", tab == Tab.Day) { tab = Tab.Day },
                BarItem(Icons.Filled.PersonSearch, "Patients", tab == Tab.Patients) { tab = Tab.Patients },
                BarItem(Icons.AutoMirrored.Filled.Chat, "Chats", tab == Tab.Chats) { tab = Tab.Chats },
                BarItem(Icons.Filled.Menu, "More", tab == Tab.More) { tab = Tab.More },
            ),
        )
    }
}

@Composable
private fun TodayTab(
    preview: Boolean,
    onOpenAttendance: () -> Unit,
    onBook: () -> Unit,
    onOpenVisit: (com.alphadental.clinic.next.data.Visit) -> Unit,
) {
    if (preview) {
        DashboardScreen(
            state = previewDashboard(), onCheckOut = {}, onOpenVisit = onOpenVisit,
            onClock = onOpenAttendance, onBook = onBook,
        )
    } else {
        val model: DashboardModel = viewModel()
        val state by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        DashboardScreen(
            state = state, onCheckOut = model::checkOut, onOpenVisit = onOpenVisit,
            onClock = onOpenAttendance, onBook = onBook,
        )
    }
}

@Composable
private fun PatientsTab(preview: Boolean, onOpen: (String) -> Unit) {
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
        )

        if (adding) {
            AddPatientSheet(
                busy = state.adding,
                error = state.addError,
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
) {
    var confirmSignOut by remember { mutableStateOf(false) }

    var retry: (() -> Unit)? = null
    val state = if (preview) {
        MoreState(loading = false, who = previewDashboard().who)
    } else {
        val model: MoreModel = viewModel()
        val live by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        retry = model::retry
        live
    }

    MoreScreen(
        state = state,
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
        val state = remember { previewDay() }
        DayScreen(
            state = state, onShiftDay = {}, onToday = {},
            onOpenVisit = onOpenVisit,
            onBookGap = { gap -> onBook(state.dateKey, clockOf(gap.minute)) },
        )
    } else {
        val model: DayModel = viewModel()
        val state by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        DayScreen(
            state = state, onShiftDay = model::shiftDay, onToday = model::today,
            onOpenVisit = onOpenVisit,
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
private fun RecordPane(patientId: String, preview: Boolean, onBack: () -> Unit) {
    BackHandler { onBack() }
    val context = LocalContext.current

    if (preview) {
        var state by remember { mutableStateOf(previewRecord()) }
        var previewSheet by remember { mutableStateOf("") }
        RecordScreen(
            state = state,
            onBack = onBack,
            onTab = { state = state.copy(tab = it) },
            onSelectTooth = { state = state.copy(tooth = it) },
            onTakePayment = { previewSheet = "pay" },
            onRecordTreatment = { previewSheet = "treat" },
            onMore = { previewSheet = "more" },
        )
        val person = state.record?.person
        when (previewSheet) {
            "more" -> PatientActionsSheet(
                patientName = person?.name.orEmpty(),
                onPrescribe = { previewSheet = "rx" },
                onPlan = { previewSheet = "plan" },
                onBook = { previewSheet = "" },
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
                onRecord = { _, _, _, _, _, _, _ -> previewSheet = "" },
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
    var taking by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(patientId) { model.open(patientId) }

    androidx.compose.runtime.LaunchedEffect(state.recorded) {
        if (state.recorded != null) recording = false
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
    )

    if (more) {
        state.record?.let { record ->
            PatientActionsSheet(
                patientName = record.person.name,
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
                onDismiss = { more = false },
            )
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
                shiftDay = booking::shiftDay,
                setTime = booking::setTime,
                setMinutes = booking::setMinutes,
                setNotes = booking::setNotes,
                book = booking::book,
                close = booking::close,
            ),
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
                onRecord = { procedure, teeth, note, cost, doctor, service, done ->
                    model.recordTreatment(procedure, teeth, note, cost, doctor, service, done)
                },
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
    )

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
private fun SettingsPane(preview: Boolean, onBack: () -> Unit) {
    if (preview) {
        var state by remember { mutableStateOf(previewSettings()) }
        BackHandler { if (state.section != null) state = state.copy(section = null) else onBack() }
        SettingsScreen(
            state = state,
            onBack = onBack,
            actions = SettingsActions(
                open = { state = state.copy(section = it) },
                close = { state = state.copy(section = null) },
                saveProfile = { state = state.copy(profile = it) },
                saveArea = { state = state.copy(area = it) },
                saveSchedule = { state = state.copy(schedule = it) },
                setAlert = { key, on -> state = state.copy(alerts = state.alerts + (key to on)) },
                saveBooking = { state = state.copy(booking = it) },
                saveRecall = { state = state.copy(recall = it) },
                saveBot = { state = state.copy(bot = it) },
                setDentistShare = { state = state.copy(dentistShare = it) },
                saveReasons = { state = state.copy(reasons = it) },
                saveSources = { state = state.copy(sources = it) },
                saveBranches = { state = state.copy(branches = it) },
                saveLabs = { state = state.copy(labs = it) },
                saveService = { row ->
                    val list = state.services.toMutableList()
                    val at = list.indexOfFirst { it.id == row.id && row.id.isNotBlank() }
                    if (at >= 0) list[at] = row else list.add(row.copy(id = "new"))
                    state = state.copy(services = list)
                },
                saveStaff = { row ->
                    val list = state.staff.toMutableList()
                    val at = list.indexOfFirst { it.id == row.id && row.id.isNotBlank() }
                    if (at >= 0) list[at] = row else list.add(row.copy(id = "new"))
                    state = state.copy(staff = list)
                },
                rejectRequest = { id -> state = state.copy(requests = state.requests.filterNot { it.id == id }) },
            ),
        )
        return
    }

    val model: SettingsModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    BackHandler { if (state.section != null) model.close() else onBack() }
    SettingsScreen(
        state = state,
        onBack = onBack,
        actions = SettingsActions(
            open = model::open,
            close = model::close,
            saveProfile = model::saveProfile,
            saveArea = model::saveArea,
            saveSchedule = model::saveSchedule,
            setAlert = model::setAlert,
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
