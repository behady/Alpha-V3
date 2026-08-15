package com.alphadental.clinic.ai

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One line of the conversation, as kept on disk and shown on screen. */
data class ChatMessage(
    val fromUser: Boolean,
    val text: String,
    val at: Long,
)

/**
 * The conversation, kept.
 *
 * A chat that vanishes when the app closes makes the assistant a stranger every morning — and
 * makes the clinic re-ask (and re-pay for) things it asked yesterday. The transcript lives in a
 * plain JSON file per clinic and user in app-private storage: no rules to write, no reads billed,
 * and signing out of one clinic never shows its conversation to the next.
 *
 * Only the most recent turns are kept. A chat file that grows forever is a slower app every week,
 * and nobody scrolls back two hundred messages — the website is where history-mining belongs.
 */
class ChatStore(private val context: Context, clinicId: String, uid: String) {

    private val file = File(context.filesDir, "ai_chat_${clinicId}_$uid.json")

    fun load(): List<ChatMessage> = runCatching {
        if (!file.exists()) return emptyList()
        val array = JSONArray(file.readText())
        (0 until array.length()).mapNotNull { i ->
            val row = array.optJSONObject(i) ?: return@mapNotNull null
            ChatMessage(
                fromUser = row.optBoolean("user"),
                text = row.optString("text"),
                at = row.optLong("at"),
            )
        }
    }.getOrDefault(emptyList())

    fun save(messages: List<ChatMessage>) {
        runCatching {
            val array = JSONArray()
            messages.takeLast(MAX_KEPT).forEach { msg ->
                array.put(
                    JSONObject()
                        .put("user", msg.fromUser)
                        .put("text", msg.text)
                        .put("at", msg.at)
                )
            }
            file.writeText(array.toString())
        }
    }

    private companion object {
        const val MAX_KEPT = 200
    }
}

/**
 * The repeat-question cache.
 *
 * Every turn sent to the server costs the clinic an AI credit, and people repeat themselves —
 * a double-tap on the mic, "what did you say?", the same question re-asked after a distraction.
 * An exact repeat of a recent question is answered from here for nothing.
 *
 * The window is deliberately short. This is a clinic system: most answers describe data that
 * changes under your feet ("who is booked today?"), so a cached answer is only safe while it is
 * too fresh to have gone meaningfully stale. Ten minutes saves the accidental repeats without
 * ever serving yesterday's schedule as today's.
 *
 * Turns that staged an action are never cached: replaying "delete it" from a cache, without the
 * server staging anything, would speak a confirmation prompt with nothing behind it.
 */
class AnswerCache(context: Context, clinicId: String) {

    private val file = File(context.filesDir, "ai_cache_$clinicId.json")

    fun lookup(prompt: String, now: Long = System.currentTimeMillis()): String? = runCatching {
        if (!file.exists()) return null
        val entries = JSONObject(file.readText())
        val entry = entries.optJSONObject(keyOf(prompt)) ?: return null
        if (now - entry.optLong("at") > TTL_MS) return null
        entry.optString("reply").takeIf { it.isNotBlank() }
    }.getOrNull()

    fun store(prompt: String, reply: String, now: Long = System.currentTimeMillis()) {
        runCatching {
            val entries = if (file.exists()) JSONObject(file.readText()) else JSONObject()

            // Drop expired entries while we are here, and cap the file so it cannot creep.
            val stale = entries.keys().asSequence()
                .filter { now - (entries.optJSONObject(it)?.optLong("at") ?: 0) > TTL_MS }
                .toList()
            stale.forEach { entries.remove(it) }
            while (entries.length() >= MAX_ENTRIES) {
                val oldest = entries.keys().asSequence()
                    .minByOrNull { entries.optJSONObject(it)?.optLong("at") ?: 0L } ?: break
                entries.remove(oldest)
            }

            entries.put(keyOf(prompt), JSONObject().put("reply", reply).put("at", now))
            file.writeText(entries.toString())
        }
    }

    /** The same question in a different coat is still the same question. */
    private fun keyOf(prompt: String): String =
        prompt.lowercase()
            .replace(Regex("[\\p{Punct}؟،٪]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    private companion object {
        const val TTL_MS = 10 * 60 * 1000L
        const val MAX_ENTRIES = 60
    }
}

/**
 * Did the person just say yes, no, or something else entirely?
 *
 * This is what lets a staged action — a deletion, a payment, a message to a patient — be approved
 * or refused by voice alone. It is deliberately strict: only a short utterance counts, because
 * "yes I saw him yesterday about the crown" is a sentence that happens to contain a yes, not an
 * approval. Anything unclear returns null and the action is abandoned, never executed — a wrongly
 * refused action costs one repeat; a wrongly approved one costs whatever it did.
 *
 * "No" wins over "yes" when both appear ("no, don't"), for the same reason.
 */
fun interpretYesNo(text: String): Boolean? {
    val words = text.lowercase()
        // Apostrophes join, they do not separate: splitting "don't" into two tokens pushed a
        // four-word refusal over the length guard and turned it into a shrug.
        .replace(Regex("['’]"), "")
        .replace(Regex("[\\p{Punct}؟،]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
    if (words.isEmpty() || words.split(" ").size > 4) return null

    val no = listOf(
        "no", "nope", "cancel", "reject", "stop", "don't", "dont",
        "لا", "لأ", "الغاء", "إلغاء", "الغي", "ألغي", "ارفض", "بلاش", "مش",
    )
    val yes = listOf(
        "yes", "yeah", "yep", "confirm", "confirmed", "approve", "approved", "ok", "okay",
        "do it", "go ahead", "sure",
        "نعم", "ايوه", "أيوه", "اه", "آه", "اكد", "أكد", "تمام", "موافق", "اعمل", "اعملها", "ماشي",
    )

    val tokens = words.split(" ")
    if (no.any { it in tokens || (it.contains(" ") && words.contains(it)) }) return false
    if (yes.any { it in tokens || (it.contains(" ") && words.contains(it)) }) return true
    return null
}
