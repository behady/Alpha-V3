package com.alphadental.clinic.ai

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
 * What the clinic owes its staff for a period.
 *
 * Fetched, never computed here. The pay arithmetic — the hourly rate derived
 * from base salary over expected monthly hours, the split between regular and
 * approved overtime, the rule that unreviewed overtime stays pending — lives in
 * one function on the server that the Attendance screen and the weekly brief
 * also call. Re-deriving any of it on the phone would eventually produce a
 * second, slightly different answer about somebody's wages, and that is an
 * argument with an employee rather than a rendering bug.
 *
 * The phone's only job is to draw the sheet.
 */
object PayrollClient {

    /** One person's pay for the period. */
    data class StaffPay(
        val staffId: String,
        val name: String,
        val role: String,
        val daysWorked: Int,
        val minutesWorked: Int,
        val lateMinutes: Int,
        val absentDays: Int,
        val overtimeApprovedMinutes: Int,
        val overtimePendingMinutes: Int,
        /** Regular pay plus approved overtime. Commission is not in here. */
        val estimatedPay: Double,
        /** False when nobody has set this person's hours, so no rate could be derived. */
        val hasSchedule: Boolean,
    )

    data class Payroll(
        val from: String,
        val to: String,
        val staff: List<StaffPay>,
        val labourCost: Double,
        val overtimePendingMinutes: Int,
        val overtimePendingCost: Double,
        /** The qualifications the server attaches to the figures. Printed verbatim. */
        val notes: List<String>,
    )

    class PayrollError(message: String) : Exception(message)

    suspend fun load(clinicId: String, from: String, to: String): Payroll = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser
            ?.getIdToken(false)?.await()?.token
            ?: throw PayrollError("Not signed in.")

        fun q(value: String) = URLEncoder.encode(value, "UTF-8")
        val url = URL(
            BuildConfig.WEB_URL.trimEnd('/') +
                "/api/payroll?clinicId=${q(clinicId)}&from=${q(from)}&to=${q(to)}"
        )
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
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
                throw PayrollError("The payroll could not be read.")
            }
        } finally {
            connection.disconnect()
        }

        if (!json.optBoolean("ok", false)) {
            throw PayrollError(json.optString("error").ifBlank { "The payroll could not be built." })
        }
        val payroll = json.optJSONObject("payroll")
            ?: throw PayrollError("The payroll came back empty.")

        val rows = payroll.optJSONArray("staff")
        val staff = buildList {
            for (i in 0 until (rows?.length() ?: 0)) {
                val row = rows?.optJSONObject(i) ?: continue
                add(
                    StaffPay(
                        staffId = row.optString("staffId"),
                        name = row.optString("name").ifBlank { "—" },
                        role = row.optString("role"),
                        daysWorked = row.optInt("daysWorked"),
                        minutesWorked = row.optInt("minutesWorked"),
                        lateMinutes = row.optInt("lateMinutes"),
                        absentDays = row.optInt("absentDays"),
                        overtimeApprovedMinutes = row.optInt("overtimeApprovedMinutes"),
                        overtimePendingMinutes = row.optInt("overtimePendingMinutes"),
                        estimatedPay = row.optDouble("estimatedPay", 0.0),
                        hasSchedule = row.optBoolean("hasSchedule", true),
                    )
                )
            }
        }

        val noteArray = payroll.optJSONArray("notes")
        val notes = buildList {
            for (i in 0 until (noteArray?.length() ?: 0)) {
                noteArray?.optString(i)?.takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }

        Payroll(
            from = payroll.optString("from"),
            to = payroll.optString("to"),
            // Highest paid first: a payroll sheet is checked from the top down.
            staff = staff.sortedByDescending { it.estimatedPay },
            labourCost = payroll.optDouble("labourCost", 0.0),
            overtimePendingMinutes = payroll.optInt("overtimePendingMinutes"),
            overtimePendingCost = payroll.optDouble("overtimePendingCost", 0.0),
            notes = notes,
        )
    }
}
