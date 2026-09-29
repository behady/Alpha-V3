package com.alphadental.clinic.data

import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

/**
 * The three AI features that live inside one patient's file.
 *
 * None of the thinking happens here. Diagnosis, planning and x-ray reading are server routes the
 * website already calls — the model, the patient context, the plan gate, the credit meter and the
 * refusal messages all live there and are the same for every surface. This file carries a request
 * up and a result back, and reads the two collections those routes leave behind.
 *
 * Every price below is the SERVER's price. It is written here only so a button can say what it
 * will cost before it is pressed; the route decides what is actually charged, and a client asking
 * for the deep read at the standard rate gets the deep rate.
 */
object AiClinical {

    /** One credit a question; three when photographs go with it; times three on the Pro model. */
    const val DIAGNOSIS_CREDITS = 1
    const val DIAGNOSIS_WITH_PHOTOS_CREDITS = 3
    const val PLAN_CREDITS = 2
    const val XRAY_CREDITS = 3
    /** Super mode and the deep x-ray read both run on the bigger model at triple the price. */
    const val SUPER_MULTIPLIER = 3
    const val XRAY_MAX_IMAGES = 4
    const val DIAGNOSIS_MAX_IMAGES = 4

    // ------------------------------------------------------------------ diagnosis

    /** One turn of a diagnosis discussion, as `diagnosis_chats` stores it. */
    data class DiagLine(val role: String, val content: String, val images: List<String> = emptyList()) {
        val mine: Boolean get() = role == "user"
    }

    data class DiagChat(
        val id: String,
        val title: String,
        val messages: List<DiagLine>,
        val mode: String,
        val updatedMillis: Long,
    )

    /**
     * One turn with the diagnostician.
     *
     * `imageUrls` are the patient's own gallery links; the server fetches them itself. History is
     * text only — the route says so — because resending every earlier photograph would triple the
     * cost of every turn. `summarize` asks for the closing diagnostic summary instead of a reply.
     */
    suspend fun diagnose(
        clinicId: String,
        patientId: String,
        message: String,
        history: List<DiagLine>,
        imageUrls: List<String> = emptyList(),
        superMode: Boolean = false,
        summarize: Boolean = false,
    ): String {
        val body = JSONObject()
            .put("clinicId", clinicId)
            .put("patientId", patientId)
            .put("message", message)
            .put("mode", if (superMode) "super" else "power")
            .put("summarize", summarize)
            .put("imageUrls", JSONArray().also { a -> imageUrls.take(DIAGNOSIS_MAX_IMAGES).forEach(a::put) })
            .put("history", JSONArray().also { a ->
                history.forEach { line ->
                    a.put(JSONObject().put("role", line.role).put("content", line.content))
                }
            })
        return ClinicApi.call("api/ai/diagnosis-chat", body).optString("reply")
    }

