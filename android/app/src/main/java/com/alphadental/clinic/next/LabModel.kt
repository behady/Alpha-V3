package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.LabAccounts
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Which slice of the board is showing.
 *
 * "Open" is the default rather than "All", because a board that opens on every
 * case the clinic has ever sent is a filing cabinet. What anyone opens this
 * screen for is the work still in flight.
 */
enum class LabFilter(val label: String) {
    Open("Open"),
    Overdue("Overdue"),
    Waiting("Back & waiting"),
    All("All"),
}

/** The board, or the money. */
enum class LabTab(val label: String) { Board("Board"), Accounts("Accounts") }

data class Lab(
    val loading: Boolean = true,
    val who: Who? = null,
    val cases: List<LabCases.LabCase> = emptyList(),
    val filter: LabFilter = LabFilter.Open,
    val error: String? = null,
    /** The case being looked at, by id. Not `open` — that already means the open cases. */
    val openId: String? = null,
    val moving: Boolean = false,
    val tab: LabTab = LabTab.Board,
    val labs: List<LabCases.Lab> = emptyList(),
    val payments: List<LabAccounts.Payment> = emptyList(),
    /** The lab whose statement is open, by id. */
    val openLabId: String? = null,
    /** The payment sheet is up for the open lab. */
    val paying: Boolean = false,
    /** The case a remake is being raised off. */
    val remakingId: String? = null,
    val created: String? = null,
) {
    /** A payment is a finance write, as the rules have it; removing one needs finance.delete. */
    val canPay: Boolean get() = who?.can("finance.add") == true
    val canDeletePayment: Boolean get() = who?.can("finance.delete") == true

    val accounts: List<LabAccounts.Account> get() = LabAccounts.accounts(labs, cases, payments)
    val owed: Double get() = accounts.sumOf { it.outstanding }
    val paidTotal: Double get() = accounts.sumOf { it.paid }
    val atLabs: Double get() = accounts.sumOf { it.committed }
    val unpriced: Int get() = accounts.sumOf { it.unpriced }
    val openAccount: LabAccounts.Account? get() = accounts.firstOrNull { it.labId == openLabId }
    val openStatement: List<LabAccounts.Line> get() = openLabId?.let { LabAccounts.statement(it, cases, payments) }.orEmpty()
    val remaking: LabCases.LabCase? get() = cases.firstOrNull { it.id == remakingId }

    /** Moving a case along is a clinical write, as the rules have it. */
    val canMove: Boolean get() = who?.can("clinical.edit") == true

    /** Deleting a mistyped order is gated on access.lab by the rules, as on the website. */
    val canDelete: Boolean get() = who?.can("access.lab") == true

    val openCase: LabCases.LabCase? get() = cases.firstOrNull { it.id == openId }
    val today: String get() = ClinicSource.dateKey()

    val summary: LabCases.Summary get() = LabCases.summarise(cases, today)

    /** Everything not yet fitted or cancelled — the work still in flight. */
    val open: List<LabCases.LabCase> get() = cases.filterNot { it.meta.closed }

    val overdue: List<LabCases.LabCase>
        get() = cases.filter { LabCases.dueStateFor(it, today) == LabCases.Due.OVERDUE }

    /**
     * Back from the lab and sitting on the desk.
     *
     * The count nobody else keeps, and the one that actually costs a clinic
     * money: a crown that arrived a fortnight ago and never got fitted is paid
     * for, finished, and earning nothing.
     */
    val waiting: List<LabCases.LabCase> get() = cases.filter { it.status == "back" }

    val shown: List<LabCases.LabCase>
        get() = when (filter) {
            LabFilter.Open -> open
            LabFilter.Overdue -> overdue
            LabFilter.Waiting -> waiting
            LabFilter.All -> cases
        }.sortedWith(
            // Late first, then whatever is due soonest. A board sorted by when a
            // case was created tells you about the past; this one is a queue.
            compareBy(
                { if (LabCases.dueStateFor(it, today) == LabCases.Due.OVERDUE) 0 else 1 },
                // A case with no due date sorts after the dated ones, and among
                // those, the one that has sat on the desk longest comes first.
                { it.dueDate.ifBlank { "9999-" + it.receivedAt.ifBlank { "9999-99-99" } } },
                { it.code },
            )
        )
}

/**
 * The lab board.
 *
 * A listener, because a case marked back at the desk must stop showing as out at
 * the lab on somebody's phone without a refresh.
 *
 * The whole model — stages, which stage may follow which, what counts as
 * overdue — is the one in `LabCases`, shared with the old app and mirroring
 * `labCaseWrite.ts`. Nothing here re-derives it: a second opinion about when a
 * crown is late is exactly the sort of thing that ends with two screens
 * disagreeing in front of a patient.
 */
class LabModel : ViewModel() {

    private val _state = MutableStateFlow(Lab())
    val state: StateFlow<Lab> = _state.asStateFlow()

