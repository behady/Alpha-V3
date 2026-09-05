package com.alphadental.clinic

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.ui.Alpha
import com.alphadental.clinic.ui.AlphaCard
import com.alphadental.clinic.ui.AlphaTheme
import com.alphadental.clinic.ui.AppearanceScreen
import com.alphadental.clinic.ui.AddLeadSheet
import com.alphadental.clinic.ui.AddNoteSheet
import com.alphadental.clinic.ui.ChatsScreen
import com.alphadental.clinic.ui.AttendanceScreen
import com.alphadental.clinic.ui.LabScreen
import com.alphadental.clinic.ui.LeadsScreen
import com.alphadental.clinic.ui.ClockCard
import com.alphadental.clinic.ui.AppointmentSheet
import com.alphadental.clinic.ui.BookingSheet
import com.alphadental.clinic.ui.DayScreen
import com.alphadental.clinic.ui.DocumentActions
import com.alphadental.clinic.ui.FinanceSheet
import com.alphadental.clinic.ui.HomeScreen
import com.alphadental.clinic.ui.InventorySheet
import com.alphadental.clinic.ui.LedgerDetailSheet
import com.alphadental.clinic.ui.WhatsappQueueSheet
import com.alphadental.clinic.ui.LoginScreen
import com.alphadental.clinic.ui.MoneyScreen
import com.alphadental.clinic.ui.PatientScreen
import com.alphadental.clinic.ui.PatientsScreen
import com.alphadental.clinic.ui.PaymentSheet
import com.alphadental.clinic.ui.HoursSheet
import com.alphadental.clinic.ui.OrthoScreen
import com.alphadental.clinic.ui.PrescriptionSheet
import com.alphadental.clinic.ui.AiMemoryScreen
import com.alphadental.clinic.ui.BriefingScreen
import com.alphadental.clinic.ui.AssistantScreen
import com.alphadental.clinic.ui.ReportsScreen
import com.alphadental.clinic.data.LocationFinder
import com.alphadental.clinic.data.Repository
import kotlinx.coroutines.launch
import com.alphadental.clinic.sms.SmsPrefs
import com.alphadental.clinic.sms.SmsWorker
import com.alphadental.clinic.ui.SectionHeading
import com.alphadental.clinic.ui.SmsSenderCard
import com.alphadental.clinic.ui.ToolTile
import com.alphadental.clinic.ui.rememberPunchAction

class MainActivity : ComponentActivity() {

    /** A tapped notification lands here — cold start or already running. */
    private fun takeScreenRequest(intent: android.content.Intent?) {
        if (intent == null) return
        val target = com.alphadental.clinic.push.PushTarget(
            screen = intent.getStringExtra("screen"),
            appointmentId = intent.getStringExtra("appointmentId"),
            patientId = intent.getStringExtra("patientId"),
            chatId = intent.getStringExtra("chatId"),
        )
        if (target.isEmpty) return
        com.alphadental.clinic.push.PushNav.requested.value = target
        // Cleared so a rotation or a return from the background does not replay the
        // same jump the person already made.
        intent.removeExtra("screen")
        intent.removeExtra("appointmentId")
        intent.removeExtra("patientId")
        intent.removeExtra("chatId")
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        takeScreenRequest(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        takeScreenRequest(intent)
        setContent {
            AlphaTheme {
                // Checked before anything that touches Firebase. If startup failed,
                // creating the ViewModel would throw here too and put us straight
                // back to a blank screen with no explanation.
                val failure = AlphaApp.startupError
                if (failure != null) StartupErrorScreen(failure) else AlphaRoot()
            }
        }
    }
}

/**
 * The screen that replaces a blank one.
 *
 * A phone that cannot reach Firebase used to render nothing at all, which tells
 * whoever is holding it precisely nothing and tells whoever has to fix it even
 * less. Showing the real failure text — and the project it was trying to reach —
 * turns "it opens blank" into something answerable without a cable and a laptop.
 */
@Composable
private fun StartupErrorScreen(message: String) {
    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(28.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                "Alpha Dental could not start",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "The app installed correctly, but it could not connect to the clinic database. " +
                    "This is a setup problem in the app itself, not something you did wrong.",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate600,
            )
            Spacer(Modifier.height(20.dp))
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "SHOW THIS TO WHOEVER BUILT THE APP",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate400,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        message,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Danger,
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "project: ${BuildConfig.FB_PROJECT_ID}\napp id: ${BuildConfig.FB_APP_ID}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
            }
        }
    }
}

