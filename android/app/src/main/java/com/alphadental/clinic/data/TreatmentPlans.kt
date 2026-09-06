package com.alphadental.clinic.data

import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await

/**
 * The plan a dentist puts to a patient: what needs doing, in what order, and what it costs.
 *
 * The website's Treatment Plan tab is where a plan is drawn up and shown to the person in the
 * chair. That conversation happens chairside, which is exactly where the phone is — so the phone
 * needs to write these, not just read them.
 *
 * Two shapes are stored side by side and both are written here, as the website does: `visits`,
 * the plan split into appointments, and `steps`, a flat copy of every step in visit order. The
 * flat copy exists because older screens and reports read it; writing one without the other
 * leaves a plan that looks complete on one screen and empty on another.
 */
object TreatmentPlans {

    /** One thing to be done: a treatment, on which teeth, how many, at what price. */
    data class Step(
        val id: String,
        val serviceId: String = "",
        val serviceName: String = "",
        /** Free text, as the website stores it: "16" or "11, 21". */
        val teeth: String = "",
        val quantity: Int = 1,
        val unitPrice: Double = 0.0,
        /** Chair time for this step. 0 means nobody set one. */
        val estimatedMinutes: Int = 0,
        val note: String = "",
    ) {
        val lineTotal: Double get() = unitPrice * quantity.coerceAtLeast(1)
    }

    /** One appointment's worth of the plan. `date` is "yyyy-MM-dd", or blank when unscheduled. */
    data class Visit(
        val id: String,
        val label: String = "",
        val date: String = "",
        val time: String = "",
        val steps: List<Step> = emptyList(),
    ) {
        val total: Double get() = steps.sumOf { it.lineTotal }
    }

    data class Plan(
        val id: String,
        val patientId: String,
        val patientName: String,
        val title: String,
        val description: String,
        /** "draft", "presented", "accepted" or "declined". */
        val status: String,
        /** "manual" here; "ai" for the ones the website's assistant proposed. */
        val source: String,
        val currency: String,
        val visits: List<Visit>,
        val total: Double,
        val doctorName: String,
        val createdAtMillis: Long,
    )

    val STATUSES = listOf("draft", "presented", "accepted", "declined")

    fun statusLabel(status: String, arabic: Boolean): String = when (status) {
        "presented" -> if (arabic) "اتعرضت على المريض" else "Presented"
        "accepted" -> if (arabic) "المريض وافق" else "Accepted"
        "declined" -> if (arabic) "المريض رفض" else "Declined"
        else -> if (arabic) "مسودة" else "Draft"
    }

    private fun plans(clinicId: String) =
        Firebase.db().collection("clinics").document(clinicId).collection("treatment_plans")

    @Suppress("UNCHECKED_CAST")
    private fun readSteps(raw: Any?): List<Step> = (raw as? List<*>).orEmpty().mapNotNull { entry ->
        val m = entry as? Map<*, *> ?: return@mapNotNull null
        Step(
            id = m["id"]?.toString().orEmpty().ifBlank { newId("step") },
            serviceId = m["serviceId"]?.toString().orEmpty(),
            serviceName = m["serviceName"]?.toString().orEmpty(),
            teeth = m["teeth"]?.toString().orEmpty(),
            quantity = (m["quantity"] as? Number)?.toInt() ?: 1,
            unitPrice = (m["unitPrice"] as? Number)?.toDouble() ?: 0.0,
            estimatedMinutes = (m["estimatedMinutes"] as? Number)?.toInt() ?: 0,
            note = m["note"]?.toString().orEmpty(),
        )
    }