    private var watch: Job? = null
    private var watchPayments: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.lab")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see the lab board.",
                        )
                        return@onSuccess
                    }
                    observe(who)
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    private fun observe(who: Who) {
        viewModelScope.launch {
            val labs = runCatching { LabCases.loadLabs(who.clinicId) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(labs = labs)
        }
        watchPayments?.cancel()
        watchPayments = viewModelScope.launch {
            LabAccounts.observePayments(who.clinicId).collect { result ->
                result.onSuccess { payments -> _state.value = _state.value.copy(payments = payments) }
            }
        }
        watch?.cancel()
        watch = viewModelScope.launch {
            LabCases.observeCases(who.clinicId).collect { result ->
                result
                    .onSuccess { cases ->
                        _state.value = _state.value.copy(loading = false, cases = cases, error = null)
                    }
                    .onFailure { e ->
                        _state.value = _state.value.copy(
                            loading = false,
                            error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                                "This account is not allowed to see the lab board."
                            } else {
                                "The lab board could not be read."
                            },
                        )
                    }
            }
        }
    }

    fun openCase(id: String?) {
        _state.value = _state.value.copy(openId = id, error = null)
    }

    /**
     * Move a case to its next stage.
     *
     * This is the half of lab tracking that happens away from a desk: a driver
     * arrives with a bag, a crown is fitted chairside. Raising the order —
     * shades, teeth, the agreed price — stays on the website, where there is a
     * keyboard and the form is long.
     *
     * The write is LabCases.advance, which stamps the date each stage owns and
     * only on first arrival: re-entering "back" after a remake must not rewrite
     * the day the original first came in.
     */
    fun move(to: String) {
        val who = _state.value.who ?: return
        val case = _state.value.openCase ?: return
        if (!_state.value.canMove || _state.value.moving) return
        _state.value = _state.value.copy(moving = true, error = null)
        viewModelScope.launch {
            LabCases.advance(who.clinicId, case, to, who.name, ClinicSource.dateKey())
                .onSuccess {
                    _state.value = _state.value.copy(moving = false)
                    // The board is a listener, so the row updates itself. Ringing
                    // the clinic's bell is best effort: the case has arrived
                    // either way, and a failed reminder must not undo the move.
                    if (to == "back") runCatching { LabCases.notifyBack(who.clinicId, case, false) }
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        moving = false,
                        error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to move lab cases."
                        } else {
                            "That could not be saved."
                        },
                    )
                }
        }
    }

    /** Delete the open case — for an order entered by mistake. The board's listener drops the row. */
    fun delete() {
        val who = _state.value.who ?: return
        val case = _state.value.openCase ?: return
        if (!_state.value.canDelete || _state.value.moving) return
        _state.value = _state.value.copy(moving = true, error = null)
        viewModelScope.launch {
            LabCases.deleteCase(who.clinicId, case.id)
                .onSuccess { _state.value = _state.value.copy(moving = false, openId = null) }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        moving = false,
                        error = if (e.message?.contains("PERMISSION_DENIED", true) == true) {
                            "This account is not allowed to delete lab cases."
                        } else {
                            "That could not be deleted."
                        },
                    )
                }
        }
    }

    fun show(filter: LabFilter) {
        _state.value = _state.value.copy(filter = filter)
    }

    fun showTab(tab: LabTab) {
        _state.value = _state.value.copy(tab = tab, error = null)
    }

    fun openLab(labId: String?) {
        _state.value = _state.value.copy(openLabId = labId, paying = false, error = null)
    }

    fun pay(open: Boolean) {
        _state.value = _state.value.copy(paying = open, error = null)
    }

    /**
     * Settle part or all of what a lab is owed. Writes `lab_payments` and nothing else — the lab
     * fee was already booked as a cost when the treatment was saved.
     */
    fun recordPayment(amount: Double, date: String, method: String, reference: String, note: String) {
        val who = _state.value.who ?: return
        val account = _state.value.openAccount ?: return
        if (!_state.value.canPay || _state.value.moving) return
        _state.value = _state.value.copy(moving = true, error = null)
        viewModelScope.launch {
            LabAccounts.record(who.clinicId, account.labId, account.labName, amount, date, method, reference, note, who.name)
                .onSuccess { _state.value = _state.value.copy(moving = false, paying = false) }
                .onFailure { e -> _state.value = _state.value.copy(moving = false, error = readable(e, "That payment could not be saved.")) }
        }
    }

    /** A mistyped amount or a duplicate. The listener drops the row. */
    fun deletePayment(id: String) {
        val who = _state.value.who ?: return
        if (!_state.value.canDeletePayment || _state.value.moving) return
        _state.value = _state.value.copy(moving = true, error = null)
        viewModelScope.launch {
            LabAccounts.delete(who.clinicId, id)
                .onSuccess { _state.value = _state.value.copy(moving = false) }
                .onFailure { e -> _state.value = _state.value.copy(moving = false, error = readable(e, "That payment could not be removed.")) }
        }
    }

    fun startRemake(caseId: String?) {
        _state.value = _state.value.copy(remakingId = caseId, openId = null, error = null, created = null)
    }

    /**
     * Raise a remake off the open case — the website's `createRemake`.
     *
     * The original stays as it is: it happened, and rewriting it would lose the fact that the
     * first attempt failed. The replacement copies every detail, gets its own number with an
     * `-R2` suffix and a pointer back, and goes out today. Whose fault it was decides the money:
     * a remake the lab owns costs nothing, and 0 is a real price here.
     */
    fun remake(reason: String, fault: String, price: Double) {
        val who = _state.value.who ?: return
        val original = _state.value.remaking ?: return
        if (!_state.value.canMove || _state.value.moving) return
        _state.value = _state.value.copy(moving = true, error = null)
        viewModelScope.launch {
            val lab = _state.value.labs.firstOrNull { it.id == original.labId }
            val draft = LabCases.draftOf(original).copy(
                status = "at_lab",
                sentAt = ClinicSource.dateKey(),
                dueDate = if (lab != null && lab.turnaroundDays > 0) LabCases.dueInDays(lab.turnaroundDays) else "",
                agreedPrice = price.coerceAtLeast(0.0),
            )
            LabCases.createCase(who.clinicId, draft, who.name, remakeOf = original, remakeReason = reason, remakeFault = fault)
                .onSuccess { made -> _state.value = _state.value.copy(moving = false, remakingId = null, created = made.code) }
                .onFailure { e -> _state.value = _state.value.copy(moving = false, error = readable(e, "The remake could not be raised.")) }
        }
    }

    fun clearCreated() {
        _state.value = _state.value.copy(created = null)
    }

    private fun readable(e: Throwable, fallback: String): String =
        if (e.message?.contains("PERMISSION_DENIED", true) == true) "This account is not allowed to do that." else e.message?.takeIf { it.isNotBlank() && !it.contains("firestore", true) } ?: fallback
}

