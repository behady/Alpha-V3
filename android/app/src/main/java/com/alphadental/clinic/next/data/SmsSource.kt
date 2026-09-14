package com.alphadental.clinic.next.data

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Reminders sent as text messages from a clinic's own phone.
 *
 * The machinery is the website's and it is live: a nightly job writes messages
 * into `clinics/{id}/sms_outbox`, a paired handset claims them and sends them
 * from its SIM, and `sms_devices` is how the server knows a phone is alive
 * enough to be given work. None of that is re-implemented here — this file reads
 * those collections and writes the same settings document the website's Settings
 * → SMS screen writes, field for field.
 *
 * Every shape below mirrors `src/lib/sms/config.ts`. Where the two could drift —
 * the defaults, the legacy `template` field, the segment arithmetic — the
 * website's behaviour is copied deliberately and the reason is written down,
 * because a clinic that sees one message count on the laptop and another on the
 * phone stops believing either.
 */
object SmsSource {

    /**
     * The clinic's Firestore, from the one place that knows its name.
     *
     * Not `FirebaseFirestore.getInstance()`. This project's database is literally
     * called "default" — not the conventional "(default)", which does not exist
     * here at all — so the plain call binds to a database that is not there and
     * every read comes back empty with no error to explain it. The app signs in,
     * looks connected, and shows a clinic with no patients in it. Whoever wrote
     * this the first time lost a day to it; the handle lives in one object so it
     * can only be got wrong once.
     */
    private val db: FirebaseFirestore get() = com.alphadental.clinic.Firebase.db()
    private fun clinic(clinicId: String) = db.collection("clinics").document(clinicId)

    // ------------------------------------------------------------------ shapes

    /** Which way patient messages go out. */
    enum class Channel(val stored: String, val label: String, val caption: String) {
        WhatsApp("whatsapp", "WhatsApp only", "Costs the clinic nothing per message"),
        Sms("sms", "Text message only", "Billed to this phone's SIM"),
        Both("both", "Both", "Every patient is messaged twice, and the text is billed"),
        ;

        companion object {
            fun from(value: String?): Channel =
                entries.firstOrNull { it.stored == value } ?: WhatsApp
        }
    }

    /**
     * The moments a patient can be messaged about.
     *
     * The ids are the WhatsApp template names, which is why they read oddly:
     * a clinic switching channel gets the same set of messages rather than a
     * second vocabulary to learn.
     */
    enum class Event(val stored: String, val label: String, val caption: String) {
        Reminder24h("reminder24h", "Day-before reminder", "Held until the hour below"),
        New("new", "Appointment booked", "Sent as soon as it is booked"),
        Edit("edit", "Appointment moved", "Sent as soon as it is changed"),
        Cancel("cancel", "Appointment cancelled", "Sent straight away — a held cancellation is worse than none"),
        Invoice("invoice", "Invoice and payment", "Sent when money is recorded"),
    }

    /** Exactly the website's defaults. See DEFAULT_SMS_EVENTS in `sms/config.ts`. */
    private val DEFAULT_EVENTS = mapOf(
        "reminder24h" to true,
        "new" to false,
        "edit" to false,
        "cancel" to false,
        "invoice" to false,
    )

    /** The hours the nightly sweep can actually honour. Below 6 it has not run yet. */
    const val MIN_SEND_HOUR = 6
    const val MAX_SEND_HOUR = 22
    const val DEFAULT_SEND_HOUR = 10

    data class Setup(
        /** Master switch. Off means nothing is ever queued, whatever the channel says. */
        val enabled: Boolean = false,
        val channel: Channel = Channel.WhatsApp,
        val sendHour: Int = DEFAULT_SEND_HOUR,
        val events: Map<String, Boolean> = DEFAULT_EVENTS,
        val templates: Map<String, String> = emptyMap(),
        /**
         * Adds "للإيقاف أرسل إيقاف" to every text.
         *
         * Off by default, and that is a cost decision rather than a policy one:
         * the default bodies are written to land just inside the 70 characters an
         * Arabic text gets, so the footer always pushes them into a second billed
         * segment. WhatsApp defaults the other way — it bills nothing per message
         * and the number itself is what is at risk there.
         */
        val optOutFooter: Boolean = false,
    ) {
        fun sends(event: Event): Boolean = events[event.stored] ?: (DEFAULT_EVENTS[event.stored] == true)
        fun body(event: Event): String = templates[event.stored].orEmpty()

        /** "10:00". The hour is the clinic's own, not UTC. */
        val sendHourLabel: String get() = "%02d:00".format(sendHour)
    }

    /** One message in the queue, or one the queue has finished with. */
    data class Outgoing(
        val id: String,
        val to: String,
        val text: String,
        /** queued · sending · sent · failed */
        val status: String,
        val type: String,
        val patientName: String,
        val createdAt: String,
        val sendAfter: String,
        val sentAt: String,
        val error: String,
        val attempts: Int,
    ) {
        val waiting: Boolean get() = status == "queued" || status == "sending"
        val failed: Boolean get() = status == "failed"

        /** What this message is about, in words rather than a template id. */
        val about: String
            get() = Event.entries.firstOrNull { it.stored == type }?.label ?: type.ifBlank { "Message" }
    }

