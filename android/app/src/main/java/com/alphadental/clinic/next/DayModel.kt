package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Hours
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** One line in the day: either a booking, or a gap you could book into. */
sealed interface DayEntry {
    val minute: Int

    data class Booking(val visit: Visit) : DayEntry {
        override val minute: Int get() = visit.minuteOfDay
    }

    /** A run of unbooked time. Shown as one gap, not as four empty slots. */
    data class Gap(override val minute: Int, val minutes: Int) : DayEntry
}

/**
 * How much of the diary is on screen.
 *
 * A phone shows one day properly, and that is the right default — but "is there
 * anything on the 24th" is a real question and paging a day at a time to answer
 * it is not an answer. Week and month are therefore counts rather than grids:
 * how many are booked, with a tap to go and look.
 */
enum class Span(val label: String) {
    Day("Day"),
    Week("Week"),
    Month("Month"),
}

/** One day in the week or month view: the date, and how busy it is. */
data class DayCount(
    val dateKey: String,
    val dayOfMonth: Int,
    val booked: Int,
    val done: Int,
    /** False for the padding days that make a month start on the right column. */
    val inSpan: Boolean = true,
)

data class Day(
    val loading: Boolean = true,
    val who: Who? = null,
    val dateKey: String = ClinicSource.dateKey(),
    val visits: List<Visit> = emptyList(),
    val hours: Hours = Hours(),
    val error: String? = null,
    val span: Span = Span.Day,
    /** The week or month around [dateKey], once it has been counted. */
    val counts: List<DayCount> = emptyList(),
    val counting: Boolean = false,
) {
    val isToday: Boolean get() = dateKey == ClinicSource.dateKey()
    val unconfirmed: Int get() = visits.count { it.status == Stage.Unconfirmed }
    val done: Int get() = visits.count { it.status == Stage.Completed }

    /**
     * The day as a sequence of bookings and the gaps between them.
     *
     * Gaps are merged runs rather than one row per empty slot: a clinic with a
     * quiet afternoon does not want eight identical "Free" rows, it wants to see
     * that the afternoon is free. Only gaps at least one slot long are shown, so
     * a five-minute seam between two appointments is not offered as bookable.
     */
    val entries: List<DayEntry>
        get() {
            val booked = visits
                .filterNot { it.status == Stage.Cancelled }
                .sortedBy { it.minuteOfDay }
            if (!hours.configured) return booked.map { DayEntry.Booking(it) }

            val out = mutableListOf<DayEntry>()
            var cursor = hours.startMinute
            booked.forEach { visit ->
                val starts = visit.minuteOfDay
                if (starts - cursor >= hours.slot) {
                    out += DayEntry.Gap(cursor, starts - cursor)
                }
                out += DayEntry.Booking(visit)
                cursor = maxOf(cursor, starts + visit.duration)
            }
            if (hours.closes - cursor >= hours.slot) {
                out += DayEntry.Gap(cursor, hours.closes - cursor)
            }
            return out
        }

    /**
     * How many slots are still free.
     *
     * Null when nobody has told the system when the clinic opens — a count
     * derived from a nine-to-nine guess would be a confident number about a day
     * we know nothing about.
     */
    val freeSlots: Int?
        get() {
            if (!hours.configured) return null
            return entries.filterIsInstance<DayEntry.Gap>().sumOf { it.minutes / hours.slot }
        }
}

/**
 * One day of the diary.
 *
 * The day is a listener, not a fetch: a receptionist watching this screen must
 * see an arrival land without touching the phone. Changing date swaps the
 * listener rather than adding one, or a morning of paging back and forth would
 * leave a dozen sockets open.
 */
class DayModel : ViewModel() {

    private val _state = MutableStateFlow(Day())
    val state: StateFlow<Day> = _state.asStateFlow()

