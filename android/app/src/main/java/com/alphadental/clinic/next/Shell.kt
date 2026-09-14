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

    Box(Modifier.fillMaxSize().background(T.ground)) {

        when (tab) {
            Tab.Today -> TodayTab(preview)
            Tab.Day -> DayTab(preview)
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
private fun TodayTab(preview: Boolean) {
    if (preview) {
        DashboardScreen(state = previewDashboard(), onCheckOut = {})
    } else {
        val model: DashboardModel = viewModel()
        val state by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        DashboardScreen(state = state, onCheckOut = model::checkOut)
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
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        PatientsScreen(
            state = state,
            onSearch = model::search,
            onLoadMore = model::loadMore,
            onOpen = { onOpen(it.id) },
            // Adding a patient is a write; only offer it to someone the server
            // would accept it from.
            onAdd = if (state.who?.can("patients.add") == true) ({ }) else null,
        )
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
        ThreadScreen(state, onBack = model::close, onCall = { context.dial(it) })
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
private fun DayTab(preview: Boolean) {
    if (preview) {
        val state = remember { previewDay() }
        DayScreen(state = state, onShiftDay = {}, onToday = {})
    } else {
        val model: DayModel = viewModel()
        val state by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        DayScreen(state = state, onShiftDay = model::shiftDay, onToday = model::today)
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
        RecordScreen(
            state = state,
            onBack = onBack,
            onTab = { state = state.copy(tab = it) },
            onSelectTooth = { state = state.copy(tooth = it) },
            onTakePayment = {},
        )
        return
    }

    val model: RecordModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(patientId) { model.open(patientId) }
    RecordScreen(
        state = state,
        onBack = onBack,
        onTab = model::show,
        onSelectTooth = model::selectTooth,
        onCall = { context.dial(it) },
        onMessage = { context.whatsapp(it) },
        // A write, so only for someone the server would accept it from.
        onTakePayment = if (state.who?.can("payments.add") == true) ({ }) else null,
    )
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
        MoneyScreen(state, onBack = onBack, onShiftMonth = {}, onThisMonth = {})
        return
    }
    val model: MoneyModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    MoneyScreen(
        state = state,
        onBack = onBack,
        onShiftMonth = model::shiftMonth,
        onThisMonth = model::thisMonth,
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
        LabScreen(state, onBack = onBack, onFilter = { state = state.copy(filter = it) })
        return
    }
    val model: LabModel = viewModel()
    val state by model.state.collectAsState()
    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
    LabScreen(state, onBack = onBack, onFilter = model::show)
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
