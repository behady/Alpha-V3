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
 * Approving someone who asked to join the clinic.
 *
 * This cannot be done from the phone's own database connection, and the website learned that the
 * hard way: the security rules forbid any user, a clinic admin included, from writing another
 * person's `clinicRoles`. An approval written directly would mark the request approved and grant
 * nothing, which reads as "it worked" and leaves the person locked out. So both surfaces call the
 * same server route, which holds the Admin SDK and does the grant properly.
 *
 * Rejecting needs none of this — it is one status field on the request — and stays in Firestore.
 */
object JoinRequestClient {

    class JoinError(message: String) : Exception(message)

    suspend fun approve(clinicId: String, requestId: String, role: String): Result<Unit> = runCatching {
        withContext(Dispatchers.IO) {
            val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
                ?: throw JoinError("Not signed in.")

            val url = URL(BuildConfig.WEB_URL.trimEnd('/') + "/api/join-requests/approve")
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }

            val body = JSONObject()
                .put("requestId", requestId)
                .put("clinicId", clinicId)
                .put("role", role)

            val json = try {
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val stream = if (connection.responseCode in 200..299) connection.inputStream
                else connection.errorStream ?: connection.inputStream
                val text = stream.bufferedReader().use { it.readText() }
                runCatching { JSONObject(text) }.getOrElse {
                    throw JoinError("The server sent something unreadable (HTTP ${connection.responseCode}).")
                }
            } finally {
                connection.disconnect()
            }

            if (!json.optBoolean("ok", false)) {
                throw JoinError(json.optString("error").ifBlank { "The request could not be approved." })
            }
        }
    }
}
