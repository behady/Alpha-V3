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
 * The website's routes, called as the signed-in person.
 *
 * A handful of things no Firestore rule can let a phone do — grant a role, mint an invite,
 * approve a join request — because they touch another person's account. The website does them
 * through routes on the Admin SDK, and so does the phone: same route, same checks, same answer.
 */
object ClinicRoutes {

    class RouteError(message: String) : Exception(message)

    private suspend fun token(): String =
        FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
            ?: throw RouteError("You are signed out. Sign in again and try that once more.")

    suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val bearer = token()
        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Authorization", "Bearer $bearer")
        }
        read(connection)
    }

    suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val bearer = token()
        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $bearer")
        }
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        read(connection)
    }

    private fun read(connection: HttpURLConnection): JSONObject {
        val json = try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: connection.inputStream
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse { throw RouteError("The server sent something unreadable (HTTP $code).") }
        } catch (e: RouteError) {
            throw e
        } catch (e: Exception) {
            throw RouteError("No connection to the clinic server. Check the signal and try again.")
        } finally {
            connection.disconnect()
        }
        if (!json.optBoolean("ok", false)) throw RouteError(json.optString("error").ifBlank { "The server refused that." })
        return json
    }
}
