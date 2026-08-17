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
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Schedule
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.ui.Alpha
import com.alphadental.clinic.ui.AlphaCard
import com.alphadental.clinic.ui.AlphaTheme
import com.alphadental.clinic.ui.AddNoteSheet
import com.alphadental.clinic.ui.ClockCard
import com.alphadental.clinic.ui.AppointmentSheet
import com.alphadental.clinic.ui.BookingSheet
import com.alphadental.clinic.ui.DayScreen
import com.alphadental.clinic.ui.FinanceSheet
import com.alphadental.clinic.ui.HomeScreen
import com.alphadental.clinic.ui.InventorySheet
import com.alphadental.clinic.ui.WhatsappQueueSheet
import com.alphadental.clinic.ui.LoginScreen
import com.alphadental.clinic.ui.MoneyScreen
import com.alphadental.clinic.ui.PatientScreen
import com.alphadental.clinic.ui.PatientsScreen
import com.alphadental.clinic.ui.PaymentSheet
import com.alphadental.clinic.ui.HoursSheet
import com.alphadental.clinic.ui.OrthoSheet
import com.alphadental.clinic.ui.PrescriptionSheet
import com.alphadental.clinic.ui.AssistantScreen
import com.alphadental.clinic.ui.ReportsScreen
import com.alphadental.clinic.data.LocationFinder
import com.alphadental.clinic.sms.SmsPrefs
import com.alphadental.clinic.sms.SmsWorker
import com.alphadental.clinic.ui.SectionHeading
import com.alphadental.clinic.ui.SmsSenderCard
import com.alphadental.clinic.ui.ToolTile
import com.alphadental.clinic.ui.rememberPunchAction

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
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
                        canBook = session.isAdmin || session.isDentist || session.role == "Receptionist",
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
                                onOpenMoney = if (session.isAdmin || session.isReception) {
                                    { viewModel.selectTab(Tab.MONEY) }
                                } else null,
                                onOpenReports = if (session.isAdmin || session.isReception) {
                                    { viewModel.openReports() }
                                } else null,
                                onOpenOrtho = viewModel::openOrtho,
                                onOpenInventory = viewModel::openInventory,
                                onOpenWhatsappQueue = viewModel::openWhatsappQueue,
                                onOpenAssistant = { viewModel.openAssistant(context) },
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
                            onAdd = viewModel::openFinanceAdd,
                            onDelete = viewModel::deleteFinanceEntry,
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
                            // Owners and reception only. A dentist seeing the clinic's whole
                            // takings is a different conversation from them seeing their own.
                            onOpenReports = if (session.isAdmin || session.isReception) {
                                { viewModel.openReports() }
                            } else null,
                            onOpenOrtho = viewModel::openOrtho,
                            onOpenAssistant = { viewModel.openAssistant(context) },
                            // Admins only: hours decide what every other member of staff can book.
                            onOpenHours = if (session.isAdmin) ({ viewModel.openHours() }) else null,
                            onToggleLanguage = viewModel::toggleLanguage,
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
                    onAsk = viewModel::askAi,
                    onSpoken = viewModel::aiSpoken,
                    onSettle = viewModel::settlePending,
                    onClose = viewModel::closeAssistant,
                )
            }

            // Assistants can look but not change appointments, matching what the
            // security rules would allow on the write anyway.
            val canEdit = session.isAdmin || session.isDentist || session.role == "Receptionist"

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
                    onDismiss = { openAppointment = null },
                )
            }

            if (state.openPatientId != null) {
                PatientScreen(
                    file = state.patientFile,
                    loading = state.patientLoading,
                    error = state.patientError,
                    arabic = state.arabic,
                    media = state.patientMedia,
                    ortho = state.patientOrtho,
                    // Only roles that may write money see the button. The rules would reject the
                    // write anyway; offering it and failing is worse than not offering it.
                    onTakePayment = if (session.isAdmin || session.isDentist || session.role == "Receptionist") {
                        { viewModel.openPayment() }
                    } else null,
                    notes = state.notes,
                    // Recording treatment is a clinical act, so it is the dentists' and the
                    // owner's — reception can see the record but not write to it.
                    onAddNote = if (session.isAdmin || session.isDentist) {
                        { viewModel.openAddNote() }
                    } else null,
                    prescriptions = state.prescriptions,
                    // Prescribing is a dentist's act, and the owner's if they also treat.
                    onWriteRx = if (session.isAdmin || session.isDentist) {
                        { viewModel.openPrescription() }
                    } else null,
                    onSetNoteStatus = if (session.isAdmin || session.isDentist) {
                        { noteId, status -> viewModel.updateNoteStatus(noteId, status) }
                    } else null,
                    onClose = viewModel::closePatient,
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
                OrthoSheet(
                    cases = state.orthoCases,
                    openCase = state.orthoCase,
                    loading = state.loadingOrtho,
                    saving = state.savingOrtho,
                    canEdit = session.isAdmin || session.isDentist,
                    arabic = state.arabic,
                    onOpenCase = viewModel::openOrthoCase,
                    onLogVisit = viewModel::logOrthoVisit,
                    onSetStatus = viewModel::setOrthoStatus,
                    onDismiss = viewModel::closeOrtho,
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
                    canEdit = session.isAdmin || session.isReception || session.isDentist,
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
    /** Null for roles that may not see the clinic's takings. */
    onOpenReports: (() -> Unit)?,
    onOpenOrtho: () -> Unit,
    onOpenAssistant: () -> Unit,
    /** Null for anyone who is not a clinic admin. */
    onOpenHours: (() -> Unit)?,
    onToggleLanguage: () -> Unit,
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
            ToolSpec(Icons.Filled.Mic, if (arabic) "المساعد" else "Assistant", onClick = onOpenAssistant),
            ToolSpec(Icons.Filled.Timeline, if (arabic) "التقويم" else "Ortho", onClick = onOpenOrtho),
            ToolSpec(
                Icons.Filled.Send, if (arabic) "واتساب" else "WhatsApp",
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
