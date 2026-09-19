package com.alphadental.clinic.data

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
 * The phone's line to the two routes that own money.
 *
 * Every treatment and every payment this app recorded used to be written straight into Firestore,
 * and every one of them was thrown away by the server without a word. The rules file denies the
 * client outright:
 *
 *     match /ledger/{rowId}          { allow write: if false; }
 *     match /clinical_notes/{noteId} { allow create, delete: if false; }
 *
 * The write still lands in the on-device cache, so the screen shows the new treatment and the new
 * balance immediately and looks perfectly correct — until the file is reopened and the row is
 * gone. That is the worst shape a failure can take: the person who recorded it has already moved
 * on, and nothing ever told them.
 *
 * It is not a rule to argue with either. The server decides, inside a transaction, which payment
 * carries the lab fee, what the treating dentist is owed, and whether a charge with money against
 * it may be deleted. None of that can be enforced from a client that is free to write whatever it
 * likes, which is exactly why the browser was moved off direct writes too.
 *
 * So the phone posts to the same routes the website posts to, with the signed-in user's Firebase
 * ID token. One brain, one set of arithmetic, one audit trail.
 *
 * These calls need a connection. That is a deliberate step back from the offline-first writes this
 * file replaces — and an honest one, because those writes were not working offline, they were
 * failing everywhere. Offline support for the phone was dropped by decision; an error the user can
 * read beats a success they cannot trust.
 */
object ClinicApi {

    /** What the server refused, in its own words, so a sheet can show the real sentence. */
    class ApiError(message: String, val reason: String? = null) : Exception(message)

    // ------------------------------------------------------------------ money

    /**
     * Record a payment.
     *
     * The dentist, the lab fee and the commission are all resolved server-side from the charge
     * being settled. The caller does not send them, and must not: the split depends on which
     * payments already exist against that treatment, which only the server can see atomically.
     */
    suspend fun createPayment(
        clinicId: String,
        patientId: String,
        patientName: String,
        amount: Double,
        method: String = "Cash",
        description: String? = null,
        /** The charge being settled. Null puts the money on the account as a whole. */
        procedureId: String? = null,
        date: String? = null,
        category: String? = null,
    ): String {
        val body = JSONObject()
            .put("action", "create-payment")
            .put("clinicId", clinicId)
            .put("patientId", patientId)
            .put("patientName", patientName)
            .put("amount", amount)
            .put("method", method)
        if (!description.isNullOrBlank()) body.put("description", description)
        if (!procedureId.isNullOrBlank()) body.put("procedureId", procedureId)
        if (!date.isNullOrBlank()) body.put("date", date)
        if (!category.isNullOrBlank()) body.put("category", category)
        return post("api/finance/ledger", body).optString("id")
    }

    /** Clinic income or overhead — money that belongs to no patient. */
    suspend fun createEntry(
        clinicId: String,
        type: String,
        amount: Double,
        description: String,
        category: String? = null,
        date: String? = null,
        method: String? = null,
    ): String {
        val body = JSONObject()
            .put("action", "create-entry")
            .put("clinicId", clinicId)
            .put("type", type)
            .put("amount", amount)
            .put("description", description)
        if (!category.isNullOrBlank()) body.put("category", category)
        if (!date.isNullOrBlank()) body.put("date", date)
        if (!method.isNullOrBlank()) body.put("method", method)
        return post("api/finance/ledger", body).optString("id")
    }

    /**
     * Correct a row that is already on the ledger.
     *
     * Which fields are accepted depends on what kind of row it is, and the server is the one that
     * decides — a payment takes date, description, paid and method; a treatment charge takes its
     * date, its wording and its discount; a clinic entry takes its amount and category. Anything
     * else in the patch is ignored rather than refused, so a screen may send what it has.
     */
    suspend fun updateRow(clinicId: String, id: String, patch: Map<String, Any?>) {
        val json = JSONObject()
        patch.forEach { (key, value) -> json.put(key, value ?: JSONObject.NULL) }
        post(
            "api/finance/ledger",
            JSONObject().put("action", "update").put("clinicId", clinicId).put("id", id).put("patch", json),
        )
    }

    /** Remove a ledger row. Refused with a sentence when money has been collected against it. */
    suspend fun deleteRow(clinicId: String, id: String) {
        post("api/finance/ledger", JSONObject().put("action", "delete").put("clinicId", clinicId).put("id", id))
    }

    // ------------------------------------------------------------------ treatments

    /** What the clinical route wrote: the note, its charge, and what the patient was billed. */
    data class ProcedureResult(val noteId: String, val ledgerId: String?, val cost: Double)

