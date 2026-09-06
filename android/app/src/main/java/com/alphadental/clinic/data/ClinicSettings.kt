package com.alphadental.clinic.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await

/**
 * Everything the website's Settings screens read and write, on the phone.
 *
 * The clinic is run from the phone, so "change it at the desk" was never an answer. Each section
 * here writes exactly the document and the field names the matching web panel writes — the two
 * are one database, and a key renamed on this side is a setting the website silently stops
 * seeing.
 *
 * Two rules hold throughout:
 *  - **Merge, never replace.** `settings/clinic_info` holds a dozen unrelated screens' fields;
 *    writing the whole document from one screen would erase the others. Every save here names
 *    only its own keys, as the web hosts do.
 *  - **Nothing about SMS delivery is touched.** The SMS settings screen edits the same config
 *    document the website does and nothing else: the sending path, the queue and the pairing are
 *    live and working, and this file does not go near them.
 */
object ClinicSettings {

    private const val TAG = "AlphaSettings"

    private fun clinic(clinicId: String) = Firebase.db().collection("clinics").document(clinicId)
    private fun settings(clinicId: String) = clinic(clinicId).collection("settings")

    /** One settings document, as a plain map. Missing reads as empty rather than failing. */
    suspend fun loadDoc(clinicId: String, docId: String): Map<String, Any?> =
        runCatching { settings(clinicId).document(docId).get().await().data.orEmpty() }
            .onFailure { Log.w(TAG, "read $docId failed: ${it.message}") }
            .getOrDefault(emptyMap())

    /** Merge these fields into a settings document, leaving every other screen's keys alone. */
    suspend fun saveDoc(clinicId: String, docId: String, fields: Map<String, Any?>): Result<Unit> = runCatching {
        settings(clinicId).document(docId).set(fields, SetOptions.merge()).await()
    }

    // ------------------------------------------------------------------ clinic profile

    /**
     * The clinic itself: what goes on a receipt, a prescription and the booking page.
     *
     * `currency` is stored but never used to convert anything — it is the label printed beside a
     * number, and every clinic on this system prices in one currency.
     */
    data class ClinicProfile(
        val name: String = "",
        val doctorName: String = "",
        val phone: String = "",
        val email: String = "",
        val address: String = "",
        val currency: String = "EGP",
        /** The lines printed above a prescription — clinic name, address, phone, as the doctor wants them. */
        val rxHeader: String = "",
    )

    suspend fun loadProfile(clinicId: String): ClinicProfile {
        val d = loadDoc(clinicId, "clinic_info")
        fun s(k: String) = d[k]?.toString().orEmpty()
        return ClinicProfile(
            name = s("name"),
            doctorName = s("doctorName"),
            phone = s("phone"),
            email = s("email"),
            address = s("address"),
            currency = s("currency").ifBlank { "EGP" },
            rxHeader = s("rxHeader"),
        )
    }

    suspend fun saveProfile(clinicId: String, p: ClinicProfile): Result<Unit> = saveDoc(
        clinicId, "clinic_info",
        mapOf(
            "name" to p.name.trim(),
            "doctorName" to p.doctorName.trim(),
            "phone" to p.phone.trim(),
            "email" to p.email.trim(),
            "address" to p.address.trim(),
            "currency" to p.currency.trim().ifBlank { "EGP" },
            "rxHeader" to p.rxHeader.trim(),
        )
    )

    // ------------------------------------------------------------------ attendance rules

    /**
     * Where staff may clock in from.
     *
     * Stored as three loose fields on `clinic_info` rather than a nested object because that is
     * how the website wrote them first and the phone's clock already reads them (Geofence.kt).
     * A blank latitude means no geofence at all, which is a clinic that lets people clock in
     * from anywhere — a real answer, not a missing one.
     */
    data class AttendanceRules(val lat: String = "", val lng: String = "", val radiusMetres: String = "50")

    suspend fun loadAttendanceRules(clinicId: String): AttendanceRules {
        val d = loadDoc(clinicId, "clinic_info")
        fun s(k: String) = d[k]?.toString().orEmpty()
        return AttendanceRules(s("attendanceLat"), s("attendanceLng"), s("attendanceRadius").ifBlank { "50" })
    }

