package com.alphadental.clinic.next

import android.content.Context
import com.alphadental.clinic.ai.PayrollClient
import com.alphadental.clinic.data.Attendance
import com.alphadental.clinic.data.GeofenceVerdict
import com.alphadental.clinic.data.LocationFinder
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.isUsableGeofence
import com.alphadental.clinic.data.judgeGeofence
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Calendar

/** How far back the pay figures look. Weeks run Saturday to Friday, as the desk does. */
enum class Period(val label: String) {
    ThisWeek("This week"),
    LastWeek("Last week"),
    ThisMonth("This month"),
    ;

    /** The range as two "yyyy-MM-dd" keys, inclusive. */
    fun range(): Pair<String, String> {
        val cal = Calendar.getInstance()
        return when (this) {
            ThisWeek -> {
                val start = startOfWeek(cal)
                ClinicSource.dateKey(start.time) to ClinicSource.dateKey(Calendar.getInstance().time)
            }
            LastWeek -> {
                val start = startOfWeek(cal).apply { add(Calendar.DAY_OF_YEAR, -7) }
                val end = (start.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, 6) }
                ClinicSource.dateKey(start.time) to ClinicSource.dateKey(end.time)
            }
            ThisMonth -> {
                val start = (cal.clone() as Calendar).apply { set(Calendar.DAY_OF_MONTH, 1) }
                ClinicSource.dateKey(start.time) to ClinicSource.dateKey(cal.time)
            }
        }
    }

    private fun startOfWeek(from: Calendar): Calendar {
        val c = from.clone() as Calendar
        // Saturday is the first working day of an Egyptian week, and the desk's
        // own week runs the same way — a Monday-based week would put half a
        // weekend in the wrong period and quietly change everybody's hours.
        while (c.get(Calendar.DAY_OF_WEEK) != Calendar.SATURDAY) c.add(Calendar.DAY_OF_YEAR, -1)
        return c
    }
}

/** This phone's own shift. Everyone has one, whatever else they may see. */
data class MyShift(
    val staffId: String = "",
    val openSince: Long? = null,
    val busy: Boolean = false,
    val error: String? = null,
    /**
     * The last refusal was Android's, not the clinic's.
     *
     * Kept apart from the message because it is the one failure the screen can
     * actually fix: everything else here is "you are not at the clinic", which
     * no button will help with.
     */
    val needsLocation: Boolean = false,
) {
    val on: Boolean get() = openSince != null

    val minutes: Int
        get() = openSince?.let { ((System.currentTimeMillis() - it) / 60_000L).toInt().coerceAtLeast(0) } ?: 0
}

data class AttendanceState(
    val loading: Boolean = true,
    val who: Who? = null,
    val mine: MyShift = MyShift(),
    val staff: List<Attendance.StaffMember> = emptyList(),
    val punches: List<Attendance.Punch> = emptyList(),
    val period: Period = Period.ThisWeek,
    val payroll: PayrollClient.Payroll? = null,
    val payrollError: String? = null,
    val payrollLoading: Boolean = false,
    val error: String? = null,
    /** Redrawn every minute so an open shift's clock ticks. */
    val tick: Long = 0L,

    // ---- the team, for whoever runs it
    /** Every punch in the period, for the overtime list. */
    val periodPunches: List<Attendance.Punch> = emptyList(),
    /** Staff id → commission earned on payments in the period. */
    val commissions: Map<String, Double> = emptyMap(),
    val editingStaff: Attendance.StaffMember? = null,
    val savingStaff: Boolean = false,
    val staffError: String? = null,
    /** The punch whose overtime is being decided. */
    val deciding: String? = null,
) {
    /** Changing what somebody is paid is the Owner's and Admin's — the rule the staff records are under. */
    val canEditTeam: Boolean get() = who?.isAdmin == true

    val dentists: List<Attendance.StaffMember>
        get() = staff.filter { it.isDentist || it.commissionPercentage > 0 }

    /** Closed shifts with time outside the schedule that nobody has approved or rejected. */
    val pendingOvertime: List<Pair<Attendance.Punch, Attendance.StaffMember>>
        get() = periodPunches.mapNotNull { punch ->
            if (punch.overtimeStatus == "approved" || punch.overtimeStatus == "rejected") return@mapNotNull null
            val member = Attendance.owner(punch, staff) ?: return@mapNotNull null
            if (Attendance.overtimeMinutes(punch, member) <= 0) return@mapNotNull null
            punch to member
        }.sortedByDescending { it.first.checkInMillis }

    /**
     * Whether this account may see everybody's attendance.
     *
     * The same three keys the website's Team Overview accepts. Anyone without
     * them still gets their own shift — clocking in is not an admin action, and
     * a receptionist who cannot see the roster still has to start their day.
     */
    val canSeeEveryone: Boolean
        get() = who?.isAdmin == true || who?.can("attendance.admin") == true || who?.can("access.settings") == true

    val roster: List<Attendance.RosterRow>
        get() = Attendance.roster(staff, punches).sortedWith(
            // Who is in, then who is late, then who is missing. A roster is read
            // to find the gap, not to take a register in alphabetical order.
            compareBy<Attendance.RosterRow>(
                {
                    when (it.state) {
                        Attendance.State.ON_SHIFT -> 0
                        Attendance.State.NOT_ARRIVED -> 1
                        Attendance.State.EXPECTED -> 2
                        Attendance.State.DONE -> 3
                        Attendance.State.DAY_OFF -> 4
                    }
                },
                { -it.lateMinutes },
                { it.member.name.lowercase() },
            )
        )

    val onShift: Int get() = roster.count { it.state == Attendance.State.ON_SHIFT }
    val late: Int get() = roster.count { it.lateMinutes > 0 && it.state != Attendance.State.DAY_OFF }
    val missing: Int get() = roster.count { it.state == Attendance.State.NOT_ARRIVED }
    val off: Int get() = roster.count { it.state == Attendance.State.DAY_OFF }
}

