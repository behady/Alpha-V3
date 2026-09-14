package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Money
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** One day's takings, for the chart. */
data class Bar(val dateKey: String, val day: Int, val collected: Double)

/** What the clinic charged for, grouped. */
data class Earner(val label: String, val total: Double)

data class MoneyState(
    val loading: Boolean = true,
    val who: Who? = null,
    /** Any day inside the month being shown. */
    val anchor: Date = Date(),
    val lines: List<Money> = emptyList(),
    /** What the same month before this one collected. Null when there is no history. */
    val previousCollected: Double? = null,
    val error: String? = null,
) {
    val monthStart: String get() = ClinicSource.dateKey(firstOfMonth(anchor))
    val monthEnd: String get() = ClinicSource.dateKey(lastOfMonth(anchor))

    val isThisMonth: Boolean
        get() = monthStart == ClinicSource.dateKey(firstOfMonth(Date()))

    /** Money that actually arrived. Not what was billed — billed is a hope. */
    val collected: Double get() = lines.filter { it.isPayment }.sumOf { it.amount }

    val charged: Double get() = lines.filter { it.isCharge }.sumOf { it.amount }

    val expenses: Double get() = lines.filter { it.isExpense }.sumOf { it.amount }

    /** What the clinic actually kept. */
    val net: Double get() = collected - expenses

    /**
     * How this month compares with the one before, as a percentage.
     *
     * Null unless both months have something in them: a first month in the
     * system announcing "+100%" against nothing is noise, not information.
     */
    val deltaPercent: Int?
        get() {
            val before = previousCollected?.takeIf { it > 0 } ?: return null
            if (collected <= 0) return null
            return (((collected - before) / before) * 100).toInt()
        }

    /** Every day of the month, so the chart has a shape rather than gaps. */
    val bars: List<Bar>
        get() {
            val byDay = lines.filter { it.isPayment }.groupBy { it.date }
            val cal = Calendar.getInstance().apply { time = firstOfMonth(anchor) }
            val days = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
            return (1..days).map { day ->
                cal.set(Calendar.DAY_OF_MONTH, day)
                val key = ClinicSource.dateKey(cal.time)
                Bar(key, day, byDay[key]?.sumOf { it.amount } ?: 0.0)
            }
        }

    val peak: Bar? get() = bars.maxByOrNull { it.collected }?.takeIf { it.collected > 0 }

    /**
     * What the clinic charged for, biggest first.
     *
     * Grouped by the description the clinic typed, because that is the only
     * grouping the data actually has — there is no category field, and inventing
     * one here would mean inventing which treatments belong in it.
     */
    val earners: List<Earner>
        get() = lines.filter { it.isCharge }
            // The tooth list is part of the description a charge is written with
            // — "Root canal (T: 36,37)" — so grouping on the raw string files the
            // same treatment under a new heading for every combination of teeth
            // it was ever done on. The website already strips it; reuse that.
            .groupBy {
                com.alphadental.clinic.data.serviceLabelOf(it.description).ifBlank { "Unlabelled" }
            }
            .map { (label, rows) -> Earner(label, rows.sumOf { it.amount }) }
            .sortedByDescending { it.total }
            .take(8)

    /** The most recent movements, whichever way the money went. */
    val recent: List<Money> get() = lines.filterNot { it.isCharge }.take(12)
}

private fun firstOfMonth(d: Date): Date = Calendar.getInstance().apply {
    time = d
    set(Calendar.DAY_OF_MONTH, 1)
}.time

private fun lastOfMonth(d: Date): Date = Calendar.getInstance().apply {
    time = d
    set(Calendar.DAY_OF_MONTH, getActualMaximum(Calendar.DAY_OF_MONTH))
}.time

/**
 * The clinic's money, a month at a time.
 *
 * A month rather than a rolling window because that is the unit a clinic
 * actually thinks in — rent, salaries and the lab's bill all land monthly, and a
 * "last 30 days" figure straddles two of each.
 */
class MoneyModel : ViewModel() {

    private val _state = MutableStateFlow(MoneyState())
    val state: StateFlow<MoneyState> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.finance")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see the clinic's money.",
                        )
                        return@onSuccess
                    }
                    load()
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    fun shiftMonth(months: Int) {
        val cal = Calendar.getInstance().apply {
            time = _state.value.anchor
            set(Calendar.DAY_OF_MONTH, 1)
            add(Calendar.MONTH, months)
        }
        _state.value = _state.value.copy(anchor = cal.time, lines = emptyList(), loading = true)
        load()
    }

    fun thisMonth() {
        if (_state.value.isThisMonth) return
        _state.value = _state.value.copy(anchor = Date(), lines = emptyList(), loading = true)
        load()
    }

    private fun load() {
        val who = _state.value.who ?: return
        val s = _state.value
        viewModelScope.launch {
            runCatching { ClinicSource.ledgerBetween(who.clinicId, s.monthStart, s.monthEnd) }
                .onSuccess { lines ->
                    _state.value = _state.value.copy(loading = false, lines = lines, error = null)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, error = readable(e))
                }

            // The month before, for the comparison. Its failure is not the
            // screen's failure — the figures still stand without a comparison.
            val prev = Calendar.getInstance().apply {
                time = s.anchor
                set(Calendar.DAY_OF_MONTH, 1)
                add(Calendar.MONTH, -1)
            }.time
            val before = runCatching {
                ClinicSource.ledgerBetween(
                    who.clinicId,
                    ClinicSource.dateKey(firstOfMonth(prev)),
                    ClinicSource.dateKey(lastOfMonth(prev)),
                ).filter { it.isPayment }.sumOf { it.amount }
            }.getOrNull()
            _state.value = _state.value.copy(previousCollected = before)
        }
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) ->
                "This account is not allowed to see the clinic's money."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. These figures will fill in once the phone is back online."
            else -> "The clinic's money could not be read."
        }
    }
}

/** Money, filled with the design's example data. See [previewDashboard]. */
fun previewMoney(): MoneyState {
    val cal = Calendar.getInstance()
    val month = SimpleDateFormat("yyyy-MM", Locale.US).format(cal.time)
    fun day(d: Int) = "%s-%02d".format(month, d)
    val payments = listOf(
        11_900.0, 8_400.0, 14_100.0, 6_200.0, 17_800.0, 24_100.0, 4_300.0,
        9_900.0, 13_600.0, 7_400.0, 19_200.0, 12_050.0, 18_450.0,
    ).mapIndexed { i, v -> Money("p$i", day(i + 1), "payment", "Payment", v, "Cash", "") }
    val charges = listOf(
        "Restorative" to 78_300.0,
        "Orthodontics" to 54_100.0,
        "Endodontics" to 41_600.0,
        "Prosthetics" to 28_900.0,
        "Hygiene" to 11_900.0,
    ).mapIndexed { i, (label, v) -> Money("c$i", day(i + 1), "procedure", label, v, "", "Dr. Youssef") }
    val expenses = listOf(
        Money("e1", day(13), "expense", "Cairo Dental Lab · 3 crowns", 2_850.0, "", ""),
        Money("e2", day(9), "expense", "Materials", 18_400.0, "", ""),
        Money("e3", day(4), "expense", "Salaries", 25_850.0, "", ""),
    )
    return MoneyState(
        loading = false,
        who = previewDashboard().who,
        lines = payments + charges + expenses,
        previousCollected = 151_000.0,
    )
}