@Composable
private fun AlphaRoot(viewModel: AppViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbars = remember { SnackbarHostState() }
    var openAppointment by remember { mutableStateOf<Appointment?>(null) }

    // A notification named an appointment; the view model has now read it. Handing
    // it to the same sheet a tap on the day list opens means there is one sheet to
    // maintain rather than a second, thinner one for notifications.
    LaunchedEffect(state.pushAppointment) {
        state.pushAppointment?.let {
            openAppointment = it
            viewModel.pushAppointmentShown()
        }
    }
    // Device-local, not clinic data: it never leaves the phone, so it does not
    // belong in the shared view-model state.
    var appearanceOpen by rememberSaveable { mutableStateOf(false) }
    val assistantScope = rememberCoroutineScope()

    // Once signed in: put this phone on the user's push list, and — on Android 13+ — ask for
    // notification permission the first time. Registration is repeated on every sign-in because
    // FCM rotates tokens and because the same phone may change hands between accounts.
    val notifPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }
    val appContext = LocalContext.current.applicationContext
    LaunchedEffect(state.session?.uid) {
        if (state.session != null) {
            com.alphadental.clinic.push.PushRegistrar.register()
            viewModel.publishWakeAddress(appContext)
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    // Anything that could not be saved surfaces here rather than being swallowed.
    LaunchedEffect(state.message) {
        state.message?.let {
            snackbars.showSnackbar(it)
            viewModel.dismissMessage()
        }
    }

    // Keep the open sheet in step with the live data — if a colleague checks the
    // same patient in from the desk, the buttons here update instead of going stale.
    val selected = openAppointment?.let { current ->
        state.appointments.firstOrNull { it.id == current.id } ?: current
    }

    when {
        state.loading -> SplashScreen()

        state.session == null -> LoginScreen(
            signingIn = state.signingIn,
            error = state.signInError,
            onSignIn = viewModel::signIn,
            onGoogleToken = viewModel::signInWithGoogle,
        )

        else -> {
            val session = state.session!!
            val context = LocalContext.current

            // Navigation the notification asked for, honoured once a session
            // exists — a cold start parks the request here until sign-in settles.
            // Fetched once per sign-in, in the background, for the roles that chase
            // money. Nothing waits on it — the dashboard is complete without it and
            // simply grows a line when it lands.
            LaunchedEffect(session.uid) { viewModel.refreshBriefing() }

            LaunchedEffect(session.uid) {
                com.alphadental.clinic.push.PushNav.requested.collect { target ->
                    if (target != null) {
                        com.alphadental.clinic.push.PushNav.requested.value = null
                        // The record the notification is about wins over the screen it
                        // lives on: "Dina booked 09:00" should open Dina's booking, not
                        // drop you on a day list to find her yourself.
                        when {
                            // A hand-off is about a conversation: land on it, not on the
                            // patient's file with the chat still to be found. Roles that may
                            // not read the clinic's WhatsApp fall through to the record.
                            target.chatId != null && viewModel.canSeeChats(session) -> viewModel.openChat(target.chatId)
                            target.appointmentId != null -> viewModel.openAppointmentById(target.appointmentId)
                            target.patientId != null -> viewModel.openPatient(target.patientId)
                            else -> when (target.screen) {
                                "day" -> viewModel.selectTab(Tab.DAY)
                                "money" -> if (session.can("access.finance")) viewModel.selectTab(Tab.MONEY)
                                "leads" -> if (session.can("access.marketing")) viewModel.openLeads()
                                "patients" -> viewModel.selectTab(Tab.PATIENTS)
                                "chats" -> if (viewModel.canSeeChats(session)) viewModel.openChats()
                                "inventory" -> viewModel.openInventory()
                                // The website has screens this app does not. Landing on
                                // the day is a better answer than a tap that does nothing.
                                "marketing", "reviews" -> viewModel.selectTab(Tab.DAY)
                            }
                        }
                    }
                }
            }

            Scaffold(
                containerColor = Alpha.Ground,
                snackbarHost = { SnackbarHost(snackbars) },
                bottomBar = {
                    // A floating pill instead of the full-width system bar, with Book as
                    // the big round button in the middle — the action the clinic performs
                    // all day sits where a thumb naturally lands. Money left the bar and
                    // lives as a dashboard shortcut instead, for the roles that see it.
                    AlphaBottomBar(
                        current = state.tab,
                        arabic = state.arabic,
                        // Only for people allowed to write. A button that opens a form
                        // the server will reject is worse than no button.
                        // The granted permission, not a guess from the role. An
                        // Assistant ticked for "Book appointments" could not book,
                        // because the old test matched "Receptionist" exactly and
                        // Assistant is a different word for the same desk.
                        canBook = session.can("appointments.add"),
                        onSelect = viewModel::selectTab,
                        onBook = { viewModel.openBooking() },
                    )
                },
            ) { padding ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    when (state.tab) {
                        Tab.HOME -> {
                            val punch = rememberPunchAction { viewModel.punchClock(context) }
                            HomeScreen(
                                session = session,
                                appointments = state.appointments,
                                offline = state.offline,
                                pending = state.pending,
                                arabic = state.arabic,
                                takingsToday = state.takingsToday,
                                whatsappWaiting = state.whatsappQueue.size,
                                onShift = state.openShift != null,
                                shiftSince = state.openShift?.checkInMillis ?: 0L,
                                clocking = state.clocking,
                                clockError = state.clockError,
                                onPunch = punch,
                                onDismissClockError = viewModel::dismissClockError,
                                onOpenAppointment = { openAppointment = it },
                                onSeeDay = { viewModel.selectTab(Tab.DAY) },
                                onOpenPatients = { viewModel.selectTab(Tab.PATIENTS) },
                                onOpenMoney = if (session.can("access.finance")) {
                                    { viewModel.selectTab(Tab.MONEY) }
                                } else null,
                                onOpenReports = if (session.can("access.reports")) {
                                    { viewModel.openReports() }
                                } else null,
                                onOpenOrtho = viewModel::openOrtho,
                                onOpenInventory = viewModel::openInventory,
                                onOpenWhatsappQueue = viewModel::openWhatsappQueue,
                                chatsWaiting = state.chatsWaiting,
                                onOpenChats = if (viewModel.canSeeChats(session)) {
                                    { viewModel.openChats() }
                                } else null,
                                onOpenLab = if (session.can("access.lab")) ({ viewModel.openLab() }) else null,
                                onOpenAttendance = if (viewModel.canSeeAttendance(session)) ({ viewModel.openAttendance() }) else null,
                                onOpenAssistant = { viewModel.openAssistant(context) },
                                briefing = state.briefing,
                                onOpenBriefing = viewModel::openBriefing,
                                refreshing = state.homeRefreshing,
                                onRefresh = viewModel::refreshHome,
                                onOpenLeads = if (session.can("access.marketing")) {
                                    { viewModel.openLeads() }
                                } else null,
                            )
                        }

                        Tab.DAY -> DayScreen(
                            date = state.date,
                            appointments = state.appointments,
                            loading = state.loadingDay,
                            offline = state.offline,
                            pending = state.pending,
                            arabic = state.arabic,
                            isToday = state.date == AppViewModel.today(),
                            onShiftDay = viewModel::shiftDay,
                            onToday = viewModel::showToday,
                            onOpenAppointment = { openAppointment = it },
                        )

                        Tab.PATIENTS -> PatientsScreen(
                            results = state.patientResults,
                            searching = state.patientSearching,
                            loadingMore = state.patientLoadingMore,
                            hasMore = state.patientHasMore,
                            offline = state.offline,
                            arabic = state.arabic,
                            onSearch = viewModel::searchPatientsTab,
                            onLoadMore = viewModel::loadMorePatients,
                            onOpenPatient = { viewModel.openPatient(it.id) },
                            error = state.patientsError,
                            onRefresh = viewModel::refreshPatients,
                        )

                        Tab.MONEY -> MoneyScreen(
                            view = state.financeView,
                            anchor = state.financeAnchor,
                            rows = state.financeRows,
                            loading = state.loadingFinance,
                            arabic = state.arabic,
                            isCurrentPeriod = if (state.financeView == "month") {
                                state.financeAnchor.take(7) == AppViewModel.today().take(7)
                            } else {
                                state.financeAnchor == AppViewModel.today()
                            },
                            onSetView = viewModel::setFinanceView,
                            onShift = viewModel::shiftFinance,
                            onToday = viewModel::financeToday,
                            error = state.financeError,
                            onRefresh = viewModel::loadFinance,
                            onAdd = viewModel::openFinanceAdd,
                            onDelete = viewModel::deleteFinanceEntry,
                            onOpenRow = { row ->
                                viewModel.openLedgerDetail(
                                    entry = com.alphadental.clinic.data.PatientLedgerEntry(
                                        id = row.id,
                                        date = row.date,
                                        type = row.type,
                                        description = row.description,
                                        amount = row.cash,
                                        addedBy = row.addedBy,
                                        createdAtMillis = row.createdAtMillis,
                                        procedureId = row.procedureId,
                                        method = row.method,
                                        doctorName = row.doctorName,
                                        labFee = row.labFee,
                                        commission = row.commission,
                                    ),
                                    patientId = row.patientId,
                                    patientName = row.patientName,
                                )
                            },
                        )

                        Tab.MORE -> MoreScreen(
                            name = session.name,
                            email = session.email,
                            role = session.role,
                            arabic = state.arabic,
                            onShift = state.openShift != null,
                            shiftSince = state.openShift?.checkInMillis ?: 0L,
                            clocking = state.clocking,
                            clockError = state.clockError,
                            onPunch = { viewModel.punchClock(context) },
                            onDismissClockError = viewModel::dismissClockError,
                            onOpenInventory = viewModel::openInventory,
                            whatsappWaiting = state.whatsappQueue.size,
                            onOpenWhatsappQueue = viewModel::openWhatsappQueue,
                            chatsWaiting = state.chatsWaiting,
                            // The same key the website's Chats page is gated on.
                            onOpenChats = if (viewModel.canSeeChats(session)) {
                                { viewModel.openChats() }
                            } else null,
                            // The same key the website's Lab page is gated on; the rules enforce it too.
                            onOpenLab = if (session.can("access.lab")) ({ viewModel.openLab() }) else null,
                            // The website's Team Overview gate: admins, or a granted key.
                            onOpenAttendance = if (viewModel.canSeeAttendance(session)) ({ viewModel.openAttendance() }) else null,
                            // Owners and reception only. A dentist seeing the clinic's whole
                            // takings is a different conversation from them seeing their own.
                            onOpenReports = if (session.can("access.reports")) {
                                { viewModel.openReports() }
                            } else null,
                            onOpenLeads = if (session.can("access.marketing")) {
                                { viewModel.openLeads() }
                            } else null,
                            onOpenOrtho = viewModel::openOrtho,
                            onOpenAssistant = { viewModel.openAssistant(context) },
                            // Admins only: hours decide what every other member of staff can book.
                            onOpenHours = if (session.isAdmin) ({ viewModel.openHours() }) else null,
                            onToggleLanguage = viewModel::toggleLanguage,
                            onOpenAppearance = { appearanceOpen = true },
                            onOpenAiMemory = viewModel::openAiMemory,
                            onSignOut = viewModel::signOut,
                        )
                    }

                }
            }

            // The assistant as a full page over everything, opened from the
            // dashboard or More-tab shortcut — the floating bubble is gone.
            if (state.aiOpen) {
                AssistantScreen(
                    messages = state.aiMessages,
                    thinking = state.aiThinking,
                    pending = state.aiPending,
                    speak = state.aiSpeak,
                    arabic = state.arabic,
                    actingOn = state.aiAppointmentId?.let { state.aiAppointmentLabel },
                    onClearActingOn = viewModel::clearAiAppointment,
                    role = session.role,
                    onOpenAppointment = { appointmentId ->
                        // Today's list already holds it when it is today's; anything
                        // else is read once. The sheet floats above the chat, so the
                        // conversation is exactly where it was on dismiss.
                        state.appointments.firstOrNull { it.id == appointmentId }
                            ?.let { openAppointment = it }
                            ?: assistantScope.launch {
                                runCatching { Repository.loadAppointment(session.clinicId, appointmentId) }
                                    .getOrNull()
                                    ?.let { openAppointment = it }
                            }
                    },
                    onAsk = viewModel::askAi,
                    onSpoken = viewModel::aiSpoken,
                    onSettle = viewModel::settlePending,
                    onCancel = viewModel::cancelAi,
                    onClose = viewModel::closeAssistant,
                )
            }

            // Assistants can look but not change appointments, matching what the
            // security rules would allow on the write anyway.
            val canEdit = session.can("appointments.edit")

            if (selected != null) {
                AppointmentSheet(
                    appointment = selected,
                    arabic = state.arabic,
                    canEdit = canEdit,
                    onSetStatus = { next ->
                        viewModel.setStatus(selected, next)
                        openAppointment = null
                    },
                    onReschedule = {
                        openAppointment = null
                        viewModel.openBooking(moving = selected)
                    },
                    onOpenPatient = {
                        openAppointment = null
                        viewModel.openPatient(selected.patientId)
                    },
                    // Same roles the patient file offers it to, and only once the
                    // visit belongs to a file — a walk-in with no record has no
                    // ledger to pay into.
                    onTakePayment = if (
                        selected.patientId.isNotBlank() && session.can("finance.add")
                    ) {
                        {
                            openAppointment = null
                            viewModel.openPaymentForPatient(selected.patientId)
                        }
                    } else null,
                    onDismiss = { openAppointment = null },
                )
            }

            // The owner's roster: who is in, who is late, and the period's hours.
            if (state.attendanceOpen) {
                AttendanceScreen(
                    roster = com.alphadental.clinic.data.Attendance.roster(state.attendanceStaff, state.attendancePunches),
                    rosterLoaded = state.attendanceLoaded,
                    rosterError = state.attendanceError,
                    payroll = state.attendancePayroll,
                    payrollLoading = state.attendancePayrollLoading,
                    payrollError = state.attendancePayrollError,
                    range = state.attendanceRange,
                    showPay = session.can("access.finance"),
                    arabic = state.arabic,
                    onRange = viewModel::setAttendanceRange,
                    onRefresh = viewModel::refreshAttendance,
                    onClose = viewModel::closeAttendance,
                )
            }

            // Lab tracking: where every case is, and the stage button. Before the patient file
            // for the same reason as the chats below: a file opened from a case sits over it.
            if (state.labOpen) {
                LabScreen(
                    cases = state.labCases,
                    loaded = state.labLoaded,
                    error = state.labError,
                    openCaseId = state.labOpenCaseId,
                    busyId = state.labBusyId,
                    arrived = state.labArrived,
                    arabic = state.arabic,
                    onOpenCase = viewModel::openLabCase,
                    onCloseCase = viewModel::closeLabCase,
                    onAdvance = viewModel::advanceLabCase,
                    onDismissArrived = viewModel::dismissLabArrived,
                    onOpenPatient = { id ->
                        viewModel.closeLabCase()
                        viewModel.openPatient(id)
                    },
                    onRetry = viewModel::retryLab,
                    onClose = viewModel::closeLab,
                )
            }

            // The clinic's WhatsApp: the threads the server keeps, read and answered here.
            // Before the patient file on purpose: later in this list draws on top, and a file
            // opened from a thread has to sit over it, not under it.
            if (state.chatsOpen) {
                ChatsScreen(
                    chats = state.chats,
                    loaded = state.chatsLoaded,
                    openChatId = state.openChatId,
                    lines = state.chatLines,
                    linesLoading = state.chatLinesLoading,
                    sending = state.chatSending,
                    error = state.chatError,
                    notice = state.chatNotice,
                    claimMs = state.chatClaimMs,
                    myUid = session.uid,
                    arabic = state.arabic,
                    onOpenChat = viewModel::openChat,
                    onCloseChat = viewModel::closeChat,
                    onSend = viewModel::sendChatReply,
                    onSendFollowup = viewModel::sendChatFollowup,
                    onToggleBot = viewModel::toggleChatBot,
                    onToggleAssign = viewModel::toggleChatAssign,
                    onSetArchived = viewModel::setChatArchived,
                    onDismissNotice = viewModel::dismissChatNotice,
                    draft = state.chatDraft,
                    quickReplies = state.quickReplies,
                    onSendFile = viewModel::sendChatFile,
                    onAddQuickReply = viewModel::addQuickReply,
                    // The file opens over the thread; closing it lands back on the chat.
                    onOpenPatient = { id -> viewModel.openPatient(id) },
                    onClose = viewModel::closeChats,
                )
            }

            if (state.openPatientId != null) {
                PatientScreen(
                    file = state.patientFile,
                    loading = state.patientLoading,
                    error = state.patientError,
                    onRetry = viewModel::retryPatient,
                    refreshing = state.patientRefreshing,
                    onRefresh = viewModel::refreshPatient,
                    arabic = state.arabic,
                    media = state.patientMedia,
                    ortho = state.patientOrtho,
                    // Only roles that may write money see the button. The rules would reject the
                    // write anyway; offering it and failing is worse than not offering it.
                    onTakePayment = if (session.can("finance.add")) {
                        { viewModel.openPayment() }
                    } else null,
                    notes = state.notes,
                    // Recording treatment is a clinical act, so it is the dentists' and the
                    // owner's — reception can see the record but not write to it.
                    onAddNote = if (session.can("clinical.edit")) {
                        { viewModel.openAddNote() }
                    } else null,
                    prescriptions = state.prescriptions,
                    // Prescribing is a dentist's act, and the owner's if they also treat.
                    onWriteRx = if (session.can("clinical.edit")) {
                        { viewModel.openPrescription() }
                    } else null,
                    onSetNoteStatus = if (session.can("clinical.edit")) {
                        { noteId, status -> viewModel.updateNoteStatus(noteId, status) }
                    } else null,
                    rxBusy = state.rxBusy,
                    onPrintRx = { rx ->
                        viewModel.prescriptionPdf(context, rx) { file ->
                            DocumentActions.print(context, file, "Prescription")
                        }
                    },
                    onSendRx = { rx -> viewModel.sendPrescriptionWhatsapp(context, rx) },
                    onShareRx = { rx ->
                        viewModel.prescriptionPdf(context, rx) { file ->
                            DocumentActions.shareToWhatsapp(context, file, "Prescription")
                        }
                    },
                    // Charting a tooth is a clinical act: dentists and the owner.
                    onSaveDiagnosis = if (session.can("clinical.edit")) {
                        viewModel::saveToothDiagnosis
                    } else null,
                    savingDiagnosis = state.savingDiagnosis,
                    onStartOrtho = if (session.can("clinical.edit")) {
                        viewModel::startOrthoCase
                    } else null,
                    onOpenOrthoCase = { case ->
                        viewModel.closePatient()
                        viewModel.openOrtho(case)
                    },
                    onOpenLedgerEntry = { entry ->
                        viewModel.openLedgerDetail(
                            entry = entry,
                            patientName = state.patientFile?.patient?.name.orEmpty(),
                            // The statement is already in memory, so the treatment's
                            // payments are assembled from it rather than read again.
                            known = state.patientFile?.ledger.orEmpty(),
                        )
                    },
                    uploadingPhoto = state.uploadingPhoto,
                    // Any core role may add photos — reception files x-rays as often as dentists do.
                    onUploadPhoto = if (session.can("patients.edit")) {
                        viewModel::uploadPatientPhoto
                    } else null,
                    onMessage = if (viewModel.canSeeChats(session)) ({ viewModel.startChatWithOpenPatient() }) else null,
                    onClose = viewModel::closePatient,
                )
            }

            // The CRM inbox, full page. Admin and reception, matching the website.
            if (appearanceOpen) {
                AppearanceScreen(arabic = state.arabic, onClose = { appearanceOpen = false })
            }

            // What the assistant has taught itself about this clinic, and a way to
            // make it forget something that is no longer true.
            // Today at a glance: the shape of the day, then the balances
            // nobody has chased.
            if (state.briefingOpen) {
                BriefingScreen(
                    briefing = state.briefing,
                    loading = state.loadingBriefing,
                    error = state.briefingError,
                    arabic = state.arabic,
                    onOpenPatient = { id ->
                        viewModel.closeBriefing()
                        viewModel.openPatient(id)
                    },
                    onClose = viewModel::closeBriefing,
                )
            }

            if (state.aiMemoryOpen) {
                AiMemoryScreen(
                    facts = state.aiFacts,
                    loading = state.loadingAiFacts,
                    error = state.aiFactsError,
                    arabic = state.arabic,
                    onForget = viewModel::forgetAiFact,
                    onClose = viewModel::closeAiMemory,
                )
            }

            if (state.leadsOpen) {
                LeadsScreen(
                    leads = state.leads,
                    loading = state.loadingLeads,
                    error = state.leadsError,
                    onRefresh = viewModel::refreshLeads,
                    arabic = state.arabic,
                    onSetStage = viewModel::setLeadStage,
                    // Creating a patient file, so the same roles the register lets
                    // add one. The rules would refuse the write anyway; offering a
                    // button that fails is worse than not offering it.
                    onConvert = if (session.can("patients.add")) {
                        viewModel::convertLead
                    } else null,
                    convertingLeadId = state.convertingLeadId,
                    onAdd = viewModel::openLeadAdd,
                    onClose = viewModel::closeLeads,
                )
            }

            if (state.leadAddOpen) {
                AddLeadSheet(
                    saving = state.savingLead,
                    arabic = state.arabic,
                    onSave = viewModel::saveLead,
                    onDismiss = viewModel::closeLeadAdd,
                )
            }

            state.ledgerDetail?.let { entry ->
                LedgerDetailSheet(
                    entry = entry,
                    patientName = state.ledgerDetailPatientName,
                    history = state.ledgerDetailHistory,
                    loading = state.loadingLedgerDetail,
                    arabic = state.arabic,
                    // Only offered when there is somewhere else to go: on the patient's
                    // own page it would reopen the page you are already looking at.
                    onOpenPatient = state.ledgerDetailPatientId
                        .takeIf { it.isNotBlank() && it != state.openPatientId }
                        ?.let { id ->
                            {
                                viewModel.closeLedgerDetail()
                                viewModel.openPatient(id)
                            }
                        },
                    onDismiss = viewModel::closeLedgerDetail,
                )
            }

            if (state.financeAddOpen) {
                FinanceSheet(
                    defaultDate = if (state.financeView == "day") state.financeAnchor else AppViewModel.today(),
                    saving = state.savingFinance,
                    arabic = state.arabic,
                    onSave = viewModel::saveFinanceEntry,
                    onDismiss = viewModel::closeFinanceAdd,
                )
            }

            if (state.hoursOpen) {
                HoursSheet(
                    schedule = state.schedule,
                    saving = state.savingHours,
                    arabic = state.arabic,
                    onSave = viewModel::saveHours,
                    onDismiss = viewModel::closeHours,
                )
            }

            if (state.orthoOpen) {
                OrthoScreen(
                    cases = state.orthoCases,
                    openCase = state.orthoCase,
                    loading = state.loadingOrtho,
                    error = state.orthoError,
                    onRefresh = viewModel::refreshOrtho,
                    saving = state.savingOrtho,
                    canEdit = session.can("clinical.edit"),
                    arabic = state.arabic,
                    onOpenCase = viewModel::openOrthoCase,
                    onLogVisit = viewModel::logOrthoVisit,
                    onReviseVisit = viewModel::reviseOrthoVisit,
                    onSaveDetails = viewModel::saveOrthoDetails,
                    onSetStatus = viewModel::setOrthoStatus,
                    onOpenPatient = { id ->
                        viewModel.closeOrtho()
                        viewModel.openPatient(id)
                    },
                    onClose = viewModel::closeOrtho,
                )
            }

            if (state.reportsOpen) {
                ReportsScreen(
                    range = state.reportRange,
                    rangeLabel = state.reportRangeLabel,
                    summary = state.reportSummary,
                    sources = state.reportSources,
                    newPatients = state.reportNewPatients,
                    loading = state.loadingReport,
                    error = state.reportError,
                    onRefresh = viewModel::refreshReport,
                    arabic = state.arabic,
                    onRange = viewModel::setReportRange,
                    onClose = viewModel::closeReports,
                )
            }

            if (state.whatsappQueueOpen) {
                WhatsappQueueSheet(
                    queue = state.whatsappQueue,
                    arabic = state.arabic,
                    onSend = { viewModel.markWhatsappSent(it, SmsPrefs.deviceId(context)) },
                    onDismiss = viewModel::closeWhatsappQueue,
                )
            }

            if (state.inventoryOpen) {
                InventorySheet(
                    items = state.inventory,
                    loading = state.loadingInventory,
                    error = state.inventoryError,
                    onRetry = viewModel::refreshInventory,
                    canEdit = session.can("appointments.edit"),
                    arabic = state.arabic,
                    onAdjust = viewModel::adjustStock,
                    onDismiss = viewModel::closeInventory,
                )
            }

            if (state.rxOpen && state.patientFile != null) {
                PrescriptionSheet(
                    patientName = state.patientFile!!.patient.name,
                    doctors = state.doctors,
                    shortcuts = state.drugShortcuts,
                    saving = state.savingRx,
                    arabic = state.arabic,
                    onSave = viewModel::savePrescription,
                    onDismiss = viewModel::closePrescription,
                )
            }

            if (state.addNoteOpen && state.patientFile != null) {
                AddNoteSheet(
                    patientName = state.patientFile!!.patient.name,
                    services = state.services,
                    doctors = state.doctors,
                    saving = state.savingNote,
                    arabic = state.arabic,
                    onSave = viewModel::saveNote,
                    onDismiss = viewModel::closeAddNote,
                )
            }

            if (state.paymentOpen && state.patientFile != null) {
                PaymentSheet(
                    patientName = state.patientFile!!.patient.name,
                    outstanding = state.outstanding,
                    owed = state.patientFile!!.balance.owed,
                    loading = state.loadingOutstanding,
                    saving = state.savingPayment,
                    arabic = state.arabic,
                    onSave = viewModel::recordPayment,
                    onDismiss = viewModel::closePayment,
                )
            }

            if (state.booking != null) {
                BookingSheet(
                    dateLabel = prettyDay(state.date, state.arabic),
                    slots = viewModel.slots(),
                    doctors = state.doctors,
                    visitReasons = state.visitReasons,
                    services = state.services,
                    searchResults = state.searchResults,
                    searching = state.searching,
                    saving = state.saving,
                    scheduleConfigured = state.schedule.isConfigured,
                    isOffDay = state.schedule.isOffDay(state.date),
                    editing = state.booking?.moving,
                    arabic = state.arabic,
                    onSearch = viewModel::searchPatients,
                    onSave = viewModel::saveBooking,
                    onDismiss = viewModel::closeBooking,
                )
            }
        }
    }
}

