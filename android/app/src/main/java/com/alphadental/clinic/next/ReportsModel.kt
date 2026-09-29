package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.ReportsClient
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Calendar
import java.util.Locale

/**
 * The periods a clinic actually asks for — the same six the website offers, in the same order.
 * The week starts on SATURDAY, as it does everywhere else in the app.
 */
enum class Preset(val en: String, val ar: String) {
    Today("Today", "النهارده"),
    Week("This week", "الأسبوع ده"),
    Month("This month", "الشهر ده"),
    LastMonth("Last month", "الشهر اللي فات"),
    Quarter("This quarter", "الربع ده"),
    Year("This year", "السنة دي"),
    ;

    /** Inclusive "yyyy-MM-dd" keys. */
    fun range(): Pair<String, String> {
        val cal = Calendar.getInstance()
        val today = ClinicSource.dateKey(cal.time)
        fun key(c: Calendar) = ClinicSource.dateKey(c.time)
        return when (this) {
            Today -> today to today
            Week -> {
                val back = (cal.get(Calendar.DAY_OF_WEEK) % 7) // Sat=7→0, Sun=1→1 … Fri=6→6
                cal.add(Calendar.DAY_OF_YEAR, -back)
                key(cal) to today
            }
            Month -> { cal.set(Calendar.DAY_OF_MONTH, 1); key(cal) to today }
            LastMonth -> {
                cal.add(Calendar.MONTH, -1)
                cal.set(Calendar.DAY_OF_MONTH, 1)
                val first = key(cal)
                cal.set(Calendar.DAY_OF_MONTH, cal.getActualMaximum(Calendar.DAY_OF_MONTH))
                first to key(cal)
            }
            Quarter -> {
                cal.set(Calendar.MONTH, (cal.get(Calendar.MONTH) / 3) * 3)
                cal.set(Calendar.DAY_OF_MONTH, 1)
                key(cal) to today
            }
            Year -> { cal.set(Calendar.DAY_OF_YEAR, 1); key(cal) to today }
        }
    }
}

data class ReportsState(
    val loading: Boolean = true,
    val who: Who? = null,
    val lang: String = com.alphadental.clinic.next.data.AppLocale.language.value,
    val groups: List<ReportsClient.Group> = emptyList(),
    val groupId: String = "overview",
    val reportId: String = "clinic",
    val preset: Preset? = Preset.Month,
    val from: String = Preset.Month.range().first,
    val to: String = Preset.Month.range().second,
    val doc: ReportsClient.Doc? = null,
    val error: String? = null,
    val locked: Boolean = false,
    /** The drawer under a figure: the patients behind it. */
    val drill: ReportsClient.Section? = null,
    val drillLoading: Boolean = false,
) {
    val isAr: Boolean get() = lang == "ar"
    val group: ReportsClient.Group? get() = groups.firstOrNull { it.id == groupId }
    val entry: ReportsClient.Entry? get() = groups.flatMap { it.reports }.firstOrNull { it.id == reportId }
}

/**
 * The reports, fetched as documents from the website's own arithmetic.
 *
 * This model computes nothing. It asks `/api/reports` for the catalogue and for one report over
 * one range, and holds what came back. The date presets are the only thing decided here, and they
 * are decided the way the website decides them.
 */
class ReportsModel : ViewModel() {

    private val _state = MutableStateFlow(ReportsState())
    val state: StateFlow<ReportsState> = _state.asStateFlow()
    private var loadJob: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.reports")) {
                        _state.value = _state.value.copy(loading = false, error = "This account is not allowed to see the clinic's reports.")
                        return@onSuccess
                    }
                    runCatching { ReportsClient.list(who.clinicId, _state.value.lang) }
                        .onSuccess { groups -> _state.value = _state.value.copy(groups = groups); load() }
                        .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    fun showGroup(id: String) {
        val s = _state.value
        if (id == s.groupId) return
        val first = s.groups.firstOrNull { it.id == id }?.reports?.firstOrNull() ?: return
        _state.value = s.copy(groupId = id, reportId = first.id, drill = null)
        load()
    }

    fun showReport(id: String) {
        val s = _state.value
        if (id == s.reportId) return
        val group = s.groups.firstOrNull { g -> g.reports.any { it.id == id } }?.id ?: s.groupId
        _state.value = s.copy(groupId = group, reportId = id, drill = null)
        load()
    }

    fun pick(preset: Preset) {
        val (from, to) = preset.range()
        _state.value = _state.value.copy(preset = preset, from = from, to = to, drill = null)
        load()
    }

    /** A custom range, from the two date pickers. Either end may move; the order is kept sane. */
    fun setRange(from: String? = null, to: String? = null) {
        val s = _state.value
        var f = from ?: s.from
        var t = to ?: s.to
        if (f > t) { if (from != null) t = f else f = t }
        val preset = Preset.entries.firstOrNull { it.range() == (f to t) }
        _state.value = s.copy(preset = preset, from = f, to = t, drill = null)
        load()
    }

    fun refresh() = load()

    /** Open the people behind a figure. */
    fun drill(key: String) {
        val s = _state.value
        val who = s.who ?: return
        _state.value = s.copy(drill = null, drillLoading = true)
        viewModelScope.launch {
            runCatching { ReportsClient.drill(who.clinicId, s.reportId, key, s.from, s.to, s.lang) }
                .onSuccess { _state.value = _state.value.copy(drill = it, drillLoading = false) }
                .onFailure { e -> _state.value = _state.value.copy(drillLoading = false, error = e.message) }
        }
    }

    fun closeDrill() { _state.value = _state.value.copy(drill = null, drillLoading = false) }

    private fun load() {
        val s = _state.value
        val who = s.who ?: return
        loadJob?.cancel()
        _state.value = s.copy(loading = true, error = null, locked = false)
        loadJob = viewModelScope.launch {
            runCatching { ReportsClient.doc(who.clinicId, s.reportId, s.from, s.to, s.lang) }
                .onSuccess { doc -> _state.value = _state.value.copy(loading = false, doc = doc, error = null) }
                .onFailure { e ->
                    val locked = (e as? ReportsClient.ReportsError)?.locked == true
                    _state.value = _state.value.copy(loading = false, doc = null, error = e.message, locked = locked)
                }
        }
    }
}