    private var watch: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    _state.value = _state.value.copy(hours = ClinicSource.hours(who.clinicId))
                    watch(who, _state.value.dateKey)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = e.message)
                }
        }
    }

    private fun watch(who: Who, dateKey: String) {
        watch?.cancel()
        watch = viewModelScope.launch {
            ClinicSource.watchDay(who.clinicId, dateKey)
                .catch { e -> _state.value = _state.value.copy(error = e.message) }
                .collect { visits -> _state.value = _state.value.copy(visits = visits, error = null) }
        }
    }

    fun show(span: Span) {
        if (span == _state.value.span) return
        _state.value = _state.value.copy(span = span, counts = emptyList())
        if (span != Span.Day) count()
    }

    /**
     * Count what is booked across the week or the month.
     *
     * A plain read rather than a listener. A month is up to a few hundred
     * documents and nobody watches a month change under them — the day is the
     * screen that has to be live, and it still is.
     */
    private fun count() {
        val who = _state.value.who ?: return
        val span = _state.value.span
        if (span == Span.Day) return

        val (from, to, pad) = rangeOf(_state.value.dateKey, span)
        _state.value = _state.value.copy(counting = true)
        viewModelScope.launch {
            val rows = runCatching {
                com.alphadental.clinic.data.Repository.loadAppointmentsBetween(who.clinicId, from, to)
            }.getOrDefault(emptyList())

            val byDay = rows.groupBy { it.date }
            val days = mutableListOf<DayCount>()
            // The blanks come first so the first of the month lands under the
            // right weekday. A month grid that starts in the wrong column is
            // read wrongly rather than read as broken.
            repeat(pad) { days += DayCount("", 0, 0, 0, inSpan = false) }
            var cursor = parseKey(from)
            val last = parseKey(to)
            while (!cursor.after(last)) {
                val key = ClinicSource.dateKey(cursor.time)
                val onDay = byDay[key].orEmpty()
                days += DayCount(
                    dateKey = key,
                    dayOfMonth = cursor.get(Calendar.DAY_OF_MONTH),
                    booked = onDay.count { Stage.from(it.status) != Stage.Cancelled },
                    done = onDay.count { Stage.from(it.status) == Stage.Completed },
                )
                cursor.add(Calendar.DAY_OF_YEAR, 1)
            }
            _state.value = _state.value.copy(counts = days, counting = false)
        }
    }

    fun shiftSpan(step: Int) {
        val cal = parseKey(_state.value.dateKey)
        when (_state.value.span) {
            Span.Day -> cal.add(Calendar.DAY_OF_YEAR, step)
            Span.Week -> cal.add(Calendar.DAY_OF_YEAR, step * 7)
            Span.Month -> cal.add(Calendar.MONTH, step)
        }
        goTo(ClinicSource.dateKey(cal.time))
    }

    /** Tapping a square in the week or the month drops back into that day. */
    fun openDay(dateKey: String) {
        if (dateKey.isBlank()) return
        _state.value = _state.value.copy(span = Span.Day, counts = emptyList())
        goTo(dateKey)
    }

    fun shiftDay(days: Int) {
        val cal = Calendar.getInstance().apply {
            time = runCatching {
                SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(_state.value.dateKey)
            }.getOrNull() ?: Date()
            add(Calendar.DAY_OF_YEAR, days)
        }
        goTo(ClinicSource.dateKey(cal.time))
    }

    fun today() = goTo(ClinicSource.dateKey())

    private fun goTo(dateKey: String) {
        if (dateKey == _state.value.dateKey) {
            if (_state.value.span != Span.Day && _state.value.counts.isEmpty()) count()
            return
        }
        // Clear the old day's rows immediately. Leaving them up while the new
        // day loads shows yesterday's appointments under today's date, which is
        // worse than a blank list for one frame.
        _state.value = _state.value.copy(dateKey = dateKey, visits = emptyList())
        _state.value.who?.let { watch(it, dateKey) }
        if (_state.value.span != Span.Day) count()
    }

    /**
     * The first and last day of the span, and how many blank squares come first.
     *
     * The week runs Saturday to Friday, which is the Egyptian working week and
     * the same one the payroll period uses. A month that started on Monday here
     * and Saturday on the payslip would be two different calendars.
     */
    private fun rangeOf(dateKey: String, span: Span): Triple<String, String, Int> {
        val cal = parseKey(dateKey)
        return if (span == Span.Week) {
            val start = startOfWeek(cal)
            val end = (start.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, 6) }
            Triple(ClinicSource.dateKey(start.time), ClinicSource.dateKey(end.time), 0)
        } else {
            val start = (cal.clone() as Calendar).apply { set(Calendar.DAY_OF_MONTH, 1) }
            val end = (start.clone() as Calendar).apply {
                set(Calendar.DAY_OF_MONTH, getActualMaximum(Calendar.DAY_OF_MONTH))
            }
            // Saturday is column one, so Saturday pads none and Friday pads six.
            val pad = (start.get(Calendar.DAY_OF_WEEK) - Calendar.SATURDAY + 7) % 7
            Triple(ClinicSource.dateKey(start.time), ClinicSource.dateKey(end.time), pad)
        }
    }

    private fun startOfWeek(from: Calendar): Calendar {
        val cal = from.clone() as Calendar
        val back = (cal.get(Calendar.DAY_OF_WEEK) - Calendar.SATURDAY + 7) % 7
        cal.add(Calendar.DAY_OF_YEAR, -back)
        return cal
    }

    private fun parseKey(dateKey: String): Calendar = Calendar.getInstance().apply {
        time = runCatching {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey)
        }.getOrNull() ?: Date()
    }
}

/** The day, filled with the design's example data. See [previewDashboard]. */
fun previewDay(): Day = Day(
    loading = false,
    who = previewDashboard().who,
    dateKey = ClinicSource.dateKey(),
    hours = Hours(startMinute = 9 * 60, endMinute = 17 * 60, slot = 30, configured = true),
    visits = previewDashboard().visits + listOf(
        Visit("9", "p9", "Laila Hamdy", "", "02:00 PM", "Dr. Youssef", "Implant review", Stage.Rescheduled, 30),
        Visit("10", "p10", "Sherif Naguib", "", "02:30 PM", "Dr. Nour", "Veneers consult", Stage.Cancelled, 30),
    ),
)