    /**
     * Record a treatment and bill it, in one server transaction.
     *
     * The price is worked out there, from the clinic's own price list and the billing rule of the
     * service — flat once, per arch per jaw, everything else per tooth. `unitCost` overrides it
     * only when somebody typed a figure by hand.
     *
     * `doctorId` must name a row in the clinic's staff list. The route refuses without one, and
     * says which of the two failures it was: no dentist chosen, or a dentist who no longer has a
     * staff record.
     */
    suspend fun createProcedure(
        clinicId: String,
        patientId: String,
        procedures: List<String>,
        selectedTeeth: List<String>,
        doctorId: String,
        unitCost: Double? = null,
        pricingMode: String? = null,
        status: String = "Completed",
        note: String = "",
        appointmentId: String? = null,
        date: String? = null,
    ): ProcedureResult {
        val body = procedureBody(
            clinicId, patientId, procedures, selectedTeeth, doctorId,
            unitCost, pricingMode, status, note, appointmentId, date,
        ).put("action", "create")
        val json = post("api/clinical/procedures", body)
        return ProcedureResult(
            noteId = json.optString("noteId"),
            ledgerId = json.optString("ledgerId").takeIf { it.isNotBlank() && it != "null" },
            cost = json.optDouble("cost", 0.0),
        )
    }

    /** Change a treatment that is already on the file. Its charge is repriced with it. */
    suspend fun updateProcedure(
        clinicId: String,
        noteId: String,
        patientId: String,
        procedures: List<String>,
        selectedTeeth: List<String>,
        doctorId: String,
        unitCost: Double? = null,
        pricingMode: String? = null,
        status: String = "Completed",
        note: String = "",
        appointmentId: String? = null,
        date: String? = null,
    ): ProcedureResult {
        val body = procedureBody(
            clinicId, patientId, procedures, selectedTeeth, doctorId,
            unitCost, pricingMode, status, note, appointmentId, date,
        ).put("action", "update").put("noteId", noteId)
        val json = post("api/clinical/procedures", body)
        return ProcedureResult(
            noteId = json.optString("noteId").ifBlank { noteId },
            ledgerId = json.optString("ledgerId").takeIf { it.isNotBlank() && it != "null" },
            cost = json.optDouble("cost", 0.0),
        )
    }

    /** Remove a treatment and the charge behind it. Refused once money has been taken for it. */
    suspend fun deleteProcedure(clinicId: String, noteId: String) {
        post(
            "api/clinical/procedures",
            JSONObject().put("action", "delete").put("clinicId", clinicId).put("noteId", noteId),
        )
    }

    private fun procedureBody(
        clinicId: String,
        patientId: String,
        procedures: List<String>,
        selectedTeeth: List<String>,
        doctorId: String,
        unitCost: Double?,
        pricingMode: String?,
        status: String,
        note: String,
        appointmentId: String?,
        date: String?,
    ): JSONObject = JSONObject().apply {
        put("clinicId", clinicId)
        put("patientId", patientId)
        put("procedures", JSONArray().also { array -> procedures.forEach(array::put) })
        put("selectedTeeth", JSONArray().also { array -> selectedTeeth.forEach(array::put) })
        put("doctorId", doctorId)
        put("status", status)
        if (note.isNotBlank()) put("note", note)
        // Sent only when typed. Left out, the server charges the price list — which is the whole
        // reason the price list exists, and the figure the website would have used.
        if (unitCost != null) put("unitCost", unitCost)
        if (!pricingMode.isNullOrBlank()) put("pricingMode", pricingMode)
        if (!appointmentId.isNullOrBlank()) put("appointmentId", appointmentId)
        if (!date.isNullOrBlank()) put("date", date)
    }

    // ------------------------------------------------------------------ plumbing

    /**
     * The same wire, for the other routes that speak this shape.
     *
     * AiClinical posts to the diagnosis, planning and x-ray routes with exactly this envelope —
     * a bearer token in, `{ ok, error, reason }` out — so it borrows this rather than growing a
     * second copy that would drift on the first error-handling change.
     */
    internal suspend fun call(path: String, body: JSONObject): JSONObject = post(path, body)

    private suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser
            ?.getIdToken(false)?.await()?.token
            ?: throw ApiError("You are signed out. Sign in again and try that once more.")

        val url = URL(BuildConfig.WEB_URL.trimEnd('/') + "/" + path)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }

        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: connection.inputStream
            val text = stream.bufferedReader().use { it.readText() }
            val json = runCatching { JSONObject(text) }.getOrNull()
                // A route that answered with something that is not JSON is almost always a
                // network captive portal or a deploy in progress. Saying the status code gives
                // whoever reports it something to go on.
                ?: throw ApiError("The server sent something unreadable (HTTP $code).")

            if (code !in 200..299 || !json.optBoolean("ok", false)) {
                throw ApiError(
                    json.optString("error").ifBlank { "That could not be saved (HTTP $code)." },
                    json.optString("reason").takeIf { it.isNotBlank() },
                )
            }
            json
        } catch (e: ApiError) {
            throw e
        } catch (e: Exception) {
            // Everything from DNS to a dropped socket lands here. Named plainly, because the one
            // thing this must never look like is a permission problem.
            throw ApiError("No connection to the clinic server. Check the signal and try again.")
        } finally {
            connection.disconnect()
        }
    }
}