/**
 * Attendance: this phone's shift, and — for whoever may see it — everybody's.
 *
 * Two sources on purpose. Today's roster is worked out on the phone from live
 * punches and each person's schedule, because it has to update the second
 * somebody walks in. The pay figures are fetched from the server and never
 * recomputed here: the hourly rate, the split between approved and pending
 * overtime, what counts as an absence — all of it lives in one function the
 * desk and the weekly brief also call. A second, slightly different answer about
 * somebody's wages is an argument with an employee, not a rendering bug.
 */
class AttendanceModel : ViewModel() {

    private val _state = MutableStateFlow(AttendanceState())
    val state: StateFlow<AttendanceState> = _state.asStateFlow()

    private var watch: Job? = null
    private var ticker: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    loadMine(who)
                    if (_state.value.canSeeEveryone) {
                        loadStaff(who)
                        observeToday(who)
                        loadPayroll()
                        loadTeamPeriod()
                    }
                    startTicker()
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    /** One redraw a minute, so an open shift's elapsed time is not frozen. */
    private fun startTicker() {
        if (ticker != null) return
        ticker = viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(60_000)
                _state.value = _state.value.copy(tick = System.currentTimeMillis())
            }
        }
    }

    private fun loadMine(who: Who) = viewModelScope.launch {
        val staffId = runCatching { Repository.findMyStaffId(who.clinicId, who.uid, who.email) }
            .getOrDefault("")
        val open = runCatching { Repository.openShift(who.clinicId, who.uid) }.getOrNull()
        _state.value = _state.value.copy(
            mine = _state.value.mine.copy(staffId = staffId, openSince = open?.checkInMillis),
        )
    }

    private fun loadStaff(who: Who) = viewModelScope.launch {
        runCatching { Attendance.loadStaff(who.clinicId) }
            .onSuccess { _state.value = _state.value.copy(staff = it) }
            .onFailure { _state.value = _state.value.copy(error = "The staff list could not be read.") }
    }

    private fun observeToday(who: Who) {
        watch?.cancel()
        watch = viewModelScope.launch {
            Attendance.observeToday(who.clinicId, Attendance.startOfToday()).collect { result ->
                result
                    .onSuccess { _state.value = _state.value.copy(punches = it, error = null) }
                    .onFailure {
                        _state.value = _state.value.copy(error = "Today's clock-ins could not be read.")
                    }
            }
        }
    }

    fun show(period: Period) {
        if (period == _state.value.period) return
        _state.value = _state.value.copy(period = period, payroll = null, payrollError = null)
        loadPayroll()
        loadTeamPeriod()
    }

    /**
     * The period's punches and the period's commission, together.
     *
     * Commission is summed from the payment rows themselves — `doctorCommissionAmount`, stamped
     * when each payment was taken — never recomputed from today's percentage. That is what makes
     * a rate change safe: last month's figure is last month's figure.
     */
    private fun loadTeamPeriod() {
        val who = _state.value.who ?: return
        if (!_state.value.canSeeEveryone) return
        val (from, to) = _state.value.period.range()
        viewModelScope.launch {
            val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            val fromMillis = runCatching { fmt.parse(from)!!.time }.getOrDefault(0L)
            val toMillis = runCatching { fmt.parse(to)!!.time + 24L * 60 * 60 * 1000 }.getOrDefault(Long.MAX_VALUE)
            val punches = runCatching { Attendance.punchesBetween(who.clinicId, fromMillis, toMillis) }.getOrDefault(emptyList())
            val rows = runCatching { ClinicSource.ledgerBetween(who.clinicId, from, to) }.getOrDefault(emptyList())
            val commissions = rows.filter { it.isPayment && it.doctorId.isNotBlank() && it.commission > 0 }
                .groupBy { it.doctorId }
                .mapValues { (_, list) -> list.sumOf { it.commission } }
            _state.value = _state.value.copy(periodPunches = punches, commissions = commissions)
        }
    }

    fun editStaff(member: Attendance.StaffMember) {
        if (!_state.value.canEditTeam) return
        _state.value = _state.value.copy(editingStaff = member, staffError = null)
    }

    fun closeStaff() {
        _state.value = _state.value.copy(editingStaff = null, staffError = null)
    }

    fun saveStaff(pct: Double, salary: Double, multiplier: Double, schedule: Map<Int, Attendance.DaySchedule>) {
        val who = _state.value.who ?: return
        val member = _state.value.editingStaff ?: return
        if (!_state.value.canEditTeam || _state.value.savingStaff) return
        _state.value = _state.value.copy(savingStaff = true, staffError = null)
        viewModelScope.launch {
            Attendance.saveStaffPay(who.clinicId, member, pct, salary, multiplier, schedule, who.name)
                .onSuccess {
                    _state.value = _state.value.copy(savingStaff = false, editingStaff = null)
                    loadStaff(who)
                    // The hourly rate and the expected hours both changed, so the pay figures did.
                    loadPayroll()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        savingStaff = false,
                        staffError = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "Only an Owner or Admin may change what somebody is paid."
                        } else e.message ?: "That could not be saved.",
                    )
                }
        }
    }

    fun decideOvertime(punchId: String, approved: Boolean) {
        val who = _state.value.who ?: return
        if (!_state.value.canSeeEveryone || _state.value.deciding != null) return
        _state.value = _state.value.copy(deciding = punchId, staffError = null)
        viewModelScope.launch {
            Attendance.decideOvertime(who.clinicId, punchId, approved)
                .onSuccess {
                    _state.value = _state.value.copy(deciding = null)
                    loadTeamPeriod()
                    loadPayroll()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        deciding = null,
                        staffError = e.message ?: "That decision could not be saved.",
                    )
                }
        }
    }

    private fun loadPayroll() {
        val who = _state.value.who ?: return
        if (!_state.value.canSeeEveryone) return
        val (from, to) = _state.value.period.range()
        _state.value = _state.value.copy(payrollLoading = true, payrollError = null)
        viewModelScope.launch {
            runCatching { PayrollClient.load(who.clinicId, from, to) }
                .onSuccess { _state.value = _state.value.copy(payrollLoading = false, payroll = it) }
                .onFailure { e ->
                    // The hours half can fail on its own — the server route gates
                    // more tightly than the roster does — so it says so in its own
                    // section rather than taking the screen down with it.
                    _state.value = _state.value.copy(
                        payrollLoading = false,
                        payrollError = when {
                            e.message?.contains("403") == true ||
                                e.message?.contains("permission", true) == true ->
                                "This account may see the roster but not the pay figures."
                            else -> "The hours could not be fetched."
                        },
                    )
                }
        }
    }

    // ------------------------------------------------------------------ my shift

    /**
     * Start or end my shift.
     *
     * When the clinic has set a location, the fix is checked before the punch is
     * written, and every refusal says which of the several things went wrong —
     * out of range, permission, location switched off, a fix too vague to judge.
     * An unconfigured fence is an absent fence, never a satisfied one.
     */
    fun punch(context: Context) {
        val who = _state.value.who ?: return
        if (_state.value.mine.busy) return
        _state.value = _state.value.copy(
            mine = _state.value.mine.copy(busy = true, error = null, needsLocation = false),
        )

        viewModelScope.launch {
            val fence = runCatching { Repository.loadGeofence(who.clinicId) }.getOrNull()
            var verdict: GeofenceVerdict? = null
            var accuracy: Double? = null

            if (isUsableGeofence(fence) && fence != null) {
                when (val fix = LocationFinder.bestPosition(context)) {
                    is LocationFinder.Result.Found -> {
                        accuracy = fix.reading.accuracy
                        verdict = judgeGeofence(fix.reading, fence)
                        if (!verdict.inside) {
                            return@launch fail(
                                "You are about ${verdict.effectiveDistance}m from the clinic. " +
                                    "Clocking in only works on site."
                            )
                        }
                    }
                    LocationFinder.Result.PermissionDenied ->
                        return@launch fail(
                            "This clinic checks you are on site, so location permission is needed.",
                            needsLocation = true,
                        )
                    LocationFinder.Result.Unavailable ->
                        return@launch fail("Location is switched off on this phone.")
                    LocationFinder.Result.TimedOut ->
                        return@launch fail("Could not get a location fix. Try again near a window.")
                    is LocationFinder.Result.TooInaccurate ->
                        return@launch fail(
                            "The location reading is too vague to tell whether you are at the clinic."
                        )
                }
            }

            val open = runCatching { Repository.openShift(who.clinicId, who.uid) }.getOrNull()
            val result = if (open != null) {
                Repository.clockOut(who.clinicId, open, verdict, accuracy)
            } else {
                Repository.clockIn(
                    clinicId = who.clinicId,
                    uid = who.uid,
                    userName = who.name,
                    staffId = _state.value.mine.staffId,
                    verdict = verdict,
                    accuracy = accuracy,
                )
            }

            result
                .onSuccess {
                    val now = runCatching { Repository.openShift(who.clinicId, who.uid) }.getOrNull()
                    _state.value = _state.value.copy(
                        mine = _state.value.mine.copy(busy = false, openSince = now?.checkInMillis, error = null),
                    )
                }
                .onFailure { e ->
                    fail(
                        if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to record attendance."
                        } else {
                            "That did not save. Try again."
                        }
                    )
                }
        }
    }

    private fun fail(message: String, needsLocation: Boolean = false) {
        _state.value = _state.value.copy(
            mine = _state.value.mine.copy(busy = false, error = message, needsLocation = needsLocation),
        )
    }

    fun dismissError() {
        _state.value = _state.value.copy(
            error = null,
            mine = _state.value.mine.copy(error = null),
        )
    }
}

