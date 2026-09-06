package com.alphadental.clinic

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * "A newer version is available."
 *
 * The app is not on Google Play — it declares SEND_SMS, which Play allows only for a default
 * messaging app — so every update reaches a phone as an APK someone copies across. Until this
 * existed nothing told a phone it was behind: a receptionist ran a version from a month ago with
 * no idea a fix she had asked for had shipped.
 *
 * Once a day the app fetches `latest.json` from the clinic's own Storage bucket (written by
 * `scripts/publish-android-apk.mjs`) and, when the code there is higher than its own, shows one
 * line with a Download button. The link opens in the browser, which downloads the APK and offers
 * to install it over the old one — the same last step as today, minus the finding-out.
 *
 * The manifest URL carries a Storage download token baked in at build time, so no sign-in and
 * no rules are involved. A build made without the token (an empty URL) simply never checks.
 */
object UpdateCheck {

    data class Update(
        val versionCode: Int,
        val versionName: String,
        val url: String,
        val sizeBytes: Long,
        val notes: String,
    )

    private const val PREFS = "alpha_update"
    private const val KEY_LAST_CHECK = "lastCheckAt"
    private const val KEY_DISMISSED = "dismissedCode"
    private const val KEY_CACHED = "cached"
    private const val EVERY_MS = 24L * 60 * 60 * 1000

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * The update to offer, or null: none available, dismissed for this version, or not time to
     * ask yet (in which case the last answer is reused). Never throws — a failed check is a
     * check that found nothing.
     */
    suspend fun check(context: Context, force: Boolean = false): Update? {
        if (BuildConfig.UPDATE_MANIFEST_URL.isBlank()) return null
        val p = prefs(context)
        val now = System.currentTimeMillis()
        val due = force || now - p.getLong(KEY_LAST_CHECK, 0L) > EVERY_MS
        val latest = if (due) {
            fetch()?.also { u ->
                p.edit().putLong(KEY_LAST_CHECK, now).putString(KEY_CACHED, u.toJson().toString()).apply()
            }
        } else {
            p.getString(KEY_CACHED, null)?.let { runCatching { fromJson(JSONObject(it)) }.getOrNull() }
        } ?: return null
        if (latest.versionCode <= BuildConfig.VERSION_CODE) return null
        if (latest.versionCode <= p.getInt(KEY_DISMISSED, 0)) return null
        return latest
    }

    /** "Not now" — for this version. A newer one brings the banner back. */
    fun dismiss(context: Context, update: Update) {
        prefs(context).edit().putInt(KEY_DISMISSED, update.versionCode).apply()
    }

    private suspend fun fetch(): Update? = withContext(Dispatchers.IO) {
        runCatching {
            val connection = (URL(BuildConfig.UPDATE_MANIFEST_URL).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 10_000
                useCaches = false
            }
            try {
                if (connection.responseCode !in 200..299) return@runCatching null
                fromJson(JSONObject(connection.inputStream.bufferedReader().use { it.readText() }))
            } finally {
                connection.disconnect()
            }
        }.getOrNull()
    }

    private fun fromJson(o: JSONObject): Update? {
        val code = o.optInt("versionCode", 0)
        val url = o.optString("url")
        if (code <= 0 || url.isBlank()) return null
        return Update(
            versionCode = code,
            versionName = o.optString("versionName").ifBlank { code.toString() },
            url = url,
            sizeBytes = o.optLong("sizeBytes", 0L),
            notes = o.optString("notes"),
        )
    }

    private fun Update.toJson(): JSONObject = JSONObject()
        .put("versionCode", versionCode)
        .put("versionName", versionName)
        .put("url", url)
        .put("sizeBytes", sizeBytes)
        .put("notes", notes)
}