    suspend fun loadDiagnosisChats(clinicId: String, patientId: String): List<DiagChat> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("diagnosis_chats").whereEqualTo("patientId", patientId).get().await()
        return snap.documents.map { d ->
            @Suppress("UNCHECKED_CAST")
            val raw = (d.get("messages") as? List<Map<String, Any?>>).orEmpty()
            DiagChat(
                id = d.id,
                title = d.getString("title").orEmpty(),
                mode = d.getString("mode").orEmpty(),
                updatedMillis = d.getTimestamp("updatedAt")?.toDate()?.time
                    ?: d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
                messages = raw.map { m ->
                    DiagLine(
                        role = m["role"]?.toString().orEmpty(),
                        content = m["content"]?.toString().orEmpty(),
                        images = (m["images"] as? List<*>)?.mapNotNull { it?.toString() }.orEmpty(),
                    )
                },
            )
        }.sortedByDescending { it.updatedMillis }
    }

    /**
     * Keep the discussion. The same shape the website writes, so a talk started at the chair can
     * be read at the desk. Returns the id, which is the doc id on the first save.
     */
    suspend fun saveDiagnosisChat(
        clinicId: String,
        chatId: String?,
        patientId: String,
        patientName: String,
        messages: List<DiagLine>,
        mode: String,
        byUid: String,
        byName: String,
    ): String {
        val title = messages.firstOrNull { it.mine }?.content
            ?.replace(Regex("\\s+"), " ")?.trim()?.take(70)
            ?.ifBlank { null } ?: "Diagnosis discussion"
        val stored = messages.map { m ->
            mapOf("role" to m.role, "content" to m.content, "images" to m.images)
        }
        val col = Firebase.db().collection("clinics").document(clinicId).collection("diagnosis_chats")
        return if (chatId.isNullOrBlank()) {
            val ref = col.document()
            ref.set(
                mapOf(
                    "patientId" to patientId,
                    "patientName" to patientName,
                    "title" to title,
                    "mode" to mode,
                    "messages" to stored,
                    "createdBy" to byUid,
                    "createdByName" to byName,
                    "createdAt" to FieldValue.serverTimestamp(),
                    "updatedAt" to FieldValue.serverTimestamp(),
                )
            ).await()
            ref.id
        } else {
            col.document(chatId).set(
                mapOf(
                    "messages" to stored,
                    "title" to title,
                    "mode" to mode,
                    "updatedAt" to FieldValue.serverTimestamp(),
                ),
                SetOptions.merge(),
            ).await()
            chatId
        }
    }

    // ------------------------------------------------------------------ planning

    data class PlanStep(
        val serviceId: String,
        val serviceName: String,
        val teeth: String,
        val quantity: Int,
        val unitPrice: Double,
        val estimatedMinutes: Int,
        val note: String,
        /** Nothing on the price list matched, so the price is 0 and needs a hand. */
        val unmatched: Boolean,
    ) {
        val lineTotal: Double get() = unitPrice * quantity.coerceAtLeast(1)
    }

    data class PlanVisit(
        val label: String,
        val daysFromPrevious: Int,
        val durationMinutes: Int,
        /** Filled from the clinic's real calendar when a free slot was found. */
        val date: String,
        val time: String,
        val suggestedTimes: List<String>,
        val steps: List<PlanStep>,
    )

    data class PlanOption(val title: String, val description: String, val visits: List<PlanVisit>, val total: Double)

    data class PlanProposal(
        val options: List<PlanOption>,
        /** What the model still wants to know. Answering them and refining is the second round. */
        val questions: List<String>,
        val currency: String,
        val calendarNotes: List<String>,
    )

    /**
     * Ask for up to three plans.
     *
     * Prices come from the clinic's own list on the server, never from the model; a step matching
     * nothing arrives flagged `unmatched` at zero. `previous` and `answers` together are the second
     * round of the question loop.
     */
    suspend fun proposePlan(
        clinicId: String,
        patientId: String,
        instructions: String,
        superMode: Boolean = false,
        previous: String? = null,
        answers: String? = null,
    ): PlanProposal {
        val body = JSONObject()
            .put("clinicId", clinicId)
            .put("patientId", patientId)
            .put("instructions", instructions)
            .put("mode", if (superMode) "super" else "power")
        if (!previous.isNullOrBlank() || !answers.isNullOrBlank()) {
            body.put(
                "refinement",
                JSONObject().put("previous", previous.orEmpty()).put("answers", answers.orEmpty()),
            )
        }
        val json = ClinicApi.call("api/ai/treatment-plan", body)
        val options = json.optJSONArray("options").toObjects().map { o ->
            val visits = o.optJSONArray("visits").toObjects().map { v ->
                PlanVisit(
                    label = v.optString("label"),
                    daysFromPrevious = v.optInt("daysFromPrevious"),
                    durationMinutes = v.optInt("durationMinutes"),
                    date = v.optString("date"),
                    time = v.optString("time"),
                    suggestedTimes = v.optJSONArray("suggestedTimes").toStrings(),
                    steps = v.optJSONArray("steps").toObjects().map { s ->
                        PlanStep(
                            serviceId = s.optString("serviceId"),
                            serviceName = s.optString("serviceName"),
                            teeth = s.optString("teeth"),
                            quantity = s.optInt("quantity", 1),
                            unitPrice = s.optDouble("unitPrice", 0.0),
                            estimatedMinutes = s.optInt("estimatedMinutes", 0),
                            note = s.optString("note"),
                            unmatched = s.optBoolean("unmatched", false),
                        )
                    },
                )
            }
            PlanOption(
                title = o.optString("title"),
                description = o.optString("description"),
                visits = visits,
                total = o.optDouble("total", 0.0),
            )
        }
        return PlanProposal(
            options = options,
            questions = json.optJSONArray("questions").toStrings(),
            currency = json.optString("currency").ifBlank { "EGP" },
            calendarNotes = json.optJSONArray("calendarNotes").toStrings(),
        )
    }

    /** The proposal as text, for the refinement round. What the website sends back too. */
    fun describe(proposal: PlanProposal): String = buildString {
        proposal.options.forEachIndexed { i, o ->
            appendLine("Option ${i + 1}: ${o.title} — ${o.total.toLong()} ${proposal.currency}")
            if (o.description.isNotBlank()) appendLine(o.description)
            o.visits.forEachIndexed { vi, v ->
                appendLine("  Visit ${vi + 1}: ${v.label} (${v.durationMinutes} min)")
                v.steps.forEach { s ->
                    appendLine("    - ${s.serviceName}${if (s.teeth.isNotBlank()) " [${s.teeth}]" else ""} ×${s.quantity} @ ${s.unitPrice.toLong()}")
                }
            }
        }
    }

    /**
     * Keep one option as a draft plan on the file.
     *
     * Written the way the website writes an accepted AI option — `source: "ai"`, status draft —
     * so the plans tab on either surface shows it and the dentist prices the unmatched steps.
     */
    suspend fun savePlanOption(
        clinicId: String,
        patientId: String,
        patientName: String,
        option: PlanOption,
        currency: String,
        byUid: String,
        byName: String,
    ) {
        fun stepMap(s: PlanStep, i: Int) = mapOf(
            "id" to "step_${System.currentTimeMillis()}_$i",
            "serviceId" to s.serviceId,
            "serviceName" to s.serviceName,
            "teeth" to s.teeth,
            "quantity" to s.quantity,
            "unitPrice" to s.unitPrice,
            "estimatedMinutes" to s.estimatedMinutes,
            "note" to s.note,
        )
        val visits = option.visits.mapIndexed { vi, v ->
            mapOf(
                "id" to "visit_${System.currentTimeMillis()}_$vi",
                "label" to v.label,
                "date" to v.date,
                "time" to v.time,
                "steps" to v.steps.mapIndexed { si, s -> stepMap(s, vi * 100 + si) },
            )
        }
        val flat = option.visits.flatMap { it.steps }
        Firebase.db().collection("clinics").document(clinicId).collection("treatment_plans").document().set(
            mapOf(
                "patientId" to patientId,
                "patientName" to patientName,
                "title" to option.title,
                "description" to option.description,
                "visits" to visits,
                "steps" to flat.mapIndexed { i, s -> stepMap(s, 1000 + i) },
                "total" to flat.sumOf { it.lineTotal },
                "currency" to currency,
                "status" to "draft",
                "source" to "ai",
                "doctorName" to byName,
                "createdBy" to byUid,
                "createdAt" to FieldValue.serverTimestamp(),
                "updatedAt" to FieldValue.serverTimestamp(),
            )
        ).await()
    }

    // ------------------------------------------------------------------ x-rays

    data class XrayFinding(
        val tooth: String,
        val finding: String,
        val confidence: String,
        val severity: String,
        /** A catalogue id the chart understands, when one fits. Charting needs it. */
        val category: String,
        /** Which picture (1-based) the finding is on. */
        val image: Int,
    )

    data class XrayReport(
        val imageType: String,
        val quality: String,
        val qualityNotes: String,
        val summary: String,
        val teeth: List<XrayFinding>,
        val general: List<String>,
        val incidental: List<String>,
        val recommendations: List<String>,
        val chartDiscrepancies: List<String>,
        val limitations: String,
        val patientSummary: String,
        val comparisonVerdict: String,
        val comparisonChanges: List<String>,
    )

    data class XrayMedia(val id: String, val url: String, val category: String)

    /** A stored reading, with whatever the dentist has said about it since. */
    data class XrayRow(
        val id: String,
        val createdMillis: Long,
        val mode: String,
        val compare: Boolean,
        val signed: Boolean,
        val signedByName: String,
        val media: List<XrayMedia>,
        val report: XrayReport,
        /** Row index → confirmed | rejected | edited. */
        val verdicts: Map<String, String>,
        /** Row index → catalogue id already pushed onto the chart. */
        val charted: Map<String, String>,
        val createdByName: String,
        val credits: Int,
    )

    /**
     * Read up to four pictures. Ids, not links: the server checks each one belongs to this patient
     * and fetches the bytes itself. `compare` wants exactly two, older first.
     */
    suspend fun readXrays(
        clinicId: String,
        patientId: String,
        mediaIds: List<String>,
        note: String = "",
        deep: Boolean = false,
        compare: Boolean = false,
    ): String {
        val body = JSONObject()
            .put("clinicId", clinicId)
            .put("patientId", patientId)
            .put("note", note)
            .put("mode", if (deep) "deep" else "standard")
            .put("compare", compare)
            .put("mediaIds", JSONArray().also { a -> mediaIds.take(XRAY_MAX_IMAGES).forEach(a::put) })
        return ClinicApi.call("api/ai/xray-report", body).optString("reportId")
    }

    /**
     * The dentist's word on a report.
     *
     * `verdicts` is row index → "confirmed" | "rejected" | "edited"; `chart` is row index → the
     * catalogue id to put on the odontogram now; `sign` closes the report. All merged server-side
     * onto what is already stored, so a phone that only confirms one row sends one row.
     */
    suspend fun reviewXray(
        clinicId: String,
        reportId: String,
        verdicts: Map<String, String> = emptyMap(),
        chart: Map<String, String> = emptyMap(),
        sign: Boolean = false,
    ) {
        val body = JSONObject().put("clinicId", clinicId).put("reportId", reportId)
        if (verdicts.isNotEmpty()) body.put("verdicts", JSONObject(verdicts))
        if (chart.isNotEmpty()) body.put("chart", JSONObject(chart))
        if (sign) body.put("sign", true)
        ClinicApi.call("api/ai/xray-report/review", body)
    }

    suspend fun loadXrayReports(clinicId: String, patientId: String): List<XrayRow> {
        val snap = Firebase.db().collection("clinics").document(clinicId)
            .collection("xray_reports").whereEqualTo("patientId", patientId).get().await()
        return snap.documents.mapNotNull { d ->
            @Suppress("UNCHECKED_CAST")
            val r = d.get("report") as? Map<String, Any?> ?: return@mapNotNull null
            @Suppress("UNCHECKED_CAST")
            val review = (d.get("review") as? Map<String, Any?>).orEmpty()
            @Suppress("UNCHECKED_CAST")
            val comparison = (r["comparison"] as? Map<String, Any?>).orEmpty()
            XrayRow(
                id = d.id,
                createdMillis = d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
                mode = d.getString("mode").orEmpty(),
                compare = d.getBoolean("compare") == true,
                signed = d.getBoolean("signed") == true,
                signedByName = review["signedByName"]?.toString().orEmpty(),
                media = (d.get("media") as? List<*>).orEmpty().mapNotNull { m ->
                    @Suppress("UNCHECKED_CAST")
                    val mm = m as? Map<String, Any?> ?: return@mapNotNull null
                    XrayMedia(
                        id = mm["id"]?.toString().orEmpty(),
                        url = mm["url"]?.toString().orEmpty(),
                        category = mm["category"]?.toString().orEmpty(),
                    )
                },
                report = XrayReport(
                    imageType = r["imageType"]?.toString().orEmpty(),
                    quality = r["quality"]?.toString().orEmpty(),
                    qualityNotes = r["qualityNotes"]?.toString().orEmpty(),
                    summary = r["summary"]?.toString().orEmpty(),
                    teeth = (r["teeth"] as? List<*>).orEmpty().mapNotNull { t ->
                        @Suppress("UNCHECKED_CAST")
                        val tt = t as? Map<String, Any?> ?: return@mapNotNull null
                        XrayFinding(
                            tooth = tt["tooth"]?.toString().orEmpty(),
                            finding = tt["finding"]?.toString().orEmpty(),
                            confidence = tt["confidence"]?.toString().orEmpty(),
                            severity = tt["severity"]?.toString().orEmpty(),
                            category = tt["category"]?.toString().orEmpty(),
                            image = (tt["image"] as? Number)?.toInt() ?: 1,
                        )
                    },
                    general = r["general"].strings(),
                    incidental = r["incidental"].strings(),
                    recommendations = r["recommendations"].strings(),
                    chartDiscrepancies = r["chartDiscrepancies"].strings(),
                    limitations = r["limitations"]?.toString().orEmpty(),
                    patientSummary = r["patientSummary"]?.toString().orEmpty(),
                    comparisonVerdict = comparison["verdict"]?.toString().orEmpty(),
                    comparisonChanges = comparison["changes"].strings(),
                ),
                verdicts = (review["verdicts"] as? Map<*, *>).orEmpty()
                    .mapNotNull { (k, v) -> k?.toString()?.let { it to v.toString() } }.toMap(),
                charted = (review["charted"] as? Map<*, *>).orEmpty()
                    .mapNotNull { (k, v) -> k?.toString()?.let { it to v.toString() } }.toMap(),
                createdByName = d.getString("createdByName").orEmpty(),
                credits = (d.get("credits") as? Number)?.toInt() ?: 0,
            )
        }.sortedByDescending { it.createdMillis }
    }

    // ------------------------------------------------------------------ plumbing

    private fun Any?.strings(): List<String> = (this as? List<*>).orEmpty().mapNotNull { it?.toString() }

    private fun JSONArray?.toObjects(): List<JSONObject> =
        if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

    private fun JSONArray?.toStrings(): List<String> =
        if (this == null) emptyList() else (0 until length()).map { optString(it) }.filter { it.isNotBlank() }
}
