package com.alphadental.clinic.next.data

import com.alphadental.clinic.Firebase
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.tasks.await

/**
 * How one person wants THEIR phone laid out.
 *
 * Stored on the person's own record — `users/{uid}.uiPreferences.android` — beside the website's
 * own interface preferences, which live in the same field under other keys. That is the one
 * document a signed-in person may write without being an admin (the rules let you change your
 * own record except your roles and permissions), so a receptionist can set up her phone the way
 * she likes it without asking anyone. It follows her to another phone, and another account on the
 * same phone gets its own answer.
 *
 * The website has an Interface section too, but its settings are about a layout this app does
 * not have — panels, drawers, a left rail. These are the phone's own: which home screen, which
 * tabs in the bar, which tools in the menu.
 */
data class AppPrefs(
    /** "desk" (the dashboard as built), "owner" (the money and the floor), or "dentist" (my chair). */
    val home: String = "desk",
    /** Bar tabs this person has switched off, by [Tab] name. Today and More can never be hidden. */
    val hiddenTabs: Set<String> = emptySet(),
    /** Menu tools this person has switched off, by Destination name. Settings and Help stay. */
    val hiddenTools: Set<String> = emptySet(),
    /** Read once; false until the record has been consulted, so a screen can wait rather than flash. */
    val loaded: Boolean = false,
)

object AppPrefsStore {

    /** Tabs that are the app's spine and cannot be switched off. */
    val FIXED_TABS = setOf("Today", "More")

    /** Tools that must stay reachable: the way back to this very setting, and help. */
    val FIXED_TOOLS = setOf("Settings", "Help", "Language", "MyApp")

    suspend fun load(uid: String): AppPrefs {
        val snap = Firebase.db().collection("users").document(uid).get().await()
        @Suppress("UNCHECKED_CAST")
        val ui = snap.get("uiPreferences") as? Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val android = ui?.get("android") as? Map<String, Any?>
        return AppPrefs(
            home = android?.get("home")?.toString().orEmpty().ifBlank { "desk" },
            hiddenTabs = (android?.get("hiddenTabs") as? List<*>).orEmpty().mapNotNull { it?.toString() }.toSet() - FIXED_TABS,
            hiddenTools = (android?.get("hiddenTools") as? List<*>).orEmpty().mapNotNull { it?.toString() }.toSet() - FIXED_TOOLS,
            loaded = true,
        )
    }

    /**
     * Merged, not replaced: the website keeps its own keys in `uiPreferences` and a phone
     * overwriting the whole map would wipe a desk layout somebody set up on purpose.
     */
    suspend fun save(uid: String, prefs: AppPrefs): Result<Unit> = runCatching {
        Firebase.db().collection("users").document(uid).set(
            mapOf(
                "uiPreferences" to mapOf(
                    "android" to mapOf(
                        "home" to prefs.home,
                        "hiddenTabs" to (prefs.hiddenTabs - FIXED_TABS).sorted(),
                        "hiddenTools" to (prefs.hiddenTools - FIXED_TOOLS).sorted(),
                    ),
                ),
            ),
            SetOptions.merge(),
        ).await()
        Unit
    }
}
