package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch

/**
 * Everything the dashboard shows, as one value.
 *
 * One state object rather than a dozen flows, so a screen can never render half
 * a refresh — the takings from one read beside a day from another.
 */
data class Dashboard(
    val loading: Boolean = true,
    val who: Who? = null,
    val clinicName: String = "",
    val currency: String = "EGP",
    val visits: List<Visit> = emptyList(),

    /** Null while unread, and for anyone who may not see the clinic's money. */
    val takings: Double? = null,
    /** Null when there is no comparable history — a fortnight-old clinic has none. */
    val weekdayAverage: Double? = null,
    val owed: Double? = null,

    /** Something went wrong that the person needs told. */
    val error: String? = null,
    val refreshing: Boolean = false,
) {
    val active: List<Visit> get() = visits.filterNot { it.status.isFinished }
    val waiting: List<Visit> get() = active.filter { it.status == Stage.CheckedIn }
    val inChair: Visit? get() = visits.firstOrNull { it.status == Stage.InChair }
    val seen: Int get() = visits.count { it.status.isSeen }

    /** The site's four: confirmed, running late, done, cancelled. */
    val confirmed: Int get() = visits.count { it.status == Stage.Confirmed }
    val delayed: Int get() = visits.count { it.status == Stage.Delayed || it.status == Stage.Late }
    val done: Int get() = visits.count { it.status == Stage.Completed }
    val cancelled: Int get() = visits.count { it.status == Stage.Cancelled }

    /** What is still to come, with whoever is in the chair taken out — they are the card. */
    val upcoming: List<Visit>
        get() = active.filterNot { it.status == Stage.CheckedIn || it.id == inChair?.id }

    /**
     * How today compares with the same weekday, as a percentage.
     *
     * Null unless there is genuinely something to say: no history to compare, or
     * nothing taken yet today. A dashboard opened at nine in the morning that
     * announces "-100%" is technically true and completely useless.
     */
    val deltaPercent: Int?
        get() {
            val today = takings ?: return null
            val average = weekdayAverage?.takeIf { it > 0 } ?: return null
            if (today <= 0.0) return null
            return (((today - average) / average) * 100).toInt()
        }
}

/**
 * The dashboard's state, and the reads that fill it.
 *
 * The day is a listener, so an arrival appears on the desk without anyone
 * touching the phone. The money is fetched, because a figure that was right a
 * minute ago is worth more than a socket held open all day — a pull refreshes it.
 */
class DashboardModel : ViewModel() {

    private val _state = MutableStateFlow(Dashboard())
    val state: StateFlow<Dashboard> = _state.asStateFlow()