/** Attendance, filled with the design's example data. See [previewDashboard]. */
fun previewAttendance(): AttendanceState {
    fun schedule(days: IntRange) = (0..6).associateWith {
        Attendance.DaySchedule(active = it in days, start = "13:00", end = "21:00")
    }
    fun member(id: String, name: String, role: String) =
        Attendance.StaffMember(id, "u$id", name, role, schedule(0..4), hasSchedule = true)

    val now = System.currentTimeMillis()
    fun punch(id: String, member: Attendance.StaffMember, startedMinutesAgo: Long, done: Boolean = false) =
        Attendance.Punch(
            id = id, userId = member.uid, staffId = member.id, userName = member.name,
            checkInMillis = now - startedMinutesAgo * 60_000,
            checkOutMillis = if (done) now - 20 * 60_000 else null,
            durationMinutes = if (done) (startedMinutesAgo - 20).toInt() else 0,
            status = if (done) "completed" else "active",
        )

    val staff = listOf(
        member("s1", "Mona Adel", "Receptionist"),
        member("s2", "Dr. Youssef Kamal", "Dentist"),
        member("s3", "Nour Hassan", "Dentist"),
        member("s4", "Sara Fouad", "Assistant"),
    )
    return AttendanceState(
        loading = false,
        who = previewDashboard().who,
        staff = staff,
        punches = listOf(
            punch("a1", staff[0], 240),
            punch("a2", staff[1], 180),
            punch("a3", staff[3], 300, done = true),
        ),
        mine = MyShift(staffId = "s1", openSince = now - 240 * 60_000),
        period = Period.ThisWeek,
        payroll = PayrollClient.Payroll(
            from = "", to = "",
            staff = listOf(
                PayrollClient.StaffPay("s1", "Mona Adel", "Receptionist", 5, 2_280, 35, 0, 90, 0, 6_500.0, true),
                PayrollClient.StaffPay("s2", "Dr. Youssef Kamal", "Dentist", 4, 1_800, 0, 1, 0, 120, 0.0, true),
                PayrollClient.StaffPay("s3", "Nour Hassan", "Dentist", 5, 2_100, 12, 0, 0, 0, 0.0, false),
                PayrollClient.StaffPay("s4", "Sara Fouad", "Assistant", 5, 2_400, 0, 0, 240, 0, 4_000.0, true),
            ),
            labourCost = 10_500.0,
            overtimePendingMinutes = 120,
            overtimePendingCost = 340.0,
            notes = listOf("Commission is not included.", "Pending overtime is not paid until approved."),
        ),
    )
}