    suspend fun saveAttendanceRules(clinicId: String, r: AttendanceRules): Result<Unit> = saveDoc(
        clinicId, "clinic_info",
        mapOf(
            "attendanceLat" to r.lat.trim(),
            "attendanceLng" to r.lng.trim(),
            "attendanceRadius" to r.radiusMetres.trim().ifBlank { "50" },
        )
    )

    // ------------------------------------------------------------------ named lists

    /**
     * The small lists reception picks from: visit reasons, and how a patient heard of the clinic.
     *
     * One document, one array field, exactly as `NamedList` writes on the website. The defaults
     * are the website's too — an empty dropdown gets skipped, after which no report can say where
     * anyone came from.
     */
    data class NamedList(val docId: String, val field: String, val defaults: List<String>)

    val VISIT_REASONS = NamedList("visit_reasons", "reasons", listOf("كشف"))
    val PATIENT_SOURCES = NamedList(
        "patient_sources", "sources",
        listOf("Walk-in", "Social Media", "Friend / Family", "Other Doctor", "Google", "Instagram", "Online Booking"),
    )

    suspend fun loadList(clinicId: String, list: NamedList): List<String> {
        val raw = loadDoc(clinicId, list.docId)[list.field] as? List<*>
        val values = raw?.mapNotNull { it?.toString()?.trim()?.takeIf(String::isNotBlank) }
        return if (values.isNullOrEmpty()) list.defaults else values
    }

    suspend fun saveList(clinicId: String, list: NamedList, values: List<String>): Result<Unit> =
        saveDoc(clinicId, list.docId, mapOf(list.field to values.map { it.trim() }.filter { it.isNotBlank() }))

    // ------------------------------------------------------------------ branches

    /**
     * Rooms are preserved on save.
     *
     * The website's Locations screen edits branches AND their rooms; the phone edits the branch
     * and its lab code. Writing the branch list without the rooms would delete every room the
     * desk had configured, which the appointments calendar books into — so the existing document
     * is read first and each branch keeps whatever rooms it already had.
     */
    suspend fun saveBranchesKeepingRooms(clinicId: String, branches: List<LabCases.Branch>): Result<Unit> = runCatching {
        val existing = (loadDoc(clinicId, "locations")["branches"] as? List<*>).orEmpty()
        val roomsById = existing.mapNotNull { entry ->
            val m = entry as? Map<*, *> ?: return@mapNotNull null
            val id = m["id"]?.toString() ?: return@mapNotNull null
            id to (m["rooms"] ?: emptyList<Any>())
        }.toMap()
        val payload = branches.map {
            mapOf(
                "id" to it.id,
                "name" to it.name.trim(),
                "code" to it.code.trim().uppercase(),
                "rooms" to (roomsById[it.id] ?: emptyList<Any>()),
            )
        }
        saveDoc(clinicId, "locations", mapOf("branches" to payload, "updatedAt" to java.time.Instant.now().toString())).getOrThrow()
    }

    fun newBranchId(): String = "loc_${System.currentTimeMillis().toString(36)}"

    // ------------------------------------------------------------------ dental labs

    suspend fun saveLabs(clinicId: String, labs: List<LabCases.Lab>): Result<Unit> = saveDoc(
        clinicId, "labs",
        mapOf(
            "labs" to labs.map { lab ->
                buildMap<String, Any> {
                    put("id", lab.id)
                    put("name", lab.name.trim())
                    if (lab.phone.isNotBlank()) put("phone", lab.phone.trim())
                    if (lab.whatsapp.isNotBlank()) put("whatsapp", lab.whatsapp.trim())
                    if (lab.address.isNotBlank()) put("address", lab.address.trim())
                    if (lab.driverName.isNotBlank()) put("driverName", lab.driverName.trim())
                    if (lab.turnaroundDays > 0) put("turnaroundDays", lab.turnaroundDays)
                    if (lab.notes.isNotBlank()) put("notes", lab.notes.trim())
                    if (lab.prices.isNotEmpty()) put("prices", lab.prices)
                }
            },
            "updatedAt" to java.time.Instant.now().toString(),
        )
    )

    fun newLabId(): String = "lab_${System.currentTimeMillis().toString(36)}"

    // ------------------------------------------------------------------ the price list

