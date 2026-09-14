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

    Box(Modifier.fillMaxSize().background(T.ground)) {

        when (tab) {
            Tab.Today -> TodayTab(preview)
            Tab.Day -> DayTab(preview)
            Tab.Patients -> PatientsTab(preview)
            // Not built yet. Saying so is better than a blank screen that reads
            // as a bug, and better than hiding the tab so the bar keeps moving.
            Tab.Chats -> Unbuilt("WhatsApp")
            Tab.More -> Unbuilt("More")
        }

        FloatingBar(
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
private fun PatientsTab(preview: Boolean) {
    if (preview) {
        val state = remember { previewPatients() }
        PatientsScreen(state = state, onSearch = {}, onLoadMore = {}, onAdd = {})
    } else {
        val model: PatientsModel = viewModel()
        val state by model.state.collectAsState()
        androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
        PatientsScreen(
            state = state,
            onSearch = model::search,
            onLoadMore = model::loadMore,
            // Adding a patient is a write; only offer it to someone the server
            // would accept it from.
            onAdd = if (state.who?.can("patients.add") == true) ({ }) else null,
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