    /** A handset offering to send this clinic's reminders. */
    data class Sender(
        val id: String,
        val name: String,
        val enabled: Boolean,
        val lastSeenAt: String,
    ) {
        val seenMillis: Long get() = instantMillis(lastSeenAt)

        /**
         * Recently enough to be trusted with the queue.
         *
         * An hour, matching `isDeviceAlive` on the server. This is not cosmetic:
         * the nightly job queues nothing at all when no phone is alive, so a
         * clinic whose sender phone died yesterday has no reminders going out
         * and nothing anywhere saying so.
         */
        val alive: Boolean
            get() = enabled && seenMillis > 0 && System.currentTimeMillis() - seenMillis < HEARTBEAT_WINDOW_MS
    }

    private const val HEARTBEAT_WINDOW_MS = 60 * 60 * 1000L

    // ------------------------------------------------------------------ reads

    /**
     * The clinic's SMS settings, live.
     *
     * A listener rather than a read because this is a document two people edit —
     * an owner on the laptop and whoever is holding the sender phone — and a
     * stale switch on one of them is how a clinic ends up flipping the same
     * setting back and forth.
     */
    fun watchSetup(clinicId: String): Flow<Result<Setup>> = callbackFlow {
        val reg = clinic(clinicId).collection("settings").document("sms")
            .addSnapshotListener { snap, error ->
                if (error != null) { trySend(Result.failure(error)); return@addSnapshotListener }
                trySend(Result.success(parseSetup(snap?.data)))
            }
        awaitClose { reg.remove() }
    }

    /**
     * Everything still waiting to go out.
     *
     * Filtered on status alone so Firestore serves it from the single-field index
     * it builds by itself; ordering happens on the phone. A composite index that
     * has to be deployed before a screen works is a screen that is broken for
     * anyone who pulls the app before the index lands.
     */
    fun watchQueue(clinicId: String): Flow<List<Outgoing>> = callbackFlow {
        val reg = clinic(clinicId).collection("sms_outbox")
            .whereIn("status", listOf("queued", "sending"))
            .addSnapshotListener { snap, error ->
                if (error != null) { close(error); return@addSnapshotListener }
                trySend(
                    snap?.documents.orEmpty()
                        .map { it.toOutgoing() }
                        .sortedBy { it.sendAfter.ifBlank { it.createdAt } }
                )
            }
        awaitClose { reg.remove() }
    }

    /** The last few messages the queue has finished with, newest first. */
    fun watchRecent(clinicId: String, limit: Long = 40): Flow<List<Outgoing>> = callbackFlow {
        val reg = clinic(clinicId).collection("sms_outbox")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(limit)
            .addSnapshotListener { snap, error ->
                if (error != null) { close(error); return@addSnapshotListener }
                trySend(snap?.documents.orEmpty().map { it.toOutgoing() })
            }
        awaitClose { reg.remove() }
    }

    /** Every phone paired to this clinic, the most recently seen first. */
    fun watchSenders(clinicId: String): Flow<List<Sender>> = callbackFlow {
        val reg = clinic(clinicId).collection("sms_devices")
            .addSnapshotListener { snap, error ->
                if (error != null) { close(error); return@addSnapshotListener }
                trySend(
                    snap?.documents.orEmpty().map { doc ->
                        Sender(
                            id = doc.id,
                            name = doc.getString("name").orEmpty().ifBlank { "Clinic phone" },
                            // Absent means yes: a row written before the field
                            // existed is a working phone, not a disabled one.
                            enabled = doc.getBoolean("enabled") != false,
                            lastSeenAt = doc.getString("lastSeenAt").orEmpty(),
                        )
                    }.sortedByDescending { it.lastSeenAt }
                )
            }
        awaitClose { reg.remove() }
    }

    // ------------------------------------------------------------------ writes

