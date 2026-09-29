package com.alphadental.clinic.next.data

import android.content.Context
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import java.util.Locale

/**
 * Which language the phone asks for.
 *
 * The app's own chrome is written in English. What this decides is the language of everything
 * the phone FETCHES or DRAWS from content that exists in both — the reports (built on the server
 * in the language asked for), the help articles (two sets ship in assets), and the dates and
 * digits in what the phone prints. Flipping it is the Menu's "العربية" row, which used to do
 * nothing at all.
 *
 * Kept in SharedPreferences rather than on the user document, because it is this phone's
 * preference: a receptionist's Arabic phone and the owner's English one are two answers.
 */
object AppLocale {
    private const val PREFS = "alpha_locale"
    private const val KEY = "language"

    private val state = mutableStateOf("en")

    /** "en" or "ar". Observable, so a screen re-draws when it changes. */
    val language: State<String> get() = state
    val isArabic: Boolean get() = state.value == "ar"

    /** Read once at start-up; the device's own language decides the first time. */
    fun attach(context: Context) {
        val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        state.value = stored ?: if (Locale.getDefault().language == "ar") "ar" else "en"
    }

    fun set(context: Context, lang: String) {
        val next = if (lang == "ar") "ar" else "en"
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, next).apply()
        state.value = next
    }

    fun toggle(context: Context) = set(context, if (isArabic) "en" else "ar")

    /** The row's label: the language you would switch TO. */
    val switchLabel: String get() = if (isArabic) "English" else "العربية"
}
