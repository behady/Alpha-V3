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
 * Today at a glance, computed on the server from records rather than described
 * by a model.
 *
 * The website has had this since it shipped and the phone has never seen it. It
 * is fetched rather than recomputed on the device for two reasons: the stale
 * balance scan walks the whole ledger, which is not work to do on a phone; and a
 * second implementation of "what counts as stale" would eventually disagree with
 * the first, which is how two screens end up quoting different numbers at the
 * same person.
 *
 * Costs no AI credit — nothing here goes near a model.
 */
object BriefingClient {

    /** Money on a patient's file that nothing has touched in a long while. */
    data class StaleBalance(
        val patientId: String,
        val patientName: String,
        val balance: Double,
        val daysSinceLastActivity: Int,
    )

    data class Briefing(
        val dateKey: String,
        val total: Int,
        val attended: Int,
        val cancelled: Int,
        val stillScheduled: Int,
        val staleBalances: List<StaleBalance>,
        val staleBalanceTotal: Double,
        /**
         * The server's own caveats about what the figures mean — chiefly that
         * "no recent activity" is not the same as "overdue", because this system
         * records no payment due dates. Shown verbatim: a number that arrives
         * with a caveat should not be repeated without it.
         */
        val notes: List<String>,
    ) {
        /** Nothing worth interrupting anyone about. */
        val isEmpty: Boolean get() = total == 0 && staleBalances.isEmpty()
    }

    class BriefingError(message: String) : Exception(message)

    suspend fun load(clinicId: String): Briefing = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser
            ?.getIdToken(false)?.await()?.token
            ?: throw BriefingError("Not signed in.")

        val url = URL(
            BuildConfig.WEB_URL.trimEnd('/') +
                "/api/ai/daily-briefing?clinicId=" + java.net.URLEncoder.encode(clinicId, "UTF-8")
        )
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            // The ledger scan is the slow part and the route allows itself a minute.
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $token")
        }

        val json = try {
            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream ?: connection.inputStream
            }
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse {
                throw BriefingError("The briefing could not be read.")
            }
        } finally {
            connection.disconnect()
        }

        if (!json.optBoolean("ok", false)) {
            throw BriefingError(json.optString("error").ifBlank { "The briefing could not be built." })
        }
        val briefing = json.optJSONObject("briefing")
            ?: throw BriefingError("The briefing came back empty.")

        val counts = briefing.optJSONObject("counts")
        val stale = briefing.optJSONArray("staleBalances")
        val rows = buildList {
            for (i in 0 until (stale?.length() ?: 0)) {
                val row = stale?.optJSONObject(i) ?: continue
                add(
                    StaleBalance(
                        patientId = row.optString("patientId"),
                        patientName = row.optString("patientName").ifBlank { "—" },
                        balance = row.optDouble("balance", 0.0),
                        daysSinceLastActivity = row.optInt("daysSinceLastActivity", 0),
                    )
                )
            }
        }
        val noteArray = briefing.optJSONArray("notes")
        val notes = buildList {
            for (i in 0 until (noteArray?.length() ?: 0)) {
                noteArray?.optString(i)?.takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }

        Briefing(
            dateKey = briefing.optString("dateKey"),
            total = counts?.optInt("total") ?: 0,
            attended = counts?.optInt("attended") ?: 0,
            cancelled = counts?.optInt("cancelled") ?: 0,
            stillScheduled = counts?.optInt("stillScheduled") ?: 0,
            staleBalances = rows,
            staleBalanceTotal = briefing.optDouble("staleBalanceTotal", 0.0),
            notes = notes,
        )
    }
}
