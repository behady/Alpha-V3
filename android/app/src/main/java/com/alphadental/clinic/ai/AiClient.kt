package com.alphadental.clinic.ai

import com.alphadental.clinic.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The phone's line to the assistant that already runs the website's chat.
 *
 * Deliberately thin. The brain — the model, the clinic data tools, the permission checks, the
 * monthly credit cap, the staged-action confirmations — all lives in /api/gemini on the server,
 * and it is the same brain for every surface. Rebuilding any of it here would mean two assistants
 * that drift apart, and a phone that could be decompiled to find a way around the credit cap.
 *
 * The voice experience is therefore assembled from three parts, of which only this one costs
 * money: speech-to-text and text-to-speech run on the device for free, and this client carries
 * the transcribed text to the server and the reply back.
 */
object AiClient {

    /** One reply from the assistant, with whatever extras the turn produced. */
    data class Turn(
        val reply: String,
        /** Set when the assistant wants to act and is asking for approval first. */
        val pending: PendingAction?,
        /**
         * Set when the assistant identified WHICH appointment the user means.
         * The website opens its reception panel on it; the phone must hold it and
         * send it back as `appointmentId` on the next ask, or every acting
         * request dead-ends at "Opened ..." forever.
         */
        val selectAppointmentId: String? = null,
        /**
         * A screen the assistant wants opened, as the WEBSITE's path — the server
         * speaks in web routes because that is the client it was written for.
         * [NavIntent.fromWebPath] turns it into somewhere this app can actually go.
         *
         * Ignoring this is what made the assistant say "Navigating to /patients…"
         * and then sit there: a confident sentence with nothing behind it.
         */
        val navigateTo: String? = null,
        /**
         * Set when the assistant asked the client to build and download a
         * document. The phone has no download folder to drop a file into and no
         * renderer for an arbitrary AI-composed document, so this is never
         * honoured — it is carried only so the reply can say so plainly instead
         * of announcing a file that never arrives.
         */
        val triggerPdfTitle: String? = null,
    )

    /**
     * An action staged on the server, waiting for this person to say yes.
     *
     * Only the id goes back to the server on approval — the server executes what it recorded at
     * staging time, never a re-interpretation. Everything else here exists to be shown (and read
     * aloud) so the person knows exactly what they are approving.
     */
    data class PendingAction(
        val id: String,
        val kind: String,
        val title: String,
        val lines: List<String>,
        val note: String?,
    )

    class AiError(message: String) : Exception(message)

