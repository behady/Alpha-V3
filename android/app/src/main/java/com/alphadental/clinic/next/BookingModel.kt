package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.Patient
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Hours
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

data class Booking(
    val open: Boolean = false,
    val who: Who? = null,
    val loading: Boolean = true,

    val query: String = "",
    val results: List<Person> = emptyList(),
    val searching: Boolean = false,
    val patient: Person? = null,

    val doctors: List<Doctor> = emptyList(),
    val doctor: Doctor? = null,
    val services: List<Service> = emptyList(),
    val service: Service? = null,

    val dateKey: String = ClinicSource.dateKey(),
    val time: String = "",
    val minutes: Int = 30,
    val notes: String = "",

    /** What is already booked that day, so a clash can be shown rather than created. */
    val taken: List<Visit> = emptyList(),
    val hours: Hours = Hours(),

    val saving: Boolean = false,
    val error: String? = null,
    val bookedId: String? = null,
) {
    val canBook: Boolean get() = who?.can("appointments.add") == true

    /** Enough to write: somebody to see, and a time to see them. */
    val ready: Boolean
        get() = (patient != null || query.trim().length >= 2) && time.isNotBlank() && !saving

    /** True when this slot already has somebody in it. */
    val clash: Visit?
        get() {
            if (time.isBlank()) return null
            val start = minutesOf(time) ?: return null
            val end = start + minutes
            return taken.firstOrNull { visit ->
                val s = visit.minuteOfDay
                val e = s + visit.duration.coerceAtLeast(5)
                start < e && s < end
            }
        }

    /** Every slot the clinic's own opening hours allow that day. */
    val slots: List<String>
        get() {
            if (!hours.configured) {
                // No hours set means no honest slot list. A nine-to-five guess
                // would offer times the clinic is shut, so the field is typed.
                return emptyList()
            }
            val step = hours.slot.coerceAtLeast(5)
            return generateSequence(hours.startMinute) { it + step }
                .takeWhile { it + step <= hours.closes }
                .map { "%02d:%02d".format(it / 60, it % 60) }
                .toList()
        }

    val dateLabel: String
        get() = runCatching {
            val d = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey)!!
            SimpleDateFormat("EEEE d MMMM", Locale.US).format(d)
        }.getOrDefault(dateKey)
}

private fun minutesOf(time: String): Int? {
    val parts = time.trim().split(":")
    if (parts.size < 2) return null
    val h = parts[0].toIntOrNull() ?: return null
    val m = parts[1].take(2).toIntOrNull() ?: return null
    return h * 60 + m
}

/**
 * Booking a patient in.
 *
 * The most-used write in a clinic, so it is the one that most needs to be one
 * sheet rather than a wizard: who, when, what, save.
 *
 * A name nobody recognises opens a file rather than refusing. At a desk "Hana is
 * here" and "Hana is here and has never been before" are the same sentence until
 * the search comes back empty, and making somebody back out to a different screen
 * to register her — while she stands there — is how appointments end up booked
 * under the wrong person.
 *
 * `Repository.createAppointment` does the writing, and its own comment is the
 * reason it is reused rather than reinvented: every field matches what the
 * browser writes, because a record this phone creates has to be indistinguishable
 * from one the desk creates. It also deliberately posts nothing to the ledger —
 * invoicing is a separate act on the patient's file.
 */
class BookingModel : ViewModel() {

    private val _state = MutableStateFlow(Booking())
    val state: StateFlow<Booking> = _state.asStateFlow()

