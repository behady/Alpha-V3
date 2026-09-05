package com.alphadental.clinic

import com.alphadental.clinic.data.Session
import com.google.firebase.crashlytics.FirebaseCrashlytics

/**
 * Crash reporting, in one place.
 *
 * Until this existed a crash on a receptionist's phone reached nobody: the app closed, they
 * reopened it, and the fault was reported as "the app is slow" a week later, if at all. Every
 * build is now installed by copying an APK across, on phones nobody has looked at — so the app
 * has to tell on itself. Crashlytics is the Firebase console the project already lives in.
 *
 * Three things are recorded beyond the crash itself, because a stack trace without them is a
 * guess: which account (uid, not name), which clinic, and which role. Nothing a patient owns.
 *
 * Every call is wrapped: reporting must never be what crashes the app, and an unconfigured
 * Crashlytics (a debug build with no google-services.json) throws from `getInstance()`.
 */
object Crash {

    /** Who is signed in, so a report can be matched to a clinic and a role. Cleared on sign-out. */
    fun identify(session: Session) {
        runCatching {
            FirebaseCrashlytics.getInstance().apply {
                setUserId(session.uid)
                setCustomKey("clinicId", session.clinicId)
                setCustomKey("role", session.role)
                setCustomKey("version", BuildConfig.VERSION_NAME)
            }
        }
    }

    fun clear() {
        runCatching {
            FirebaseCrashlytics.getInstance().apply {
                setUserId("")
                setCustomKey("clinicId", "")
                setCustomKey("role", "")
            }
        }
    }

    /**
     * A failure the app survived but should not have had to.
     *
     * A write the security rules rejected, a read that failed for a reason other than no signal:
     * these are shown to the person as one plain sentence (or not at all, for a queued write), and
     * the detail goes here so the fault can be fixed rather than re-explained on the phone.
     */
    fun record(error: Throwable, what: String = "") {
        runCatching {
            FirebaseCrashlytics.getInstance().apply {
                if (what.isNotBlank()) log(what)
                recordException(error)
            }
        }
    }
}
