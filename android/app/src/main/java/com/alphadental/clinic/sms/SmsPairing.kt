package com.alphadental.clinic.sms

import com.alphadental.clinic.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Redeem the 6-digit code the website shows, and learn which clinic this phone sends for.
 *
 * Pairing exists because the old answer to "which clinic?" was a guess on both ends: the phone
 * used its user's default clinic, the settings page used the viewer's default clinic, and for
 * anyone belonging to more than one clinic the guesses could disagree — a working sender phone,
 * invisible on the very page meant to show it. The code carries the clinic across explicitly.
 *
 * The server does the writing: it validates the code, burns it, and creates the device row
 * itself, so the phone appears on the website the same second the code is accepted.
 */
object SmsPairing {

    suspend fun pair(code: String, deviceId: String, deviceName: String): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching {
                val idToken = FirebaseAuth.getInstance().currentUser
                    ?.getIdToken(false)?.await()?.token
                    ?: error("Not signed in.")

                val url = URL(BuildConfig.WEB_URL.trimEnd('/') + "/api/sms/pair")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    doOutput = true
                    connectTimeout = 15_000
                    readTimeout = 30_000
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("Authorization", "Bearer $idToken")
                }

                val response = try {
                    connection.outputStream.use {
                        it.write(
                            JSONObject()
                                .put("code", code.trim())
                                .put("deviceId", deviceId)
                                .put("deviceName", deviceName)
                                .toString()
                                .toByteArray(Charsets.UTF_8)
                        )
                    }
                    val stream = if (connection.responseCode in 200..299) connection.inputStream
                    else connection.errorStream ?: connection.inputStream
                    JSONObject(stream.bufferedReader().use { it.readText() })
                } finally {
                    connection.disconnect()
                }

                if (!response.optBoolean("ok", false)) {
                    error(response.optString("error").ifBlank { "Pairing failed." })
                }
                response.optString("clinicId").ifBlank { error("Pairing failed.") }
            }
        }
}
