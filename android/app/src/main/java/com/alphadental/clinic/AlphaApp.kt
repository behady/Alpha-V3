package com.alphadental.clinic

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings

/**
 * Connects the app to the same Firebase project the website uses.
 *
 * There is no google-services.json here on purpose. That file exists to carry
 * exactly the values below, and generating it means registering an Android app in
 * the Firebase console. Email sign-in and Firestore need nothing more than these,
 * so the build stays self-contained. (Google Sign-In would be the exception — it
 * needs a real Android OAuth client — which is why this version signs in with
 * email and password only.)
 *
 * `FB_APP_ID` is presently the **web** app's id (the only one available without a
 * console visit), not a real Android-registered one — its middle segment reads
 * `:web:` where an Android id reads `:android:`. Firebase's local SDK code does
 * not reject that shape, but Google's own Installations service — which every
 * Auth and Firestore call quietly depends on — can. A phone that fails there
 * would look identical from here to any other startup failure, which is exactly
 * why onCreate() below cannot be allowed to throw silently.
 */
class AlphaApp : Application() {

    override fun onCreate() {
        super.onCreate()

        // Nothing below this line may throw and take the process down with it.
        // An uncaught exception in Application.onCreate() kills the app before a
        // single pixel of UI exists — indistinguishable, to whoever is holding the
        // phone, from the app simply not opening. Recording the failure instead
        // lets MainActivity show an actual message on the very screen that would
        // otherwise have stayed blank.
        // Read before anything draws, so the first frame is already in the right
        // theme instead of flashing the default one on a dark phone.
        com.alphadental.clinic.ui.AppearanceStore.init(this)

        try {
            val options = FirebaseOptions.Builder()
                .setProjectId(BuildConfig.FB_PROJECT_ID)
                .setApplicationId(BuildConfig.FB_APP_ID)
                .setApiKey(BuildConfig.FB_API_KEY)
                .setGcmSenderId(BuildConfig.FB_SENDER_ID)
                .setStorageBucket(BuildConfig.FB_STORAGE_BUCKET)
                .build()

            val app = FirebaseApp.initializeApp(this, options) ?: FirebaseApp.getInstance()

            Firebase.init(app)
            FirebaseAuth.getInstance(app)
            com.alphadental.clinic.push.ensureNotificationChannel(this)
            startupError = null
        } catch (t: Throwable) {
            startupError = t.message ?: t.javaClass.simpleName
        }
    }

    companion object {
        /** Null once startup succeeded. Read by MainActivity before it renders anything else. */
        var startupError: String? = null
            private set
    }
}

/**
 * One place that hands out the Firestore handle, so the database name is written
 * exactly once.
 *
 * That name matters more than it looks. This project's database is literally
 * called "default" — not the conventional "(default)", which does not exist here
 * at all. Calling plain `FirebaseFirestore.getInstance()` binds to "(default)",
 * and every read comes back empty with no error to explain why: the app looks
 * connected, signs in fine, and shows a clinic with no patients in it. The
 * website hits the same trap and solves it the same way.
 */
object Firebase {

    private lateinit var firestore: FirebaseFirestore

    fun init(app: FirebaseApp) {
        firestore = FirebaseFirestore.getInstance(app, DATABASE_NAME).apply {
            firestoreSettings = FirebaseFirestoreSettings.Builder()
                // The on-device copy IS the offline support. Firestore keeps what it
                // has seen, serves reads from it with no signal, and replays writes
                // when the connection returns — including after the app was closed.
                // Unlimited size because a clinic's day is small and silently
                // evicting a patient mid-shift would be worse than the disk cost.
                .setLocalCacheSettings(
                    PersistentCacheSettings.newBuilder()
                        .setSizeBytes(FirebaseFirestoreSettings.CACHE_SIZE_UNLIMITED)
                        .build()
                )
                .build()
        }
    }

    fun db(): FirebaseFirestore = firestore

    fun auth(): FirebaseAuth = FirebaseAuth.getInstance()

    private const val DATABASE_NAME = "default"
}
