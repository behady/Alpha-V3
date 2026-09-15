package com.alphadental.clinic.data

import com.alphadental.clinic.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Joining a clinic with the code off an invite link.
 *
 * The website hands out links like /join/ABCD-1234. Somebody who installs the
 * app instead of opening the link had, until now, nowhere to put that code: the
 * phone could only reach a clinic that had already granted it a role, so a new
 * hire's first experience of the app was "this account is not linked to any
 * clinic" and a phone call.
 *
 * It has to be the server. The rules forbid any user — an owner included — from
 * writing another person's `clinicRoles`, which is exactly what accepting an
 * invite does. A client that wrote the membership itself would mark the invite
 * used and grant nothing.
 */
object Invites {

    class InviteError(message: String) : Exception(message)

    /** What a code is for, read before anybody commits to it. */
    data class Peek(
        val found: Boolean,
        val clinicName: String,
        val role: String,
        val status: String,
    ) {
        /** "active" is the only state that can be accepted; the rest explain themselves. */
        val usable: Boolean get() = found && status == "active"

        val problem: String
            get() = when {
                !found -> "No invite with that code."
                status == "revoked" -> "That invite was withdrawn."
                status == "expired" -> "That invite has expired."
                status == "used" -> "That invite has already been used."
                status == "active" -> ""
                else -> "That invite cannot be used."
            }
    }

    /**
     * Codes are written on paper and read aloud, so they arrive with spaces,
     * lower case and the occasional dash in the wrong place. Normalised here the
     * same way the server normalises them, or half the codes typed in by hand
     * would come back "not found" and look like the clinic's fault.
     */
    fun normalize(raw: String): String =
        raw.uppercase().filter { it.isLetterOrDigit() }

    suspend fun peek(code: String): Result<Peek> = runCatching {
        val json = call("GET", "/api/invites?code=" + normalize(code), null)
        Peek(
            found = json.optBoolean("found", false),
            clinicName = json.optString("clinicName"),
            role = json.optString("role").ifBlank { "Assistant" },
            status = json.optString("status").ifBlank { "active" },
        )
    }

    /** Join, as the signed-in account. Returns the clinic's name. */
    suspend fun accept(code: String): Result<String> = runCatching {
        val json = call("POST", "/api/invites", JSONObject().put("code", normalize(code)))
        json.optString("clinicName")
    }

    private suspend fun call(method: String, path: String, body: JSONObject?): JSONObject =
        withContext(Dispatchers.IO) {
            val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
                ?: throw InviteError("Not signed in.")

            val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection)
                .apply {
                    requestMethod = method
                    connectTimeout = 15_000
                    readTimeout = 30_000
                    setRequestProperty("Authorization", "Bearer $token")
                    if (body != null) {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                    }
                }

            val json = try {
                body?.let { b ->
                    connection.outputStream.use { it.write(b.toString().toByteArray(Charsets.UTF_8)) }
                }
                val stream = if (connection.responseCode in 200..299) connection.inputStream
                else connection.errorStream ?: connection.inputStream
                val text = stream.bufferedReader().use { it.readText() }
                runCatching { JSONObject(text) }.getOrElse {
                    throw InviteError("The server sent something unreadable (HTTP ${connection.responseCode}).")
                }
            } finally {
                connection.disconnect()
            }

            if (!json.optBoolean("ok", false)) {
                // The route's own wording — "this invite link does not exist",
                // "this invite is not usable" — is better than anything a
                // client could guess at from a status code.
                throw InviteError(json.optString("error").ifBlank { "That invite could not be used." })
            }
            json
        }
}
