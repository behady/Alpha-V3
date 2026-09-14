package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Lead
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/** The pipe a lead moves down, in the website's own vocabulary. */
enum class LeadStage(val stored: String, val label: String) {
    New("new", "Not called"),
    Contacted("contacted", "Contacted"),
    Booked("booked", "Booked"),
    // "In the chair" rather than "Won": a lead is won when somebody turns up, and
    // the word on the screen should be the thing that happened.
    Won("won", "In the chair"),
    Lost("lost", "Lost"),
    ;

    val isClosed: Boolean get() = this == Won || this == Lost

    companion object {
        fun from(raw: String?): LeadStage =
            entries.firstOrNull { it.stored.equals(raw?.trim(), ignoreCase = true) } ?: New

        /** The stages a person can move a lead to by hand. Winning goes through converting. */
        val settable: List<LeadStage> = listOf(New, Contacted, Booked, Lost)
    }
}

enum class LeadFilter(val label: String) {
    ToCall("To call"),
    Due("Due"),
    Working("Working"),
    Won("In the chair"),
    Lost("Lost"),
    All("All"),
}

/** One lead, with the arithmetic the inbox sorts by. */
data class LeadRow(val lead: Lead) {
    val stage: LeadStage get() = LeadStage.from(lead.stage)

    /** Hours since it arrived. The number that decides whether a lead converts. */
    val ageHours: Long
        get() = if (lead.createdAtMillis <= 0) 0
        else TimeUnit.MILLISECONDS.toHours(System.currentTimeMillis() - lead.createdAtMillis)

    val ageLabel: String
        get() = when {
            lead.createdAtMillis <= 0 -> "no date"
            ageHours < 1 -> "just in"
            ageHours < 24 -> "${ageHours}h old"
            ageHours < 24 * 14 -> "${ageHours / 24}d old"
            else -> "${ageHours / 24 / 7}w old"
        }

    /** Days until the follow-up is due. Negative is overdue; null means none set. */
    val followUpIn: Long?
        get() = lead.followUpDate.takeIf { it.isNotBlank() }
            ?.let { daysBetweenKeys(ClinicSource.dateKey(), it) }

    val followUpDue: Boolean
        get() = !stage.isClosed && (followUpIn ?: Long.MAX_VALUE) <= 0L

    /** Nobody has touched it. The whole reason this screen exists. */
    val uncalled: Boolean get() = stage == LeadStage.New

    /**
     * Uncalled for longer than a working day.
     *
     * Not a rule anybody wrote down — it is simply the point past which a lead
     * has stopped being a lead and become an apology.
     */
    val cold: Boolean get() = uncalled && ageHours >= 24

    /** This number already has a patient file. Worth knowing before you dial. */
    val known: Boolean get() = lead.existingPatientName.isNotBlank()

    val followUpLabel: String?
        get() {
            val days = followUpIn ?: return null
            return when {
                days < -1 -> "follow-up ${-days} days overdue"
                days == -1L -> "follow-up overdue"
                days == 0L -> "follow up today"
                days == 1L -> "follow up tomorrow"
                else -> "follow up in $days days"
            }
        }
}

