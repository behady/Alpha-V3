package com.alphadental.clinic.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * The clinic's WhatsApp, read from the thread the server keeps.
 *
 * On the official channel the clinic's number lives on Meta's servers. There is no phone with
 * WhatsApp on it to pick up and scroll — `whatsapp_conversations/{key}` and its `messages`
 * subcollection (written only by the server, see src/lib/bot/thread.ts) are the only copy. This
 * is where the app reads them and marks them read; sending goes through the web API, which is
 * the only thing that can talk to Meta.
 *
 * Field names are the website's. The web's ChatsPanel reads the same documents, and a name
 * tidied up here would simply be a field the other side never sees.
 */
object Chats {

    private const val TAG = "AlphaChats"

    /** Meta drops free text sent more than 24h after the patient's last message. */
    const val REPLY_WINDOW_MS = 24L * 60 * 60 * 1000

    /** Default for how long a staff reply keeps the bot out of the thread; the clinic can change it. */
    const val DEFAULT_HUMAN_CLAIM_MS = 15L * 60 * 1000

    /** One number the clinic has talked to, as the list shows it. */
    data class ChatRow(
        val id: String,
        val phone: String = "",
        val patientId: String = "",
        val patientName: String = "",
        val lastText: String = "",
        val lastAt: Long = 0L,
        val lastDirection: String = "",
        val lastAuthor: String = "",
        /** What the 24-hour rule is measured from: only a patient's own message opens the window. */
        val lastInboundAt: Long = 0L,
        val unreadCount: Int = 0,
        val needsHuman: Boolean = false,
        val handoffReason: String = "",
        /** "urgent", "complaint" or "normal". */
        val severity: String = "",
        /** The patient sentence that raised the hand-off, when there was one. */
        val lastInbound: String = "",
        val botPaused: Boolean = false,
        val humanActiveAtMs: Long = 0L,
        /** "meta" for the official channel, "wapilot" for the unofficial one, blank when unknown. */
        val channel: String = "",
        val optedOut: Boolean = false,
        /** The team member handling this thread, so two receptionists do not answer the same person. */
        val assignedTo: String = "",
        val assignedName: String = "",
        val archived: Boolean = false,
        val muted: Boolean = false,
    ) {
        /** Who this is, for a row or a header: the patient's name, else the number. */
        val title: String get() = patientName.ifBlank { phone.ifBlank { id } }

        /** A WhatsApp "lid" is an anonymised sender: no number to reply to. */
        val isLid: Boolean get() = id.startsWith("lid_")

        /**
         * A conversation the clinic opened has no patient message at all, which for the window
         * rule is the same as one older than a day: only a template delivers until they write back.
         */
        fun windowClosed(now: Long = System.currentTimeMillis()): Boolean =
            lastInboundAt <= 0L || now - lastInboundAt > REPLY_WINDOW_MS

        /**
         * Whether typing here would silently go nowhere. Meta drops out-of-window text; the
         * unofficial gateway does not. Blocked only where it would fail without saying so.
         */
        fun blocked(now: Long = System.currentTimeMillis()): Boolean =
            isLid || optedOut || (channel == "meta" && windowClosed(now))

        /** The bot is standing back for any of the three reasons it can. */
        fun botQuiet(claimMs: Long, now: Long = System.currentTimeMillis()): Boolean =
            botPaused || needsHuman || humanActiveAtMs > now - claimMs
    }

    /** One bubble. */
    data class ChatLine(
        val id: String,
        /** "in" from the patient, "out" from the clinic — bot, staff or system. */
        val direction: String,
        /** "patient", "bot", "staff" or "system". */
        val author: String,
        val text: String,
        val at: Long,
        /** "image", "audio", "video", "document", "sticker"… when the message carried a file. */
        val media: String = "",
        /** Where the file renders from, once the server has copied it from Meta. */
        val mediaUrl: String = "",
        val mime: String = "",
        /** For staff messages: who typed it. */
        val name: String = "",
        val kind: String = "",
        /** "sent", "delivered", "read" or "failed" — Meta's own ticks, blank for inbound. */
        val status: String = "",
        val errorMessage: String = "",
        /** A voice note's words, attached a few seconds after it arrives. */
        val transcript: String = "",
    )

