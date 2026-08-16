package com.alphadental.clinic.sms

import android.content.Context
import com.alphadental.clinic.BuildConfig
import com.alphadental.clinic.data.Repository
import com.google.firebase.messaging.FirebaseMessaging
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


/**
 * Publish this phone's wake address now, rather than waiting for the next heartbeat.
 *
 * Instant sending needs the server to know where to reach the phone, and that address was only
 * ever written by the fifteen-minute background heartbeat. So a freshly installed or freshly
 * signed-in phone was unreachable for up to a quarter of an hour — during which messages sat in
 * Waiting exactly as they had before the feature existed, with nothing on any screen to say why.
 *
 * Called on every sign-in and on every launch with a session. Cheap, idempotent, and it closes
 * the only window where "instant" quietly was not.
 */
object SmsWakeAddress {

    suspend fun publish(context: Context) {
        if (!SmsPrefs.isSender(context)) return

        runCatching {
            val session = Repository.loadSession().getOrNull() ?: return
            val clinicId = SmsPrefs.pairedClinicId(context) ?: session.clinicId
            val token = FirebaseMessaging.getInstance().token.await()
            Repository.heartbeatSmsDevice(
                clinicId = clinicId,
                deviceId = SmsPrefs.deviceId(context),
                name = android.os.Build.MODEL ?: "Clinic phone",
                fcmToken = token,
            )
        }
    }
}
