package com.alphadental.clinic.ai

/**
 * "Open the leads" understood by the phone itself.
 *
 * Navigation is the one assistant job with a provably right answer: the screens
 * have names, and matching a name needs no model. Handling these locally makes
 * them instant, free of AI credits, and immune to a flaky connection — and
 * anything this parser does not recognise falls through to the server assistant
 * unchanged, so a miss costs nothing.
 *
 * Deliberately strict: it wants an opening verb AND a screen name. "How many
 * leads today?" must NOT navigate — that is a question, and the assistant
 * answers questions.
 */
object NavIntent {

    sealed class Target {
        object Day : Target()
        object Money : Target()
        object Leads : Target()
        object Reports : Target()
        object Inventory : Target()
        object Patients : Target()
        object Ortho : Target()
        object WhatsappQueue : Target()
        /** "Open Sara's file" — the name still has to be found in the register. */
        data class PatientFile(val name: String) : Target()
        /** The server named a patient by id, so no register lookup is needed. */
        data class PatientById(val id: String) : Target()
    }

    /**
     * Turns the website path the server sends into a screen this app has.
     *
     * `navigate_to` is one of the assistant's core tools, and it answers in web
     * routes — `/patients`, `/patients/abc123?tab=finance` — because the website
     * is the client it was written against. The phone used to parse the reply
     * text and throw the path away, so "Navigating to /patients…" appeared in the
     * chat and nothing moved.
     *
     * Null for a path this app has no screen for, which is the honest answer for
     * `/marketing` or `/settings/billing` — better to say so than to open
     * something else and call it done.
     */
    fun fromWebPath(path: String?): Target? {
        val clean = path.orEmpty()
            .substringBefore('?')
            .substringBefore('#')
            .trim()
            .trim('/')
            .lowercase()
        if (clean.isEmpty()) return null

        val segments = clean.split('/')
        // "/patients/abc123" opens that file directly; "/patients" opens the list.
        if (segments[0] == "patients" && segments.size > 1 && segments[1].isNotBlank()) {
            return Target.PatientById(segments[1])
        }
        return when (segments[0]) {
            "patients" -> Target.Patients
            "appointments", "calendar", "schedule", "day", "dashboard" -> Target.Day
            "finance", "money", "billing" -> Target.Money
            "reports" -> Target.Reports
            "inventory", "stock" -> Target.Inventory
            "leads", "crm" -> Target.Leads
            "ortho" -> Target.Ortho
            "messages", "whatsapp" -> Target.WhatsappQueue
            else -> null
        }
    }

    private val OPEN_VERBS = listOf(
        "open", "show", "go to", "goto", "take me to",
        "افتح", "إفتح", "اعرض", "إعرض", "وريني", "ورينى", "روح على", "روح ل",
    )

    private val SCREENS: List<Pair<Target, List<String>>> = listOf(
        Target.Day to listOf("day", "today's schedule", "schedule", "calendar", "اليوم", "الجدول", "المواعيد"),
        Target.Money to listOf("money", "finance", "الحسابات", "المالية", "الفلوس"),
        Target.Leads to listOf("leads", "lead", "crm", "العملاء المحتملين", "العملاء المحتملون", "عملاء محتملين"),
        Target.Reports to listOf("reports", "report page", "التقارير"),
        Target.Inventory to listOf("stock", "inventory", "المخزون", "المخزن"),
        Target.Patients to listOf("patients", "patient list", "المرضى", "قائمة المرضى"),
        Target.Ortho to listOf("ortho", "orthodontics", "التقويم"),
        Target.WhatsappQueue to listOf("whatsapp queue", "whatsapp messages", "رسائل واتساب", "قائمة واتساب"),
    )

    /** The word that marks a patient-file request, and splits the name out of it. */
    private val FILE_WORDS = listOf("file", "profile", "ملف")

    fun parse(prompt: String): Target? {
        val lower = prompt.lowercase().trim()

        val verb = OPEN_VERBS.firstOrNull { lower.startsWith(it) || " $it " in " $lower " }
            ?: return null

        // A question mark or a question word means they are asking, not navigating.
        if ("?" in lower || "؟" in lower) return null
        if (listOf("how many", "how much", "كم ", "كام ").any { it in lower }) return null

        // Patient file first: it also contains screen-ish words ("patient").
        if (FILE_WORDS.any { " $it" in " $lower" || lower.endsWith(it) }) {
            val name = extractPatientName(lower, verb)
            if (name.isNotBlank()) return Target.PatientFile(name)
        }

        for ((target, names) in SCREENS) {
            if (names.any { it in lower }) return target
        }
        return null
    }

    /**
     * The name is whatever is left after the verb and the file-words go:
     * "open sara adel's file" → "sara adel"; "افتح ملف سارة" → "سارة".
     */
    private fun extractPatientName(lower: String, verb: String): String {
        var rest = lower.substringAfter(verb).trim()
        // English possessive and the file words, wherever they sit.
        rest = rest.removeSuffix("file").removeSuffix("profile").trim()
        rest = rest.removeSuffix("'s").removeSuffix("s'").trim()
        // Arabic: "ملف سارة" puts the word first.
        FILE_WORDS.forEach { word ->
            rest = rest.removePrefix("$word ").trim()
            rest = rest.replace(" $word ", " ").trim()
        }
        // Leftover connective words.
        listOf("the", "patient", "المريض", "المريضة", "بتاع", "بتاعة").forEach { filler ->
            rest = rest.removePrefix("$filler ").trim()
            rest = rest.removeSuffix(" $filler").trim()
        }
        return rest
    }
}
