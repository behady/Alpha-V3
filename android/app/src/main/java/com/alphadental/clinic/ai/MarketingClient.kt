package com.alphadental.clinic.ai

import com.alphadental.clinic.BuildConfig
import com.alphadental.clinic.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.Query
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Writing the clinic's posts, from the phone.
 *
 * The idea for a post arrives when somebody is standing in the surgery looking at a result they
 * are proud of, not when they are sitting at a desk. So the studio is here: pick what the post is
 * for, what it is about and how it should sound, and the same server route the website calls
 * writes it. What comes back is copied out and pasted into Instagram or Facebook by a person —
 * nothing is published from this app.
 *
 * Generated pieces are saved to the same `marketing_content` collection the website reads, so
 * something written on the phone is in the library on the desk and the other way round.
 */
object MarketingClient {

    class MarketingError(message: String) : Exception(message)

    /** A catalogue entry: stored by id, shown in the reader's language. */
    data class Choice(val id: String, val en: String, val ar: String) {
        fun label(arabic: Boolean): String = if (arabic) ar else en
    }

    /** Mirrors MARKETING_GOALS in src/types/marketing.ts. */
    val GOALS = listOf(
        Choice("offer", "Announce an offer", "الإعلان عن عرض"),
        Choice("education", "Educate patients", "توعية المرضى"),
        Choice("awareness", "Present a service", "التعريف بخدمة"),
        Choice("trust", "Build trust in the clinic", "بناء الثقة في العيادة"),
        Choice("engagement", "Question / engagement", "سؤال وتفاعل"),
        Choice("occasion", "Occasion greeting", "تهنئة بمناسبة"),
    )

    val OCCASIONS = listOf(
        Choice("", "No occasion", "بدون مناسبة"),
        Choice("ramadan", "Ramadan", "شهر رمضان"),
        Choice("eid_fitr", "Eid al-Fitr", "عيد الفطر"),
        Choice("eid_adha", "Eid al-Adha", "عيد الأضحى"),
        Choice("mothers_day", "Mother's Day", "عيد الأم"),
        Choice("back_to_school", "Back to school", "العودة للمدارس"),
        Choice("new_year", "New year", "رأس السنة"),
        Choice("wedding_season", "Wedding season", "موسم الأفراح"),
    )

    val TONES = listOf(
        Choice("friendly", "Friendly & warm", "ودّي وقريب"),
        Choice("professional", "Professional & calm", "احترافي وهادئ"),
        Choice("luxury", "Premium & elegant", "راقي وفاخر"),
        Choice("playful", "Light & playful", "خفيف ومرح"),
    )

    val KINDS = listOf(
        Choice("post", "Post", "منشور"),
        Choice("reel", "Reel", "ريلز"),
        Choice("ad", "Ad", "إعلان"),
    )

    /** One piece the model wrote. A reel carries scenes; an ad carries its headline and hooks. */
    data class Variant(
        val title: String,
        val body: String,
        val hashtags: List<String> = emptyList(),
        val scenes: List<String> = emptyList(),
        val adHeadline: String = "",
        val adDescription: String = "",
        val adHooks: List<String> = emptyList(),
    ) {
        /** Everything as one block, which is what gets pasted into the platform. */
        fun asText(): String = buildString {
            if (adHeadline.isNotBlank()) appendLine(adHeadline).appendLine()
            appendLine(body.trim())
            if (adDescription.isNotBlank()) appendLine().appendLine(adDescription.trim())
            if (scenes.isNotEmpty()) {
                appendLine()
                scenes.forEachIndexed { i, scene -> appendLine("${i + 1}. $scene") }
            }
            if (hashtags.isNotEmpty()) {
                appendLine()
                append(hashtags.joinToString(" ") { if (it.startsWith("#")) it else "#$it" })
            }
        }.trim()
    }

    /** A piece already in the clinic's library. */
    data class SavedItem(
        val id: String,
        val kind: String,
        val title: String,
        val body: String,
        val hashtags: List<String>,
        val status: String,
        val createdByName: String,
        val createdAtMillis: Long,
    )