    suspend fun load(clinicId: String, patientId: String): List<Plan> {
        val snap = plans(clinicId).whereEqualTo("patientId", patientId).get().await()
        return snap.documents.map { d ->
            val visits = (d.get("visits") as? List<*>).orEmpty().mapNotNull { entry ->
                val m = entry as? Map<*, *> ?: return@mapNotNull null
                Visit(
                    id = m["id"]?.toString().orEmpty().ifBlank { newId("visit") },
                    label = m["label"]?.toString().orEmpty(),
                    date = m["date"]?.toString().orEmpty(),
                    time = m["time"]?.toString().orEmpty(),
                    steps = readSteps(m["steps"]),
                )
            }
            Plan(
                id = d.id,
                patientId = d.getString("patientId").orEmpty(),
                patientName = d.getString("patientName").orEmpty(),
                title = d.getString("title").orEmpty(),
                description = d.getString("description").orEmpty(),
                status = d.getString("status").orEmpty().ifBlank { "draft" },
                source = d.getString("source").orEmpty().ifBlank { "manual" },
                currency = d.getString("currency").orEmpty().ifBlank { "EGP" },
                // A plan written before the visit split still has its flat steps: read those as
                // one unnamed visit rather than showing an empty plan.
                visits = visits.ifEmpty {
                    val flat = readSteps(d.get("steps"))
                    if (flat.isEmpty()) emptyList() else listOf(Visit(newId("visit"), steps = flat))
                },
                total = (d.get("total") as? Number)?.toDouble() ?: 0.0,
                doctorName = d.getString("doctorName").orEmpty(),
                createdAtMillis = d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
            )
        }.sortedByDescending { it.createdAtMillis }
    }

    fun newId(prefix: String): String =
        "${prefix}_${System.currentTimeMillis().toString(36)}_${(0..9999).random()}"

    private fun stepMap(s: Step): Map<String, Any> = mapOf(
        "id" to s.id,
        "serviceId" to s.serviceId,
        "serviceName" to s.serviceName.trim(),
        "teeth" to s.teeth.trim(),
        "quantity" to s.quantity.coerceAtLeast(1),
        "unitPrice" to s.unitPrice,
        "estimatedMinutes" to s.estimatedMinutes,
        "note" to s.note.trim(),
    )

    /**
     * Write a plan, new or edited.
     *
     * Steps with no treatment named are dropped and then empty visits with them, exactly as the
     * website filters before saving — a half-typed row should not become a line on a quote handed
     * to a patient. `translations` is cleared on every save because the words just changed, so a
     * cached Arabic rendering of the old text is now wrong.
     */
    suspend fun save(
        clinicId: String,
        planId: String,
        patientId: String,
        patientName: String,
        title: String,
        description: String,
        visits: List<Visit>,
        currency: String,
        doctorName: String,
        uid: String,
    ): Result<Unit> = runCatching {
        val cleaned = visits.map { v -> v.copy(steps = v.steps.filter { it.serviceName.isNotBlank() }) }
            .filter { it.steps.isNotEmpty() }
        require(cleaned.isNotEmpty()) { "A plan needs at least one step." }

        val flat = cleaned.flatMap { it.steps }
        val payload = mutableMapOf<String, Any>(
            "patientId" to patientId,
            "patientName" to patientName,
            "title" to title.trim(),
            "description" to description.trim(),
            "visits" to cleaned.map { v ->
                mapOf(
                    "id" to v.id,
                    "label" to v.label.trim(),
                    "date" to v.date,
                    "time" to v.time,
                    "steps" to v.steps.map(::stepMap),
                )
            },
            // The flat copy, kept beside the visit split so anything reading the old shape works.
            "steps" to flat.map(::stepMap),
            "total" to flat.sumOf { it.lineTotal },
            "currency" to currency,
            "translations" to emptyMap<String, Any>(),
            "updatedAt" to FieldValue.serverTimestamp(),
        )

        if (planId.isBlank()) {
            payload["status"] = "draft"
            payload["source"] = "manual"
            payload["doctorName"] = doctorName
            payload["createdBy"] = uid
            payload["createdAt"] = FieldValue.serverTimestamp()
            plans(clinicId).document().set(payload).await()
        } else {
            plans(clinicId).document(planId).set(payload, SetOptions.merge()).await()
        }
    }

    /** Move a plan along: drafted, put to the patient, accepted or turned down. */
    suspend fun setStatus(clinicId: String, planId: String, status: String): Result<Unit> = runCatching {
        plans(clinicId).document(planId)
            .set(mapOf("status" to status, "updatedAt" to FieldValue.serverTimestamp()), SetOptions.merge())
            .await()
    }
}