@Composable
private fun SplashScreen() {
    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Box(contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
        }
    }
}

/**
 * The floating pill navigation bar, with Book as the raised circle in the middle.
 *
 * Four destinations around one action. The Money screen is deliberately not a
 * tab any more — it opens from the dashboard shortcut for the roles that see it,
 * which keeps the bar simple enough to leave room for the Book button.
 */
@Composable
private fun AlphaBottomBar(
    current: Tab,
    arabic: Boolean,
    canBook: Boolean,
    onSelect: (Tab) -> Unit,
    onBook: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp, top = 4.dp)
    ) {
        Surface(
            shape = Alpha.PillShape,
            color = Alpha.Card,
            border = if (Alpha.dark) BorderStroke(1.dp, Alpha.Slate100) else null,
            shadowElevation = if (Alpha.dark) 0.dp else 6.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(horizontal = 6.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                NavItem(Icons.Filled.Home, if (arabic) "الرئيسية" else "Home", current == Tab.HOME, Modifier.weight(1f)) { onSelect(Tab.HOME) }
                NavItem(Icons.Filled.CalendarMonth, if (arabic) "اليوم" else "Day", current == Tab.DAY, Modifier.weight(1f)) { onSelect(Tab.DAY) }
                if (canBook) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        Surface(
                            onClick = onBook,
                            shape = CircleShape,
                            color = Alpha.Ink,
                            shadowElevation = if (Alpha.dark) 0.dp else 4.dp,
                        ) {
                            Box(Modifier.size(50.dp), contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Filled.Add,
                                    contentDescription = if (arabic) "حجز" else "Book",
                                    tint = Color.White,
                                    modifier = Modifier.size(26.dp),
                                )
                            }
                        }
                    }
                }
                NavItem(Icons.Filled.People, if (arabic) "المرضى" else "Patients", current == Tab.PATIENTS, Modifier.weight(1f)) { onSelect(Tab.PATIENTS) }
                NavItem(Icons.Filled.MoreHoriz, if (arabic) "المزيد" else "More", current == Tab.MORE, Modifier.weight(1f)) { onSelect(Tab.MORE) }
            }
        }
    }
}

