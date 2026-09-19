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
        /** "minutes", "hours" or "hourOfDay". */
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
        val ignoresQuietHours: Boolean = false,
        val timings: List<Timing> = emptyList(),
        /** Where the answer lived before the catalogue existed (`alertPreferences.inApp.<key>`). */
        val legacyKey: String? = null,
    )

'''

TAIL = '''
    fun event(id: String): Event? = EVENTS.firstOrNull { it.id == id }

    fun eventsIn(group: String): List<Event> = EVENTS.filter { it.group == group }

    /** What one alert resolves to for a clinic: where it goes, and to whom. */
    data class Resolved(val event: Event, val bell: Boolean, val push: Boolean, val roles: List<String>)

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
        var roles = event.roles
        val askedRoles = saved?.get("roles") as? List<*>
        if (!event.rolesFixed && askedRoles != null) {
            roles = askedRoles.mapNotNull { it?.toString() }.filter { it in ROLES }
        }
        event.rolesMax?.let { max -> roles = roles.filter { it in max } }
        return Resolved(event, bell, push, roles)
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
        out.append("        Event(\n            " + ",\n            ".join(parts) + ",\n        ),")
    out.append("    )\n" + TAIL)
    with open(KT, "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(out))
    print("regenerated", KT, len(d["events"]), "events")


if __name__ == "__main__":
    main()
