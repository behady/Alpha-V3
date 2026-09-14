package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.serviceLabelOf
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Money
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.Date

/** How far back a report looks. */
enum class Window(val label: String, val days: Int) {
    Month("30 days", 30),
    Quarter("90 days", 90),
    Year("A year", 365),
}

/** A named total with a count behind it. */
data class Line(val label: String, val count: Int, val total: Double)

data class Reports(
    val loading: Boolean = true,
    val who: Who? = null,
    val window: Window = Window.Month,
    val lines: List<Money> = emptyList(),
    val error: String? = null,
) {
    val collected: Double get() = lines.filter { it.isPayment }.sumOf { it.amount }
    val charged: Double get() = lines.filter { it.isCharge }.sumOf { it.amount }
    val expenses: Double get() = lines.filter { it.isExpense }.sumOf { it.amount }

    /**
     * Charged minus collected over this window.
     *
     * Deliberately NOT called "outstanding". A patient can pay in March for work
     * charged in February, so inside any one window this is the difference
     * between two flows, not a debt anybody owes. A real balance lives on the
     * patient's file.
     */
    val gap: Double get() = charged - collected

    /** How many different people actually paid something. */
    val payingPatients: Int
        get() = lines.filter { it.isPayment }.map { it.description }.distinct().size

    /**
     * How many days in this window actually saw money move.
     *
     * The honest denominator for everything below. A clinic six days into using
     * the system has six days of history, and a "90 days" heading over it would
     * be a claim about nothing.
     */
    val daysWithActivity: Int get() = lines.map { it.date }.distinct().count { it.isNotBlank() }

    /** True when there is too little here to say anything with a straight face. */
    val thin: Boolean get() = daysWithActivity in 1..6

    /**
     * What the clinic charged for, biggest first.
     *
     * The tooth list is part of the description — "Root canal (T: 36,37)" — so
     * the website's own label extractor strips it. Grouping on the raw string
     * would file one treatment under a different heading for every combination
     * of teeth it was ever done on.
     */
    val byTreatment: List<Line>
        get() = lines.filter { it.isCharge }
            .groupBy { serviceLabelOf(it.description).ifBlank { "General" } }
            .map { (label, rows) -> Line(label, rows.size, rows.sumOf { it.amount }) }
            .sortedByDescending { it.total }
            .take(10)

    /**
     * Who did the work, by what it was charged at.
     *
     * Charges rather than payments: a dentist is credited for treating someone,
     * not for whether reception managed to collect that day. Rows with no
     * dentist recorded are left out rather than lumped into an "Unknown" that
     * would quietly top the list in a clinic that does not fill the field in.
     */
    val byDentist: List<Line>
        get() = lines.filter { it.isCharge && it.doctor.isNotBlank() }
            .groupBy { it.doctor.trim() }
            .map { (name, rows) -> Line(name, rows.size, rows.sumOf { it.amount }) }
            .sortedByDescending { it.total }

    /** What the clinic spends on, biggest first. */
    val byExpense: List<Line>
        get() = lines.filter { it.isExpense }
            .groupBy { serviceLabelOf(it.description).ifBlank { "Unlabelled" } }
            .map { (label, rows) -> Line(label, rows.size, rows.sumOf { it.amount }) }
            .sortedByDescending { it.total }
            .take(8)
}

/**
 * How the clinic has been doing.
 *
 * Money answers "this month"; this answers "lately, and at what". Collected and
 * charged are never added together — one is money in the drawer, the other is
 * work billed for, and a single "revenue" figure mixing them flatters every
 * period by counting treatment nobody has paid for.
 */
class ReportsModel : ViewModel() {

    private val _state = MutableStateFlow(Reports())
    val state: StateFlow<Reports> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.reports")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see the clinic's reports.",
                        )
                        return@onSuccess
                    }
                    load()
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    fun show(window: Window) {
        if (window == _state.value.window) return
        _state.value = _state.value.copy(window = window, loading = true, lines = emptyList())
        load()
    }

    private fun load() {
        val who = _state.value.who ?: return
        val days = _state.value.window.days
        viewModelScope.launch {
            val to = ClinicSource.dateKey()
            val from = ClinicSource.dateKey(
                Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -days) }.time
            )
            runCatching { ClinicSource.ledgerBetween(who.clinicId, from, to) }
                .onSuccess { _state.value = _state.value.copy(loading = false, lines = it, error = null) }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        loading = false,
                        error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to see the clinic's reports."
                        } else {
                            "The report could not be read."
                        },
                    )
                }
        }
    }
}

/** Reports, filled with the design's example data. See [previewDashboard]. */
fun previewReports(): Reports {
    val cal = Calendar.getInstance()
    fun back(days: Int) = ClinicSource.dateKey(
        Calendar.getInstance().apply { time = cal.time; add(Calendar.DAY_OF_YEAR, -days) }.time
    )
    val charges = listOf(
        Triple("Root canal (T: 36)", 3_200.0, "Dr. Youssef"),
        Triple("Root canal (T: 16,17)", 4_100.0, "Dr. Youssef"),
        Triple("Crown (T: 46)", 4_500.0, "Dr. Youssef"),
        Triple("Crown (T: 26)", 4_500.0, "Dr. Nour"),
        Triple("Composite filling (T: 24)", 900.0, "Dr. Nour"),
        Triple("Composite filling (T: 35,36)", 1_500.0, "Dr. Nour"),
        Triple("Scale & polish", 350.0, "Dr. Nour"),
        Triple("Scale & polish", 350.0, "Dr. Nour"),
        Triple("Extraction (T: 38)", 1_200.0, "Dr. Youssef"),
    ).mapIndexed { i, (d, v, doc) -> Money("c$i", back(i * 3), "procedure", d, v, "", doc) }

    val payments = (0..14).map { i ->
        Money("p$i", back(i * 2), "payment", "Patient ${i + 1}", 800.0 + i * 420, "Cash", "")
    }
    val expenses = listOf(
        Money("e1", back(5), "expense", "Cairo Dental Lab", 2_850.0, "", ""),
        Money("e2", back(12), "expense", "Materials", 6_400.0, "", ""),
        Money("e3", back(20), "expense", "Salaries", 25_850.0, "", ""),
    )
    return Reports(loading = false, who = previewDashboard().who, lines = charges + payments + expenses)
}