@Composable
private fun NavItem(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val tint = if (selected) Alpha.Ink else Alpha.Slate400
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .clip(Alpha.CardShape)
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(3.dp))
        Text(
            label,
            fontSize = 10.5.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            color = tint,
        )
    }
}

/**
 * Account, language, and the way through to everything not yet native.
 *
 * "Open full system" launches a Chrome Custom Tab, not an embedded browser. That
 * distinction is the whole reason the long tail can stay on the website: in a real
 * browser tab, Google sign-in works, downloads land in Downloads, and printing
 * works — none of which was true inside the old app.
 */
@Composable
private fun MoreScreen(
    name: String,
    email: String,
    role: String,
    arabic: Boolean,
    onShift: Boolean,
    shiftSince: Long,
    clocking: Boolean,
    clockError: String?,
    onPunch: () -> Unit,
    onDismissClockError: () -> Unit,
    onOpenInventory: () -> Unit,
    whatsappWaiting: Int,
    onOpenWhatsappQueue: () -> Unit,
    /** Threads waiting for a person. Null opener for roles that may not read the clinic's WhatsApp. */
    chatsWaiting: Int,
    onOpenChats: (() -> Unit)?,
    /** Null for roles without access.lab. */
    onOpenLab: (() -> Unit)?,
    /** The team's roster and hours. Null for anyone who is not an admin or granted the key. */
    onOpenAttendance: (() -> Unit)?,
    /** Null for roles that may not see the clinic's takings. */
    onOpenReports: (() -> Unit)?,
    /** Null for roles that do not work the CRM inbox. */
    onOpenLeads: (() -> Unit)?,
    onOpenOrtho: () -> Unit,
    onOpenAssistant: () -> Unit,
    /** Null for anyone who is not a clinic admin. */
    onOpenHours: (() -> Unit)?,
    onToggleLanguage: () -> Unit,
    onOpenAppearance: () -> Unit,
    /** The list of rules the assistant has taught itself about this clinic. */
    onOpenAiMemory: () -> Unit,
    onSignOut: () -> Unit,
) {
    val context = LocalContext.current
    var isSender by remember { mutableStateOf(SmsPrefs.isSender(context)) }

    // Location is asked for at the moment someone taps the clock, not at launch, and only because
    // their clinic checks they are on site. Whatever they answer, the punch still runs — a refusal
    // then comes back as a plain explanation rather than a silent no-op.
    val locationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { onPunch() }

    val punchWithPermission: () -> Unit = {
        if (LocationFinder.hasPermission(context)) {
            onPunch()
        } else {
            locationPermission.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        }
    }

    // Turning the sender on is the only thing in this app that asks for a permission, so the
    // request is tied directly to the switch rather than fired at launch. Refusing it leaves the
    // switch off, because a phone listed as the sender that cannot send is worse than no phone.
    val smsPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            SmsPrefs.setSender(context, true)
            isSender = true
            SmsWorker.schedule(context)
            SmsWorker.runNow(context)
        }
    }

    // Scrollable, which it was not. This screen held three rows when it was written and holds a
    // dozen now — clock, assistant, reports, ortho, WhatsApp, stock, hours, language, sign out —
    // so everything past the fold, sign out included, was simply unreachable. Bottom padding
    // clears the navigation bar, which would otherwise sit on top of the last row.
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AlphaCard(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp)) {
                Text(name, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate900)
                Text(email, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
                Spacer(Modifier.height(6.dp))
                Text(role, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Green)

                // A role the app does not recognise passes every gate as "no", so the
                // dashboard quietly arrives with its tools stripped out and nothing
                // says why. Naming it here is the difference between a five-minute
                // fix in Settings and an afternoon of guessing.
                if (role !in RECOGNISED_ROLES) {
                    Spacer(Modifier.height(10.dp))
                    Surface(shape = Alpha.CardShape, color = Alpha.WarnBg, modifier = Modifier.fillMaxWidth()) {
                        Text(
                            if (arabic) {
                                "الدور \"$role\" غير معروف للتطبيق، لذلك أغلبية الأدوات مخفية. " +
                                    "صحّح الدور من إعدادات المستخدمين على الموقع."
                            } else {
                                "The app does not recognise the role \"$role\", so most tools are " +
                                    "hidden. Fix this account's role in Settings → Users on the website."
                            },
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.WarnText,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
            }
        }

        SectionHeading(if (arabic) "الحضور" else "ATTENDANCE")

        ClockCard(
            onShift = onShift,
            since = shiftSince,
            busy = clocking,
            error = clockError,
            arabic = arabic,
            onPunch = punchWithPermission,
            onDismissError = onDismissClockError,
        )

        SectionHeading(if (arabic) "الرسائل النصية" else "TEXT MESSAGES")

        SmsSenderCard(
            enabled = isSender,
            arabic = arabic,
            lastResult = SmsPrefs.lastResult(context),
            lastRunAt = SmsPrefs.lastRunAt(context),
            sentTotal = SmsPrefs.sentTotal(context),
            onToggle = { wanted ->
                if (!wanted) {
                    SmsPrefs.setSender(context, false)
                    isSender = false
                    SmsWorker.cancel(context)
                } else if (SmsWorker.hasSmsPermission(context)) {
                    SmsPrefs.setSender(context, true)
                    isSender = true
                    SmsWorker.schedule(context)
                    SmsWorker.runNow(context)
                } else {
                    smsPermission.launch(Manifest.permission.SEND_SMS)
                }
            },
        )

        SectionHeading(if (arabic) "الأدوات" else "TOOLS")

        // A grid, not a list: every tool visible at once with no scrolling hunt.
        // The WhatsApp tile is always present, even at zero — a tile that only
        // appears when there is work is a tile nobody learns is there.
        val tools = listOfNotNull(
            onOpenLeads?.let { ToolSpec(Icons.Filled.PersonSearch, if (arabic) "عملاء" else "Leads", onClick = it) },
            ToolSpec(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
            ToolSpec(Icons.Filled.Timeline, if (arabic) "التقويم" else "Ortho", onClick = onOpenOrtho),
            onOpenChats?.let {
                ToolSpec(Icons.AutoMirrored.Filled.Chat, if (arabic) "المحادثات" else "Chats", badge = chatsWaiting, onClick = it)
            },
            onOpenLab?.let { ToolSpec(Icons.Filled.Science, if (arabic) "المعمل" else "Lab", onClick = it) },
            onOpenAttendance?.let { ToolSpec(Icons.Filled.Groups, if (arabic) "الحضور" else "Attendance", onClick = it) },
            ToolSpec(
                Icons.Filled.Send, if (arabic) "قائمة الإرسال" else "Send list",
                badge = whatsappWaiting, onClick = onOpenWhatsappQueue,
            ),
            onOpenReports?.let { ToolSpec(Icons.Filled.BarChart, if (arabic) "التقارير" else "Reports", onClick = it) },
            ToolSpec(Icons.Filled.Inventory2, if (arabic) "المخزون" else "Stock", onClick = onOpenInventory),
            onOpenHours?.let { ToolSpec(Icons.Filled.Schedule, if (arabic) "الساعات" else "Hours", onClick = it) },
            ToolSpec(Icons.Filled.OpenInNew, if (arabic) "الموقع" else "Website") {
                runCatching {
                    CustomTabsIntent.Builder()
                        .setShowTitle(true)
                        .build()
                        .launchUrl(context, BuildConfig.WEB_URL.toUri())
                }
            },
        )
        tools.chunked(4).forEach { rowTools ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                rowTools.forEach { tool ->
                    ToolTile(
                        icon = tool.icon,
                        label = tool.label,
                        badge = tool.badge,
                        modifier = Modifier.weight(1f),
                        onClick = tool.onClick,
                    )
                }
                repeat(4 - rowTools.size) { Spacer(Modifier.weight(1f)) }
            }
        }

        SectionHeading(if (arabic) "الإعدادات" else "SETTINGS")

        MoreRow(
            icon = Icons.Filled.Palette,
            label = if (arabic) "المظهر" else "Appearance",
            caption = if (arabic) "الألوان والوضع الليلي" else "Colours and night mode",
            onClick = onOpenAppearance,
        )

        MoreRow(
            icon = Icons.Filled.Psychology,
            label = if (arabic) "ما تعلّمه المساعد" else "What Alpha has learned",
            caption = if (arabic) "راجع القواعد التي حفظها" else "Review the rules it has saved",
            onClick = onOpenAiMemory,
        )

        MoreRow(
            icon = Icons.Filled.Language,
            label = if (arabic) "English" else "العربية",
            caption = if (arabic) "تغيير لغة التطبيق" else "Change the app's language",
            onClick = onToggleLanguage,
        )

        MoreRow(
            icon = Icons.Filled.Logout,
            label = if (arabic) "تسجيل الخروج" else "Sign out",
            caption = email,
            tint = Alpha.Danger,
            onClick = onSignOut,
        )
    }
}

/** The roles every gate in the app is written against. */
private val RECOGNISED_ROLES = setOf("Owner", "Admin", "Dentist", "Receptionist", "Assistant")

private class ToolSpec(
    val icon: ImageVector,
    val label: String,
    val badge: Int = 0,
    val onClick: () -> Unit,
)

@Composable
private fun MoreRow(
    icon: ImageVector,
    label: String,
    caption: String,
    tint: Color = Alpha.Slate700,
    onClick: () -> Unit,
) {
    // The icon sits in its own soft circle so the rows scan as a settings list,
    // and the label stays in text colour — only the icon carries the tint.
    AlphaCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = Alpha.CardShape,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(if (tint == Alpha.Slate700) Alpha.Slate100 else tint.copy(alpha = if (Alpha.dark) .22f else .12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(19.dp))
            }
            Spacer(Modifier.size(13.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    label,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (tint == Alpha.Danger) tint else Alpha.Slate900,
                )
                Text(caption, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = Alpha.Slate300,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** "Tue, 12 Aug" — the same shape the Day screen header uses. */
private fun prettyDay(dateKey: String, arabic: Boolean): String {
    val locale = if (arabic) java.util.Locale("ar", "EG") else java.util.Locale.US
    return java.text.SimpleDateFormat("EEE, d MMM", locale).format(AppViewModel.parseDate(dateKey))
}