    /**
     * Ask for a piece.
     *
     * `language` is the language of the POST, not of the app: a clinic whose staff read the app
     * in English still writes to its patients in Arabic, and getting that backwards produces a
     * month of content nobody can publish.
     */
    suspend fun generate(
        clinicId: String,
        kind: String,
        language: String,
        goal: String,
        serviceName: String,
        occasion: String,
        tone: String,
        offer: String,
        notes: String,
    ): List<Variant> {
        val body = JSONObject()
            .put("clinicId", clinicId)
            .put("mode", "single")
            .put("kind", kind)
            .put("language", language)
            .put("goal", goal)
            .put("serviceName", serviceName)
            .put("occasion", occasion)
            .put("tone", tone)
            .put("offer", offer)
            .put("notes", notes)

        val json = post("/api/ai/marketing-content", body)
        val rows = json.optJSONArray("variants")
        return buildList {
            for (i in 0 until (rows?.length() ?: 0)) {
                val row = rows?.optJSONObject(i) ?: continue
                add(
                    Variant(
                        title = row.optString("title"),
                        body = row.optString("body"),
                        hashtags = row.optJSONArray("hashtags").strings(),
                        scenes = row.optJSONArray("scenes").strings(),
                        adHeadline = row.optString("adHeadline"),
                        adDescription = row.optString("adDescription"),
                        adHooks = row.optJSONArray("adHooks").strings(),
                    )
                )
            }
        }
    }

    /** Keep a piece in the clinic's library, in the shape the website's studio reads. */
    suspend fun save(
        clinicId: String,
        variant: Variant,
        kind: String,
        language: String,
        goal: String,
        serviceName: String,
        occasion: String,
        tone: String,
        uid: String,
        byName: String,
    ): Result<Unit> = runCatching {
        Firebase.db().collection("clinics").document(clinicId).collection("marketing_content").add(
            mapOf(
                "kind" to kind,
                "language" to language,
                "goal" to goal,
                "service" to serviceName,
                "occasion" to occasion,
                "tone" to tone,
                "playbook" to "",
                "title" to variant.title,
                "body" to variant.body,
                "hashtags" to variant.hashtags,
                "scenes" to variant.scenes,
                "adHeadline" to variant.adHeadline,
                "adDescription" to variant.adDescription,
                "adHooks" to variant.adHooks,
                "status" to "draft",
                "scheduledDate" to "",
                "channels" to emptyList<String>(),
                "createdAt" to FieldValue.serverTimestamp(),
                "createdBy" to uid,
                "createdByName" to byName,
            )
        ).await()
        Unit
    }

    /** The library, newest first. */
    suspend fun library(clinicId: String): List<SavedItem> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("marketing_content")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(60)
            .get().await()
        return snap.documents.map { d ->
            SavedItem(
                id = d.id,
                kind = d.getString("kind").orEmpty().ifBlank { "post" },
                title = d.getString("title").orEmpty(),
                body = d.getString("body").orEmpty(),
                hashtags = (d.get("hashtags") as? List<*>).orEmpty().mapNotNull { it?.toString() },
                status = d.getString("status").orEmpty().ifBlank { "draft" },
                createdByName = d.getString("createdByName").orEmpty(),
                createdAtMillis = d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
            )
        }
    }

    private fun org.json.JSONArray?.strings(): List<String> = buildList {
        for (i in 0 until (this@strings?.length() ?: 0)) {
            this@strings?.optString(i)?.takeIf { it.isNotBlank() }?.let { add(it) }
        }
    }

    private suspend fun post(path: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
            ?: throw MarketingError("Not signed in.")

        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            // Writing several variants is a long model call; the route allows itself the time.
            readTimeout = 120_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }

        val json = try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream
            else connection.errorStream ?: connection.inputStream
            val text = stream.bufferedReader().use { it.readText() }
            runCatching { JSONObject(text) }.getOrElse {
                throw MarketingError("The server sent something unreadable (HTTP ${connection.responseCode}).")
            }
        } finally {
            connection.disconnect()
        }

        if (!json.optBoolean("ok", false)) {
            throw MarketingError(json.optString("error").ifBlank { "Nothing could be written." })
        }
        json
    }
}
