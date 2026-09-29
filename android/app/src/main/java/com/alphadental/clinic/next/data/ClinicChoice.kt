package com.alphadental.clinic.next.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Which clinic this phone is looking at.
 *
 * An account can hold a role at several clinics, and until now the phone picked one for you: the
 * stored `defaultClinicId` if it still existed, otherwise whichever key Firestore happened to hand
 * back first from `clinicRoles`. A map has no order worth relying on, so "first" meant "the same
 * wrong one every time, for no reason anybody could see" — an owner signed in and found themselves
 * permanently inside another clinic, with no switch anywhere and no way to tell it had happened.
 *
 * The choice is kept per account rather than per phone. Two people share a phone at a desk more
 * often than anyone plans for, and inheriting the last person's clinic is worse than picking wrong
 * in the first place.
 *
 * Deliberately NOT written back to `users/{uid}.defaultClinicId`. That field is the WEBSITE's
 * answer, written by server routes, and a phone quietly changing which clinic a colleague's browser
 * opens on is not a thing a phone should be able to do.
 */
object ClinicChoice {

    private const val PREFS = "alpha_clinic_choice"

    private var prefs: SharedPreferences? = null

    /** Called once when the app starts. Everything below is a no-op until it has been. */
    fun attach(context: Context) {
        if (prefs == null) {
            prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        }
    }

    fun preferred(uid: String): String? =
        prefs?.getString(key(uid), null)?.takeIf { it.isNotBlank() }

    fun remember(uid: String, clinicId: String) {
        prefs?.edit()?.putString(key(uid), clinicId)?.apply()
    }

    /** Used when the remembered clinic turns out to be one this account no longer works at. */
    fun forget(uid: String) {
        prefs?.edit()?.remove(key(uid))?.apply()
    }

    private fun key(uid: String) = "clinic_$uid"
}