    /** One priced treatment, as `services` stores it. */
    data class ServiceRow(
        val id: String,
        val name: String,
        val price: Double,
        val durationMinutes: Int,
        val estimatedLabFee: Double,
        val category: String,
        val pricingMode: String,
        val icon: String,
    )

    suspend fun loadServices(clinicId: String): List<ServiceRow> {
        val snap = clinic(clinicId).collection("services").get().await()
        return snap.documents.map { d ->
            ServiceRow(
                id = d.id,
                name = d.getString("name").orEmpty(),
                price = (d.get("price") as? Number)?.toDouble() ?: 0.0,
                durationMinutes = (d.get("durationMinutes") as? Number)?.toInt() ?: 0,
                estimatedLabFee = (d.get("estimatedLabFee") as? Number)?.toDouble() ?: 0.0,
                category = d.getString("category").orEmpty(),
                pricingMode = d.getString("pricingMode").orEmpty(),
                icon = d.getString("icon").orEmpty(),
            )
        }.sortedBy { it.name.lowercase() }
    }

    suspend fun saveService(clinicId: String, row: ServiceRow): Result<Unit> = runCatching {
        val body = mapOf(
            "name" to row.name.trim(),
            "price" to row.price,
            "durationMinutes" to row.durationMinutes,
            "estimatedLabFee" to row.estimatedLabFee,
            "category" to row.category.trim(),
            "pricingMode" to row.pricingMode.trim(),
            "icon" to row.icon.trim(),
        )
        val services = clinic(clinicId).collection("services")
        if (row.id.isBlank()) services.document().set(body).await()
        else services.document(row.id).set(body, SetOptions.merge()).await()
    }

    /**
     * Remove a treatment from the price list.
     *
     * A hard delete, as the website does: a price list is a menu, not a record. Ledger rows that
     * were charged against this service keep their own copy of the name and the amount, so
     * removing it cannot rewrite anyone's history.
     */
    suspend fun deleteService(clinicId: String, id: String): Result<Unit> = runCatching {
        clinic(clinicId).collection("services").document(id).delete().await()
    }

    // ------------------------------------------------------------------ the team

    /** One member of staff, as the Users screen edits them. */
    data class StaffRow(
        val id: String,
        val uid: String,
        val name: String,
        val email: String,
        val role: String,
        val phone: String,
        val active: Boolean,
        /** The tick-boxes on Manage Access. Empty means nothing beyond the role's own reach. */
        val permissions: List<String>,
        val commissionPercentage: Double,
        val baseSalary: Double,
    )

    val ROLES = listOf("Owner", "Admin", "Dentist", "Receptionist", "Assistant")

    suspend fun loadStaff(clinicId: String): List<StaffRow> {
        val snap = clinic(clinicId).collection("staff").get().await()
        return snap.documents.map { d ->
            StaffRow(
                id = d.id,
                uid = d.getString("uid").orEmpty(),
                name = d.getString("name").orEmpty(),
                email = d.getString("email").orEmpty(),
                role = d.getString("role").orEmpty(),
                phone = d.getString("phone").orEmpty(),
                // Absent reads as active: every record written before the flag existed is someone
                // who works here, and defaulting the other way would lock the clinic out of itself.
                active = d.getBoolean("active") != false,
                permissions = (d.get("permissions") as? List<*>).orEmpty().mapNotNull { it?.toString() },
                commissionPercentage = (d.get("commissionPercentage") as? Number)?.toDouble() ?: 0.0,
                baseSalary = (d.get("baseSalary") as? Number)?.toDouble() ?: 0.0,
            )
        }.sortedBy { it.name.lowercase() }
    }

    /**
     * Save one member's record.
     *
     * Never writes `uid`: that link is made when the person signs in, and overwriting it from a
     * form is how an account gets pointed at somebody else's record.
     */
    suspend fun saveStaff(clinicId: String, row: StaffRow): Result<Unit> = runCatching {
        val body = mapOf(
            "name" to row.name.trim(),
            "email" to row.email.trim().lowercase(),
            "role" to row.role,
            "phone" to row.phone.trim(),
            "active" to row.active,
            "permissions" to row.permissions,
            "commissionPercentage" to row.commissionPercentage,
            "baseSalary" to row.baseSalary,
        )
        val staff = clinic(clinicId).collection("staff")
        if (row.id.isBlank()) staff.document().set(body).await()
        else staff.document(row.id).set(body, SetOptions.merge()).await()
    }