data class Leads(
    val loading: Boolean = true,
    val who: Who? = null,
    val leads: List<LeadRow> = emptyList(),
    val filter: LeadFilter = LeadFilter.ToCall,
    val open: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    /** Set after a conversion, so the screen can say which of the two happened. */
    val converted: String? = null,
    /** The clinic's own source list, merged with the defaults. */
    val sources: List<String> = DEFAULT_LEAD_SOURCES,
) {
    val canEdit: Boolean get() = who?.can("access.marketing") == true

    val openLead: LeadRow? get() = leads.firstOrNull { it.lead.id == open }

    val toCall: List<LeadRow> get() = leads.filter { it.uncalled }
    val due: List<LeadRow> get() = leads.filter { it.followUpDue }
    val working: List<LeadRow>
        get() = leads.filter { it.stage == LeadStage.Contacted || it.stage == LeadStage.Booked }
    val won: List<LeadRow> get() = leads.filter { it.stage == LeadStage.Won }
    val lost: List<LeadRow> get() = leads.filter { it.stage == LeadStage.Lost }

    val shown: List<LeadRow>
        get() = when (filter) {
            LeadFilter.ToCall -> toCall
            LeadFilter.Due -> due
            LeadFilter.Working -> working
            LeadFilter.Won -> won
            LeadFilter.Lost -> lost
            LeadFilter.All -> leads
        }.sortedWith(
            // Overdue follow-ups, then oldest-uncalled. Both ahead of anything
            // tidy: the cost of a lead is entirely in how long it waits, and a
            // list in arrival order buries the one that has waited longest.
            compareBy<LeadRow>(
                { if (it.followUpDue) 0 else 1 },
                { it.followUpIn ?: Long.MAX_VALUE },
            ).thenByDescending { it.ageHours }
        )
}

/** What a clinic can say a lead came from, before it adds its own. */
val DEFAULT_LEAD_SOURCES = listOf(
    "Walk-in", "Phone call", "WhatsApp", "Meta ads", "Google", "Instagram", "TikTok", "Friend referral",
)

/**
 * The leads inbox.
 *
 * Sorted by how long somebody has been waiting for a call, because that is the
 * only thing about a lead that costs money. Everything else on the screen is in
 * service of the one action: ring them.
 *
 * Reads and writes are `Repository`'s, which already mirrors the website's own
 * rules — the first move off "new" stamps the time-to-first-contact clock and
 * never touches it again, and "won" cannot be set by hand because winning means
 * a patient file exists on the other end of it.
 */
class LeadsModel : ViewModel() {

    private val _state = MutableStateFlow(Leads())
    val state: StateFlow<Leads> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.marketing")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see the clinic's leads.",
                        )
                        return@onSuccess
                    }
                    load()
                    loadSources(who.clinicId)
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    private fun load() {
        val who = _state.value.who ?: return
        viewModelScope.launch {
            runCatching { Repository.loadLeads(who.clinicId) }
                .onSuccess { rows ->
                    _state.value = _state.value.copy(
                        loading = false, busy = false, leads = rows.map(::LeadRow), error = null,
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, busy = false, error = readable(e))
                }
        }
    }

    private fun loadSources(clinicId: String) = viewModelScope.launch {
        val own = runCatching {
            com.alphadental.clinic.data.ClinicSettings.loadList(
                clinicId, com.alphadental.clinic.data.ClinicSettings.PATIENT_SOURCES,
            )
        }.getOrDefault(emptyList())
        // The clinic's own list first, then whatever of the defaults it does not
        // already have. A clinic that renamed "Walk-in" should not be offered
        // both spellings.
        _state.value = _state.value.copy(
            sources = (own + DEFAULT_LEAD_SOURCES).distinctBy { it.trim().lowercase() },
        )
    }

    fun refresh() = load()

    fun show(filter: LeadFilter) {
        _state.value = _state.value.copy(filter = filter)
    }

    fun open(id: String) {
        _state.value = _state.value.copy(open = id, error = null, converted = null)
    }

    fun close() {
        _state.value = _state.value.copy(open = null, error = null, converted = null)
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null, converted = null)
    }

    // ------------------------------------------------------------------ writes

    fun setStage(stage: LeadStage, lostReason: String? = null) {
        val who = _state.value.who ?: return
        val row = _state.value.openLead ?: return
        if (!_state.value.canEdit || stage == LeadStage.Won) return
        write { Repository.setLeadStage(who.clinicId, row.lead, stage.stored, lostReason) }
    }

    /**
     * Turn a lead into a patient.
     *
     * A file with the same number is linked rather than duplicated, and only a
     * genuinely new person is given a file number — from the same counter
     * transaction the website and the booking flow use, so two people converting
     * at once cannot both be handed PT-1042.
     */
    fun convert() {
        val who = _state.value.who ?: return
        val row = _state.value.openLead ?: return
        if (!_state.value.canEdit) return
        _state.value = _state.value.copy(busy = true, error = null, converted = null)
        viewModelScope.launch {
            Repository.convertLeadToPatient(who.clinicId, row.lead)
                .onSuccess { (_, existed) ->
                    _state.value = _state.value.copy(
                        converted = if (existed) {
                            "Linked to the file this number already had — no second record made."
                        } else {
                            "A new patient file was opened."
                        },
                    )
                    load()
                }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    fun setFollowUp(dateKey: String?) {
        val who = _state.value.who ?: return
        val row = _state.value.openLead ?: return
        if (!_state.value.canEdit) return
        write { Repository.setLeadFollowUp(who.clinicId, row.lead.id, dateKey) }
    }

    fun setNotes(notes: String) {
        val who = _state.value.who ?: return
        val row = _state.value.openLead ?: return
        if (!_state.value.canEdit) return
        write { Repository.setLeadNotes(who.clinicId, row.lead.id, notes) }
    }

    fun add(name: String, phone: String, source: String, interest: String, notes: String) {
        val who = _state.value.who ?: return
        if (!_state.value.canEdit || name.isBlank()) return
        write {
            Repository.addLead(
                clinicId = who.clinicId,
                name = name, phone = phone, source = source,
                interest = interest, notes = notes, byName = who.name,
            )
        }
    }

    private fun write(action: suspend () -> Result<Unit>) {
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            action()
                .onSuccess { load() }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) ->
                "This account is not allowed to change leads."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. Nothing was changed."
            // require() failures carry a sentence worth showing as written.
            e is IllegalArgumentException && raw.isNotBlank() -> raw
            else -> "That could not be saved."
        }
    }
}

