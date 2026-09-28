package com.alphadental.clinic.next.data

import com.alphadental.clinic.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * The reports, as the website computes them.
 *
 * The phone draws documents it did not calculate. Every figure comes from `/api/reports`, which
 * runs the same functions the website's Reports page runs — so the two can never disagree about
 * last month's income, and a report added to the website appears here without an app update.
 *
 * What comes back is deliberately dumb: figures, bar lists, month charts, a heat grid, tables,
 * and notes. The screen draws those shapes and nothing else.
 */
object ReportsClient {

    class ReportsError(message: String, val locked: Boolean = false) : Exception(message)

    data class Entry(val id: String, val label: String, val hint: String, val allTime: Boolean, val locked: Boolean)
    data class Group(val id: String, val label: String, val reports: List<Entry>)

    data class Figure(val label: String, val value: String, val tone: String, val deltaText: String?, val deltaBad: Boolean)
    data class Bar(val label: String, val value: Double, val text: String, val mark: Boolean, val warn: Boolean, val drill: String?)
    data class Column(val key: String, val label: String, val end: Boolean, val kind: String)
    data class TableRow(val cells: Map<String, Any?>, val patientId: String?, val drill: String?, val bad: Boolean)
    data class Point(val label: String, val value: Double)
    data class Cell(val weekday: Int, val hour: Int, val value: Double)
    data class Line(val label: String, val value: Double, val kind: String)

    sealed class Section(val title: String, val note: String?) {
        class Bars(title: String, note: String?, val rows: List<Bar>) : Section(title, note)
        class Months(title: String, note: String?, val points: List<Point>, val unit: String) : Section(title, note)
        class Heat(title: String, note: String?, val cells: List<Cell>, val unit: String) : Section(title, note)
        class Table(title: String, note: String?, val columns: List<Column>, val rows: List<TableRow>, val total: TableRow?) : Section(title, note)
        class Statement(title: String, val lines: List<Line>) : Section(title, null)
        class Note(val text: String) : Section("", null)
    }

    data class Doc(
        val id: String,
        val title: String,
        val hint: String,
        val rangeLabel: String,
        val allTime: Boolean,
        val figures: List<Figure>,
        val sections: List<Section>,
    )

    suspend fun list(clinicId: String, lang: String): List<Group> {
        val json = get("api/reports?list=1&clinicId=${enc(clinicId)}&lang=$lang")
        return json.getJSONArray("groups").map { g ->
            Group(
                g.getString("id"),
                g.getString("label"),
                g.getJSONArray("reports").map { r ->
                    Entry(r.getString("id"), r.getString("label"), r.optString("hint"), r.optBoolean("allTime"), r.optBoolean("locked"))
                },
            )
        }
    }

    suspend fun doc(clinicId: String, report: String, from: String, to: String, lang: String): Doc {
        val json = get("api/reports?report=${enc(report)}&from=$from&to=$to&clinicId=${enc(clinicId)}&lang=$lang")
        return parseDoc(json.getJSONObject("doc"))
    }

    suspend fun drill(clinicId: String, report: String, key: String, from: String, to: String, lang: String): Section {
        val json = get("api/reports?report=${enc(report)}&drill=${enc(key)}&from=$from&to=$to&clinicId=${enc(clinicId)}&lang=$lang")
        return parseSection(json.getJSONObject("section"))
    }

    // ------------------------------------------------------------------ parsing

    private fun parseDoc(j: JSONObject): Doc = Doc(
        id = j.getString("id"),
        title = j.getString("title"),
        hint = j.optString("hint"),
        rangeLabel = j.optJSONObject("range")?.optString("label") ?: "",
        allTime = j.optBoolean("allTime"),
        figures = j.optJSONArray("figures")?.map { f ->
            val d = f.optJSONObject("delta")
            Figure(f.getString("label"), f.optString("value"), f.optString("tone", "ink"), d?.optString("text"), d?.optBoolean("bad") ?: false)
        } ?: emptyList(),
        sections = j.optJSONArray("sections")?.map { parseSection(it) } ?: emptyList(),
    )

    private fun parseSection(s: JSONObject): Section {
        val title = s.optString("title")
        val note = s.optString("note").takeIf { it.isNotBlank() }
        return when (s.getString("type")) {
            "bars" -> Section.Bars(title, note, s.getJSONArray("rows").map { r ->
                Bar(r.getString("label"), r.optDouble("value", 0.0), r.optString("text"), r.optBoolean("mark"), r.optBoolean("warn"), r.optString("drill").takeIf { it.isNotBlank() })
            })
            "months" -> Section.Months(title, note, s.getJSONArray("points").map { p -> Point(p.getString("label"), p.optDouble("value", 0.0)) }, s.optString("unit", "money"))
            "heat" -> Section.Heat(title, note, s.getJSONArray("cells").map { c -> Cell(c.getInt("weekday"), c.getInt("hour"), c.optDouble("value", 0.0)) }, s.optString("unit", "count"))
            "table" -> Section.Table(
                title, note,
                s.getJSONArray("columns").map { c -> Column(c.getString("key"), c.getString("label"), c.optString("align") == "end", c.optString("kind", "text")) },
                s.getJSONArray("rows").map { parseRow(it) },
                s.optJSONObject("total")?.let { parseRow(it) },
            )
            "statement" -> Section.Statement(title, s.getJSONArray("lines").map { l -> Line(l.getString("label"), l.optDouble("value", 0.0), l.optString("kind", "plus")) })
            else -> Section.Note(s.optString("text"))
        }
    }

    private fun parseRow(r: JSONObject): TableRow {
        val cells = mutableMapOf<String, Any?>()
        r.keys().forEach { k ->
            if (!k.startsWith("_")) cells[k] = if (r.isNull(k)) null else r.get(k)
        }
        return TableRow(cells, r.optString("_patientId").takeIf { it.isNotBlank() }, r.optString("_drill").takeIf { it.isNotBlank() }, r.optBoolean("_bad"))
    }

    private inline fun <R> JSONArray.map(transform: (JSONObject) -> R): List<R> =
        (0 until length()).map { transform(getJSONObject(it)) }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    // ------------------------------------------------------------------ the wire

    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val token = FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
            ?: throw ReportsError("You are signed out. Sign in again and try that once more.")
        val connection = (URL(BuildConfig.WEB_URL.trimEnd('/') + "/" + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            // A whole ledger for the balance reports can take a moment on a clinic with years of history.
            readTimeout = 60_000
            setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream ?: connection.inputStream
            val text = stream.bufferedReader().use { it.readText() }
            val json = runCatching { JSONObject(text) }.getOrNull()
                ?: throw ReportsError("The server sent something unreadable (HTTP $code).")
            if (code !in 200..299 || !json.optBoolean("ok", false)) {
                throw ReportsError(json.optString("error").ifBlank { "The report could not be built (HTTP $code)." }, json.optBoolean("locked"))
            }
            json
        } catch (e: ReportsError) {
            throw e
        } catch (e: Exception) {
            throw ReportsError("No connection to the clinic server. Check the signal and try again.")
        } finally {
            connection.disconnect()
        }
    }
}