/** Reports, filled with the design's example data. See [previewDashboard]. */
fun previewReports(): ReportsState {
    val groups = listOf(
        ReportsClient.Group("overview", "Overview", listOf(
            ReportsClient.Entry("clinic", "Clinic Overview", "The period in one screen.", false, false),
            ReportsClient.Entry("compare", "vs Previous Period", "This period against the one before it.", false, false),
            ReportsClient.Entry("year", "Year in Review", "The last twelve months, month by month.", false, false),
        )),
        ReportsClient.Group("money", "Money", listOf(
            ReportsClient.Entry("pnl", "Profit & Loss", "Gross to net.", false, false),
            ReportsClient.Entry("service", "Service Analysis", "What each treatment earned.", false, false),
        )),
        ReportsClient.Group("operations", "Operations", listOf(
            ReportsClient.Entry("lab", "Lab", "Turnaround, remakes and cost.", false, true),
        )),
    )
    val doc = ReportsClient.Doc(
        id = "clinic", title = "Clinic Overview", hint = "The period in one screen.", rangeLabel = "1 Sep to 27 Sep", allTime = false,
        figures = listOf(
            ReportsClient.Figure("Total income", "48,250 EGP", "ink", "▲ 12% (+5,100)", false),
            ReportsClient.Figure("Deductions", "(9,650) EGP", "muted", null, false),
            ReportsClient.Figure("Expenses", "(14,000) EGP", "muted", null, false),
            ReportsClient.Figure("Net profit", "24,600 EGP", "ink", "▼ 4% (−1,020)", true),
        ),
        sections = listOf(
            ReportsClient.Section.Bars("New and returning patients", "Tap for the names.", listOf(
                ReportsClient.Bar("New patients", 7.0, "7 · 12,400 EGP", true, false, "new"),
                ReportsClient.Bar("Returning patients", 31.0, "31 · 35,850 EGP", false, false, "returning"),
            )),
            ReportsClient.Section.Months("Money, day by day", null, (1..27).map { ReportsClient.Point(it.toString(), listOf(0.0, 1200.0, 3400.0, 900.0, 2600.0, 0.0, 4100.0)[it % 7]) }, "money"),
            ReportsClient.Section.Table("Procedures", "Tap a line for its patients.",
                listOf(ReportsClient.Column("name", "Procedure", false, "text"), ReportsClient.Column("count", "Count", true, "int"), ReportsClient.Column("income", "Income", true, "money"), ReportsClient.Column("share", "%", true, "pct")),
                listOf(
                    ReportsClient.TableRow(mapOf("name" to "Root canal", "count" to 9, "income" to 28800, "share" to 59.7), null, "service:rct", false),
                    ReportsClient.TableRow(mapOf("name" to "Zirconia crown", "count" to 3, "income" to 13500, "share" to 28.0), null, "service:crown", false),
                    ReportsClient.TableRow(mapOf("name" to "Scale & polish", "count" to 17, "income" to 5950, "share" to 12.3), null, "service:scale", false),
                ),
                ReportsClient.TableRow(mapOf("name" to "Total", "count" to 29, "income" to 48250, "share" to 100), null, null, false),
            ),
            ReportsClient.Section.Note("Income is cash actually received."),
        ),
    )
    return ReportsState(loading = false, who = previewDashboard().who, groups = groups, doc = doc)
}
