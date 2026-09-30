package com.alphadental.clinic.next.data

import com.alphadental.clinic.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Yesterday in three lines, as the website's owner home shows it every morning.
 *
 * Fetched from `/api/ai/owner-summary`, which writes the summary once per clinic per day and
 * hands the same text to the evening WhatsApp digest — so the phone, the website and the message
 * all say the same thing and the clinic pays for it once. The route decides who may read it
 * (owners, admins, or anyone with finance access).
 */
object OwnerSummaryClient {

    data class Summary(val dateKey: String, val lines: List<String>, val ai: Boolean)

    suspend fun yesterday(clinicId: String, lang: String): Summary? = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token ?: return@withContext null
        val url = BuildConfig.WEB_URL.trimEnd('/') + "/api/ai/owner-summary?clinicId=" + URLEncoder.encode(clinicId, "UTF-8")
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            // The first read of a day may ask the model; give it the route's own timeout.
            readTimeout = 30_000
            setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: return@withContext null
            val json = runCatching { JSONObject(stream.bufferedReader().use { it.readText() }) }.getOrNull() ?: return@withContext null
            if (!json.optBoolean("ok")) return@withContext null
            val s = json.optJSONObject("summary") ?: return@withContext null
            val arr = s.optJSONArray(if (lang == "ar") "ar" else "en") ?: s.optJSONArray("en") ?: return@withContext null
            val lines = (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
            if (lines.isEmpty()) null else Summary(s.optString("dateKey"), lines, s.optString("source") == "ai")
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
