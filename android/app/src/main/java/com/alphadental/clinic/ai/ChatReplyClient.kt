package com.alphadental.clinic.ai

import com.alphadental.clinic.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * A person answering a patient, from the clinic's own WhatsApp number.
 *
 * The thread itself is read straight from Firestore (see data/Chats.kt); sending cannot be.
 * The clinic's number lives on Meta's servers and only the web server holds the credentials
 * to speak through it, so a reply is one POST to the same route the website's chat screen
 * uses. That route also records the line in the thread, tells the bot to stand back, and
 * files the answer as a lesson for the bot — none of which the phone should reimplement.
 */
object ChatReplyClient {

    class ReplyError(message: String) : Exception(message)

    /** What the server did with it: "auto" went out, "queued" landed in the manual send list. */
    data class Sent(val mode: String)

    /**
     * Free text, inside the 24-hour window.
     *
     * `clinicId` is always sent. Without it the server falls back to the account's default clinic,
     * which for the platform owner is a deleted one with no gateway.
     */
    suspend fun sendText(
        clinicId: String,
        phone: String,
        patientId: String,
        patientName: String,
        text: String,
    ): Sent = post(
        JSONObject()
            .put("clinicId", clinicId)
            .put("phone", phone)
            .put("patientId", patientId)
            .put("patientName", patientName)
            .put("text", text)
    )

    /**
     * The pre-approved re-engagement template: the only thing that delivers on the official
     * channel once a day has passed since the patient last wrote. Its whole job is to make them
     * write back, which re-opens the window.
     */
    suspend fun sendFollowupTemplate(
        clinicId: String,
        phone: String,
        patientId: String,
        patientName: String,
    ): Sent = post(
        JSONObject()
            .put("clinicId", clinicId)
            .put("phone", phone)
            .put("patientId", patientId)
            .put("patientName", patientName)
            .put("template", "followup")
    )

    private suspend fun post(body: JSONObject): Sent = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser
            ?.getIdToken(false)?.await()?.token
            ?: throw ReplyError("Not signed in.")

        val url = URL(BuildConfig.WEB_URL.trimEnd('/') + "/api/whatsapp/reply")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }

        val json = try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream ?: connection.inputStream
            }
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse {
                throw ReplyError("The server sent something unreadable (HTTP ${connection.responseCode}).")
            }
        } finally {
            connection.disconnect()
        }

        if (!json.optBoolean("ok", false)) {
            throw ReplyError(json.optString("error").ifBlank { "The message could not be sent." })
        }
        Sent(mode = json.optString("mode").ifBlank { "auto" })
    }
}