    private var searchJob: Job? = null

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who, loading = false)
                    loadLists(who)
                    loadDay(who, _state.value.dateKey)
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    /** Open the sheet, optionally on a day and time the person already picked. */
    fun open(dateKey: String? = null, time: String? = null) {
        _state.value = _state.value.copy(
            open = true,
            error = null,
            bookedId = null,
            dateKey = dateKey ?: _state.value.dateKey,
            time = time ?: "",
        )
        start()
        val who = _state.value.who ?: return
        loadDay(who, _state.value.dateKey)
    }

    fun close() {
        // Everything typed is cleared. A half-filled booking sheet reopening
        // three hours later, against a different patient, is a mis-booking.
        _state.value = Booking(who = _state.value.who, loading = false)
    }

    private fun loadLists(who: Who) = viewModelScope.launch {
        val doctors = runCatching { Repository.loadDoctors(who.clinicId) }.getOrDefault(emptyList())
        val services = runCatching { Repository.loadServices(who.clinicId) }.getOrDefault(emptyList())
        _state.value = _state.value.copy(doctors = doctors, services = services)
    }

    private fun loadDay(who: Who, dateKey: String) = viewModelScope.launch {
        val hours = runCatching { ClinicSource.hours(who.clinicId) }.getOrDefault(Hours())
        _state.value = _state.value.copy(hours = hours)
        ClinicSource.watchDay(who.clinicId, dateKey).collect { visits ->
            _state.value = _state.value.copy(taken = visits)
        }
    }

    // ------------------------------------------------------------------ fields

    fun search(term: String) {
        _state.value = _state.value.copy(query = term, patient = null)
        val who = _state.value.who ?: return
        searchJob?.cancel()
        if (term.trim().length < 2) {
            _state.value = _state.value.copy(results = emptyList(), searching = false)
            return
        }
        searchJob = viewModelScope.launch {
            // A pause, so a name being typed is one search rather than eight.
            delay(280)
            _state.value = _state.value.copy(searching = true)
            val hits = runCatching { ClinicSource.searchPeople(who.clinicId, term) }.getOrDefault(emptyList())
            _state.value = _state.value.copy(results = hits.take(6), searching = false)
        }
    }

    fun choose(person: Person?) {
        _state.value = _state.value.copy(
            patient = person,
            query = person?.name ?: "",
            results = emptyList(),
        )
    }

    fun setDoctor(doctor: Doctor?) {
        _state.value = _state.value.copy(doctor = doctor)
    }

    /**
     * Picking a treatment fills the length from the price list.
     *
     * Only when nobody has already changed it by hand — a receptionist who set
     * ninety minutes for a nervous patient should not have it silently reset by
     * choosing what the appointment is for.
     */
    fun setService(service: Service?) {
        val current = _state.value
        val untouched = current.service?.durationMinutes ?: 30
        val keepLength = current.minutes != untouched && current.minutes != 30
        _state.value = current.copy(
            service = service,
            minutes = if (keepLength) current.minutes
            else (service?.durationMinutes?.takeIf { it > 0 } ?: 30),
        )
    }

    fun setDate(dateKey: String) {
        _state.value = _state.value.copy(dateKey = dateKey, time = "")
        val who = _state.value.who ?: return
        loadDay(who, dateKey)
    }

    fun shiftDay(days: Int) {
        val cal = Calendar.getInstance().apply {
            time = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(_state.value.dateKey) }
                .getOrNull() ?: java.util.Date()
            add(Calendar.DAY_OF_YEAR, days)
        }
        setDate(ClinicSource.dateKey(cal.time))
    }

    fun setTime(time: String) {
        _state.value = _state.value.copy(time = time)
    }

    fun setMinutes(minutes: Int) {
        _state.value = _state.value.copy(minutes = minutes.coerceIn(5, 480))
    }

    fun setNotes(notes: String) {
        _state.value = _state.value.copy(notes = notes)
    }

    // ------------------------------------------------------------------ save

    fun book() {
        val s = _state.value
        val who = s.who ?: return
        if (!s.canBook || !s.ready) return

        _state.value = s.copy(saving = true, error = null)
        viewModelScope.launch {
            val patient = s.patient?.let {
                Patient(id = it.id, name = it.name, phone = it.phone, balance = it.balance)
            } ?: run {
                // Nobody matched, so the name typed becomes a new file. Its
                // number comes from the shared counter transaction, which is the
                // one step here that needs a connection.
                Repository.createPatient(who.clinicId, s.query.trim(), "")
                    .getOrElse {
                        _state.value = _state.value.copy(
                            saving = false,
                            error = it.message ?: "That patient could not be created.",
                        )
                        return@launch
                    }
            }

            Repository.createAppointment(
                clinicId = who.clinicId,
                patient = patient,
                doctor = s.doctor,
                dateKey = s.dateKey,
                time = s.time,
                durationMinutes = s.minutes,
                treatment = s.service?.name.orEmpty(),
                notes = s.notes,
                service = s.service,
                byName = who.name,
            )
                .onSuccess { id ->
                    _state.value = _state.value.copy(saving = false, bookedId = id, open = false)
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        saving = false,
                        error = e.message ?: "That appointment could not be saved.",
                    )
                }
        }
    }

    fun clearBooked() {
        _state.value = _state.value.copy(bookedId = null)
    }
}