    private fun conversations(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("whatsapp_conversations")

    private fun DocumentSnapshot.long(field: String): Long = (get(field) as? Number)?.toLong() ?: 0L
    private fun DocumentSnapshot.str(field: String): String = getString(field).orEmpty()
    private fun DocumentSnapshot.bool(field: String): Boolean = getBoolean(field) == true

    /**
     * Every conversation, live.
     *
     * A listener rather than a fetch for the same reason the web uses one: the list is a queue two
     * people work at once, and a message answered on the desk has to stop showing as unread on
     * the phone. The staff rehearsal rows (play_<uid>) live in this collection too and are not
     * chats; they are dropped here so the list is patients only.
     */
    fun observeChats(clinicId: String): Flow<List<ChatRow>> = callbackFlow {
        val registration = conversations(clinicId).addSnapshotListener { snapshot, error ->
            if (error != null) {
                Log.w(TAG, "chat list failed: ${error.message}")
                return@addSnapshotListener
            }
            if (snapshot == null) return@addSnapshotListener
            trySend(
                snapshot.documents
                    .filterNot { it.id.startsWith("play_") }
                    .map { doc ->
                        ChatRow(
                            id = doc.id,
                            phone = doc.str("phone"),
                            patientId = doc.str("patientId"),
                            patientName = doc.str("patientName"),
                            lastText = doc.str("lastText"),
                            lastAt = maxOf(doc.long("lastAt"), doc.long("lastMessageAt"), doc.long("handoffAtMs")),
                            lastDirection = doc.str("lastDirection"),
                            lastAuthor = doc.str("lastAuthor"),
                            lastInboundAt = doc.long("lastInboundAt"),
                            unreadCount = doc.long("unreadCount").toInt(),
                            needsHuman = doc.bool("needsHuman"),
                            handoffReason = doc.str("handoffReason"),
                            severity = doc.str("severity"),
                            lastInbound = doc.str("lastInbound"),
                            botPaused = doc.bool("botPaused"),
                            humanActiveAtMs = doc.long("humanActiveAtMs"),
                            channel = doc.str("channel"),
                            optedOut = doc.bool("optedOut"),
                            assignedTo = doc.str("assignedTo"),
                            assignedName = doc.str("assignedName"),
                            archived = doc.bool("archived"),
                            muted = doc.bool("muted"),
                        )
                    }
                    // A row with no activity at all is a conversation document the bot created
                    // and never spoke in; nothing to read there.
                    .filter { it.lastAt > 0L }
                    .sortedByDescending { it.lastAt }
            )
        }
        awaitClose { registration.remove() }
    }

    /**
     * The newest 200 lines of one thread, oldest first, live.
     *
     * Newest-first at the query, then reversed: the recent end of a long thread is what a person
     * opens it for, and the window moves as new messages land.
     */
    fun observeLines(clinicId: String, chatId: String): Flow<List<ChatLine>> = callbackFlow {
        val registration = conversations(clinicId).document(chatId).collection("messages")
            .orderBy("at", Query.Direction.DESCENDING)
            .limit(200)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "thread failed: ${error.message}")
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                trySend(
                    snapshot.documents
                        .map { doc ->
                            ChatLine(
                                id = doc.id,
                                direction = doc.str("direction"),
                                author = doc.str("author"),
                                text = doc.str("text"),
                                at = doc.long("at"),
                                media = doc.str("media"),
                                mediaUrl = doc.str("mediaUrl"),
                                mime = doc.str("mime"),
                                name = doc.str("name"),
                                kind = doc.str("kind"),
                                status = doc.str("status"),
                                errorMessage = doc.str("errorMessage"),
                                transcript = doc.str("transcript"),
                            )
                        }
                        .asReversed()
                )
            }
        awaitClose { registration.remove() }
    }

    /** Opening the thread reads it. Cleared on the parent so the list badge goes with it. */
    fun markRead(clinicId: String, chatId: String) {
        conversations(clinicId).document(chatId)
            .update(mapOf("unreadCount" to 0, "lastReadAtMs" to System.currentTimeMillis()))
            .addOnFailureListener { Log.w(TAG, "mark read rejected: ${it.message}") }
    }

    /**
     * Take over, or hand back.
     *
     * One switch for every reason the bot is quiet: an explicit pause, an open hand-off, or the
     * minutes a staff reply claims. Handing back clears all three — a receptionist who answered
     * once and now wants the bot to carry on should not have to know which of them is in force.
     */
    suspend fun setBotQuiet(clinicId: String, chatId: String, quiet: Boolean, uid: String): Result<Unit> = runCatching {
        val patch: Map<String, Any?> = if (quiet) {
            mapOf("botPaused" to true, "botPausedBy" to uid, "botPausedAtMs" to System.currentTimeMillis())
        } else {
            mapOf(
                "botPaused" to false,
                "needsHuman" to false,
                "handledAtMs" to System.currentTimeMillis(),
                "handledBy" to uid,
                "humanActiveAtMs" to 0L,
            )
        }
        conversations(clinicId).document(chatId).update(patch).await()
    }

    /** Claim the thread for one person, or release it. Taking a colleague's is one tap on purpose. */
    suspend fun assign(clinicId: String, chatId: String, uid: String?, name: String?): Result<Unit> = runCatching {
        conversations(clinicId).document(chatId).update(
            mapOf("assignedTo" to uid, "assignedName" to name, "assignedAtMs" to System.currentTimeMillis())
        ).await()
    }

    /** Out of the list until the patient writes again. Nothing is deleted. */
    suspend fun setArchived(clinicId: String, chatId: String, archived: Boolean): Result<Unit> = runCatching {
        conversations(clinicId).document(chatId).update(mapOf("archived" to archived)).await()
    }

    // ---------------------------------------------------------------- starting a conversation

    /**
     * The conversation document's id for a phone number, as the server derives it.
     *
     * Mirrors `conversationKey` → `phoneMatchKey` on the website: digits only, international and
     * trunk prefixes dropped, the last nine kept. Same input, same id, or the phone would open a
     * second thread beside the one the desk already has with this patient.
     */
    fun conversationKeyFor(phone: String): String {
        var digits = phone.map { c ->
            // Arabic-Indic digits, as some patients are entered.
            when (c) {
                in '\u0660'..'\u0669' -> '0' + (c - '\u0660')
                in '\u06F0'..'\u06F9' -> '0' + (c - '\u06F0')
                else -> c
            }
        }.filter { it.isDigit() }.joinToString("")
        if (digits.isBlank()) return ""
        if (digits.startsWith("00")) digits = digits.drop(2)
        while (digits.startsWith("0")) digits = digits.drop(1)
        return if (digits.length > 9) digits.takeLast(9) else digits
    }

    /**
     * A conversation the clinic is about to open with a patient who has never written in.
     *
     * Exists only in the app's memory until the first message is sent, at which point the server
     * writes the real document and this one is replaced by it. Marked as the official channel
     * with no inbound message, which is exactly the state where only a template delivers.
     */
    fun draftFor(patientId: String, patientName: String, phone: String): ChatRow? {
        val key = conversationKeyFor(phone)
        if (key.length < 7) return null
        return ChatRow(id = key, phone = phone, patientId = patientId, patientName = patientName, channel = "meta")
    }

    // ---------------------------------------------------------------- files

    /** Meta's own per-type ceilings, with the bucket's 20MB as the outer wall. */
    fun sizeLimit(kind: String): Long = when (kind) {
        "image" -> 5L * 1024 * 1024
        "video", "audio" -> 16L * 1024 * 1024
        else -> 20L * 1024 * 1024
    }

    fun kindFor(mime: String): String = when {
        mime.startsWith("image/") -> "image"
        mime.startsWith("video/") -> "video"
        mime.startsWith("audio/") -> "audio"
        else -> "document"
    }

    /**
     * Put a file the clinic is sending into the clinic's own Storage folder and return the link.
     *
     * The same path the website uses. The server then hands Meta the download URL rather than
     * the bytes, so the file travels once — and the same URL is what the bubble renders from.
     * The reply route accepts only links into this bucket, which is why the upload cannot be
     * skipped in favour of some other host.
     */
    suspend fun uploadOutbound(clinicId: String, bytes: ByteArray, mime: String, name: String): String {
        val safeName = name.replace(Regex("[^\\w.\\-\u0600-\u06FF]+"), "_").take(80).ifBlank { "file" }
        val path = "clinics/$clinicId/whatsapp_media/outbound/${System.currentTimeMillis()}_$safeName"
        val ref = com.google.firebase.storage.FirebaseStorage.getInstance().reference.child(path)
        val metadata = com.google.firebase.storage.StorageMetadata.Builder()
            .setContentType(mime.ifBlank { "application/octet-stream" })
            .build()
        ref.putBytes(bytes, metadata).await()
        return ref.downloadUrl.await().toString()
    }

    // ---------------------------------------------------------------- quick replies

    /** A ready answer, one tap from the box. `custom` rows are the desk's own; the rest come from Settings. */
    data class QuickReply(val id: String, val title: String, val text: String, val custom: Boolean)

    /** Which ready answers from Settings → WhatsApp are worth a row, and what to call them. */
    private val FACT_ROWS = listOf(
        Triple("consultation", "Consultation", "الكشف"),
        Triple("mapsUrl", "Location link", "اللوكيشن"),
        Triple("parking", "Parking", "الباركينج"),
        Triple("walkIn", "Walk-ins", "من غير حجز"),
        Triple("installments", "Instalments", "التقسيط"),
        Triple("offers", "Offers", "العروض"),
        Triple("insurance", "Insurance", "التأمين"),
        Triple("durations", "How long it takes", "مدة الجلسة"),
        Triple("sessions", "Number of sessions", "عدد الجلسات"),
        Triple("aftercare", "Aftercare", "التعليمات بعد العلاج"),
        Triple("whyUs", "Why us", "ليه إحنا"),
    )

    /**
     * Two sources, one list, as the website shows them: the sentences the bot already quotes
     * verbatim from Settings, and the list the desk keeps itself in `whatsapp_quick_replies`.
     */
    suspend fun loadQuickReplies(clinicId: String, arabic: Boolean): List<QuickReply> {
        val clinic = Firebase.db().collection("clinics").document(clinicId)
        val custom = runCatching {
            clinic.collection("whatsapp_quick_replies").orderBy("createdAt").get().await().documents.map { d ->
                QuickReply(d.id, d.str("title"), d.str("text"), custom = true)
            }.filter { it.title.isNotBlank() && it.text.isNotBlank() }
        }.getOrDefault(emptyList())
        val facts = runCatching {
            val map = clinic.collection("settings").document("whatsapp").get().await().get("botFacts") as? Map<*, *>
            FACT_ROWS.mapNotNull { (key, en, ar) ->
                val text = map?.get(key)?.toString()?.trim().orEmpty()
                if (text.isBlank()) null else QuickReply("fact_$key", if (arabic) ar else en, text, custom = false)
            }
        }.getOrDefault(emptyList())
        return custom + facts
    }

    suspend fun addQuickReply(clinicId: String, uid: String, title: String, text: String): Result<Unit> = runCatching {
        Firebase.db().collection("clinics").document(clinicId).collection("whatsapp_quick_replies").add(
            mapOf(
                "title" to title.trim().take(60),
                "text" to text.trim().take(1500),
                "createdBy" to uid,
                "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            )
        ).await()
        Unit
    }

    /** `{name}` becomes the patient's first name, so a saved greeting reads as written to them. */
    fun fillQuickReply(text: String, patientName: String): String {
        val first = patientName.trim().split(Regex("\\s+")).firstOrNull().orEmpty()
        return text.replace("{name}", first).replace(Regex(" {2,}"), " ").trim()
    }

    /** How long a staff reply keeps the bot out of a thread — the clinic's setting, or the default. */
    suspend fun loadHumanClaimMs(clinicId: String): Long {
        val snap = runCatching {
            Firebase.db().collection("clinics").document(clinicId).collection("settings").document("whatsapp").get().await()
        }.getOrNull() ?: return DEFAULT_HUMAN_CLAIM_MS
        val minutes = (snap.get("botHumanClaimMinutes") as? Number)?.toLong() ?: return DEFAULT_HUMAN_CLAIM_MS
        return minutes.coerceIn(0L, 1440L) * 60 * 1000
    }
}
