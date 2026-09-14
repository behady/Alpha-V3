package com.alphadental.clinic.next

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.SmsSource
import com.alphadental.clinic.next.data.Who
import com.alphadental.clinic.sms.SmsPairing
import com.alphadental.clinic.sms.SmsPrefs
import com.alphadental.clinic.sms.SmsWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import java.util.Calendar

/** What this handset, specifically, is doing about the clinic's reminders. */
data class Phone(
    /** Bound to a clinic by code. Until then this phone sends for nobody. */
    val paired: Boolean = false,
    val sender: Boolean = false,
    /** Android's SEND_SMS permission. Only the person holding the phone can grant it. */
    val permitted: Boolean = false,
    /** The worker's own words about its last wake-up. */
    val lastResult: String = "",
    val lastRunAt: Long = 0L,
    val sentTotal: Int = 0,
    val pairing: Boolean = false,
    val pairError: String? = null,
)

data class Sms(
    val loading: Boolean = true,
    val who: Who? = null,
    val setup: SmsSource.Setup = SmsSource.Setup(),
    val queue: List<SmsSource.Outgoing> = emptyList(),
    val recent: List<SmsSource.Outgoing> = emptyList(),
    val senders: List<SmsSource.Sender> = emptyList(),
    val phone: Phone = Phone(),
    val saving: Boolean = false,
    val error: String? = null,
) {
    /**
     * Whether the clinic-wide settings may be changed from here.
     *
     * Admin only, because that is what Firestore's rules allow. Drawing a switch
     * the server will refuse teaches someone that the app is broken.
     */
    val canEdit: Boolean get() = who?.isAdmin == true

    val liveSenders: List<SmsSource.Sender> get() = senders.filter { it.alive }

    val failed: List<SmsSource.Outgoing> get() = recent.filter { it.failed }

    private val startOfToday: Long
        get() = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis

    val sentToday: Int
        get() = recent.count {
            it.status == "sent" && SmsSource.instantMillis(it.sentAt) >= startOfToday
        }

    /**
     * True when the count above is a floor rather than a total.
     *
     * Only the newest rows are read, so on a busy day the oldest of them can
     * still be from today — which means there are more beyond it. Saying "40+"
     * is honest; saying "40" quietly under-reports the clinic's own day.
     */
    val sentTodayCapped: Boolean
        get() = recent.size >= RECENT_LIMIT &&
            SmsSource.instantMillis(recent.lastOrNull()?.createdAt.orEmpty()) >= startOfToday

    /**
     * Messages are piling up with no phone to collect them.
     *
     * The single most useful thing this screen can say. The nightly job refuses
     * to queue anything once the last live heartbeat is gone, so by the time a
     * clinic notices, patients have already not been reminded — and nothing on
     * the website shouts about it either.
     */
    val stalled: Boolean get() = queue.isNotEmpty() && liveSenders.isEmpty()

    /** Nothing will ever be queued while this is true, whatever else is set. */
    val off: Boolean get() = !setup.enabled

    /** The channel does not include SMS, so no phone is ever asked to send. */
    val notTexting: Boolean get() = setup.channel == SmsSource.Channel.WhatsApp
}

private const val RECENT_LIMIT = 40

/**
 * Reminders sent as texts from a clinic phone.
 *
 * The sending itself is untouched: `SmsWorker` claims the queue and `SmsSender`
 * puts messages on the SIM exactly as they did before, and this screen neither
 * sends nor composes anything. What it does is make a feature that was
 * previously invisible from the phone legible from it — what is waiting, which
 * handsets are alive, what failed and why, and whether this phone is one of the
 * senders.
 */
class SmsModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow(Sms())
    val state: StateFlow<Sms> = _state.asStateFlow()

    private var watches = mutableListOf<Job>()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.settings")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see how the clinic's reminders are set up.",
                        )
                        return@onSuccess
                    }
                    observe(who.clinicId)
                    refreshPhone()
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    private fun observe(clinicId: String) {
        watches.forEach { it.cancel() }
        watches.clear()

        watches += viewModelScope.launch {
            SmsSource.watchSetup(clinicId).collect { result ->
                result
                    .onSuccess { _state.value = _state.value.copy(loading = false, setup = it, error = null) }
                    .onFailure { e -> _state.value = _state.value.copy(loading = false, error = readable(e)) }
            }
        }

        // The three lists below are extras. One of them failing — a rule that
        // does not reach that collection, say — must not blank the settings the
        // screen is mainly for, so each swallows its own error.
        watches += viewModelScope.launch {
            SmsSource.watchQueue(clinicId).catch { }.collect { _state.value = _state.value.copy(queue = it) }
        }
        watches += viewModelScope.launch {
            SmsSource.watchRecent(clinicId, RECENT_LIMIT.toLong()).catch { }
                .collect { _state.value = _state.value.copy(recent = it) }
        }
        watches += viewModelScope.launch {
            SmsSource.watchSenders(clinicId).catch { }.collect { _state.value = _state.value.copy(senders = it) }
        }
    }

    // ------------------------------------------------------------ clinic settings

    fun setEnabled(on: Boolean) = save { it.copy(enabled = on) }
    fun setChannel(channel: SmsSource.Channel) = save { it.copy(channel = channel) }
    fun setSendHour(hour: Int) = save {
        it.copy(sendHour = hour.coerceIn(SmsSource.MIN_SEND_HOUR, SmsSource.MAX_SEND_HOUR))
    }

    fun setEvent(event: SmsSource.Event, on: Boolean) = save {
        it.copy(events = it.events + (event.stored to on))
    }

    fun setFooter(on: Boolean) = save { it.copy(optOutFooter = on) }

    private fun save(change: (SmsSource.Setup) -> SmsSource.Setup) {
        val s = _state.value
        val who = s.who ?: return
        if (!s.canEdit) return
        val next = change(s.setup)
        // Shown immediately, then confirmed by the listener. A switch that waits
        // for a round trip reads as a switch that did not work, and gets pressed
        // again.
        _state.value = s.copy(setup = next, saving = true)
        viewModelScope.launch {
            SmsSource.save(who.clinicId, next)
                .onSuccess { _state.value = _state.value.copy(saving = false) }
                .onFailure { e ->
                    // Put the stored setting back rather than leaving the screen
                    // claiming a change the clinic does not have.
                    _state.value = _state.value.copy(setup = s.setup, saving = false, error = readable(e))
                }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    // ------------------------------------------------------------ this phone

    fun refreshPhone() {
        val context: Context = getApplication()
        _state.value = _state.value.copy(
            phone = _state.value.phone.copy(
                paired = SmsPrefs.pairedClinicId(context) != null,
                sender = SmsPrefs.isSender(context),
                permitted = SmsWorker.hasSmsPermission(context),
                lastResult = SmsPrefs.lastResult(context),
                lastRunAt = SmsPrefs.lastRunAt(context),
                sentTotal = SmsPrefs.sentTotal(context),
            )
        )
    }

    /**
     * Start sending from this handset.
     *
     * Only ever called once Android has granted SEND_SMS — a phone listed as the
     * clinic's sender that cannot actually send is worse than no phone at all,
     * because the nightly job counts it as alive and keeps queueing.
     */
    fun becomeSender() {
        val context: Context = getApplication()
        if (!SmsWorker.hasSmsPermission(context)) { refreshPhone(); return }
        SmsPrefs.setSender(context, true)
        SmsWorker.schedule(context)
        SmsWorker.runNow(context)
        refreshPhone()
    }

    /**
     * Stop sending from this handset.
     *
     * Also marks the device row disabled, because leaving it alive tells the
     * server a phone is standing by to collect a queue nobody is collecting.
     */
    fun stopSending() {
        val context: Context = getApplication()
        SmsPrefs.setSender(context, false)
        SmsWorker.cancel(context)
        refreshPhone()
        val who = _state.value.who ?: return
        viewModelScope.launch {
            SmsSource.retire(
                clinicId = SmsPrefs.pairedClinicId(context) ?: who.clinicId,
                deviceId = SmsPrefs.deviceId(context),
            )
        }
    }

    /** Send once, now, rather than waiting out the fifteen-minute poll. */
    fun checkNow() {
        val context: Context = getApplication()
        if (SmsWorker.hasSmsPermission(context)) SmsWorker.runNow(context)
    }

    fun pair(code: String) {
        val context: Context = getApplication()
        _state.value = _state.value.copy(phone = _state.value.phone.copy(pairing = true, pairError = null))
        viewModelScope.launch {
            SmsPairing.pair(
                code = code,
                deviceId = SmsPrefs.deviceId(context),
                deviceName = android.os.Build.MODEL ?: "Clinic phone",
            )
                .onSuccess { clinicId ->
                    SmsPrefs.setPairedClinic(context, clinicId)
                    // Paired means "this phone sends" — start the worker so the
                    // first heartbeat lands in seconds rather than a quarter of
                    // an hour, during which the website shows no phone at all.
                    if (SmsWorker.hasSmsPermission(context)) {
                        SmsPrefs.setSender(context, true)
                        SmsWorker.schedule(context)
                        SmsWorker.runNow(context)
                    }
                    _state.value = _state.value.copy(phone = _state.value.phone.copy(pairing = false))
                    refreshPhone()
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(
                        phone = _state.value.phone.copy(
                            pairing = false,
                            pairError = e.message?.ifBlank { null } ?: "That code was not accepted.",
                        )
                    )
                }
        }
    }

    fun unpair() {
        val context: Context = getApplication()
        stopSending()
        SmsPrefs.setPairedClinic(context, null)
        refreshPhone()
    }

    /** Take another clinic phone out of the rota. */
    fun retire(deviceId: String) {
        val who = _state.value.who ?: return
        if (!who.isAdmin) return
        viewModelScope.launch { SmsSource.retire(who.clinicId, deviceId) }
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) ->
                "This account is not allowed to change the clinic's reminder settings."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. Nothing was changed."
            else -> "That could not be saved."
        }
    }
}