    /**
     * Every permission the website's Manage Access screen offers, in its groups.
     *
     * Mirrors `src/lib/permissions.ts`. Owners and Admins hold everything without any of these
     * being ticked, exactly as `Session.can` and the Firestore rules already treat them.
     */
    val PERMISSION_GROUPS: List<Pair<String, List<Pair<String, String>>>> = listOf(
        "Patients" to listOf(
            "access.patients" to "See patients",
            "patients.add" to "Add a patient",
            "patients.edit" to "Edit a patient",
            "patients.delete" to "Delete a patient",
        ),
        "Appointments" to listOf(
            "access.appointments" to "See the diary",
            "appointments.add" to "Book an appointment",
            "appointments.edit" to "Change an appointment",
            "appointments.delete" to "Delete an appointment",
        ),
        "Clinical" to listOf(
            "access.clinical" to "See clinical records",
            "clinical.edit" to "Record treatment",
            "clinical.delete" to "Delete a clinical record",
            "access.ortho" to "Orthodontics",
            "access.lab" to "Lab cases",
        ),
        "Money" to listOf(
            "access.finance" to "See the money screens",
            "finance.view" to "See money rows",
            "finance.add" to "Take a payment",
            "finance.edit" to "Correct a money row",
            "finance.delete" to "Delete a money row",
            "access.reports" to "See reports",
        ),
        "Stock" to listOf(
            "access.inventory" to "See stock",
            "inventory.add" to "Add stock items",
            "inventory.edit" to "Adjust stock",
            "inventory.delete" to "Remove stock items",
        ),
        "Front desk and admin" to listOf(
            "access.marketing" to "Leads and marketing",
            "access.settings" to "Open settings",
            "settings.edit" to "Change settings",
            "attendance.admin" to "See everyone's attendance",
            "dashboard.view" to "See the dashboard",
        ),
    )

    // ------------------------------------------------------------------ alerts

    /**
     * Which events ring the bell, stored on `clinic_info.alertPreferences.inApp`.
     *
     * The keys are the website's own; `labReady` is the one the lab board fires. Absent reads as
     * off, because an alert nobody chose is the kind that teaches people to ignore the bell.
     */
    val ALERT_KEYS = listOf(
        "patientArrival" to "A patient checks in",
        "labReady" to "A lab case comes back",
    )

    /**
     * Arrival is on unless deliberately switched off - the push works out of the box and this is
     * the switch that silences it. Lab is off until somebody asks for it. Same defaults as the
     * website, or the same clinic would get different alerts depending which screen set them.
     */
    fun alertDefault(key: String): Boolean = key == "patientArrival"

    suspend fun loadAlerts(clinicId: String): Map<String, Boolean> {
        val prefs = loadDoc(clinicId, "clinic_info")["alertPreferences"] as? Map<*, *>
        val inApp = prefs?.get("inApp") as? Map<*, *> ?: return emptyMap()
        return ALERT_KEYS.associate { (key, _) ->
            key to (if (inApp.containsKey(key)) inApp[key] == true else alertDefault(key))
        }
    }

    suspend fun saveAlerts(clinicId: String, values: Map<String, Boolean>): Result<Unit> = runCatching {
        // Merged one level down, so a key this phone does not know about survives the save.
        val existing = loadDoc(clinicId, "clinic_info")["alertPreferences"] as? Map<*, *>
        val inApp = ((existing?.get("inApp") as? Map<*, *>)?.mapNotNull { (k, v) ->
            (k?.toString() ?: return@mapNotNull null) to v
        }?.toMap().orEmpty()) + values
        val other = existing?.mapNotNull { (k, v) ->
            val key = k?.toString() ?: return@mapNotNull null
            if (key == "inApp") null else key to v
        }?.toMap().orEmpty()
        saveDoc(clinicId, "clinic_info", mapOf("alertPreferences" to (other + mapOf("inApp" to inApp)))).getOrThrow()
    }

    // ------------------------------------------------------------------ online booking

