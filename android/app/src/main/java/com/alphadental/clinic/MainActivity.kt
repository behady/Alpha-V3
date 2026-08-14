package com.alphadental.clinic

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.People
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
import com.alphadental.clinic.ui.HomeScreen
import com.alphadental.clinic.ui.LoginScreen
import com.alphadental.clinic.ui.PatientSheet
import com.alphadental.clinic.ui.PatientsScreen
import com.alphadental.clinic.ui.PaymentSheet
import com.alphadental.clinic.ui.PrescriptionSheet
import com.alphadental.clinic.data.LocationFinder
import com.alphadental.clinic.sms.SmsPrefs
import com.alphadental.clinic.sms.SmsWorker
import com.alphadental.clinic.ui.SectionHeading
import com.alphadental.clinic.ui.SmsSenderCard

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
                fontWeight = FontWeight.Black,
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
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate400,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        message,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE11D48),
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
        )

        else -> {
            val session = state.session!!
            val context = LocalContext.current

            Scaffold(
                containerColor = Alpha.Ground,
                snackbarHost = { SnackbarHost(snackbars) },
                floatingActionButton = {
                    // Only on the Day screen, and only for people allowed to write. A button that
                    // opens a form the server will reject is worse than no button.
                    if (state.tab == Tab.DAY && (session.isAdmin || session.isDentist || session.role == "Receptionist")) {
                        ExtendedFloatingActionButton(
                            onClick = { viewModel.openBooking() },
                            containerColor = Alpha.Ink,
                            contentColor = Color.White,
                            shape = Alpha.CardShape,
                        ) {
                            Icon(Icons.Filled.Add, contentDescription = null)
                            Spacer(Modifier.size(8.dp))
                            Text(
                                if (state.arabic) "حجز" else "Book",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Black,
                            )
                        }
                    }
                },
                bottomBar = {
                    NavigationBar(containerColor = Color.White, tonalElevation = 0.dp) {
                        BottomTab(Tab.HOME, Icons.Filled.Home, if (state.arabic) "الرئيسية" else "Home", state.tab, viewModel::selectTab)
                        BottomTab(Tab.DAY, Icons.Filled.CalendarMonth, if (state.arabic) "اليوم" else "Day", state.tab, viewModel::selectTab)
                        BottomTab(Tab.PATIENTS, Icons.Filled.People, if (state.arabic) "المرضى" else "Patients", state.tab, viewModel::selectTab)
                        BottomTab(Tab.MORE, Icons.Filled.MoreHoriz, if (state.arabic) "المزيد" else "More", state.tab, viewModel::selectTab)
                    }
                },
            ) { padding ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    when (state.tab) {
                        Tab.HOME -> HomeScreen(
                            session = session,
                            appointments = state.appointments,
                            offline = state.offline,
                            pending = state.pending,
                            arabic = state.arabic,
                            onOpenAppointment = { openAppointment = it },
                            onSeeDay = { viewModel.selectTab(Tab.DAY) },
                        )

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
                            onToggleLanguage = viewModel::toggleLanguage,
                            onSignOut = viewModel::signOut,
                        )
                    }
                }
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
                PatientSheet(
                    file = state.patientFile,
                    loading = state.patientLoading,
                    error = state.patientError,
                    arabic = state.arabic,
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
                    onDismiss = viewModel::closePatient,
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
                    rescheduling = state.booking?.moving != null,
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

@Composable
private fun RowScope.BottomTab(
    tab: Tab,
    icon: ImageVector,
    label: String,
    current: Tab,
    onSelect: (Tab) -> Unit,
) {
    NavigationBarItem(
        selected = current == tab,
        onClick = { onSelect(tab) },
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Color.White,
            selectedTextColor = Alpha.Ink,
            indicatorColor = Alpha.Ink,
            unselectedIconColor = Alpha.Slate400,
            unselectedTextColor = Alpha.Slate400,
        ),
    )
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

    Column(
        Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AlphaCard(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp)) {
                Text(name, fontSize = 18.sp, fontWeight = FontWeight.Black, color = Alpha.Slate900)
                Text(email, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
                Spacer(Modifier.height(6.dp))
                Text(role, fontSize = 12.sp, fontWeight = FontWeight.Black, color = Alpha.Green)
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

        SectionHeading(if (arabic) "الباقي من النظام" else "THE REST OF THE SYSTEM")

        MoreRow(
            icon = Icons.Filled.OpenInNew,
            label = if (arabic) "فتح النظام كاملاً" else "Open full system",
            caption = if (arabic) "التقارير، المخزون، الوصفات، الإعدادات"
            else "Reports, inventory, prescriptions, settings",
        ) {
            runCatching {
                CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .build()
                    .launchUrl(context, BuildConfig.WEB_URL.toUri())
            }
        }

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
            tint = Color(0xFFE11D48),
            onClick = onSignOut,
        )
    }
}

@Composable
private fun MoreRow(
    icon: ImageVector,
    label: String,
    caption: String,
    tint: Color = Alpha.Slate700,
    onClick: () -> Unit,
) {
    AlphaCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = Alpha.CardShape,
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
            Spacer(Modifier.size(14.dp))
            Column {
                Text(label, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = tint)
                Text(caption, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
            }
        }
    }
}

/** "Tue, 12 Aug" — the same shape the Day screen header uses. */
private fun prettyDay(dateKey: String, arabic: Boolean): String {
    val locale = if (arabic) java.util.Locale("ar", "EG") else java.util.Locale.US
    return java.text.SimpleDateFormat("EEE, d MMM", locale).format(AppViewModel.parseDate(dateKey))
}