    /**
     * Save the clinic's settings.
     *
     * Written exactly as the website writes it, `template` mirror included: that
     * field is dead, nothing reads it, but leaving a stale copy of a message the
     * clinic has since rewritten sitting in the document is how someone later
     * reads the wrong wording out of the database and believes it.
     *
     * Firestore's rules allow this to clinic admins only, so the screen offers it
     * to nobody else rather than drawing a switch the server would refuse.
     */
    suspend fun save(clinicId: String, setup: Setup): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            clinic(clinicId).collection("settings").document("sms").set(
                mapOf(
                    "enabled" to setup.enabled,
                    "reminderChannel" to setup.channel.stored,
                    "sendHour" to setup.sendHour.coerceIn(MIN_SEND_HOUR, MAX_SEND_HOUR),
                    "events" to setup.events,
                    "templates" to setup.templates,
                    "optOutFooterEnabled" to setup.optOutFooter,
                    "template" to setup.body(Event.Reminder24h),
                    "updatedAt" to java.time.Instant.now().toString(),
                ),
                SetOptions.merge(),
            ).await()
            Unit
        }
    }

    /**
     * Stop a phone being offered work.
     *
     * Disabled, never deleted — and that is the server's choice, not a shortcut.
     * Which phone sent a clinic's messages, and until when, is worth keeping, and
     * the rules refuse a delete outright.
     */
    suspend fun retire(clinicId: String, deviceId: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            clinic(clinicId).collection("sms_devices").document(deviceId)
                .set(
                    mapOf("enabled" to false, "revokedAt" to java.time.Instant.now().toString()),
                    SetOptions.merge(),
                ).await()
            Unit
        }
    }

    // ------------------------------------------------------------------ parsing

    private fun parseSetup(data: Map<String, Any?>?): Setup {
        if (data == null) return Setup(templates = emptyMap())

        val rawEvents = data["events"] as? Map<*, *>
        val rawTemplates = data["templates"] as? Map<*, *>
        // A body saved before there was one template per event. The website still
        // falls back to it for the reminder, so the phone must too or the two
        // screens show different wording for the same message.
        val legacy = (data["template"] as? String).orEmpty().trim()

        val events = Event.entries.associate { e ->
            e.stored to ((rawEvents?.get(e.stored) as? Boolean) ?: (DEFAULT_EVENTS[e.stored] == true))
        }
        val templates = Event.entries.associate { e ->
            val stored = (rawTemplates?.get(e.stored) as? String)?.takeIf { it.isNotBlank() }
            e.stored to (stored ?: if (e == Event.Reminder24h) legacy else "")
        }

        return Setup(
            enabled = data["enabled"] == true,
            channel = Channel.from(data["reminderChannel"] as? String),
            sendHour = ((data["sendHour"] as? Number)?.toInt() ?: DEFAULT_SEND_HOUR)
                .coerceIn(MIN_SEND_HOUR, MAX_SEND_HOUR),
            events = events,
            templates = templates,
            optOutFooter = data["optOutFooterEnabled"] == true,
        )
    }

    private fun com.google.firebase.firestore.DocumentSnapshot.toOutgoing() = Outgoing(
        id = id,
        to = getString("to").orEmpty(),
        text = getString("text").orEmpty(),
        status = getString("status").orEmpty().ifBlank { "queued" },
        type = getString("type").orEmpty(),
        patientName = getString("patientName").orEmpty(),
        createdAt = getString("createdAt").orEmpty(),
        sendAfter = getString("sendAfter").orEmpty(),
        sentAt = getString("sentAt").orEmpty(),
        error = getString("error").orEmpty(),
        attempts = (get("attempts") as? Number)?.toInt() ?: 0,
    )

    // ------------------------------------------------------------------ cost

    /**
     * Characters the GSM 03.38 alphabet can encode. One character outside it —
     * a single Arabic letter, a curly quote, an emoji — drops the whole message
     * to 70 characters instead of 160.
     */
    private const val GSM7 =
        "@£\$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
            "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

    /** Sent as an escape pair, so each costs two. */
    private const val GSM7_EXTENDED = "^{}\\[~]|€"

    data class Cost(val unicode: Boolean, val characters: Int, val segments: Int, val remaining: Int)

    /**
     * How many messages a body will actually be billed as.
     *
     * Mirrors `measureSms`. Worth having on the phone for the same reason it is
     * on the website: the cost of this feature is otherwise completely invisible
     * — a clinic writes a friendly two-line Arabic reminder and finds out it was
     * three texts per patient when the bill arrives.
     */
    fun measure(text: String): Cost {
        var gsmLength = 0
        var isGsm = true
        for (ch in text) {
            when {
                GSM7_EXTENDED.contains(ch) -> gsmLength += 2
                GSM7.contains(ch) -> gsmLength += 1
                else -> { isGsm = false; break }
            }
        }
        val length = if (isGsm) gsmLength else text.length
        val single = if (isGsm) 160 else 70
        val multi = if (isGsm) 153 else 67

        if (length == 0) return Cost(!isGsm, 0, 0, single)
        if (length <= single) return Cost(!isGsm, length, 1, single - length)
        val segments = (length + multi - 1) / multi
        return Cost(!isGsm, length, segments, segments * multi - length)
    }

    // ------------------------------------------------------------------ time

    /** Millis from an ISO-8601 instant, or 0 when it is missing or malformed. */
    fun instantMillis(iso: String): Long {
        if (iso.isBlank()) return 0L
        return runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrElse {
            runCatching {
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).parse(iso)?.time ?: 0L
            }.getOrDefault(0L)
        }
    }

    /** "3 minutes ago", "yesterday", "14 Sep" — how long since something happened. */
    fun ago(millis: Long): String {
        if (millis <= 0L) return "never"
        val delta = System.currentTimeMillis() - millis
        val minutes = delta / 60_000
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 60 * 24 -> "${minutes / 60} hr ago"
            minutes < 60 * 48 -> "yesterday"
            else -> SimpleDateFormat("d MMM", Locale.US).format(Date(millis))
        }
    }
}
