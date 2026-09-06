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
 * The two scans that find money the clinic has already earned and not collected.
 *
 * Both run on the server and both are read-only: they walk the ledger, the notes and the
 * appointment history and report what they find. Nothing is written, nothing is sent to a
 * patient — a scan produces a list, and a person decides what to do with it.
 *
 * Fetched rather than recomputed for the reason every other server figure is: the arithmetic for
 * "unbilled work" and "dormant patient" lives in one place that the website, the weekly job and
 * now the phone all call, so the three can never quote different numbers at the same owner.
 */
object IntelligenceClient {

    class ScanError(message: String) : Exception(message)

    // ------------------------------------------------------------------ dormant patients

    /** Someone who has not been back, and is not already booked in. */
    data class DormantPatient(
        val patientId: String,
        val patientName: String,
        val phone: String,
        val reason: String,
        val lastVisitDate: String,
        val daysSinceLastVisit: Int,
        val hasUpcomingAppointment: Boolean,
    )

    data class DormancyReport(
        val thresholdDays: Int,
        val dormant: Int,
        val neverVisited: Int,
        val patients: List<DormantPatient>,
        val notes: List<String>,
    )

    /**
     * Who has stopped coming.
     *
     * `createDrafts` is deliberately not offered from the phone: on the website it writes a
     * message draft per patient, which is a bulk action worth doing in front of a full screen
     * where the whole list can be read first.
     */
    suspend fun scanDormant(clinicId: String): DormancyReport {
        val json = post("/api/ai/reactivation", JSONObject().put("clinicId", clinicId).put("createDrafts", false))
        val report = json.optJSONObject("report") ?: throw ScanError("The scan came back empty.")
        val counts = report.optJSONObject("counts")
        val rows = report.optJSONArray("patients")
        val patients = buildList {
            for (i in 0 until (rows?.length() ?: 0)) {
                val row = rows?.optJSONObject(i) ?: continue
                add(
                    DormantPatient(
                        patientId = row.optString("patientId"),
                        patientName = row.optString("patientName").ifBlank { "—" },
                        phone = row.optString("phone"),
                        reason = row.optString("reason"),
                        // Null on someone who has never attended at all; blank reads the same.
                        lastVisitDate = row.optString("lastVisitDate").takeIf { it != "null" }.orEmpty(),
                        daysSinceLastVisit = row.optInt("daysSinceLastVisit", 0),
                        hasUpcomingAppointment = row.optBoolean("hasUpcomingAppointment", false),
                    )
                )
            }
        }
        return DormancyReport(
            thresholdDays = report.optInt("thresholdDays", 0),
            dormant = counts?.optInt("dormant") ?: 0,
            neverVisited = counts?.optInt("neverVisited") ?: 0,
            // Already booked in means already coming back; chasing them is a wasted call.
            patients = patients.filterNot { it.hasUpcomingAppointment },
            notes = report.optJSONArray("notes").toStringList(),
        )
    }

    // ------------------------------------------------------------------ money left behind

    /** One thing the scan believes is recoverable, and why it believes it. */
    data class Finding(
        val kind: String,
        val patientId: String,
        val patientName: String,
        val amount: Double,
        val detail: String,
        val ageDays: Int,
    )

    data class RecoveryReport(
        val recoverable: Double,
        val unbilledWork: Double,
        val outstandingBalance: Double,
        val duplicates: Double,
        val findings: List<Finding>,
        /** True when a scan limit was hit, so the totals are a floor rather than the full picture. */
        val truncated: Boolean,
        val notes: List<String>,
    )

    suspend fun scanRevenue(clinicId: String): RecoveryReport {
        val json = post("/api/ai/revenue-recovery", JSONObject().put("clinicId", clinicId))
        val report = json.optJSONObject("report") ?: throw ScanError("The scan came back empty.")
        val totals = report.optJSONObject("totals")
        val rows = report.optJSONArray("findings")
        val findings = buildList {
            for (i in 0 until (rows?.length() ?: 0)) {
                val row = rows?.optJSONObject(i) ?: continue
                add(
                    Finding(
                        kind = row.optString("kind"),
                        patientId = row.optString("patientId"),
                        patientName = row.optString("patientName").ifBlank { "—" },
                        amount = row.optDouble("amount", 0.0),
                        detail = row.optString("detail"),
                        ageDays = row.optInt("ageDays", 0),
                    )
                )
            }
        }
        return RecoveryReport(
            recoverable = totals?.optDouble("recoverable", 0.0) ?: 0.0,
            unbilledWork = totals?.optDouble("unbilledWork", 0.0) ?: 0.0,
            outstandingBalance = totals?.optDouble("outstandingBalance", 0.0) ?: 0.0,
            duplicates = totals?.optDouble("duplicates", 0.0) ?: 0.0,
            findings = findings,
            truncated = report.optBoolean("truncated", false),
            notes = report.optJSONArray("notes").toStringList(),
        )
    }

    fun findingLabel(kind: String, arabic: Boolean): String = when (kind) {
        "unbilled_work" -> if (arabic) "شغل اتعمل ومتحسبش" else "Treated, never invoiced"
        "outstanding_balance" -> if (arabic) "رصيد مستحق" else "Unpaid balance"
        "duplicate_entry" -> if (arabic) "تسجيل مكرر" else "Duplicate entry"
        "underpriced_procedure" -> if (arabic) "أقل من سعر القائمة" else "Below list price"
        else -> kind.replace('_', ' ')
    }

    private fun org.json.JSONArray?.toStringList(): List<String> = buildList {
        for (i in 0 until (this@toStringList?.length() ?: 0)) {
            this@toStringList?.optString(i)?.takeIf { it.isNotBlank() }?.let { add(it) }
        }
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
            ?: throw ScanError("Not signed in.")

        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            // Both scans walk thousands of rows; the routes allow themselves a while.
            readTimeout = 90_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }

        val json = try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream
            else connection.errorStream ?: connection.inputStream
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse {
                throw ScanError("The server sent something unreadable (HTTP ${connection.responseCode}).")
            }
        } finally {
            connection.disconnect()
        }

        if (!json.optBoolean("ok", false)) {
            throw ScanError(json.optString("error").ifBlank { "The scan could not be run." })
        }
        json
    }
}
