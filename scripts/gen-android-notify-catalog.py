"""Regenerate android/.../data/NotifyCatalog.kt from functions/notificationCatalog.js.

The Functions copy is itself generated from src/lib/notificationCatalog.ts (npm run
gen:notify-catalog), so run that first. This keeps the phone's Alerts page in step with the
website's without a third hand-maintained list.

    python scripts/gen-android-notify-catalog.py
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KT = os.path.join(ROOT, "android/app/src/main/java/com/alphadental/clinic/data/NotifyCatalog.kt")

HEAD = '''package com.alphadental.clinic.data

/**
 * Every alert the system can raise - GENERATED from the website's catalogue.
 *
 * Source of truth: `src/lib/notificationCatalog.ts`. Regenerate with
 * `python scripts/gen-android-notify-catalog.py` (which reads the Functions copy,
 * `functions/notificationCatalog.js`, itself generated from the TypeScript). Never edit the lists
 * by hand: the ids are storage keys shared with the website, the bell and every personal mute
 * list, and a row that disagrees with the website's is a clinic being told two different things.
 *
 * The resolver at the bottom is a straight port of `resolveNotify` and `notifyTiming`, so the
 * phone and the website read the same saved answers the same way.
 */
object NotifyCatalog {

    val ROLES = listOf("Owner", "Admin", "Dentist", "Receptionist", "Assistant")

    data class Group(val id: String, val en: String, val ar: String, val noteEn: String, val noteAr: String)

    data class Timing(
        val key: String,
        /** "minutes", "hours", "hourOfDay", "weekday", "dayOfMonth", or a threshold: "percent", "egp", "count", "days". */
        val kind: String,
        val en: String,
        val ar: String,
        val fallback: Int,
        val min: Int,
        val max: Int,
    )

    data class Event(
        val id: String,
        val group: String,
        val en: String,
        val ar: String,
        val whenEn: String,
        val whenAr: String,
        val roles: List<String>,
        /** The audience is part of what the alert is; no role picker. */
        val rolesFixed: Boolean = false,
        /** A ceiling the clinic cannot raise. */
        val rolesMax: List<String>? = null,
        val bell: Boolean,
        val push: Boolean,
        /** Sent to each recipient's WhatsApp out of the box. */
        val whatsapp: Boolean = false,
        /** The WhatsApp switch is offered: the web server raises this alert and can put it on WhatsApp. */
        val waReady: Boolean = false,
        /** One of the scheduled reports: "morning", "evening", "dentistDay", "summary", "weekly", "monthly", "payroll". */
        val report: String? = null,
        val ignoresQuietHours: Boolean = false,
        val timings: List<Timing> = emptyList(),
        /** Where the answer lived before the catalogue existed (`alertPreferences.inApp.<key>`). */
        val legacyKey: String? = null,
        /** The old Settings → WhatsApp grid key; read from `legacyOwnerAlerts` the same way the website does. */
        val legacyOwnerKey: String? = null,
    )

    val BATCHING = listOf("instant", "hourly", "daily")
    val REPORT_SECTIONS = listOf("money", "appointments", "patients", "team")
    val MONEY_DETAILS = listOf("totals", "dentists", "full")

'''

TAIL = '''
    fun event(id: String): Event? = EVENTS.firstOrNull { it.id == id }

    fun eventsIn(group: String): List<Event> = EVENTS.filter { it.group == group }

    /** What one alert resolves to for a clinic: where it goes, and to whom. */
    data class Resolved(
        val event: Event,
        val bell: Boolean,
        val push: Boolean,
        val whatsapp: Boolean,
        val roles: List<String>,
        val batching: String,
    ) {
        val any: Boolean get() = bell || push || whatsapp
    }

    fun reportEvents(): List<Event> = EVENTS.filter { it.report != null }

    /**
     * The clinic's own answer, then the answer it gave before this page existed, then the
     * catalogue's default. Same order as the website's `resolveNotify`.
     */
    fun resolve(eventId: String, prefs: Map<String, Any?>?): Resolved? {
        val event = event(eventId) ?: return null
        val saved = (prefs?.get("events") as? Map<*, *>)?.get(eventId) as? Map<*, *>
        val legacy = event.legacyKey?.let { (prefs?.get("inApp") as? Map<*, *>)?.get(it) as? Boolean }
        val bell = (saved?.get("bell") as? Boolean) ?: legacy ?: event.bell
        val push = (saved?.get("push") as? Boolean) ?: legacy ?: event.push
        val legacyOwner = event.legacyOwnerKey?.let { (prefs?.get("legacyOwnerAlerts") as? Map<*, *>)?.get(it) as? Boolean }
        val whatsapp = event.waReady && ((saved?.get("whatsapp") as? Boolean) ?: legacyOwner ?: event.whatsapp)
        val savedBatching = saved?.get("batching")?.toString()
        val batching = if (event.report == null && (savedBatching == "hourly" || savedBatching == "daily")) savedBatching else "instant"
        var roles = event.roles
        val askedRoles = saved?.get("roles") as? List<*>
        if (!event.rolesFixed && askedRoles != null) {
            roles = askedRoles.mapNotNull { it?.toString() }.filter { it in ROLES }
        }
        event.rolesMax?.let { max -> roles = roles.filter { it in max } }
        return Resolved(event, bell, push, whatsapp, roles, batching)
    }

    /** A scheduled report's own settings, defaults filled in — a port of the website's `reportPrefs`. */
    data class ReportPrefs(
        val sections: Map<String, Boolean>,
        val moneyDetail: String,
        val comparisons: Boolean,
        val language: String,
        val pdf: Boolean,
    )

    fun reportPrefs(eventId: String, prefs: Map<String, Any?>?): ReportPrefs {
        val event = event(eventId)
        val saved = (prefs?.get("reports") as? Map<*, *>)?.get(eventId) as? Map<*, *>
        val savedSections = saved?.get("sections") as? Map<*, *>
        val isMorning = event?.report == "morning"
        fun pick(key: String, fallback: Boolean) = (savedSections?.get(key) as? Boolean) ?: fallback
        val detail = saved?.get("moneyDetail")?.toString()
        return ReportPrefs(
            sections = mapOf(
                "money" to pick("money", true),
                "appointments" to pick("appointments", true),
                "patients" to pick("patients", true),
                "team" to pick("team", !isMorning),
            ),
            moneyDetail = if (detail in MONEY_DETAILS) detail!! else "dentists",
            comparisons = saved?.get("comparisons") != false,
            language = if (saved?.get("language") == "en") "en" else "ar",
            pdf = saved?.get("pdf") == true,
        )
    }

    /** One person's WhatsApp: on unless the owner switched them off, and the number the owner typed. */
    data class Person(val enabled: Boolean, val phone: String)

    fun person(uid: String, prefs: Map<String, Any?>?): Person {
        val p = (prefs?.get("people") as? Map<*, *>)?.get(uid) as? Map<*, *>
        return Person(enabled = p?.get("whatsapp") != false, phone = p?.get("phone")?.toString()?.trim().orEmpty())
    }

    /** One of an alert's numbers as this clinic set it, or what the code used before. */
    fun timing(eventId: String, key: String, prefs: Map<String, Any?>?): Int {
        val t = event(eventId)?.timings?.firstOrNull { it.key == key } ?: return 0
        val raw = ((prefs?.get("timings") as? Map<*, *>)?.get(eventId) as? Map<*, *>)?.get(key) as? Number
        val v = raw?.toInt() ?: return t.fallback
        return v.coerceIn(t.min, t.max)
    }
}
'''


def q(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$") + '"'


def main():
    js = subprocess.check_output(
        ["node", "-e", "const c=require('./functions/notificationCatalog.js');process.stdout.write(JSON.stringify({groups:c.NOTIFY_GROUPS,events:c.NOTIFY_EVENTS}))"],
        cwd=ROOT,
    )
    d = json.loads(js.decode("utf-8"))
    out = [HEAD + "    val GROUPS: List<Group> = listOf("]
    for g in d["groups"]:
        out.append(f'        Group({q(g["id"])}, {q(g["en"])}, {q(g["ar"])}, {q(g["noteEn"])}, {q(g["noteAr"])}),')
    out.append("    )\n\n    val EVENTS: List<Event> = listOf(")
    for e in d["events"]:
        parts = [
            f'id = {q(e["id"])}', f'group = {q(e["group"])}', f'en = {q(e["en"])}', f'ar = {q(e["ar"])}',
            f'whenEn = {q(e["whenEn"])}', f'whenAr = {q(e["whenAr"])}',
            "roles = listOf(" + ", ".join(q(r) for r in e["roles"]) + ")",
        ]
        if e.get("rolesFixed"):
            parts.append("rolesFixed = true")
        if e.get("rolesMax"):
            parts.append("rolesMax = listOf(" + ", ".join(q(r) for r in e["rolesMax"]) + ")")
        parts.append("bell = " + ("true" if e["bell"] else "false"))
        parts.append("push = " + ("true" if e["push"] else "false"))
        if e.get("whatsapp"):
            parts.append("whatsapp = true")
        if e.get("waReady"):
            parts.append("waReady = true")
        if e.get("report"):
            parts.append(f'report = {q(e["report"])}')
        if e.get("ignoresQuietHours"):
            parts.append("ignoresQuietHours = true")
        if e.get("timings"):
            ts = ", ".join(
                f'Timing({q(t["key"])}, {q(t["kind"])}, {q(t["en"])}, {q(t["ar"])}, {t["fallback"]}, {t["min"]}, {t["max"]})'
                for t in e["timings"]
            )
            parts.append(f"timings = listOf({ts})")
        if e.get("legacyKey"):
            parts.append(f'legacyKey = {q(e["legacyKey"])}')
        if e.get("legacyOwnerKey"):
            parts.append(f'legacyOwnerKey = {q(e["legacyOwnerKey"])}')
        out.append("        Event(\n            " + ",\n            ".join(parts) + ",\n        ),")
    out.append("    )\n" + TAIL)
    with open(KT, "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(out))
    print("regenerated", KT, len(d["events"]), "events")


if __name__ == "__main__":
    main()