/** Whole days from `from` to `to`, both "yyyy-MM-dd". Negative when `to` is past. */
private fun daysBetweenKeys(from: String, to: String): Long? {
    if (from.isBlank() || to.isBlank()) return null
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val a = runCatching { fmt.parse(from) }.getOrNull() ?: return null
    val b = runCatching { fmt.parse(to) }.getOrNull() ?: return null
    return TimeUnit.MILLISECONDS.toDays(b.time - a.time)
}

/** Leads, filled with the design's example data. See [previewDashboard]. */
fun previewLeads(): Leads {
    fun hoursAgo(h: Long) = System.currentTimeMillis() - h * 60 * 60 * 1000
    fun day(offset: Int) = ClinicSource.dateKey(
        Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, offset) }.time
    )
    fun lead(
        id: String, name: String, phone: String, interest: String, source: String,
        stage: String, hours: Long, followUp: String = "", known: String = "", contacted: Boolean = false,
        lost: String = "",
    ) = LeadRow(
        Lead(
            id = id, name = name, phone = phone, interest = interest, source = source,
            stage = stage, lostReason = lost, notes = "",
            followUpDate = followUp, patientId = if (stage == "won") "p1" else "",
            existingPatientName = known, hasFirstContact = contacted,
            createdAtMillis = hoursAgo(hours),
        )
    )
    return Leads(
        loading = false,
        who = previewDashboard().who,
        filter = LeadFilter.ToCall,
        leads = listOf(
            lead("l1", "Mostafa Kamal", "+201001110001", "Braces", "Meta ads", "new", 2),
            lead("l2", "Nourhan Adel", "+201001110002", "Whitening", "Instagram", "new", 30),
            lead("l3", "Tarek Hosny", "+201001110003", "Implant", "Phone call", "contacted", 70,
                followUp = day(-2), contacted = true),
            lead("l4", "Aya Mahmoud", "+201001110004", "Check-up", "Walk-in", "booked", 120,
                followUp = day(1), known = "Aya Mahmoud", contacted = true),
            lead("l5", "Sherif Adly", "+201001110005", "Crown", "Google", "won", 400, contacted = true),
            lead("l6", "Heba Samir", "+201001110006", "Braces", "TikTok", "lost", 700,
                contacted = true, lost = "Price"),
        ),
    )
}