    /**
     * Ask the assistant something.
     *
     * History is capped here as well as on the server, because every message in it is tokens the
     * clinic pays for. Six turns matches the server's own cap — sending more would just be
     * truncated there after being paid for in bandwidth.
     */
    suspend fun ask(
        clinicId: String,
        userName: String,
        prompt: String,
        history: List<ChatMessage>,
        voiceMode: Boolean,
        /**
         * The appointment the conversation is acting on, if one has been opened.
         * Sending it switches the server to reception mode — the mode whose tools
         * can stage status changes, reschedules, payments and patient messages.
         */
        appointmentId: String? = null,
    ): Turn = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("clinicId", clinicId)
            put("userName", userName)
            put("prompt", prompt)
            if (!appointmentId.isNullOrBlank()) {
                put("mode", "reception")
                put("appointmentId", appointmentId)
            }
            put("history", JSONArray().apply {
                history.takeLast(6).forEach { msg ->
                    put(JSONObject().apply {
                        put("role", if (msg.fromUser) "user" else "assistant")
                        put("content", msg.text)
                    })
                }
            })
            if (voiceMode) {
                // Appended by the server as extra context, not a replacement for its own brain —
                // so the data tools and permission rules stay exactly as the website has them.
                put(
                    "systemInstruction",
                    "VOICE MODE: the user is speaking hands-free in a dental clinic and your " +
                        "reply will be read aloud. Answer in the language the user spoke " +
                        "(Egyptian Arabic or English). Keep it short and speakable — one to " +
                        "three sentences unless reading a list. Plain sentences only: no " +
                        "markdown, no asterisks, no bullet points, no emoji. Stay strictly on " +
                        "this clinic's operations and general dentistry; if asked about " +
                        "anything else, say briefly that you can only help with clinic and " +
                        "dental matters.\n" +
                        // The other half of the fix for "the assistant said it did
                        // something and nothing happened": as well as the app now
                        // honouring navigate_to, the model is told plainly which
                        // client it is talking to, so it stops reaching for a tool
                        // this one cannot carry out and charging a credit to do it.
                        "THIS CLIENT IS THE ANDROID PHONE APP. It has no file downloads and no " +
                        "browser, so never call trigger_pdf_generation and never say a file is " +
                        "being generated or downloaded. The phone builds only three documents, " +
                        "and it builds them itself without asking you: the finance report, the " +
                        "appointment schedule, and a prescription from the patient's file. If " +
                        "someone asks for any other document, say plainly that it is available " +
                        "on the website version. You MAY call navigate_to — the app opens its " +
                        "own matching screen for /patients, /patients/{id}, /appointments, " +
                        "/finance, /reports, /inventory, /leads and /ortho."
                )
            }
        }

        val json = post("api/gemini", body)

        val error = json.optString("error")
        if (error.isNotBlank()) throw AiError(error)

        Turn(
            reply = json.optString("reply").ifBlank { "…" },
            pending = json.optJSONObject("pendingAction")?.toPendingAction(),
            selectAppointmentId = json.optString("selectAppointmentId").takeIf { it.isNotBlank() },
            navigateTo = json.optString("navigateTo").takeIf { it.isNotBlank() },
            triggerPdfTitle = json.optJSONObject("triggerPdf")?.optString("title")?.takeIf { it.isNotBlank() },
        )
    }

    /**
     * Answer a staged action.
     *
     * Never re-runs the model — the server executes (or discards) exactly what it recorded when
     * it staged the action, and this costs no AI credit.
     */
    suspend fun confirm(
        clinicId: String,
        userName: String,
        actionId: String,
        approve: Boolean,
    ): String = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("clinicId", clinicId)
            put("userName", userName)
            put("actionId", actionId)
            put("decision", if (approve) "approve" else "reject")
        }

        val json = post("api/gemini/confirm-action", body)
        if (!json.optBoolean("ok", false)) {
            throw AiError(json.optString("error").ifBlank { "The action could not be completed." })
        }
        json.optString("message").ifBlank { if (approve) "Done." else "Cancelled." }
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject {
        val token = FirebaseAuth.getInstance().currentUser
            ?.getIdToken(false)?.await()?.token
            ?: throw AiError("Not signed in.")

        val url = URL(BuildConfig.WEB_URL.trimEnd('/') + "/" + path)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            // The model plus its data tools can legitimately take a while on a complex turn;
            // cutting this short turns slow answers into paid-for errors. Kept in step with
            // the ViewModel's own 90s ceiling on a turn, so the socket and the spinner agree
            // about when to give up rather than the socket outliving the person's patience.
            readTimeout = 90_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }

        return try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream ?: connection.inputStream
            }
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse {
                throw AiError("The assistant sent something unreadable (HTTP ${connection.responseCode}).")
            }
        } finally {
            connection.disconnect()
        }
    }

    /** Flatten the server's preview into speakable, showable lines. */
    private fun JSONObject.toPendingAction(): PendingAction? {
        val id = optString("id")
        if (id.isBlank()) return null

        val lines = mutableListOf<String>()

        optJSONObject("summary")?.let { summary ->
            summary.keys().forEach { key ->
                val value = summary.opt(key)?.toString().orEmpty()
                if (value.isNotBlank() && value != "null") lines += "$key: $value"
            }
        }
        optJSONArray("changes")?.let { changes ->
            for (i in 0 until changes.length()) {
                val change = changes.optJSONObject(i) ?: continue
                lines += "${change.optString("label")}: ${change.optString("from")} → ${change.optString("to")}"
            }
        }
        optString("recipient").takeIf { it.isNotBlank() }?.let { lines += "To: $it" }
        optString("messageBody").takeIf { it.isNotBlank() }?.let { lines += "“$it”" }
        if (has("amount")) lines += "Amount: ${optDouble("amount", 0.0).toInt()} EGP"

        return PendingAction(
            id = id,
            kind = optString("kind"),
            title = optString("title").ifBlank { optString("kind") },
            lines = lines,
            note = optString("note").takeIf { it.isNotBlank() },
        )
    }
}