    /**
     * The public booking page. `defaultDurationMinutes` is stored as a STRING, as the website
     * writes it - a number here would read back as blank in the web form.
     */
    data class OnlineBooking(
        val enabled: Boolean = false,
        val enableDoctorSelection: Boolean = false,
        val defaultDurationMinutes: String = "30",
    )

    suspend fun loadOnlineBooking(clinicId: String): OnlineBooking {
        val d = loadDoc(clinicId, "onlineBooking")
        return OnlineBooking(
            enabled = d["enabled"] == true,
            enableDoctorSelection = d["enableDoctorSelection"] == true,
            defaultDurationMinutes = d["defaultDurationMinutes"]?.toString().orEmpty().ifBlank { "30" },
        )
    }

    suspend fun saveOnlineBooking(clinicId: String, b: OnlineBooking): Result<Unit> = saveDoc(
        clinicId, "onlineBooking",
        mapOf(
            "enabled" to b.enabled,
            "enableDoctorSelection" to b.enableDoctorSelection,
            "defaultDurationMinutes" to b.defaultDurationMinutes.filter(Char::isDigit).ifBlank { "30" },
        )
    )

    // ------------------------------------------------------------------ the WhatsApp bot

    /**
     * The bot's own settings. Only the fields the phone offers are read and written; the rest of
     * the document (templates, the full fact sheet, the funnel) is left exactly as the desk left it.
     */
    data class BotSettings(
        val enabled: Boolean = false,
        /** Answering unknown numbers means answering wrong numbers and spam. Off by default. */
        val answerStrangers: Boolean = false,
        val autoConfirmBookings: Boolean = false,
        /** "" for the scripted bot, "ai_first" for the model answering first. */
        val mode: String = "",
        val aiEnabled: Boolean = false,
        /** "dentist" makes a symptom fetch a dentist's questions rather than a call-back. */
        val clinicalMode: String = "",
        /** How long a staff reply keeps the bot out of a thread. */
        val humanClaimMinutes: Int = 15,
        val personaName: String = "",
        /** The sentences the bot quotes verbatim, shown on the phone as quick replies too. */
        val facts: Map<String, String> = emptyMap(),
    )

    /** The fact rows the phone offers, matching the website's list and its order. */
    val BOT_FACT_KEYS = listOf(
        "consultation" to "Consultation fee",
        "mapsUrl" to "Location link",
        "parking" to "Parking",
        "walkIn" to "Walk-ins",
        "installments" to "Instalments",
        "offers" to "Offers",
        "insurance" to "Insurance",
        "durations" to "How long it takes",
        "sessions" to "Number of sessions",
        "aftercare" to "Aftercare",
        "whyUs" to "Why us",
    )

    suspend fun loadBot(clinicId: String): BotSettings {
        val d = loadDoc(clinicId, "whatsapp")
        val facts = (d["botFacts"] as? Map<*, *>).orEmpty().mapNotNull { (k, v) ->
            val key = k?.toString() ?: return@mapNotNull null
            key to v?.toString().orEmpty()
        }.toMap()
        return BotSettings(
            enabled = d["botEnabled"] == true,
            answerStrangers = d["botAnswerStrangers"] == true,
            autoConfirmBookings = d["botAutoConfirmBookings"] == true,
            mode = d["botMode"]?.toString().orEmpty(),
            aiEnabled = d["botAiEnabled"] == true || d["botMode"]?.toString() == "ai_first",
            clinicalMode = d["botClinicalMode"]?.toString().orEmpty(),
            humanClaimMinutes = (d["botHumanClaimMinutes"] as? Number)?.toInt() ?: 15,
            personaName = d["botPersonaName"]?.toString().orEmpty(),
            facts = facts,
        )
    }

