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

    Box(Modifier.fillMaxSize().background(T.ground)) {

        when (tab) {
            Tab.Today -> TodayTab(preview)
            Tab.Day -> DayTab(preview)
            Tab.Patients -> PatientsTab(preview) { openRecord = it }
            // Not built yet. Saying so is better than a blank screen that reads
            // as a bug, and better than hiding the tab so the bar keeps moving.
            Tab.Chats -> ChatsTab(preview) { immersive = it }
            Tab.More -> Unbuilt("More")
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