    private var dayWatch: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    watchToday(who)
                    loadClinic(who)
                    loadMoney(who)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = readable(e))
                }
        }
    }

    private fun watchToday(who: Who) {
        dayWatch?.cancel()
        dayWatch = viewModelScope.launch {
            ClinicSource.watchDay(who.clinicId, ClinicSource.dateKey())
                .catch { e -> _state.value = _state.value.copy(error = readable(e)) }
                .collect { visits -> _state.value = _state.value.copy(visits = visits, error = null) }
        }
    }

    private fun loadClinic(who: Who) = viewModelScope.launch {
        val clinic = ClinicSource.clinicProfile(who.clinicId)
        _state.value = _state.value.copy(clinicName = clinic.name, currency = clinic.currency)
    }

    /**
     * The three money figures, together.
     *
     * Gated on the finance key rather than the role: the website grants it by
     * tick-box, and a manager who has been given it should not open a dashboard
     * that hides the number they were given it for.
     */
    private fun loadMoney(who: Who) {
        if (!who.can("access.finance")) return
        viewModelScope.launch {
            val today = ClinicSource.dateKey()
            val takings = async { runCatching { ClinicSource.takings(who.clinicId, today) }.getOrNull() }
            val average = async { runCatching { ClinicSource.weekdayAverage(who.clinicId, today) }.getOrNull() }
            val owed = async { runCatching { ClinicSource.owed(who.clinicId) }.getOrNull() }

            // Awaited into locals BEFORE the copy, and this is not a style
            // preference. Kotlin evaluates the receiver of `.copy()` first, so
            // writing `_state.value.copy(takings = takings.await())` reads the
            // state now, suspends for as long as the network takes, and then
            // applies the copy to that stale snapshot — throwing away everything
            // the day listener and the clinic read wrote while it waited. It did
            // exactly that: the dashboard showed the right takings beside an
            // empty day and a nameless clinic, while the Day tab showed nine
            // appointments for the same date.
            val money = takings.await()
            val weekday = average.await()
            val outstanding = owed.await()

            _state.value = _state.value.copy(
                // A failed re-read keeps the old figure rather than blanking it.
                takings = money ?: _state.value.takings,
                weekdayAverage = weekday ?: _state.value.weekdayAverage,
                owed = outstanding ?: _state.value.owed,
                refreshing = false,
            )
        }
    }

    fun refresh() {
        val who = _state.value.who ?: return
        if (_state.value.refreshing) return
        _state.value = _state.value.copy(refreshing = true)
        loadClinic(who)
        loadMoney(who)
    }

    /** Move whoever is in the chair on to checking out. */
    fun checkOut(visit: Visit) {
        val who = _state.value.who ?: return
        if (!who.can("appointments.edit")) return
        viewModelScope.launch {
            ClinicSource.setStage(who.clinicId, visit.id, Stage.CheckingOut)
                .onFailure { _state.value = _state.value.copy(error = readable(it)) }
            // No local edit: the day is a listener, so the row updates itself the
            // moment the write lands. Writing it here too would mean two sources
            // of truth disagreeing for a second.
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    /**
     * One sentence a receptionist can act on.
     *
     * Firestore's own messages are written for developers — "PERMISSION_DENIED:
     * Missing or insufficient permissions" — and someone on a bad connection
     * needs to be told what to do, not what went wrong inside.
     */
    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) || raw.contains("insufficient", true) ->
                "This account is not allowed to see that. Ask an administrator to check its access."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. This will fill in once the phone is back online."
            raw.isBlank() -> "Something went wrong reading the clinic."
            else -> raw
        }
    }
}

/**
 * A dashboard filled with representative data, for looking at the layout.
 *
 * It exists because the emulator holds no signed-in session and nobody's
 * password should be typed into one to get a screenshot. The figures are the
 * design's own example data, not any clinic's — which is also why this is
 * reachable only by an explicit debug flag and never from a real session.
 *
 *     adb shell am start -n <pkg>/com.alphadental.clinic.next.NextActivity --ez preview true
 */
fun previewDashboard(): Dashboard = Dashboard(
    loading = false,
    who = Who(
        uid = "preview",
        name = "Ahmed Tarek",
        email = "",
        clinicId = "preview",
        role = "Owner",
        permissions = emptySet(),
    ),
    clinicName = "Alpha Dental · Nasr City",
    currency = "EGP",
    takings = 18_450.0,
    weekdayAverage = 15_120.0,
    owed = 6_200.0,
    visits = listOf(
        Visit("1", "p1", "Mariam Hassan", "", "10:05 AM", "Dr. Youssef", "Root canal · upper right 6", Stage.InChair, 60),
        Visit("2", "p2", "Omar Abdelrahman", "", "10:45 AM", "Dr. Nour", "Scale & polish", Stage.CheckedIn, 30),
        Visit("3", "p3", "Salma Ibrahim", "", "11:00 AM", "Dr. Youssef", "Composite filling", Stage.CheckedIn, 30),
        Visit("4", "p4", "Khaled Mostafa", "", "10:30 AM", "Dr. Nour", "Crown fitting", Stage.Late, 45),
        Visit("5", "p5", "Nadia Farouk", "", "11:30 AM", "Dr. Nour", "Ortho adjustment", Stage.Confirmed, 20),
        Visit("6", "p6", "Ahmed Zaki", "", "12:00 PM", "", "Consultation", Stage.Unconfirmed, 30),
        Visit("7", "p7", "Yara Sameh", "", "12:30 PM", "Dr. Youssef", "Extraction", Stage.Confirmed, 30),
        Visit("8", "p8", "Hania Adel", "", "09:00 AM", "Dr. Nour", "Check-up", Stage.Completed, 20),
    ),
)
