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

    /** How long a staff reply keeps the bot out of a thread — the clinic's setting, or the default. */
    suspend fun loadHumanClaimMs(clinicId: String): Long {
        val snap = runCatching {
            Firebase.db().collection("clinics").document(clinicId).collection("settings").document("whatsapp").get().await()
        }.getOrNull() ?: return DEFAULT_HUMAN_CLAIM_MS
        val minutes = (snap.get("botHumanClaimMinutes") as? Number)?.toLong() ?: return DEFAULT_HUMAN_CLAIM_MS
        return minutes.coerceIn(0L, 1440L) * 60 * 1000
    }
}