    suspend fun saveBot(clinicId: String, b: BotSettings): Result<Unit> = runCatching {
        // botFacts is merged rather than replaced: the desk may hold facts this screen never shows.
        val existing = (loadDoc(clinicId, "whatsapp")["botFacts"] as? Map<*, *>).orEmpty()
            .mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }.toMap()
        saveDoc(
            clinicId, "whatsapp",
            mapOf(
                "botEnabled" to b.enabled,
                "botAnswerStrangers" to b.answerStrangers,
                "botAutoConfirmBookings" to b.autoConfirmBookings,
                "botMode" to b.mode,
                "botAiEnabled" to b.aiEnabled,
                "botClinicalMode" to b.clinicalMode,
                "botHumanClaimMinutes" to b.humanClaimMinutes.coerceIn(0, 1440),
                "botPersonaName" to b.personaName.trim(),
                "botFacts" to (existing + b.facts.filterValues { it.isNotBlank() }),
            )
        ).getOrThrow()
    }

    // ------------------------------------------------------------------ recall

    /**
     * How long after a visit a patient is due back, and how long silent before they count as
     * dormant. Two documents, because two different jobs read them - `settings/recall` for the
     * recall due list and `settings/reactivation` for the dormancy scan. Months is the friendly
     * unit; the scan reasons in days, and the conversion happens here as it does on the website.
     */
    data class Recall(val intervalMonths: Int = 6, val reactivationMonths: Int = 12)

    private const val DAYS_PER_MONTH = 30

    suspend fun loadRecall(clinicId: String): Recall {
        val recall = (loadDoc(clinicId, "recall")["intervalMonths"] as? Number)?.toInt() ?: 6
        val days = (loadDoc(clinicId, "reactivation")["thresholdDays"] as? Number)?.toInt() ?: 0
        return Recall(
            intervalMonths = recall.coerceIn(1, 60),
            reactivationMonths = if (days > 0) (days / DAYS_PER_MONTH).coerceIn(1, 60) else 12,
        )
    }

    suspend fun saveRecall(clinicId: String, r: Recall): Result<Unit> = runCatching {
        val stamp = java.time.Instant.now().toString()
        saveDoc(clinicId, "recall", mapOf("intervalMonths" to r.intervalMonths.coerceIn(1, 60), "configuredAt" to stamp)).getOrThrow()
        saveDoc(
            clinicId, "reactivation",
            mapOf("thresholdDays" to (r.reactivationMonths.coerceIn(1, 60) * DAYS_PER_MONTH), "configuredAt" to stamp),
        ).getOrThrow()
    }

    // ------------------------------------------------------------------ SMS, read-only

    /**
     * What the SMS setup currently is — shown, never written from here.
     *
     * Reminders go out through a paired phone's own SIM, a queue and a nightly job that are live
     * and working. Editing that configuration from a second surface is a good way to stop a
     * clinic's reminders without anybody noticing until patients do not turn up, so the phone
     * reports the setup and leaves changing it to the website. Reading is free of that risk.
     */
    data class SmsStatus(
        val enabled: Boolean,
        val optOutFooterEnabled: Boolean,
        val templates: Map<String, String>,
        val devices: List<SmsDevice>,
        val queued: Int,
    )

    data class SmsDevice(val id: String, val name: String, val enabled: Boolean, val lastSeenAt: String)

    suspend fun loadSmsStatus(clinicId: String): SmsStatus {
        val d = loadDoc(clinicId, "sms")
        val templates = (d["templates"] as? Map<*, *>).orEmpty().mapNotNull { (k, v) ->
            val key = k?.toString() ?: return@mapNotNull null
            key to v?.toString().orEmpty()
        }.toMap()
        val devices = runCatching {
            clinic(clinicId).collection("sms_devices").get().await().documents.map { doc ->
                SmsDevice(
                    id = doc.id,
                    name = doc.getString("name").orEmpty(),
                    enabled = doc.getBoolean("enabled") == true,
                    lastSeenAt = doc.getString("lastSeenAt").orEmpty(),
                )
            }
        }.getOrDefault(emptyList())
        val queued = runCatching {
            clinic(clinicId).collection("sms_outbox").whereEqualTo("status", "queued").get().await().size()
        }.getOrDefault(0)
        return SmsStatus(
            enabled = d["enabled"] == true,
            optOutFooterEnabled = d["optOutFooterEnabled"] == true,
            templates = templates,
            devices = devices,
            queued = queued,
        )
    }

    // ------------------------------------------------------------------ AI credits

    /** One month's AI spend, from the same counter every AI route charges. */
    data class AiMonth(val month: String, val creditsUsed: Double, val byFeature: Map<String, Double>)

    suspend fun loadAiUsage(clinicId: String): List<AiMonth> {
        val snap = runCatching { clinic(clinicId).collection("ai_usage").get().await() }.getOrNull()
            ?: return emptyList()
        return snap.documents
            .filter { Regex("^\\d{4}-\\d{2}$").matches(it.id) }
            .map { d ->
                val byFeature = (d.get("byFeature") as? Map<*, *>).orEmpty().mapNotNull { (k, v) ->
                    val key = k?.toString() ?: return@mapNotNull null
                    val n = (v as? Number)?.toDouble() ?: return@mapNotNull null
                    key to n
                }.toMap()
                AiMonth(d.id, (d.get("creditsUsed") as? Number)?.toDouble() ?: 0.0, byFeature)
            }
            .filter { it.creditsUsed > 0 || it.byFeature.isNotEmpty() }
            .sortedByDescending { it.month }
    }

    // ------------------------------------------------------------------ the dentist's own screen

    /** Whether a dentist's home shows their share of the day's takings. Absent reads as on. */
    suspend fun loadDentistShowShare(clinicId: String): Boolean {
        val home = loadDoc(clinicId, "clinic_info")["dentistHome"] as? Map<*, *>
        return home?.get("showShare") != false
    }

    suspend fun saveDentistShowShare(clinicId: String, show: Boolean): Result<Unit> = runCatching {
        // Merged into whatever else that object holds, so a key this screen does not know survives.
        val existing = (loadDoc(clinicId, "clinic_info")["dentistHome"] as? Map<*, *>).orEmpty()
            .mapNotNull { (k, v) -> (k?.toString() ?: return@mapNotNull null) to v }.toMap()
        saveDoc(clinicId, "clinic_info", mapOf("dentistHome" to (existing + mapOf("showShare" to show)))).getOrThrow()
    }

    // ------------------------------------------------------------------ activity log

    data class LogRow(val id: String, val action: String, val details: String, val by: String, val atMillis: Long)

    /** The last hundred things people did, newest first. Read-only everywhere, phone included. */
    suspend fun loadLogs(clinicId: String): List<LogRow> {
        val snap = clinic(clinicId).collection("system_logs")
            .orderBy("timestamp", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(100).get().await()
        return snap.documents.map { d ->
            LogRow(
                id = d.id,
                action = d.getString("action").orEmpty(),
                details = d.getString("details").orEmpty(),
                // "user" is the legacy key older rows carry; newer ones write userName.
                by = d.getString("userName").orEmpty().ifBlank { d.getString("user").orEmpty() },
                atMillis = d.getTimestamp("timestamp")?.toDate()?.time ?: 0L,
            )
        }
    }

    // ------------------------------------------------------------------ join requests

    data class JoinRequest(val id: String, val name: String, val email: String, val role: String, val atMillis: Long)

    suspend fun loadJoinRequests(clinicId: String): List<JoinRequest> {
        // Both spellings, as the website queries: older rows were written with a capital P.
        val snap = Firebase.db().collection("join_requests")
            .whereEqualTo("clinicId", clinicId)
            .whereIn("status", listOf("pending", "Pending"))
            .get().await()
        return snap.documents.map { d ->
            JoinRequest(
                id = d.id,
                // Older requests carry userName/userEmail; newer ones name/email.
                name = d.getString("name").orEmpty().ifBlank { d.getString("userName").orEmpty() },
                email = d.getString("email").orEmpty().ifBlank { d.getString("userEmail").orEmpty() },
                role = d.getString("requestedRole").orEmpty().ifBlank { d.getString("role").orEmpty() },
                atMillis = d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
            )
        }.sortedByDescending { it.atMillis }
    }

    /**
     * Refuse someone asking to join: the request's own status, and nothing else.
     *
     * APPROVING is deliberately not here. The rules forbid any user, admin included, from writing
     * another person's `clinicRoles`, so an approval written from the phone would set the request
     * to "approved" and grant nothing - the exact failure the website already had and fixed by
     * moving approval to a server route. The phone calls that same route; see JoinRequestClient.
     */
    suspend fun rejectJoinRequest(id: String): Result<Unit> = runCatching {
        Firebase.db().collection("join_requests").document(id)
            .set(mapOf("status" to "rejected"), SetOptions.merge()).await()
    }
}