/** The board, filled with the design's example data. See [previewDashboard]. */
fun previewLab(): Lab {
    fun day(offset: Int) = ClinicSource.dateKey(
        java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, offset) }.time
    )
    fun case(
        code: String, patient: String, work: String, lab: String,
        status: String, due: Int?, units: Int, doctor: String,
        remakeOf: String = "", received: Int? = null,
    ) = LabCases.LabCase(
        id = code, code = code, codeNumber = 0, branchId = "", branchCode = "MAD", branchName = "",
        patientId = "", patientName = patient, patientPhone = "",
        doctorId = "", doctorName = doctor, labId = lab, labName = lab,
        workType = work, workDescription = work, units = units, teeth = emptyList(),
        bodyShade = "A2", cervicalShade = "", gumShade = "", material = "Zirconia",
        implantSystem = "", implantPlatform = "", abutmentType = "", retention = "", guideType = "", sleeveSystem = "",
        notes = "", agreedPrice = 1200.0, sentVia = "driver",
        status = status, needsTryIn = false,
        sentAt = day(-10), dueDate = due?.let { day(it) }.orEmpty(),
        receivedAt = received?.let { day(it) }.orEmpty(), fittedAt = "", events = emptyList(),
        remakeOfId = remakeOf, remakeOfCode = remakeOf, remakeFault = if (remakeOf.isBlank()) "" else "lab", remakeReason = "",
        remakeRound = if (remakeOf.isBlank()) 0 else 2,
    )
    return Lab(
        loading = false,
        who = previewDashboard().who,
        filter = LabFilter.Open,
        cases = listOf(
            case("MAD-0142", "Mariam Hassan", "Zirconia crown", "Cairo Dental Lab", "at_lab", -3, 1, "Dr. Youssef"),
            case("MAD-0139", "Khaled Mostafa", "PFM bridge", "Cairo Dental Lab", "at_lab", 0, 3, "Dr. Nour"),
            case("MAD-0144", "Yara Sameh", "Night guard", "Smile Works", "at_lab", 2, 1, "Dr. Youssef"),
            case("MAD-0131", "Omar Abdelrahman", "Zirconia crown", "Cairo Dental Lab", "back", null, 1, "Dr. Nour", received = -4),
            case("MAD-0128", "Salma Ibrahim", "E-max veneer", "Smile Works", "back", null, 6, "Dr. Youssef", received = -16),
            case("MAD-0147", "Hania Adel", "Zirconia crown", "Cairo Dental Lab", "returned_to_lab", 4, 1, "Dr. Nour", remakeOf = "MAD-0121"),
            case("MAD-0120", "Ahmed Zaki", "Denture", "Cairo Dental Lab", "fitted", null, 1, "Dr. Nour"),
        ),
    )
}