/** The screen, filled with the design's example data. See [previewDashboard]. */
fun previewSms(): Sms {
    val now = java.time.Instant.now()
    fun iso(minutesAgo: Long) = now.minusSeconds(minutesAgo * 60).toString()
    fun msg(
        id: String, name: String, type: String, status: String,
        created: Long, sent: Long? = null, error: String = "",
    ) = SmsSource.Outgoing(
        id = id,
        to = "+201001234567",
        text = "تذكير: موعدك في مركز الفا غدًا 15 سبتمبر الساعة 10:30.",
        status = status,
        type = type,
        patientName = name,
        createdAt = iso(created),
        sendAfter = if (status == "queued") iso(-90) else "",
        sentAt = sent?.let { iso(it) }.orEmpty(),
        error = error,
        attempts = if (status == "failed") 3 else 1,
    )
    return Sms(
        loading = false,
        who = previewDashboard().who,
        setup = SmsSource.Setup(
            enabled = true,
            channel = SmsSource.Channel.Both,
            sendHour = 10,
            events = mapOf(
                "reminder24h" to true, "new" to true, "edit" to false,
                "cancel" to true, "invoice" to false,
            ),
            templates = mapOf(
                "reminder24h" to "تذكير: موعدك في {{clinic_name}} غدًا {{date}} الساعة {{time}}.",
                "new" to "تم حجز موعدك في {{clinic_name}} يوم {{date}} الساعة {{time}}.",
                "cancel" to "تم إلغاء موعدك في {{clinic_name}} يوم {{date}}.",
            ),
            optOutFooter = false,
        ),
        queue = listOf(
            msg("q1", "Mariam Hassan", "reminder24h", "queued", 40),
            msg("q2", "Khaled Mostafa", "reminder24h", "queued", 40),
            msg("q3", "Yara Sameh", "new", "sending", 3),
        ),
        recent = listOf(
            msg("r1", "Omar Abdelrahman", "reminder24h", "sent", 55, sent = 52),
            msg("r2", "Salma Ibrahim", "cancel", "sent", 120, sent = 119),
            msg("r3", "Hania Adel", "reminder24h", "failed", 180, error = "No mobile signal when the message was sent"),
            msg("r4", "Ahmed Zaki", "reminder24h", "sent", 1_500, sent = 1_499),
        ),
        senders = listOf(
            SmsSource.Sender("dev-1", "Samsung A54", enabled = true, lastSeenAt = iso(4)),
            SmsSource.Sender("dev-2", "Reception phone", enabled = true, lastSeenAt = iso(3_000)),
        ),
        phone = Phone(
            paired = true,
            sender = true,
            permitted = true,
            lastResult = "Sent 2 of 2",
            lastRunAt = System.currentTimeMillis() - 4 * 60_000,
            sentTotal = 318,
        ),
    )
}
