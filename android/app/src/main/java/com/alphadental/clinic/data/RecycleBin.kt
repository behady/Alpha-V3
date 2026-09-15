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
 * Deleting, and undeleting.
 *
 * The one part of the app that cannot talk to Firestore directly. The rules put
 * every binnable collection behind the recycle bin on purpose — a browser, and
 * this phone, are both refused a straight delete — so deletion goes through the
 * server routes that take a snapshot first. Bypassing them would delete the
 * record and nothing else, which is precisely the hole the bin was built to
 * close.
 *
 * Four routes, and they own the decisions: /api/records/delete (bin it),
 * /api/records/bin (what is in there), /api/records/restore (put it back) and
 * /api/records/purge (admin only, gone for good). The phone sends and reads;
 * it does not second-guess what is allowed.
 */
object RecycleBin {

    class BinError(message: String) : Exception(message)

    /** One thing in the bin. */
    data class Entry(
        val id: String,
        val collection: String,
        val documentId: String,
        val label: String,
        val deletedByName: String,
        val deletedAt: String,
        val expiresAt: String,
        val hasFiles: Boolean,
    ) {
        /** "patient_media" reads as "patient media" and "drugs" as "drugs". */
        val collectionLabel: String get() = collection.replace('_', ' ')
    }

    /**
     * What is in the bin.
     *
     * The route filters to the collections this account is allowed to delete
     * from, so an assistant sees their own deletions and not the price list's.
     */
    suspend fun list(clinicId: String): List<Entry> {
        val json = get("/api/records/bin?clinicId=" + clinicId)
        val rows = json.optJSONArray("entries")
        return buildList {
            for (i in 0 until (rows?.length() ?: 0)) {
                val row = rows?.optJSONObject(i) ?: continue
                add(
                    Entry(
                        id = row.optString("id"),
                        collection = row.optString("collection"),
                        documentId = row.optString("documentId"),
                        label = row.optString("label").ifBlank { "Untitled" },
                        deletedByName = row.optString("deletedByName").ifBlank { "Unknown" },
                        // The route sends null for a row written before the field
                        // existed; "null" as text would be printed on the screen.
                        deletedAt = row.optString("deletedAt").takeIf { it != "null" }.orEmpty(),
                        expiresAt = row.optString("expiresAt").takeIf { it != "null" }.orEmpty(),
                        hasFiles = row.optBoolean("hasFiles", false),
                    )
                )
            }
        }
    }

    /** Move one record to the bin. */
    suspend fun delete(clinicId: String, collection: String, documentId: String): Result<Unit> =
        runCatching {
            post(
                "/api/records/delete",
                JSONObject()
                    .put("clinicId", clinicId)
                    .put(
                        "items",
                        JSONArray().put(
                            JSONObject()
                                .put("collection", collection)
                                .put("documentId", documentId)
                        ),
                    ),
            )
            Unit
        }

    /**
     * Put one back.
     *
     * The route refuses when what it pointed at is gone — a prescription whose
     * patient was deleted after it was — and says so. That refusal is passed
     * through rather than smoothed over: restoring a record into a hole is how
     * a file ends up with a treatment belonging to nobody.
     */
    suspend fun restore(clinicId: String, entryId: String): Result<Unit> = runCatching {
        post("/api/records/restore", JSONObject().put("clinicId", clinicId).put("entryId", entryId))
        Unit
    }

    /** Gone for good. Owner or admin only, which the route enforces. */
    suspend fun purge(clinicId: String, entryId: String): Result<Unit> = runCatching {
        post("/api/records/purge", JSONObject().put("clinicId", clinicId).put("entryId", entryId))
        Unit
    }

    // ------------------------------------------------------------------ plumbing

    private suspend fun token(): String =
        FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
            ?: throw BinError("Not signed in.")

    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val bearer = token()
        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection)
            .apply {
                requestMethod = "GET"
                connectTimeout = 15_000
                readTimeout = 30_000
                setRequestProperty("Authorization", "Bearer $bearer")
            }
        read(connection)
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val bearer = token()
        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection)
            .apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15_000
                // A restore copies a snapshot back and may move files with it.
                readTimeout = 60_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $bearer")
            }
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        read(connection)
    }

    private fun read(connection: HttpURLConnection): JSONObject {
        val json = try {
            val stream = if (connection.responseCode in 200..299) connection.inputStream
            else connection.errorStream ?: connection.inputStream
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse {
                throw BinError("The server sent something unreadable (HTTP ${connection.responseCode}).")
            }
        } finally {
            connection.disconnect()
        }
        if (!json.optBoolean("ok", false)) {
            // The routes explain themselves properly — "that patient no longer
            // exists", "something with this name is already there" — so the
            // message is shown as written rather than replaced with a shrug.
            throw BinError(json.optString("error").ifBlank { "That could not be done." })
        }
        return json
    }
}
